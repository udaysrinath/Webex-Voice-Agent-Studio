import assert from "node:assert/strict";

import {
  calculateAdaptiveMicThreshold,
  MAX_MIC_RMS_THRESHOLD,
  MIN_MIC_RMS_THRESHOLD,
} from "../../client/src/lib/microphone-noise-gate";

assert.equal(calculateAdaptiveMicThreshold([]), MIN_MIC_RMS_THRESHOLD);
assert.equal(calculateAdaptiveMicThreshold(Array(60).fill(0.002)), MIN_MIC_RMS_THRESHOLD);
assert.ok(calculateAdaptiveMicThreshold(Array(60).fill(0.01)) > 0.02);
assert.equal(calculateAdaptiveMicThreshold(Array(60).fill(0.04)), MAX_MIC_RMS_THRESHOLD);

const mostlyQuietWithSpeech = [...Array(48).fill(0.003), ...Array(12).fill(0.08)];
assert.equal(calculateAdaptiveMicThreshold(mostlyQuietWithSpeech), MIN_MIC_RMS_THRESHOLD);

console.log("adaptive microphone noise gate regression passed");
