// =================================================================
// FIXED AND COMPLETE BACKEND CODE
// =================================================================

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
const { v4: uuidv4 } = require('uuid'); // For creating unique IDs
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Be more specific in production
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- In-Memory Database Simulation ---
// In a real application, you would replace this with a connection to a database
// like MongoDB (with Mongoose) or PostgreSQL (with Sequelize).
let conversations = [];
let messages = [];
// ------------------------------------

// Serve frontend files (if you have them in a 'public' folder)
app.use(express.static("public"));

// --- Helper Functions for our "Database" ---
function findConversationByCustomerId(customerId) {
  return conversations.find(conv => conv.customerId === customerId);
}

function findConversationById(conversationId) {
  return conversations.find(conv => conv._id === conversationId);
}

function createConversation(customerId, customerName) {
  const newConversation = {
    _id: uuidv4(),
    customerId: customerId,
    customerName: customerName,
    startTime: new Date(),
    lastMessageTime: new Date(),
    lastMessage: "Conversation started",
    agentId: null,
    status: 'active' // active, closed
  };
  conversations.push(newConversation);
  return newConversation;
}

function saveMessage(conversationId, sender, type, content) {
  const newMessage = {
    _id: uuidv4(),
    conversationId: conversationId,
    sender: sender, // 'Customer Name' or 'Agent Name'
    type: type, // 'user', 'bot', 'agent'
    content: content,
    timestamp: new Date()
  };
  messages.push(newMessage);

  // Update the conversation's last message details
  const conv = findConversationById(conversationId);
  if (conv) {
    conv.lastMessageTime = newMessage.timestamp;
    conv.lastMessage = content;
  }
  return newMessage;
}
// ---------------------------------------------

// Store active agents and customer socket mappings
const activeAgents = new Map();
const customerSockets = new Map(); // Maps customerId to socketId

// --- HTTP API Endpoints ---

// 1. Bot API (EXISTING - NO CHANGES NEEDED)
app.post("/chat", async (req, res) => {
  const { message, customerId } = req.body;

  if (!message) {
    return res.status(400).json({ reply: "Message is empty" });
  }
  
  // Find or create a conversation for this user
  let conversation = findConversationByCustomerId(customerId);
  if (!conversation) {
    conversation = createConversation(customerId, "Unknown Customer");
  }

  // Save the user's message to history
  saveMessage(conversation._id, conversation.customerName, 'user', message);

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a helpful assistant for Tushar Bhumkar Institute." },
          { role: "user", content: message }
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
    
    // Save the bot's reply to history
    saveMessage(conversation._id, 'Bot', 'bot', botReply);

    res.json({ reply: botReply });

  } catch (error) {
    console.error("OpenAI Error:", error.response?.data || error.message);
    res.status(500).json({ reply: "AI failed to respond" });
  }
});

// 2. Get all conversations for Agent Dashboard (NEW)
app.get("/api/conversations", (req, res) => {
  // In a real DB, you would use .populate() to get customer details if they are in another collection
  res.json(conversations);
});

// 3. Get a single conversation's details (NEW)
app.get("/api/conversation/:conversationId", (req, res) => {
  const conversation = findConversationById(req.params.conversationId);
  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  // Get all messages for this conversation
  const conversationMessages = messages.filter(msg => msg.conversationId === conversation._id);

  res.json({
    conversation: conversation,
    messages: conversationMessages
  });
});

// 4. Get conversations for a specific customer (NEW)
app.get("/api/conversations/customer/:customerId", (req, res) => {
  const customerConversations = conversations.filter(conv => conv.customerId === req.params.customerId);
  
  if (customerConversations.length === 0) {
    return res.json([]); // Return empty array if no conversations found
  }

  // For each conversation, get its messages
  const result = customerConversations.map(conv => {
    const convMessages = messages.filter(msg => msg.conversationId === conv._id);
    return {
      conversation: conv,
      messages: convMessages
    };
  });

  res.json(result);
});


