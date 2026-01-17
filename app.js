const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* ================= AI CHAT ================= */
app.post("/chat", async (req, res) => {
  const message = req.body.message?.trim();

  if (!message) return res.json({ reply: "Empty message." });

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: message }
        ],
        max_tokens: 300
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    const reply =
      response.data.choices[0]?.message?.content ||
      "No response.";

    res.json({ reply });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ reply: "AI error" });
  }
});

/* ================= HUMAN CHAT ================= */
app.post("/human", (req, res) => {
  const message = req.body.message?.trim();

  if (!message) return res.json({ reply: "Empty message." });

  // Replace later with real human system
  res.json({
    reply: "👤 Human agent will reply soon. Please wait..."
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

