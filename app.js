// =================================================================
// BACKEND WITH POSTGRESQL PERSISTENCE AND AGENT ASSOCIATION
// =================================================================

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// PostgreSQL Connection
const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_aE4iTqzeIWB3@ep-old-wind-a1j8s1aj-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  ssl: {
    rejectUnauthorized: false
  }
});

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create conversations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id VARCHAR(255) PRIMARY KEY,
        customer_id VARCHAR(255) NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        agent_id VARCHAR(255),
        agent_name VARCHAR(255),
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP,
        last_message_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_message TEXT DEFAULT 'Conversation started',
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'closed', 'queued')),
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        feedback TEXT
      )
    `);

    // Create messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(255) PRIMARY KEY,
        conversation_id VARCHAR(255) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender VARCHAR(255) NOT NULL,
        sender_id VARCHAR(255),
        type VARCHAR(20) NOT NULL CHECK (type IN ('user', 'agent', 'bot', 'system')),
        content TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read_status BOOLEAN DEFAULT FALSE
      )
    `);

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_customer_id ON conversations(customer_id)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)
    `);

    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  }
}

// Initialize database on startup
initializeDatabase();

app.use(cors());
app.use(express.json());

// Store active agents and customer socket mappings
const activeAgents = new Map();
const customerSockets = new Map();
const pendingAgentRequests = [];

// --- HTTP API Endpoints ---

// Get all conversations
app.get("/api/conversations", async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM conversations ORDER BY start_time DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get specific conversation with messages
app.get("/api/conversation/:conversationId", async (req, res) => {
  try {
    const conversationResult = await pool.query(
      'SELECT * FROM conversations WHERE id = $1',
      [req.params.conversationId]
    );
    
    if (conversationResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    
    const messagesResult = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC',
      [req.params.conversationId]
    );
    
    // Mark messages as read
    await pool.query(
      'UPDATE messages SET read_status = TRUE WHERE conversation_id = $1 AND type = \'user\' AND read_status = FALSE',
      [req.params.conversationId]
    );
    
    res.json({ 
      conversation: conversationResult.rows[0], 
      messages: messagesResult.rows 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get conversations for a specific agent
app.get("/api/agent/:agentId/conversations", async (req, res) => {
  try {
    const conversationsResult = await pool.query(
      'SELECT * FROM conversations WHERE agent_id = $1 AND status IN (\'active\', \'queued\') ORDER BY last_message_time DESC',
      [req.params.agentId]
    );
    
    const conversations = await Promise.all(conversationsResult.rows.map(async (conv) => {
      const unreadResult = await pool.query(
        'SELECT COUNT(*) as unread_count FROM messages WHERE conversation_id = $1 AND type = \'user\' AND read_status = FALSE',
        [conv.id]
      );
      
      return {
        ...conv,
        unreadCount: parseInt(unreadResult.rows[0].unread_count)
      };
    }));
    
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get conversations for a specific customer
app.get("/api/customer/:customerId/conversations", async (req, res) => {
  try {
    const conversationsResult = await pool.query(
      'SELECT * FROM conversations WHERE customer_id = $1 ORDER BY start_time DESC',
      [req.params.customerId]
    );
    
    const result = await Promise.all(conversationsResult.rows.map(async (conv) => {
      const messagesResult = await pool.query(
        'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC',
        [conv.id]
      );
      
      return {
        conversation: conv,
        messages: messagesResult.rows
      };
    }));
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit feedback for a conversation
app.post("/api/conversation/:conversationId/feedback", async (req, res) => {
  try {
    const { rating, feedback } = req.body;
    const result = await pool.query(
      'UPDATE conversations SET rating = $1, feedback = $2 WHERE id = $3 RETURNING *',
      [rating, feedback, req.params.conversationId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- WebSocket Connection Handling ---

io.on('connection', (socket) => {
  console.log('🌐 New client connected:', socket.id);

  socket.on('customer_join', async (data) => {
    const { name, customerId } = data;
    console.log(`👤 CUSTOMER JOIN: ${name} (${customerId}) on socket ${socket.id}`);
    customerSockets.set(customerId, socket.id);
    
    try {
      // Check if there's an existing active conversation
      const conversationResult = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'',
        [customerId]
      );
      
      let conversation;
      if (conversationResult.rows.length === 0) {
        // Create a new conversation
        const insertResult = await pool.query(
          `INSERT INTO conversations (id, customer_id, customer_name, status) 
           VALUES ($1, $2, $3, 'active') RETURNING *`,
          [uuidv4(), customerId, name]
        );
        conversation = insertResult.rows[0];
      } else {
        conversation = conversationResult.rows[0];
      }
      
      // Add system message
      await pool.query(
        `INSERT INTO messages (id, conversation_id, sender, type, content) 
         VALUES ($1, $2, 'System', 'system', 'Customer joined the chat')`,
        [uuidv4(), conversation.id]
      );
      
      // Join the room for this conversation
      const roomName = `room_${customerId}`;
      socket.join(roomName);
      
      // Send connection status to customer
      socket.emit('connection_status', { 
        status: 'connected', 
        socketId: socket.id, 
        customerId: customerId, 
        conversationId: conversation.id 
      });
      
      // Notify all agents about the new customer
      io.to('agents').emit('new_customer', { 
        customerId: customerId, 
        customerName: name, 
        message: 'New customer joined', 
        conversationId: conversation.id 
      });
    } catch (error) {
      console.error('Error handling customer join:', error);
    }
  });

  socket.on('agent_join', (data) => {
    const agentName = data.name || 'Unknown Agent';
    console.log(`👨‍💼 AGENT JOIN: ${agentName} on socket ${socket.id}`);
    
    // Store agent information
    activeAgents.set(socket.id, { 
      id: socket.id, 
      name: agentName, 
      status: 'available', 
      currentCustomerId: null 
    });
    
    console.log(`📊 Active agents count is now: ${activeAgents.size}`);
    
    // Join the agents room
    socket.join('agents');
    
    // Send confirmation to agent
    socket.emit('agent_connected', { status: 'connected' });
    
    // Update all clients with agent count
    io.emit('agent_status', { agentCount: activeAgents.size });
  });

  socket.on('customer_message', async (data) => {
    const { message, customerName, customerId } = data;
    console.log(`💬 CUSTOMER MESSAGE from ${customerName} (${customerId}): "${message}"`);
    
    try {
      // Find or create conversation
      const conversationResult = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'',
        [customerId]
      );
      
      let conversation;
      if (conversationResult.rows.length === 0) {
        const insertResult = await pool.query(
          `INSERT INTO conversations (id, customer_id, customer_name, status) 
           VALUES ($1, $2, $3, 'active') RETURNING *`,
          [uuidv4(), customerId, customerName]
        );
        conversation = insertResult.rows[0];
      } else {
        conversation = conversationResult.rows[0];
      }
      
      // Save the customer message
      await pool.query(
        `INSERT INTO messages (id, conversation_id, sender, sender_id, type, content) 
         VALUES ($1, $2, $3, $4, 'user', $5)`,
        [uuidv4(), conversation.id, customerName, customerId, message]
      );
      
      // Update conversation with last message info
      await pool.query(
        'UPDATE conversations SET last_message = $1, last_message_time = CURRENT_TIMESTAMP WHERE id = $2',
        [message, conversation.id]
      );
      
      // Send message to all agents
      io.to('agents').emit('new_message', { 
        customerId: customerId, 
        sender: customerName, 
        text: message, 
        conversationId: conversation.id, 
        timestamp: new Date() 
      });
      
      // If there's an assigned agent, send directly to them
      if (conversation.agent_id) {
        console.log(`-> Message routed to agent ${conversation.agent_id}.`);
        return;
      }
      
      // Otherwise, get bot response
      try {
        const response = await axios.post("https://api.openai.com/v1/chat/completions", { 
          model: "gpt-4o-mini", 
          messages: [
            { role: "system", content: "You are a helpful assistant for Tushar Bhumkar Institute." }, 
            { role: "user", content: message }
          ], 
          max_tokens: 200, 
          temperature: 0.7 
        }, { 
          headers: { 
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 
            "Content-Type": "application/json" 
          } 
        });
        
        const botReply = response.data?.choices?.[0]?.message?.content || "I'm sorry, I can't help with that right now.";
        
        // Save bot message
        await pool.query(
          `INSERT INTO messages (id, conversation_id, sender, type, content) 
             VALUES ($1, $2, 'Bot', 'bot', $3)`,
          [uuidv4(), conversation.id, botReply]
        );
        
        // Update conversation with last message info
        await pool.query(
          'UPDATE conversations SET last_message = $1, last_message_time = CURRENT_TIMESTAMP WHERE id = $2',
          [botReply, conversation.id]
        );
        
        // Send bot response to customer
        io.to(`room_${customerId}`).emit('agent_message', { 
          text: botReply, 
          timestamp: new Date() 
        });
        
        // Also send to agents for visibility
        io.to('agents').emit('new_message', { 
          customerId: customerId, 
          sender: 'Bot', 
          text: botReply, 
          conversationId: conversation.id, 
          timestamp: new Date() 
        });
      } catch (error) { 
        console.error("OpenAI Error:", error.response?.data || error.message); 
        
        const errorMessage = "I'm experiencing technical difficulties. Please try again later.";
        
        // Save error message
        await pool.query(
          `INSERT INTO messages (id, conversation_id, sender, type, content) 
             VALUES ($1, $2, 'Bot', 'bot', $3)`,
          [uuidv4(), conversation.id, errorMessage]
        );
        
        // Send error message to customer
        io.to(`room_${customerId}`).emit('agent_message', { 
          text: errorMessage, 
          timestamp: new Date() 
        });
      }
    } catch (error) {
      console.error("Error handling customer message:", error);
    }
  });

  socket.on('agent_message', async (data) => {
    const { message, agentName, customerId } = data;
    console.log(`👨‍💼 AGENT MESSAGE from ${agentName} to ${customerId}: "${message}"`);
    
    try {
      // Find the conversation
      const conversationResult = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'',
        [customerId]
      );
      
      if (conversationResult.rows.length === 0) return;
      
      const conversation = conversationResult.rows[0];
      
      // Save the agent message
      await pool.query(
        `INSERT INTO messages (id, conversation_id, sender, sender_id, type, content) 
           VALUES ($1, $2, $3, $4, 'agent', $5)`,
        [uuidv4(), conversation.id, agentName, socket.id, message]
      );
      
      // Update conversation with last message info
      await pool.query(
        'UPDATE conversations SET last_message = $1, last_message_time = CURRENT_TIMESTAMP WHERE id = $2',
        [message, conversation.id]
      );
      
      // Send message to customer
      io.to(`room_${customerId}`).emit('agent_message', { 
        text: message, 
        timestamp: new Date() 
      });
      
      // Mark customer messages as read
      await pool.query(
        'UPDATE messages SET read_status = TRUE WHERE conversation_id = $1 AND type = \'user\' AND read_status = FALSE',
        [conversation.id]
      );
    } catch (error) {
      console.error("Error handling agent message:", error);
    }
  });

  socket.on('request_agent', async (data) => {
    const { customerId, customerName } = data;
    console.log(`\n🙋‍♂️ AGENT REQUEST RECEIVED from ${customerName} (${customerId})`);
    
    try {
      // Find the conversation
      const conversationResult = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'',
        [customerId]
      );
      
      if (conversationResult.rows.length === 0) {
        console.error('Conversation not found for customer:', customerId);
        return;
      }
      
      const conversation = conversationResult.rows[0];
      
      // Check if there's an available agent
      const availableAgent = Array.from(activeAgents.values()).find(agent => agent.status === 'available');
      
      if (!availableAgent) {
        console.log('❌ DECISION: No agents available. Queuing request.');
        
        // Update conversation status to queued
        await pool.query(
          'UPDATE conversations SET status = \'queued\' WHERE id = $1',
          [conversation.id]
        );
        
        // Check if request already exists in queue
        const requestExists = pendingAgentRequests.find(req => req.customerId === customerId);
        if (!requestExists) {
          pendingAgentRequests.push({ 
            customerId, 
            customerName, 
            conversationId: conversation.id,
            timestamp: new Date()
          });
        }
        
        // Notify all agents about the new request
        io.to('agents').emit('new_agent_request', { 
          customerId, 
          customerName,
          conversationId: conversation.id
        });
        
        // Notify customer that their request is queued
        io.to(`room_${customerId}`).emit('agent_request_queued', {
          message: 'Your request has been sent to the agent. Please wait while they connect.'
        });
        return;
      }
      
      // If an agent is available, connect them directly
      console.log(`✅ DECISION: Agent "${availableAgent.name}" is available. Connecting directly.`);
      const agentSocketId = availableAgent.id;
      
      // Update agent status to busy
      const agent = activeAgents.get(agentSocketId);
      agent.status = 'busy';
      agent.currentCustomerId = customerId;
      
      // Update conversation with agent info
      await pool.query(
        'UPDATE conversations SET agent_id = $1, agent_name = $2, status = \'active\' WHERE id = $3',
        [agentSocketId, agent.name, conversation.id]
      );
      
      // Notify agent to join customer room
      io.to(agentSocketId).emit('join_customer_room', { 
        customerId, 
        customerName, 
        message: `${customerName} is requesting assistance.`,
        conversationId: conversation.id
      });
      
      // Notify customer that agent is connecting
      io.to(`room_${customerId}`).emit('agent_is_connecting', { 
        message: 'An agent is connecting to your chat now...' 
      });
    } catch (error) {
      console.error("Error handling agent request:", error);
    }
  });

  socket.on('accept_customer_request', async (data) => {
    const { customerId } = data;
    const agent = activeAgents.get(socket.id);
    
    if (!agent) {
      console.log(`❌ Error: Agent with socket ${socket.id} not found.`);
      return;
    }
    
    try {
      console.log(`✅ Agent "${agent.name}" is accepting request from ${customerId}`);
      
      // Find and remove the request from the queue
      const requestIndex = pendingAgentRequests.findIndex(req => req.customerId === customerId);
      if (requestIndex > -1) {
        pendingAgentRequests.splice(requestIndex, 1);
      }
      
      // Find the conversation
      const conversationResult = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND status IN (\'active\', \'queued\')',
        [customerId]
      );
      
      if (conversationResult.rows.length === 0) {
        console.error('Conversation not found for customer:', customerId);
        return;
      }
      
      const conversation = conversationResult.rows[0];
      
      // Update agent status
      agent.status = 'busy';
      agent.currentCustomerId = customerId;
      
      // Update conversation with agent info
      await pool.query(
        'UPDATE conversations SET agent_id = $1, agent_name = $2, status = \'active\' WHERE id = $3',
        [socket.id, agent.name, conversation.id]
      );
      
      // Add system message about agent joining
      await pool.query(
        `INSERT INTO messages (id, conversation_id, sender, type, content) 
           VALUES ($1, $2, 'System', 'system', $3)`,
        [uuidv4(), conversation.id, `${agent.name} has joined the conversation`]
      );
      
      // Join the customer's room
      socket.join(`room_${customerId}`);
      
      // Notify customer that agent has joined
      io.to(`room_${customerId}`).emit('agent_joined', { 
        agentName: agent.name, 
        message: `${agent.name} has joined the conversation` 
      });
      
      // Notify agent dashboard to switch to this conversation
      socket.emit('switch_to_conversation', { 
        customerId,
        conversationId: conversation.id
      });
      
      // Send conversation history to agent
      const messagesResult = await pool.query(
        'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC',
        [conversation.id]
      );
      
      socket.emit('conversation_history', {
        customerId,
        conversationId: conversation.id,
        messages: messagesResult.rows
      });
    } catch (error) {
      console.error("Error accepting customer request:", error);
    }
  });

  socket.on('join_conversation', async (data) => {
    const { customerId, agentName } = data;
    console.log(`🔗 AGENT "${agentName}" is joining conversation with ${customerId}`);
    
    try {
      // Find the conversation
      const conversationResult = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND status IN (\'active\', \'queued\')',
        [customerId]
      );
      
      if (conversationResult.rows.length === 0) return;
      
      const conversation = conversationResult.rows[0];
      
      // Update agent status
      const agent = activeAgents.get(socket.id);
      if (agent) {
        agent.status = 'busy';
        agent.currentCustomerId = customerId;
      }
      
      // Update conversation with agent info
      await pool.query(
        'UPDATE conversations SET agent_id = $1, agent_name = $2, status = \'active\' WHERE id = $3',
        [socket.id, agentName, conversation.id]
      );
      
      // Add system message about agent joining
      await pool.query(
        `INSERT INTO messages (id, conversation_id, sender, type, content) 
           VALUES ($1, $2, 'System', 'system', $3)`,
        [uuidv4(), conversation.id, `${agentName} has joined the conversation`]
      );
      
      // Join the customer's room
      socket.join(`room_${customerId}`);
      
      // Notify customer that agent has joined
      io.to(`room_${customerId}`).emit('agent_joined', { 
        agentName: agentName, 
        message: `${agentName} has joined the conversation` 
      });
      
      // Send conversation history to agent
      const messagesResult = await pool.query(
        'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC',
        [conversation.id]
      );
      
      socket.emit('conversation_history', {
        customerId,
        conversationId: conversation.id,
        messages: messagesResult.rows
      });
    } catch (error) {
      console.error("Error joining conversation:", error);
    }
  });

  socket.on('typing_start', (data) => { 
    if (data.isAgent && data.customerId) { 
      io.to(`room_${data.customerId}`).emit('agent_typing', { typing: true }); 
    } else if (!data.isAgent) { 
      io.to('agents').emit('customer_typing', { typing: true, customerId: data.customerId }); 
    } 
  });
  
  socket.on('typing_stop', (data) => { 
    if (data.isAgent && data.customerId) { 
      io.to(`room_${data.customerId}`).emit('agent_typing', { typing: false }); 
    } else if (!data.isAgent) { 
      io.to('agents').emit('customer_typing', { typing: false, customerId: data.customerId }); 
    } 
  });

  socket.on('disconnect', async () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    
    // Handle agent disconnect
    if (activeAgents.has(socket.id)) {
      const agent = activeAgents.get(socket.id);
      console.log(`👨‍💼 AGENT LEAVE: "${agent.name}" has disconnected.`);
      
      // If agent was in a conversation, update the conversation
      if (agent.currentCustomerId) {
        try {
          const conversationResult = await pool.query(
            'SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'',
            [agent.currentCustomerId]
          );
          
          if (conversationResult.rows.length > 0) {
            const conversation = conversationResult.rows[0];
            
            // Add system message about agent leaving
            await pool.query(
              `INSERT INTO messages (id, conversation_id, sender, type, content) 
                 VALUES ($1, $2, 'System', 'system', $3)`,
              [uuidv4(), conversation.id, `${agent.name} has left the conversation`]
            );
            
            // Update conversation to remove agent
            await pool.query(
              'UPDATE conversations SET agent_id = NULL, agent_name = NULL WHERE id = $1',
              [conversation.id]
            );
            
            // Notify customer that agent has left
            io.to(`room_${agent.currentCustomerId}`).emit('agent_disconnected', {
              message: `${agent.name} has left the conversation`
            });
          }
        } catch (error) {
          console.error("Error handling agent disconnect:", error);
        }
      }
      
      activeAgents.delete(socket.id);
      console.log(`📊 Active agents count is now: ${activeAgents.size}`);
      io.emit('agent_status', { agentCount: activeAgents.size });
      return;
    }
    
    // Handle customer disconnect
    let disconnectedCustomerId = null;
    customerSockets.forEach((socketId, customerId) => { 
      if (socketId === socket.id) { 
        disconnectedCustomerId = customerId; 
        customerSockets.delete(customerId); 
        
        // Update conversation status
        pool.query(
          'UPDATE conversations SET status = \'closed\', end_time = CURRENT_TIMESTAMP WHERE customer_id = $1 AND status = \'active\'',
          [customerId]
        ).catch(err => console.error('Error updating conversation status:', err));
      } 
    });
    
    if (disconnectedCustomerId) { 
      console.log(`👤 CUSTOMER LEAVE: ${disconnectedCustomerId} has disconnected.`);
      
      // If the disconnected customer was the one the agent was talking to, make agent available again
      const agentWithCustomer = Array.from(activeAgents.values()).find(agent => agent.currentCustomerId === disconnectedCustomerId);
      if(agentWithCustomer) {
        agentWithCustomer.status = 'available';
        agentWithCustomer.currentCustomerId = null;
        console.log(`👨‍💼 Agent "${agentWithCustomer.name}" is now available.`);
      }
      
      io.to('agents').emit('customer_disconnected', { customerId: disconnectedCustomerId }); 
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔌 WebSocket server ready for real-time chat`);
  console.log(`🗄️ Connected to PostgreSQL for persistent storage`);
});
