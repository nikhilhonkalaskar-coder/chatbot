// =================================================================
// BACKEND WITH POSTGRESQL PERSISTENCE AND AGENT ASSOCIATION
// =================================================================

const express = require("express");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_aE4iTqzeIWB3@ep-old-wind-a1j8s1aj-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  ssl: {
    rejectUnauthorized: false
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Language detection function
function detectLanguage(message) {
  // Simple detection based on script ranges
  const hindiRegex = /[\u0900-\u097F]/;
  const marathiRegex = /[\u0900-\u097F]/; // Marathi uses the same Devanagari script as Hindi
  
  if (hindiRegex.test(message)) {
    // For now, we'll assume Devanagari script is Hindi/Marathi
    // In a production system, you might want more sophisticated detection
    return 'hindi'; // Default to Hindi for Devanagari script
  }
  return 'english';
}

// Custom Bot Responses - Q&A Database
const botResponses = {
  greetings: {
    keywords: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'greetings'],
    response: "Hello! Welcome to Tushar Bhumkar Institute. How can I help you today?"
  },
  courses: {
    keywords: ['courses', 'course', 'program', 'training', 'workshop', 'learning'],
    response: `We offer one exclusive course focused on intraday commodity trading, which is divided into two parts:

**Basic Workshop**: This module provides complete training in Nifty, stocks, and part-time intraday trading, covering daily, weekly, and monthly trading approaches.

**Advanced Workshop**: This module is designed for part-time and full-time traders, especially those who are facing issues like overtrading, options traps, and losses in long-term investments. 

It focuses on discipline, risk management, and advanced trading strategies. 

**Training Expert**: All workshops are conducted by Mr. Tushar Bhumkar, who has extensive experience in intraday trading.

**For more information**: Call 9272000111`   
  },
  basic_workshop: {
    keywords: ['basic workshop', 'basic course', 'beginner', 'foundation', 'starting'],
    response: `🎯 **Basic Workshop Details**:

This course helps beginners understand market movements through well-designed modules.

✅ **What you'll learn**:
- How historical data influences market behavior
- Price pattern analysis
- Market fundamentals
- Structured and practical sessions
- Strong foundation building

⏰ **Duration**: 2 weeks
📅 **Next batch**: Starting soon
💰 **Fee**: Affordable pricing with EMI options`
  },
  advanced_workshop: {
    keywords: ['advanced workshop', 'advanced course', 'expert', 'professional', 'deep dive'],
    response: `🚀 **Advanced Workshop Details**:

This workshop is designed for learners who want to go deeper into market analysis.

✅ **What you'll learn**:
- Advanced market concepts
- Practical trading techniques
- Real-world market analysis
- Risk management strategies
- Portfolio optimization

⏰ **Duration**: 4 weeks
📅 **Next batch**: Starting soon
💰 **Fee**: Premium pricing with flexible payment options`
  },
  fees: {
    keywords: ['fees', 'fee', 'price', 'cost', 'payment', 'emi'],
    response: `💰 **Course Fees & Payment Options**:

**Basic Workshop**: ₹15,000
**Advanced Workshop**: ₹25,000
**Combo Package**: ₹35,000 (Save ₹5,000)

💳 **Payment Options**:
- Cash payment
- Bank transfer
- EMI available (3, 6, 12 months)
- Credit/Debit cards accepted
- UPI payments

🎁 **Special Offer**: 10% discount for early registration!`
  },
  contact: {
    keywords: ['contact', 'phone', 'call', 'email', 'address', 'location', 'visit'],
    response: `📞 **Contact Information**:

📱 **Phone**: 9272000111
📧 **Email**: info@tusharbhumkarinstitute.com
📍 **Address**: Pune, Maharashtra

🕐 **Office Hours**:
- Monday to Friday: 9:00 AM - 7:00 PM
- Saturday: 9:00 AM - 5:00 PM
- Sunday: Closed

💬 **WhatsApp**: Available on the same number for quick queries`
  },
  duration: {
    keywords: ['duration', 'time', 'length', 'period', 'schedule', 'timings'],
    response: `⏰ **Course Duration & Schedule**:

**Basic Workshop**: 2 weeks
- Weekday batches: 2 hours/day
- Weekend batches: 4 hours/day

**Advanced Workshop**: 4 weeks
- Weekday batches: 2 hours/day
- Weekend batches: 4 hours/day

📅 **Flexible Timings**:
- Morning Batch: 7:00 AM - 9:00 AM
- Evening Batch: 6:00 PM - 8:00 PM
- Weekend Batch: Saturday & Sunday`
  },
  eligibility: {
    keywords: ['eligibility', 'requirements', 'qualification', 'who can join', 'prerequisites'],
    response: `📋 **Eligibility & Requirements**:

**Basic Workshop**:
✅ No prior knowledge required
✅ Minimum age: 18 years
✅ Basic computer knowledge helpful
✅ Graduation preferred but not mandatory

**Advanced Workshop**:
✅ Completion of Basic Workshop (or equivalent knowledge)
✅ Understanding of market basics
✅ Active trading experience preferred
✅ Minimum 6 months market exposure

🎯 **Who should join**:
- Students interested in finance
- Working professionals
- Business owners
- Homemakers looking for financial independence`
  },
  support: {
    keywords: ['support', 'help', 'doubt', 'query', 'assistance', 'guidance'],
    response: `🤝 **Post-Course Support**:

✅ **Dedicated Support Hours**:
- Monday to Friday: 6:00 PM - 8:00 PM
- Saturday: 10:00 AM - 1:00 PM

✅ **What we provide**:
- Doubt clearing sessions
- Market analysis guidance
- Trading strategy reviews
- Portfolio review
- Regular webinars

✅ **Lifetime Access**:
- Study materials
- Recorded sessions
- Community group
- Alumni network

📞 **Support**: 9272000111`
  },
  testimonials: {
    keywords: ['review', 'testimonial', 'feedback', 'experience', 'success story'],
    response: `⭐ **Student Success Stories**:

🎯 **Rahul Sharma**: "The Basic Workshop transformed my understanding of the market. Now I'm making consistent profits!"

🎯 **Priya Patel**: "Advanced Workshop helped me develop my own trading strategy. Highly recommended!"

🎯 **Amit Kumar**: "Best investment in my career. The practical approach made all the difference."

🎯 **Neha Singh**: "Post-course support is amazing. Always get help when I need it."

🎯 **Vikram Desai**: "From zero to profitable trader in 3 months. Thank you Tushar Sir!"

📊 **Success Rate**: 85% of our students are successfully trading`
  },
  materials: {
    keywords: ['materials', 'study material', 'notes', 'books', 'resources'],
    response: `📚 **Study Materials & Resources**:

✅ **What you'll get**:
- Comprehensive study notes
- Practice worksheets
- Real market case studies
- Trading templates
- Chart patterns guide
- Risk management checklist

✅ **Digital Resources**:
- Video recordings
- E-books
- Market analysis tools
- Trading calculators

✅ **Physical Materials**:
- Printed study material
- Chart pattern cards
- Quick reference guide

📱 **Mobile App**: Access materials on-the-go`
  },
  placement: {
    keywords: ['placement', 'job', 'career', 'opportunity', 'employment'],
    response: `💼 **Career Opportunities & Placement**:

🎯 **Job Roles**:
- Equity Research Analyst
- Technical Analyst
- Portfolio Manager
- Risk Manager
- Trading Desk Executive
- Financial Advisor

✅ **Placement Support**:
- Resume building workshops
- Interview preparation
- Job referrals
- Industry connections
- Alumni network

📊 **Placement Record**:
- 70% placement rate
- Average salary: ₹4-8 LPA
- Top companies: ICICI, HDFC, Kotak, Reliance

🎓 **Entrepreneur Support**: Guidance for starting own trading firm`
  },
  refund: {
    keywords: ['refund', 'cancellation', 'money back', 'guarantee'],
    response: `💰 **Refund & Cancellation Policy**:

✅ **Refund Policy**:
- 100% refund if cancelled 7 days before start
- 50% refund if cancelled 3-7 days before start
- No refund if cancelled less than 3 days before start

✅ **Special Cases**:
- Medical emergency: Full refund with proof
- Job relocation: 50% refund with proof

✅ **Course Transfer**:
- Free transfer to next batch (once)
- Subject to availability

📞 **For Refunds**: Call 9272000111 or email info@tusharbhumkarinstitute.com`
  },
  offline: {
    keywords: ['offline', 'classroom', 'in-person', 'physical'],
    response: `🏫 **Offline Classroom Training**:

📍 **Location**: Pune, Maharashtra (Prime location with easy connectivity)

✅ **Facilities**:
- Air-conditioned classrooms
- Projector and audio system
- High-speed internet
- Trading terminals
- Library access
- Parking facility

✅ **Benefits**:
- Face-to-face interaction with Tushar Sir
- Peer learning environment
- Live market practice
- Immediate doubt resolution
- Networking opportunities

📅 **Batch Timings**:
- Morning: 7:00 AM - 9:00 AM
- Evening: 6:00 PM - 8:00 PM
- Weekend: 10:00 AM - 2:00 PM`
  },
  online: {
    keywords: ['online', 'virtual', 'remote', 'live', 'zoom'],
    response: `💻 **Online Live Training**:

✅ **Platform**: Zoom with interactive features

✅ **Features**:
- Live interactive sessions
- Screen sharing
- Recording access
- Chat support
- Digital whiteboard
- Breakout rooms

✅ **Benefits**:
- Learn from anywhere
- Flexible schedule
- Recordings for revision
- Save travel time
- Learn at your own pace

✅ **Requirements**:
- Stable internet connection
- Laptop/desktop with camera
- Zoom app installed
- Headphones recommended

📱 **Mobile App**: Access classes on mobile too`
  },
  bye: {
    keywords: ['bye', 'goodbye', 'thank you', 'thanks', 'see you', 'exit'],
    response: `Thank you for contacting Tushar Bhumkar Institute! 😊

📞 Feel free to call us at 9272000111 for any further assistance.

Have a great day! 🌟`
  },
  default: {
    keywords: [],
    response: `I understand you're interested in our courses. Here's how I can help:

📚 **Course Information**:
- Basic Workshop (2 weeks)
- Advanced Workshop (4 weeks)
- Combo packages available

📞 **Contact**: 9272000111
📧 **Email**: info@tusharbhumkarinstitute.com

💬 **Type any of these to know more**:
- 'courses' - Course details
- 'fees' - Fee structure
- 'contact' - Contact information
- 'duration' - Course timings

Or ask me anything specific about our training programs!`
  }
};

