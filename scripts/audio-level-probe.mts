// How hot is GPT-Live's output? Speaks a question, captures the 24 kHz PCM16 it answers with, and reports levels.
import WebSocket from "ws";
import { buildLiveSessionConfig } from "../server/voice-agent/openai-live";
const VOICE = process.argv[2] || "marin";
const tts = async (text: string) => Buffer.from(await (await fetch("https://api.openai.com/v1/audio/speech", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "tts-1", voice: "alloy", input: text, response_format: "pcm" }) })).arrayBuffer());
const audio = await tts("Please tell me a few sentences about where lunch is served at the conference, and what time breakfast and lunch are.");
const session = buildLiveSessionConfig({ instructions: "You are a warm conference guide. Answer in three or four sentences.", tools: [], voice: VOICE } as any, { frontendInstructions: "You are a warm conference guide. Answer the caller in three or four spoken sentences about lunch and breakfast at a conference in Austin: lunch is at Pool Terrace and Palm Court on Level 7, noon to 2 PM on Monday and Tuesday and 11 AM to 1 PM on Wednesday and Thursday; breakfast is 7 to 8:45 AM.", backendInstructions: "", delegation: "client" }, "websocket");
const ws = new WebSocket("wss://api.openai.com/v1/live/sessions", { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
const chunks: Buffer[] = []; let started = false; let lastAudio = 0;
ws.on("message", (d) => { const e = JSON.parse(d.toString()); if (e.type === "session.started") started = true; if (e.type === "session.output_audio.delta" && e.delta) { chunks.push(Buffer.from(e.delta, "base64")); lastAudio = Date.now(); } });
await new Promise<void>((r) => ws.on("open", () => { ws.send(JSON.stringify({ type: "session.start", event_id: "s", session })); r(); }));
while (!started) await new Promise((r) => setTimeout(r, 20));
const frame = 960; const silence = Buffer.alloc(frame); const t0 = performance.now(); let i = 0;
const frames = [...Array(15).fill(silence), ...Array.from({ length: Math.ceil(audio.length / frame) }, (_, k) => { const b = Buffer.alloc(frame); audio.copy(b, 0, k * frame, Math.min((k + 1) * frame, audio.length)); return b; })];
for (const f of frames) { ws.send(JSON.stringify({ type: "session.input_audio.append", audio: f.toString("base64") })); await new Promise((r) => setTimeout(r, Math.max(0, t0 + ++i * 20 - performance.now()))); }
const deadline = Date.now() + 40_000;
while (Date.now() < deadline) { ws.send(JSON.stringify({ type: "session.input_audio.append", audio: silence.toString("base64") })); await new Promise((r) => setTimeout(r, 20)); if (lastAudio && Date.now() - lastAudio > 2500) break; }
ws.close();
const pcm = Buffer.concat(chunks); const n = pcm.length / 2; const x = new Int16Array(pcm.buffer, pcm.byteOffset, n);
let peak = 0, sum = 0, near = 0, clipped = 0;
for (let k = 0; k < n; k++) { const v = Math.abs(x[k]) / 32768; peak = Math.max(peak, v); sum += v * v; if (v > 0.891) near++; if (v >= 0.9997) clipped++; }
// 4x linear-interpolated "true peak" estimate (crude intersample peak)
let tp = 0; for (let k = 0; k < n - 1; k++) for (let j = 1; j < 4; j++) { const v = Math.abs((x[k] * (4 - j) + x[k + 1] * j) / 4) / 32768; tp = Math.max(tp, v); }
const db = (v: number) => (20 * Math.log10(v || 1e-9)).toFixed(1);
console.log(`voice ${VOICE}: ${(n / 24000).toFixed(1)} s | peak ${db(peak)} dBFS | est. true peak ${db(tp)} dBFS | RMS ${db(Math.sqrt(sum / n))} dBFS | samples above -1 dBFS ${near} (${((near / n) * 100).toFixed(3)}%) | at full scale ${clipped}`);
process.exit(0);
