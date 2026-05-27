import assert from "node:assert/strict";
import { mapRealtimeVoice, resolveRealtimeVoice } from "../../../server/voice-agent/voice";

assert.equal(mapRealtimeVoice("nova"), "marin");
assert.equal(mapRealtimeVoice("onyx"), "marin");
assert.equal(mapRealtimeVoice("fable"), "marin");
assert.equal(mapRealtimeVoice("verse"), "marin");
assert.equal(mapRealtimeVoice("marin"), "marin");
assert.equal(mapRealtimeVoice("cedar"), "cedar");
assert.equal(mapRealtimeVoice(" aura-luna-en "), "marin");
assert.equal(mapRealtimeVoice("aura-athena-en"), "marin");
assert.equal(mapRealtimeVoice("unknown-legacy-voice"), "marin");

assert.equal(resolveRealtimeVoice("nova", "female"), "marin");
assert.equal(resolveRealtimeVoice("verse", "female"), "marin");
assert.equal(resolveRealtimeVoice("verse", "male"), "cedar");
assert.equal(resolveRealtimeVoice("verse", "neutral"), "marin");
assert.equal(resolveRealtimeVoice("unknown-legacy-voice", "female"), "marin");
assert.equal(resolveRealtimeVoice("alloy", "female"), "marin");
assert.equal(resolveRealtimeVoice("shimmer", "male"), "cedar");
assert.equal(resolveRealtimeVoice("marin", "male"), "marin");
