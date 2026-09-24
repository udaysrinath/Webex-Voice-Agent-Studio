import assert from "node:assert/strict";

import { buildHrLiveFrontendInstructions } from "../../../server/voice-agent/index";
import { buildLiveSessionStart } from "../../../server/voice-agent/openai-live";
import type { RealtimeSessionConfig } from "../../../server/voice-agent/openai-realtime";

const config: RealtimeSessionConfig = {
  instructions: "backend",
  inputAudioFormat: "pcm16",
  outputAudioFormat: "pcm16",
  voice: "marin",
  tools: [{
    type: "function",
    name: "hr_submit_feedback",
    description: "Send confirmed feedback",
    parameters: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
    },
  }],
};

const start = buildLiveSessionStart(config, {
  frontendInstructions: "frontend",
  backendInstructions: "backend",
  backendModel: "gpt-5.6-luna",
}) as any;

assert.equal(start.type, "session.start");
assert.equal(start.session.model, "gpt-live-1");
assert.deepEqual(start.session.audio.format, { type: "audio/pcm", rate: 24000 });
assert.equal(start.session.delegation.type, "responses");
assert.equal(start.session.delegation.responses.model, "gpt-5.6-luna");
assert.equal(start.session.delegation.responses.parallel_tool_calls, false);
assert.equal(start.session.delegation.responses.tools[0].name, "hr_submit_feedback");

const frontendPrompt = buildHrLiveFrontendInstructions("HR Agent");
assert.match(frontendPrompt, /ignore room noise/i);
assert.match(frontendPrompt, /delegate task decisions and all tool use/i);
assert.match(frontendPrompt, /compensation/i);
assert.match(frontendPrompt, /explicitly confirms the exact summary/i);

console.log("openai GPT-Live session configuration regression passed");
