import assert from "node:assert/strict";
import {
  buildRetailRuntimePrompt,
  buildUseCaseSystemPrompt,
} from "../../../shared/prompt-builder";
import { RETAIL_STORE_ASSISTANT_USE_CASE } from "../../../shared/use-cases";
import {
  buildBrowserTranscriptionPrompt,
  buildOpenAIVoiceAgentInstructions,
  buildRetailTranscriptionKeywords,
  buildPhoneTranscriptionPrompt,
  getProfileConfirmationPrompt,
} from "../../../server/voice-agent/prompt";

const browserTranscriptionPrompt = buildBrowserTranscriptionPrompt("Keywords: iPad, MacBook");
const phoneTranscriptionPrompt = buildPhoneTranscriptionPrompt("Keywords: iPad, MacBook");
assert.equal(browserTranscriptionPrompt, phoneTranscriptionPrompt);
assert.match(browserTranscriptionPrompt, /do not infer, complete, or insert a product name/i);
assert.match(browserTranscriptionPrompt, /unless it is clearly spoken/i);
assert.doesNotMatch(buildRetailTranscriptionKeywords(), /Bose QuietComfort 45/);
assert.doesNotMatch(buildRetailTranscriptionKeywords(), /Sony WH-1000XM5/);
assert.match(buildRetailTranscriptionKeywords(), /Mayada Abdelrahman/);
assert.match(buildRetailTranscriptionKeywords(), /Abdelrahman/);
assert.equal(
  buildRetailTranscriptionKeywords({
    DEMO_CUSTOMER_NAME: "Avery Chen",
    DEMO_CUSTOMER_PHONE: "+14155550199",
  } as NodeJS.ProcessEnv).includes("Mayada"),
  false
);

const browserProfilePrompt = getProfileConfirmationPrompt("Wanna buy iPad?", "browser");
const twilioProfilePrompt = getProfileConfirmationPrompt("Wanna buy iPad?", "twilio");
assert.equal(browserProfilePrompt, twilioProfilePrompt);
assert.match(browserProfilePrompt, /pre-confirmation intent/i);
assert.match(browserProfilePrompt, /keep it as the active request after profile confirmation/i);
assert.match(browserProfilePrompt, /without asking what they want to shop for again/i);

const browserCallInstructions = buildOpenAIVoiceAgentInstructions({
  confirmationSpokenRoute: "sms",
  canSendCallerSummarySms: true,
  returningCallerName: "Mayada",
});
const twilioCallInstructions = buildOpenAIVoiceAgentInstructions({
  callerPhone: "+16509551868",
  confirmationSpokenRoute: "sms",
  canSendCallerSummarySms: true,
  returningCallerName: "Mayada",
});
assert.equal(browserCallInstructions, twilioCallInstructions);
assert.match(browserCallInstructions, /Call retail_reserve_item/i);
assert.match(browserCallInstructions, /Call retail_recommend_gift_accessory/i);
assert.match(browserCallInstructions, /birthday gift/i);
assert.match(browserCallInstructions, /purple/i);
assert.match(browserCallInstructions, /do not mention that this may be a birthday gift/i);
assert.match(browserCallInstructions, /only stage where you may mention the birthday gift/i);

const retailRuntimePrompt = buildRetailRuntimePrompt(buildUseCaseSystemPrompt(RETAIL_STORE_ASSISTANT_USE_CASE));
assert.match(retailRuntimePrompt, /Do not ask which store, location, or city/i);
assert.match(retailRuntimePrompt, /call retail_lookup_inventory immediately without asking/i);
assert.match(retailRuntimePrompt, /Do not call retail_user_history_lookup or retail_get_customer_context separately/i);
assert.doesNotMatch(retailRuntimePrompt, /\bJohn\b|John Rivera/);
assert.doesNotMatch(retailRuntimePrompt, /first ask which location/i);
assert.doesNotMatch(retailRuntimePrompt, /Only after (he|she|they) confirms a pickup location/i);

console.log("prompt resilience regression passed");
