const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

/* ---------------- STATE ---------------- */

const agents = new Map(); // socketId -> { name, status, load }
const customers = new Map(); // customerId -> socketId
const activeChats = new Map(); // customerId -> agentSocketId

/* ---------------- SOCKET ---------------- */

io.on("connection", (socket) => {
  console.log("🔗 Connected:", socket.id);

  /* -------- AGENT JOIN -------- */
  socket.on("agent_join", ({ agentName }) => {
    agents.set(socket.id, {
      name: agentName,
      status: "available",
      load: 0,
    });

    socket.join("agents");
    emitAgentStatus();
    console.log("👨‍💼 Agent online:", agentName);
  });

  /* -------- CUSTOMER JOIN -------- */
  socket.on("customer_join", ({ customerId, name }) => {
    customers.set(customerId, socket.id);
    socket.join(customerId);

    socket.emit("connection_status", {
      customerId,
      conversationId: customerId,
    });

    console.log("👤 Customer joined:", customerId, name);
  });

  /* -------- AGENT STATUS -------- */
  socket.on("get_agent_status", () => {
    emitAgentStatus(socket);
  });

  function emitAgentStatus(target = io) {
    const available = [...agents.values()].filter(
      (a) => a.status === "available"
    );
    target.emit("agent_status", { agentCount: available.length });
  }

  /* -------- REQUEST AGENT -------- */
  socket.on("request_agent", ({ customerId, customerName }) => {
    const availableAgents = [...agents.entries()].filter(
      ([, a]) => a.status === "available"
    );

    if (!availableAgents.length) {
      socket.emit("agent_request_failed", {
        message: "No agents available right now.",
      });
      return;
    }

    // Pick least-loaded agent
    availableAgents.sort((a, b) => a[1].load - b[1].load);
    const [agentSocketId, agent] = availableAgents[0];

    agent.status = "busy";
    agent.load++;

    activeChats.set(customerId, agentSocketId);

    io.to(agentSocketId).emit("new_customer", {
      customerId,
      customerName,
    });

    io.to(customerId).emit("agent_is_connecting", {
      message: "Agent is joining the chat…",
    });

    io.to(customerId).emit("agent_joined", {
      agentName: agent.name,
      message: `${agent.name} joined the chat`,
    });

    emitAgentStatus();
    console.log("✅ Agent assigned:", agent.name, customerId);
  });

  /* -------- CUSTOMER MESSAGE -------- */
  socket.on("customer_message", ({ customerId, message }) => {
    const agentSocketId = activeChats.get(customerId);

    if (agentSocketId) {
      io.to(agentSocketId).emit("agent_message", {
        sender: "Customer",
        text: message,
        customerId,
      });
    } else {
      // BOT fallback
      let reply = "Type 'agent' to talk to a human 👨‍💼";
      if (message.toLowerCase().includes("course"))
        reply = "We offer Basic & Advanced Market Workshops 📈";
      if (message.toLowerCase().includes("price"))
        reply = "Pricing starts from ₹1999";

      socket.emit("agent_message", {
        sender: "Bot",
        text: reply,
      });
    }
  });

  /* -------- AGENT MESSAGE -------- */
  socket.on("agent_message", ({ customerId, message }) => {
    io.to(customerId).emit("agent_message", {
      sender: agents.get(socket.id)?.name || "Agent",
      text: message,
    });
  });

  /* -------- TYPING -------- */
  socket.on("typing_start", ({ customerId }) => {
    const agentSocketId = activeChats.get(customerId);
    if (agentSocketId)
      io.to(agentSocketId).emit("agent_typing", { typing: true });
  });

  socket.on("typing_stop", ({ customerId }) => {
    const agentSocketId = activeChats.get(customerId);
    if (agentSocketId)
      io.to(agentSocketId).emit("agent_typing", { typing: false });
  });

  /* -------- DISCONNECT -------- */
  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);

    if (agents.has(socket.id)) {
      agents.delete(socket.id);
      emitAgentStatus();
    }

    for (const [customerId, agentSocketId] of activeChats.entries()) {
      if (agentSocketId === socket.id) {
        activeChats.delete(customerId);
        io.to(customerId).emit("agent_request_failed", {
          message: "Agent disconnected. Back to bot.",
        });
      }
    }
  });
});

/* ---------------- START ---------------- */

const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
