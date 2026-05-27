import assert from "node:assert/strict";
import {
  buildRetailRuntimePrompt,
  buildUseCaseSystemPrompt,
} from "../../../shared/prompt-builder";
import { RETAIL_STORE_ASSISTANT_USE_CASE } from "../../../shared/use-cases";
import {
  buildBrowserTranscriptionPrompt,
  buildRetailTranscriptionKeywords,
  buildPhoneTranscriptionPrompt,
  buildRealtimeCallInstructions,
  getProfileConfirmationPrompt,
} from "../../../server/voice-agent/prompt";

const browserTranscriptionPrompt = buildBrowserTranscriptionPrompt("Keywords: iPad, MacBook");
const phoneTranscriptionPrompt = buildPhoneTranscriptionPrompt("Keywords: iPad, MacBook");
assert.equal(browserTranscriptionPrompt, phoneTranscriptionPrompt);
assert.match(browserTranscriptionPrompt, /do not infer, complete, or insert a product name/i);
assert.match(browserTranscriptionPrompt, /unless it is clearly spoken/i);
assert.match(buildRetailTranscriptionKeywords(), /Mayada Abdelrahman/);
assert.match(buildRetailTranscriptionKeywords(), /Abdulrahman/);

const browserProfilePrompt = getProfileConfirmationPrompt("Wanna buy iPad?", "browser");
const twilioProfilePrompt = getProfileConfirmationPrompt("Wanna buy iPad?", "twilio");
assert.equal(browserProfilePrompt, twilioProfilePrompt);
assert.match(browserProfilePrompt, /pre-confirmation intent/i);
assert.match(browserProfilePrompt, /treat that pre-confirmation intent as unverified/i);
assert.match(browserProfilePrompt, /do not resume or act on the pre-confirmation intent/i);

const browserCallInstructions = buildRealtimeCallInstructions({
  baseInstructions: "Base retail instructions.",
  channel: "browser",
  confirmationSpokenRoute: "sms",
  canSendCallerSummarySms: true,
  returningCallerName: "John",
});
const twilioCallInstructions = buildRealtimeCallInstructions({
  baseInstructions: "Base retail instructions.",
  channel: "twilio",
  callerPhone: "+16509551868",
  confirmationSpokenRoute: "sms",
  canSendCallerSummarySms: true,
  returningCallerName: "John",
});
assert.equal(browserCallInstructions, twilioCallInstructions);

const retailRuntimePrompt = buildRetailRuntimePrompt(buildUseCaseSystemPrompt(RETAIL_STORE_ASSISTANT_USE_CASE));
assert.match(retailRuntimePrompt, /Do not ask which store, location, or city/i);
assert.match(retailRuntimePrompt, /call retail_lookup_inventory immediately without asking/i);
assert.match(retailRuntimePrompt, /Do not call retail_user_history_lookup or retail_get_customer_context separately/i);
assert.doesNotMatch(retailRuntimePrompt, /first ask which location/i);
assert.doesNotMatch(retailRuntimePrompt, /Only after he confirms a pickup location/i);

console.log("prompt resilience regression passed");
