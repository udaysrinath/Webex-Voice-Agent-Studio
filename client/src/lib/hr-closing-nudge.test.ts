import assert from "node:assert/strict";
import test from "node:test";
import { hasHrDeliveryClosing, shouldNudgeHrClosing } from "./hr-closing-nudge";
import { HR_FEEDBACK_CLOSING } from "../../../shared/use-cases";

test("requires delivery confirmation and a friendly farewell, allows natural wording", () => {
  assert.equal(hasHrDeliveryClosing("Okay, just a sec."), false);
  assert.equal(hasHrDeliveryClosing("Great, I'll send that. Have a nice day."), false);
  assert.equal(hasHrDeliveryClosing("I've sent your summary to Webex."), false);
  assert.equal(hasHrDeliveryClosing(HR_FEEDBACK_CLOSING), true);
  assert.equal(hasHrDeliveryClosing("Your summary has been delivered to the Webex space. Have a great day!"), true);
});
test("nudges incomplete speech only after quiet, at most twice after the initial update", () => {
  const stalled = { attempts: 1, sinceNudgeMs: 11000, transcriptQuietMs: 6000, audioLevel: 0, text: "Okay, just a sec." };
  assert.equal(shouldNudgeHrClosing(stalled), true);
  assert.equal(shouldNudgeHrClosing({ ...stalled, audioLevel: 0.1 }), false);
  assert.equal(shouldNudgeHrClosing({ ...stalled, transcriptQuietMs: 500 }), false);
  assert.equal(shouldNudgeHrClosing({ ...stalled, sinceNudgeMs: 3000 }), false);
  assert.equal(shouldNudgeHrClosing({ ...stalled, attempts: 3 }), false);
  assert.equal(shouldNudgeHrClosing({ ...stalled, text: HR_FEEDBACK_CLOSING }), false);
});
