// =================================================================
// BACKEND WITH POSTGRESQL PERSISTENCE AND AGENT ASSOCIATION
// =================================================================

const express = require("express");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
const jwt = require('jsonwebtoken'); // *** NEW: For JWT tokens ***
const bcrypt = require('bcrypt'); // *** NEW: For password hashing ***
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
const JWT_SECRET = process.env.JWT_SECRET || 'a_very_long_and_random_secret_key_for_jwt'; // *** NEW ***

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
    response: "Hello! Welcome to Tushar Bhumkar Institute. How can I help you today?"
  },
  courses: {
    keywords: ['courses', 'course', 'program', 'training', 'workshop', 'learning'],
    response: `We offer one exclusive course focused on intraday commodity trading, which is divided into two parts:

**Basic Workshop**: This module provides complete training in Nifty, stocks, and part-time intraday trading, covering daily, weekly, and monthly trading approaches.

**Advanced Workshop**: This module is designed for part-time and full-time traders, especially those who are facing issues like overtrading, options traps, and losses in long-term investments. 

It focuses on discipline, risk management, and advanced trading strategies. 

**Training Expert**: All workshops are conducted by Mr. Tushar Bhumkar, who has extensive experience in intraday trading.

**For more information**: Call 9272000111`   
  },
  basic_workshop: {
    keywords: ['basic workshop', 'basic course', 'beginner', 'foundation', 'starting'],
    response: `🎯 **Basic Workshop Details**:

This course helps beginners understand market movements through well-designed modules.

✅ **What you'll learn**:
- How historical data influences market behavior
- Price pattern analysis
- Market fundamentals
- Structured and practical sessions
- Strong foundation building

⏰ **Duration**: 2 weeks
📅 **Next batch**: Starting soon
💰 **Fee**: Affordable pricing with EMI options`
  },
  advanced_workshop: {
    keywords: ['advanced workshop', 'advanced course', 'expert', 'professional', 'deep dive'],
    response: `🚀 **Advanced Workshop Details**:

This workshop is designed for learners who want to go deeper into market analysis.

✅ **What you'll learn**:
- Advanced market concepts
- Practical trading techniques
- Real-world market analysis
- Risk management strategies
- Portfolio optimization

⏰ **Duration**: 4 weeks
📅 **Next batch**: Starting soon
💰 **Fee**: Premium pricing with flexible payment options`
  },
  fees: {
    keywords: ['fees', 'fee', 'price', 'cost', 'payment', 'emi'],
    response: `💰 **Course Fees & Payment Options**:

**Basic Workshop**: ₹15,000
**Advanced Workshop**: ₹25,000
**Combo Package**: ₹35,000 (Save ₹5,000)

💳 **Payment Options**:
- Cash payment
- Bank transfer
- EMI available (3, 6, 12 months)
- Credit/Debit cards accepted
- UPI payments

🎁 **Special Offer**: 10% discount for early registration!`
  },
  contact: {
    keywords: ['contact', 'phone', 'call', 'email', 'address', 'location', 'visit'],
    response: `📞 **Contact Information**:

📱 **Phone**: 9272000111
📧 **Email**: info@tusharbhumkarinstitute.com
📍 **Address**: Pune, Maharashtra

🕐 **Office Hours**:
- Monday to Friday: 9:00 AM - 7:00 PM
- Saturday: 9:00 AM - 5:00 PM
- Sunday: Closed

💬 **WhatsApp**: Available on the same number for quick queries`
  },
  duration: {
    keywords: ['duration', 'time', 'length', 'period', 'schedule', 'timings'],
    response: `⏰ **Course Duration & Schedule**:

**Basic Workshop**: 2 weeks
- Weekday batches: 2 hours/day
- Weekend batches: 4 hours/day

**Advanced Workshop**: 4 weeks
- Weekday batches: 2 hours/day
- Weekend batches: 4 hours/day

📅 **Flexible Timings**:
- Morning Batch: 7:00 AM - 9:00 AM
- Evening Batch: 6:00 PM - 8:00 PM
- Weekend Batch: Saturday & Sunday`
  },
  eligibility: {
    keywords: ['eligibility', 'requirements', 'qualification', 'who can join', 'prerequisites'],
    response: `📋 **Eligibility & Requirements**:

**Basic Workshop**:
✅ No prior knowledge required
✅ Minimum age: 18 years
✅ Basic computer knowledge helpful
✅ Graduation preferred but not mandatory

**Advanced Workshop**:
✅ Completion of Basic Workshop (or equivalent knowledge)
✅ Understanding of market basics
✅ Active trading experience preferred
✅ Minimum 6 months market exposure

🎯 **Who should join**:
- Students interested in finance
- Working professionals
- Business owners
- Homemakers looking for financial independence`
  },
  support: {
    keywords: ['support', 'help', 'doubt', 'query', 'assistance', 'guidance'],
    response: `🤝 **Post-Course Support**:

✅ **Dedicated Support Hours**:
- Monday to Friday: 6:00 PM - 8:00 PM
- Saturday: 10:00 AM - 1:00 PM

✅ **What we provide**:
- Doubt clearing sessions
- Market analysis guidance
- Trading strategy reviews
- Portfolio review
- Regular webinars

✅ **Lifetime Access**:
- Study materials
- Recorded sessions
- Community group
- Alumni network

📞 **Support**: 9272000111`
  },
  testimonials: {
    keywords: ['review', 'testimonial', 'feedback', 'experience', 'success story'],
    response: `⭐ **Student Success Stories**:

🎯 **Rahul Sharma**: "The Basic Workshop transformed my understanding of the market. Now I'm making consistent profits!"

🎯 **Priya Patel**: "Advanced Workshop helped me develop my own trading strategy. Highly recommended!"

🎯 **Amit Kumar**: "Best investment in my career. The practical approach made all the difference."

🎯 **Neha Singh**: "Post-course support is amazing. Always get help when I need it."

🎯 **Vikram Desai**: "From zero to profitable trader in 3 months. Thank you Tushar Sir!"

📊 **Success Rate**: 85% of our students are successfully trading`
  },
  materials: {
    keywords: ['materials', 'study material', 'notes', 'books', 'resources'],
    response: `📚 **Study Materials & Resources**:

✅ **What you'll get**:
- Comprehensive study notes
- Practice worksheets
- Real market case studies
- Trading templates
- Chart patterns guide
- Risk management checklist

✅ **Digital Resources**:
- Video recordings
- E-books
- Market analysis tools
- Trading calculators

✅ **Physical Materials**:
- Printed study material
- Chart pattern cards
- Quick reference guide

📱 **Mobile App**: Access materials on-the-go`
  },
  placement: {
    keywords: ['placement', 'job', 'career', 'opportunity', 'employment'],
    response: `💼 **Career Opportunities & Placement**:

🎯 **Job Roles**:
- Equity Research Analyst
- Technical Analyst
- Portfolio Manager
- Risk Manager
- Trading Desk Executive
- Financial Advisor

✅ **Placement Support**:
- Resume building workshops
- Interview preparation
- Job referrals
- Industry connections
- Alumni network

📊 **Placement Record**:
- 70% placement rate
- Average salary: ₹4-8 LPA
- Top companies: ICICI, HDFC, Kotak, Reliance

🎓 **Entrepreneur Support**: Guidance for starting own trading firm`
  },
  refund: {
    keywords: ['refund', 'cancellation', 'money back', 'guarantee'],
    response: `💰 **Refund & Cancellation Policy**:

✅ **Refund Policy**:
- 100% refund if cancelled 7 days before start
- 50% refund if cancelled 3-7 days before start
- No refund if cancelled less than 3 days before start

✅ **Special Cases**:
- Medical emergency: Full refund with proof
- Job relocation: 50% refund with proof

✅ **Course Transfer**:
- Free transfer to next batch (once)
- Subject to availability

📞 **For Refunds**: Call 9272000111 or email info@tusharbhumkarinstitute.com`
  },
  offline: {
    keywords: ['offline', 'classroom', 'in-person', 'physical'],
    response: `🏫 **Offline Classroom Training**:

📍 **Location**: Pune, Maharashtra (Prime location with easy connectivity)

✅ **Facilities**:
- Air-conditioned classrooms
- Projector and audio system
- High-speed internet
- Trading terminals
- Library access
- Parking facility

✅ **Benefits**:
- Face-to-face interaction with Tushar Sir
- Peer learning environment
- Live market practice
- Immediate doubt resolution
- Networking opportunities

📅 **Batch Timings**:
- Morning: 7:00 AM - 9:00 AM
- Evening: 6:00 PM - 8:00 PM
- Weekend: 10:00 AM - 2:00 PM`
  },
  online: {
    keywords: ['online', 'virtual', 'remote', 'live', 'zoom'],
    response: `💻 **Online Live Training**:

✅ **Platform**: Zoom with interactive features

✅ **Features**:
- Live interactive sessions
- Screen sharing
- Recording access
- Chat support
- Digital whiteboard
- Breakout rooms

✅ **Benefits**:
- Learn from anywhere
- Flexible schedule
- Recordings for revision
- Save travel time
- Learn at your own pace

✅ **Requirements**:
- Stable internet connection
- Laptop/desktop with camera
- Zoom app installed
- Headphones recommended

📱 **Mobile App**: Access classes on mobile too`
  },
  bye: {
    keywords: ['bye', 'goodbye', 'thank you', 'thanks', 'see you', 'exit'],
    response: `Thank you for contacting Tushar Bhumkar Institute! 😊

📞 Feel free to call us at 9272000111 for any further assistance.

Have a great day! 🌟`
  },
  default: {
    keywords: [],
    response: `I understand you're interested in our courses. Here's how I can help:

📚 **Course Information**:
- Basic Workshop (2 weeks)
- Advanced Workshop (4 weeks)
- Combo packages available

📞 **Contact**: 9272000111
📧 **Email**: info@tusharbhumkarinstitute.com

💬 **Type any of these to know more**:
- 'courses' - Course details
- 'fees' - Fee structure
- 'contact' - Contact information
- 'duration' - Course timings

Or ask me anything specific about our training programs!`
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
    // *** NEW: Create agents table for authentication ***
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

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
        agent_id UUID, // *** UPDATED: Changed to UUID to match agents table ***
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
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_agents_username ON agents(username)`); // *** NEW ***
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_conversations_customer_id ON conversations(customer_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)`);

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
// *** UPDATED: This map will now use agentId (UUID) as the key ***
const activeAgents = new Map();
const customerSockets = new Map();
const pendingAgentRequests = [];

