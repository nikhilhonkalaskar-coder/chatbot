const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

/* ---------------- HELPERS ---------------- */

async function getOrCreateConversation(customerId) {
  const existing = await pool.query(
    'SELECT * FROM conversations WHERE customer_id=$1',
    [customerId]
  );

  if (existing.rows.length) {
    return existing.rows[0];
  }

  const created = await pool.query(
    'INSERT INTO conversations (customer_id) VALUES ($1) RETURNING *',
    [customerId]
  );

  return created.rows[0];
}

function botReply(message) {
  const msg = message.toLowerCase();

  if (msg.includes('course')) return 'We offer Trading & Web courses 📈';
  if (msg.includes('price')) return 'Our pricing starts from ₹1999';
  if (msg.includes('contact')) return 'Contact: support@yourdomain.com';

  return 'Please wait… or type "agent" to talk to a human.';
}

/* ---------------- SOCKET.IO ---------------- */

io.on('connection', (socket) => {
  console.log('🔗 Connected:', socket.id);

  /* ---- Agent Join ---- */
  socket.on('agent_join', ({ agentName }) => {
    socket.join('agents');
    socket.agentName = agentName;
    console.log(`👨‍💼 Agent joined: ${agentName}`);
  });

  /* ---- Customer Join ---- */
  socket.on('customer_join', async ({ customerId }) => {
    socket.customerId = customerId;
    socket.join(`room_${customerId}`);
    await getOrCreateConversation(customerId);
    console.log(`👤 Customer joined: ${customerId}`);
  });

  /* ---- Customer Message ---- */
  socket.on('customer_message', async ({ customerId, message }) => {
    const convo = await getOrCreateConversation(customerId);

    await pool.query(
      `INSERT INTO messages (conversation_id, sender, sender_name, message)
       VALUES ($1,'customer','Customer',$2)`,
      [convo.id, message]
    );

    io.to('agents').emit('new_message', {
      customerId,
      sender: 'customer',
      message
    });

    if (convo.status !== 'bot') return;

    if (message.toLowerCase() === 'agent') {
      await pool.query(
        `UPDATE conversations SET status='waiting_agent'
         WHERE customer_id=$1`,
        [customerId]
      );

      io.to('agents').emit('agent_requested', { customerId });
      io.to(`room_${customerId}`).emit(
        'system_message',
        'Connecting you to an agent…'
      );
      return;
    }

    const reply = botReply(message);

    await pool.query(
      `INSERT INTO messages (conversation_id, sender, sender_name, message)
       VALUES ($1,'bot','Bot',$2)`,
      [convo.id, reply]
    );

    io.to(`room_${customerId}`).emit('bot_message', reply);
  });

  /* ---- Agent Accept Chat ---- */
  socket.on('join_conversation', async ({ customerId }) => {
    socket.join(`room_${customerId}`);

    await pool.query(
      `UPDATE conversations
       SET agent_socket_id=$1, status='agent'
       WHERE customer_id=$2`,
      [socket.id, customerId]
    );

    io.to(`room_${customerId}`).emit('agent_joined', {
      agentName: socket.agentName
    });

    console.log(`✅ Agent joined conversation ${customerId}`);
  });

  /* ---- Agent Message ---- */
  socket.on('agent_message', async ({ customerId, message }) => {
    const convo = await pool.query(
      'SELECT * FROM conversations WHERE customer_id=$1',
      [customerId]
    );
    if (!convo.rows.length) return;

    await pool.query(
      `INSERT INTO messages (conversation_id, sender, sender_name, message)
       VALUES ($1,'agent',$2,$3)`,
      [convo.rows[0].id, socket.agentName, message]
    );

    io.to(`room_${customerId}`).emit('agent_message', {
      agentName: socket.agentName,
      message
    });
  });

  /* ---- Disconnect ---- */
  socket.on('disconnect', async () => {
    console.log('❌ Disconnected:', socket.id);

    await pool.query(
      `UPDATE conversations
       SET status='bot', agent_socket_id=NULL
       WHERE agent_socket_id=$1`,
      [socket.id]
    );
  });
});

/* ---------------- REST API ---------------- */

app.get('/api/messages/:customerId', async (req, res) => {
  const { customerId } = req.params;

  const convo = await pool.query(
    'SELECT id FROM conversations WHERE customer_id=$1',
    [customerId]
  );

  if (!convo.rows.length) return res.json([]);

  const msgs = await pool.query(
    `SELECT * FROM messages
     WHERE conversation_id=$1
     ORDER BY created_at ASC`,
    [convo.rows[0].id]
  );

  res.json(msgs.rows);
});

/* ---------------- START ---------------- */

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
