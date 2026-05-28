import assert from "node:assert/strict";
import {
  FINAL_CHECK_IN_TEXT,
  FINAL_CLOSING_TEXT,
  getAddOnAnswerCheckInText,
} from "../../../server/voice-agent/prompt";
import {
  canEndCallFromUserTranscript,
  getAcceptedUserTurnDecision,
  getAssistantTranscriptEffects,
} from "../../../server/voice-agent/voice_runtime";

const addOnDeclineDecision = getAcceptedUserTurnDecision({
  text: "No thanks, I'll pass.",
  lastAssistantTranscript: "Would you like me to add a Purple Protective Case to go along with it?",
  pendingAddOnOffer: true,
  pendingPickupProposal: false,
  finalCheckInAsked: false,
  profileConfirmationNeeded: false,
  softDeclineReason: "soft decline",
  endCallReason: "end call",
});

assert.equal(addOnDeclineDecision.pendingAddOnOffer, false);
assert.equal(addOnDeclineDecision.pendingPickupProposal, false);
assert.equal(addOnDeclineDecision.finalCheckInAsked, false);
assert.deepEqual(addOnDeclineDecision.action, {
  type: "request_add_on_check_in",
  text: getAddOnAnswerCheckInText("negative"),
});

const softDeclineDecision = getAcceptedUserTurnDecision({
  text: "No thanks, I'm good.",
  lastAssistantTranscript: "The case is available.",
  pendingAddOnOffer: false,
  pendingPickupProposal: false,
  finalCheckInAsked: false,
  profileConfirmationNeeded: false,
  softDeclineReason: "soft decline",
  endCallReason: "end call",
});

assert.equal(softDeclineDecision.action.type, "request_final_check_in");

const pickupAcceptanceDecision = getAcceptedUserTurnDecision({
  text: "Yes, that works.",
  lastAssistantTranscript: "Any assistant wording is allowed here because inventory lookup set the pending pickup proposal state.",
  pendingAddOnOffer: false,
  pendingPickupProposal: true,
  finalCheckInAsked: false,
  profileConfirmationNeeded: false,
  softDeclineReason: "soft decline",
  endCallReason: "end call",
});

assert.deepEqual(pickupAcceptanceDecision.action, { type: "respond" });
assert.equal(pickupAcceptanceDecision.pendingPickupProposal, false);

const finalNegativeDecision = getAcceptedUserTurnDecision({
  text: "No, that's all.",
  lastAssistantTranscript: FINAL_CHECK_IN_TEXT,
  pendingAddOnOffer: false,
  pendingPickupProposal: false,
  finalCheckInAsked: true,
  profileConfirmationNeeded: false,
  softDeclineReason: "soft decline",
  endCallReason: "end call",
});

assert.deepEqual(finalNegativeDecision.action, {
  type: "request_graceful_end_call",
  reason: "end call",
});
assert.equal(finalNegativeDecision.finalCheckInAsked, false);
assert.equal(canEndCallFromUserTranscript("No, that's all.", FINAL_CHECK_IN_TEXT, true), true);

const effects = getAssistantTranscriptEffects(
  `Would you like me to add a Purple Protective Case? ${FINAL_CLOSING_TEXT}`
);

assert.equal(effects.pendingAddOnOffer, true);
assert.equal(effects.deliveredClosing, true);
