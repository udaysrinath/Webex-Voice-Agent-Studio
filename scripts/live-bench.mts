// Headless latency + correctness benchmark for the WebexOne GPT-Live flow.
//   node --env-file=.env --import tsx scripts/live-bench.mts <responses|app> [repeats]
// Speaks each question (OpenAI TTS → 24 kHz PCM) into a GPT-Live WebSocket session in real time and measures, from the
// end of the caller's speech: when delegation started, when the backend answer reached GPT-Live, and when the first
// useful audio came back. It also prints what was said and checks it against expected facts.
import WebSocket from "ws";
import { buildLiveSessionConfig } from "../server/voice-agent/openai-live";
import { lastUtterance, type TranscriptFragment } from "../shared/live-transcript";
import { webexOneLiveFrontendInstructions } from "../server/webexone-live";
import { executeWebexOneTool, WEBEXONE_TOOL_GUIDANCE, webexOneRealtimeTools } from "../server/webexone-tools";

const mode = (process.argv[2] || "client") as "responses" | "app";
const repeats = Number(process.argv[3]) || 1;
const NAME = "Mia";

const ONLY = process.env.BENCH_ONLY;
const CASES_ALL: Array<{ q: string; expect: string[][] }> = [
  { q: "Where is lunch served?", expect: [["Pool Terrace"]] },
  { q: "Can you tell me where they serve lunch here?", expect: [["Pool Terrace"]] },
  { q: "What's the Wi-Fi password for the event?", expect: [["WebexOne2026"]] },
  { q: "Where do I check in and get my badge?", expect: [["Level 3", "Foyer"]] },
  { q: "What time does the closing keynote begin?", expect: [["2"]] },
  { q: "Is there anywhere to eat for breakfast?", expect: [["Pool Terrace"]] },
  { q: "Where is the capture the flag lab?", expect: [["Violet"]] },
  { q: "Where is registration?", expect: [["Level 3", "Foyer"]] },
  { q: "WebexOne में लंच कहाँ मिलेगा?", expect: [["Pool Terrace"]] },
  { q: "What is the wifi password?", expect: [["WebexOne2026"]] },
  { q: "When is the closing keynote?", expect: [["October 8", "Thursday"], ["2"]] },
  { q: "Where is Capture the Flag?", expect: [["Violet"]] },
];

const CASES = ONLY ? CASES_ALL.filter((c) => c.q.toLowerCase().includes(ONLY.toLowerCase())) : CASES_ALL;

const FRONTEND = mode === "responses"
  ? `You are ${NAME}, a concise and helpful WebexOne 2026 Q&A voice assistant at the event.\n\nFor factual WebexOne questions delegate to the backend before answering. Never guess. Speak only caller-facing words.`
  : webexOneLiveFrontendInstructions(NAME, "");

