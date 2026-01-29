
// =================================================================
// BACKEND WITH POSTGRESQL PERSISTENCE AND AGENT ASSOCIATION
// =================================================================

const express = require("express");
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
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_aE4iTqzeIWB3@ep-old-wind-a1j8s1aj-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  ssl: {
    rejectUnauthorized: false
  }
});

// Custom Bot Responses - Q&A Database
const botResponses = {
  greetings: {
    keywords: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'greetings'],
    response: "Hi! Welcome to Tushar Bhumkar Institute. How can I help you today?"
  },
  courses: {
    keywords: ['courses', 'course'],
    response: `• Basics – Nifty, stocks, and part-time intraday trading. /n
• Advanced – Discipline, risk management, and advanced strategies for serious traders`
  },
  basic_workshop: {
    keywords: ['basic', 'basics'],
    response: `**Basics Module**
This module provides complete training in Nifty, stocks, and part-time intraday trading, covering daily, weekly, and monthly trading approaches.
For more details about duration, fees, and schedule, type 'fees' or 'duration'.`
  },
  advanced_workshop: {
    keywords: ['advanced', 'advanced workshop'],
    response: `**Advanced Module**

This module is designed for part-time and full-time traders, especially those who are facing issues like overtrading, options traps, and losses in long-term investments.
It focuses on discipline, risk management, and advanced trading strategies.

For more details about duration, fees, and schedule, type 'fees' or 'duration'.`
  },
  online_offline: {
    keywords: ['online', 'offline', 'classroom', 'in-person', 'virtual', 'remote', 'live'],
    response: `For more Information Call 9272000111

Our institute offers both online and offline classes to suit your learning preferences.

Contact : 9272000111`
  },
  contact: {
    keywords: ['contact', 'phone', 'call', 'email', 'address', 'location', 'visit'],
    response: `Contact : 9272000111

Thank You For Contacting Us.`
  },

  bye: {
    keywords: ['bye', 'goodbye', 'thank you', 'thanks', 'see you', 'exit'],
    response: `Thank you for contacting Tushar Bhumkar Institute! 😊

📞 Feel free to call us at 9272000111 for any further assistance.

Have a great day! 🌟`
  },
  default: {
    keywords: [],
    response: `I understand you're interested in our courses. Here's how I can help`

}
};

// Helper function to extract actual UUID from customer ID
function extractCustomerId(customerId) {
  if (customerId && customerId.startsWith('customer_')) {
    return customerId.substring(9);
  }
  return customerId;
}