// Hindi bot responses
const hindiBotResponses = {
  greetings: {
    keywords: ['नमस्ते', 'हाय', 'हैलो', 'सुप्रभात', 'शुभ दोपहर', 'शुभ संध्या', 'ग्रीटिंग्स'],
    response: "नमस्ते! तुषार भुमकर इंस्टिट्यूट में आपका स्वागत है। आज मैं आपकी क्या सहायता कर सकता हूँ?"
  },
  courses: {
    keywords: ['कोर्स', 'पाठ्यक्रम', 'प्रशिक्षण', 'वर्कशॉप', 'सीखना'],
    response: `हम इंट्राडे कमोडिटी ट्रेडिंग पर एक विशेष कोर्स प्रदान करते हैं, जो दो भागों में विभाजित है:

**बेसिक वर्कशॉप**: यह मॉड्यूल निफ्टी, स्टॉक्स और पार्ट-टाइम इंट्राडे ट्रेडिंग में पूर्ण प्रशिक्षण प्रदान करता है, जो दैनिक, साप्ताहिक और मासिक ट्रेडिंग दृष्टिकोणों को शामिल करता है।

**एडवांस्ड वर्कशॉप**: यह मॉड्यूल पार्ट-टाइम और फुल-टाइम ट्रेडर्स के लिए डिज़ाइन किया गया है, खासकर उन लोगों के लिए जो ओवरट्रेडिंग, ऑप्शंस ट्रैप और लॉन्ग-टर्म निवेश में नुकसान जैसी समस्याओं का सामना कर रहे हैं।

यह अनुशासन, जोखिम प्रबंधन और उन्नत ट्रेडिंग रणनीतियों पर केंद्रित है।

**प्रशिक्षण विशेषज्ञ**: सभी कार्यशालाएं श्री तुषार भुमकर द्वारा संचालित की जाती हैं, जिनके पास इंट्राडे ट्रेडिंग में व्यापक अनुभव है।

**अधिक जानकारी के लिए**: 9272000111 पर कॉल करें`
  },
  fees: {
    keywords: ['फीस', 'कीमत', 'खर्च', 'भुगतान', 'ईएमआई'],
    response: `💰 **कोर्स शुल्क और भुगतान विकल्प**:

**बेसिक वर्कशॉप**: ₹15,000
**एडवांस्ड वर्कशॉप**: ₹25,000
**कंबो पैकेज**: ₹35,000 (₹5,000 बचाएं)

💳 **भुगतान विकल्प**:
- नकद भुगतान
- बैंक ट्रांसफर
- ईएमआई उपलब्ध (3, 6, 12 महीने)
- क्रेडिट/डेबिट कार्ड स्वीकृत
- यूपीआई भुगतान

🎁 **विशेष ऑफर**: जल्दी पंजीकरण पर 10% छूट!`
  },
  contact: {
    keywords: ['संपर्क', 'फोन', 'कॉल', 'ईमेल', 'पता', 'स्थान', 'भेंटना'],
    response: `📞 **संपर्क जानकारी**:

📱 **फोन**: 9272000111
📧 **ईमेल**: info@tusharbhumkarinstitute.com
📍 **पता**: पुणे, महाराष्ट्र

🕐 **कार्यालय समय**:
- सोमवार से शुक्रवार: सुबह 9:00 बजे - शाम 7:00 बजे
- शनिवार: सुबह 9:00 बजे - शाम 5:00 बजे
- रविवार: बंद

💬 **व्हाट्सएप**: त्वरित प्रश्नों के लिए उसी नंबर पर उपलब्ध`
  },
  bye: {
    keywords: ['बाय', 'अलविदा', 'धन्यवाद', 'शुक्रिया', 'फिर मिलेंगे', 'बाहर निकलें'],
    response: `तुषार भुमकर इंस्टिट्यूट से संपर्क करने के लिए धन्यवाद! 😊

📞 आगे की सहायता के लिए कृपया 9272000111 पर कॉल करें।

आपका दिन शुभ हो! 🌟`
  },
  default: {
    keywords: [],
    response: `मैं समझता हूं कि आप हमारे कोर्सेस में रुचि रखते हैं। यहां बताया गया है कि मैं कैसे मदद कर सकता हूं:

📚 **कोर्स जानकारी**:
- बेसिक वर्कशॉप (2 सप्ताह)
- एडवांस्ड वर्कशॉप (4 सप्ताह)
- कंबो पैकेज उपलब्ध

📞 **संपर्क**: 9272000111
📧 **ईमेल**: info@tusharbhumkarinstitute.com

💬 **अधिक जानने के लिए इनमें से कोई भी टाइप करें**:
- 'कोर्स' - कोर्स विवरण
- 'फीस' - फीस संरचना
- 'संपर्क' - संपर्क जानकारी
- 'अवधि' - कोर्स समय

या हमारे प्रशिक्षण कार्यक्रमों के बारे में कुछ भी पूछें!`
  }
};