async function tts(text: string): Promise<Buffer> {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "tts-1", voice: "alloy", input: text, response_format: "pcm" }),
  });
  if (!response.ok) throw new Error(`TTS failed ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

interface Run { q: string; delegationMs?: number; toolResultMs?: number; firstAudioMs?: number; usefulAudioMs?: number; spoken: string; ok: boolean; note: string }

const BABBLE = process.env.BENCH_BABBLE ? await Promise.all(["So then I told him we could move the review to Thursday if everyone was around and the budget was approved by then.", "Honestly the flight was fine, the hotel was a bit far from the venue, but the food was great and the coffee was even better."].map(async (text, i) => { const r = await fetch("https://api.openai.com/v1/audio/speech", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "tts-1", voice: ["echo", "nova"][i], input: text, response_format: "pcm" }) }); return new Int16Array(Buffer.from(await r.arrayBuffer()).buffer.slice(0)); })) : undefined;
const mixBabble = (pcm: Buffer): Buffer => {
  if (!BABBLE) return pcm;
  const q = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length));
  const rms = (x: Int16Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
  const g = (rms(q) / Math.max(1, rms(BABBLE[0]))) / 1.8; // about 5 dB below the question
  const out = new Float32Array(q.length + 24000 * 3);
  q.forEach((v, i) => { out[i + 24000] += v; });
  [{ x: BABBLE[0], at: 0 }, { x: BABBLE[1], at: 12000 }].forEach(({ x, at }) => x.forEach((v, i) => { if (at + i < out.length) out[at + i] += v * g; }));
  return Buffer.from(Int16Array.from(out, (v) => Math.max(-32768, Math.min(32767, v))).buffer);
};

async function runOne(testCase: (typeof CASES)[number]): Promise<Run> {
  const audio = mixBabble(await tts(testCase.q));
  const session = buildLiveSessionConfig(
    { instructions: FRONTEND, tools: mode === "responses" ? webexOneRealtimeTools : [], inputAudioFormat: "pcm16", outputAudioFormat: "pcm16", voice: "marin" } as any,
    { frontendInstructions: FRONTEND, backendInstructions: `You are the WebexOne 2026 guide backend.\n${WEBEXONE_TOOL_GUIDANCE}\nFor each factual question, call the matching tool before answering. If a tool returns nothing relevant, say you could not find that detail.` },
    "websocket",
  );
  if (mode === "app") session.delegation = { type: "client" };
  // RESP_TUNING='{"tool_choice":"required","reasoning":{"effort":"low"},"service_tier":"priority"}' tunes Responses delegation
  if (mode === "responses" && process.env.RESP_TUNING) Object.assign(session.delegation.responses, JSON.parse(process.env.RESP_TUNING));

  const ws = new WebSocket("wss://api.openai.com/v1/live/sessions", { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
  const send = (event: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(event));
  let t0 = 0; // end of the caller's speech
  const at = () => (t0 ? Math.round(performance.now() - t0) : undefined);
  const run: Run = { q: testCase.q, spoken: "", ok: false, note: "" };
  const timeline: string[] = [];
  let inputTranscript = "";
  const fragments: TranscriptFragment[] = [];
  let lastFallback: { id: string; text: string } | undefined;
  let answerSentAt = 0;
  let started = false, finished = false;
  const pendingTools = new Map<string, { completed: boolean; calls: Map<string, Promise<void>> }>();

  const done = new Promise<void>((resolve) => {
    const timer = setTimeout(() => { run.note += " timeout;"; resolve(); }, 45_000);
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    ws.on("message", async (data) => {
      const event = JSON.parse(data.toString());
      if (process.env.BENCH_EVENTS && t0 && !String(event.type).includes("audio.delta")) timeline.push(`${at()}ms ${event.type}${event.delta ? ` "${String(event.delta).slice(0, 30)}"` : ""}`);
      switch (event.type) {
        case "session.started": started = true; break;
        case "session.input_transcript.delta": inputTranscript += event.delta || ""; fragments.push({ text: String(event.delta || ""), startMs: Number(event.start_ms) || 0, endMs: Number(event.end_ms) || 0 }); break;
        case "session.delegation.created":
          run.delegationMs ??= at();
          if (mode === "app" && event.delegation?.target === "client") {
            const question = lastUtterance(fragments, event.offset_ms) || testCase.q;
            run.note += ` heard:"${question.slice(0, 60)}";`;
            const t = performance.now();
            const response = await fetch(`${process.env.BENCH_URL || "http://localhost:3000"}/api/webexone/live-answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: 3, question }) });
            const body = await response.json() as { facts: string[]; content: string; fallback: string };
            for (const pack of body.facts) send({ type: "session.thinking.append", event_id: `facts_${Date.now()}_${Math.random()}`, delegation_id: event.delegation.id, content: pack });
            lastFallback = { id: event.delegation.id, text: body.fallback };
            run.note += ` http(${Math.round(performance.now() - t)}ms);`;
            send({ type: "session.commentary.append", event_id: `app_${Date.now()}`, delegation_id: event.delegation.id, content: body.content });
            answerSentAt = performance.now();
            run.toolResultMs = at();
          }
          break;
        case "response.event": {
          const nested = event.event;
          const delegationId = String(event.delegation_id);
          if (nested?.type === "response.output_item.done" && nested.item?.type === "function_call") {
            const pending = pendingTools.get(delegationId) || { completed: false, calls: new Map() };
            pendingTools.set(delegationId, pending);
            const callId = String(nested.item.call_id);
            run.note += ` tool(${at()}ms:${String(nested.item.arguments).slice(0, 60)});`;
            pending.calls.set(callId, (async () => {
              let output: string;
              try { output = await executeWebexOneTool(nested.item.name, JSON.parse(nested.item.arguments || "{}")); } catch (error) { output = `lookup failed: ${error}`; }
              send({ type: "response.item.create", event_id: `result_${callId}`, item: { type: "function_call_output", call_id: callId, output } });
            })());
          }
          if (nested?.type === "response.completed") {
            const pending = pendingTools.get(delegationId);
            if (pending?.calls.size) { pending.completed = true; pendingTools.delete(delegationId); await Promise.all(pending.calls.values()); answerSentAt = performance.now(); run.toolResultMs = at(); send({ type: "response.create", event_id: `continue_${Date.now()}` }); }
          }
          break;
        }
        case "session.output_audio.delta":
          run.firstAudioMs ??= at();
          if (answerSentAt && run.usefulAudioMs === undefined) run.usefulAudioMs = at();
          if (answerSentAt) { if (quietTimer) clearTimeout(quietTimer); quietTimer = setTimeout(() => { if (!finished) { finished = true; clearTimeout(timer); resolve(); } }, 3000); }
          break;
        case "session.output_transcript.delta":
          run.spoken += event.delta || "";
          if (answerSentAt) { if (quietTimer) clearTimeout(quietTimer); quietTimer = setTimeout(() => { if (!finished) { finished = true; clearTimeout(timer); resolve(); } }, 3000); }
          break;
        case "error":
          run.note += ` error:${event.error?.message};`;
          if (/must not exceed 500 tokens/i.test(String(event.error?.message)) && lastFallback) { send({ type: "session.commentary.append", event_id: `retry_${Date.now()}`, delegation_id: lastFallback.id, content: lastFallback.text }); run.note += " retried-with-fallback;"; lastFallback = undefined; }
          break;
      }
    });
    ws.on("error", (error) => { run.note += ` ws:${error.message};`; resolve(); });
  });

  await new Promise<void>((resolve) => ws.on("open", () => { send({ type: "session.start", event_id: "start", session }); resolve(); }));
  while (!started) await new Promise((r) => setTimeout(r, 20));
  // real-time stream: 300 ms silence, the question, then silence until the answer has been spoken
  const chunk = 960; // 20 ms of 24 kHz PCM16
  const silence = Buffer.alloc(chunk);
  const frames: Buffer[] = [];
  for (let i = 0; i < 15; i++) frames.push(silence);
  for (let o = 0; o < audio.length; o += chunk) frames.push(audio.subarray(o, Math.min(o + chunk, audio.length)).length === chunk ? audio.subarray(o, o + chunk) : Buffer.concat([audio.subarray(o), Buffer.alloc(chunk - (audio.length - o))]));
  const speechFrames = frames.length;
  for (let i = 0; i < 1500; i++) frames.push(silence);
  const startedAt = performance.now();
  for (let i = 0; i < frames.length && !finished; i++) {
    send({ type: "session.input_audio.append", audio: frames[i].toString("base64") });
    if (i === speechFrames - 1) t0 = performance.now();
    const wait = startedAt + (i + 1) * 20 - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (ws.readyState !== WebSocket.OPEN) break;
  }
  await done;
  send({ type: "session.close", event_id: "close" });
  setTimeout(() => ws.close(), 300);
  if (process.env.BENCH_EVENTS) console.log("  timeline (ms after end of speech):\n    " + timeline.slice(0, 60).join("\n    "));
  const text = run.spoken.toLowerCase().replace(/\s+/g, "");
  run.ok = testCase.expect.every((group) => group.some((alt) => text.includes(alt.toLowerCase().replace(/\s+/g, ""))));
  return run;
}

const results: Run[] = [];
for (let r = 0; r < repeats; r++) for (const testCase of CASES) {
  const run = await runOne(testCase);
  results.push(run);
  console.log(`\n[${mode}] "${run.q}"\n  heard-by-model delegation@${run.delegationMs}ms  backend-result@${run.toolResultMs}ms  first-audio@${run.firstAudioMs}ms  useful-audio@${run.usefulAudioMs}ms  ${run.ok ? "CORRECT" : "CHECK"}\n  said: ${run.spoken.slice(0, 220)}\n  notes:${run.note}`);
}
const med = (xs: Array<number | undefined>) => { const v = xs.filter((x): x is number => x !== undefined).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : NaN; };
console.log(`\n=== ${mode}: median useful-audio ${med(results.map((r) => r.usefulAudioMs))} ms | median backend-result ${med(results.map((r) => r.toolResultMs))} ms | correct ${results.filter((r) => r.ok).length}/${results.length}`);
process.exit(0);
