// Does the greeting work under client delegation? Starts a session, keeps input audio running (silence), waits for
// session.started, sends the same session.instructions.append the browser sends, and reports what GPT-Live says and when.
import WebSocket from "ws";
import { buildLiveSessionConfig } from "../server/voice-agent/openai-live";
import { webexOneLiveFrontendInstructions } from "../server/webexone-live";
const NAME = "Mia";
const opening = `Say: “Hi, I'm ${NAME}. I can answer questions about WebexOne 2026. What would you like to know?” Then wait.`;
const session = buildLiveSessionConfig({ instructions: "", tools: [], voice: "marin" } as any, { frontendInstructions: webexOneLiveFrontendInstructions(NAME, opening), backendInstructions: "", delegation: "client" }, "websocket");
const ws = new WebSocket("wss://api.openai.com/v1/live/sessions", { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
const t0 = performance.now(); const at = () => Math.round(performance.now() - t0);
const counts: Record<string, number> = {}; let spoken = ""; let firstAudio = 0; let sentAt = 0; const log: string[] = [];
ws.on("message", (d) => { const e = JSON.parse(d.toString()); counts[e.type] = (counts[e.type] || 0) + 1; if (!String(e.type).includes("audio.delta")) log.push(`${at()}ms ${e.type}`); if (e.type === "session.output_audio.delta" && !firstAudio) firstAudio = at(); if (e.type === "session.output_transcript.delta") spoken += e.delta; if (e.type === "error") log.push(JSON.stringify(e.error)); if (e.type === "session.started") { sentAt = at(); ws.send(JSON.stringify({ type: "session.instructions.append", event_id: "greet", delegation_id: null, content: `Greet the caller now. Say: “Hi, I'm ${NAME}. I can answer questions about WebexOne 2026. What would you like to know?” Then wait.` })); } });
await new Promise<void>((r) => ws.on("open", () => { ws.send(JSON.stringify({ type: "session.start", event_id: "s", session })); r(); }));
const silence = Buffer.alloc(960).toString("base64");
for (let i = 0; i < 400; i++) { ws.send(JSON.stringify({ type: "session.input_audio.append", audio: silence })); await new Promise((r) => setTimeout(r, 20)); }
ws.close();
console.log(`greeting sent at ${sentAt}ms; first audio at ${firstAudio}ms (${firstAudio ? firstAudio - sentAt : "never"} ms after the instruction)\nsaid: ${spoken.trim() || "(nothing)"}\n${log.slice(0, 14).join("\n")}\nevent counts: ${JSON.stringify(counts)}`);
process.exit(0);
