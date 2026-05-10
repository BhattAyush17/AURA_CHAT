

# **AURA**

AURA is a proactive, context-aware companion featuring an advanced sensing architecture. By deeply integrating with Gemini Live, it uses acoustic telemetry and relational memory to dynamically adapt its conversational depth and provide a truly intelligent voice experience.

## ✨ Key Features
- **Real-Time Conversational Sensing:** Dynamic adaptation using audio telemetry (RMS, pause durations).
- **Relational Memory:** Persistent accumulation of emotional context across sessions.
- **Stable Gemini Live Integration:** Reliable, high-fidelity real-time voice interactions using `gemini-2.0-flash-live-001`.

## 🚀 Getting Started

**Prerequisites:** 
- Node.js
- Python 3.x (for backend analysis)

**Installation:**
```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
# Add your Gemini API Key in .env.local:
# VITE_GEMINI_API_KEY="your-api-key"

# 3. Run the application
npm run dev
```

## 🧠 Architecture
- **Frontend:** React, TypeScript, Vite, tailwindcss.
- **Backend/Cognitive Engine:** Python, WebSockets, Supabase (for persistent storage and auth).
- **Core AI:** Gemini Realtime API (`gemini-2.0-flash-live-001`).