// --- JWT MIDDLEWARE FOR API ROUTES ---
// *** NEW ***
const authenticateAgent = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.sendStatus(401); // No token

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); // Invalid token
        req.user = user;
        next();
    });
};


// --- HTTP API Endpoints ---

// *** NEW: AGENT AUTHENTICATION ENDPOINTS ***
app.post("/api/agent/register", async (req, res) => {
    try {
        const { fullName, username, email, password, phone } = req.body;
        if (!fullName || !username || !email || !password) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO agents (full_name, username, email, password_hash, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, full_name, email',
            [fullName, username, email, hashedPassword, phone]
        );
        res.status(201).json({ success: true, agent: result.rows[0] });
    } catch (error) {
        console.error("Registration error:", error);
        if (error.code === '23505') {
            return res.status(409).json({ error: "Username or email already exists." });
        }
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/api/agent/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: "Username and password are required" });
        }

        const result = await pool.query('SELECT * FROM agents WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const agent = result.rows[0];
        const isMatch = await bcrypt.compare(password, agent.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const token = jwt.sign(
            { id: agent.id, username: agent.username },
            JWT_SECRET,
            { expiresIn: '1d' }
        );

        const { password_hash, ...agentInfo } = agent; // Exclude hash from response
        res.json({ token, agent: agentInfo });

    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});


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

