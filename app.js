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
  connectionString: "postgresql://neondb_owner:npg_aE4iTqzeIWB3@ep-old-wind-a1j8s1aj-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  ssl: {
    rejectUnauthorized: false
  }
});

// Custom Bot Responses - Q&A Database
const botResponses = {
  greetings: {
    keywords: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'greetings'],
    response: "Hello! Welcome to Tushar Bhumkar Institute. How can I help you today?"
  },
  courses: {
    keywords: ['courses', 'course', 'program', 'training', 'workshop', 'learning'],
    response: "We offer comprehensive share market training programs:\n\n📚 **Basic Workshop**: Perfect for beginners to understand market movements through well-designed modules.\n\n📈 **Advanced Workshop**: Hands-on training for experienced traders focusing on practical techniques.\n\n👨‍🏫 **Training Expert**: All workshops are conducted by Mr. Tushar Bhumkar, who has extensive experience in intraday trading.\n\n📞 **For more information**: Call 9272000111"
  },
  basic_workshop: {
    keywords: ['basic workshop', 'basic course', 'beginner', 'foundation', 'starting'],
    response: "🎯 **Basic Workshop Details**:\n\nThis course helps beginners understand market movements through well-designed modules.\n\n✅ **What you'll learn**:\n- How historical data influences market behavior\n- Price pattern analysis\n- Market fundamentals\n- Structured and practical sessions\n- Strong foundation building\n\n⏰ **Duration**: 2 weeks\n📅 **Next batch**: Starting soon\n💰 **Fee**: Affordable pricing with EMI options"
  },
  advanced_workshop: {
    keywords: ['advanced workshop', 'advanced course', 'expert', 'professional', 'deep dive'],
    response: "🚀 **Advanced Workshop Details**:\n\nThis workshop is designed for learners who want to go deeper into market analysis.\n\n✅ **What you'll learn**:\n- Advanced market concepts\n- Practical trading techniques\n- Real-world market analysis\n- Risk management strategies\n- Portfolio optimization\n\n⏰ **Duration**: 4 weeks\n📅 **Next batch**: Starting soon\n💰 **Fee**: Premium pricing with flexible payment options"
  },
  fees: {
    keywords: ['fees', 'fee', 'price', 'cost', 'payment', 'emi'],
    response: "💰 **Course Fees & Payment Options**:\n\n**Basic Workshop**: ₹15,000\n**Advanced Workshop**: ₹25,000\n**Combo Package**: ₹35,000 (Save ₹5,000)\n\n💳 **Payment Options**:\n- Cash payment\n- Bank transfer\n- EMI available (3, 6, 12 months)\n- Credit/Debit cards accepted\n- UPI payments\n\n🎁 **Special Offer**: 10% discount for early registration!"
  },
  contact: {
    keywords: ['contact', 'phone', 'call', 'email', 'address', 'location', 'visit'],
    response: "📞 **Contact Information**:\n\n📱 **Phone**: 9272000111\n📧 **Email**: info@tusharbhumkarinstitute.com\n📍 **Address**: Pune, Maharashtra\n\n🕐 **Office Hours**:\n- Monday to Friday: 9:00 AM - 7:00 PM\n- Saturday: 9:00 AM - 5:00 PM\n- Sunday: Closed\n\n💬 **WhatsApp**: Available on the same number for quick queries"
  },
  duration: {
    keywords: ['duration', 'time', 'length', 'period', 'schedule', 'timings'],
    response: "⏰ **Course Duration & Schedule**:\n\n**Basic Workshop**: 2 weeks\n- Weekday batches: 2 hours/day\n- Weekend batches: 4 hours/day\n\n**Advanced Workshop**: 4 weeks\n- Weekday batches: 2 hours/day\n- Weekend batches: 4 hours/day\n\n📅 **Flexible Timings**:\n- Morning Batch: 7:00 AM - 9:00 AM\n- Evening Batch: 6:00 PM - 8:00 PM\n- Weekend Batch: Saturday & Sunday"
  },
  eligibility: {
    keywords: ['eligibility', 'requirements', 'qualification', 'who can join', 'prerequisites'],
    response: "📋 **Eligibility & Requirements**:\n\n**Basic Workshop**:\n✅ No prior knowledge required\n✅ Minimum age: 18 years\n✅ Basic computer knowledge helpful\n✅ Graduation preferred but not mandatory\n\n**Advanced Workshop**:\n✅ Completion of Basic Workshop (or equivalent knowledge)\n✅ Understanding of market basics\n✅ Active trading experience preferred\n✅ Minimum 6 months market exposure\n\n🎯 **Who should join**:\n- Students interested in finance\n- Working professionals\n- Business owners\n- Homemakers looking for financial independence"
  },
  support: {
    keywords: ['support', 'help', 'doubt', 'query', 'assistance', 'guidance'],
    response: "🤝 **Post-Course Support**:\n\n✅ **Dedicated Support Hours**:\n- Monday to Friday: 6:00 PM - 8:00 PM\n- Saturday: 10:00 AM - 1:00 PM\n\n✅ **What we provide**:\n- Doubt clearing sessions\n- Market analysis guidance\n- Trading strategy reviews\n- Portfolio review\n- Regular webinars\n\n✅ **Lifetime Access**:\n- Study materials\n- Recorded sessions\n- Community group\n- Alumni network\n\n📞 **Support**: 9272000111"
  },
  testimonials: {
    keywords: ['review', 'testimonial', 'feedback', 'experience', 'success story'],
    response: "⭐ **Student Success Stories**:\n\n🎯 **Rahul Sharma**: \"The Basic Workshop transformed my understanding of the market. Now I'm making consistent profits!\"\n\n🎯 **Priya Patel**: \"Advanced Workshop helped me develop my own trading strategy. Highly recommended!\"\n\n🎯 **Amit Kumar**: \"Best investment in my career. The practical approach made all the difference.\"\n\n🎯 **Neha Singh**: \"Post-course support is amazing. Always get help when I need it.\"\n\n🎯 **Vikram Desai**: \"From zero to profitable trader in 3 months. Thank you Tushar Sir!\"\n\n📊 **Success Rate**: 85% of our students are successfully trading"
  },
  materials: {
    keywords: ['materials', 'study material', 'notes', 'books', 'resources'],
    response: "📚 **Study Materials & Resources**:\n\n✅ **What you'll get**:\n- Comprehensive study notes\n- Practice worksheets\n- Real market case studies\n- Trading templates\n- Chart patterns guide\n- Risk management checklist\n\n✅ **Digital Resources**:\n- Video recordings\n- E-books\n- Market analysis tools\n- Trading calculators\n\n✅ **Physical Materials**:\n- Printed study material\n- Chart pattern cards\n- Quick reference guide\n\n📱 **Mobile App**: Access materials on-the-go"
  },
  placement: {
    keywords: ['placement', 'job', 'career', 'opportunity', 'employment'],
    response: "💼 **Career Opportunities & Placement**:\n\n🎯 **Job Roles**:\n- Equity Research Analyst\n- Technical Analyst\n- Portfolio Manager\n- Risk Manager\n- Trading Desk Executive\n- Financial Advisor\n\n✅ **Placement Support**:\n- Resume building workshops\n- Interview preparation\n- Job referrals\n- Industry connections\n- Alumni network\n\n📊 **Placement Record**:\n- 70% placement rate\n- Average salary: ₹4-8 LPA\n- Top companies: ICICI, HDFC, Kotak, Reliance\n\n🎓 **Entrepreneur Support**: Guidance for starting own trading firm"
  },
  refund: {
    keywords: ['refund', 'cancellation', 'money back', 'guarantee'],
    response: "💰 **Refund & Cancellation Policy**:\n\n✅ **Refund Policy**:\n- 100% refund if cancelled 7 days before start\n- 50% refund if cancelled 3-7 days before start\n- No refund if cancelled less than 3 days before start\n\n✅ **Special Cases**:\n- Medical emergency: Full refund with proof\n- Job relocation: 50% refund with proof\n\n✅ **Course Transfer**:\n- Free transfer to next batch (once)\n- Subject to availability\n\n📞 **For Refunds**: Call 9272000111 or email info@tusharbhumkarinstitute.com"
  },
  offline: {
    keywords: ['offline', 'classroom', 'in-person', 'physical'],
    response: "🏫 **Offline Classroom Training**:\n\n📍 **Location**: Pune, Maharashtra (Prime location with easy connectivity)\n\n✅ **Facilities**:\n- Air-conditioned classrooms\n- Projector and audio system\n- High-speed internet\n- Trading terminals\n- Library access\n- Parking facility\n\n✅ **Benefits**:\n- Face-to-face interaction with Tushar Sir\n- Peer learning environment\n- Live market practice\n- Immediate doubt resolution\n- Networking opportunities\n\n📅 **Batch Timings**:\n- Morning: 7:00 AM - 9:00 AM\n- Evening: 6:00 PM - 8:00 PM\n- Weekend: 10:00 AM - 2:00 PM"
  },
  online: {
    keywords: ['online', 'virtual', 'remote', 'live', 'zoom'],
    response: "💻 **Online Live Training**:\n\n✅ **Platform**: Zoom with interactive features\n\n✅ **Features**:\n- Live interactive sessions\n- Screen sharing\n- Recording access\n- Chat support\n- Digital whiteboard\n- Breakout rooms\n\n✅ **Benefits**:\n- Learn from anywhere\n- Flexible schedule\n- Recordings for revision\n- Save travel time\n- Learn at your own pace\n\n✅ **Requirements**:\n- Stable internet connection\n- Laptop/desktop with camera\n- Zoom app installed\n- Headphones recommended\n\n📱 **Mobile App**: Access classes on mobile too"
  },
  bye: {
    keywords: ['bye', 'goodbye', 'thank you', 'thanks', 'see you', 'exit'],
    response: "Thank you for contacting Tushar Bhumkar Institute! 😊\n\n📞 Feel free to call us at 9272000111 for any further assistance.\n\nHave a great day! 🌟"
  },
  default: {
    keywords: [],
    response: "I understand you're interested in our courses. Here's how I can help:\n\n📚 **Course Information**:\n- Basic Workshop (2 weeks)\n- Advanced Workshop (4 weeks)\n- Combo packages available\n\n📞 **Contact**: 9272000111\n📧 **Email**: info@tusharbhumkarinstitute.com\n\n💬 **Type any of these to know more**:\n- 'courses' - Course details\n- 'fees' - Fee structure\n- 'contact' - Contact information\n- 'duration' - Course timings\n\nOr ask me anything specific about our training programs!"
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
