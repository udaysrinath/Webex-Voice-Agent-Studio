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
- **Real-Time Voice Calls** - Live voice conversations using OpenAI GPT-Live or the Realtime API with barge-in and VAD
- **Voice Synthesis** - Preview agents with 6 distinct voices via OpenAI TTS
- **Speech-to-Text** - Talk to your agent using Deepgram real-time transcription
- **Knowledge Base** - Add URLs, upload PDFs, or write custom text to ground agent responses
- **WebexOne Guide search** - Shared hybrid BM25 and semantic retrieval for all three avatar speech modes
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

### Updating the WebexOne Guide reference

The Guide answers from one consolidated knowledge base in `server/data/webexone/kb/` (`cards.json` and `vectors.json`, loaded by `server/webexone-kb.ts`). It is generated from every source by:

```bash
npm run kb:build   # needs OPENAI_API_KEY; reuses cached LLM/embedding results for unchanged text
npm run kb:eval    # retrieval quality against server/data/webexone/kb/golden.json (and heldout.json)
```

Restart the app afterwards. Both generated files must be deployed with the code. At call time the retriever combines BM25, semantic similarity over each card's spoken-question aliases and content, exact name/code matches, and day/room facets. If query embedding fails it falls back to BM25.

### How the sources are combined

The event data is frozen, so nothing here is "kept fresh". Instead, each kind of fact has one authority and the other sources only enrich it:

| Facts | Authority | Source files | Treatment |
|-------|-----------|--------------|-----------|
| Sessions, times, rooms, speakers, topics, capacity | Socio event platform (`raw/socio.json`) | one export via `npm run kb:socio` | Structured cards, no LLM: one card per session (all deliveries together), speaker and room. Enriched with training session codes/levels/lengths and speaker categories from OneDrive. |
| Meals, registration, activations, logistics | Socio activities + curated OneDrive documents | `onedrive/event-info-activations.md`, `things-to-do-each-day.md` | Overlapping passages are consolidated, then merged into one authoritative card per topic. |
| FAQs, venue, training page, awards, sponsors, products, devices, launches | OneDrive documents (Oct 1) | `server/data/webexone/onedrive/*.md` (converted from the Word files with `scripts/docx_to_md.py`) | Kept verbatim where they are already agent-ready. |
| Older website text | webexone.com crawl | `www.webexone.com_*.md` | Lowest precedence. Duplicates of OneDrive text are dropped; stale or conflicting text loses. |

The build (`scripts/build-webexone-kb.ts`) does, in order: structured cards; prose units; embedding-based clustering of overlapping units with an LLM merge (every merge is fact-checked, so no time, room, price, phone number or URL is silently dropped); a topic stage that writes one card per narrow logistics topic; spoken-question aliases; embeddings; and a coverage audit that compares the facts in every source file with the facts in the final cards. `kb/REPORT.md` lists every conflict between sources, what was kept, and any audit gaps. Agent-instruction sections inside the documents ("how the concierge should use this guide") are set aside in `kb/guidance.json`, not indexed as facts.

Live check-in and attendance numbers still come from the Socio API at call time (`get_webexone_live_stats`).

Set the Socio credentials in `.env` (never commit the key):

```bash
SOCIO_API_KEY=sk_live_...   # server-side only, never sent to the browser
SOCIO_EVENT_ID=60274        # WebexOne 2026
# Optional: SOCIO_EVENT_TIMEZONE=America/Chicago  (display timezone, default shown)
```

**Tools.** `server/webexone-tools.ts` is the single registry of WebexOne tools (`search_webexone_reference`, `get_webexone_live_stats`) and the shared prompt guidance. All three avatar flows use it:

| Flow | How tools are called |
|------|----------------------|
| ANAM native | Anam transcribes, the app sends each turn to `/api/chat`, which runs a tool-calling loop over the registry |
| ANAM + Deepgram | Deepgram transcribes, then the same `/api/chat` loop |
| ANAM + GPT-Live | GPT-Live client delegation (see below): the browser answers each delegation from the knowledge base and hands GPT-Live the facts |

**ANAM + GPT-Live (client delegation).** The WebexOne session is created with `delegation: { type: "client" }`, so the app, not a second Responses model, is the backend. GPT-Live decides to delegate any WebexOne question (and acknowledges almost at once), emits `session.delegation.created`, and the browser:

