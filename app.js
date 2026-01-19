const express = require("express");
const axios = require("axios");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
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

// Serve frontend
app.use(express.static("public"));

// Store active agents and conversations
const activeAgents = new Map();
const conversations = new Map();

// Chat API
app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  if (!userMessage) {
    return res.json({ reply: "Message is empty" });
  }

  try {
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

    const botReply =
      response.data?.choices?.[0]?.message?.content ||
      "No response from AI";

    res.json({ reply: botReply });

  } catch (error) {
    console.error("OpenAI Error:", error.response?.data || error.message);
    res.status(500).json({ reply: "AI failed to respond" });
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Customer joins
  socket.on('customer_join', (data) => {
    socket.join(`customer_${socket.id}`);
    socket.emit('connection_status', { status: 'connected', socketId: socket.id });
    
    // Notify all agents about new customer
    socket.broadcast.emit('new_customer', {
      customerId: socket.id,
      customerName: data.name || `Customer_${socket.id.slice(0, 6)}`,
      message: 'New customer joined'
    });
  });

  // Agent joins
  socket.on('agent_join', (data) => {
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
    const messageData = {
      id: Date.now(),
      type: 'customer',
      text: data.message,
      sender: data.customerName || `Customer_${socket.id.slice(0, 6)}`,
      timestamp: new Date().toISOString(),
      customerId: socket.id
    };

    // Broadcast to all agents
    io.to('agents').emit('new_message', messageData);
    
    // Send back to customer for their own chat
    socket.emit('message_sent', messageData);
  });

  // Agent sends message
  socket.on('agent_message', (data) => {
    const messageData = {
      id: Date.now(),
      type: 'agent',
      text: data.message,
      sender: data.agentName,
      timestamp: new Date().toISOString(),
      agentId: socket.id
    };

    // Send to specific customer
    if (data.customerId) {
      io.to(`customer_${data.customerId}`).emit('agent_message', messageData);
    }
    
    // Send confirmation to agent
    socket.emit('message_sent', messageData);
  });

  // Agent joins customer conversation
  socket.on('join_conversation', (data) => {
    const customerId = data.customerId;
    socket.join(`conversation_${customerId}`);
    
    // Notify customer that agent joined
    io.to(`customer_${customerId}`).emit('agent_joined', {
      agentName: data.agentName,
      message: `${data.agentName} has joined the conversation`
    });
  });

  // Handle typing indicators
  socket.on('typing_start', (data) => {
    if (data.isAgent) {
      io.to(`customer_${data.customerId}`).emit('agent_typing', { typing: true });
    } else {
      io.to('agents').emit('customer_typing', { 
        typing: true, 
        customerId: socket.id 
      });
    }
  });

  socket.on('typing_stop', (data) => {
    if (data.isAgent) {
      io.to(`customer_${data.customerId}`).emit('agent_typing', { typing: false });
    } else {
      io.to('agents').emit('customer_typing', { 
        typing: false, 
        customerId: socket.id 
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Remove from active agents if it's an agent
    if (activeAgents.has(socket.id)) {
      activeAgents.delete(socket.id);
      io.emit('agent_status', { agentCount: activeAgents.size });
    }
    
    // Notify agents about customer disconnect
    socket.broadcast.emit('customer_disconnected', {
      customerId: socket.id
    });
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔌 WebSocket server ready for real-time chat`);
});
