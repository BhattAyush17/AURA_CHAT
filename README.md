# **AURA: The Proactive Conversational Voice Companion**

AURA is an advanced voice companion engineered to bridge the gap between sterile AI interfaces and organic human presence. Rather than relying on simple text-in/text-out patterns, AURA is built upon a **parallel multi-brain cognitive architecture** that fuses real-time acoustic telemetry, dynamic emotional routing, and relational memory.

---

## 🎨 AURA vs. Standard Voice Bots: The Human Difference

To see how AURA stands out, contrast how a standard voice assistant and AURA handle the exact same human moment:

### The Scenario
A user comes home after a grueling 14-hour workday, speaking in a quiet, tired voice, pausing frequently.
> **User:** *(softly, pausing for 2 seconds)* "Hey... I'm just really overwhelmed with work today."

| Dimension | Standard Voice Assistant | AURA Voice Companion |
| :--- | :--- | :--- |
| **Vocal Reception** | Ignores volume and pacing; parses only the text transcript. | **Processes raw acoustic telemetry:** Measures the low volume (RMS 0.008) and the heavy 2-second initial pause. |
| **Cognitive Reaction** | Treats it as a standard query; searches for stress relief advice. | **Adapts conversational arc:** Detects a *withdrawing* emotional state and triggers a gentle, supportive prompt style. |
| **Contextual Memory** | Has no recollection of yesterday; starts the relationship from scratch. | **Enriches with relational memory:** Recalls that the user was preparing for a critical project launch this week. |
| **Vocal Delivery** | *Loud, energetic assistant voice:* "I understand you are overwhelmed! Here are 5 ways to manage work stress. First, prioritize your tasks..." | *Soft, quiet, slightly slowed voice:* "Oh... wahi launch na? Close your laptop, take a deep breath. We can catch up on this later, just relax right now, yaar." |

---

## 🧠 Inside AURA's "Five Brains"

AURA's processing power is distributed across five specialized "brains" that operate in parallel to construct a natural, zero-latency response.

```mermaid
graph TD
    UserVoice([User Voice Input]) -->|Raw Telemetry| L2[L2: Sensing Engine]
    UserVoice -->|Audio Stream| L4[L4: Audio Engine]
    
    subgraph "The Cognitive Core"
        L2 -->|Acoustic Vectors| L1[L1: Emotional Router]
        L4 -->|Text Transcript| L1
        L3[(L3: Relational Memory)] <-->|Historical Sync| L1
    end

    subgraph "Speed & Reliability"
        L5[(L5: Redis Stream Bus)] <-->|Parallel Cache Loop| L1
    end

    L1 -->|Vocal/Behavioral Prompts| Gemini[Gemini Live Engine]
```

### 1. L1: Core Emotional Routing Engine (`backend.core.behavior`)
* **What it does:** Decides **how** to speak before deciding **what** to say.
* **How it works:** It acts as the traffic controller. It scans transcripts for psychological triggers (frustration, excitement, hesitation) and matches them to a curated behavior instruction set.
* **The Magic:** Instead of letting the AI hallucinate its tone, L1 injects strict *vocal blueprints* directly into the LLM system prompt on every turn.

### 2. L2: Telemetry & Sensing Module (`backend.core.sensing`)
* **What it does:** Measures the human qualities of the voice—the sighs, the whispers, the speed.
* **How it works:**
```mermaid
flowchart LR
    Mic[Microphone Input] --> RMS[Compute RMS / Volume]
    Mic --> Pause[Calculate Silences in ms]
    RMS & Pause --> StateVector[Update StateVector: Warmth, Tension, Energy]
    StateVector --> Directive[Generate Vocal Pacing Directive]
```
* **The Magic:** If you speak softly, L2 reduces its energy state. If you sound tense, it signals L1 to slow down AURA’s speech pacing and add comforting conversational connectors (e.g., *"well"*, *"actually"*, *"hmm"*).

### 3. L3: PGVector Relational Sync (`backend.memory.sync`)
* **What it does:** Acts as AURA's persistent long-term memory.
* **How it works:** At the end of every session, AURA condenses key milestones into a compressed emotional "seed". When a new session starts, AURA runs a semantic similarity search across previous seeds using Supabase PGVector and ChromaDB.
* **The Magic:** AURA remembers past topics, your preferred language mix, and your level of trust, creating an evolving, continuous relationship rather than a series of disconnected sessions.

### 4. L4: High-Fidelity Audio Engine (`src.providers.sarvam`)
* **What it does:** Converts speech to text and back to audio with extreme clarity.
* **How it works:** Features an optimized REST-based pipeline using Sarvam’s state-of-the-art **`saaras:v3`** model to translate local WebM files. It runs a **barge-in monitoring loop** using the Web Audio API, instantly killing AURA's speech output the millisecond your voice crosses the mic threshold.
* **The Magic:** Seamlessly transcribes and speaks **Hinglish** (a casual code-mixed blend of Hindi and English), keeping the conversation feeling local, warm, and natural.

### 5. L5: Parallel Async Bus (`backend.bus.redis`)
* **What it does:** Handles the raw processing power and guarantees sub-200ms latency.
* **How it works:**
```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant R as Redis Stream (L5)
    participant B as Background Worker (L1/L2)
    participant DB as Supabase (L3)

    U->>F: Speaks sentence
    F->>R: Publish transcript & audio immediately (<1ms)
    par Parallel Processing
        R->>B: Process L2 Sensing & L1 routing
        R->>DB: Fetch L3 Memory embeddings
    end
    B->>R: Cache compiled prompts
    F->>R: Read cached prompts on turn end
    R->>F: Stream ultra-fast response
```
* **The Magic:** Traditional systems run sequentially (Listen ➡️ Transcribe ➡️ Database Fetch ➡️ Prompt Build ➡️ LLM Generation). AURA uses a **Redis Stream Bus** to run database fetches, sensing calculations, and prompt caching *in parallel* while the user is still speaking.

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** (v18+)
- **Python 3.12+** (compiled with development headers)
- **System Compilers:** `gcc`, `gcc-c++`, `make` (required to compile high-speed native Redis and database extensions)

### Fedora / RHEL Dependencies Setup
```bash
sudo dnf install gcc gcc-c++ make python3-devel
```

### Installation
```bash
# 1. Frontend Web App Setup
npm install

# 2. Backend virtual environment & python packages compilation
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Execution Vectors
* **Full-Flow CLI Pipeline Test:**
  ```bash
  venv/bin/python test_demo_flow.py
  ```
* **Start Backend API Server:**
  ```bash
  venv/bin/uvicorn backend.api.main:app --reload --port 8000
  ```
* **Start Vite Frontend App:**
  ```bash
  npm run dev
  ```

---

## ⚠️ Current Instabilities & Limitations

* **Fallback Database Latency (Redis/Supabase Circuit Breaker):** Under heavy offline failover conditions, database fallbacks use a circuit-breaker mode, which can slightly delay first-turn state vector injection.
* **Low-Bandwidth Microphones (8kHz):** Low-sample-rate audio streams require manual adjustment of front-end WebAudio nodes to avoid degraded telemetry extraction.
* **Browser Sandbox Limitations:** Advanced barge-in audio interruption is fully optimized primarily on Chromium-based browser environments.
