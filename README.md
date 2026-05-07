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

# Strongly recommended - TTS, chat, prompt generation, OCR all depend on this
OPENAI_API_KEY=sk-...

# Optional - Webex room/message sync
WEBEX_ACCESS_TOKEN=...

# Optional - Speech-to-text (voice input in evaluate page)
DEEPGRAM_API_KEY=...
DEEPGRAM_PROJECT_ID=...

# Optional - Twilio SMS (OTP in banking demo)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX

# Optional - Avatar rendering
ANAM_API_KEY=...
```

> **Minimum to start:** With Docker, only `OPENAI_API_KEY` matters (Postgres is handled automatically). Without `OPENAI_API_KEY` the app boots but TTS, chat, prompt generation, and OCR return 503 errors. All other keys are optional.

Open http://localhost:5000.

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
| `DEEPGRAM_API_KEY` | For voice input | Speech-to-text |
| `DEEPGRAM_PROJECT_ID` | For voice input | Deepgram project |
| `TWILIO_ACCOUNT_SID` | For SMS/Voice | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | For SMS/Voice | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | For SMS/Voice | e.g. `+15551234567` |
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
| `npm run db:push` | Apply schema changes to database |

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
│   └── vite.ts             # Vite middleware setup
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

Good for quick testing. Token expires after 12 hours.

### Option B: Bot Token (never expires, recommended)

1. Go to https://developer.webex.com/my-apps
2. Click **Create a New App** > **Create a Bot**
3. Fill in name, username, icon, description
4. Copy the **Bot Access Token** (shown once — save immediately)
5. Set as `WEBEX_ACCESS_TOKEN`
6. Add the bot to any Webex spaces you want the agent to access

Bot tokens never expire. The bot can only see rooms it has been invited to.

### What It Enables

- Sync all rooms the token has access to
- Pull message history (last 30 days)
- Send messages to rooms via the agent
- Agent can reference Webex conversation context during chat

---

## Twilio Setup (Optional)

### SMS (OTP in Banking Demo)

1. Create an account at https://www.twilio.com/
2. Get a phone number with **SMS** capability
3. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER`

Without Twilio configured, the OTP demo falls back to displaying verification codes in the response.

### Voice (Inbound Calling)

To allow users to call the agent by phone:

1. Upgrade from Twilio trial (trial has voice announcements)
2. Buy a number with **Voice + SMS** capability (~$1.15/month)
3. Configure the number's voice webhook:
   - URL: `https://webex-voice-agent-studio.org/api/twilio/voice`
   - Method: POST
4. For local development, use ngrok:
   ```bash
   ngrok http 5000
   # Then set webhook to: https://your-id.ngrok-free.app/api/twilio/voice
   ```

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
npm run build   # Vite bundles client to dist/public/, esbuild bundles server to dist/index.js
npm run start   # Serves both API and static files on port 5000
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
