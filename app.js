const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

let agents = new Set();    // connected agent socket ids
let clients = new Map();   // clientSocketId => agentSocketId (1:1 mapping)

// Socket.IO connection handler
io.on("connection", (socket) => {
  console.log("New socket connected:", socket.id);

  socket.on("register-agent", () => {
    agents.add(socket.id);
    console.log("Agent registered:", socket.id);
  });

  socket.on("register-client", () => {
    // For simplicity, assign this client to any agent available (round-robin)
    if (agents.size === 0) {
      socket.emit("no-agent", "No agents are currently online. Please wait.");
      return;
    }
    // Assign agent
    const agentId = Array.from(agents)[Math.floor(Math.random() * agents.size)];
    clients.set(socket.id, agentId);
    // Inform agent that client connected
    io.to(agentId).emit("client-connected", socket.id);
    console.log(`Client ${socket.id} assigned to agent ${agentId}`);
  });

  // Client sends message to agent
  socket.on("client-message", (msg) => {
    const agentId = clients.get(socket.id);
    if (agentId) {
      io.to(agentId).emit("client-message", { clientId: socket.id, message: msg });
    }
  });

  // Agent sends message to client
  socket.on("agent-message", ({ clientId, message }) => {
    io.to(clientId).emit("agent-message", message);
  });

  // Handle disconnects
  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);

    if (agents.has(socket.id)) {
      agents.delete(socket.id);
      // Optionally notify clients assigned to this agent
      for (const [clientId, agentId] of clients.entries()) {
        if (agentId === socket.id) {
          io.to(clientId).emit("agent-disconnected");
          clients.delete(clientId);
        }
      }
    } else if (clients.has(socket.id)) {
      const agentId = clients.get(socket.id);
      clients.delete(socket.id);
      if (agentId) {
        io.to(agentId).emit("client-disconnected", socket.id);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
