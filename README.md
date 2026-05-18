# Webex Voice Agent Studio

A low-code platform for building, configuring, and evaluating AI-powered voice agents with Webex ecosystem integration. Create conversational agents with natural voice capabilities, connect them to enterprise tools, and test them in real time.

**Live:** https://webex-voice-agent-studio.org/

---

## Quick Start

```bash
cp .env.example .env
# Edit .env — add your OPENAI_API_KEY (optional keys can stay blank)
docker compose up
```

Open http://localhost:3000. That's it — Postgres, schema, and the app all start automatically.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Features](#features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Replit Setup](#replit-setup)
- [Development](#development)
- [Agent Templates](#agent-templates)
- [Webex Integration](#webex-integration)
- [Twilio Setup](#twilio-setup-optional)
- [API Reference](#api-reference)
- [Deployment](#deployment)
- [Contributing](#contributing)

---

## Features

- **Agent Builder** - Create voice agents from scratch or choose from turnkey templates (Banking, IT Support, Personal OS, and more)
- **AI Prompt Generation** - Generate and refine agent personalities using AI
- **Real-Time Voice Calls** - Live voice conversations using OpenAI Realtime API with barge-in and VAD
- **Voice Synthesis** - Preview agents with 6 distinct voices via OpenAI TTS
- **Speech-to-Text** - Talk to your agent using Deepgram real-time transcription
- **Knowledge Base** - Add URLs, upload PDFs, or write custom text to ground agent responses
- **Chat with Function Calling** - Agents can execute actions (send messages, look up data, verify identity)
- **Webex Integration** - Sync rooms, read messages, and send replies through your agent
- **Voice Quality Evaluation** - Rate naturalness, clarity, intonation, and speed
- **Avatar Preview** - Optional AI avatar rendering via Anam.ai
- **Integration Marketplace** - Browse 25+ enterprise integrations (Twilio, Salesforce, ServiceNow, Slack, and more)

---

## Architecture

```mermaid
graph TD
    subgraph Client["Client (React 19 + Vite)"]
        Pages["Pages: Home | Build | Evaluate"]
        UI["UI: shadcn/ui + Radix + Tailwind CSS v4"]
        Routing["Routing: Wouter | State: TanStack Query"]
        Voice["Voice: Deepgram STT + OpenAI TTS"]
    end

    subgraph Server["Server (Express.js + TypeScript)"]
        ORM["ORM: Drizzle | Validation: Zod"]
        APIs["External APIs: OpenAI, Deepgram, Webex, Twilio, Anam"]
    end

    subgraph DB["PostgreSQL (Local Docker or Neon)"]
        Tables["Tables: agents, evaluations, webex_rooms, webex_messages, knowledge_base_items"]
    end

    Client -->|"HTTP/JSON"| Server
    Server --> DB
```

---

## Getting Started

### Prerequisites

- **Docker** (only requirement for local development)

Or, if running without Docker:
- Node.js 20+
- PostgreSQL 16 (or a [Neon](https://neon.tech/) account)

### Option A: Docker (recommended — one command)

```bash
git clone <repo-url>
cd Webex-Voice-Agent-Studio
cp .env.example .env
# Edit .env — add your OPENAI_API_KEY
docker compose up
```

This starts PostgreSQL + the app together. Schema is auto-created on first boot.  
Open http://localhost:3000.

- **Hot reload:** Edit files in `client/`, `server/`, or `shared/` — changes reflect immediately.
- **Stop:** `Ctrl+C` or `docker compose down`
- **Reset database:** `docker compose down -v`
- **Rebuild after package.json changes:** `docker compose up --build`
- **Custom port:** Set `APP_PORT=8080` in `.env` to change from default 3000

### Option B: Without Docker (Node.js + external Postgres)

```bash
git clone <repo-url>
cd Webex-Voice-Agent-Studio
npm install
cp .env.example .env
# Edit .env — set DATABASE_URL to your Postgres (local or Neon)
npm run db:push
npm run dev
```

Open http://localhost:5000.

The app auto-detects which Postgres driver to use based on `DATABASE_URL`:
- URLs containing `neon.tech` or `neon-` → Neon serverless driver (WebSocket)
- Everything else → standard `pg` driver (TCP)

### Environment Variables

```env
# Database (auto-provided by Docker Compose, or set manually)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/voice_agent_studio

# Provider selection (defaults to openai for both)
CHAT_PROVIDER=openai        # openai | groq
CHAT_MODEL=                 # auto-selected per provider if blank
TTS_PROVIDER=openai         # openai | deepgram

# API keys (provide keys for your selected providers)
OPENAI_API_KEY=sk-...       # chat (default), TTS (default), OCR, transcription
GROQ_API_KEY=gsk_...        # only if CHAT_PROVIDER=groq
DEEPGRAM_API_KEY=...        # STT (voice input), and TTS if TTS_PROVIDER=deepgram
DEEPGRAM_PROJECT_ID=...

# Optional integrations
WEBEX_ACCESS_TOKEN=...
WEBEX_SPACE_ID=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
APP_BASE_URL=...           # public URL for Twilio webhooks (voice/SMS)
ANAM_API_KEY=...
```

> **Minimum to start:** With Docker, you only need one chat provider key (`OPENAI_API_KEY` or `GROQ_API_KEY`). Postgres is handled automatically. If using Groq for chat, note that tool calling (banking demo, Webex actions) is not supported — those features require OpenAI.

Open http://localhost:3000.

---

## Replit Setup

The app is hosted on Replit. Follow these steps to set up your own instance.

### 1. Create Account & Import

1. Go to https://replit.com/ and sign up (GitHub login works)
2. Choose **Hacker** or **Pro** plan for custom domains and always-on deployments
3. Click **+ Create Repl** > **Import from GitHub**
4. Paste the GitHub repository URL
5. Click **Import from GitHub**

Replit auto-detects the `.replit` config file and configures run/build commands.

### 2. Configure Secrets (Environment Variables)

Replit stores env vars as **Secrets** (encrypted, not in source control):

1. Click the **Secrets** tab (lock icon in left sidebar)
2. Add each key-value pair:

| Key | Required | Purpose |
|-----|----------|---------|
| `DATABASE_URL` | **Yes** | Neon PostgreSQL connection string |
| `OPENAI_API_KEY` | Strongly recommended | TTS, chat, prompt generation |
| `WEBEX_ACCESS_TOKEN` | For Webex features | Bot or personal access token |
| `WEBEX_SPACE_ID` | For Webex messages | Default space used when no UI override is saved |
| `DEEPGRAM_API_KEY` | For voice input | Speech-to-text |
| `DEEPGRAM_PROJECT_ID` | For voice input | Deepgram project |
| `TWILIO_ACCOUNT_SID` | For SMS/Voice | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | For SMS/Voice | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | For SMS/Voice | e.g. `+15551234567` |
| `APP_BASE_URL` | For SMS/Voice | Public URL for Twilio webhooks |
| `TWILIO_PRECONNECT_GREETING` | Optional | Pre-stream Twilio greeting text. Requires `TWILIO_PRECONNECT_GREETING_ENABLED=true`; disabled by default to avoid mixing Twilio TTS with the Realtime agent voice |
| `TWILIO_VOICE_GREETING` | Optional | Custom voice greeting message |
| `TWILIO_VOICE_FAREWELL` | Optional | Custom post-recording farewell |
| `ANAM_API_KEY` | For avatar | Anam.ai streaming |

### 3. Initialize Database

In the Replit **Shell** tab:
```bash
npm run db:push
```

### 4. Run

Click the green **Run** button. The app builds and starts at your Repl's public URL.

### 5. Deploy (Always-On)

1. Click **Deploy** (top right)
2. Deployment type: **Autoscale**
3. Build command: `npm run build`
4. Start command: `npm run start`
5. Click **Deploy**

After deployment, pushing to `main` on GitHub auto-redeploys.

### 6. Custom Domain (Optional)

1. **Settings** > **Domains** > Add your domain
2. At your DNS registrar, add a CNAME record pointing to your `.replit.app` URL
3. Replit provisions SSL automatically

### 7. Updating Secrets After Deployment

1. Update the value in the **Secrets** tab
2. Go to **Deployments** tab > **Restart** to pick up new values

---

## Development

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server (auto-restarts on changes) |
| `npm run dev:client` | Start Vite dev server with HMR (for frontend-focused work) |
| `npm run build` | Production build (client + server) |
| `npm run start` | Run production build |
| `npm run check` | TypeScript type checking |
| `npm run db:push` | Apply schema changes with a one-off Drizzle Kit CLI |

### Project Structure

```
.
├── client/                 # React 19 frontend (Vite)
│   └── src/
│       ├── pages/          # Home, Build, Evaluate
│       ├── components/     # shadcn/ui components
│       ├── hooks/          # Custom React hooks
│       └── lib/            # API client, utilities
├── server/                 # Express.js backend
│   ├── index.ts            # Server entry point
│   ├── routes.ts           # All API endpoints
│   ├── storage.ts          # Database access layer
│   ├── vite.ts             # Vite middleware setup
│   └── voice-agent/        # Real-time voice (OpenAI Realtime API)
│       ├── index.ts        # WebSocket server + session handlers
│       └── openai-realtime.ts  # OpenAI Realtime API client
├── shared/                 # Shared code (frontend + backend)
│   └── schema.ts           # Drizzle ORM schema + Zod validation
├── migrations/             # Auto-generated database migrations
├── package.json
├── vite.config.ts
├── drizzle.config.ts
└── tsconfig.json
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite |
| UI | shadcn/ui, Radix UI, Tailwind CSS v4 |
| Routing | Wouter |
| Server State | TanStack Query |
| Backend | Express.js, TypeScript |
| ORM | Drizzle |
| Validation | Zod |
| Database | PostgreSQL (local Docker or Neon serverless) |
| Voice (STT) | Deepgram |
| Voice (TTS) | OpenAI |
| Voice (Realtime) | OpenAI Realtime API (gpt-4o-realtime-preview) |
| LLM | OpenAI GPT-4o |

---

## Agent Templates

The builder includes pre-configured templates:

| Template | Description |
|----------|-------------|
| Technical Advisor | Explains complex concepts in simple terms |
| Customer Support | Handles inquiries with empathy and efficiency |
| ServiceNow Agent | IT service management and ticket automation |
| PagerDuty Agent | Incident management for DevOps on-call teams |
| Personal OS | Multi-app assistant across 500+ connected services |
| Prep Me for the Day | Summarizes Webex messages into priorities and action items |
| Banking Agent | Voice-enabled banking with OTP auth and check deposit OCR |

---

## Webex Integration

The app uses a static bearer token for Webex API access. No OAuth flow — configure the token as an environment variable.

### Option A: Personal Access Token (expires in 12 hours)

1. Go to https://developer.webex.com/docs/getting-started
2. Log in with your Webex account
3. Copy the displayed personal access token
4. Set as `WEBEX_ACCESS_TOKEN`
5. Optionally set `WEBEX_SPACE_ID` as the default outbound message space

Good for quick testing. Token expires after 12 hours.

### Option B: Bot Token (never expires, recommended)

1. Go to https://developer.webex.com/my-apps
2. Click **Create a New App** > **Create a Bot**
3. Fill in name, username, icon, description
4. Copy the **Bot Access Token** (shown once — save immediately)
5. Set as `WEBEX_ACCESS_TOKEN`
6. Set `WEBEX_SPACE_ID` to the default store-manager space if you want post-call messages to work without configuring the UI profile
7. Add the bot to any Webex spaces you want the agent to access

Bot tokens never expire. The bot can only see rooms it has been invited to.

### What It Enables

- Sync all rooms the token has access to
- Pull message history (last 30 days)
- Send messages to rooms via the agent
- Agent can reference Webex conversation context during chat

---

## Twilio Setup (Optional)

### 1. Get Credentials

1. Create an account at https://www.twilio.com/
2. Buy a phone number with **Voice + SMS** capability (~$1.15/month)
3. Set environment variables:

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+15551234567
APP_BASE_URL=https://your-app-url.com
```

### 2. Configure Webhooks in Twilio Console

In the [Twilio Console](https://console.twilio.com/) → Phone Numbers → your number:

| Channel | Webhook URL | Method |
|---------|-------------|--------|
| **Voice** (A call comes in) | `{APP_BASE_URL}/api/twilio/voice` | POST |
| **SMS** (A message comes in) | `{APP_BASE_URL}/api/twilio/sms` | POST |

Replace `{APP_BASE_URL}` with your actual value:
- **Replit:** `https://your-app.replit.app` or your custom domain
- **Local development:** Use ngrok to expose your local server:
  ```bash
  ngrok http 5000
  # Use the https URL ngrok gives you as APP_BASE_URL
  ```

### 3. What Each Webhook Does

- **`/api/twilio/voice`** — Handles inbound phone calls. Greets the caller and records a message. Can be customized to route to an AI agent for real-time voice conversation.
- **`/api/twilio/sms`** — Handles inbound SMS. Passes the message to the configured AI chat provider and replies with the AI response.
- **Outbound SMS** — Used by the banking demo for OTP verification. Falls back to displaying codes in the response if Twilio is not configured.

### 4. Real-Time Voice Stream (Twilio Call-In)

For real-time AI voice conversations over phone (instead of the record-and-respond flow), configure:

| Channel | Webhook URL | Method |
|---------|-------------|--------|
| **Voice** (A call comes in) | `{APP_BASE_URL}/api/twilio/voice-stream` | POST |

This returns TwiML with `<Connect><Stream>` to pipe live audio into the OpenAI Realtime API. The agent uses its configured system prompt and voice. Requires `OPENAI_API_KEY`.

### 5. Status Check

`GET /api/twilio/status` returns whether Twilio is configured and the active webhook URLs.

---

## Real-Time Voice Agent

The app includes a browser-based real-time voice agent powered by the **OpenAI Realtime API**. When you click "Chat" on any agent, a voice call panel appears where you can have a live conversation with the agent.

### How It Works

1. **Browser captures microphone** at 24kHz, encodes PCM16, sends binary frames over WebSocket
2. **Server relays audio** to OpenAI Realtime API (`wss://api.openai.com/v1/realtime`)
3. **OpenAI handles STT + LLM + TTS** in a single connection with built-in VAD and barge-in
4. **Audio streams back** through the WebSocket as PCM16 binary, played via Web Audio API

### Features

- **Voice Activity Detection (VAD):** Automatic speech detection — no push-to-talk needed
- **Barge-in:** Interrupt the agent mid-sentence by speaking
- **Real-time transcription:** See both user and agent text as the conversation happens
- **Agent personality:** Uses the agent's configured system prompt and voice
- **Low latency:** Single WebSocket connection, no intermediate processing steps

### WebSocket Endpoints

| Path | Purpose |
|------|---------|
| `ws://host/ws/voice-agent` | Browser real-time voice (PCM16, 24kHz) |
| `ws://host/ws/twilio-stream` | Twilio Media Streams (G.711 u-law, 8kHz) |

### Requirements

- `OPENAI_API_KEY` with access to `gpt-4o-realtime-preview` model
- Browser with microphone access (HTTPS required in production)

---

## API Reference

### Agents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/agents` | List all agents |
| `GET` | `/api/agents/:id` | Get agent by ID |
| `POST` | `/api/agents` | Create agent |
| `PUT` | `/api/agents/:id` | Update agent |
| `DELETE` | `/api/agents/:id` | Delete agent (cascades to evaluations and knowledge base) |
| `POST` | `/api/agents/generate-prompt` | AI-generate a system prompt |
| `POST` | `/api/agents/refine-prompt` | Refine an existing prompt |

### Voice & Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/tts` | Generate speech from text |
| `POST` | `/api/chat` | Chat with agent (supports function calling) |
| `POST` | `/api/transcribe` | Speech-to-text via Deepgram |

### Knowledge Base

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/knowledge-base/agent/:agentId` | List sources for agent |
| `POST` | `/api/knowledge-base/url` | Add URL source |
| `POST` | `/api/knowledge-base/file` | Upload file (PDF, text) |
| `POST` | `/api/knowledge-base/text` | Add text source |
| `PUT` | `/api/knowledge-base/:id` | Update source |
| `DELETE` | `/api/knowledge-base/:id` | Delete source |

### Evaluations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/evaluations` | Save voice quality rating |
| `GET` | `/api/evaluations/agent/:agentId` | Get ratings for agent |

### Real-Time Voice

| Method | Endpoint | Description |
|--------|----------|-------------|
| `WS` | `/ws/voice-agent` | Browser real-time voice (PCM16 binary + JSON events) |
| `WS` | `/ws/twilio-stream` | Twilio Media Streams relay to OpenAI Realtime |

### Twilio (Voice & SMS)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/twilio/voice` | Inbound voice webhook (Twilio calls this) |
| `POST` | `/api/twilio/voice-stream` | Real-time voice via Twilio `<Connect><Stream>` |
| `POST` | `/api/twilio/voice/recording` | Recording callback |
| `POST` | `/api/twilio/voice/transcription` | Transcription callback |
| `POST` | `/api/twilio/sms` | Inbound SMS webhook (Twilio calls this) |
| `GET` | `/api/twilio/status` | Check Twilio config and webhook URLs |

### Webex

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/webex/rooms` | List synced Webex rooms |
| `GET` | `/api/webex/messages` | Get recent messages |
| `POST` | `/api/webex/sync` | Sync rooms and messages (last 30 days) |
| `POST` | `/api/webex/messages` | Send a message to a room |
| `GET` | `/api/webex/stats` | Get message/room counts |

---

## Deployment

| Aspect | Details |
|--------|---------|
| Platform | Replit (autoscale) |
| Domain | https://webex-voice-agent-studio.org/ |
| Database | PostgreSQL on Neon (serverless) |
| Node.js | v20 |
| Port | 5000 |
| Deploy trigger | Push to `main` branch |

### Publish Updates

```bash
git add <files>
git commit -m "Description"
git push origin main
# Auto-deploys to Replit within ~2 minutes
```

### Production Build (Local)

```bash
npm run build   # Vite bundles client to dist/public/, esbuild bundles server to dist/index.js and creates dist/index.cjs
npm run start   # Runs the production CJS launcher and serves API/static files on port 5000
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## License

MIT
