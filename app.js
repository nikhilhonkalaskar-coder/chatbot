const express = require("express");
const http = require("http");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");
const pool = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

/* ================== GLOBAL STATE ================== */

const agentLoad = new Map(); // agentName → active chats
const customerAgentMap = new Map(); // customerId → agentSocketId
const inactivityTimers = new Map();

const AGENT_TIMEOUT = 2 * 60 * 1000; // 2 mins

/* ================== HELPERS ================== */

async function getOrCreateConversation(customerId) {
  const res = await pool.query(
    "SELECT * FROM conversations WHERE customer_id=$1",
    [customerId]
  );
  if (res.rows.length) return res.rows[0];

  const created = await pool.query(
    "INSERT INTO conversations (customer_id,status) VALUES ($1,$2) RETURNING *",
    [customerId, "bot"]
  );
  return created.rows[0];
}

function resetTimeout(customerId) {
  if (inactivityTimers.has(customerId)) {
    clearTimeout(inactivityTimers.get(customerId));
  }

  const timer = setTimeout(async () => {
    await pool.query(
      `UPDATE conversations
       SET status='bot', agent_socket_id=NULL
       WHERE customer_id=$1`,
      [customerId]
    );

    customerAgentMap.delete(customerId);

    io.to(`room_${customerId}`).emit("system_message", {
      message: "Agent went offline. Bot is back 🤖",
    });
  }, AGENT_TIMEOUT);

  inactivityTimers.set(customerId, timer);
}

/* ================== AUTH ================== */

app.post("/api/agent/login", async (req, res) => {
  const { username, password } = req.body;

  const result = await pool.query(
    "SELECT * FROM agents WHERE username=$1",
    [username]
  );

  if (!result.rows.length)
    return res.status(401).json({ error: "Invalid credentials" });

  const agent = result.rows[0];
  const ok = await bcrypt.compare(password, agent.password_hash);

  if (!ok)
    return res.status(401).json({ error: "Invalid credentials" });

  res.json({ success: true, agentName: agent.username });
});

/* ================== SOCKET ================== */

io.on("connection", (socket) => {
  console.log("🔗 Connected:", socket.id);

  /* ---------- AGENT JOIN ---------- */
  socket.on("agent_join", ({ agentName }) => {
    socket.agentName = agentName;
    socket.join("agents");
    agentLoad.set(agentName, agentLoad.get(agentName) || 0);

    io.emit("agent_status", { agentCount: agentLoad.size });
  });

  /* ---------- CUSTOMER JOIN ---------- */
  socket.on("customer_join", async ({ customerId, name }) => {
    socket.customerId = customerId;
    socket.join(`room_${customerId}`);
    await getOrCreateConversation(customerId);
  });

  /* ---------- CUSTOMER MESSAGE ---------- */
  socket.on("customer_message", async ({ customerId, message }) => {
    const convo = await getOrCreateConversation(customerId);

    await pool.query(
      `INSERT INTO messages (conversation_id,sender,sender_name,message)
       VALUES ($1,'customer','Customer',$2)`,
      [convo.id, message]
    );

    io.to("agents").emit("new_message", { customerId, message });

    resetTimeout(customerId);
  });

  /* ---------- REQUEST AGENT ---------- */
  socket.on("request_agent", async ({ customerId }) => {
    io.to("agents").emit("agent_requested", { customerId });

    io.to(`room_${customerId}`).emit("agent_is_connecting", {
      message: "Connecting to an agent…",
    });

    await pool.query(
      "UPDATE conversations SET status='waiting_agent' WHERE customer_id=$1",
      [customerId]
    );
  });

  /* ---------- AGENT JOINS CHAT ---------- */
  socket.on("join_conversation", async ({ customerId }) => {
    if (!socket.agentName) return;

    const convo = await pool.query(
      "SELECT status FROM conversations WHERE customer_id=$1",
      [customerId]
    );

    if (convo.rows[0]?.status === "agent") return;

    socket.join(`room_${customerId}`);

    await pool.query(
      `UPDATE conversations
       SET status='agent', agent_socket_id=$1
       WHERE customer_id=$2`,
      [socket.id, customerId]
    );

    customerAgentMap.set(customerId, socket.id);
    agentLoad.set(socket.agentName, agentLoad.get(socket.agentName) + 1);

    io.to(`room_${customerId}`).emit("agent_joined", {
      agentName: socket.agentName,
      message: `${socket.agentName} joined the chat`,
    });

    resetTimeout(customerId);
  });

  /* ---------- AGENT MESSAGE ---------- */
  socket.on("agent_message", async ({ customerId, text }) => {
    if (!socket.agentName) return;

    const convo = await pool.query(
      "SELECT id FROM conversations WHERE customer_id=$1",
      [customerId]
    );

    if (!convo.rows.length) return;

    await pool.query(
      `INSERT INTO messages (conversation_id,sender,sender_name,message)
       VALUES ($1,'agent',$2,$3)`,
      [convo.rows[0].id, socket.agentName, text]
    );

    io.to(`room_${customerId}`).emit("agent_message", {
      text,
      sender: socket.agentName,
    });

    resetTimeout(customerId);
  });

  /* ---------- TYPING ---------- */
  socket.on("typing_start", ({ customerId }) => {
    socket.to(`room_${customerId}`).emit("agent_typing", { typing: true });
  });

  socket.on("typing_stop", ({ customerId }) => {
    socket.to(`room_${customerId}`).emit("agent_typing", { typing: false });
  });

  /* ---------- AGENT STATUS ---------- */
  socket.on("get_agent_status", () => {
    socket.emit("agent_status", { agentCount: agentLoad.size });
  });

  /* ---------- DISCONNECT ---------- */
  socket.on("disconnect", async () => {
    if (socket.agentName) {
      agentLoad.delete(socket.agentName);
      io.emit("agent_status", { agentCount: agentLoad.size });
    }

    await pool.query(
      `UPDATE conversations
       SET status='bot', agent_socket_id=NULL
       WHERE agent_socket_id=$1`,
      [socket.id]
    );
  });
});

/* ================== REST ================== */

app.get("/api/messages/:customerId", async (req, res) => {
  const convo = await pool.query(
    "SELECT id FROM conversations WHERE customer_id=$1",
    [req.params.customerId]
  );

  if (!convo.rows.length) return res.json([]);

  const msgs = await pool.query(
    `SELECT sender,sender_name,message,created_at
     FROM messages
     WHERE conversation_id=$1
     ORDER BY created_at ASC`,
    [convo.rows[0].id]
  );

  res.json(msgs.rows);
});

/* ================== START ================== */

const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