// --- WebSocket Connection Handling ---

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Customer joins
  socket.on('customer_join', (data) => {
    const { name, customerId } = data;
    console.log('Customer joined:', data);
    
    // Store the socket mapping
    customerSockets.set(customerId, socket.id);
    
    // Find or create a conversation
    let conversation = findConversationByCustomerId(customerId);
    if (!conversation) {
      conversation = createConversation(customerId, name);
    }

    // Customer joins their own room
    const roomName = `room_${customerId}`;
    socket.join(roomName);
    
    socket.emit('connection_status', { 
      status: 'connected', 
      socketId: socket.id,
      customerId: customerId,
      conversationId: conversation._id
    });
    
    // Notify all agents about new customer
    io.to('agents').emit('new_customer', {
      customerId: customerId,
      customerName: name,
      message: 'New customer joined',
      conversationId: conversation._id
    });
  });

  // Agent joins
  socket.on('agent_join', (data) => {
    console.log('Agent joined:', data);
    activeAgents.set(socket.id, {
      id: socket.id,
      name: data.name,
      status: 'online'
    });
    
    socket.join('agents');
    socket.emit('agent_connected', { status: 'connected' });
    
    // Notify all clients about agent availability
    io.emit('agent_status', { agentCount: activeAgents.size });
  });

  // Customer sends message
  socket.on('customer_message', (data) => {
    const { message, customerName, customerId } = data;
    console.log('Customer message received:', data);

    const conversation = findConversationByCustomerId(customerId);
    if (!conversation) return;

    // Save message to "database"
    const savedMessage = saveMessage(conversation._id, customerName, 'user', message);

    // Broadcast to all agents
    io.to('agents').emit('new_message', {
      customerId: customerId,
      sender: customerName,
      text: message,
      conversationId: conversation._id,
      timestamp: savedMessage.timestamp
    });
  });

  // Agent sends message
  socket.on('agent_message', (data) => {
    const { message, agentName, customerId } = data;
    console.log('Agent message received:', data);

    const conversation = findConversationByCustomerId(customerId);
    if (!conversation) return;

    // Save message to "database"
    const savedMessage = saveMessage(conversation._id, agentName, 'agent', message);

    // Send to specific customer's room
    io.to(`room_${customerId}`).emit('agent_message', {
      text: message,
      timestamp: savedMessage.timestamp
    });
  });

  // Agent joins customer conversation
  socket.on('join_conversation', (data) => {
    const { customerId, agentName } = data;
    console.log('Agent joining conversation:', data);
    
    const conversation = findConversationByCustomerId(customerId);
    if (conversation) {
      // Update conversation with agent info
      conversation.agentId = socket.id;
      
      // Agent joins customer's room
      socket.join(`room_${customerId}`);
      
      // Notify customer that agent joined
      io.to(`room_${customerId}`).emit('agent_joined', {
        agentName: agentName,
        message: `${agentName} has joined the conversation`
      });
    }
  });

  // Handle typing indicators (NO CHANGES NEEDED)
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

  // Handle disconnection (UPDATED)
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Check if it's an agent
    if (activeAgents.has(socket.id)) {
      activeAgents.delete(socket.id);
      io.emit('agent_status', { agentCount: activeAgents.size });
      return;
    }

    // Check if it's a customer
    let disconnectedCustomerId = null;
    customerSockets.forEach((socketId, customerId) => {
      if (socketId === socket.id) {
        disconnectedCustomerId = customerId;
        customerSockets.delete(customerId);

        // Update conversation status
        const conversation = findConversationByCustomerId(customerId);
        if (conversation) {
          conversation.status = 'closed';
        }
      }
    });
    
    // Notify agents about customer disconnect
    if (disconnectedCustomerId) {
      io.to('agents').emit('customer_disconnected', {
        customerId: disconnectedCustomerId
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔌 WebSocket server ready for real-time chat`);
});
