import assert from "node:assert/strict";

import { buildHrLiveFrontendInstructions } from "../../../server/voice-agent/index";
import { buildLiveSessionConfig, buildLiveSessionStart } from "../../../server/voice-agent/openai-live";
import { getAgentRuntimeProfile } from "../../../server/agents/registry";
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

const webRtcSession = buildLiveSessionConfig(config, {
  frontendInstructions: "frontend",
  backendInstructions: "backend",
  backendModel: "gpt-5.6-luna",
}, "webrtc") as any;
assert.equal(webRtcSession.model, "gpt-live-1");
assert.equal(webRtcSession.audio.format, undefined);
assert.equal(webRtcSession.audio.output.voice, "marin");

const frontendPrompt = buildHrLiveFrontendInstructions("360 Feedback Interviewer");
assert.match(frontendPrompt, /ignore room noise/i);
assert.match(frontendPrompt, /delegate only when the HR feedback delivery tool must run/i);
assert.match(frontendPrompt, /compensation/i);
assert.match(frontendPrompt, /high-pressure situation/i);
assert.match(frontendPrompt, /sample dialogue/i);
assert.match(frontendPrompt, /Opening turn \(highest priority\)/i);
assert.match(frontendPrompt, /Do not say “Great,” ask who the feedback is about/i);
assert.match(frontendPrompt, /ask the next scripted development question/i);
assert.match(frontendPrompt, /Do not probe further/i);
assert.match(frontendPrompt, /obtain explicit confirmation before sending/i);

const hrProfile = getAgentRuntimeProfile({
  name: "360 Feedback Interviewer",
  profileId: "hr-feedback",
  systemPrompt: "Ask what makes the leader good at their job.",
});
const hrBackendPrompt = hrProfile?.instructions("Ask what makes the leader good at their job.") || "";
assert.match(hrBackendPrompt, /Can you describe a time \[NAME\] handled a high-pressure situation/i);
assert.match(hrBackendPrompt, /Do not ask follow-up probes/i);
assert.doesNotMatch(hrBackendPrompt, /Ask what makes the leader good at their job\./i);

console.log("openai GPT-Live session configuration regression passed");
