const express = require("express");
const axios = require("axios");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
const { Pool } = require("pg"); // Import pg
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

// --- Neon PostgreSQL Connection ---
// It's recommended to use the connection string from an environment variable for security
const POSTGRES_URL = process.env.POSTGRES_URL || "postgresql://neondb_owner:npg_aE4iTqzeIWB3@ep-old-wind-a1j8s1aj-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const pool = new Pool({
  connectionString: POSTGRES_URL,
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error("PostgreSQL connection error:", err.stack);
  } else {
    console.log("✅ Connected to Neon PostgreSQL at:", res.rows[0].now);
  }
});

// --- Database Table Initialization ---
async function initDatabase() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        type VARCHAR(50) CHECK (type IN ('customer', 'agent')) NOT NULL,
        socket_id VARCHAR(255) UNIQUE,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create conversations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(50) CHECK (status IN ('active', 'waiting', 'closed')) DEFAULT 'active',
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP,
        last_message TEXT,
        last_message_time TIMESTAMP,
        subject VARCHAR(255)
      );
    `);

    // Create messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        sender_name VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        type VARCHAR(50) CHECK (type IN ('user', 'bot', 'agent', 'system')) NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("📊 Database tables are ready.");
  } catch (error) {
    console.error("Error initializing database tables:", error);
  }
}

// Call the initialization function
initDatabase();


app.use(cors());
app.use(express.json());

// Serve frontend files
// app.use(express.static("public"));

// Serve customer widget
// app.get("/customer-chat", (req, res) => {
//   res.sendFile(__dirname + "/public/customer-chat.html");
// });

// Serve agent dashboard
// app.get("/agent-dashboard", (req, res) => {
//   res.sendFile(__dirname + "/public/agent-dashboard.html");
// });

// Store active agents and conversations in memory
const activeAgents = new Map();
const customerRooms = new Map();

// Chat API
app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  const customerId = req.body.customerId;

  if (!userMessage) {
    return res.json({ reply: "Message is empty" });
  }

  let client;
  try {
    client = await pool.connect();
    // Find or create conversation
    let conversation;
    if (customerId) {
      const customerUserResult = await client.query('SELECT id FROM users WHERE socket_id = $1 AND type = \'customer\'', [customerId]);
      if (customerUserResult.rows.length > 0) {
        const conversationResult = await client.query(`
          SELECT * FROM conversations 
          WHERE customer_id = $1 AND status IN ('active', 'waiting') 
          ORDER BY start_time DESC 
          LIMIT 1
        `, [customerUserResult.rows[0].id]);
        if (conversationResult.rows.length > 0) {
          conversation = conversationResult.rows[0];
        }
      }
    }

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a helpful assistant for Tushar Bhumkar Institute." },
          { role: "user", content: userMessage }
        ],
        max_tokens: 200,
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const botReply = response.data?.choices?.[0]?.message?.content || "No response from AI";

    // Save messages to database if conversation exists
    if (conversation) {
      // Save user message
      await client.query(`
        INSERT INTO messages (conversation_id, sender_id, sender_name, content, type)
        VALUES ($1, $2, $3, $4, $5)
      `, [conversation.id, conversation.customer_id, "Customer", userMessage, "user"]);

      // Save bot reply
      await client.query(`
        INSERT INTO messages (conversation_id, sender_name, content, type)
        VALUES ($1, $2, $3, $4)
      `, [conversation.id, "Bot Assistant", botReply, "bot"]);

      // Update conversation with last message
      await client.query(`
        UPDATE conversations 
        SET last_message = $1, last_message_time = CURRENT_TIMESTAMP 
        WHERE id = $2
      `, [botReply, conversation.id]);
    }

    res.json({ reply: botReply });

  } catch (error) {
    console.error("Error in /chat endpoint:", error.response?.data || error.message);
    res.status(500).json({ reply: "AI failed to respond" });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// API to get conversation history for a customer
app.get("/api/conversations/:customerId", async (req, res) => {
  const client = await pool.connect();
  try {
    const customerId = req.params.customerId;
    const customerResult = await client.query('SELECT id FROM users WHERE socket_id = $1 AND type = \'customer\'', [customerId]);
    
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }
    const dbCustomerId = customerResult.rows[0].id;
    
    const conversationsResult = await client.query(`
      SELECT c.*, a.name as agent_name 
      FROM conversations c
      LEFT JOIN users a ON c.agent_id = a.id
      WHERE c.customer_id = $1
      ORDER BY c.start_time DESC
    `, [dbCustomerId]);
    
    const result = [];
    for (const conv of conversationsResult.rows) {
      const messagesResult = await client.query(`
        SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC
      `, [conv.id]);
      result.push({ conversation: conv, messages: messagesResult.rows });
    }
    
    res.json(result);
  } catch (error) {
    console.error("Error fetching conversation history:", error);
    res.status(500).json({ error: "Failed to fetch conversation history" });
  } finally {
    client.release();
  }
});

// API to get all active/waiting conversations for agents
app.get("/api/conversations", async (req, res) => {
  const client = await pool.connect();
  try {
    const conversationsResult = await client.query(`
      SELECT c.*, cu.name as customer_name, a.name as agent_name 
      FROM conversations c
      JOIN users cu ON c.customer_id = cu.id
      LEFT JOIN users a ON c.agent_id = a.id
      WHERE c.status IN ('active', 'waiting')
      ORDER BY c.last_message_time DESC NULLS LAST
    `);
    
    const result = [];
    for (const conv of conversationsResult.rows) {
      const messagesResult = await client.query(`
        SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT 10
      `, [conv.id]);
      result.push({ conversation: conv, messages: messagesResult.rows.reverse() });
    }
    
    res.json(result);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  } finally {
    client.release();
  }
});

// API to get full conversation details
app.get("/api/conversation/:conversationId", async (req, res) => {
  const client = await pool.connect();
  try {
    const conversationId = req.params.conversationId;
    
    const conversationResult = await client.query(`
      SELECT c.*, cu.name as customer_name, a.name as agent_name 
      FROM conversations c
      JOIN users cu ON c.customer_id = cu.id
      LEFT JOIN users a ON c.agent_id = a.id
      WHERE c.id = $1
    `, [conversationId]);
    
    if (conversationResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    
    const messagesResult = await client.query(`
      SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC
    `, [conversationId]);
    
    res.json({
      conversation: conversationResult.rows[0],
      messages: messagesResult.rows
    });
  } catch (error) {
    console.error("Error fetching conversation details:", error);
    res.status(500).json({ error: "Failed to fetch conversation details" });
  } finally {
    client.release();
  }
});

// --- WebSocket connection handling ---
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Customer joins
  socket.on('customer_join', async (data) => {
    const client = await pool.connect();
    try {
      const customerId = data.customerId || `customer_${socket.id}`;
      const roomName = `room_${customerId}`;
      
      // Find or create customer user
      let customerUserResult = await client.query('SELECT * FROM users WHERE socket_id = $1', [customerId]);
      let customerUser;
      
      if (customerUserResult.rows.length === 0) {
        const insertResult = await client.query(`
          INSERT INTO users (name, type, socket_id) 
          VALUES ($1, 'customer', $2) 
          RETURNING *
        `, [data.name || `Customer_${socket.id.slice(0, 6)}`, customerId]);
        customerUser = insertResult.rows[0];
      } else {
        customerUser = customerUserResult.rows[0];
        await client.query('UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = $1', [customerUser.id]);
      }
      
      // Find or create conversation
      let conversationResult = await client.query(`
        SELECT * FROM conversations 
        WHERE customer_id = $1 AND status IN ('active', 'waiting') 
        ORDER BY start_time DESC 
        LIMIT 1
      `, [customerUser.id]);
      
      let conversation;
      if (conversationResult.rows.length === 0) {
        const insertConvResult = await client.query(`
          INSERT INTO conversations (customer_id, status, subject) 
          VALUES ($1, 'waiting', 'Customer Support') 
          RETURNING *
        `, [customerUser.id]);
        conversation = insertConvResult.rows[0];
        
        await client.query(`
          INSERT INTO messages (conversation_id, sender_id, sender_name, content, type)
          VALUES ($1, $2, 'System', 'Conversation started', 'system')
        `, [conversation.id, customerUser.id]);
      } else {
        conversation = conversationResult.rows[0];
      }
      
      // Customer joins their own room
      socket.join(roomName);
      customerRooms.set(customerId, {
        socketId: socket.id,
        userId: customerUser.id,
        name: data.name || `Customer_${socket.id.slice(0, 6)}`,
        room: roomName,
        joinedAt: new Date(),
        conversationId: conversation.id
      });
      
      socket.emit('connection_status', { 
        status: 'connected', 
        socketId: socket.id,
        customerId: customerId,
        conversationId: conversation.id
      });
      
      // Notify all agents about new customer
      socket.broadcast.emit('new_customer', {
        customerId: customerId,
        customerName: data.name || `Customer_${socket.id.slice(0, 6)}`,
        message: 'New customer joined',
        socketId: socket.id,
        conversationId: conversation.id
      });
      
    } catch (error) {
      console.error("Error in customer_join:", error);
    } finally {
      client.release();
    }
  });

  // Agent joins
  socket.on('agent_join', async (data) => {
    const client = await pool.connect();
    try {
      let agentUserResult = await client.query('SELECT * FROM users WHERE name = $1 AND type = \'agent\'', [data.name]);
      let agentUser;
      
      if (agentUserResult.rows.length === 0) {
        const insertResult = await client.query(`
          INSERT INTO users (name, type, socket_id) 
          VALUES ($1, 'agent', $2) 
          RETURNING *
        `, [data.name, socket.id]);
        agentUser = insertResult.rows[0];
      } else {
        agentUser = agentUserResult.rows[0];
        await client.query('UPDATE users SET socket_id = $1, last_active = CURRENT_TIMESTAMP WHERE id = $2', [socket.id, agentUser.id]);
      }
      
      activeAgents.set(socket.id, {
        id: socket.id,
        userId: agentUser.id,
        name: data.name,
        status: 'online',
        joinedAt: new Date()
      });
      
      socket.join('agents');
      socket.emit('agent_connected', { status: 'connected' });
      io.emit('agent_status', { agentCount: activeAgents.size });
      
    } catch (error) {
      console.error("Error in agent_join:", error);
    } finally {
      client.release();
    }
  });

  // Customer sends message
  socket.on('customer_message', async (data) => {
    const client = await pool.connect();
    try {
      const customerInfo = customerRooms.get(data.customerId || `customer_${socket.id}`);
      if (!customerInfo) return;

      const messageResult = await client.query(`
        INSERT INTO messages (conversation_id, sender_id, sender_name, content, type)
        VALUES ($1, $2, $3, $4, 'user')
        RETURNING *
      `, [customerInfo.conversationId, customerInfo.userId, data.customerName || customerInfo.name, data.message]);
      
      await client.query(`
        UPDATE conversations 
        SET last_message = $1, last_message_time = CURRENT_TIMESTAMP 
        WHERE id = $2
      `, [data.message, customerInfo.conversationId]);
      
      const messageData = {
        id: messageResult.rows[0].id,
        type: 'customer',
        text: data.message,
        sender: data.customerName || customerInfo.name,
        timestamp: messageResult.rows[0].timestamp,
        customerId: data.customerId || `customer_${socket.id}`,
        socketId: socket.id,
        conversationId: customerInfo.conversationId
      };

      io.to('agents').emit('new_message', messageData);
      socket.emit('message_sent', messageData);
      
    } catch (error) {
      console.error("Error in customer_message:", error);
    } finally {
      client.release();
    }
  });

  // Agent sends message
  socket.on('agent_message', async (data) => {
    const client = await pool.connect();
    try {
      const agentInfo = activeAgents.get(socket.id);
      const customerInfo = customerRooms.get(data.customerId);
      
      if (!agentInfo || !customerInfo) return;
      
      const messageResult = await client.query(`
        INSERT INTO messages (conversation_id, sender_id, sender_name, content, type)
        VALUES ($1, $2, $3, $4, 'agent')
        RETURNING *
      `, [customerInfo.conversationId, agentInfo.userId, data.agentName || agentInfo.name, data.message]);
      
      await client.query(`
        UPDATE conversations 
        SET agent_id = $1, status = 'active', last_message = $2, last_message_time = CURRENT_TIMESTAMP 
        WHERE id = $3
      `, [agentInfo.userId, data.message, customerInfo.conversationId]);
      
      const messageData = {
        id: messageResult.rows[0].id,
        type: 'agent',
        text: data.message,
        sender: data.agentName || agentInfo.name,
        timestamp: messageResult.rows[0].timestamp,
        agentId: socket.id,
        customerId: data.customerId,
        conversationId: customerInfo.conversationId
      };
      
      io.to(customerInfo.room).emit('agent_message', messageData);
      socket.emit('message_sent', messageData);
      
    } catch (error) {
      console.error("Error in agent_message:", error);
    } finally {
      client.release();
    }
  });
  
  // Agent joins customer conversation
  socket.on('join_conversation', async (data) => {
    const client = await pool.connect();
    try {
      const agentInfo = activeAgents.get(socket.id);
      const customerInfo = customerRooms.get(data.customerId);
      
      if (customerInfo && agentInfo) {
        socket.join(customerInfo.room);
        
        await client.query(`
          UPDATE conversations 
          SET agent_id = $1, status = 'active' 
          WHERE id = $2
        `, [agentInfo.userId, customerInfo.conversationId]);
        
        await client.query(`
          INSERT INTO messages (conversation_id, sender_id, sender_name, content, type)
          VALUES ($1, $2, 'System', $3, 'system')
        `, [customerInfo.conversationId, agentInfo.userId, `${data.agentName} has joined the conversation`]);
        
        io.to(customerInfo.room).emit('agent_joined', {
          agentName: data.agentName,
          message: `${data.agentName} has joined the conversation`
        });
      }
    } catch(error) {
      console.error("Error in join_conversation:", error);
    } finally {
      client.release();
    }
  });

  // Handle typing indicators
  socket.on('typing_start', (data) => {
    if (data.isAgent && data.customerId) {
      const customerInfo = customerRooms.get(data.customerId);
      if (customerInfo) {
        io.to(customerInfo.room).emit('agent_typing', { typing: true });
      }
    } else if (!data.isAgent) {
      io.to('agents').emit('customer_typing', { 
        typing: true, 
        customerId: data.customerId || `customer_${socket.id}`
      });
    }
  });

  socket.on('typing_stop', (data) => {
    if (data.isAgent && data.customerId) {
      const customerInfo = customerRooms.get(data.customerId);
      if (customerInfo) {
        io.to(customerInfo.room).emit('agent_typing', { typing: false });
      }
    } else if (!data.isAgent) {
      io.to('agents').emit('customer_typing', { 
        typing: false, 
        customerId: data.customerId || `customer_${socket.id}`
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    const client = await pool.connect();
    try {
      // Remove from active agents
      if (activeAgents.has(socket.id)) {
        const agentInfo = activeAgents.get(socket.id);
        activeAgents.delete(socket.id);
        await client.query('UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = $1', [agentInfo.userId]);
        io.emit('agent_status', { agentCount: activeAgents.size });
      }
      
      // Find and remove customer
      let disconnectedCustomerId = null;
      let disconnectedCustomerInfo = null;
      
      customerRooms.forEach((customer, customerId) => {
        if (customer.socketId === socket.id) {
          disconnectedCustomerId = customerId;
          disconnectedCustomerInfo = customer;
          customerRooms.delete(customerId);
        }
      });
      
      if (disconnectedCustomerId) {
        await client.query('UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = $1', [disconnectedCustomerInfo.userId]);
        await client.query(`
          INSERT INTO messages (conversation_id, sender_id, sender_name, content, type)
          VALUES ($1, $2, 'System', 'Customer disconnected', 'system')
        `, [disconnectedCustomerInfo.conversationId, disconnectedCustomerInfo.userId]);
        
        socket.broadcast.emit('customer_disconnected', { customerId: disconnectedCustomerId });
      }
    } catch (error) {
      console.error("Error during disconnect:", error);
    } finally {
      client.release();
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📱 Customer Chat: https://chatbot-2-9lg8.onrender.com/customer-chat`);
  console.log(`👨‍💼 Agent Dashboard: https://chatbot-2-9lg8.onrender.com/agent-dashboard`);
  console.log(`🔌 WebSocket server ready for real-time chat`);
});

