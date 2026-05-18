import assert from "node:assert/strict";
import { mapRealtimeVoice } from "./voice";

assert.equal(mapRealtimeVoice("nova"), "shimmer");
assert.equal(mapRealtimeVoice("onyx"), "echo");
assert.equal(mapRealtimeVoice("fable"), "ash");
assert.equal(mapRealtimeVoice(" aura-luna-en "), "shimmer");
assert.equal(mapRealtimeVoice("unknown-legacy-voice"), "alloy");