// Marathi bot responses
const marathiBotResponses = {
  greetings: {
    keywords: ['नमस्कार', 'हाय', 'हॅलो', 'शुभ सकाळ', 'शुभ दुपार', 'शुभ संध्याकाळ'],
    response: "नमस्कार! तुषार भुमकर इन्स्टिट्यूटमध्ये आपले स्वागत आहे. आज मी तुम्हाला कशी मदत करू शकतो?"
  },
  courses: {
    keywords: ['कोर्स', 'अभ्यासक्रम', 'प्रशिक्षण', 'वर्कशॉप', 'शिकणे'],
    response: `आम्ही इंट्राडे कमोडिटी ट्रेडिंगवर एक विशेष कोर्स देतो, जो दो भागांमध्ये विभाजित आहे:

**बेसिक वर्कशॉप**: हा मॉड्यूल निफ्टी, स्टॉक्स आणि पार्ट-टाईम इंट्राडे ट्रेडिंगमध्ये संपूर्ण प्रशिक्षण देतो, जो दैनिक, साप्ताहिक आणि मासिक ट्रेडिंग दृष्टिकोनांचा समावेश करतो.

**एडव्हान्स्ड वर्कशॉप**: हा मॉड्यूल पार्ट-टाईम आणि फुल-टाईम ट्रेडर्ससाठी डिझाइन केलेला आहे, विशेषतः जे ओव्हरट्रेडिंग, ऑप्शन्स ट्रॅप आणि दीर्घकालीन गुंतवणुकीत नुकसान यांसारख्या समस्यांचा सामना करत आहेत.

हा अनुशासन, जोखम व्यवस्थापन आणि प्रगत ट्रेडिंग रणनीतींवर केंद्रित आहे.

**प्रशिक्षण तज्ञ**: सर्व कार्यशाळा श्री. तुषार भुमकर यांच्या द्वारे होतात, ज्यांना इंट्राडे ट्रेडिंगमध्ये व्यापक अनुभव आहे.

**अधिक माहितीसाठी**: 9272000111 वर कॉल करा`
  },
  fees: {
    keywords: ['फीस', 'किंमत', 'खर्च', 'भरणे', 'ईएमआय'],
    response: `💰 **कोर्स फी आणि पेमेंट पर्याय**:

**बेसिक वर्कशॉप**: ₹15,000
**एडव्हान्स्ड वर्कशॉप**: ₹25,000
**कॉम्बो पॅकेज**: ₹35,000 (₹5,000 वाचवा)

💳 **पेमेंट पर्याय**:
- रोख पेमेंट
- बँक ट्रान्सफर
- ईएमआय उपलब्ध (3, 6, 12 महिने)
- क्रेडिट/डेबिट कार्ड स्वीकारले जातात
- यूपीआय पेमेंट

🎁 **विशेष ऑफर**: लवकर नोंदणीसाठी 10% सूट!`
  },
  contact: {
    keywords: ['संपर्क', 'फोन', 'कॉल', 'ईमेल', 'पत्ता', 'ठिकाण', 'भेट द्या'],
    response: `📞 **संपर्क माहिती**:

📱 **फोन**: 9272000111
📧 **ईमेल**: info@tusharbhumkarinstitute.com
📍 **पत्ता**: पुणे, महाराष्ट्र

🕐 **कार्यालयीन वेळ**:
- सोमवार ते शुक्रवार: सकाळी 9:00 ते सायंकाळी 7:00
- शनिवार: सकाळी 9:00 ते सायंकाळी 5:00
- रविवार: बंद

💬 **व्हॉट्सअॅप**: त्वरित प्रश्नांसाठी समान क्रमांकावर उपलब्ध`
  },
  bye: {
    keywords: ['बाय', 'निरोप', 'धन्यवाद', 'आभार', 'पुन्हा भेटू', 'बाहेर पडा'],
    response: `तुषार भुमकर इन्स्टिट्यूटशी संपर्क साधल्याबद्दल धन्यवाद! 😊

📞 पुढील मदतीसाठी कृपया 9272000111 वर कॉल करा.

तुमचा दिवस चांगला जावो! 🌟`
  },
  default: {
    keywords: [],
    response: `मी समजतो की तुम्हाला आमच्या कोर्सेंमध्ये स्वारस्य आहे. मी कशी मदत करू शकतो ते येथे आहे:

📚 **कोर्स माहिती**:
- बेसिक वर्कशॉप (2 आठवडे)
- एडव्हान्स्ड वर्कशॉप (4 आठवडे)
- कॉम्बो पॅकेज उपलब्ध

📞 **संपर्क**: 9272000111
📧 **ईमेल**: info@tusharbhumkarinstitute.com

💬 **अधिक जाणून घेण्यासाठी यापैकी कोणतेही टाइप करा**:
- 'कोर्स' - कोर्स तपशील
- 'फीस' - फी संरचना
- 'संपर्क' - संपर्क माहिती
- 'कालावधी' - कोर्स वेळ

किंवा आमच्या प्रशिक्षण कार्यक्रमांविषयी काहीही विचारा!`
  }
};

// Helper function to extract actual UUID from customer ID
function extractCustomerId(customerId) {
  if (customerId && customerId.startsWith('customer_')) {
    return customerId.substring(9);
  }
  return customerId;
}

// Custom bot response function with language support
function getBotResponse(message, language = 'english') {
  const lowerMessage = message.toLowerCase();
  
  // Select appropriate response set based on language
  let responseSet;
  if (language === 'hindi') {
    responseSet = hindiBotResponses;
  } else if (language === 'marathi') {
    responseSet = marathiBotResponses;
  } else {
    responseSet = botResponses;
  }
  
  // Check each category for keyword matches
  for (const [category, data] of Object.entries(responseSet)) {
    if (category === 'default') continue; // Skip default for now
    
    for (const keyword of data.keywords) {
      if (lowerMessage.includes(keyword.toLowerCase())) {
        return data.response;
      }
    }
  }
  
  // Return default response if no match found
  return responseSet.default.response;
}

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create customers table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        mobile VARCHAR(20) UNIQUE NOT NULL,
        email VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create conversations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id VARCHAR(255) PRIMARY KEY,
        customer_id UUID NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        customer_mobile VARCHAR(20),
        customer_email VARCHAR(255),
        agent_id VARCHAR(255),
        agent_name VARCHAR(255),
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP,
        last_message_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_message TEXT DEFAULT 'Conversation started',
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'closed', 'queued')),
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        feedback TEXT,
        language VARCHAR(20) DEFAULT 'english'
      )
    `);

    // Create messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(255) PRIMARY KEY,
        conversation_id VARCHAR(255) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender VARCHAR(255) NOT NULL,
        sender_id VARCHAR(255),
        type VARCHAR(20) NOT NULL CHECK (type IN ('user', 'agent', 'bot', 'system')),
        content TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read_status BOOLEAN DEFAULT FALSE,
        language VARCHAR(20) DEFAULT 'english'
      )
    `);

    // Create agent availability table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_availability (
        agent_id VARCHAR(255) PRIMARY KEY,
        agent_name VARCHAR(255) NOT NULL,
        status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'busy', 'away')),
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        current_conversation_id VARCHAR(255) REFERENCES conversations(id),
        max_concurrent_conversations INTEGER DEFAULT 5,
        current_conversation_count INTEGER DEFAULT 0
      )
    `);

    // Create indexes for better performance
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_conversations_customer_id ON conversations(customer_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_availability_status ON agent_availability(status)`);

    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  }
}

