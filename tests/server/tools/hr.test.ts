import assert from "node:assert/strict";

import { classifyHrRestrictedTopic, submit_feedback } from "../../../server/tools/hr";
import { resolveAgentProfileId } from "../../../shared/agent-profiles";

const restrictedCases = [
  ["What is her salary?", "compensation"],
  ["Should he get promoted this cycle?", "promotion_or_rating"],
  ["I think she should be put on a PIP.", "discipline_or_termination"],
  ["His medical diagnosis affects the team.", "medical_or_accommodation"],
  ["Her age is a concern.", "protected_characteristic"],
  ["I want to file a formal grievance.", "legal_or_grievance"],
  ["What did my manager say about me?", "private_feedback"],
] as const;

for (const [text, category] of restrictedCases) {
  assert.equal(classifyHrRestrictedTopic(text)?.category, category, text);
}

assert.equal(
  classifyHrRestrictedTopic("They communicate project risks early and could make meeting notes more concise."),
  null
);

const withoutConsent = await submit_feedback({
  colleague: "Alex",
  relationship: "Project teammate",
  strengths: ["Communicates risks early"],
  developmentAreas: [],
  consentConfirmed: false,
});
assert.equal(withoutConsent.success, false);
assert.match(withoutConsent.error || "", /confirmation is required/i);

const restrictedSubmission = await submit_feedback({
  colleague: "Alex",
  relationship: "Project teammate",
  strengths: ["Communicates risks early"],
  developmentAreas: ["Should receive a lower performance rating"],
  consentConfirmed: true,
});
assert.equal(restrictedSubmission.success, false);
assert.match(restrictedSubmission.error || "", /restricted topic/i);

assert.equal(resolveAgentProfileId({ profileId: "hr-feedback", name: "Anything" }), "hr-feedback");
assert.equal(resolveAgentProfileId({ profileId: "generic", name: "Store Assistant" }), "retail");
assert.equal(resolveAgentProfileId({ name: "HR Agent", systemPrompt: "Collect colleague feedback" }), "hr-feedback");
assert.equal(resolveAgentProfileId({ name: "General Assistant" }), "generic");

console.log("HR guardrail and profile regression passed");
