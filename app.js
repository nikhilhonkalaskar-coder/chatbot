const express = require("express");
const http = require("http");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const pool = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "kPuTQ4LaogdthxFZlyOUYm7zwV2i0SEAWeHqsXMv96RpfGI583nr1BNCjJcDKb";

/* ================== GLOBAL STATE ================== */

const agentLoad = new Map();     // socket.id -> chat count
const agentStatus = new Map();   // socket.id -> available | busy
const agentNames = new Map();    // socket.id -> agentName
const customerAgentMap = new Map();
const inactivityTimers = new Map();

const AGENT_TIMEOUT = 2 * 60 * 1000;

/* ================== HELPERS ================== */

function authenticateAgent(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    req.agent = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

async function getOrCreateConversation(customerId) {
  const res = await pool.query(
    "SELECT * FROM conversations WHERE customer_id=$1",
    [customerId]
  );
  if (res.rows.length) return res.rows[0];

  const created = await pool.query(
    "INSERT INTO conversations (customer_id,status) VALUES ($1,'bot') RETURNING *",
    [customerId]
  );
  return created.rows[0];
}

function resetTimeout(customerId) {
  if (inactivityTimers.has(customerId))
    clearTimeout(inactivityTimers.get(customerId));

  inactivityTimers.set(
    customerId,
    setTimeout(async () => {
      customerAgentMap.delete(customerId);
      await pool.query(
        "UPDATE conversations SET status='bot', agent_socket_id=NULL WHERE customer_id=$1",
        [customerId]
      );
      io.to(`room_${customerId}`).emit(
        "system_message",
        "Agent disconnected. Bot is back 🤖"
      );
    }, AGENT_TIMEOUT)
  );
}

/* ================== AUTH ================== */

app.post("/api/agent/login", async (req, res) => {
  const { username, password } = req.body;

  const result = await pool.query(
    "SELECT * FROM agents WHERE username=$1",
    [username]
  );
  if (!result.rows.length) return res.status(401).json({ error: "Invalid login" });

  const agent = result.rows[0];
  const ok = await bcrypt.compare(password, agent.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid login" });

  const token = jwt.sign({ agentName: agent.username }, JWT_SECRET, {
    expiresIn: "24h",
  });

  res.json({ success: true, agentName: agent.username, token });
});

/* ================== SOCKET ================== */

io.on("connection", (socket) => {
  console.log("🔗 Connected:", socket.id);

  /* -------- AGENT JOIN -------- */
  socket.on("agent_join", ({ agentName }) => {
    if (!agentName) return;

    socket.agentName = agentName;

    agentNames.set(socket.id, agentName);
    agentStatus.set(socket.id, "available");
    agentLoad.set(socket.id, 0);

    socket.join("agents");

    console.log("👨‍💼 Agent joined:", socket.id, agentName);
  });

  /* -------- CUSTOMER JOIN -------- */
  socket.on("customer_join", async ({ customerId }) => {
    socket.join(`room_${customerId}`);
    await getOrCreateConversation(customerId);
  });

  /* -------- CUSTOMER MESSAGE -------- */
  socket.on("customer_message", async ({ customerId, message }) => {
    const convo = await getOrCreateConversation(customerId);

    await pool.query(
      `INSERT INTO messages (conversation_id,sender,sender_name,message)
       VALUES ($1,'customer','Customer',$2)`,
      [convo.id, message]
    );

    if (convo.status === "bot") {
      io.to(`room_${customerId}`).emit("agent_message", {
        sender: "Bot",
        text: "Type 'agent' to talk to a human 👨‍💼",
      });
      return;
    }

    io.to("agents").emit("new_message", { customerId, message });
    resetTimeout(customerId);
  });

  /* -------- REQUEST AGENT -------- */
  socket.on("request_agent", async ({ customerId, customerName }) => {
    let selectedAgentId = null;
    let minLoad = Infinity;

    for (const [sid, status] of agentStatus.entries()) {
      if (status !== "available") continue;
      const load = agentLoad.get(sid) || 0;
      if (load < minLoad) {
        minLoad = load;
        selectedAgentId = sid;
      }
    }

    console.log("🔍 Selected agent:", selectedAgentId);

    if (!selectedAgentId) {
      io.to(`room_${customerId}`).emit(
        "agent_request_failed",
        "No agents available"
      );
      return;
    }

    agentStatus.set(selectedAgentId, "busy");
    agentLoad.set(selectedAgentId, minLoad + 1);
    customerAgentMap.set(customerId, selectedAgentId);

    io.to(selectedAgentId).emit("agent_assigned", {
      customerId,
      customerName,
      agentName: agentNames.get(selectedAgentId),
    });

    io.to(`room_${customerId}`).emit("agent_is_connecting", {
      message: `${agentNames.get(selectedAgentId)} will join shortly...`,
    });

    await pool.query(
      "UPDATE conversations SET status='waiting_agent' WHERE customer_id=$1",
      [customerId]
    );
  });

  /* -------- AGENT JOIN CHAT -------- */
  socket.on("join_conversation", async ({ customerId }) => {
    if (!socket.agentName) return;

    socket.join(`room_${customerId}`);

    await pool.query(
      `UPDATE conversations
       SET status='agent', agent_socket_id=$1
       WHERE customer_id=$2`,
      [socket.id, customerId]
    );

    io.to(`room_${customerId}`).emit("agent_joined", {
      agentName: socket.agentName,
    });

    resetTimeout(customerId);
  });

  /* -------- AGENT MESSAGE -------- */
  socket.on("agent_message", async ({ customerId, text }) => {
    const convo = await getOrCreateConversation(customerId);

    await pool.query(
      `INSERT INTO messages (conversation_id,sender,sender_name,message)
       VALUES ($1,'agent',$2,$3)`,
      [convo.id, socket.agentName, text]
    );

    io.to(`room_${customerId}`).emit("agent_message", {
      sender: socket.agentName,
      text,
    });

    resetTimeout(customerId);
  });

  /* -------- DISCONNECT -------- */
  socket.on("disconnect", async () => {
    if (agentStatus.has(socket.id)) {
      agentStatus.delete(socket.id);
      agentLoad.delete(socket.id);
      agentNames.delete(socket.id);
      console.log("👋 Agent removed:", socket.id);
    }

    await pool.query(
      "UPDATE conversations SET status='bot', agent_socket_id=NULL WHERE agent_socket_id=$1",
      [socket.id]
    );
  });
});

/* ================== REST ================== */

app.get("/api/messages/:customerId", authenticateAgent, async (req, res) => {
  const convo = await pool.query(
    "SELECT id FROM conversations WHERE customer_id=$1",
    [req.params.customerId]
  );
  if (!convo.rows.length) return res.json([]);

  const msgs = await pool.query(
    `SELECT sender,sender_name,message,created_at
     FROM messages WHERE conversation_id=$1
     ORDER BY created_at`,
    [convo.rows[0].id]
  );

  res.json(msgs.rows);
});

app.get("/api/conversations", authenticateAgent, async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM conversations ORDER BY created_at DESC"
  );
  res.json(result.rows);
});

/* ================== START ================== */

const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
