// =================================================================
// BACKEND WITH POSTGRESQL PERSISTENCE, AGENT ASSOCIATION & DUAL LANGUAGE
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

// Custom Bot Responses - Q&A Database (Dual Language: en = English, mr = Marathi)
const botResponses = {
  greetings: {
    keywords: ['hello', 'hi', 'hey', 'good morning', 'namaste', 'नमस्कार'],
    en: "Hi! Welcome to Tushar Bhumkar Institute. How can I help you today?",
    mr: "नमस्कार! तुषार भुमकर इन्स्टिट्यूटमध्ये आपले स्वागत आहे. मी आपली कशी मदत करू शकतो?"
  },
  courses: {
    keywords: ['courses', 'course', 'कोर्सेस', 'कोर्स', 'details'],
    en: `• Basics – Nifty, stocks, and part-time intraday trading.
• Advanced – Discipline, risk management, and advanced strategies for serious traders.`,
    mr: `• Basics – निफ्टी आणि पार्ट-टाईम इंट्राडे ट्रेडिंग
• Advanced – फुल टाइम ट्रेडर्स साठी , शिस्त, रिस्क मॅनेजमेंट आणि सिरीयस  ऍडवान्सड  ट्रेडर्ससाठी  स्ट्रॅटेजीज`
  },
  basic_workshop: {
    keywords: ['basic', 'basics', 'बेसिक', 'सुरुवात'],
    en: `**Basics Module**
This module provides complete training in Nifty, stocks, and part-time intraday trading, covering daily, weekly, and monthly trading approaches.`,
    mr: `**बेसिक्स मॉड्यूल**
या मॉड्यूलमध्ये निफ्टी, पार्ट-टाईम इंट्राडे ट्रेडिंगचे संपूर्ण प्रशिक्षण दिले जाते.
यामध्ये डेली, वीकली आणि मंथली ट्रेडिंग पद्धतींचा समावेश आहे.`
  },
  advanced_workshop: {
    keywords: ['advanced', 'advanced workshop', 'अडव्हान्सड', 'पुढे'],
    en: `**Advanced Module**
This module is designed for part-time and full-time traders. It focuses on discipline, risk management, and advanced trading strategies.`,
    mr: `**अॅडव्हान्स्ड मॉड्यूल**
हे मॉड्यूल पार्ट-टाईम आणि फुल-टाईम ट्रेडर्ससाठी डिझाइन केलेले आहे.
यामध्ये शिस्त, रिस्क मॅनेजमेंट आणि अॅडव्हान्सड ट्रेडिंग स्ट्रॅटेजीजवर भर दिला जातो.`
  },
  online_offline: {
    keywords: ['online', 'offline', 'classroom', 'in-person', 'virtual', 'remote', 'live', 'ऑनलाइन', 'ऑफलाइन', 'क्लासरूम'],
    en: `For more Information Call 9272000111
Our institute offers both online and offline classes.`,
    mr: `अधिक माहितीसाठी कृपया कॉल करा: 9272000111
आमच्याशी संपर्क केल्याबद्दल धन्यवाद`
  },
  contact: {
    keywords: ['contact', 'phone', 'call', 'email', 'address', 'location', 'visit', 'संपर्क', 'कॉल', 'फोन', 'माहिती'],
    en: `Contact : 9272000111
Thank You For Contacting Us.`,
    mr: `Contact : 9272000111
आमच्याशी संपर्क केल्याबद्दल धन्यवाद`
  },
  bye: {
    keywords: ['bye', 'goodbye', 'thank you', 'thanks', 'see you', 'exit', 'धन्यवाद', 'नमस्कार', 'बाय'],
    en: `Thank you for contacting Tushar Bhumkar Institute! Call us at 9272000111 for any further assistance.`,
    mr: `आमच्याशी संपर्क केल्याबद्दल धन्यवाद!
कोणतीही अधिक मदत हवी असल्यास कृपया 9272000111 वर कॉल करा.`
  },
  default: {
    keywords: [],
    en: "I understand you're interested in our courses. How can I help?",
    mr: "मला कळले की आपल्याला आमच्या कोर्सेंबद्दल माहिती हवी आहे. याप्रमाणे मी मदत करू शकतो"
  }
};