// Custom bot response function
function getBotResponse(message) {
  const lowerMessage = message.toLowerCase();
  
  // Check each category for keyword matches
  for (const [category, data] of Object.entries(botResponses)) {
    if (category === 'default') continue; // Skip default for now
    
    for (const keyword of data.keywords) {
      if (lowerMessage.includes(keyword)) {
        return data.response;
      }
    }
  }
  
  // Return default response if no match found
  return botResponses.default.response;
}

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create customers table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        mobile VARCHAR(20) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create conversations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id VARCHAR(255) PRIMARY KEY,
        customer_id UUID NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        customer_mobile VARCHAR(20),
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
      CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile)
    `);
    
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

// Create or update customer
app.post("/api/customer", async (req, res) => {
  try {
    const { name, mobile } = req.body;
    
    if (!name || !mobile) {
      return res.status(400).json({ error: "Name and mobile number are required" });
    }
    
    // Validate mobile number (10 digits)
    const mobileDigits = mobile.replace(/\D/g, '');
    if (mobileDigits.length !== 10) {
      return res.status(400).json({ error: "Invalid mobile number format" });
    }
    
    // Check if customer already exists
    const existingCustomer = await pool.query(
      'SELECT * FROM customers WHERE mobile = $1',
      [mobileDigits]
    );
    
    let customer;
    if (existingCustomer.rows.length > 0) {
      // Update existing customer
      const updateResult = await pool.query(
        'UPDATE customers SET name = $1, last_seen = CURRENT_TIMESTAMP WHERE mobile = $2 RETURNING *',
        [name, mobileDigits]
      );
      customer = updateResult.rows[0];
    } else {
      // Create new customer
      const insertResult = await pool.query(
        `INSERT INTO customers (id, name, mobile, created_at, last_seen) 
         VALUES (gen_random_uuid(), $1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
        [name, mobileDigits]
      );
      customer = insertResult.rows[0];
    }
    
    res.json({
      success: true,
      customer: {
        id: customer.id,
        name: customer.name,
        mobile: customer.mobile
      }
    });
  } catch (error) {
    console.error("Error creating/updating customer:", error);
    res.status(500).json({ error: "Failed to save customer information" });
  }
});

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
    const actualCustomerId = extractCustomerId(req.params.customerId);
    const conversationsResult = await pool.query(
      'SELECT * FROM conversations WHERE customer_id = $1 ORDER BY start_time DESC',
      [actualCustomerId]
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

// Get all active agents
app.get("/api/agents", (req, res) => {
  const agents = Array.from(activeAgents.values()).map(agent => ({
    id: agent.id,
    name: agent.name,
    status: agent.status,
    currentCustomerId: agent.currentCustomerId
  }));
  
  res.json(agents);
});

// --- WebSocket Connection Handling ---

io.on('connection', (socket) => {
  console.log('🌐 New client connected:', socket.id);

  socket.on('customer_join', async (data) => {
    const { name, mobile, customerId } = data;
    const actualCustomerId = extractCustomerId(customerId);
    
    console.log(`👤 CUSTOMER JOIN: ${name} (${mobile}) (${customerId}) on socket ${socket.id}`);
    customerSockets.set(customerId, socket.id);
    
    try {
      // Check if there's an existing active conversation
      const conversationResult = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'',
        [actualCustomerId]
      );
      
      let conversation;
      if (conversationResult.rows.length === 0) {
        // Create a new conversation
        const insertResult = await pool.query(
          `INSERT INTO conversations (id, customer_id, customer_name, customer_mobile, status) 
           VALUES ($1, $2, $3, $4, 'active') RETURNING *`,
          [uuidv4(), actualCustomerId, name, mobile]
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
        customerMobile: mobile,
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
    const actualCustomerId = extractCustomerId(customerId);
    
    console.log(`💬 CUSTOMER MESSAGE from ${customerName} (${customerId}): "${message}"`);
    
    try {
      // Find or create conversation
      const conversationResult = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'',
        [actualCustomerId]
      );
      
      let conversation;
      if (conversationResult.rows.length === 0) {
        const insertResult = await pool.query(
          `INSERT INTO conversations (id, customer_id, customer_name, status) 
           VALUES ($1, $2, $3, 'active') RETURNING *`,
          [uuidv4(), actualCustomerId, customerName]
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
      
      // Otherwise, get custom bot response
      const botReply = getBotResponse(message);
      
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
      console.error("Error handling customer message:", error);
    }
  });

  socket.on('agent_message', async (data) => {
    const { message, agentName, customerId } = data;
    const actualCustomerId = extractCustomerId(customerId);
    
    console.log(`👨‍💼 AGENT MESSAGE from ${agentName} to ${customerId}: "${message}"`);
    
    try {
      // Find the conversation
      const conversationResult = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'',
        [actualCustomerId]
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
    const actualCustomerId = extractCustomerId(customerId);
    
    console.log(`\n🙋‍♂️ AGENT REQUEST RECEIVED from ${customerName} (${customerId})`);
    
    try {
      // Find the conversation
      const conversationResult = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'',
        [actualCustomerId]
      );
      
      if (conversationResult.rows.length === 0) return;
      
      const conversation = conversationResult.rows[0];
      
      // Update conversation status to queued
      await pool.query(
        'UPDATE conversations SET status = \'queued\' WHERE id = $1',
        [conversation.id]
      );
      
      // Add system message
      await pool.query(
        `INSERT INTO messages (id, conversation_id, sender, type, content) 
         VALUES ($1, $2, 'System', 'system', 'Customer requested to speak with an agent')`,
        [uuidv4(), conversation.id]
      );
      
      // Find an available agent
      const availableAgent = Array.from(activeAgents.values()).find(
        agent => agent.status === 'available'
      );
      
      if (availableAgent) {
        console.log(`✅ Found available agent: ${availableAgent.name} (${availableAgent.id})`);
        
        // Assign agent to conversation
        await pool.query(
          'UPDATE conversations SET agent_id = $1, agent_name = $2, status = \'active\' WHERE id = $3',
          [availableAgent.id, availableAgent.name, conversation.id]
        );
        
        // Update agent status
        const agentData = activeAgents.get(availableAgent.id);
        activeAgents.set(availableAgent.id, {
          ...agentData,
          status: 'busy',
          currentCustomerId: customerId
        });
        
        // Notify agent
        io.to(availableAgent.id).emit('agent_assignment', {
          customerId,
          customerName,
          conversationId: conversation.id
        });
        
        // Notify customer
        io.to(`room_${customerId}`).emit('agent_joined', {
          agentName: availableAgent.name,
          message: `${availableAgent.name} has joined the chat`
        });
        
        // Notify all agents about the assignment
        io.to('agents').emit('agent_assigned', {
          agentId: availableAgent.id,
          agentName: availableAgent.name,
          customerId,
          customerName
        });
      } else {
        console.log(`❌ No available agents. Adding to queue.`);
        
        // Add to pending requests
        pendingAgentRequests.push({
          customerId,
          customerName,
          conversationId: conversation.id,
          timestamp: new Date()
        });
        
        // Notify customer they're in queue
        io.to(`room_${customerId}`).emit('queue_status', {
          status: 'queued',
          message: 'All agents are currently busy. You\'ll be connected to the next available agent.',
          position: pendingAgentRequests.length
        });
        
        // Notify all agents about the queue
        io.to('agents').emit('customer_queued', {
          customerId,
          customerName,
          queuePosition: pendingAgentRequests.length
        });
      }
    } catch (error) {
      console.error("Error handling agent request:", error);
    }
  });

  socket.on('accept_customer', async (data) => {
    const { customerId, customerName, conversationId } = data;
    const actualCustomerId = extractCustomerId(customerId);
    const agentId = socket.id;
    const agentData = activeAgents.get(agentId);
    
    if (!agentData) return;
    
    console.log(`👨‍💼 AGENT ${agentData.name} (${agentId}) ACCEPTED customer ${customerName} (${customerId})`);
    
    try {
      // Update conversation with agent info
      await pool.query(
        'UPDATE conversations SET agent_id = $1, agent_name = $2, status = \'active\' WHERE id = $3',
        [agentId, agentData.name, conversationId]
      );
      
      // Update agent status
      activeAgents.set(agentId, {
        ...agentData,
        status: 'busy',
        currentCustomerId: customerId
      });
      
      // Remove from pending requests if present
      const requestIndex = pendingAgentRequests.findIndex(
        req => req.customerId === customerId
      );
      
      if (requestIndex !== -1) {
        pendingAgentRequests.splice(requestIndex, 1);
        
        // Update queue positions for remaining requests
        pendingAgentRequests.forEach((req, index) => {
          io.to(`room_${req.customerId}`).emit('queue_status', {
            status: 'queued',
            message: 'All agents are currently busy. You\'ll be connected to the next available agent.',
            position: index + 1
          });
        });
      }
      
      // Add system message
      await pool.query(
        `INSERT INTO messages (id, conversation_id, sender, type, content) 
         VALUES ($1, $2, 'System', 'system', 'Agent joined the conversation')`,
        [uuidv4(), conversationId]
      );
      
      // Notify customer
      io.to(`room_${customerId}`).emit('agent_joined', {
        agentName: agentData.name,
        message: `${agentData.name} has joined the chat`
      });
      
      // Notify all agents about the assignment
      io.to('agents').emit('agent_assigned', {
        agentId,
        agentName: agentData.name,
        customerId,
        customerName
      });
      
      // Send conversation history to agent
      const messagesResult = await pool.query(
        'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC',
        [conversationId]
      );
      
      socket.emit('conversation_history', {
        conversationId,
        customerId,
        customerName,
        messages: messagesResult.rows
      });
    } catch (error) {
      console.error("Error accepting customer:", error);
    }
  });

  socket.on('end_conversation', async (data) => {
    const { customerId, conversationId } = data;
    const actualCustomerId = extractCustomerId(customerId);
    const agentData = activeAgents.get(socket.id);
    
    if (!agentData) return;
    
    console.log(`🔚 ENDING CONVERSATION between agent ${agentData.name} and customer ${customerId}`);
    
    try {
      // Update conversation status
      await pool.query(
        'UPDATE conversations SET status = \'closed\', end_time = CURRENT_TIMESTAMP WHERE id = $1',
        [conversationId]
      );
      
      // Add system message
      await pool.query(
        `INSERT INTO messages (id, conversation_id, sender, type, content) 
         VALUES ($1, $2, 'System', 'system', 'Conversation ended')`,
        [uuidv4(), conversationId]
      );
      
      // Update agent status to available
      activeAgents.set(socket.id, {
        ...agentData,
        status: 'available',
        currentCustomerId: null
      });
      
      // Notify customer
      io.to(`room_${customerId}`).emit('conversation_ended', {
        message: 'Your conversation has been ended. Thank you for chatting with us!',
        showFeedback: true
      });
      
      // Notify all agents
      io.to('agents').emit('conversation_ended', {
        agentId: socket.id,
        customerId,
        conversationId
      });
      
      // Check if there are pending customers in queue
      if (pendingAgentRequests.length > 0) {
        const nextRequest = pendingAgentRequests.shift();
        
        // Update queue positions for remaining requests
        pendingAgentRequests.forEach((req, index) => {
          io.to(`room_${req.customerId}`).emit('queue_status', {
            status: 'queued',
            message: 'All agents are currently busy. You\'ll be connected to the next available agent.',
            position: index + 1
          });
        });
        
        // Assign this agent to the next customer
        await pool.query(
          'UPDATE conversations SET agent_id = $1, agent_name = $2, status = \'active\' WHERE id = $3',
          [socket.id, agentData.name, nextRequest.conversationId]
        );
        
        // Update agent status
        activeAgents.set(socket.id, {
          ...agentData,
          status: 'busy',
          currentCustomerId: nextRequest.customerId
        });
        
        // Notify agent
        socket.emit('agent_assignment', {
          customerId: nextRequest.customerId,
          customerName: nextRequest.customerName,
          conversationId: nextRequest.conversationId
        });
        
        // Notify customer
        io.to(`room_${nextRequest.customerId}`).emit('agent_joined', {
          agentName: agentData.name,
          message: `${agentData.name} has joined the chat`
        });
        
        // Notify all agents about the assignment
        io.to('agents').emit('agent_assigned', {
          agentId: socket.id,
          agentName: agentData.name,
          customerId: nextRequest.customerId,
          customerName: nextRequest.customerName
        });
      }
    } catch (error) {
      console.error("Error ending conversation:", error);
    }
  });

  socket.on('typing', (data) => {
    const { customerId, isTyping } = data;
    const actualCustomerId = extractCustomerId(customerId);
    const agentData = activeAgents.get(socket.id);
    
    if (agentData) {
      // Agent is typing, notify customer
      io.to(`room_${customerId}`).emit('typing_indicator', {
        sender: agentData.name,
        isTyping
      });
    } else {
      // Customer is typing, notify their assigned agent
      pool.query(
        'SELECT agent_id FROM conversations WHERE customer_id = $1 AND status = \'active\'',
        [actualCustomerId]
      ).then(result => {
        if (result.rows.length > 0 && result.rows[0].agent_id) {
          io.to(result.rows[0].agent_id).emit('typing_indicator', {
            sender: 'Customer',
            isTyping
          });
        }
      }).catch(err => console.error('Error fetching agent for typing indicator:', err));
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
    
    // Check if it's an agent
    const agentData = activeAgents.get(socket.id);
    if (agentData) {
      console.log(`👨‍💼 Agent ${agentData.name} disconnected`);
      
      // If agent was in a conversation, handle it
      if (agentData.currentCustomerId) {
        const customerId = agentData.currentCustomerId;
        const actualCustomerId = extractCustomerId(customerId);
        
        // Update conversation
        pool.query(
          'UPDATE conversations SET agent_id = NULL, agent_name = NULL, status = \'queued\' WHERE customer_id = $1 AND status = \'active\'',
          [actualCustomerId]
        ).then(() => {
          // Add system message
          return pool.query(
            'SELECT id FROM conversations WHERE customer_id = $1 AND status = \'queued\' ORDER BY start_time DESC LIMIT 1',
            [actualCustomerId]
          );
        }).then(result => {
          if (result.rows.length > 0) {
            return pool.query(
              `INSERT INTO messages (id, conversation_id, sender, type, content) 
               VALUES ($1, $2, 'System', 'system', 'Agent disconnected. You have been re-queued for the next available agent.')`,
              [uuidv4(), result.rows[0].id]
            );
          }
        }).then(() => {
          // Notify customer
          io.to(`room_${customerId}`).emit('agent_disconnected', {
            message: 'The agent has disconnected. You have been placed back in the queue.',
            requeued: true
          });
          
          // Add to pending requests
          const customerName = agentData.currentCustomerId;
          pendingAgentRequests.push({
            customerId,
            customerName,
            timestamp: new Date()
          });
          
          // Notify all agents
          io.to('agents').emit('agent_disconnected', {
            agentId: socket.id,
            agentName: agentData.name,
            customerId
          });
        }).catch(err => console.error('Error handling agent disconnect:', err));
      }
      
      // Remove from active agents
      activeAgents.delete(socket.id);
      
      // Update agent count
      io.emit('agent_status', { agentCount: activeAgents.size });
    }
    
    // Check if it's a customer
    let customerId = null;
    for (const [id, socketId] of customerSockets.entries()) {
      if (socketId === socket.id) {
        customerId = id;
        break;
      }
    }
    
    if (customerId) {
      const actualCustomerId = extractCustomerId(customerId);
      console.log(`👤 Customer ${customerId} disconnected`);
      
      // Update customer last seen
      pool.query(
        'UPDATE customers SET last_seen = CURRENT_TIMESTAMP WHERE id = $1',
        [actualCustomerId]
      ).catch(err => console.error('Error updating customer last seen:', err));
      
      // Update conversation
      pool.query(
        'UPDATE conversations SET status = \'closed\', end_time = CURRENT_TIMESTAMP WHERE customer_id = $1 AND status = \'active\'',
        [actualCustomerId]
      ).then(() => {
        // Add system message
        return pool.query(
          'SELECT id FROM conversations WHERE customer_id = $1 ORDER BY start_time DESC LIMIT 1',
          [actualCustomerId]
        );
      }).then(result => {
        if (result.rows.length > 0) {
          return pool.query(
            `INSERT INTO messages (id, conversation_id, sender, type, content) 
             VALUES ($1, $2, 'System', 'system', 'Customer disconnected')`,
            [uuidv4(), result.rows[0].id]
          );
        }
      }).then(() => {
        // Find the agent for this customer
        const agentEntry = Array.from(activeAgents.entries()).find(
          ([id, data]) => data.currentCustomerId === customerId
        );
        
        if (agentEntry) {
          const [agentId, agentData] = agentEntry;
          
          // Update agent status to available
          activeAgents.set(agentId, {
            ...agentData,
            status: 'available',
            currentCustomerId: null
          });
          
          // Notify agent
          io.to(agentId).emit('customer_disconnected', {
            customerId,
            message: 'Customer has disconnected'
          });
          
          // Check if there are pending customers in queue
          if (pendingAgentRequests.length > 0) {
            const nextRequest = pendingAgentRequests.shift();
            
            // Update queue positions for remaining requests
            pendingAgentRequests.forEach((req, index) => {
              io.to(`room_${req.customerId}`).emit('queue_status', {
                status: 'queued',
                message: 'All agents are currently busy. You\'ll be connected to the next available agent.',
                position: index + 1
              });
            });
            
            // Assign this agent to the next customer
            pool.query(
              'UPDATE conversations SET agent_id = $1, agent_name = $2, status = \'active\' WHERE id = $3',
              [agentId, agentData.name, nextRequest.conversationId]
            ).then(() => {
              // Update agent status
              activeAgents.set(agentId, {
                ...agentData,
                status: 'busy',
                currentCustomerId: nextRequest.customerId
              });
              
              // Notify agent
              io.to(agentId).emit('agent_assignment', {
                customerId: nextRequest.customerId,
                customerName: nextRequest.customerName,
                conversationId: nextRequest.conversationId
              });
              
              // Notify customer
              io.to(`room_${nextRequest.customerId}`).emit('agent_joined', {
                agentName: agentData.name,
                message: `${agentData.name} has joined the chat`
              });
              
              // Notify all agents about the assignment
              io.to('agents').emit('agent_assigned', {
                agentId,
                agentName: agentData.name,
                customerId: nextRequest.customerId,
                customerName: nextRequest.customerName
              });
            }).catch(err => console.error('Error assigning next customer after disconnect:', err));
          }
        }
        
        // Notify all agents
        io.to('agents').emit('customer_disconnected', {
          customerId
        });
      }).catch(err => console.error('Error handling customer disconnect:', err));
      
      // Remove from customer sockets
      customerSockets.delete(customerId);
    }
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});