// Initialize database on startup
initializeDatabase();

// Store active agents and customer socket mappings
const activeAgents = new Map();
const customerSockets = new Map();
const pendingAgentRequests = [];

// --- HTTP API Endpoints ---

// Create or update customer
app.post("/api/customer", async (req, res) => {
  try {
    const { name, mobile, email } = req.body;
    
    if (!name || !mobile) {
      return res.status(400).json({ error: "Name and mobile number are required" });
    }
    
    // Validate mobile number (10 digits)
    const mobileDigits = mobile.replace(/\D/g, '');
    if (mobileDigits.length !== 10) {
      return res.status(400).json({ error: "Invalid mobile number format" });
    }
    
    // Check if customer already exists
    const existingCustomer = await pool.query(
      'SELECT * FROM customers WHERE mobile = $1',
      [mobileDigits]
    );
    
    let customer;
    if (existingCustomer.rows.length > 0) {
      // Update existing customer
      const updateResult = await pool.query(
        'UPDATE customers SET name = $1, email = $2, last_seen = CURRENT_TIMESTAMP WHERE mobile = $3 RETURNING *',
        [name, email || null, mobileDigits]
      );
      customer = updateResult.rows[0];
    } else {
      // Create new customer
      const insertResult = await pool.query(
        `INSERT INTO customers (id, name, mobile, email, created_at, last_seen) 
         VALUES (gen_random_uuid(), $1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
        [name, mobileDigits, email || null]
      );
      customer = insertResult.rows[0];
    }
    
    res.json({
      success: true,
      customer: {
        id: customer.id,
        name: customer.name,
        mobile: customer.mobile,
        email: customer.email
      }
    });
  } catch (error) {
    console.error("Error creating/updating customer:", error);
    res.status(500).json({ error: "Failed to save customer information" });
  }
});

// Get all conversations
app.get("/api/conversations", async (req, res) => {
  try {
    const { status, agent_id } = req.query;
    let query = 'SELECT * FROM conversations';
    const params = [];
    const conditions = [];
    
    if (status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }
    
    if (agent_id) {
      conditions.push(`agent_id = $${params.length + 1}`);
      params.push(agent_id);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY start_time DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get specific conversation with messages
app.get("/api/conversation/:conversationId", async (req, res) => {
  try {
    const conversationResult = await pool.query(
      'SELECT * FROM conversations WHERE id = $1',
      [req.params.conversationId]
    );
    
    if (conversationResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    
    const messagesResult = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC',
      [req.params.conversationId]
    );
    
    // Mark messages as read
    await pool.query(
      'UPDATE messages SET read_status = TRUE WHERE conversation_id = $1 AND type = \'user\' AND read_status = FALSE',
      [req.params.conversationId]
    );
    
    res.json({ 
      conversation: conversationResult.rows[0], 
      messages: messagesResult.rows 
    });
  } catch (error) {
    console.error("Error fetching conversation:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get conversations for a specific agent
app.get("/api/agent/:agentId/conversations", async (req, res) => {
  try {
    const conversationsResult = await pool.query(
      'SELECT * FROM conversations WHERE agent_id = $1 AND status IN (\'active\', \'queued\') ORDER BY last_message_time DESC',
      [req.params.agentId]
    );
    
    const conversations = await Promise.all(conversationsResult.rows.map(async (conv) => {
      const unreadResult = await pool.query(
        'SELECT COUNT(*) as unread_count FROM messages WHERE conversation_id = $1 AND type = \'user\' AND read_status = FALSE',
        [conv.id]
      );
      
      return {
        ...conv,
        unreadCount: parseInt(unreadResult.rows[0].unread_count)
      };
    }));
    
    res.json(conversations);
  } catch (error) {
    console.error("Error fetching agent conversations:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get conversations for a specific customer
app.get("/api/customer/:customerId/conversations", async (req, res) => {
  try {
    const actualCustomerId = extractCustomerId(req.params.customerId);
    const conversationsResult = await pool.query(
      'SELECT * FROM conversations WHERE customer_id = $1 ORDER BY start_time DESC',
      [actualCustomerId]
    );
    
    const result = await Promise.all(conversationsResult.rows.map(async (conv) => {
      const messagesResult = await pool.query(
        'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC',
        [conv.id]
      );
      
      return {
        conversation: conv,
        messages: messagesResult.rows
      };
    }));
    
    res.json(result);
  } catch (error) {
    console.error("Error fetching customer conversations:", error);
    res.status(500).json({ error: error.message });
  }
});

// Submit feedback for a conversation
app.post("/api/conversation/:conversationId/feedback", async (req, res) => {
  try {
    const { rating, feedback } = req.body;
    
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Valid rating (1-5) is required" });
    }
    
    const result = await pool.query(
      'UPDATE conversations SET rating = $1, feedback = $2 WHERE id = $3 RETURNING *',
      [rating, feedback, req.params.conversationId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error submitting feedback:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get all active agents
app.get("/api/agents", async (req, res) => {
  try {
    // Get agents from database
    const dbAgents = await pool.query('SELECT * FROM agent_availability WHERE status != \'offline\'');
    
    // Combine with in-memory agents
    const agents = Array.from(activeAgents.values()).map(agent => {
      const dbAgent = dbAgents.rows.find(a => a.agent_id === agent.id);
      return {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        currentCustomerId: agent.currentCustomerId,
        maxConcurrentConversations: dbAgent?.max_concurrent_conversations || 5,
        currentConversationCount: dbAgent?.current_conversation_count || 0
      };
    });
    
    res.json(agents);
  } catch (error) {
    console.error("Error fetching agents:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get agent statistics
app.get("/api/agent/:agentId/stats", async (req, res) => {
  try {
    const agentId = req.params.agentId;
    
    // Get conversation stats
    const conversationStats = await pool.query(
      `SELECT 
        COUNT(*) as total_conversations,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_conversations,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_conversations,
        AVG(rating) as avg_rating
      FROM conversations WHERE agent_id = $1`,
      [agentId]
    );
    
    // Get message stats
    const messageStats = await pool.query(
      `SELECT 
        COUNT(*) as total_messages,
        COUNT(CASE WHEN type = 'agent' THEN 1 END) as agent_messages,
        COUNT(CASE WHEN type = 'user' THEN 1 END) as user_messages
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.agent_id = $1`,
      [agentId]
    );
    
    // Get response time stats
    const responseTimeStats = await pool.query(
      `SELECT 
        AVG(
          EXTRACT(EPOCH FROM (m2.timestamp - m1.timestamp))
        ) as avg_response_time_seconds
      FROM messages m1
      JOIN messages m2 ON m1.conversation_id = m2.conversation_id
      JOIN conversations c ON m1.conversation_id = c.id
      WHERE c.agent_id = $1 
      AND m1.type = 'user' 
      AND m2.type = 'agent'
      AND m2.timestamp > m1.timestamp
      AND m2.id = (
        SELECT MIN(m3.id) 
        FROM messages m3 
        WHERE m3.conversation_id = m1.conversation_id 
        AND m3.type = 'agent' 
        AND m3.timestamp > m1.timestamp
      )`,
      [agentId]
    );
    
    res.json({
      conversationStats: conversationStats.rows[0],
      messageStats: messageStats.rows[0],
      responseTimeStats: responseTimeStats.rows[0]
    });
  } catch (error) {
    console.error("Error fetching agent stats:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- WebSocket Connection Handling ---

io.on('connection', (socket) => {
  console.log('🌐 New client connected:', socket.id);

  socket.on('customer_join', async (data) => {
    const { name, mobile, email, customerId, language } = data;
    const actualCustomerId = extractCustomerId(customerId);
    
    console.log(`👤 CUSTOMER JOIN: ${name} (${mobile}) (${customerId}) on socket ${socket.id}`);
    customerSockets.set(customerId, socket.id);
    
    try {
      // Check if there's an existing active conversation
      const conversationResult = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'',
        [actualCustomerId]
      );
      
      let conversation;
      if (conversationResult.rows.length === 0) {
        // Create a new conversation
        const insertResult = await pool.query(
          `INSERT INTO conversations (id, customer_id, customer_name, customer_mobile, customer_email, status, language) 
           VALUES ($1, $2, $3, $4, $5, 'active', $6) RETURNING *`,
          [uuidv4(), actualCustomerId, name, mobile, email || null, language || 'english']
        );
        conversation = insertResult.rows[0];
      } else {
        // Update language if provided
        if (language && language !== conversationResult.rows[0].language) {
          const updateResult = await pool.query(
            'UPDATE conversations SET language = $1 WHERE id = $2 RETURNING *',
            [language, conversationResult.rows[0].id]
          );
          conversation = updateResult.rows[0];
        } else {
          conversation = conversationResult.rows[0];
        }
      }
      
      // Add system message
      await pool.query(
        `INSERT INTO messages (id, conversation_id, sender, type, content, language) 
         VALUES ($1, $2, 'System', 'system', 'Customer joined the chat', $3)`,
        [uuidv4(), conversation.id, conversation.language]
      );
      
      // Join the room for this conversation
      const roomName = `room_${customerId}`;
      socket.join(roomName);
      
      // Send connection status to customer
      socket.emit('connection_status', { 
        status: 'connected', 
        socketId: socket.id, 
        customerId: customerId, 
        conversationId: conversation.id,
        language: conversation.language
      });
      
      // Notify all agents about the new customer
      io.to('agents').emit('new_customer', { 
        customerId: customerId, 
        customerName: name, 
        customerMobile: mobile,
        customerEmail: email,
        message: 'New customer joined', 
        conversationId: conversation.id,
        language: conversation.language
      });
    } catch (error) {
      console.error('Error handling customer join:', error);
      socket.emit('error', { message: 'Failed to join chat. Please try again.' });
    }
  });

  socket.on('agent_join', async (data) => {
    const { name, maxConcurrentConversations } = data || {};
    const agentName = name || 'Unknown Agent';
    console.log(`👨‍💼 AGENT JOIN: ${agentName} on socket ${socket.id}`);
    
    try {
      // Store agent information
      activeAgents.set(socket.id, { 
        id: socket.id, 
        name: agentName, 
        status: 'available', 
        currentCustomerId: null,
        maxConcurrentConversations: maxConcurrentConversations || 5
      });
      
      // Update agent availability in database
      await pool.query(
        `INSERT INTO agent_availability (agent_id, agent_name, status, max_concurrent_conversations, current_conversation_count)
         VALUES ($1, $2, 'online', $3, 0)
         ON CONFLICT (agent_id) 
         DO UPDATE SET 
           agent_name = $2, 
           status = 'online', 
           last_seen = CURRENT_TIMESTAMP,
           max_concurrent_conversations = $3`,
        [socket.id, agentName, maxConcurrentConversations || 5]
      );
      
      console.log(`📊 Active agents count is now: ${activeAgents.size}`);
      
      // Join the agents room
      socket.join('agents');
      
      // Send confirmation to agent
      socket.emit('agent_connected', { 
        status: 'connected',
        agentId: socket.id,
        agentName: agentName
      });
      
      // Update all clients with agent count
      io.emit('agent_status', { agentCount: activeAgents.size });
      
      // Check if there are pending customers in queue
      if (pendingAgentRequests.length > 0) {
        const nextRequest = pendingAgentRequests.shift();
        
        // Update queue positions for remaining requests
        pendingAgentRequests.forEach((req, index) => {
          io.to(`room_${req.customerId}`).emit('queue_status', {
            status: 'queued',
            message: 'All agents are currently busy. You\'ll be connected to the next available agent.',
            position: index + 1
          });
        });
        
        // Assign this agent to the next customer
        socket.emit('customer_request', {
          customerId: nextRequest.customerId,
          customerName: nextRequest.customerName,
          conversationId: nextRequest.conversationId
        });
      }
    } catch (error) {
      console.error('Error handling agent join:', error);
      socket.emit('error', { message: 'Failed to connect as agent. Please try again.' });
    }
  });

  socket.on('customer_message', async (data) => {
    const { message, customerName, customerId } = data;
    const actualCustomerId = extractCustomerId(customerId);
    
    console.log(`💬 CUSTOMER MESSAGE from ${customerName} (${customerId}): "${message}"`);
    
    try {
      // Find or create conversation
      const conversationResult = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'',
        [actualCustomerId]
      );
      
      let conversation;
      if (conversationResult.rows.length === 0) {
        const insertResult = await pool.query(
          `INSERT INTO conversations (id, customer_id, customer_name, status) 
           VALUES ($1, $2, $3, 'active') RETURNING *`,
          [uuidv4(), actualCustomerId, customerName]
        );
        conversation = insertResult.rows[0];
      } else {
        conversation = conversationResult.rows[0];
      }
      
      // Detect language if not already set
      let language = conversation.language;
      if (!language) {
        language = detectLanguage(message);
        await pool.query(
          'UPDATE conversations SET language = $1 WHERE id = $2',
          [language, conversation.id]
        );
      }
      
      // Save the customer message
      await pool.query(
        `INSERT INTO messages (id, conversation_id, sender, sender_id, type, content, language) 
         VALUES ($1, $2, $3, $4, 'user', $5, $6)`,
        [uuidv4(), conversation.id, customerName, customerId, message, language]
      );
      
      // Update conversation with last message info
      await pool.query(
        'UPDATE conversations SET last_message = $1, last_message_time = CURRENT_TIMESTAMP WHERE id = $2',
        [message, conversation.id]
      );
      
      // Send message to all agents
      io.to('agents').emit('new_message', { 
        customerId: customerId, 
        sender: customerName, 
        text: message, 
        conversationId: conversation.id, 
        timestamp: new Date(),
        language: language
      });
      
      // If there's an assigned agent, send directly to them
      if (conversation.agent_id) {
        console.log(`-> Message routed to agent ${conversation.agent_id}.`);
        return;
      }
      
      // Otherwise, get custom bot response based on language
      const botReply = getBotResponse(message, language);
      
      // Save bot message
      await pool.query(
        `INSERT INTO messages (id, conversation_id, sender, type, content, language) 
           VALUES ($1, $2, 'Bot', 'bot', $3, $4)`,
        [uuidv4(), conversation.id, botReply, language]
      );
      
      // Update conversation with last message info
      await pool.query(
        'UPDATE conversations SET last_message = $1, last_message_time = CURRENT_TIMESTAMP WHERE id = $2',
        [botReply, conversation.id]
      );
      
      // Send bot response to customer
      io.to(`room_${customerId}`).emit('agent_message', { 
        text: botReply, 
        timestamp: new Date(),
        sender: 'Bot'
      });
      
      // Also send to agents for visibility
      io.to('agents').emit('new_message', { 
        customerId: customerId, 
        sender: 'Bot', 
        text: botReply, 
        conversationId: conversation.id, 
        timestamp: new Date(),
        language: language
      });
      
    } catch (error) {
      console.error("Error handling customer message:", error);
      socket.emit('error', { message: 'Failed to send message. Please try again.' });
    }
  });

  socket.on('agent_message', async (data) => {
    const { message, agentName, customerId, conversationId } = data;
    const actualCustomerId = extractCustomerId(customerId);
    
    console.log(`👨‍💼 AGENT MESSAGE from ${agentName} to ${customerId}: "${message}"`);
    
    try {
      // Find the conversation
      let conversation;
      if (conversationId) {
        const convResult = await pool.query(
          'SELECT * FROM conversations WHERE id = $1',
          [conversationId]
        );
        if (convResult.rows.length > 0) {
          conversation = convResult.rows[0];
        }
      } else {
        const convResult = await pool.query(
          'SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'',
          [actualCustomerId]
        );
        if (convResult.rows.length > 0) {
          conversation = convResult.rows[0];
        }
      }
      
      if (!conversation) return;
      
      // Save the agent message
      await pool.query(
        `INSERT INTO messages (id, conversation_id, sender, sender_id, type, content, language) 
           VALUES ($1, $2, $3, $4, 'agent', $5, $6)`,
        [uuidv4(), conversation.id, agentName, socket.id, message, conversation.language]
      );
      
      // Update conversation with last message info
      await pool.query(
        'UPDATE conversations SET last_message = $1, last_message_time = CURRENT_TIMESTAMP WHERE id = $2',
        [message, conversation.id]
      );
      
      // Send message to customer
      io.to(`room_${customerId}`).emit('agent_message', { 
        text: message, 
        timestamp: new Date(),
        sender: agentName
      });
      
      // Mark customer messages as read
      await pool.query(
        'UPDATE messages SET read_status = TRUE WHERE conversation_id = $1 AND type = \'user\' AND read_status = FALSE',
        [conversation.id]
      );
    } catch (error) {
      console.error("Error handling agent message:", error);
      socket.emit('error', { message: 'Failed to send message. Please try again.' });
    }
  });

  socket.on('request_agent', async (data) => {
    const { customerId, customerName } = data;
    const actualCustomerId = extractCustomerId(customerId);
    
    console.log(`\n🙋‍♂️ AGENT REQUEST RECEIVED from ${customerName} (${customerId})`);
    
    try {
      // Find the conversation
      const conversationResult = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND status = \'active\'',
        [actualCustomerId]
      );
      
      if (conversationResult.rows.length === 0) return;
      
      const conversation = conversationResult.rows[0];
      
      // Update conversation status to queued
      await pool.query(
        'UPDATE conversations SET status = \'queued\' WHERE id = $1',
        [conversation.id]
      );
      
      // Add system message
      await pool.query(
        `INSERT INTO messages (id, conversation_id, sender, type, content, language) 
         VALUES ($1, $2, 'System', 'system', 'Customer requested to speak with an agent', $3)`,
        [uuidv4(), conversation.id, conversation.language]
      );
      
      // Find an available agent
      const availableAgent = Array.from(activeAgents.values()).find(
        agent => agent.status === 'available'
      );
      
      if (availableAgent) {
        console.log(`✅ Found available agent: ${availableAgent.name} (${availableAgent.id})`);
        
        // Assign agent to conversation
        await pool.query(
          'UPDATE conversations SET agent_id = $1, agent_name = $2, status = \'active\' WHERE id = $3',
          [availableAgent.id, availableAgent.name, conversation.id]
        );
        
        // Update agent status
        const agentData = activeAgents.get(availableAgent.id);
        activeAgents.set(availableAgent.id, {
          ...agentData,
          status: 'busy',
          currentCustomerId: customerId
        });
        
        // Update agent availability in database
        await pool.query(
          `UPDATE agent_availability 
           SET status = 'busy', current_conversation_id = $1, current_conversation_count = current_conversation_count + 1
           WHERE agent_id = $2`,
          [conversation.id, availableAgent.id]
        );
        
        // Notify agent
        io.to(availableAgent.id).emit('agent_assignment', {
          customerId,
          customerName,
          conversationId: conversation.id
        });
        
        // Notify customer
        io.to(`room_${customerId}`).emit('agent_joined', {
          agentName: availableAgent.name,
          message: `${availableAgent.name} has joined the chat`
        });
        
        // Notify all agents about the assignment
        io.to('agents').emit('agent_assigned', {
          agentId: availableAgent.id,
          agentName: availableAgent.name,
          customerId,
          customerName
        });
      } else {
        console.log(`❌ No available agents. Adding to queue.`);
        
        // Add to pending requests
        pendingAgentRequests.push({
          customerId,
          customerName,
          conversationId: conversation.id,
          timestamp: new Date()
        });
        
        // Notify customer they're in queue
        io.to(`room_${customerId}`).emit('queue_status', {
          status: 'queued',
          message: 'All agents are currently busy. You\'ll be connected to the next available agent.',
          position: pendingAgentRequests.length
        });
        
        // Notify all agents about the queue
        io.to('agents').emit('customer_queued', {
          customerId,
          customerName,
          queuePosition: pendingAgentRequests.length
        });
      }
    } catch (error) {
      console.error("Error handling agent request:", error);
      socket.emit('error', { message: 'Failed to request agent. Please try again.' });
    }
  });

  socket.on('accept_customer', async (data) => {
    const { customerId, customerName, conversationId } = data;
    const actualCustomerId = extractCustomerId(customerId);
    const agentId = socket.id;
    const agentData = activeAgents.get(agentId);
    
    if (!agentData) return;
    
    console.log(`👨‍💼 AGENT ${agentData.name} (${agentId}) ACCEPTED customer ${customerName} (${customerId})`);
    
    try {
      // Update conversation with agent info
      await pool.query(
        'UPDATE conversations SET agent_id = $1, agent_name = $2, status = \'active\' WHERE id = $3',
        [agentId, agentData.name, conversationId]
      );
      
      // Update agent status
      activeAgents.set(agentId, {
        ...agentData,
        status: 'busy',
        currentCustomerId: customerId
      });
      
      // Update agent availability in database
      await pool.query(
        `UPDATE agent_availability 
         SET status = 'busy', current_conversation_id = $1, current_conversation_count = current_conversation_count + 1
         WHERE agent_id = $2`,
        [conversationId, agentId]
      );
      
      // Remove from pending requests if present
      const requestIndex = pendingAgentRequests.findIndex(
        req => req.customerId === customerId
      );
      
      if (requestIndex !== -1) {
        pendingAgentRequests.splice(requestIndex, 1);
        
        // Update queue positions for remaining requests
        pendingAgentRequests.forEach((req, index) => {
          io.to(`room_${req.customerId}`).emit('queue_status', {
            status: 'queued',
            message: 'All agents are currently busy. You\'ll be connected to the next available agent.',
            position: index + 1
          });
        });
      }
      
      // Add system message
      await pool.query(
        `INSERT INTO messages (id, conversation_id, sender, type, content, language) 
         VALUES ($1, $2, 'System', 'system', 'Agent joined the conversation', $3)`,
        [uuidv4(), conversationId, 'english']
      );
      
      // Notify customer
      io.to(`room_${customerId}`).emit('agent_joined', {
        agentName: agentData.name,
        message: `${agentData.name} has joined the chat`
      });
      
      // Notify all agents about the assignment
      io.to('agents').emit('agent_assigned', {
        agentId,
        agentName: agentData.name,
        customerId,
        customerName
      });
      
      // Send conversation history to agent
      const messagesResult = await pool.query(
        'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC',
        [conversationId]
      );
      
      socket.emit('conversation_history', {
        conversationId,
        customerId,
        customerName,
        messages: messagesResult.rows
      });
    } catch (error) {
      console.error("Error accepting customer:", error);
      socket.emit('error', { message: 'Failed to accept customer. Please try again.' });
    }
  });

  socket.on('end_conversation', async (data) => {
    const { customerId, conversationId } = data;
    const actualCustomerId = extractCustomerId(customerId);
    const agentData = activeAgents.get(socket.id);
    
    if (!agentData) return;
    
    console.log(`🔚 ENDING CONVERSATION between agent ${agentData.name} and customer ${customerId}`);
    
    try {
      // Update conversation status
      await pool.query(
        'UPDATE conversations SET status = \'closed\', end_time = CURRENT_TIMESTAMP WHERE id = $1',
        [conversationId]
      );
      
      // Add system message
      await pool.query(
        `INSERT INTO messages (id, conversation_id, sender, type, content, language) 
         VALUES ($1, $2, 'System', 'system', 'Conversation ended', $3)`,
        [uuidv4(), conversationId, 'english']
      );
      
      // Update agent status to available
      activeAgents.set(socket.id, {
        ...agentData,
        status: 'available',
        currentCustomerId: null
      });
      
      // Update agent availability in database
      await pool.query(
        `UPDATE agent_availability 
         SET status = 'available', current_conversation_id = NULL, current_conversation_count = current_conversation_count - 1
         WHERE agent_id = $1`,
        [socket.id]
      );
      
      // Notify customer
      io.to(`room_${customerId}`).emit('conversation_ended', {
        message: 'Your conversation has been ended. Thank you for chatting with us!',
        showFeedback: true
      });
      
      // Notify all agents
      io.to('agents').emit('conversation_ended', {
        agentId: socket.id,
        customerId,
        conversationId
      });
      
      // Check if there are pending customers in queue
      if (pendingAgentRequests.length > 0) {
        const nextRequest = pendingAgentRequests.shift();
        
        // Update queue positions for remaining requests
        pendingAgentRequests.forEach((req, index) => {
          io.to(`room_${req.customerId}`).emit('queue_status', {
            status: 'queued',
            message: 'All agents are currently busy. You\'ll be connected to the next available agent.',
            position: index + 1
          });
        });
        
        // Assign this agent to the next customer
        await pool.query(
          'UPDATE conversations SET agent_id = $1, agent_name = $2, status = \'active\' WHERE id = $3',
          [socket.id, agentData.name, nextRequest.conversationId]
        );
        
        // Update agent status
        activeAgents.set(socket.id, {
          ...agentData,
          status: 'busy',
          currentCustomerId: nextRequest.customerId
        });
        
        // Update agent availability in database
        await pool.query(
          `UPDATE agent_availability 
           SET status = 'busy', current_conversation_id = $1, current_conversation_count = current_conversation_count + 1
           WHERE agent_id = $2`,
          [nextRequest.conversationId, socket.id]
        );
        
        // Notify agent
        socket.emit('agent_assignment', {
          customerId: nextRequest.customerId,
          customerName: nextRequest.customerName,
          conversationId: nextRequest.conversationId
        });
        
        // Notify customer
        io.to(`room_${nextRequest.customerId}`).emit('agent_joined', {
          agentName: agentData.name,
          message: `${agentData.name} has joined the chat`
        });
        
        // Notify all agents about the assignment
        io.to('agents').emit('agent_assigned', {
          agentId: socket.id,
          agentName: agentData.name,
          customerId: nextRequest.customerId,
          customerName: nextRequest.customerName
        });
      }
    } catch (error) {
      console.error("Error ending conversation:", error);
      socket.emit('error', { message: 'Failed to end conversation. Please try again.' });
    }
  });

  socket.on('typing', (data) => {
    const { customerId, isTyping } = data;
    const actualCustomerId = extractCustomerId(customerId);
    const agentData = activeAgents.get(socket.id);
    
    if (agentData) {
      // Agent is typing, notify customer
      io.to(`room_${customerId}`).emit('typing_indicator', {
        sender: agentData.name,
        isTyping
      });
    } else {
      // Customer is typing, notify their assigned agent
      pool.query(
        'SELECT agent_id FROM conversations WHERE customer_id = $1 AND status = \'active\'',
        [actualCustomerId]
      ).then(result => {
        if (result.rows.length > 0 && result.rows[0].agent_id) {
          io.to(result.rows[0].agent_id).emit('typing_indicator', {
            sender: 'Customer',
            isTyping
          });
        }
      }).catch(err => console.error('Error fetching agent for typing indicator:', err));
    }
  });

  socket.on('agent_status_change', async (data) => {
    const { status } = data;
    const agentData = activeAgents.get(socket.id);
    
    if (!agentData) return;
    
    console.log(`👨‍💼 AGENT ${agentData.name} (${socket.id}) STATUS CHANGE: ${status}`);
    
    try {
      // Update agent status in memory
      activeAgents.set(socket.id, {
        ...agentData,
        status: status
      });
      
      // Update agent status in database
      await pool.query(
        'UPDATE agent_availability SET status = $1, last_seen = CURRENT_TIMESTAMP WHERE agent_id = $2',
        [status, socket.id]
      );
      
      // If agent is going offline and has active conversation, handle it
      if (status === 'offline' && agentData.currentCustomerId) {
        const customerId = agentData.currentCustomerId;
        const actualCustomerId = extractCustomerId(customerId);
        
        // Update conversation
        pool.query(
          'UPDATE conversations SET agent_id = NULL, agent_name = NULL, status = \'queued\' WHERE customer_id = $1 AND status = \'active\'',
          [actualCustomerId]
        ).then(() => {
          // Add system message
          return pool.query(
            'SELECT id FROM conversations WHERE customer_id = $1 AND status = \'queued\' ORDER BY start_time DESC LIMIT 1',
            [actualCustomerId]
          );
        }).then(result => {
          if (result.rows.length > 0) {
            return pool.query(
              `INSERT INTO messages (id, conversation_id, sender, type, content, language) 
               VALUES ($1, $2, 'System', 'system', 'Agent disconnected. You have been re-queued for the next available agent.', $3)`,
              [uuidv4(), result.rows[0].id, 'english']
            );
          }
        }).then(() => {
          // Notify customer
          io.to(`room_${customerId}`).emit('agent_disconnected', {
            message: 'The agent has disconnected. You have been placed back in the queue.',
            requeued: true
          });
          
          // Add to pending requests
          const customerName = agentData.currentCustomerId;
          pendingAgentRequests.push({
            customerId,
            customerName,
            timestamp: new Date()
          });
          
          // Notify all agents
          io.to('agents').emit('agent_disconnected', {
            agentId: socket.id,
            agentName: agentData.name,
            customerId
          });
        }).catch(err => console.error('Error handling agent status change to offline:', err));
      }
      
      // Notify all agents about the status change
      io.to('agents').emit('agent_status_update', {
        agentId: socket.id,
        agentName: agentData.name,
        status: status
      });
    } catch (error) {
      console.error("Error updating agent status:", error);
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
    
    // Check if it's an agent
    const agentData = activeAgents.get(socket.id);
    if (agentData) {
      console.log(`👨‍💼 Agent ${agentData.name} disconnected`);
      
      // If agent was in a conversation, handle it
      if (agentData.currentCustomerId) {
        const customerId = agentData.currentCustomerId;
        const actualCustomerId = extractCustomerId(customerId);
        
        // Update conversation
        pool.query(
          'UPDATE conversations SET agent_id = NULL, agent_name = NULL, status = \'queued\' WHERE customer_id = $1 AND status = \'active\'',
          [actualCustomerId]
        ).then(() => {
          // Add system message
          return pool.query(
            'SELECT id FROM conversations WHERE customer_id = $1 AND status = \'queued\' ORDER BY start_time DESC LIMIT 1',
            [actualCustomerId]
          );
        }).then(result => {
          if (result.rows.length > 0) {
            return pool.query(
              `INSERT INTO messages (id, conversation_id, sender, type, content, language) 
               VALUES ($1, $2, 'System', 'system', 'Agent disconnected. You have been re-queued for the next available agent.', $3)`,
              [uuidv4(), result.rows[0].id, 'english']
            );
          }
        }).then(() => {
          // Notify customer
          io.to(`room_${customerId}`).emit('agent_disconnected', {
            message: 'The agent has disconnected. You have been placed back in the queue.',
            requeued: true
          });
          
          // Add to pending requests
          const customerName = agentData.currentCustomerId;
          pendingAgentRequests.push({
            customerId,
            customerName,
            timestamp: new Date()
          });
          
          // Notify all agents
          io.to('agents').emit('agent_disconnected', {
            agentId: socket.id,
            agentName: agentData.name,
            customerId
          });
        }).catch(err => console.error('Error handling agent disconnect:', err));
      }
      
      // Update agent status in database
      pool.query(
        'UPDATE agent_availability SET status = \'offline\', last_seen = CURRENT_TIMESTAMP WHERE agent_id = $1',
        [socket.id]
      ).catch(err => console.error('Error updating agent status in DB on disconnect:', err));
      
      // Remove from active agents
      activeAgents.delete(socket.id);
      
      // Update agent count
      io.emit('agent_status', { agentCount: activeAgents.size });
    }
    
    // Check if it's a customer
    let customerId = null;
    for (const [id, socketId] of customerSockets.entries()) {
      if (socketId === socket.id) {
        customerId = id;
        break;
      }
    }
    
    if (customerId) {
      const actualCustomerId = extractCustomerId(customerId);
      console.log(`👤 Customer ${customerId} disconnected`);
      
      // Update customer last seen
      pool.query(
        'UPDATE customers SET last_seen = CURRENT_TIMESTAMP WHERE id = $1',
        [actualCustomerId]
      ).catch(err => console.error('Error updating customer last seen:', err));
      
      // Update conversation
      pool.query(
        'UPDATE conversations SET status = \'closed\', end_time = CURRENT_TIMESTAMP WHERE customer_id = $1 AND status = \'active\'',
        [actualCustomerId]
      ).then(() => {
        // Add system message
        return pool.query(
          'SELECT id FROM conversations WHERE customer_id = $1 ORDER BY start_time DESC LIMIT 1',
          [actualCustomerId]
        );
      }).then(result => {
        if (result.rows.length > 0) {
          return pool.query(
            `INSERT INTO messages (id, conversation_id, sender, type, content, language) 
             VALUES ($1, $2, 'System', 'system', 'Customer disconnected', $3)`,
            [uuidv4(), result.rows[0].id, 'english']
          );
        }
      }).then(() => {
        // Find the agent for this customer
        const agentEntry = Array.from(activeAgents.entries()).find(
          ([id, data]) => data.currentCustomerId === customerId
        );
        
        if (agentEntry) {
          const [agentId, agentData] = agentEntry;
          
          // Update agent status to available
          activeAgents.set(agentId, {
            ...agentData,
            status: 'available',
            currentCustomerId: null
          });
          
          // Update agent availability in database
          pool.query(
            `UPDATE agent_availability 
             SET status = 'available', current_conversation_id = NULL, current_conversation_count = current_conversation_count - 1
             WHERE agent_id = $1`,
            [agentId]
          ).catch(err => console.error('Error updating agent availability after customer disconnect:', err));
          
          // Notify agent
          io.to(agentId).emit('customer_disconnected', {
            customerId,
            message: 'Customer has disconnected'
          });
          
          // Check if there are pending customers in queue
          if (pendingAgentRequests.length > 0) {
            const nextRequest = pendingAgentRequests.shift();
            
            // Update queue positions for remaining requests
            pendingAgentRequests.forEach((req, index) => {
              io.to(`room_${req.customerId}`).emit('queue_status', {
                status: 'queued',
                message: 'All agents are currently busy. You\'ll be connected to the next available agent.',
                position: index + 1
              });
            });
            
            // Assign this agent to the next customer
            pool.query(
              'UPDATE conversations SET agent_id = $1, agent_name = $2, status = \'active\' WHERE id = $3',
              [agentId, agentData.name, nextRequest.conversationId]
            ).then(() => {
              // Update agent status
              activeAgents.set(agentId, {
                ...agentData,
                status: 'busy',
                currentCustomerId: nextRequest.customerId
              });
              
              // Update agent availability in database
              pool.query(
                `UPDATE agent_availability 
                 SET status = 'busy', current_conversation_id = $1, current_conversation_count = current_conversation_count + 1
                 WHERE agent_id = $2`,
                [nextRequest.conversationId, agentId]
              ).catch(err => console.error('Error updating agent availability for next customer:', err));
              
              // Notify agent
              io.to(agentId).emit('agent_assignment', {
                customerId: nextRequest.customerId,
                customerName: nextRequest.customerName,
                conversationId: nextRequest.conversationId
              });
              
              // Notify customer
              io.to(`room_${nextRequest.customerId}`).emit('agent_joined', {
                agentName: agentData.name,
                message: `${agentData.name} has joined the chat`
              });
              
              // Notify all agents about the assignment
              io.to('agents').emit('agent_assigned', {
                agentId,
                agentName: agentData.name,
                customerId: nextRequest.customerId,
                customerName: nextRequest.customerName
              });
            }).catch(err => console.error('Error assigning next customer after disconnect:', err));
          }
        }
        
        // Notify all agents
        io.to('agents').emit('customer_disconnected', {
          customerId
        });
      }).catch(err => console.error('Error handling customer disconnect:', err));
      
      // Remove from customer sockets
      customerSockets.delete(customerId);
    }
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
