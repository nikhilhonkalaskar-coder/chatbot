// =================================================================
// BACKEND WITH SINGLE-AGENT QUEUEING LOGIC
// =================================================================

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
const { v4: uuidv4 } = require('uuid');
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

app.use(cors());
app.use(express.json());

// --- In-Memory Database Simulation ---
let conversations = [];
let messages = [];
// ------------------------------------

// --- Helper Functions for our "Database" ---
function findConversationByCustomerId(customerId) {
  return conversations.find(conv => conv.customerId === customerId);
}
function createConversation(customerId, customerName) {
  const newConversation = { _id: uuidv4(), customerId: customerId, customerName: customerName, startTime: new Date(), lastMessageTime: new Date(), lastMessage: "Conversation started", agentId: null, status: 'active' };
  conversations.push(newConversation);
  return newConversation;
}
function saveMessage(conversationId, sender, type, content) {
  const newMessage = { _id: uuidv4(), conversationId: conversationId, sender: sender, type: type, content: content, timestamp: new Date() };
  messages.push(newMessage);
  const conv = conversations.find(c => c._id === conversationId);
  if (conv) { conv.lastMessageTime = newMessage.timestamp; conv.lastMessage = content; }
  return newMessage;
}
// ---------------------------------------------

// Store active agents and customer socket mappings
const activeAgents = new Map();
const customerSockets = new Map();
// NEW: Queue to hold agent requests when the agent is busy
const pendingAgentRequests = [];

// --- HTTP API Endpoints (History Only) ---
app.get("/api/conversations", (req, res) => { res.json(conversations); });
app.get("/api/conversation/:conversationId", (req, res) => {
  const conversation = conversations.find(conv => conv._id === req.params.conversationId);
  if (!conversation) { return res.status(404).json({ error: "Conversation not found" }); }
  const conversationMessages = messages.filter(msg => msg.conversationId === conversation._id);
  res.json({ conversation: conversation, messages: conversationMessages });
});
app.get("/api/conversations/customer/:customerId", (req, res) => {
  const customerConversations = conversations.filter(conv => conv.customerId === req.params.customerId);
  const result = customerConversations.map(conv => {
    const convMessages = messages.filter(msg => msg.conversationId === conv._id);
    return { conversation: conv, messages: convMessages };
  });
  res.json(result);
});

// --- WebSocket Connection Handling ---

