const express = require('express');
const http = require('http');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

/* ================= AGENT TRACKING ================= */

const onlineAgents = new Map(); // socket.id => agentName

/* ================= HELPERS ================= */

async function getOrCreateConversation(customerId) {
  const existing = await pool.query(
    'SELECT * FROM conversations WHERE customer_id=$1',
    [customerId]
  );
  if (existing.rows.length) return existing.rows[0];

  const created = await pool.query(
    'INSERT INTO conversations (customer_id, status) VALUES ($1,$2) RETURNING *',
    [customerId, 'bot']
  );
  return created.rows[0];
}

function botReply(message) {
  const msg = message.toLowerCase();
  if (msg.includes('course')) return 'We offer Trading & Web courses 📈';
  if (msg.includes('price')) return 'Pricing starts from ₹1999';
  if (msg.includes('contact')) return 'Call us at 9272000111';
  return 'Type "agent" or click "Switch to Human Agent" 👨‍💼';
}

/* ================= AUTH ================= */

app.post('/api/agent/login', async (req, res) => {
  const { username, password } = req.body;

  const result = await pool.query(
    'SELECT * FROM agents WHERE username=$1',
    [username]
  );
  if (!result.rows.length)
    return res.status(401).json({ error: 'Invalid credentials' });

  const agent = result.rows[0];
  const ok = await bcrypt.compare(password, agent.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  res.json({ success: true, agentName: agent.username });
});

/* ================= SOCKET.IO ================= */

io.on('connection', (socket) => {
  console.log('🔗 Connected:', socket.id);

  /* ---- AGENT JOIN ---- */
  socket.on('agent_join', ({ agentName }) => {
    socket.agentName = agentName;
    onlineAgents.set(socket.id, agentName);
    socket.join('agents');

    console.log(`👨‍💼 Agent online: ${agentName}`);

    io.emit('agent_status', {
      agentCount: onlineAgents.size
    });
  });

  /* ---- CUSTOMER JOIN ---- */
  socket.on('customer_join', async ({ customerId }) => {
    socket.customerId = customerId;
    socket.join(`room_${customerId}`);
    await getOrCreateConversation(customerId);

    console.log(`👤 Customer joined: ${customerId}`);
  });

  /* ---- GET AGENT STATUS ---- */
  socket.on('get_agent_status', () => {
    socket.emit('agent_status', {
      agentCount: onlineAgents.size
    });
  });

  /* ---- CUSTOMER MESSAGE ---- */
  socket.on('customer_message', async ({ customerId, message }) => {
    const convo = await getOrCreateConversation(customerId);

    await pool.query(
      `INSERT INTO messages (conversation_id, sender, sender_name, message)
       VALUES ($1,'customer','Customer',$2)`,
      [convo.id, message]
    );

    // Notify agents
    io.to('agents').emit('new_message', { customerId, message });

    if (convo.status !== 'bot') return;

    if (message.toLowerCase() === 'agent') {
      await pool.query(
        `UPDATE conversations SET status='waiting_agent' WHERE customer_id=$1`,
        [customerId]
      );

      io.to('agents').emit('agent_requested', { customerId });
      io.to(`room_${customerId}`).emit('agent_is_connecting', {
        message: 'Connecting you to an agent...'
      });
      return;
    }

    const reply = botReply(message);
    await pool.query(
      `INSERT INTO messages (conversation_id, sender, sender_name, message)
       VALUES ($1,'bot','Bot',$2)`,
      [convo.id, reply]
    );

    io.to(`room_${customerId}`).emit('agent_message', { text: reply });
  });

  /* ---- AGENT ACCEPTS CHAT ---- */
  socket.on('request_agent', async ({ customerId }) => {
    if (onlineAgents.size === 0) {
      io.to(`room_${customerId}`).emit('agent_request_failed', {
        message: 'No agents available'
      });
      return;
    }

    socket.join(`room_${customerId}`);

    await pool.query(
      `UPDATE conversations
       SET status='agent', agent_socket_id=$1
       WHERE customer_id=$2`,
      [socket.id, customerId]
    );

    io.to(`room_${customerId}`).emit('agent_joined', {
      message: 'Agent connected'
    });
  });

  /* ---- AGENT MESSAGE ---- */
  socket.on('agent_message', async ({ customerId, message }) => {
    const convo = await pool.query(
      'SELECT id FROM conversations WHERE customer_id=$1',
      [customerId]
    );
    if (!convo.rows.length) return;

    await pool.query(
      `INSERT INTO messages (conversation_id, sender, sender_name, message)
       VALUES ($1,'agent',$2,$3)`,
      [convo.rows[0].id, socket.agentName, message]
    );

    io.to(`room_${customerId}`).emit('agent_message', {
      text: message
    });
  });

  /* ---- DISCONNECT ---- */
  socket.on('disconnect', async () => {
    console.log('❌ Disconnected:', socket.id);

    if (onlineAgents.has(socket.id)) {
      onlineAgents.delete(socket.id);
      io.emit('agent_status', {
        agentCount: onlineAgents.size
      });
      console.log('👨‍💼 Agent offline');
    }

    await pool.query(
      `UPDATE conversations
       SET status='bot', agent_socket_id=NULL
       WHERE agent_socket_id=$1`,
      [socket.id]
    );
  });
});

/* ================= START ================= */

const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