// Helper function to extract actual UUID from customer ID
function extractCustomerId(customerId) {
  if (customerId && customerId.startsWith('customer_')) {
    return customerId.substring(9);
  }
  return customerId;
}

// Custom bot response function (Now supports language)
function getBotResponse(message, lang = 'en') {
  const lowerMessage = message.toLowerCase();
  
  for (const [category, data] of Object.entries(botResponses)) {
    if (category === 'default') continue;
    
    for (const keyword of data.keywords) {
      if (lowerMessage.includes(keyword)) {
        // Return the specific language version, fallback to English if missing
        return data[lang] || data['en']; 
      }
    }
  }
  
  // Return default response in specific language
  return botResponses.default[lang] || botResponses.default['en'];
}

// Initialize database tables
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        mobile VARCHAR(20) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

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

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_conversations_customer_id ON conversations(customer_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)`);

    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  }
}

initializeDatabase();

app.use(cors());
app.use(express.json());

const activeAgents = new Map();
const customerSockets = new Map();
const pendingAgentRequests = [];

// --- HTTP API Endpoints ---

// Create or update customer
app.post("/api/customer", async (req, res) => {
  try {
    const { name, mobile } = req.body;
    if (!name || !mobile) return res.status(400).json({ error: "Name and mobile number are required" });
    
    const mobileDigits = mobile.replace(/\D/g, '');
    if (mobileDigits.length !== 10) return res.status(400).json({ error: "Invalid mobile number format" });
    
    const existingCustomer = await pool.query('SELECT * FROM customers WHERE mobile = $1', [mobileDigits]);
    let customer;
    
    if (existingCustomer.rows.length > 0) {
      const updateResult = await pool.query('UPDATE customers SET name = $1, last_seen = CURRENT_TIMESTAMP WHERE mobile = $2 RETURNING *', [name, mobileDigits]);
      customer = updateResult.rows[0];
    } else {
      const insertResult = await pool.query(`INSERT INTO customers (id, name, mobile, created_at, last_seen) VALUES (gen_random_uuid(), $1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`, [name, mobileDigits]);
      customer = insertResult.rows[0];
    }
    res.json({ success: true, customer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/conversations", async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM conversations ORDER BY start_time DESC');
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get("/api/conversation/:conversationId", async (req, res) => {
  try {
    const conversationResult = await pool.query('SELECT * FROM conversations WHERE id = $1', [req.params.conversationId]);
    if (conversationResult.rows.length === 0) return res.status(404).json({ error: "Conversation not found" });
    
    const messagesResult = await pool.query('SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC', [req.params.conversationId]);
    res.json({ conversation: conversationResult.rows[0], messages: messagesResult.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get("/api/agent/:agentId/conversations", async (req, res) => {
  try {
    const conversationsResult = await pool.query('SELECT * FROM conversations WHERE agent_id = $1 AND status IN (\'active\', \'queued\') ORDER BY last_message_time DESC', [req.params.agentId]);
    const conversations = await Promise.all(conversationsResult.rows.map(async (conv) => {
      const unreadResult = await pool.query('SELECT COUNT(*) as unread_count FROM messages WHERE conversation_id = $1 AND type = \'user\' AND read_status = FALSE', [conv.id]);
      return { ...conv, unreadCount: parseInt(unreadResult.rows[0].unread_count) };
    }));
    res.json(conversations);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get("/api/customer/:customerId/conversations", async (req, res) => {
  try {
    const actualCustomerId = extractCustomerId(req.params.customerId);
    const conversationsResult = await pool.query('SELECT * FROM conversations WHERE customer_id = $1 ORDER BY start_time DESC', [actualCustomerId]);
    
    const result = await Promise.all(conversationsResult.rows.map(async (conv) => {
      const messagesResult = await pool.query('SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC', [conv.id]);
      return { conversation: conv, messages: messagesResult.rows };
    }));
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post("/api/conversation/:conversationId/feedback", async (req, res) => {
  try {
    const { rating, feedback } = req.body;
    const result = await pool.query('UPDATE conversations SET rating = $1, feedback = $2 WHERE id = $3 RETURNING *', [rating, feedback, req.params.conversationId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Conversation not found" });
    
    const conv = result.rows[0];
    if(conv.agent_id) {
       io.to(conv.agent_id).emit('feedback_submitted', { rating, feedback });
    }

    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get("/api/agents", (req, res) => {
  const agents = Array.from(activeAgents.values()).map(agent => ({ id: agent.id, name: agent.name, status: agent.status }));
  res.json(agents);
});

// --- WebSocket Connection Handling ---

io.on('connection', (socket) => {
  console.log('🌐 New client connected:', socket.id);

  socket.on('customer_join', async (data) => {
    const { name, mobile, customerId, lang = 'en' } = data; // Accept language
    const actualCustomerId = extractCustomerId(customerId);
    console.log(`👤 CUSTOMER JOIN: ${name} (${customerId}) - Lang: ${lang}`);
    customerSockets.set(customerId, socket.id);
    
    try {
      const conversationResult = await pool.query('SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'', [actualCustomerId]);
      let conversation;
      
      if (conversationResult.rows.length === 0) {
        const insertResult = await pool.query(`INSERT INTO conversations (id, customer_id, customer_name, customer_mobile, status) VALUES ($1, $2, $3, $4, 'active') RETURNING *`, [uuidv4(), actualCustomerId, name, mobile]);
        conversation = insertResult.rows[0];
      } else {
        conversation = conversationResult.rows[0];
      }
      
      await pool.query(`INSERT INTO messages (id, conversation_id, sender, type, content) VALUES ($1, $2, 'System', 'system', 'Customer joined the chat')`, [uuidv4(), conversation.id]);
      socket.join(`room_${customerId}`);
      
      socket.emit('connection_status', { status: 'connected', socketId: socket.id, customerId: customerId, conversationId: conversation.id, lang: lang });
      io.to('agents').emit('new_customer', { customerId: customerId, customerName: name, customerMobile: mobile, message: 'New customer joined', conversationId: conversation.id, lang: lang });
    } catch (error) { console.error('Error handling customer join:', error); }
  });

  socket.on('agent_join', (data) => {
    const agentName = data.name || 'Unknown Agent';
    console.log(`👨‍💼 AGENT JOIN: ${agentName}`);
    
    activeAgents.set(socket.id, { id: socket.id, name: agentName, status: 'available', currentCustomerId: null });
    socket.join('agents');
    
    socket.emit('agent_connected', { status: 'connected' });
    socket.emit('agent_join_confirmed', { agentName: agentName }); 
    io.emit('agent_status', { agentCount: activeAgents.size });
  });

  socket.on('customer_message', async (data) => {
    const { message, customerName, customerId, lang = 'en' } = data; // Accept language
    const actualCustomerId = extractCustomerId(customerId);
    
    try {
      const conversationResult = await pool.query('SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'', [actualCustomerId]);
      let conversation;
      
      if (conversationResult.rows.length === 0) {
        const insertResult = await pool.query(`INSERT INTO conversations (id, customer_id, customer_name, status) VALUES ($1, $2, $3, 'active') RETURNING *`, [uuidv4(), actualCustomerId, customerName]);
        conversation = insertResult.rows[0];
      } else {
        conversation = conversationResult.rows[0];
      }
      
      await pool.query(`INSERT INTO messages (id, conversation_id, sender, sender_id, type, content) VALUES ($1, $2, $3, $4, 'user', $5)`, [uuidv4(), conversation.id, customerName, customerId, message]);
      await pool.query('UPDATE conversations SET last_message = $1, last_message_time = CURRENT_TIMESTAMP WHERE id = $2', [message, conversation.id]);
      
      io.to('agents').emit('new_message', { customerId: customerId, sender: customerName, text: message, conversationId: conversation.id, timestamp: new Date() });
      
      if (conversation.agent_id) {
        return;
      }
      
      // Pass language to bot response logic
      const botReply = getBotResponse(message, lang);
      
      await pool.query(`INSERT INTO messages (id, conversation_id, sender, type, content) VALUES ($1, $2, 'Bot', 'bot', $3)`, [uuidv4(), conversation.id, botReply]);
      io.to(`room_${customerId}`).emit('agent_message', { text: botReply, timestamp: new Date() });
      io.to('agents').emit('new_message', { customerId: customerId, sender: 'Bot', text: botReply, conversationId: conversation.id, timestamp: new Date() });
      
    } catch (error) { console.error("Error handling customer message:", error); }
  });

  socket.on('agent_message', async (data) => {
    const { message, agentName, customerId } = data;
    const actualCustomerId = extractCustomerId(customerId);
    
    try {
      const conversationResult = await pool.query('SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'', [actualCustomerId]);
      if (conversationResult.rows.length === 0) return;
      
      const conversation = conversationResult.rows[0];
      await pool.query(`INSERT INTO messages (id, conversation_id, sender, sender_id, type, content) VALUES ($1, $2, $3, $4, 'agent', $5)`, [uuidv4(), conversation.id, agentName, socket.id, message]);
      await pool.query('UPDATE conversations SET last_message = $1, last_message_time = CURRENT_TIMESTAMP WHERE id = $2', [message, conversation.id]);
      
      io.to(`room_${customerId}`).emit('agent_message', { text: message, timestamp: new Date() });
      await pool.query('UPDATE messages SET read_status = TRUE WHERE conversation_id = $1 AND type = \'user\' AND read_status = FALSE', [conversation.id]);
    } catch (error) { console.error("Error handling agent message:", error); }
  });

  // Typing Indicators
  socket.on('typing_start', (data) => {
    const { isAgent, customerId } = data;
    if (isAgent) {
      const agentData = activeAgents.get(socket.id);
      io.to(`room_${customerId}`).emit('typing_indicator', { customerId, typing: true });
    } else {
      const actualCustomerId = extractCustomerId(customerId);
      pool.query('SELECT agent_id FROM conversations WHERE customer_id = $1 AND status = \'active\'', [actualCustomerId]).then(result => {
        if (result.rows.length > 0 && result.rows[0].agent_id) {
          io.to(result.rows[0].agent_id).emit('customer_typing', { customerId, typing: true });
        }
      });
    }
  });

  socket.on('typing_stop', (data) => {
    const { isAgent, customerId } = data;
    if (isAgent) {
      io.to(`room_${customerId}`).emit('typing_indicator', { customerId, typing: false });
    } else {
      const actualCustomerId = extractCustomerId(customerId);
      pool.query('SELECT agent_id FROM conversations WHERE customer_id = $1 AND status = \'active\'', [actualCustomerId]).then(result => {
        if (result.rows.length > 0 && result.rows[0].agent_id) {
          io.to(result.rows[0].agent_id).emit('customer_typing', { customerId, typing: false });
        }
      });
    }
  });

  // Transfer Chat
  socket.on('transfer_chat', async (data) => {
    const { conversationId, customerId, toAgentId, toAgentName } = data;
    const currentAgent = activeAgents.get(socket.id);
    
    if (!currentAgent) return;
    
    try {
      await pool.query('UPDATE conversations SET agent_id = $1, agent_name = $2 WHERE id = $3', [toAgentId, toAgentName, conversationId]);
      activeAgents.set(socket.id, { ...currentAgent, status: 'available', currentCustomerId: null });
      
      socket.emit('chat_transferred', { customerId, agentName: toAgentName });
      
      const newAgentData = activeAgents.get(toAgentId);
      if (newAgentData) {
        activeAgents.set(toAgentId, { ...newAgentData, status: 'busy', currentCustomerId: customerId });
        io.to(toAgentId).emit('agent_assignment', { customerId, customerName: data.customerName, conversationId });
      }
      
      await pool.query(`INSERT INTO messages (id, conversation_id, sender, type, content) VALUES ($1, $2, 'System', 'system', 'Chat transferred to ${toAgentName}')`, [uuidv4(), conversationId]);
      
    } catch (error) {
      console.error("Error transferring chat:", error);
    }
  });

  // Request Feedback
  socket.on('request_feedback', async (data) => {
    const { conversationId, customerId } = data;
    io.to(`room_${customerId}`).emit('show_feedback_request', { conversationId });
  });

  // End Chat
  socket.on('end_chat', async (data) => {
    const { customerId, conversationId } = data;
    const agentData = activeAgents.get(socket.id);
    
    if (!agentData) return;
    
    try {
      await pool.query('UPDATE conversations SET status = \'closed\', end_time = CURRENT_TIMESTAMP WHERE id = $1', [conversationId]);
      await pool.query(`INSERT INTO messages (id, conversation_id, sender, type, content) VALUES ($1, $2, 'System', 'system', 'Conversation ended')`, [uuidv4(), conversationId]);
      
      activeAgents.set(socket.id, { ...agentData, status: 'available', currentCustomerId: null });
      
      io.to(`room_${customerId}`).emit('conversation_ended', { message: 'Your conversation has been ended. Thank you for chatting with us!', showFeedback: false });
      io.to('agents').emit('conversation_ended', { agentId: socket.id, customerId, conversationId });
      
      if (pendingAgentRequests.length > 0) {
        const nextRequest = pendingAgentRequests.shift();
        await pool.query('UPDATE conversations SET agent_id = $1, agent_name = $2, status = \'active\' WHERE id = $3', [socket.id, agentData.name, nextRequest.conversationId]);
        activeAgents.set(socket.id, { ...agentData, status: 'busy', currentCustomerId: nextRequest.customerId });
        socket.emit('agent_assignment', { customerId: nextRequest.customerId, customerName: nextRequest.customerName, conversationId: nextRequest.conversationId });
        io.to(`room_${nextRequest.customerId}`).emit('agent_joined', { agentName: agentData.name, message: `${agentData.name} has joined the chat` });
      }
    } catch (error) { console.error("Error ending conversation:", error); }
  });

  socket.on('request_agent', async (data) => {
    const { customerId, customerName } = data;
    const actualCustomerId = extractCustomerId(customerId);
    
    try {
      const conversationResult = await pool.query('SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'', [actualCustomerId]);
      if (conversationResult.rows.length === 0) return;
      const conversation = conversationResult.rows[0];
      
      await pool.query('UPDATE conversations SET status = \'queued\' WHERE id = $1', [conversation.id]);
      
      const availableAgent = Array.from(activeAgents.values()).find(agent => agent.status === 'available');
      
      if (availableAgent) {
        await pool.query('UPDATE conversations SET agent_id = $1, agent_name = $2, status = \'active\' WHERE id = $3', [availableAgent.id, availableAgent.name, conversation.id]);
        
        const agentData = activeAgents.get(availableAgent.id);
        activeAgents.set(availableAgent.id, { ...agentData, status: 'busy', currentCustomerId: customerId });
        
        io.to(availableAgent.id).emit('agent_assignment', { customerId, customerName, conversationId: conversation.id });
        io.to(`room_${customerId}`).emit('agent_joined', { agentName: availableAgent.name, message: `${availableAgent.name} has joined the chat` });
        io.to('agents').emit('agent_assigned', { agentId: availableAgent.id, agentName: availableAgent.name, customerId, customerName });
      } else {
        pendingAgentRequests.push({ customerId, customerName, conversationId: conversation.id, timestamp: new Date() });
        
        io.to('agents').emit('new_agent_request', { customerName, customerId }); 
        
        io.to(`room_${customerId}`).emit('queue_status', { status: 'queued', message: 'All agents are currently busy. You\'ll be connected to the next available agent.', position: pendingAgentRequests.length });
      }
    } catch (error) { console.error("Error handling agent request:", error); }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
    const agentData = activeAgents.get(socket.id);
    if (agentData) {
      if (agentData.currentCustomerId) {
        const customerId = agentData.currentCustomerId;
        const actualCustomerId = extractCustomerId(customerId);
        pool.query('UPDATE conversations SET agent_id = NULL, agent_name = NULL, status = \'queued\' WHERE customer_id = $1 AND status = \'active\'', [actualCustomerId]);
        io.to(`room_${customerId}`).emit('agent_disconnected', { message: 'The agent has disconnected.', requeued: true });
        pendingAgentRequests.push({ customerId, customerName: "Unknown", timestamp: new Date() });
      }
      activeAgents.delete(socket.id);
      io.emit('agent_status', { agentCount: activeAgents.size });
    }
    
    let customerId = null;
    for (const [id, socketId] of customerSockets.entries()) {
      if (socketId === socket.id) { customerId = id; break; }
    }
    if (customerId) {
      customerSockets.delete(customerId);
    }
  });
});

server.listen(PORT, () => { console.log(`🚀 Server running on port ${PORT}`); });
