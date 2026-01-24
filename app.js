const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());

/* ================= HTTP API ROUTES ================= */

// Agent Login Route
app.post('/api/agent/login', (req, res) => {
  // Accept either username or agentName for flexibility
  const { username, agentName, password } = req.body;
  const name = username || agentName;
  
  if (!name) {
    return res.status(400).json({ error: 'Agent name is required' });
  }
  
  // In a real app, you would verify credentials against a database here
  // For this example, we'll just accept any password
  
  res.status(200).json({ 
    success: true, 
    message: 'Login successful',
    agentName: name,
    token: 'sample_token_' + Math.random().toString(36).substring(7) // Generate a simple token
  });
});

// Customer Login Route
app.post('/api/customer/login', (req, res) => {
  const { customerId, name } = req.body;
  
  if (!customerId || !name) {
    return res.status(400).json({ error: 'Customer ID and name are required' });
  }
  
  res.status(200).json({ 
    success: true, 
    message: 'Login successful',
    customerId,
    conversationId: `conv_${customerId}`,
    token: 'sample_token_' + Math.random().toString(36).substring(7) // Generate a simple token
  });
});

// Add mock endpoints for conversation history that the client expects
app.get('/api/conversations', (req, res) => {
  // Return empty array for now
  res.status(200).json([]);
});

app.get('/api/conversation/:id', (req, res) => {
  // Return mock data for now
  res.status(200).json({
    conversation: {
      id: req.params.id,
      customer_id: `Customer ${req.params.id}`,
      created_at: new Date().toISOString(),
      status: "Active"
    },
    messages: []
  });
});

/* ================= SOCKET.IO SETUP ================= */

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

/* ================= DATA STORES ================= */

const agents = new Map(); 
// socketId → { name, available, activeCustomer }

const customers = new Map(); 
// customerId → socketId

/* ================= SOCKET EVENTS ================= */

io.on("connection", (socket) => {
  console.log("🔗 Connected:", socket.id);

  /* ---------- AGENT JOIN ---------- */
  socket.on("agent_join", ({ agentName }) => {
    agents.set(socket.id, {
      name: agentName,
      available: true,
      activeCustomer: null
    });

    console.log("👨‍💼 Agent online:", agentName);
    broadcastAgentStatus();
    
    // Send confirmation back to the agent
    socket.emit("agent_join_confirmed", { agentName });
  });

  /* ---------- CUSTOMER JOIN ---------- */
  socket.on("customer_join", ({ customerId, name }) => {
    customers.set(customerId, socket.id);

    socket.emit("connection_status", {
      customerId,
      conversationId: `conv_${customerId}`
    });

    console.log("👤 Customer joined:", name, customerId);

    socket.emit("agent_message", {
      sender: "Bot",
      text: "Hello! How can I help you today?"
    });

    broadcastAgentStatus();
  });

  /* ---------- CUSTOMER MESSAGE ---------- */
  socket.on("customer_message", ({ customerId, message }) => {
    // forward message to agent if assigned
    for (let [agentSocketId, agent] of agents.entries()) {
      if (agent.activeCustomer === customerId) {
        io.to(agentSocketId).emit("customer_message", {
          customerId,
          message
        });
        return;
      }
    }

    // otherwise bot reply fallback
    io.to(customers.get(customerId)).emit("agent_message", {
      sender: "Bot",
      text: "Type 'Switch to Human Agent' to talk to our support team."
    });
  });

  /* ---------- REQUEST AGENT ---------- */
  socket.on("request_agent", ({ customerId, customerName }) => {
    const freeAgentEntry = [...agents.entries()]
      .find(([_, a]) => a.available);

    if (!freeAgentEntry) {
      socket.emit("agent_request_failed", {
        message: "All agents are busy right now."
      });
      return;
    }

    const [agentSocketId, agent] = freeAgentEntry;

    agent.available = false;
    agent.activeCustomer = customerId;

    io.to(customers.get(customerId)).emit("agent_is_connecting", {
      message: "Connecting you to a human agent..."
    });

    io.to(customers.get(customerId)).emit("agent_joined", {
      agentName: agent.name,
      message: `${agent.name} joined the chat`
    });

    io.to(agentSocketId).emit("assign_customer", {
      customerId,
      customerName
    });

    console.log("✅ Agent assigned:", agent.name, "→", customerId);
    broadcastAgentStatus();
  });

  /* ---------- AGENT MESSAGE ---------- */
  socket.on("agent_message", ({ customerId, message }) => {
    const customerSocket = customers.get(customerId);
    if (!customerSocket) return;

    io.to(customerSocket).emit("agent_message", {
      sender: "Agent",
      text: message
    });
  });

  /* ---------- TYPING ---------- */
  socket.on("typing_start", ({ customerId }) => {
    forwardToAgent(customerId, "agent_typing", { typing: true });
  });

  socket.on("typing_stop", ({ customerId }) => {
    forwardToAgent(customerId, "agent_typing", { typing: false });
  });

  /* ---------- AGENT STATUS ---------- */
  socket.on("get_agent_status", () => {
    socket.emit("agent_status", {
      agentCount: [...agents.values()].filter(a => a.available).length
    });
  });

  /* ---------- JOIN CONVERSATION ---------- */
  socket.on("join_conversation", ({ customerId, agentName }) => {
    // Find the agent and update their active customer
    for (let [agentSocketId, agent] of agents.entries()) {
      if (agent.name === agentName) {
        agent.activeCustomer = customerId;
        agent.available = false;
        console.log(`Agent ${agentName} joined conversation with ${customerId}`);
        broadcastAgentStatus();
        break;
      }
    }
  });

  /* ---------- UPDATE AGENT STATUS ---------- */
  socket.on("update_agent_status", ({ status }) => {
    // Find the agent and update their status
    for (let [agentSocketId, agent] of agents.entries()) {
      if (agentSocketId === socket.id) {
        agent.available = status === "available";
        console.log(`Agent ${agent.name} status updated to ${status}`);
        broadcastAgentStatus();
        break;
      }
    }
  });

  /* ---------- DISCONNECT ---------- */
  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);

    if (agents.has(socket.id)) {
      agents.delete(socket.id);
      broadcastAgentStatus();
    }
  });
});

/* ================= HELPERS ================= */

function forwardToAgent(customerId, event, payload) {
  for (let [agentSocketId, agent] of agents.entries()) {
    if (agent.activeCustomer === customerId) {
      io.to(agentSocketId).emit(event, payload);
      return;
    }
  }
}

function broadcastAgentStatus() {
  io.emit("agent_status", {
    agentCount: [...agents.values()].filter(a => a.available).length
  });
}

/* ================= START SERVER ================= */

const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on ${PORT}`)
);
