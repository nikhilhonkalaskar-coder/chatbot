require('dotenv').config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Import Database and Models
const { Agent, Conversation, Message } = db;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files from 'public' directory

// --- In-Memory Stores for Active Sockets ---
const activeCustomers = new Map(); // socketId -> { customerId, customerName }
const activeAgents = new Map();    // socketId -> { agentId, agentName }

// --- Middleware for JWT Authentication ---
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// --- HTTP API ROUTES ---

// Agent Registration Route
app.post('/api/agent/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters long' });

    const existingAgent = await Agent.findOne({ where: { username } });
    if (existingAgent) return res.status(409).json({ error: 'Username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const agent = await Agent.create({ username, password: hashedPassword });

    res.status(201).json({ message: 'Agent registered successfully!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Agent Login Route
app.post('/api/agent/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const agent = await Agent.findOne({ where: { username } });
    if (!agent || !(await bcrypt.compare(password, agent.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ agentId: agent.id, username: agent.username }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ agentName: agent.username, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Get all conversations for an agent (protected)
app.get('/api/conversations', verifyToken, async (req, res) => {
  try {
    const conversations = await Conversation.findAll({
      where: { status: { [db.Sequelize.Op.ne]: 'closed' } },
      order: [['updatedAt', 'DESC']],
      include: [{ model: Message, order: [['createdAt', 'ASC']] }] // Include messages
    });
    res.json(conversations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get a single conversation with its messages (protected)
app.get('/api/conversation/:id', verifyToken, async (req, res) => {
  try {
    const conversation = await Conversation.findByPk(req.params.id, {
        include: [{ model: Message, order: [['createdAt', 'ASC']] }]
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ conversation, messages: conversation.Messages });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch conversation details' });
  }
});


// --- SOCKET.IO SETUP ---
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- Bot Logic ---
function getBotResponse(message) {
  const lowerMsg = message.toLowerCase();
  if (lowerMsg.includes('courses') || lowerMsg.includes('tell me about your courses')) {
    return { type: 'courses' };
  }
  if (lowerMsg.includes('contact') || lowerMsg.includes('phone') || lowerMsg.includes('more information')) {
    return { type: 'contact' };
  }
  return { type: 'text', text: "I'm not sure how to answer that. Type 'courses' for information on our workshops, or 'contact' for our phone number. You can also type 'switch to human agent'." };
}

// --- Helper Functions ---
async function assignAgentToCustomer(customerId, customerName) {
  const availableAgent = await Agent.findOne({ where: { status: 'available' } });
  if (!availableAgent) return null;

  await availableAgent.update({ status: 'busy', activeCustomerId: customerId });

  // Notify the agent's socket
  const agentSocketId = [...activeAgents.entries()].find(([_, agent]) => agent.agentId === availableAgent.id.toString())?.[0];
  if (agentSocketId) {
    io.to(agentSocketId).emit('new_assignment', { customerId, customerName });
  }

  return availableAgent;
}

async function findOrCreateConversation(customerId, customerName) {
  const [conversation, created] = await Conversation.findOrCreate({
    where: { customerId },
    defaults: { customerName, status: 'waiting' }
  });
  return conversation;
}

// --- SOCKET EVENTS ---
io.on("connection", (socket) => {
  console.log("🔗 Socket connected:", socket.id);

  // --- Agent Events ---
  socket.on("agent_join", async (data) => {
    const { token } = data;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const agent = await Agent.findByPk(decoded.agentId);
      if (!agent) throw new Error('Agent not found');

      await agent.update({ socketId: socket.id, status: 'available' });

      activeAgents.set(socket.id, { agentId: agent.id.toString(), agentName: agent.username });
      console.log(`👨‍💼 Agent ${agent.username} joined.`);
      socket.emit("agent_join_confirmed", { agentName: agent.username });
      broadcastAgentStatus();

    } catch (error) {
      console.error("Agent authentication failed:", error);
      socket.emit("auth_error", { message: "Authentication failed. Please log in again." });
      socket.disconnect();
    }
  });

  // --- Customer Events ---
  socket.on("customer_join", async (data) => {
    const { customerId, name: customerName } = data;
    activeCustomers.set(socket.id, { customerId, customerName });

    const conversation = await findOrCreateConversation(customerId, customerName);
    
    const assignedAgent = await assignAgentToCustomer(customerId, customerName);
    
    if (assignedAgent) {
      await conversation.update({ AgentId: assignedAgent.id, status: 'active' });
      socket.emit("agent_joined", { agentName: assignedAgent.username });
    } else {
      await conversation.update({ status: 'waiting' });
      socket.emit("agent_message", { sender: "Bot", text: "Hello! All our agents are currently busy. I am here to help you. How can I assist?" });
    }
  });

  socket.on("customer_message", async (data) => {
    const { customerId, message: text } = data;
    const customer = activeCustomers.get(socket.id);
    if (!customer) return;

    const conversation = await findOrCreateConversation(customerId, customer.customerName);
    await Message.create({ ConversationId: conversation.id, sender: 'user', text });

    // Forward to assigned agent if there is one
    if (conversation.AgentId) {
      const agentSocketId = [...activeAgents.entries()].find(([_, agent]) => agent.agentId === conversation.AgentId.toString())?.[0];
      if (agentSocketId) {
        io.to(agentSocketId).emit("new_message", { customerId, sender: customer.customerName, text });
      }
    } else {
      // Handle bot response
      const botResponse = getBotResponse(text);
      const responseText = botResponse.type === 'text' ? botResponse.text : botResponse.type;
      socket.emit("agent_message", { sender: "Bot", text: responseText });
      await Message.create({ ConversationId: conversation.id, sender: 'bot', text: responseText });
    }
  });

  socket.on("request_agent", async () => {
    const customer = activeCustomers.get(socket.id);
    if (!customer) return;

    const conversation = await Conversation.findOne({ where: { customerId: customer.customerId } });
    if (conversation.AgentId) {
      return socket.emit("agent_message", { sender: "Bot", text: "You are already in a conversation with an agent." });
    }

    socket.emit("agent_is_connecting", { message: "Finding an available agent..." });
    const assignedAgent = await assignAgentToCustomer(customer.customerId, customer.customerName);

    if (assignedAgent) {
      await conversation.update({ AgentId: assignedAgent.id, status: 'active' });
      socket.emit("agent_joined", { agentName: assignedAgent.username });
    } else {
      socket.emit("agent_request_failed", { message: "All agents are still busy. Please try again in a moment." });
    }
  });
  
  // --- Agent Messaging ---
  socket.on("agent_message", async (data) => {
    const agent = activeAgents.get(socket.id);
    if (!agent) return;

    const { customerId, message: text } = data;
    const customerSocketId = [...activeCustomers.entries()].find(([_, cust]) => cust.customerId === customerId)?.[0];

    if (customerSocketId) {
      io.to(customerSocketId).emit("agent_message", { sender: "Agent", text });
    }
    
    // Save message to conversation
    const conversation = await Conversation.findOne({ where: { customerId } });
    if (conversation) {
      await Message.create({ ConversationId: conversation.id, sender: 'agent', text });
    }
  });

  // --- Typing Indicators (Fixed Logic) ---
  socket.on("typing_start", (data) => {
    const { isAgent, customerId } = data;
    if (isAgent) {
      const customerSocketId = [...activeCustomers.entries()].find(([_, cust]) => cust.customerId === customerId)?.[0];
      if (customerSocketId) io.to(customerSocketId).emit("agent_typing", { typing: true });
    } else {
      const agentSocketId = [...activeAgents.entries()].find(([_, agent]) => agent.agentId === data.agentId)?.[0];
      if (agentSocketId) io.to(agentSocketId).emit("customer_typing", { typing: true });
    }
  });

  socket.on("typing_stop", (data) => {
    const { isAgent, customerId } = data;
    if (isAgent) {
      const customerSocketId = [...activeCustomers.entries()].find(([_, cust]) => cust.customerId === customerId)?.[0];
      if (customerSocketId) io.to(customerSocketId).emit("agent_typing", { typing: false });
    } else {
      const agentSocketId = [...activeAgents.entries()].find(([_, agent]) => agent.agentId === data.agentId)?.[0];
      if (agentSocketId) io.to(agentSocketId).emit("customer_typing", { typing: false });
    }
  });

  // --- Disconnect Logic ---
  socket.on("disconnect", async () => {
    console.log("❌ Socket disconnected:", socket.id);

    // Handle Agent Disconnect
    if (activeAgents.has(socket.id)) {
      const agent = activeAgents.get(socket.id);
      console.log(`👨‍💼 Agent ${agent.agentName} disconnected.`);
      await Agent.update({ status: 'away', socketId: null, activeCustomerId: null }, { where: { id: agent.agentId } });
      activeAgents.delete(socket.id);
      broadcastAgentStatus();
    }

    // Handle Customer Disconnect
    if (activeCustomers.has(socket.id)) {
      const customer = activeCustomers.get(socket.id);
      console.log(`👤 Customer ${customer.customerName} disconnected.`);
      
      const conversation = await Conversation.findOne({ where: { customerId: customer.customerId } });
      if (conversation && conversation.AgentId) {
        await Agent.update({ status: 'available', activeCustomerId: null }, { where: { id: conversation.AgentId } });
        broadcastAgentStatus();
      }
      activeCustomers.delete(socket.id);
    }
  });
});

// --- Helper to broadcast agent count ---
function broadcastAgentStatus() {
  Agent.count({ where: { status: 'available' } }).then(count => {
    io.emit("agent_status", { agentCount: count });
  });
}

// --- Start Server ---
const PORT = process.env.PORT || 5000;

// Sync the database before starting the server
db.sync().then(() => {
  server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
});

