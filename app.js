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

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'kPuTQ4LaogdthxFZlyOUYm7zwV2i0SEAWeHqsXMv96RpfGI583nr1BNCjJcDKb';

/* ================== GLOBAL STATE ================== */

const agentLoad = new Map(); // agentName → active chats
const agentStatus = new Map(); // agentName → status ('available', 'away', 'busy')
const customerAgentMap = new Map(); // customerId → agentSocketId
const inactivityTimers = new Map();

const AGENT_TIMEOUT = 2 * 60 * 1000; // 2 mins

/* ================== HELPERS ================== */

// Middleware to verify JWT token
function authenticateAgent(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.agent = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

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

  // Generate JWT token
  const token = jwt.sign({ agentName: agent.username }, JWT_SECRET, { expiresIn: '24h' });
  
  res.json({ success: true, agentName: agent.username, token });
});

// Protected route to verify token
app.get("/api/agent/verify", authenticateAgent, (req, res) => {
  res.json({ success: true, agentName: req.agent.agentName });
});

/* ================== SOCKET ================== */

io.on("connection", (socket) => {
  console.log("🔗 Connected:", socket.id);

  /* ---------- AGENT JOIN ---------- */
  socket.on("agent_join", ({ agentName }) => {
    socket.agentName = agentName;
    socket.join("agents");
    agentLoad.set(agentName, agentLoad.get(agentName) || 0);
    agentStatus.set(agentName, "available"); // Default status

    io.emit("agent_status", { 
      agentCount: agentLoad.size,
      agents: Array.from(agentStatus.entries()).map(([name, status]) => ({ name, status }))
    });
    
    // Confirm agent join
    socket.emit("agent_join_confirmed", { agentName });
  });

  /* ---------- AGENT STATUS UPDATE ---------- */
  socket.on("update_agent_status", ({ status }) => {
    if (!socket.agentName) return;
    
    agentStatus.set(socket.agentName, status);
    
    io.emit("agent_status", { 
      agentCount: agentLoad.size,
      agents: Array.from(agentStatus.entries()).map(([name, status]) => ({ name, status }))
    });
  });

  /* ---------- CUSTOMER JOIN ---------- */
  socket.on("customer_join", async ({ customerId, name }) => {
    socket.customerId = customerId;
    socket.join(`room_${customerId}`);
    await getOrCreateConversation(customerId);
    
    // Send connection status back to customer
    socket.emit("connection_status", { customerId, conversationId: null });
  });

  /* ---------- CUSTOMER MESSAGE ---------- */
  socket.on("customer_message", async ({ customerId, message }) => {
    const convo = await getOrCreateConversation(customerId);
    
    // Check if this is a bot-handled message
    if (convo.status === 'bot') {
      // Check for course-related queries
      const lowerMessage = message.toLowerCase();
      
      if (lowerMessage.includes('courses') || lowerMessage.includes('course')) {
        // Send course information
        io.to(`room_${customerId}`).emit("agent_message", {
          text: "courses", // Special identifier for frontend
          sender: "Bot"
        });
        
        await pool.query(
          `INSERT INTO messages (conversation_id,sender,sender_name,message)
           VALUES ($1,'bot','Bot',$2)`,
          [convo.id, "Course information requested"]
        );
        
        return; // Don't proceed with the rest of the function
      }
      
      if (lowerMessage.includes('tell me more') || lowerMessage.includes('more information')) {
        // Send contact information
        io.to(`room_${customerId}`).emit("agent_message", {
          text: "contact", // Special identifier for frontend
          sender: "Bot"
        });
        
        await pool.query(
          `INSERT INTO messages (conversation_id,sender,sender_name,message)
           VALUES ($1,'bot','Bot',$2)`,
          [convo.id, "Contact information requested"]
        );
        
        return; // Don't proceed with the rest of the function
      }
      
      // For other messages, send a default response
      io.to(`room_${customerId}`).emit("agent_message", {
        text: "I'm a bot assistant. For more detailed help, please request to speak with a human agent by typing 'talk to human' or clicking the 'Switch to Human Agent' button.",
        sender: "Bot"
      });
      
      await pool.query(
        `INSERT INTO messages (conversation_id,sender,sender_name,message)
         VALUES ($1,'bot','Bot',$2)`,
        [convo.id, "Bot default response"]
      );
      
      return;
    }
    
    // If we get here, the conversation is with an agent
    await pool.query(
      `INSERT INTO messages (conversation_id,sender,sender_name,message)
       VALUES ($1,'customer','Customer',$2)`,
      [convo.id, message]
    );

    io.to("agents").emit("new_message", { 
      customerId, 
      message,
      sender: "Customer",
      conversationId: convo.id
    });

    resetTimeout(customerId);
  });

  /* ---------- REQUEST AGENT ---------- */
  socket.on("request_agent", async ({ customerId, customerName }) => {
    console.log("🔍 Agent request received for:", { customerId, customerName });
    console.log("🔍 Current agentLoad:", Array.from(agentLoad.entries()));
    console.log("🔍 Current agentStatus:", Array.from(agentStatus.entries()));
    console.log("🔍 Connected sockets:", Array.from(io.sockets.sockets.keys()));
    
    // Find the available agent with the least load
    let leastBusyAgent = null;
    let minLoad = Infinity;
    let selectedSocket = null;
    
    // Check all connected sockets to find available agents
    io.sockets.sockets.forEach((agentSocket, socketId) => {
      if (agentSocket.agentName) {
        const agentName = agentSocket.agentName;
        const load = agentLoad.get(agentName) || 0;
        const status = agentStatus.get(agentName) || "available";
        
        console.log(`🔍 Checking agent ${agentName} (socket ${socketId}): status=${status}, load=${load}`);
        
        if (status === "available" && load < minLoad) {
          minLoad = load;
          leastBusyAgent = agentName;
          selectedSocket = agentSocket;
          console.log(`🔍 New best agent: ${leastBusyAgent} with load ${minLoad}`);
        }
      }
    });
    
    console.log(`🔍 Final selected agent: ${leastBusyAgent}`);
    
    if (leastBusyAgent && selectedSocket) {
      // Assign this customer to the least busy agent
      customerAgentMap.set(customerId, leastBusyAgent);
      
      // Update agent load
      agentLoad.set(leastBusyAgent, minLoad + 1);
      
      // Notify the assigned agent directly
      selectedSocket.emit("agent_assigned", { 
        customerId, 
        customerName,
        assignedAgent: leastBusyAgent 
      });
      
      // Notify the customer that an agent will join shortly
      io.to(`room_${customerId}`).emit("agent_is_connecting", {
        message: `${leastBusyAgent} will join the chat shortly...`,
      });
      
      console.log(`✅ Agent ${leastBusyAgent} assigned to customer ${customerId}`);
    } else {
      console.log("❌ No available agents found");
      io.to(`room_${customerId}`).emit("agent_request_failed", {
        message: "All agents are currently busy. Please try again later.",
      });
    }
    
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
  socket.on("typing_start", ({ customerId, isAgent }) => {
    const eventName = isAgent ? "customer_typing" : "agent_typing";
    socket.to(`room_${customerId}`).emit(eventName, { typing: true });
  });

  socket.on("typing_stop", ({ customerId, isAgent }) => {
    const eventName = isAgent ? "customer_typing" : "agent_typing";
    socket.to(`room_${customerId}`).emit(eventName, { typing: false });
  });

  /* ---------- AGENT STATUS ---------- */
  socket.on("get_agent_status", () => {
    socket.emit("agent_status", { 
      agentCount: agentLoad.size,
      agents: Array.from(agentStatus.entries()).map(([name, status]) => ({ name, status }))
    });
  });

  /* ---------- DISCONNECT ---------- */
  socket.on("disconnect", async () => {
    if (socket.agentName) {
      agentLoad.delete(socket.agentName);
      agentStatus.delete(socket.agentName);
      io.emit("agent_status", { 
        agentCount: agentLoad.size,
        agents: Array.from(agentStatus.entries()).map(([name, status]) => ({ name, status }))
      });
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

app.get("/api/messages/:customerId", authenticateAgent, async (req, res) => {
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

// List all conversations
app.get("/api/conversations", authenticateAgent, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM conversations ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Error fetching conversations" });
  }
});

// Get a specific conversation by ID (and its messages)
app.get("/api/conversation/:id", authenticateAgent, async (req, res) => {
  const { id } = req.params;

  try {
    const convo = await pool.query(
      "SELECT * FROM conversations WHERE id=$1",
      [id]
    );

    if (!convo.rows.length)
      return res.status(404).json({ error: "Conversation not found" });

    const messages = await pool.query(
      `SELECT sender, sender_name, message, created_at
       FROM messages
       WHERE conversation_id=$1
       ORDER BY created_at ASC`,
      [id]
    );

    res.json({
      conversation: convo.rows[0],
      messages: messages.rows,
    });
  } catch (err) {
    res.status(500).json({ error: "Error fetching conversation details" });
  }
});

/* ================== START ================== */

const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);

