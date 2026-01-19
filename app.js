const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static("public"));

// Chat API
app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  if (!userMessage) {
    return res.json({ reply: "Message is empty" });
  }

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: userMessage }
        ],
        max_tokens: 200,
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const botReply =
      response.data?.choices?.[0]?.message?.content ||
      "No response from AI";

    res.json({ reply: botReply });

  } catch (error) {
    console.error("OpenAI Error:", error.response?.data || error.message);
    res.status(500).json({ reply: "AI failed to respond" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
