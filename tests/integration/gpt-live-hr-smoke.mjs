import assert from "node:assert/strict";
import WebSocket from "ws";

const apiKey = process.env.OPENAI_API_KEY;
assert(apiKey, "OPENAI_API_KEY is required");

const ttsResponse = await fetch("https://api.openai.com/v1/audio/speech", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-4o-mini-tts",
    voice: "marin",
    input: "I want to discuss Alex's compensation.",
    response_format: "pcm",
  }),
});
if (!ttsResponse.ok) {
  throw new Error(`TTS request failed: ${await ttsResponse.text()}`);
}
const speech = Buffer.from(await ttsResponse.arrayBuffer());
const silence = Buffer.alloc(48_000);

const ws = new WebSocket(process.env.VOICE_AGENT_WS_URL || "ws://127.0.0.1:5000/ws/voice-agent");
const events = [];

function streamPcm(buffer) {
  return new Promise((resolve) => {
    let offset = 0;
    const timer = setInterval(() => {
      if (offset >= buffer.length) {
        clearInterval(timer);
        resolve();
        return;
      }
      ws.send(buffer.subarray(offset, offset + 4_800));
      offset += 4_800;
    }, 100);
  });
}

const result = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Timed out. Events: ${JSON.stringify(events)}`)), 45_000);

  ws.on("open", () => ws.send(JSON.stringify({ type: "start", agentId: 2 })));
  ws.on("message", async (data, isBinary) => {
    if (isBinary) return;
    const event = JSON.parse(data.toString());
    events.push(event);
    if (event.type === "liveSessionReady") {
      await streamPcm(silence.subarray(0, 24_000));
      await streamPcm(speech);
      await streamPcm(silence);
    }
    if (event.type === "guardrailTriggered") {
      clearTimeout(timeout);
      resolve(event);
    }
    if (event.type === "error") {
      clearTimeout(timeout);
      reject(new Error(event.message));
    }
  });
  ws.on("error", reject);
});

assert.equal(result.category, "compensation");
assert(events.some((event) => event.type === "liveSessionReady"));
assert(events.some((event) => event.type === "userTranscript" && /compensation/i.test(event.text)));
ws.send(JSON.stringify({ type: "stop" }));
ws.close();
console.log("GPT-Live HR speech and compensation guardrail smoke passed");
