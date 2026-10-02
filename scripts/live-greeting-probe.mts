// Does GPT-Live speak first when told to? Streams silence (as an idle microphone does), triggers the greeting one of several
// ways, and reports how long until GPT-Live actually speaks.
//   node --env-file=.env --import tsx scripts/live-greeting-probe.mts <variant> [runs]
// variants: instruct | immediate | commentary | history | thinking+instruct
import WebSocket from "ws";
import { buildLiveSessionConfig } from "../server/voice-agent/openai-live";
import { webexOneLiveFrontendInstructions } from "../server/webexone-live";

const variant = process.argv[2] || "instruct";
const runs = Number(process.argv[3]) || 3;
const NAME = "Mia";
const HELLO = `“Hi, I'm ${NAME}. I can answer questions about WebexOne 2026. What would you like to know?”`;

async function once(): Promise<string> {
  const session = buildLiveSessionConfig({ instructions: "", tools: [], voice: "marin" } as any, { frontendInstructions: webexOneLiveFrontendInstructions(NAME, ""), backendInstructions: "", delegation: "client" }, "websocket");
  if (variant === "history") session.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "(The caller has just connected and is waiting. Greet them now.)" }] }];
  const ws = new WebSocket("wss://api.openai.com/v1/live/sessions", { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
  const t0 = performance.now(); const at = () => Math.round(performance.now() - t0);
  let started = 0, sent = 0, firstAudio = 0, spoken = "";
  const send = (event: object) => ws.send(JSON.stringify(event));
  ws.on("message", (d) => {
    const e = JSON.parse(d.toString());
    if (e.type === "session.output_audio.delta" && !firstAudio) firstAudio = at();
    if (e.type === "session.output_transcript.delta") spoken += e.delta;
    if (e.type === "error") spoken += ` [error ${e.error?.message}]`;
    if (e.type === "session.started" && !started) {
      started = at();
      sent = at();
      if (variant === "instruct") send({ type: "session.instructions.append", event_id: "g", delegation_id: null, content: `Greet the caller now, in English. Say: ${HELLO} Then wait.` });
      if (variant === "immediate") send({ type: "session.instructions.append", event_id: "g", delegation_id: null, content: `Immediately say the following greeting exactly and in full, before anything else, and then wait for the caller: ${HELLO}` });
      if (variant === "commentary") send({ type: "session.commentary.append", event_id: "g", delegation_id: null, content: `Say this to the caller right now: ${HELLO}` });
      if (variant === "thinking+instruct") { send({ type: "session.thinking.append", event_id: "t", delegation_id: null, content: "The caller has just connected and is waiting for you to speak first." }); send({ type: "session.instructions.append", event_id: "g", delegation_id: null, content: `Immediately say the following greeting exactly and in full, before anything else, and then wait for the caller: ${HELLO}` }); }
    }
  });
  await new Promise<void>((r) => ws.on("open", () => { send({ type: "session.start", event_id: "s", session }); r(); }));
  const silence = Buffer.alloc(960).toString("base64");
  for (let i = 0; i < 600 && !(firstAudio && at() - firstAudio > 2500); i++) { if (ws.readyState === WebSocket.OPEN) send({ type: "session.input_audio.append", audio: silence }); await new Promise((r) => setTimeout(r, 20)); }
  ws.close();
  return firstAudio ? `spoke ${firstAudio - sent} ms after the trigger: "${spoken.trim().slice(0, 60)}"` : `NEVER spoke in ${(at() / 1000).toFixed(0)} s`;
}
for (let i = 1; i <= runs; i++) console.log(`${variant} run ${i}: ${await once()}`);
process.exit(0);