1. reads the caller's last utterance from the `session.input_transcript.delta` fragments, using their timeline positions (`shared/live-transcript.ts`),
2. calls `POST /api/webexone/live-answer`, which retrieves from the knowledge base for every plausible reading of that transcript (each clause and the last few words, embedded in one batched call), plus live attendance numbers when asked,
3. sends GPT-Live the best reading's facts in `session.commentary.append` and the facts for the other readings as quiet `session.thinking.append` context, and GPT-Live composes the spoken answer from what it actually heard.

The transcript is GPT-Live's text guess at the audio and is much weaker than the model's own hearing: in a noisy room background words leak into it, and "when is WebexOne" once came back as a person's name. A single search on the transcript therefore lost accuracy in noise (6/11 against 9/11 for the old design on the same babble audio). Searching every reading, and letting the voice model choose among the facts, restored it (8/11, and every failure was GPT-Live not delegating). When the lookup looks unreliable (weak match, a name-like match, or the embedding timed out) a short core reference (dates, venue, meals, registration, Wi-Fi, keynotes) is added and GPT-Live is told to ask the caller to repeat if unsure. One append is capped at about 500 tokens, so the answer message is kept near 1450 characters and the browser resends a shorter one if GPT-Live still rejects it.

**Buzzing on the Webex device.** The avatar's audio passes through `client/src/lib/avatar-audio-lab.ts`. Saved recordings from the `?debug=1` panel showed clean audio on both sides (no clipping, dropouts or hum), but the avatar's output carried a click train: the 9 to 20 kHz band, which our 16 kHz input cannot contain, was modulated at 51.7, 100, 149, 202 and 248 Hz, a harmonic series matching the 20 ms audio chunks. ANAM appears to add a transient at every chunk boundary, and sending 200 ms chunks reduced the buzz a lot on the device, so that is now the default. Remaining switches (URL parameters or panel buttons): `gain`, `chunk`, `prebuffer`, `idleend`, `interrupt=off`, and `rate` (ANAM's engine runs at 24 kHz, so `rate=24000` avoids a resample). Check a recording with `python3 scripts/analyze-avatar-wav.py <file.wav>`.

Small talk and background conversation are not delegated (see the delegation policy in `server/webexone-live.ts`). The headless benchmark `node --env-file=.env --import tsx scripts/live-bench.mts <responses|app> [repeats]` to time it: it speaks synthesized questions into a GPT-Live session in real time and reports, from the end of the caller's speech, when delegation started, when the backend result arrived and when the first useful audio came back, plus whether the spoken answer contained the expected facts. Add `BENCH_BABBLE=1` to mix background talk into the questions (about 5 dB below the speech). Measured on this repo's knowledge base with clean audio: Responses delegation about 2.8 s, client delegation with facts handed to GPT-Live about 1.3 s. Real-device testing found failures the benchmark missed, so every field failure goes into `server/data/webexone/kb/regression.json` (run by `npm run kb:eval`) before it is fixed.

The browser and the chat loop both execute tools through the server (`POST /api/webexone/tools/:name`, or `executeWebexOneTool` in the chat loop), so validation and secrets stay server-side. To add a tool, add one entry to the registry and one line to the guidance text. WebexOne agents only get these tools; the retail, HR, banking and messaging tools are not offered to them.

`get_webexone_live_stats` returns aggregate numbers only: event-wide check-ins and, per session, room or speaker, registered, checked in now, capacity and seats left, cached for 15 seconds. Attendee records and custom-field answers (names, emails) are never queried, and `tests/server/socio/socio.test.ts` asserts this. With Groq as the chat provider (no tool calling), attendance questions fall back to a keyword-triggered lookup.

Tests: `node --import tsx tests/server/socio/socio.test.ts` and `node --import tsx tests/server/webexone-tools.test.ts`; retrieval quality: `npm run kb:eval`.

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
SMS_PROVIDER=...           # twilio or webex_connect for outbound SMS confirmations
WEBEX_CONNECT_SMS_KEY=...
WEBEX_CONNECT_SMS_FROM=...
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
| `OPENAI_LIVE_BACKEND_MODEL` | Optional | Responses backend for the GPT-Live HR browser agent; defaults to `gpt-5.6-luna` |
| `SOCIO_API_KEY` | For WebexOne live data | Socio event API key (KB sync and live check-in numbers) |
| `SOCIO_EVENT_ID` | For WebexOne live data | Socio event ID for WebexOne 2026 (`60274`) |
| `WEBEX_ACCESS_TOKEN` | For Webex features | Server-owned bot or personal access token |
| `WEBEX_SPACE_ID` | Webex room for demo | Configured manager room used for store-manager summaries |
| `DEEPGRAM_API_KEY` | For voice input | Speech-to-text |
| `DEEPGRAM_PROJECT_ID` | For voice input | Deepgram project |
| `TWILIO_ACCOUNT_SID` | For Voice | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | For Voice | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | For Voice | e.g. `+15551234567` |
| `APP_BASE_URL` | For Voice | Public URL for Twilio webhooks |
| `DEMO_SMS_RECIPIENT_PHONE` | Optional | E.164 number used for demo SMS from both browser and phone-call flows; when set, phone calls send demo SMS here instead of the inbound caller ID |
| `DEMO_CUSTOMER_NAME` | Optional | Returning-customer demo name used by browser and phone-call retail flows; defaults to `Mayada Abdelrahman` |
| `DEMO_CUSTOMER_PHONE` | Optional | Returning-customer demo phone used by browser flow and SMS fallback; defaults to `+16505550142` |
| `DEMO_CONFIRMATION_CHANNEL` | Optional | `sms` or `email`; defaults to SMS. Spoken demo wording follows the selected channel |
| `SMS_PROVIDER` | Optional | `twilio` or `webex_connect`; defaults to Twilio when Twilio SMS credentials are configured |
| `WEBEX_CONNECT_SMS_KEY` | For Webex Connect SMS | API key used as the Webex Connect `key` header |
| `WEBEX_CONNECT_SMS_FROM` | For Webex Connect SMS | Long code sender, for example `16693323901` |
| `WEBEX_CONNECT_SMS_API_URL` | Optional | Defaults to `https://api.us.webexconnect.io/v2/messages` |
| `WEBEX_CONNECT_SMS_NOTIFY_URL` | Optional | Webex Connect delivery callback URL |
| `WEBEX_CONNECT_SMS_CALLBACK_DATA` | Optional | Callback metadata included in Webex Connect requests |
| `CUSTOMER_CONFIRMATION_EMAIL` | For email confirmations | Optional default customer email used when `DEMO_CONFIRMATION_CHANNEL=email`; `/demo-setup` can set this at runtime |
| `DEMO_CONFIRMATION_EMAIL_WEBHOOK_URL` | For email confirmations | HTTPS endpoint that accepts the reservation email payload |
| `DEMO_CONFIRMATION_EMAIL_FROM` | Optional email sender | Included in the email webhook payload when set |
| `DEMO_CONFIRMATION_EMAIL_TIMEOUT_MS` | Optional | Defaults to `8000`; caps email webhook latency |
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
| Voice (Live) | OpenAI GPT-Live 1 with Responses delegation for the HR browser agent; Realtime API for retail and phone agents |
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
5. Set `WEBEX_SPACE_ID` to the manager-facing Webex space

Good for quick testing. Token expires after 12 hours.

### Option B: Bot Token (never expires, recommended)

1. Go to https://developer.webex.com/my-apps
2. Click **Create a New App** > **Create a Bot**
3. Fill in name, username, icon, description
4. Copy the **Bot Access Token** (shown once — save immediately)
5. Set as `WEBEX_ACCESS_TOKEN`
6. Set `WEBEX_SPACE_ID` to the manager-facing Webex space
7. Add the bot to any existing Webex spaces you want the agent to access

Bot tokens never expire. The bot can only see rooms it has been invited to.

### Demo Customer Setup

For demo testers, do not distribute Webex access tokens. Configure `WEBEX_ACCESS_TOKEN` and `WEBEX_SPACE_ID` once on the server for the predefined manager room.

The setup page configures only the customer email used when email confirmation delivery is selected. It does not create Webex rooms, add users to Webex rooms, or change the configured manager space. The spoken demo wording defaults to SMS.

Post-call store-manager summaries use `WEBEX_SPACE_ID`. Customer reservation confirmations are sent through the selected customer channel: SMS by default, or email.

### Reservation Confirmation Delivery

Customer-facing reservation confirmations are separate from the manager-facing Webex summary:

- Spoken confirmation wording says text message by default. It says email when `DEMO_CONFIRMATION_CHANNEL=email`.
- Actual SMS sends only when `DEMO_CONFIRMATION_CHANNEL=sms` and a supported SMS provider is configured. Browser calls send to `DEMO_SMS_RECIPIENT_PHONE` when set, otherwise `DEMO_CUSTOMER_PHONE` or the default demo customer phone. Phone calls send to `DEMO_SMS_RECIPIENT_PHONE` when set, otherwise the inbound caller ID. Twilio SMS uses `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_PHONE_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`; Webex Connect SMS uses `SMS_PROVIDER=webex_connect`, `WEBEX_CONNECT_SMS_KEY`, and `WEBEX_CONNECT_SMS_FROM`.
- Actual email sends only when `DEMO_CONFIRMATION_CHANNEL=email`, `CUSTOMER_CONFIRMATION_EMAIL` is set or configured from `/demo-setup`, and `DEMO_CONFIRMATION_EMAIL_WEBHOOK_URL` is set.

If the selected channel is not enabled or configured, the post-call job records a failed delivery instead of rerouting it to Webex or marking it as delivered.

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

The app includes browser-based voice agents powered by OpenAI. The HR feedback profile uses **GPT-Live 1** with a delegated Responses backend. Retail browser calls and phone calls remain on the **OpenAI Realtime API**, preserving their established turn-taking and telephony behavior.

GPT-Live requires a continuous 24 kHz PCM stream, so the HR path relies on browser echo cancellation/noise suppression plus GPT-Live's own speech understanding instead of the app's local energy gate. It greets as soon as the voice session is ready, then listens for the caller.

### How It Works

1. **Browser captures microphone** at 24kHz, encodes PCM16, sends binary frames over WebSocket
2. **Server relays audio** to GPT-Live (`wss://api.openai.com/v1/live/sessions`) for HR or the Realtime API for other profiles
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

### Realtime Voice Flow And Code Map

The diagram below describes the retained retail and phone Realtime path. The HR browser profile instead uses [`OpenAILiveClient`](server/voice-agent/openai-live.ts), which delegates reasoning and tools to the Responses API. Its deterministic application guardrails still run in the browser session handler before any HR tool result is accepted.

Browser and phone calls intentionally share the retail behavior, tool definitions, Realtime client, and post-call confirmation semantics. The remaining browser-specific and Twilio-specific functions are transport adapters: they translate different audio formats, websocket payloads, UI/monitor events, and call shutdown mechanics into the same OpenAI Realtime flow.

```mermaid
flowchart TD
  BrowserClient[Browser voice panel<br/>PCM16 24kHz websocket] --> BrowserSession[handleBrowserSession]
  TwilioCall[Twilio Media Stream<br/>G.711 u-law 8kHz websocket] --> TwilioSession[handleTwilioSession]

  BrowserSession --> SharedInstructions[prompt.ts<br/>buildRealtimeCallInstructions]
  TwilioSession --> SharedInstructions

  BrowserSession --> SharedTools[Shared tool list<br/>retail + Webex + Twilio SMS summary + voice_end_call]
  TwilioSession --> SharedTools

  SharedInstructions --> RealtimeClient[OpenAIRealtimeClient]
  SharedTools --> RealtimeClient
  BrowserSession --> RealtimeClient
  TwilioSession --> RealtimeClient

  RealtimeClient --> RealtimeAPI[OpenAI Realtime API<br/>STT + model + TTS + function calls]
  RealtimeAPI --> FunctionCall[response.function_call_arguments.done]

  FunctionCall --> ToolRouter[executeTool]
  ToolRouter --> RetailTools[retail tools]
  ToolRouter --> WebexTools[Webex summary tools]
  ToolRouter --> TwilioTools[Twilio SMS tools]
  ToolRouter --> EndCall[voice_end_call runtime guard]

  RetailTools --> FunctionOutput[sendFunctionOutput]
  WebexTools --> FunctionOutput
  TwilioTools --> FunctionOutput
  EndCall --> GracefulClose[final check-in / closing / hangup]

  FunctionOutput --> RealtimeClient
  RealtimeClient --> BrowserAudio[Browser PCM16 playback + UI events]
  RealtimeClient --> TwilioAudio[Twilio media frames + marks]

  GracefulClose --> BrowserPostCall[Browser post-call confirmation + Webex manager summary]
  GracefulClose --> TwilioPostCall[Twilio post-call confirmation + Webex manager summary + REST hangup]
```

| Area | Browser code | Twilio/phone code | Shared code |
|------|--------------|-------------------|-------------|
| Session entry | [`handleBrowserSession`](server/voice-agent/index.ts#L2504) | [`handleTwilioSession`](server/voice-agent/index.ts#L1116) | Both instantiate [`OpenAIRealtimeClient`](server/voice-agent/openai-realtime.ts#L40) |
| Behavior prompt | Calls [`buildRealtimeCallInstructions`](server/voice-agent/prompt.ts#L32) through the browser session | Calls [`buildRealtimeCallInstructions`](server/voice-agent/prompt.ts#L32) through the phone session | [`prompt.ts`](server/voice-agent/prompt.ts#L1) is the source of truth for greeting, product flow, add-on flow, final check-in, closing, transcription prompts, and SMS-summary offer |
| Tool definitions | Uses [`twilioCallerSummaryTool`](server/tools/twilio.ts#L21) and [`voiceEndCallTool`](server/tools/twilio.ts#L38) | Uses [`twilioCallerSummaryTool`](server/tools/twilio.ts#L21) and [`voiceEndCallTool`](server/tools/twilio.ts#L38) | SMS implementation lives in [`sms_caller_summary`](server/tools/twilio.ts#L133) and normal tool dispatch is [`executeTool`](server/tools/index.ts#L32) |
| Client flow config | Browser uses [`buildBrowserRealtimeConfig`](server/voice-agent/realtime_config.ts#L53) for PCM16 audio and far-field noise settings | Phone uses [`buildPhoneRealtimeConfig`](server/voice-agent/realtime_config.ts#L73) for G.711 audio and near-field noise settings | Shared Realtime defaults and tool assembly live in [`realtime_config.ts`](server/voice-agent/realtime_config.ts#L1); prompt text lives in [`prompt.ts`](server/voice-agent/prompt.ts#L1); queued `response.create` handling lives in [`OpenAIRealtimeClient`](server/voice-agent/openai-realtime.ts#L181) |
| Audio input/output state | PCM16 browser frames, UI events, browser playback state | G.711 u-law Twilio media frames, mark queue, Twilio REST hangup | The session handlers still own websocket state because browser and Twilio transports emit different payloads |
| Tool result return | [`sendBrowserFunctionOutput`](server/voice-agent/index.ts#L3477) | [`sendTwilioFunctionOutput`](server/voice-agent/index.ts#L2140) | Both call [`sendFunctionOutput`](server/voice-agent/openai-realtime.ts#L234) |
| Post-call work | [`sendBrowserCallEnded`](server/voice-agent/index.ts#L3224) and [`sendBrowserOrderConfirmation`](server/voice-agent/index.ts#L3295) | [`sendCallEnded`](server/voice-agent/index.ts#L1718), [`sendOrderConfirmation`](server/voice-agent/index.ts#L1832), and [`completeTwilioEndCall`](server/voice-agent/index.ts#L2049) | Confirmation channel selection is shared by `getDemoConfirmationChannel`; SMS destination override is `DEMO_SMS_RECIPIENT_PHONE` |

The browser path still has browser-named helpers because it must emit UI events, track browser playback, and handle PCM16 websocket frames. The Twilio path still has Twilio-named helpers because it must handle Twilio media payloads, mark acknowledgements, caller ID, monitor events, and REST hangup. Those names do not mean the business behavior differs; the shared behavior is [`prompt.ts`](server/voice-agent/prompt.ts#L1), tool definitions, tool execution, and Realtime client.

### Requirements

- `OPENAI_API_KEY` with access to `gpt-live-1` for the HR browser agent and the configured Realtime model for retail/phone agents
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