// *** UPDATED: PROTECTED API ENDPOINTS ***
app.get("/api/conversations", authenticateAgent, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM conversations ORDER BY start_time DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/conversation/:conversationId", authenticateAgent, async (req, res) => {
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

app.get("/api/agent/:agentId/conversations", authenticateAgent, async (req, res) => {
    // *** UPDATED: Ensure the agent requesting is the one logged in ***
    if (req.user.id !== req.params.agentId) {
        return res.status(403).json({ error: "Forbidden: You can only access your own conversations." });
    }
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

app.get("/api/customer/:customerId/conversations", authenticateAgent, async (req, res) => {
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

app.post("/api/conversation/:conversationId/feedback", authenticateAgent, async (req, res) => {
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

app.get("/api/agents", (req, res) => {
  // *** UPDATED: Get data from the authenticated activeAgents map ***
  const agents = Array.from(activeAgents.values()).map(agent => ({
    id: agent.agentId, // Use the DB UUID
    name: agent.fullName,
    status: agent.status,
    socketId: agent.socketId
  }));
  
  res.json(agents);
});

// --- WebSocket Connection Handling ---

// *** NEW: Socket.IO middleware for authentication ***
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error: No token provided'));
    }
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return next(new Error('Authentication error: Invalid token'));
        }
        socket.agentId = decoded.id; // The agent's UUID from the database
        socket.username = decoded.username;
        next();
    });
});

io.on('connection', (socket) => {
  console.log(`🔐 Authenticated agent connected: ${socket.username} (${socket.agentId})`);

  // *** UPDATED: Fetch agent details and add to activeAgents map ***
  pool.query('SELECT full_name FROM agents WHERE id = $1', [socket.agentId])
      .then(res => {
          if (res.rows.length > 0) {
              const fullName = res.rows[0].full_name;
              socket.fullName = fullName;
              activeAgents.set(socket.agentId, {
                  socketId: socket.id,
                  agentId: socket.agentId,
                  fullName: fullName,
                  status: 'available',
                  currentCustomerId: null
              });
              console.log(`📊 Active agents count is now: ${activeAgents.size}`);
              
              // Join the agents room
              socket.join('agents');
              
              // Send confirmation to agent
              socket.emit('agent_connected', { status: 'connected', agentName: fullName });
              
              // Update all clients with agent count
              io.emit('agent_status', { agentCount: activeAgents.size });
          } else {
              // Agent not found in DB, disconnect
              socket.emit('auth_error', 'Agent profile not found.');
              socket.disconnect();
          }
      })
      .catch(err => {
          console.error('Error fetching agent details on connect:', err);
          socket.emit('auth_error', 'Server error.');
          socket.disconnect();
      });

  // *** REMOVED: agent_join event is no longer needed ***
  // The agent is now authenticated and identified during the initial connection.

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
    // *** UPDATED: Use authenticated agent info instead of trusting client data ***
    const { message, customerId } = data;
    const actualCustomerId = extractCustomerId(customerId);
    
    console.log(`👨‍💼 AGENT MESSAGE from ${socket.fullName} to ${customerId}: "${message}"`);
    
    try {
      // Find the conversation
      const conversationResult = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'',
        [actualCustomerId]
      );
      
      if (conversationResult.rows.length === 0) return;
      
      const conversation = conversationResult.rows[0];
      
      // Save the agent message
      // *** UPDATED: Use authenticated agent's info ***
      await pool.query(
        `INSERT INTO messages (id, conversation_id, sender, sender_id, type, content) 
           VALUES ($1, $2, $3, $4, 'agent', $5)`,
        [uuidv4(), conversation.id, socket.fullName, socket.agentId, message]
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
      
      // *** UPDATED: Find agent from the authenticated map ***
      const availableAgentEntry = Array.from(activeAgents.entries()).find(
        ([id, data]) => data.status === 'available'
      );
      
      if (availableAgentEntry) {
        const [agentId, agentData] = availableAgentEntry;
        console.log(`✅ Found available agent: ${agentData.fullName} (${agentId})`);
        
        // Assign agent to conversation
        await pool.query(
          'UPDATE conversations SET agent_id = $1, agent_name = $2, status = \'active\' WHERE id = $3',
          [agentId, agentData.fullName, conversation.id]
        );
        
        // Update agent status
        activeAgents.set(agentId, { ...agentData, status: 'busy', currentCustomerId: customerId });
        
        // Notify agent
        io.to(agentData.socketId).emit('agent_assignment', {
          customerId,
          customerName,
          conversationId: conversation.id
        });
        
        // Notify customer
        io.to(`room_${customerId}`).emit('agent_joined', {
          agentName: agentData.fullName,
          message: `${agentData.fullName} has joined the chat`
        });
        
        // Notify all agents about the assignment
        io.to('agents').emit('agent_assigned', {
          agentId,
          agentName: agentData.fullName,
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
    const agentData = activeAgents.get(socket.agentId);
    
    if (!agentData) return;
    
    console.log(`👨‍💼 AGENT ${agentData.fullName} (${socket.agentId}) ACCEPTED customer ${customerName} (${customerId})`);
    
    try {
      // Update conversation with agent info
      await pool.query(
        'UPDATE conversations SET agent_id = $1, agent_name = $2, status = \'active\' WHERE id = $3',
        [socket.agentId, agentData.fullName, conversationId]
      );
      
      // Update agent status
      activeAgents.set(socket.agentId, { ...agentData, status: 'busy', currentCustomerId: customerId });
      
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
        agentName: agentData.fullName,
        message: `${agentData.fullName} has joined the chat`
      });
      
      // Notify all agents about the assignment
      io.to('agents').emit('agent_assigned', {
        agentId: socket.agentId,
        agentName: agentData.fullName,
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
    const agentData = activeAgents.get(socket.agentId);
    
    if (!agentData) return;
    
    console.log(`🔚 ENDING CONVERSATION between agent ${agentData.fullName} and customer ${customerId}`);
    
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
      activeAgents.set(socket.agentId, { ...agentData, status: 'available', currentCustomerId: null });
      
      // Notify customer
      io.to(`room_${customerId}`).emit('conversation_ended', {
        message: 'Your conversation has been ended. Thank you for chatting with us!',
        showFeedback: true
      });
      
      // Notify all agents
      io.to('agents').emit('conversation_ended', {
        agentId: socket.agentId,
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
          [socket.agentId, agentData.fullName, nextRequest.conversationId]
        );
        
        // Update agent status
        activeAgents.set(socket.agentId, { ...agentData, status: 'busy', currentCustomerId: nextRequest.customerId });
        
        // Notify agent
        socket.emit('agent_assignment', {
          customerId: nextRequest.customerId,
          customerName: nextRequest.customerName,
          conversationId: nextRequest.conversationId
        });
        
        // Notify customer
        io.to(`room_${nextRequest.customerId}`).emit('agent_joined', {
          agentName: agentData.fullName,
          message: `${agentData.fullName} has joined the chat`
        });
        
        // Notify all agents about the assignment
        io.to('agents').emit('agent_assigned', {
          agentId: socket.agentId,
          agentName: agentData.fullName,
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
    // *** UPDATED: Use authenticated agent info ***
    io.to(`room_${customerId}`).emit('typing_indicator', {
      sender: socket.fullName,
      isTyping
    });
  });

  socket.on('disconnect', () => {
    console.log(`👨‍💼 Agent disconnected: ${socket.username}`);
    
    // *** UPDATED: Use agentId from the authenticated socket ***
    if (activeAgents.has(socket.agentId)) {
        const agentData = activeAgents.get(socket.agentId);

        if (agentData.currentCustomerId) {
            const customerId = agentData.currentCustomerId;
            const actualCustomerId = extractCustomerId(customerId);
            
            pool.query(
                'UPDATE conversations SET agent_id = NULL, agent_name = NULL, status = \'queued\' WHERE customer_id = $1 AND status = \'active\'',
                [actualCustomerId]
            ).then(() => {
                return pool.query('SELECT id FROM conversations WHERE customer_id = $1 AND status = \'queued\' ORDER BY start_time DESC LIMIT 1', [actualCustomerId]);
            }).then(result => {
                if (result.rows.length > 0) {
                    return pool.query(`INSERT INTO messages (id, conversation_id, sender, type, content) VALUES ($1, $2, 'System', 'system', 'Agent disconnected. You have been re-queued for the next available agent.')`, [uuidv4(), result.rows[0].id]);
                }
            }).then(() => {
                io.to(`room_${customerId}`).emit('agent_disconnected', { message: 'The agent has disconnected. You have been placed back in the queue.', requeued: true });
                pendingAgentRequests.push({ customerId, customerName: agentData.currentCustomerId, timestamp: new Date() });
                io.to('agents').emit('agent_disconnected', { agentId: socket.agentId, agentName: agentData.fullName, customerId });
            }).catch(err => console.error('Error handling agent disconnect:', err));
        }
        
        activeAgents.delete(socket.agentId);
        io.emit('agent_status', { agentCount: activeAgents.size });
    }
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
