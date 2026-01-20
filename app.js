require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { Pool } = require("pg");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

/* =======================
   DB CONNECT (INLINE)
======================= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* =======================
   AGENT LOGIN
======================= */
app.post("/api/agent/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM agents WHERE username=$1",
      [username]
    );

    if (result.rowCount === 0)
      return res.status(401).json({ error: "Invalid credentials" });

    const agent = result.rows[0];
    const ok = await bcrypt.compare(password, agent.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { agentId: agent.id },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    await pool.query(
      "UPDATE agents SET status='online', last_seen=NOW() WHERE id=$1",
      [agent.id]
    );

    res.json({
      token,
      agentId: agent.id,
      name: agent.full_name || agent.username
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   CLIENT START CHAT
======================= */
app.post("/api/start-chat", async (req, res) => {
  try {
    const { name } = req.body;
    const customerId = uuidv4();
    const conversationId = uuidv4();

    await pool.query(
      "INSERT INTO customers (id,name) VALUES ($1,$2)",
      [customerId, name]
    );

    await pool.query(
      `INSERT INTO conversations (id,customer_id,customer_name)
       VALUES ($1,$2,$3)`,
      [conversationId, customerId, name]
    );

    res.json({ customerId, conversationId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   AGENT DASHBOARD
======================= */
app.get("/api/conversations", async (req, res) => {
  const result = await pool.query(
    `SELECT id, customer_name, unread_count, mode, created_at
     FROM conversations
     ORDER BY created_at DESC`
  );
  res.json(result.rows);
});

/* =======================
   GET MESSAGES
======================= */
app.get("/api/messages/:cid", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM messages WHERE conversation_id=$1 ORDER BY created_at",
    [req.params.cid]
  );
  res.json(result.rows);
});

/* =======================
   SOCKET.IO
======================= */
io.on("connection", (socket) => {
  console.log("Socket connected", socket.id);

  socket.on("customer_join", ({ conversationId }) => {
    socket.join(conversationId);
  });

  socket.on("agent_join", ({ agentId }) => {
    socket.agentId = agentId;
  });

  socket.on("join_conversation", async ({ conversationId }) => {
    socket.join(conversationId);
    await pool.query(
      "UPDATE conversations SET unread_count=0, mode='human' WHERE id=$1",
      [conversationId]
    );
  });

  socket.on("customer_message", async ({ conversationId, name, message }) => {
    await pool.query(
      `INSERT INTO messages
       (conversation_id,sender,sender_type,message)
       VALUES ($1,$2,'customer',$3)`,
      [conversationId, name, message]
    );

    await pool.query(
      "UPDATE conversations SET unread_count=unread_count+1 WHERE id=$1",
      [conversationId]
    );

    io.to(conversationId).emit("new_message", {
      sender: name,
      text: message,
      type: "user"
    });
  });

  socket.on("agent_message", async ({ conversationId, agentName, message }) => {
    await pool.query(
      `INSERT INTO messages
       (conversation_id,sender,sender_type,message)
       VALUES ($1,$2,'agent',$3)`,
      [conversationId, agentName, message]
    );

    io.to(conversationId).emit("new_message", {
      sender: agentName,
      text: message,
      type: "agent"
    });
  });

  socket.on("disconnect", async () => {
    if (socket.agentId) {
      await pool.query(
        "UPDATE agents SET status='offline', last_seen=NOW() WHERE id=$1",
        [socket.agentId]
      );
    }
  });
});

/* =======================
   START SERVER
======================= */
server.listen(process.env.PORT, () => {
  console.log(`✅ Server running on port ${process.env.PORT}`);
});