io.on('connection', (socket) => {
  console.log('🌐 New client connected:', socket.id);

  socket.on('customer_join', (data) => {
    const { name, customerId } = data;
    console.log(`👤 CUSTOMER JOIN: ${name} (${customerId}) on socket ${socket.id}`);
    customerSockets.set(customerId, socket.id);
    let conversation = findConversationByCustomerId(customerId);
    if (!conversation) { conversation = createConversation(customerId, name); }
    const roomName = `room_${customerId}`;
    socket.join(roomName);
    socket.emit('connection_status', { status: 'connected', socketId: socket.id, customerId: customerId, conversationId: conversation._id });
    io.to('agents').emit('new_customer', { customerId: customerId, customerName: name, message: 'New customer joined', conversationId: conversation._id });
  });

  socket.on('agent_join', (data) => {
    const agentName = data.name || 'Unknown Agent';
    console.log(`👨‍💼 AGENT JOIN: ${agentName} on socket ${socket.id}`);
    // MODIFIED: Store agent with status
    activeAgents.set(socket.id, { id: socket.id, name: agentName, status: 'available', currentCustomerId: null });
    console.log(`📊 Active agents count is now: ${activeAgents.size}`);
    socket.join('agents');
    socket.emit('agent_connected', { status: 'connected' });
    io.emit('agent_status', { agentCount: activeAgents.size });
  });

  socket.on('customer_message', async (data) => {
    const { message, customerName, customerId } = data;
    console.log(`💬 CUSTOMER MESSAGE from ${customerName} (${customerId}): "${message}"`);
    let conversation = findConversationByCustomerId(customerId);
    if (!conversation) { conversation = createConversation(customerId, customerName); }
    const savedUserMessage = saveMessage(conversation._id, customerName, 'user', message);
    io.to('agents').emit('new_message', { customerId: customerId, sender: customerName, text: message, conversationId: conversation._id, timestamp: savedUserMessage.timestamp });
    if (conversation.agentId) { console.log(`-> Message routed to agent ${conversation.agentId}.`); return; }
    try {
      const response = await axios.post("https://api.openai.com/v1/chat/completions", { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are a helpful assistant for Tushar Bhumkar Institute." }, { role: "user", content: message }], max_tokens: 200, temperature: 0.7 }, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" } });
      const botReply = response.data?.choices?.[0]?.message?.content || "I'm sorry, I can't help with that right now.";
      const savedBotMessage = saveMessage(conversation._id, 'Bot', 'bot', botReply);
      io.to(`room_${customerId}`).emit('agent_message', { text: botReply, timestamp: savedBotMessage.timestamp });
      io.to('agents').emit('new_message', { customerId: customerId, sender: 'Bot', text: botReply, conversationId: conversation._id, timestamp: savedBotMessage.timestamp });
    } catch (error) { console.error("OpenAI Error:", error.response?.data || error.message); const errorMessage = "I'm experiencing technical difficulties. Please try again later."; const savedErrorMessage = saveMessage(conversation._id, 'Bot', 'bot', errorMessage); io.to(`room_${customerId}`).emit('agent_message', { text: errorMessage, timestamp: savedErrorMessage.timestamp }); }
  });

  socket.on('agent_message', (data) => {
    const { message, agentName, customerId } = data;
    console.log(`👨‍💼 AGENT MESSAGE from ${agentName} to ${customerId}: "${message}"`);
    const conversation = findConversationByCustomerId(customerId);
    if (!conversation) return;
    const savedMessage = saveMessage(conversation._id, agentName, 'agent', message);
    io.to(`room_${customerId}`).emit('agent_message', { text: message, timestamp: savedMessage.timestamp });
  });

  // *** MODIFIED: Agent Request Logic with Queuing ***
  socket.on('request_agent', (data) => {
    const { customerId, customerName } = data;
    console.log(`\n🙋‍♂️ AGENT REQUEST RECEIVED from ${customerName} (${customerId})`);
    
    // Find the first available agent (assuming single agent system)
    const availableAgent = Array.from(activeAgents.values()).find(agent => agent.status === 'available');

    if (!availableAgent) {
      console.log('❌ DECISION: No available agents. Queuing request.');
      // Add request to the queue
      const requestExists = pendingAgentRequests.find(req => req.customerId === customerId);
      if (!requestExists) {
        pendingAgentRequests.push({ customerId, customerName, timestamp: new Date() });
      }

      // Notify ALL agents (even if busy) about the new request
      io.to('agents').emit('new_agent_request', { customerId, customerName });
      
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
    
    io.to(agentSocketId).emit('join_customer_room', { customerId, customerName, message: `${customerName} is requesting assistance.` });
    io.to(`room_${customerId}`).emit('agent_is_connecting', { message: 'An agent is connecting to your chat now...' });
  });
  // *********************************************

  // *** NEW: Event for agent to accept a queued request ***
  socket.on('accept_customer_request', (data) => {
    const { customerId } = data;
    const agent = activeAgents.get(socket.id);

    if (!agent) {
      console.log(`❌ Error: Agent with socket ${socket.id} not found.`);
      return;
    }

    console.log(`✅ Agent "${agent.name}" is accepting request from ${customerId}`);
    
    // Find and remove the request from the queue
    const requestIndex = pendingAgentRequests.findIndex(req => req.customerId === customerId);
    if (requestIndex > -1) {
      pendingAgentRequests.splice(requestIndex, 1);
    }
    
    // Update agent status
    agent.status = 'busy';
    agent.currentCustomerId = customerId;

    // Join the customer's room
    socket.join(`room_${customerId}`);
    
    // Update conversation with agent ID
    const conversation = findConversationByCustomerId(customerId);
    if (conversation) {
      conversation.agentId = socket.id;
    }

    // Notify customer that agent has joined
    io.to(`room_${customerId}`).emit('agent_joined', { agentName: agent.name, message: `${agent.name} has joined the conversation` });
    
    // Notify agent dashboard to switch to this conversation
    socket.emit('switch_to_conversation', { customerId });
  });
  // *********************************************

  socket.on('join_conversation', (data) => {
    const { customerId, agentName } = data;
    console.log(`🔗 AGENT "${agentName}" is joining conversation with ${customerId}`);
    const conversation = findConversationByCustomerId(customerId);
    if (conversation) {
      const agent = activeAgents.get(socket.id);
      if (agent) {
        agent.status = 'busy';
        agent.currentCustomerId = customerId;
      }
      conversation.agentId = socket.id;
      socket.join(`room_${customerId}`);
      io.to(`room_${customerId}`).emit('agent_joined', { agentName: agentName, message: `${agentName} has joined the conversation` });
    }
  });

  socket.on('typing_start', (data) => { if (data.isAgent && data.customerId) { io.to(`room_${data.customerId}`).emit('agent_typing', { typing: true }); } else if (!data.isAgent) { io.to('agents').emit('customer_typing', { typing: true, customerId: data.customerId }); } });
  socket.on('typing_stop', (data) => { if (data.isAgent && data.customerId) { io.to(`room_${data.customerId}`).emit('agent_typing', { typing: false }); } else if (!data.isAgent) { io.to('agents').emit('customer_typing', { typing: false, customerId: data.customerId }); } });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    if (activeAgents.has(socket.id)) {
      const agent = activeAgents.get(socket.id);
      console.log(`👨‍💼 AGENT LEAVE: "${agent.name}" has disconnected.`);
      activeAgents.delete(socket.id);
      console.log(`📊 Active agents count is now: ${activeAgents.size}`);
      io.emit('agent_status', { agentCount: activeAgents.size });
      return;
    }
    let disconnectedCustomerId = null;
    customerSockets.forEach((socketId, customerId) => { if (socketId === socket.id) { disconnectedCustomerId = customerId; customerSockets.delete(customerId); const conversation = findConversationByCustomerId(customerId); if (conversation) { conversation.status = 'closed'; } } });
    if (disconnectedCustomerId) { 
      console.log(`👤 CUSTOMER LEAVE: ${disconnectedCustomerId} has disconnected.`);
      // MODIFIED: If the disconnected customer was the one the agent was talking to, make agent available again.
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
});
