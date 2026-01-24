const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

/* ---------------- MEMORY STORE ---------------- */
const agents = new Map();   // socketId → { name, available }
const customers = new Map();

/* ---------------- LOGIN ---------------- */
app.post("/api/agent/login", async (req, res) => {
  const { username, password } = req.body;

  // demo login (replace with DB later)
  if (username === "admin" && password === "1234") {
    return res.json({ success: true, agentName: username });
  }

  res.status(401).json({ error: "Invalid credentials" });
});

/* ---------------- SOCKET ---------------- */
io.on("connection", socket => {
  console.log("🔗 Connected:", socket.id);

  /* AGENT JOIN */
  socket.on("agent_join", ({ agentName }) => {
    agents.set(socket.id, { agentName, available: true });
    console.log("👨‍💼 Agent joined:", agentName);
  });

  /* CUSTOMER JOIN */
  socket.on("customer_join", ({ customerId, customerName }) => {
    customers.set(customerId, socket.id);

    io.emit("new_customer", { customerId, customerName });
    console.log("👤 Customer:", customerName);
  });

  /* CUSTOMER MESSAGE */
  socket.on("customer_message", ({ customerId, message }) => {
    io.emit("customer_message", {
      customerId,
      sender: "customer",
      text: message
    });
  });

  /* AGENT MESSAGE */
  socket.on("agent_message", ({ customerId, message }) => {
    const custSocket = customers.get(customerId);
    if (custSocket) {
      io.to(custSocket).emit("agent_message", {
        sender: "agent",
        text: message
      });
    }
  });

  socket.on("disconnect", () => {
    agents.delete(socket.id);
    console.log("❌ Disconnected:", socket.id);
  });
});

/* ---------------- START ---------------- */
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});
