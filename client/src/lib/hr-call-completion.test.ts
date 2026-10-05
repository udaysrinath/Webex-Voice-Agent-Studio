import assert from "node:assert/strict";
import test from "node:test";
import { hasHrClosingFinished } from "./hr-call-completion";
import { HR_FEEDBACK_CLOSING } from "../../../shared/use-cases";

const closing = {
  responseSeen: true, speechHeard: true, audioLevel: 0,
  quietForMs: 1400, transcriptQuietForMs: 1400, closingText: HR_FEEDBACK_CLOSING,
};
test("waits for closing speech and playback rather than elapsed delivery time", () => {
  assert.equal(hasHrClosingFinished({ ...closing, responseSeen: false }), false);
  assert.equal(hasHrClosingFinished({ ...closing, speechHeard: false }), false);
  assert.equal(hasHrClosingFinished({ ...closing, audioLevel: 0.1, quietForMs: 0 }), false);
  assert.equal(hasHrClosingFinished({ ...closing, quietForMs: 700 }), false);
  assert.equal(hasHrClosingFinished({ ...closing, transcriptQuietForMs: 500 }), false);
  assert.equal(hasHrClosingFinished(closing), true);
});
test("without audio stats, allows enough time for the full closing line", () => {
  assert.equal(hasHrClosingFinished({ ...closing, audioLevel: null, transcriptQuietForMs: 7000 }), false);
  assert.equal(hasHrClosingFinished({ ...closing, audioLevel: null, transcriptQuietForMs: 20000 }), true);
});
