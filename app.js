// =================================================================
// COMPLETE & FIXED BACKEND CODE - UNIFIED MESSAGE FLOW
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
  console.log('New client connected:', socket.id);

  socket.on('customer_join', (data) => {
    const { name, customerId } = data;
    customerSockets.set(customerId, socket.id);
    let conversation = findConversationByCustomerId(customerId);
    if (!conversation) { conversation = createConversation(customerId, name); }
    const roomName = `room_${customerId}`;
    socket.join(roomName);
    socket.emit('connection_status', { status: 'connected', socketId: socket.id, customerId: customerId, conversationId: conversation._id });
    io.to('agents').emit('new_customer', { customerId: customerId, customerName: name, message: 'New customer joined', conversationId: conversation._id });
  });

  socket.on('agent_join', (data) => {
    activeAgents.set(socket.id, { id: socket.id, name: data.name, status: 'online' });
    socket.join('agents');
    socket.emit('agent_connected', { status: 'connected' });
    io.emit('agent_status', { agentCount: activeAgents.size });
  });

  // *** MAJOR CHANGE: All messages now come through here ***
  socket.on('customer_message', async (data) => {
    const { message, customerName, customerId } = data;
    console.log('Customer message received:', data);

    let conversation = findConversationByCustomerId(customerId);
    if (!conversation) { conversation = createConversation(customerId, customerName); }

    // 1. Save the customer's message to history
    const savedUserMessage = saveMessage(conversation._id, customerName, 'user', message);

    // 2. Broadcast the customer's message to all agents
    io.to('agents').emit('new_message', {
      customerId: customerId,
      sender: customerName,
      text: message,
      conversationId: conversation._id,
      timestamp: savedUserMessage.timestamp
    });

    // 3. Check if an agent is already in the conversation
    if (conversation.agentId) {
      // An agent is handling this, do nothing else.
      console.log(`Agent ${conversation.agentId} is handling conversation for ${customerId}`);
      return;
    }

    // 4. No agent is present, so get a bot reply
    try {
      const response = await axios.post("https://api.openai.com/v1/chat/completions", {
        model: "gpt-4o-mini", messages: [{ role: "system", content: "You are a helpful assistant for Tushar Bhumkar Institute." }, { role: "user", content: message }], max_tokens: 200, temperature: 0.7
      }, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" } });

      const botReply = response.data?.choices?.[0]?.message?.content || "I'm sorry, I can't help with that right now.";
      
      // 5. Save the bot's reply to history
      const savedBotMessage = saveMessage(conversation._id, 'Bot', 'bot', botReply);

      // 6. Send the bot's reply back to the customer
      io.to(`room_${customerId}`).emit('agent_message', { // Re-using agent_message for simplicity on the frontend
        text: botReply,
        timestamp: savedBotMessage.timestamp
      });

      // 7. Broadcast the bot's reply to agents so they see the full history
      io.to('agents').emit('new_message', {
        customerId: customerId,
        sender: 'Bot',
        text: botReply,
        conversationId: conversation._id,
        timestamp: savedBotMessage.timestamp
      });

    } catch (error) {
      console.error("OpenAI Error:", error.response?.data || error.message);
      const errorMessage = "I'm experiencing technical difficulties. Please try again later.";
      const savedErrorMessage = saveMessage(conversation._id, 'Bot', 'bot', errorMessage);
      io.to(`room_${customerId}`).emit('agent_message', { text: errorMessage, timestamp: savedErrorMessage.timestamp });
    }
  });

  socket.on('agent_message', (data) => {
    const { message, agentName, customerId } = data;
    const conversation = findConversationByCustomerId(customerId);
    if (!conversation) return;
    const savedMessage = saveMessage(conversation._id, agentName, 'agent', message);
    io.to(`room_${customerId}`).emit('agent_message', { text: message, timestamp: savedMessage.timestamp });
  });

  socket.on('request_agent', (data) => {
    const { customerId, customerName } = data;
    if (activeAgents.size === 0) { io.to(`room_${customerId}`).emit('agent_request_failed', { message: 'All our agents are currently busy. Please try again later.' }); return; }
    const agentSocketIds = Array.from(activeAgents.keys()); const assignedAgentSocketId = agentSocketIds[0];
    io.to(assignedAgentSocketId).emit('join_customer_room', { customerId: customerId, customerName: customerName, message: `${customerName} is requesting assistance.` });
    io.to(`room_${customerId}`).emit('agent_is_connecting', { message: 'An agent is connecting to your chat now...' });
  });

  socket.on('join_conversation', (data) => {
    const { customerId, agentName } = data;
    const conversation = findConversationByCustomerId(customerId);
    if (conversation) {
      conversation.agentId = socket.id;
      socket.join(`room_${customerId}`);
      io.to(`room_${customerId}`).emit('agent_joined', { agentName: agentName, message: `${agentName} has joined the conversation` });
    }
  });

  socket.on('typing_start', (data) => {
    if (data.isAgent && data.customerId) { io.to(`room_${data.customerId}`).emit('agent_typing', { typing: true }); }
    else if (!data.isAgent) { io.to('agents').emit('customer_typing', { typing: true, customerId: data.customerId }); }
  });

  socket.on('typing_stop', (data) => {
    if (data.isAgent && data.customerId) { io.to(`room_${data.customerId}`).emit('agent_typing', { typing: false }); }
    else if (!data.isAgent) { io.to('agents').emit('customer_typing', { typing: false, customerId: data.customerId }); }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    if (activeAgents.has(socket.id)) { activeAgents.delete(socket.id); io.emit('agent_status', { agentCount: activeAgents.size }); return; }
    let disconnectedCustomerId = null;
    customerSockets.forEach((socketId, customerId) => { if (socketId === socket.id) { disconnectedCustomerId = customerId; customerSockets.delete(customerId); const conversation = findConversationByCustomerId(customerId); if (conversation) { conversation.status = 'closed'; } } });
    if (disconnectedCustomerId) { io.to('agents').emit('customer_disconnected', { customerId: disconnectedCustomerId }); }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
