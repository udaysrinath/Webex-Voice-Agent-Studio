import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { OpenAIRealtimeClient, type RealtimeSpeechEvent } from "./openai-realtime";
import {
  getG711DurationMs,
  getPcm16DurationMs,
  rawAudioToBase64,
  resolveRealtimeVoice,
} from "./voice";
import { storage } from "../storage";
import { executeTool, type ToolExecutionResult } from "../tools";
import {
  canSendCallSummarySms,
  canUseDemoSms,
  resolveDemoSmsRecipientPhone,
  sanitizeSmsToolResult,
  truncateForSms,
  twilioCallerSummaryTool,
  withDemoSmsRecipient,
  voiceEndCallTool,
} from "../tools/twilio";
import {
  STORE_MANAGER_WEBEX_TEMPLATE,
  buildConfiguredWebexMessageArgs,
  formatCallDuration,
  formatJsonForInstructions,
  formatTranscript,
  renderTemplate,
  summarizeCallForStoreManager,
} from "../tools/webex";
import {
  BROWSER_PCM16_SAMPLE_RATE,
  TWILIO_G711_SAMPLE_RATE,
  buildBrowserRealtimeConfig,
  buildPhoneRealtimeConfig,
  buildRealtimeVoiceTools,
} from "./realtime_config";
import {
  FINAL_CHECK_IN_TEXT,
  PROFILE_CONFIRMATION_TEXT,
  TRANSCRIPT_REVIEW_SYSTEM_PROMPT,
  buildOpenAIVoiceAgentInstructions,
  buildRetailTranscriptionKeywords,
  getAddOnAnswerCheckInPrompt,
  getClosingInstruction,
  getClosingResponseInstructions,
  getExactTextResponseInstructions,
  getFinalCheckInInstruction,
  getFinalCheckInResponseInstructions,
  getIdleFollowUpInstruction,
  getIdleFollowUpResponseInstructions,
  getOpeningGreetingInstructions,
  getProfileConfirmationPrompt,
  getRetryAcceptedUserTurnPrompt,
  getVoiceSessionStartedPrompt,
} from "./prompt";
import type {
  BrowserTranscriptGuardContext,
  CallTranscriptEntry,
  RetailReservationDetails,
  TwilioMonitorEvent,
} from "./dto";
import {
  getDemoCustomerProfile,
  getDemoRetailAssociatePlaybook,
} from "./dto";
import { RETAIL_STORE_ASSISTANT_USE_CASE } from "@shared/use-cases";
import {
  getDemoConfirmationChannel,
  sendReservationConfirmationEmail,
} from "./reservation-delivery";
import {
  ACCEPTED_USER_TURN_RESPONSE_TIMEOUT_MS,
  BROWSER_END_CALL_FALLBACK_MS,
  BROWSER_END_CALL_MAX_WAIT_MS,
  END_CALL_FALLBACK_RECHECK_MS,
  POST_RESPONSE_IDLE_FOLLOWUP_MS,
  REALTIME_TRANSCRIPTION_LANGUAGE,
  REALTIME_TRANSCRIPTION_MODEL,
  RETAIL_VOICE_PRODUCT_TERMS,
  TRANSCRIPT_CORRECTION_MODEL,
  TWILIO_ASSISTANT_ECHO_MATCH_MS,
  TWILIO_END_CALL_FALLBACK_MS,
  TWILIO_END_CALL_MAX_WAIT_MS,
  TWILIO_TRANSCRIPT_ECHO_GUARD_MS,
  VOICE_PROVISIONAL_BARGE_IN_RELEASE_MS,
} from "./runtime_constants";
import {
  isAssistantWaitingForCallerAnswerTranscript,
  isAnythingElseCheckInTranscript,
  isIncompleteUserRequestTranscript,
} from "./answer-intent";
import {
  canEndCallFromUserTranscript,
  getAcceptedUserTurnDecision,
  getAssistantTranscriptEffects,
  isAssistantClosingTranscript,
  isEndCallIntent,
} from "./voice_runtime";

const twilioMonitorClients = new Map<string, Set<WebSocket>>();

function normalizeTranscript(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?,\s]+$/g, "");
}

function normalizeIntentText(text: string): string {
  return normalizeTranscript(text)
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getReservationDetails(data: unknown): RetailReservationDetails | null {
  if (!data || typeof data !== "object") return null;
  const value = data as any;
  const item = value.item || {};
  const itemName = String(item.name || value.reservedItem || value.product || "").trim();
  const store = String(value.store || value.reservedStore || "").trim();
  const pickupTime = String(value.pickupTime || "").trim();
  if (!itemName && !store && !pickupTime) return null;

  return {
    customerName: String(value.customerName || getDemoRetailAssociatePlaybook().customerName),
    itemName: itemName || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook.reservedItem,
    itemDetails: [
      itemName || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook.reservedItem,
      item.sku ? `SKU ${item.sku}` : "",
      item.price ? `Price ${item.price}` : "",
    ].filter(Boolean).join(" | "),
    store: store || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook.reservedStore,
    pickupTime: pickupTime || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook.pickupTime,
    reservationId: String(value.reservationId || `RSV-430-${getDemoCustomerProfile().firstName.toUpperCase()}`),
  };
}

function getRecommendedUpsell(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const value = data as any;
  return String(value.recommendation?.name || value.recommendedUpsell || "").trim();
}

function addBrowserProfileConfirmationGuard(result: ToolExecutionResult): ToolExecutionResult {
  const guardInstruction =
    "Browser ASR before profile confirmation is unverified. Do not resume or act on any product, category, store, pickup time, or shopping intent that appeared only before this confirmation. Ask the caller what they need now unless they repeated the request after confirming their name. Do not call retail_search_products based only on pre-confirmation browser transcript text.";
  return {
    ...result,
    result: result.result
      ? `${result.result} ${guardInstruction}`
      : guardInstruction,
    data: {
      ...(result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : {}),
      browserPostConfirmationInstruction: guardInstruction,
    },
  };
}

async function addProfileContextBundle(
  result: ToolExecutionResult,
  args: Record<string, any>,
  options: { includeBrowserGuard?: boolean } = {}
): Promise<{
  result: ToolExecutionResult;
  historyResult: ToolExecutionResult;
  contextResult: ToolExecutionResult;
}> {
  const baseResult = options.includeBrowserGuard ? addBrowserProfileConfirmationGuard(result) : result;
  const data = baseResult.data && typeof baseResult.data === "object" ? baseResult.data as Record<string, any> : {};
  const customerId = String(data.customerId || args.customerId || getDemoCustomerProfile().customerId);
  const customerName = String(data.customerName || args.customerName || getDemoCustomerProfile().name);
  const phone = typeof args.phone === "string" ? args.phone : undefined;
  const historyResult = await executeTool("retail_user_history_lookup", {
    customerId,
    conversationLimit: 500,
  });
  const contextResult = await executeTool("retail_get_customer_context", {
    customerName,
    phone,
  });

  return {
    historyResult,
    contextResult,
    result: {
      ...baseResult,
      result: [
        `Profile confirmed for ${customerName}.`,
        "Customer history and context are loaded.",
        "Respond once, briefly acknowledge the caller, and continue with the current request.",
        "Do not mention profile verification, internal lookups, tools, or history loading.",
        options.includeBrowserGuard
          ? "If the shopping intent appeared only before profile confirmation, ask one concise clarification instead of acting on it."
          : "",
      ].filter(Boolean).join(" "),
      data: {
        ...data,
        profileContextBundled: true,
        history: historyResult.data,
        customerContext: contextResult.data,
      },
      durationMs:
        (baseResult.durationMs || 0) +
        (historyResult.durationMs || 0) +
        (contextResult.durationMs || 0),
    },
  };
}

function getRetailToolEventType(
  toolName: string
): "identityVerificationSent" | "identityVerified" | "customerContextLoaded" | "inventoryUpdated" | "recommendationCreated" | "reservationCreated" | "associateHandoffCreated" | null {
  switch (toolName) {
    case "retail_confirm_profile":
      return "identityVerified";
    case "retail_get_customer_context":
      return "customerContextLoaded";
    case "retail_lookup_inventory":
      return "inventoryUpdated";
    case "retail_recommend_gift_accessory":
      return "recommendationCreated";
    case "retail_reserve_item":
      return "reservationCreated";
    default:
      return null;
  }
}

function hasActiveShoppingIntent(text: string): boolean {
  const normalized = normalizeTranscript(text)
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ");
  if (!normalized || isEndCallIntent(normalized)) return false;

  return (
    /\b(i|we)\s+(still\s+)?(need|want|would like|am looking for|are looking for|looking for|need to find|want to find)\b/.test(normalized) ||
    /\b(no|not)\b.*\b(need|want|looking for|interested in)\b/.test(normalized) ||
    /\b(what else|something else|anything similar|other options|alternatives|alternative|different one|another one|newer|better|larger|smaller|more powerful)\b/.test(normalized) ||
    /\b(do you have|have any|can you check|could you check|check whether|is it in stock|in stock|available|availability|inventory|reserve|hold|pickup|store)\b/.test(normalized)
  );
}

function createEndCallResult(reason: string): { success: boolean; result: string; data: { reason: string } } {
  const cleanedReason = reason.trim() || "User asked to end the call";
  return {
    success: true,
    result: `Ending the active voice call. Reason: ${cleanedReason}`,
    data: { reason: cleanedReason },
  };
}

function createRejectedEndCallResult(
  reason: string,
  lastUserTranscript: string
): { success: false; result: string; error: string; data: { reason: string; lastUserTranscript: string } } {
  const cleanedReason = reason.trim() || "End-call request rejected";
  const cleanedTranscript = lastUserTranscript.trim();
  const message =
    "End-call rejected because the caller is still asking for product or inventory help. Continue assisting, offer alternatives, or ask one concise follow-up.";
  return {
    success: false,
    result: message,
    error: message,
    data: {
      reason: cleanedReason,
      lastUserTranscript: cleanedTranscript,
    },
  };
}

function createNeedsCheckInEndCallResult(
  reason: string,
  lastUserTranscript: string
): { success: false; result: string; error: string; data: { reason: string; lastUserTranscript: string; requiredCheckIn: string } } {
  const cleanedReason = reason.trim() || "End-call request requires final check-in";
  const cleanedTranscript = lastUserTranscript.trim();
  const message = `Before ending the call, ask exactly: "${FINAL_CHECK_IN_TEXT}" Do not call voice_end_call yet.`;
  return {
    success: false,
    result: message,
    error: message,
    data: {
      reason: cleanedReason,
      lastUserTranscript: cleanedTranscript,
      requiredCheckIn: FINAL_CHECK_IN_TEXT,
    },
  };
}

function isCompleteInitialIntentTranscript(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (!normalized) return false;
  if (isIncompleteUserRequestTranscript(text)) return false;
  if (isBriefGreetingTranscript(text) || isBriefButValidTranscript(text)) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length >= 3;
}

function shouldRequestProfileConfirmation(
  text: string,
  options: { candidateAvailable: boolean; confirmationAsked: boolean; confirmed: boolean }
): boolean {
  return (
    options.candidateAvailable &&
    !options.confirmationAsked &&
    !options.confirmed &&
    isCompleteInitialIntentTranscript(text)
  );
}

function hasMostlyNonLatinLetters(text: string): boolean {
  const latinLetters = text.match(/[A-Za-z]/g)?.length || 0;
  const nonAsciiChars = text.match(/[\u0080-\uFFFF]/g)?.length || 0;
  const signalChars = latinLetters + nonAsciiChars;
  if (signalChars < 3) return false;

  return latinLetters / signalChars < 0.6;
}

function hasSpanishMarkers(text: string): boolean {
  const normalized = normalizeTranscript(text)
    .replace(/[¿¡]/g, "")
    .replace(/\s+/g, " ");
  return /\b(hola|gracias|llamar|ayudar|puedo|quieres|necesitas|tienda|producto|disponible|claro|buenos|buenas)\b/.test(normalized);
}

function isUnexpectedNonEnglishAssistantOutput(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return hasMostlyNonLatinLetters(trimmed) || hasSpanishMarkers(trimmed);
}

function hasCallerFacingInternalLeak(text: string): boolean {
  const normalized = normalizeTranscript(text)
    .replace(/['’]/g, "")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ");
  return /\b(demo|use case|scripted|script|prompt|hidden instruction|internal objective|private objective|operator objective|private operator|internal context|caller facing language|sample inventory|test data|test environment|system setup)\b/.test(normalized);
}

function isUnsafeAssistantOutput(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return isUnexpectedNonEnglishAssistantOutput(trimmed) || hasCallerFacingInternalLeak(trimmed);
}

function isBriefButValidTranscript(text: string): boolean {
  const normalized = normalizeTranscript(text)
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ");
  return /^(yes|yeah|yep|no|nope|ok|okay|sure|thanks|thank you|sorry|sorry what|what|wait|hold on|hang on|one sec|one second|actually|no wait|hello|hi|hey|repeat that|can you repeat|mhm|mmhm|mm hmm|hmm)$/.test(normalized);
}

function isClearShortConfirmationTranscript(text: string): boolean {
  const normalized = normalizeIntentText(text);
  return /^(yes|yeah|yep|yup|sure|ok|okay|great|perfect|sounds good|that sounds good|that sounds great|thats good|thats great|that works|works for me|lets do it|let us do it|do it|go ahead|please do|yes please|yeah sure|sure that works|yeah that works)$/.test(normalized);
}

function isBriefGreetingTranscript(text: string): boolean {
  const normalized = normalizeIntentText(text);
  return /^(hi|hello|hey|hi there|hello there|hey there|welcome|welcome back|hello welcome|hello welcome back|hello welcome to|hello welcome to acme|hello welcome to acme electronics|welcome to acme|welcome to acme electronics)$/.test(normalized);
}

function isProfileNameConfirmationTurn(lastAssistantTranscript?: string): boolean {
  const normalized = normalizeIntentText(lastAssistantTranscript || "");
  return /\b(confirm|verify)\b/.test(normalized) && /\b(first and last name|last name|name)\b/.test(normalized);
}

function applyDemoNameTranscriptCorrection(text: string, lastAssistantTranscript?: string): string {
  if (!isProfileNameConfirmationTurn(lastAssistantTranscript)) return text;
  const profile = getDemoCustomerProfile();
  const normalized = normalizeIntentText(text);
  const firstNamePattern = /\b(mayada|maya da|myada|myata|mayata|mayeda|maeda|mayra|mayyada)\b/;
  const lastNamePattern = /\b(abdel\s*rahman|abdelrahman|abdul\s*rahman|abdulrahman|abdel\s*rahmen|abdul\s*rahmen)\b/;

  const firstMatched = firstNamePattern.test(normalized);
  const lastMatched = lastNamePattern.test(normalized);
  if (firstMatched && lastMatched) return profile.name;
  if (firstMatched && !lastMatched) return profile.firstName;
  if (!firstMatched && lastMatched) return profile.lastName;
  return text;
}

function isImmediateBargeInTranscript(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (!normalized) return false;
  if (isEndCallIntent(normalized)) return true;
  return /^(yes|yeah|yep|no|nope|nah|ok|okay|sure|stop|wait|hold on|hang on|one sec|one second|actually|no wait|repeat that|can you repeat|sorry|sorry what|what)$/.test(normalized);
}

function hasEnoughTranscriptForProvisionalBargeIn(text: string, options?: { allowBriefValid?: boolean }): boolean {
  const normalized = normalizeIntentText(text);
  if (!normalized) return false;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 2) return true;
  if (isImmediateBargeInTranscript(normalized)) return true;
  return Boolean(options?.allowBriefValid && isBriefButValidTranscript(normalized) && !isBriefGreetingTranscript(normalized));
}

function isLikelyAssistantGreetingEchoTranscript(userText: string, assistantText: string): boolean {
  const normalized = normalizeIntentText(userText);
  if (!normalized) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  if (!/\b(hi|hello|hey|welcome)\b/.test(normalized)) return false;
  if (isBriefGreetingTranscript(normalized)) return true;

  const assistantNormalized = normalizeIntentText(assistantText);
  if (!assistantNormalized || !/\b(hello|welcome|acme|electronics)\b/.test(assistantNormalized)) return false;

  const assistantTokens = new Set(tokenizeTranscript(assistantNormalized));
  const shared = tokenizeTranscript(normalized).filter((token) => assistantTokens.has(token)).length;
  return shared >= 2 || (shared >= 1 && /\b(welcome|acme|electronics)\b/.test(normalized));
}

function isLikelyVerificationCodeTranscript(text: string): boolean {
  const digitWords = new Set([
    "zero",
    "oh",
    "o",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
  ]);
  const tokens = normalizeTranscript(text)
    .replace(/[-,]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);
  if (tokens.length < 4 || tokens.length > 12) return false;
  return tokens.every((token) => /^\d+$/.test(token) || digitWords.has(token));
}

function isLikelyGibberishTranscript(text: string): boolean {
  const words = normalizeTranscript(text)
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);
  if (words.length !== 1) return false;

  const token = words[0];
  if (token.length < 12) return false;
  if (RETAIL_VOICE_PRODUCT_TERMS.has(token)) return false;
  if (/(phone|tablet|laptop|watch|charger|headphone|earbud|accessor|reservation|availability|direction)/.test(token)) return false;

  return true;
}

function isConstrainedRetailAnswerTurn(lastAssistantTranscript?: string): boolean {
  const normalized = normalizeIntentText(lastAssistantTranscript || "");
  if (!normalized) return false;
  const asksForChoice = /\b(which one|which option|which product|which store|what store|pick up from|pickup from)\b/.test(normalized);
  const offeredProductChoice =
    /\b(sony|bose|quietcomfort|wh 1000xm5)\b/.test(normalized) &&
    /\b(which|option|one)\b/.test(normalized);
  return (
    asksForChoice ||
    offeredProductChoice
  );
}

function isPlausibleConstrainedRetailAnswerTranscript(text: string, lastAssistantTranscript?: string): boolean {
  if (!isConstrainedRetailAnswerTurn(lastAssistantTranscript)) return false;
  const normalized = normalizeIntentText(text);
  if (!normalized || isBriefGreetingTranscript(normalized) || isEndCallIntent(normalized)) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  if (/\b(which|what|where|would|could|should|can|do|does|did|are|you|your|like|want|need|prefer)\b/.test(normalized)) {
    return false;
  }
  if (/\b(option|product|store|pickup|pick up|available|inventory|stock)\b/.test(normalized) && words.length <= 2) {
    return false;
  }

  return true;
}

function applyConstrainedRetailTranscriptCorrection(text: string, lastAssistantTranscript?: string): string {
  const nameCorrected = applyDemoNameTranscriptCorrection(text, lastAssistantTranscript);
  if (nameCorrected !== text) return nameCorrected;
  if (!isConstrainedRetailAnswerTurn(lastAssistantTranscript)) return text;
  const assistant = normalizeIntentText(lastAssistantTranscript || "");
  let corrected = text;

  if (/\bbose\b/.test(assistant)) {
    corrected = corrected.replace(/\b(bosch|boss)\b/gi, "Bose");
  }
  if (/\bfremont\b/.test(assistant)) {
    corrected = corrected
      .replace(/\bpre[-\s]?moisture\b/gi, "Fremont")
      .replace(/\bfree[-\s]?moisture\b/gi, "Fremont")
      .replace(/\bfree\s+mont\b/gi, "Fremont")
      .replace(/\bfreemont\b/gi, "Fremont");
  }

  return corrected;
}

function shouldReviewUserTranscript(
  text: string,
  context: { lastAssistantTranscript?: string } = {}
): boolean {
  const trimmed = text.trim();
  const normalized = normalizeTranscript(trimmed);
  if (!normalized || isEndCallIntent(trimmed)) return false;
  if (isBriefButValidTranscript(trimmed)) return false;
  if (isClearShortConfirmationTranscript(trimmed)) return false;
  if (isLikelyVerificationCodeTranscript(trimmed)) return false;
  if (isConstrainedRetailAnswerTurn(context.lastAssistantTranscript)) {
    const wordCount = normalizeIntentText(trimmed).split(/\s+/).filter(Boolean).length;
    if (wordCount <= 16) return true;
  }
  if (
    hasMostlyNonLatinLetters(trimmed) ||
    hasSpanishMarkers(trimmed) ||
    isLikelyGibberishTranscript(trimmed)
  ) return true;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 1 && /^(simon|jose|bargoni|morcelemoscrat)\b/.test(normalized)) return true;
  return false;
}

function fallbackTranscriptReview(
  textForReview: string,
  hasContextCorrection: boolean,
  context: { lastAssistantTranscript?: string } = {}
): { action: "keep" | "replace" | "suppress"; text: string } {
  if (hasContextCorrection) return { action: "replace", text: textForReview };
  if (isConstrainedRetailAnswerTurn(context.lastAssistantTranscript)) {
    return { action: "keep", text: textForReview };
  }
  if (
    hasMostlyNonLatinLetters(textForReview) ||
    hasSpanishMarkers(textForReview) ||
    isLikelyGibberishTranscript(textForReview)
  ) {
    return { action: "suppress", text: "" };
  }
  return { action: "keep", text: textForReview };
}

export async function reviewEnglishUserTranscript(
  rawText: string,
  context: { agentName: string; lastAssistantTranscript?: string; lastUserTranscript?: string }
): Promise<{ action: "keep" | "replace" | "suppress"; text: string }> {
  const trimmed = rawText.trim();
  if (!trimmed) return { action: "suppress", text: "" };
  const contextCorrected = applyConstrainedRetailTranscriptCorrection(trimmed, context.lastAssistantTranscript);
  const hasContextCorrection = normalizeIntentText(contextCorrected) !== normalizeIntentText(trimmed);
  const textForReview = hasContextCorrection ? contextCorrected : trimmed;
  const suspicious = shouldReviewUserTranscript(textForReview, context);
  if (!suspicious) {
    return hasContextCorrection ? { action: "replace", text: textForReview } : { action: "keep", text: trimmed };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return fallbackTranscriptReview(textForReview, hasContextCorrection, context);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TRANSCRIPT_CORRECTION_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: TRANSCRIPT_REVIEW_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify({
              agentName: context.agentName,
              lastAssistantTranscript: context.lastAssistantTranscript || "",
              lastUserTranscript: context.lastUserTranscript || "",
              rawTranscript: textForReview,
              originalRawTranscript: trimmed,
              retailVocabulary: buildRetailTranscriptionKeywords(),
            }),
          },
        ],
      }),
    });

    if (!response.ok) return fallbackTranscriptReview(textForReview, hasContextCorrection, context);
    const data = await response.json() as any;
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    const action = parsed.action === "replace" || parsed.action === "suppress" ? parsed.action : "keep";
    const corrected = String(parsed.text || "").trim();
    const rawWordCount = normalizeTranscript(textForReview).split(/\s+/).filter(Boolean).length;
    const correctedWordCount = normalizeTranscript(corrected).split(/\s+/).filter(Boolean).length;
    if (action === "suppress" || !corrected) return { action: "suppress", text: "" };
    if (isUnexpectedNonEnglishAssistantOutput(corrected)) return { action: "suppress", text: "" };
    if (isLikelyGibberishTranscript(corrected)) return { action: "suppress", text: "" };
    if (action === "replace") {
      if (normalizeTranscript(corrected) === normalizeTranscript(trimmed)) return { action: "keep", text: trimmed };
      if (normalizeTranscript(corrected) === normalizeTranscript(textForReview) && hasContextCorrection) {
        return { action: "replace", text: textForReview };
      }
      if (correctedWordCount > rawWordCount + 2) {
        return { action: "suppress", text: "" };
      }
    }
    if (action === "keep" && hasContextCorrection) return { action: "replace", text: textForReview };
    return { action, text: corrected };
  } catch {
    return fallbackTranscriptReview(textForReview, hasContextCorrection, context);
  }
}

function tokenizeTranscript(text: string): string[] {
  return normalizeTranscript(text)
    .split(/[^a-z0-9']+/i)
    .map((token) => token.replace(/^'+|'+$/g, ""))
    .filter((token) => token.length > 2);
}

function hasHighAssistantEchoOverlap(userText: string, assistantText: string): boolean {
  const userTokens = new Set(tokenizeTranscript(userText));
  const assistantTokens = new Set(tokenizeTranscript(assistantText));
  if (userTokens.size < 3 || assistantTokens.size < 3) {
    if (userTokens.size === 0 || assistantTokens.size === 0) return false;
    let shortShared = 0;
    for (const token of Array.from(userTokens)) {
      if (assistantTokens.has(token)) shortShared++;
    }
    return shortShared === userTokens.size;
  }

  let shared = 0;
  for (const token of Array.from(userTokens)) {
    if (assistantTokens.has(token)) shared++;
  }

  return shared / userTokens.size >= 0.75;
}

function isLikelyAssistantEchoTranscript(userText: string, assistantText: string): boolean {
  const normalizedUser = normalizeTranscript(userText)
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ");
  const normalizedAssistant = normalizeTranscript(assistantText)
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ");
  if (!normalizedUser || !normalizedAssistant) return false;

  const userWords = normalizedUser.split(/\s+/).filter(Boolean);
  if (userWords.length <= 5 && hasHighAssistantEchoOverlap(normalizedUser, normalizedAssistant)) {
    return true;
  }

  return normalizedAssistant.includes(normalizedUser) || hasHighAssistantEchoOverlap(normalizedUser, normalizedAssistant);
}

function isLikelyBiasedProductHallucinationDuringPlayback(userText: string, assistantText: string): boolean {
  const normalizedUser = normalizeTranscript(userText)
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ");
  if (!normalizedUser) return false;
  if (!/\b(do you have|have any|in stock|available|availability|reserve|order|buy)\b/.test(normalizedUser)) {
    return false;
  }
  if (!/\b(bose|quietcomfort|sony|wh\s*1000|xm5)\b/.test(normalizedUser)) {
    return false;
  }

  const normalizedAssistant = normalizeTranscript(assistantText)
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ");
  return !/\b(bose|quietcomfort|sony|wh\s*1000|xm5)\b/.test(normalizedAssistant);
}

export function shouldSuppressTwilioUserTranscript(
  text: string,
  context: {
    lastAssistantAudioAt: number;
    lastAssistantDoneAt: number;
    lastAssistantTranscript: string;
    twilioResponseActive: boolean;
  }
): boolean {
  const normalized = normalizeTranscript(text);
  if (!normalized) return true;

  const now = Date.now();
  const recentAssistant =
    now - context.lastAssistantDoneAt < TWILIO_ASSISTANT_ECHO_MATCH_MS ||
    now - context.lastAssistantAudioAt < TWILIO_ASSISTANT_ECHO_MATCH_MS ||
    context.twilioResponseActive;
  if (recentAssistant && isBriefGreetingTranscript(normalized)) {
    return true;
  }
  if (isPlausibleConstrainedRetailAnswerTranscript(normalized, context.lastAssistantTranscript)) {
    return false;
  }
  if (
    recentAssistant &&
    context.lastAssistantTranscript &&
    isLikelyAssistantGreetingEchoTranscript(normalized, context.lastAssistantTranscript)
  ) {
    return true;
  }
  if (
    recentAssistant &&
    context.lastAssistantTranscript &&
    isLikelyAssistantEchoTranscript(normalized, context.lastAssistantTranscript)
  ) {
    return true;
  }

  const justAfterAssistant =
    now - context.lastAssistantDoneAt < TWILIO_TRANSCRIPT_ECHO_GUARD_MS ||
    now - context.lastAssistantAudioAt < TWILIO_TRANSCRIPT_ECHO_GUARD_MS;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (justAfterAssistant && words.length <= 2 && !isBriefButValidTranscript(normalized)) {
    return true;
  }

  return false;
}

export function shouldSuppressBrowserUserTranscript(
  text: string,
  context: BrowserTranscriptGuardContext
): boolean {
  const recentAssistant = context.responseActive || context.browserPlaybackActive;
  if (
    recentAssistant &&
    isLikelyBiasedProductHallucinationDuringPlayback(text, context.lastAssistantTranscript)
  ) {
    return true;
  }

  return shouldSuppressTwilioUserTranscript(text, {
    lastAssistantAudioAt: context.lastAssistantAudioAt,
    lastAssistantDoneAt: context.lastAssistantDoneAt,
    lastAssistantTranscript: context.lastAssistantTranscript,
    twilioResponseActive: context.responseActive || context.browserPlaybackActive,
  });
}

export function attachVoiceAgentWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    console.log(`[WebSocket] Upgrade request received for URL: ${request.url}`);
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (url.pathname === "/ws/twilio-stream" || url.pathname === "/ws/twilio-monitor" || url.pathname === "/ws/voice-agent") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        console.log(`[WebSocket] Connection established for ${url.pathname}`);
        if (url.pathname === "/ws/twilio-stream") {
          handleTwilioSession(ws);
        } else if (url.pathname === "/ws/twilio-monitor") {
          handleTwilioMonitorSession(ws, url);
        } else {
          handleBrowserSession(ws);
        }
      });
    } else {
      // Let other handlers (like Vite HMR) process this
      return;
    }
  });
}

function normalizeTwilioAgentId(agentId: unknown): string {
  if (typeof agentId !== "string" || !agentId.trim()) return "default";
  return agentId.trim();
}

function sendTwilioMonitorEvent(agentId: string, event: TwilioMonitorEvent): void {
  const monitorAgentIds = agentId === "default" ? ["default"] : [agentId, "default"];
  for (const monitorAgentId of monitorAgentIds) {
    const clients = twilioMonitorClients.get(monitorAgentId);
    if (!clients) continue;
    for (const client of Array.from(clients)) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(event));
      } else {
        clients.delete(client);
      }
    }
  }
}

function handleTwilioMonitorSession(ws: WebSocket, url: URL): void {
  const agentId = normalizeTwilioAgentId(url.searchParams.get("agentId"));
  const clients = twilioMonitorClients.get(agentId) || new Set<WebSocket>();
  clients.add(ws);
  twilioMonitorClients.set(agentId, clients);

  ws.send(JSON.stringify({ type: "connected", agentId } satisfies TwilioMonitorEvent));
  ws.on("close", () => {
    clients.delete(ws);
    if (clients.size === 0) {
      twilioMonitorClients.delete(agentId);
    }
  });
}

function handleTwilioSession(ws: WebSocket): void {
  console.log("[TwilioSession] New session started");
  let openai: OpenAIRealtimeClient | null = null;
  let streamSid: string | null = null;
  let activeCallSid: string | null = null;
  let monitorAgentId = "default";
  let agentName = "Store Assistant";
  let lastAssistantTranscript = "";
  let lastUserTranscript = "";
  let suppressAssistantOutput = false;
  let assistantTranscriptGuard = "";
  let callEndedSent = false;
  let pendingEndCall = false;
  let endingCall = false;
  let endCallTimer: ReturnType<typeof setTimeout> | null = null;
  let lastItemId: string | null = null;
  let currentTwilioItemId: string | null = null;
  let currentTwilioAudioSentMs = 0;
  let lastAssistantAudioAt = 0;
  let lastAssistantDoneAt = 0;
  let responseStartTs: number | null = null;
  let latestTs = 0;
  let markQueue: string[] = [];
  let callStartedAt: number | null = null;
  let callSid: string | undefined;
  let callerPhone = "Unknown";
  let latestReservation: RetailReservationDetails | null = null;
  let latestRecommendedUpsell = "";
  let inventoryLookupSucceeded = false;
  let startupRetailContext = "";
  let twilioResponseActive = false;
  let idleFollowUpTimer: ReturnType<typeof setTimeout> | null = null;
  let userTurnResponseTimer: ReturnType<typeof setTimeout> | null = null;
  let idleFollowUpSent = false;
  let assistantTurnCount = 0;
  let pendingTwilioUserSpeechStartedAt: number | null = null;
  let pendingTwilioUserSpeechAudioStartMs: number | null = null;
  let pendingTwilioUserSpeechItemId: string | null = null;
  let twilioTranscriptPreview = "";
  let pendingTwilioClosingReason: string | null = null;
  let pendingTwilioFinalCheckInReason: string | null = null;
  let pendingTwilioAddOnCheckInText: string | null = null;
  let twilioProfileCandidateAvailable = false;
  let twilioProfileConfirmationAsked = false;
  let twilioProfileConfirmed = false;
  let twilioFinalCheckInAsked = false;
  let twilioPendingAddOnOffer = false;
  let twilioPendingPickupProposal = false;
  let twilioEndCallFallbackStartedAt: number | null = null;
  let provisionalTwilioBargeInActive = false;
  let provisionalTwilioBargeInReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  const transcriptEntries: CallTranscriptEntry[] = [];

  ws.on("message", async (raw) => {
    const msg = JSON.parse(raw.toString());

    switch (msg.event) {
      case "start": {
        streamSid = msg.start.streamSid;
        const params = msg.start.customParameters || {};
        const agentId = normalizeTwilioAgentId(params.agentId);
        monitorAgentId = agentId;
        callStartedAt = Date.now();
        callSid = msg.start.callSid;
        activeCallSid = typeof callSid === "string" ? callSid : null;

        let instructions = "";
        let voice = "marin";
        let language = "en-US";
        agentName = "Store Assistant";
        lastAssistantTranscript = "";
        lastUserTranscript = "";
        suppressAssistantOutput = false;
        pendingTwilioClosingReason = null;
        pendingTwilioFinalCheckInReason = null;
        pendingTwilioAddOnCheckInText = null;
        twilioProfileCandidateAvailable = false;
        twilioProfileConfirmationAsked = false;
        twilioProfileConfirmed = false;
        twilioFinalCheckInAsked = false;
        twilioPendingAddOnOffer = false;
        twilioPendingPickupProposal = false;
        twilioEndCallFallbackStartedAt = null;
        pendingTwilioUserSpeechStartedAt = null;
        pendingTwilioUserSpeechAudioStartMs = null;
        pendingTwilioUserSpeechItemId = null;
        twilioTranscriptPreview = "";
        provisionalTwilioBargeInActive = false;
        clearProvisionalTwilioBargeInRelease();
        clearTwilioUserTurnResponseWatchdog();
        callerPhone = typeof params.callerPhone === "string" && params.callerPhone.trim()
          ? params.callerPhone.trim()
          : "Unknown";
        latestReservation = null;
        latestRecommendedUpsell = "";
        const smsRecipientPhone = resolveDemoSmsRecipientPhone(callerPhone);
        const canSendCallerSummarySms = canSendCallSummarySms(callerPhone);

        if (agentId && agentId !== "default") {
          let resolvedAgentId = agentId;
          let agent = await storage.getAgent(1);
          if (agent) {
            resolvedAgentId = "1";
            monitorAgentId = "1";
          } else {
            agent = await storage.getAgent(parseInt(agentId));
          }
          if (agent) {
            agentName = agent.name;
            voice = resolveRealtimeVoice(agent.voiceModel, agent.gender);
            language = agent.language || language;
            monitorAgentId = resolvedAgentId;
          }
        }

        sendTwilioMonitorEvent(monitorAgentId, {
          type: "callStarted",
          agentId: monitorAgentId,
          callSid,
          streamSid: streamSid || undefined,
          callerPhone: callerPhone !== "Unknown" ? callerPhone : undefined,
          timestamp: Date.now(),
        });

        startupRetailContext = callerPhone !== "Unknown" ? await runStartupRetailProfileLookup() : "";
        const returningCallerName = startupRetailContext ? getDemoCustomerProfile().firstName : undefined;
        twilioProfileCandidateAvailable = Boolean(startupRetailContext);

        instructions = buildOpenAIVoiceAgentInstructions({
          callerPhone,
          confirmationSpokenRoute: getDemoConfirmationChannel(),
          canSendCallerSummarySms,
          returningCallerName,
          startupRetailContext,
        });

        const tools = buildRealtimeVoiceTools({
          smsEnabled: canUseDemoSms(),
          callerSummarySmsEnabled: canSendCallerSummarySms,
        });

        openai = new OpenAIRealtimeClient(process.env.OPENAI_API_KEY || "", buildPhoneRealtimeConfig({
          instructions,
          voice,
          transcriptionLanguage: REALTIME_TRANSCRIPTION_LANGUAGE,
          transcriptionModel: REALTIME_TRANSCRIPTION_MODEL,
          retailTranscriptionKeywords: buildRetailTranscriptionKeywords(),
          tools,
        }));

        openai.on("audio", (base64: string, itemId: string) => {
          if (suppressAssistantOutput) return;
          lastAssistantAudioAt = Date.now();
          lastItemId = itemId;
          if (itemId && itemId !== currentTwilioItemId) {
            currentTwilioItemId = itemId;
            currentTwilioAudioSentMs = 0;
          }
          currentTwilioAudioSentMs += getG711DurationMs(base64, TWILIO_G711_SAMPLE_RATE);
          if (responseStartTs === null) responseStartTs = latestTs;
          ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: base64 } }));
          const markName = `m-${Date.now()}`;
          ws.send(JSON.stringify({ event: "mark", streamSid, mark: { name: markName } }));
          markQueue.push(markName);
        });

        openai.on("userSpeechStarted", (event: RealtimeSpeechEvent = {}) => {
          clearTwilioIdleFollowUp();
          idleFollowUpSent = false;
          // Track possible speech, but only cut audio once transcript text looks non-echo.
          pendingTwilioUserSpeechStartedAt = Date.now();
          pendingTwilioUserSpeechAudioStartMs = typeof event.audio_start_ms === "number" ? event.audio_start_ms : null;
          pendingTwilioUserSpeechItemId = typeof event.item_id === "string" ? event.item_id : null;
          twilioTranscriptPreview = "";
          if (hasActiveTwilioAssistantPlayback()) {
            console.debug("[VoiceAgent/Twilio] Candidate barge-in speech started", {
              itemId: pendingTwilioUserSpeechItemId,
              audioStartMs: pendingTwilioUserSpeechAudioStartMs,
            });
          }
        });

        openai.on("userTranscriptDelta", (delta: string) => {
          twilioTranscriptPreview += delta || "";
          maybeProvisionallyCutTwilioAssistantPlaybackFromTranscript(twilioTranscriptPreview);
        });

        openai.on("userTranscriptSegment", (text: string) => {
          twilioTranscriptPreview = text || twilioTranscriptPreview;
          maybeProvisionallyCutTwilioAssistantPlaybackFromTranscript(twilioTranscriptPreview);
        });

        const handleTwilioUserTranscript = async (text: string): Promise<void> => {
          console.log(`[VoiceAgent/Twilio] User: ${text}`);
          const trimmed = text.trim();
          if (!trimmed) return;
          if (isIncompleteUserRequestTranscript(trimmed)) {
            console.warn(`[VoiceAgent/Twilio] Suppressed incomplete user request fragment: ${trimmed}`);
            releaseProvisionalTwilioBargeIn();
            clearPendingTwilioUserSpeechCandidate();
            return;
          }
          if (
            shouldSuppressTwilioUserTranscript(trimmed, {
              lastAssistantAudioAt,
              lastAssistantDoneAt,
              lastAssistantTranscript: assistantTranscriptGuard || lastAssistantTranscript,
              twilioResponseActive,
            })
          ) {
            console.warn(`[VoiceAgent/Twilio] Suppressed likely phone-speaker echo transcript: ${trimmed}`);
            releaseProvisionalTwilioBargeIn();
            clearPendingTwilioUserSpeechCandidate();
            return;
          }

          const reviewed = await reviewEnglishUserTranscript(trimmed, {
            agentName,
            lastAssistantTranscript,
            lastUserTranscript,
          });
          if (reviewed.action === "suppress") {
            console.warn(`[VoiceAgent/Twilio] Suppressed suspicious user transcript: ${trimmed}`);
            releaseProvisionalTwilioBargeIn();
            clearPendingTwilioUserSpeechCandidate();
            return;
          }
          if (reviewed.action === "replace") {
            console.warn(`[VoiceAgent/Twilio] Corrected user transcript: "${trimmed}" -> "${reviewed.text}"`);
          }

          lastUserTranscript = reviewed.text;
          transcriptEntries.push({
            role: "Customer",
            text: reviewed.text,
            timestamp: Date.now(),
          });
          sendTwilioMonitorEvent(monitorAgentId, {
            type: "userTranscript",
            agentId: monitorAgentId,
            text: reviewed.text,
            rawText: reviewed.action === "replace" ? trimmed : undefined,
            correctedText: reviewed.action === "replace" ? reviewed.text : undefined,
            corrected: reviewed.action === "replace",
            timestamp: Date.now(),
          });
          releaseProvisionalTwilioBargeIn();
          clearPendingTwilioUserSpeechCandidate();
          const turnDecision = getAcceptedUserTurnDecision({
            text: reviewed.text,
            lastAssistantTranscript,
            pendingAddOnOffer: twilioPendingAddOnOffer,
            pendingPickupProposal: twilioPendingPickupProposal,
            finalCheckInAsked: twilioFinalCheckInAsked,
            profileConfirmationNeeded: shouldRequestProfileConfirmation(reviewed.text, {
              candidateAvailable: twilioProfileCandidateAvailable,
              confirmationAsked: twilioProfileConfirmationAsked,
              confirmed: twilioProfileConfirmed,
            }),
            softDeclineReason: "Caller gave a soft decline before the final anything-else check-in",
            endCallReason: "Caller expressed end-call intent",
          });
          twilioPendingAddOnOffer = turnDecision.pendingAddOnOffer;
          twilioPendingPickupProposal = turnDecision.pendingPickupProposal;
          twilioFinalCheckInAsked = turnDecision.finalCheckInAsked;
          switch (turnDecision.action.type) {
            case "request_profile_confirmation":
              requestTwilioProfileConfirmation(turnDecision.action.initialIntent);
              return;
            case "request_add_on_check_in":
              requestTwilioAddOnAnswerCheckIn(turnDecision.action.text);
              return;
            case "request_final_check_in":
              requestTwilioFinalCheckIn(turnDecision.action.reason);
              return;
            case "request_graceful_end_call":
              requestTwilioGracefulEndCall(turnDecision.action.reason);
              return;
            case "respond":
              respondToAcceptedTwilioUserTurn();
              return;
          }
        };

        openai.on("userTranscript", (text: string) => {
          void handleTwilioUserTranscript(text);
        });

        openai.on("responseStarted", () => {
          clearTwilioUserTurnResponseWatchdog();
          twilioResponseActive = true;
          clearTwilioIdleFollowUp();
          suppressAssistantOutput = false;
          assistantTranscriptGuard = "";
        });

        openai.on("assistantTranscriptDelta", (delta: string) => {
          if (suppressAssistantOutput) return;
          assistantTranscriptGuard += delta || "";
          if (isUnsafeAssistantOutput(assistantTranscriptGuard)) {
            suppressTwilioAssistantResponse("Unsafe assistant output");
          }
        });

        openai.on("assistantTranscriptDone", (text: string) => {
          console.log(`[VoiceAgent/Twilio] Agent: ${text}`);
          const trimmed = text.trim();
          if (suppressAssistantOutput) {
            console.warn(`[VoiceAgent/Twilio] Suppressed assistant output after prior response cancellation: ${trimmed}`);
            return;
          }
          if (isUnsafeAssistantOutput(trimmed)) {
            console.warn(`[VoiceAgent/Twilio] Suppressed unsafe assistant output: ${trimmed}`);
            suppressTwilioAssistantResponse("Unsafe assistant transcript");
            return;
          }
          if (trimmed) {
            assistantTurnCount++;
            lastAssistantDoneAt = Date.now();
            lastAssistantTranscript = trimmed;
            transcriptEntries.push({
              role: "Assistant",
              text: trimmed,
              timestamp: Date.now(),
            });
            sendTwilioMonitorEvent(monitorAgentId, {
              type: "assistantTranscript",
              agentId: monitorAgentId,
              text: trimmed,
              timestamp: Date.now(),
            });
            const transcriptEffects = getAssistantTranscriptEffects(trimmed);
            if (transcriptEffects.pendingAddOnOffer) {
              twilioPendingAddOnOffer = true;
            }
            if (transcriptEffects.profileConfirmationAsked) {
              twilioProfileConfirmationAsked = true;
            }
            if (transcriptEffects.finalCheckInAsked) {
              twilioFinalCheckInAsked = true;
            }
            if (transcriptEffects.deliveredClosing && !pendingEndCall && !endingCall) {
              requestTwilioGracefulEndCall("Assistant delivered closing");
            } else {
              scheduleTwilioIdleFollowUp();
            }
          }
        });

        openai.on("error", (err: Error) => {
          console.error("[VoiceAgent/Twilio] Error:", err.message);
        });

        openai.on("functionCall", async ({ callId, name, arguments: argsString }) => {
          clearTwilioIdleFollowUp();
          console.log(`[VoiceAgent/Twilio] Function call: ${name}`);
          try {
            const args = JSON.parse(argsString);
            if (name === voiceEndCallTool.name) {
              const reason = String(args.reason || "Caller asked to end the call");
              if (hasActiveShoppingIntent(lastUserTranscript)) {
                const rejectedResult = createRejectedEndCallResult(reason, lastUserTranscript);
                console.warn(`[VoiceAgent/Twilio] Rejected premature end-call request:`, rejectedResult);
                sendTwilioMonitorEvent(monitorAgentId, {
                  type: "toolCallStarted",
                  agentId: monitorAgentId,
                  toolName: voiceEndCallTool.name,
                  args: { reason, source: "tool", lastUserTranscript },
                  timestamp: Date.now(),
                });
                sendTwilioMonitorEvent(monitorAgentId, {
                  type: "toolCallCompleted",
                  agentId: monitorAgentId,
                  toolName: voiceEndCallTool.name,
                  success: false,
                  result: rejectedResult.result,
                  error: rejectedResult.error,
                  data: rejectedResult.data,
                  timestamp: Date.now(),
                });
                sendTwilioFunctionOutput(callId, JSON.stringify(rejectedResult));
                return;
              }
              if (
                !isAssistantClosingTranscript(lastAssistantTranscript) &&
                !canEndCallFromUserTranscript(lastUserTranscript, lastAssistantTranscript, twilioFinalCheckInAsked)
              ) {
                const rejectedResult = createNeedsCheckInEndCallResult(reason, lastUserTranscript);
                console.warn(`[VoiceAgent/Twilio] Rejected end-call before final check-in:`, rejectedResult);
                sendTwilioMonitorEvent(monitorAgentId, {
                  type: "toolCallStarted",
                  agentId: monitorAgentId,
                  toolName: voiceEndCallTool.name,
                  args: { reason, source: "tool", lastUserTranscript, requiredCheckIn: FINAL_CHECK_IN_TEXT },
                  timestamp: Date.now(),
                });
                sendTwilioMonitorEvent(monitorAgentId, {
                  type: "toolCallCompleted",
                  agentId: monitorAgentId,
                  toolName: voiceEndCallTool.name,
                  success: false,
                  result: rejectedResult.result,
                  error: rejectedResult.error,
                  data: rejectedResult.data,
                  timestamp: Date.now(),
                });
                sendTwilioFunctionOutput(callId, JSON.stringify(rejectedResult), false);
                requestTwilioFinalCheckIn(reason);
                return;
              }
              const result = createEndCallResult(reason);
              console.log(`[VoiceAgent/Twilio] Function result:`, result);
              sendTwilioFunctionOutput(callId, JSON.stringify(result), false);
              requestTwilioGracefulEndCall(reason, "tool");
              return;
            }

            sendTwilioMonitorEvent(monitorAgentId, {
              type: "toolCallStarted",
              agentId: monitorAgentId,
              toolName: name,
              args,
              timestamp: Date.now(),
            });
            const rawResult = name === "retail_reserve_item" && !inventoryLookupSucceeded
              ? {
                  success: false,
                  error: "Call retail_lookup_inventory successfully before creating a reservation.",
                  result: "Reservation blocked because inventory has not been checked in this call.",
                  data: { product: args.product, store: args.store, requiresInventoryLookup: true },
                }
              : name === twilioCallerSummaryTool.name
                ? await sendCallerSummarySms(args, smsRecipientPhone, monitorAgentId)
              : name === "twilio_sms"
                ? await executeTool(name, withDemoSmsRecipient(args, callerPhone))
                : await executeTool(name, args);
            let result = name === "twilio_sms" || name === twilioCallerSummaryTool.name
              ? sanitizeSmsToolResult(rawResult, latestReservation)
              : rawResult;
            if (result.success && name === "retail_lookup_inventory") {
              inventoryLookupSucceeded = true;
              twilioPendingPickupProposal = true;
            }
            if (result.success && name === "retail_reserve_item") {
              latestReservation = getReservationDetails(result.data);
              twilioPendingPickupProposal = false;
            }
            if (result.success && name === "retail_recommend_gift_accessory") {
              latestRecommendedUpsell = getRecommendedUpsell(result.data);
            }
            let bundledProfileHistoryResult: ToolExecutionResult | null = null;
            let bundledProfileContextResult: ToolExecutionResult | null = null;
            if (result.success && name === "retail_confirm_profile") {
              const bundled = await addProfileContextBundle(result, args);
              result = bundled.result;
              bundledProfileHistoryResult = bundled.historyResult;
              bundledProfileContextResult = bundled.contextResult;
              twilioProfileConfirmed = true;
              twilioProfileConfirmationAsked = true;
            }
            sendTwilioMonitorEvent(monitorAgentId, {
              type: "toolCallCompleted",
              agentId: monitorAgentId,
              toolName: name,
              success: result.success,
              result: result.result,
              error: result.error,
              data: result.data,
              durationMs: result.durationMs,
              timestamp: Date.now(),
            });
            const retailEventType = getRetailToolEventType(name);
            if (retailEventType && result.success && result.data !== undefined) {
              sendTwilioMonitorEvent(monitorAgentId, {
                type: retailEventType,
                agentId: monitorAgentId,
                data: result.data,
                timestamp: Date.now(),
              });
            }
            if (bundledProfileHistoryResult) {
              sendTwilioMonitorEvent(monitorAgentId, {
                type: "toolCallStarted",
                agentId: monitorAgentId,
                toolName: "retail_user_history_lookup",
                args: { customerId: (result.data as any)?.customerId, conversationLimit: 500, bundled: true },
                timestamp: Date.now(),
              });
              sendTwilioMonitorEvent(monitorAgentId, {
                type: "toolCallCompleted",
                agentId: monitorAgentId,
                toolName: "retail_user_history_lookup",
                success: bundledProfileHistoryResult.success,
                result: bundledProfileHistoryResult.result,
                error: bundledProfileHistoryResult.error,
                data: bundledProfileHistoryResult.data,
                durationMs: bundledProfileHistoryResult.durationMs,
                timestamp: Date.now(),
              });
            }
            if (bundledProfileContextResult) {
              sendTwilioMonitorEvent(monitorAgentId, {
                type: "toolCallStarted",
                agentId: monitorAgentId,
                toolName: "retail_get_customer_context",
                args: { customerName: (result.data as any)?.customerName, bundled: true },
                timestamp: Date.now(),
              });
              sendTwilioMonitorEvent(monitorAgentId, {
                type: "toolCallCompleted",
                agentId: monitorAgentId,
                toolName: "retail_get_customer_context",
                success: bundledProfileContextResult.success,
                result: bundledProfileContextResult.result,
                error: bundledProfileContextResult.error,
                data: bundledProfileContextResult.data,
                durationMs: bundledProfileContextResult.durationMs,
                timestamp: Date.now(),
              });
              sendTwilioMonitorEvent(monitorAgentId, {
                type: "customerContextLoaded",
                agentId: monitorAgentId,
                data: bundledProfileContextResult.data,
                timestamp: Date.now(),
              });
            }
            if (result.success && name === "retail_reserve_item" && latestReservation) {
              const accessoryArgs = {
                product: latestReservation.itemName,
                originalRequest: String(args.originalRequest || args.product || latestReservation.itemName),
                store: latestReservation.store,
                customerName: latestReservation.customerName,
                phone: callerPhone !== "Unknown" ? callerPhone : undefined,
                recentConversationSummary: `Customer reserved ${latestReservation.itemName} at ${latestReservation.store} for ${latestReservation.pickupTime}.`,
              };
              sendTwilioMonitorEvent(monitorAgentId, {
                type: "toolCallStarted",
                agentId: monitorAgentId,
                toolName: "retail_recommend_gift_accessory",
                args: accessoryArgs,
                timestamp: Date.now(),
              });
              const accessoryResult = await executeTool("retail_recommend_gift_accessory", accessoryArgs);
              if (accessoryResult.success) {
                latestRecommendedUpsell = getRecommendedUpsell(accessoryResult.data);
              }
              sendTwilioMonitorEvent(monitorAgentId, {
                type: "toolCallCompleted",
                agentId: monitorAgentId,
                toolName: "retail_recommend_gift_accessory",
                success: accessoryResult.success,
                result: accessoryResult.result,
                error: accessoryResult.error,
                data: accessoryResult.data,
                durationMs: accessoryResult.durationMs,
                timestamp: Date.now(),
              });
              if (accessoryResult.success && accessoryResult.data !== undefined) {
                sendTwilioMonitorEvent(monitorAgentId, {
                  type: "recommendationCreated",
                  agentId: monitorAgentId,
                  data: accessoryResult.data,
                  timestamp: Date.now(),
                });
                result = {
                  ...result,
                  result: `${result.result || ""} Accessory recommendation is ready: ${accessoryResult.result || latestRecommendedUpsell}`.trim(),
                  data: {
                    ...(typeof result.data === "object" && result.data ? result.data : {}),
                    accessoryRecommendation: accessoryResult.data,
                  },
                };
              }
            }
            console.log(`[VoiceAgent/Twilio] Function result:`, result);
            if (pendingEndCall || endingCall || suppressAssistantOutput) {
              console.warn(`[VoiceAgent/Twilio] Skipping stale function output for ${name}`);
              return;
            }
            sendTwilioFunctionOutput(callId, JSON.stringify(result));
          } catch (e: any) {
            console.error(`[VoiceAgent/Twilio] Function execution failed:`, e);
            if (pendingEndCall || endingCall || suppressAssistantOutput) return;
            sendTwilioFunctionOutput(callId, JSON.stringify({ success: false, error: e.message }));
          }
        });

        openai.on("responseDone", () => {
          twilioResponseActive = false;
          suppressAssistantOutput = false;
          if (pendingTwilioAddOnCheckInText && !pendingEndCall && !endingCall) {
            startTwilioAddOnAnswerCheckInResponse(pendingTwilioAddOnCheckInText);
            return;
          }
          if (pendingTwilioFinalCheckInReason && !pendingEndCall && !endingCall) {
            startTwilioFinalCheckInResponse(pendingTwilioFinalCheckInReason);
            return;
          }
          if (pendingTwilioClosingReason && pendingEndCall && !endingCall) {
            startTwilioClosingResponse(pendingTwilioClosingReason);
            return;
          }
          maybeCompleteTwilioPendingEndCall("End-call final audio completed");
        });

        openai.on("responseCancelled", () => {
          twilioResponseActive = false;
          suppressAssistantOutput = false;
          if (pendingTwilioAddOnCheckInText && !pendingEndCall && !endingCall) {
            startTwilioAddOnAnswerCheckInResponse(pendingTwilioAddOnCheckInText);
            return;
          }
          if (pendingTwilioFinalCheckInReason && !pendingEndCall && !endingCall) {
            startTwilioFinalCheckInResponse(pendingTwilioFinalCheckInReason);
            return;
          }
          if (pendingTwilioClosingReason && pendingEndCall && !endingCall) {
            startTwilioClosingResponse(pendingTwilioClosingReason);
            return;
          }
          maybeCompleteTwilioPendingEndCall("End-call response cancelled");
        });

        openai.once("sessionReady", () => {
          openai!.triggerResponse({
            input: [
              {
                type: "message",
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: getVoiceSessionStartedPrompt("twilio"),
                  },
                ],
              },
            ],
            output_modalities: ["audio"],
            instructions: getOpeningGreetingInstructions(),
          });
        });

        openai.connect();
        break;
      }
      case "media":
        latestTs = parseInt(msg.media.timestamp);
        openai?.appendAudio(msg.media.payload);
        break;
      case "mark":
        markQueue.shift();
        maybeCompleteTwilioPendingEndCall("End-call audio played");
        break;
      case "stop":
        clearTwilioUserTurnResponseWatchdog();
        openai?.close();
        sendCallEnded();
        break;
    }
  });

  ws.on("close", () => {
    clearTwilioIdleFollowUp();
    clearTwilioUserTurnResponseWatchdog();
    clearProvisionalTwilioBargeInRelease();
    openai?.close();
    sendCallEnded();
  });

  function sendCallEnded(): void {
    if (callEndedSent) return;
    callEndedSent = true;
    const endedAt = Date.now();
    void (async () => {
      await sendOrderConfirmation();
      await sendStoreManagerSummary(endedAt);
      sendTwilioMonitorEvent(monitorAgentId, {
        type: "callEnded",
        agentId: monitorAgentId,
        timestamp: Date.now(),
      });
    })();
  }

  async function sendStoreManagerSummary(endedAt: number): Promise<void> {
    if (!latestReservation) return;
    sendTwilioMonitorEvent(monitorAgentId, {
      type: "toolCallStarted",
      agentId: monitorAgentId,
      toolName: "retail_store_manager_summary",
      args: {},
      timestamp: Date.now(),
    });
    try {
      const transcript = formatTranscript(transcriptEntries);
      const summary = await summarizeCallForStoreManager(transcript);
      const reservation = latestReservation;
      const reservedItem = reservation?.itemName || summary.reserved_item || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook.reservedItem;
      const pickupTime = reservation?.pickupTime || summary.pickup_time || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook.pickupTime;
      const recommendedUpsell = latestRecommendedUpsell || summary.recommended_upsell || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook.recommendedUpsell;
      const message = renderTemplate(STORE_MANAGER_WEBEX_TEMPLATE, {
        customer_name: reservation?.customerName || summary.customer_name,
        phone_number: callerPhone,
        call_duration: formatCallDuration(callStartedAt, endedAt),
        final_resolution: summary.final_resolution,
        summary: summary.summary,
        customer_intent: summary.customer_intent,
        products_discussed: summary.products_discussed,
        customer_preferences: summary.customer_preferences,
        store_actions: summary.store_actions,
        recommended_next_step: summary.recommended_next_step,
        pickup_time: pickupTime,
        item_details: reservation?.itemDetails || reservedItem,
        reserved_item: reservedItem,
        recommended_upsell: recommendedUpsell,
        transcript,
      });

      const result = await executeTool("webex_message", buildConfiguredWebexMessageArgs(message));
      sendTwilioMonitorEvent(monitorAgentId, {
        type: "toolCallCompleted",
        agentId: monitorAgentId,
        toolName: "retail_store_manager_summary",
        success: result.success,
        result: result.success ? "Store Manager Summary sent to Webex." : undefined,
        error: result.error,
        durationMs: result.durationMs,
        timestamp: Date.now(),
      });
      if (result.success) {
        console.log("[VoiceAgent/Twilio] Store manager Webex summary sent", { callSid });
      } else {
        console.error("[VoiceAgent/Twilio] Store manager Webex summary failed:", result.error);
      }
    } catch (error: any) {
      sendTwilioMonitorEvent(monitorAgentId, {
        type: "toolCallCompleted",
        agentId: monitorAgentId,
        toolName: "retail_store_manager_summary",
        success: false,
        error: error.message || "Failed to send Store Manager Summary.",
        timestamp: Date.now(),
      });
      console.error("[VoiceAgent/Twilio] Store manager Webex summary error:", error.message);
    }
  }

  async function sendOrderConfirmation(): Promise<void> {
    const channel = getDemoConfirmationChannel();
    if (channel === "sms") {
      await sendOrderConfirmationSms();
      return;
    }
    if (channel === "email") {
      await sendOrderConfirmationEmail();
      return;
    }
  }

  async function sendOrderConfirmationEmail(): Promise<void> {
    if (!latestReservation) return;
    sendTwilioMonitorEvent(monitorAgentId, {
      type: "toolCallStarted",
      agentId: monitorAgentId,
      toolName: "retail_order_confirmation",
      args: {
        reservationId: latestReservation.reservationId,
        channel: "email",
      },
      timestamp: Date.now(),
    });
    const result = await sendReservationConfirmationEmail(latestReservation);
    sendTwilioMonitorEvent(monitorAgentId, {
      type: "toolCallCompleted",
      agentId: monitorAgentId,
      toolName: "retail_order_confirmation",
      success: result.success,
      result: result.success ? result.result : undefined,
      error: result.error,
      data: result.data,
      durationMs: result.durationMs,
      timestamp: Date.now(),
    });
    if (result.success) {
      console.log("[VoiceAgent/Twilio] Post-call customer email confirmation sent", { callSid });
    } else {
      console.error("[VoiceAgent/Twilio] Post-call customer email confirmation failed:", result.error);
    }
  }

  async function sendOrderConfirmationSms(): Promise<void> {
    if (!latestReservation) return;
    sendTwilioMonitorEvent(monitorAgentId, {
      type: "toolCallStarted",
      agentId: monitorAgentId,
      toolName: "retail_order_confirmation",
      args: {
        reservationId: latestReservation.reservationId,
        channel: "sms",
      },
      timestamp: Date.now(),
    });
    if (!canUseDemoSms()) {
      sendTwilioMonitorEvent(monitorAgentId, {
        type: "toolCallCompleted",
        agentId: monitorAgentId,
        toolName: "retail_order_confirmation",
        success: false,
        error: "SMS delivery is not enabled or configured for this environment.",
        durationMs: 0,
        timestamp: Date.now(),
      });
      console.error(
        "[VoiceAgent/Twilio] Post-call customer SMS skipped: SMS is not enabled or configured",
        { callSid }
      );
      return;
    }
    const to = resolveDemoSmsRecipientPhone(callerPhone);
    const body = truncateForSms(
      `Here is your order confirmation: ${latestReservation.itemName} is confirmed for pickup at ${latestReservation.store} at ${latestReservation.pickupTime}. Reservation ${latestReservation.reservationId}.`
    );
    const rawResult = await executeTool("twilio_sms", {
      to,
      body,
      reservationId: latestReservation.reservationId,
    });
    const result = sanitizeSmsToolResult(rawResult, latestReservation);
    sendTwilioMonitorEvent(monitorAgentId, {
      type: "toolCallCompleted",
      agentId: monitorAgentId,
      toolName: "retail_order_confirmation",
      success: result.success,
      result: result.success ? "Order Confirmation SMS sent to the customer." : undefined,
      error: result.error,
      durationMs: result.durationMs,
      timestamp: Date.now(),
    });
    if (result.success) {
      sendTwilioMonitorEvent(monitorAgentId, {
        type: "smsSent",
        agentId: monitorAgentId,
        to,
        timestamp: Date.now(),
      });
      console.log("[VoiceAgent/Twilio] Post-call customer SMS sent", { callSid });
    } else {
      console.error("[VoiceAgent/Twilio] Post-call customer SMS failed:", result.error);
    }
  }

  function suppressTwilioAssistantResponse(reason: string): void {
    clearTwilioIdleFollowUp();
    suppressAssistantOutput = true;
    assistantTranscriptGuard = "";
    markQueue = [];
    lastItemId = null;
    currentTwilioItemId = null;
    currentTwilioAudioSentMs = 0;
    responseStartTs = null;
    if (streamSid && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: "clear", streamSid }));
    }
    openai?.cancelResponse();
    console.warn(`[VoiceAgent/Twilio] Response suppressed: ${reason}`);
  }

  function runTwilioEndCallTool(reason: string, source: "tool" | "intent"): { success: boolean; result: string; data: { reason: string } } {
    const result = createEndCallResult(reason);
    if (pendingEndCall || endingCall) return result;
    sendTwilioMonitorEvent(monitorAgentId, {
      type: "toolCallStarted",
      agentId: monitorAgentId,
      toolName: voiceEndCallTool.name,
      args: { reason, source },
      timestamp: Date.now(),
    });
    sendTwilioMonitorEvent(monitorAgentId, {
      type: "toolCallCompleted",
      agentId: monitorAgentId,
      toolName: voiceEndCallTool.name,
      success: true,
      result: result.result,
      data: result.data,
      timestamp: Date.now(),
    });
    scheduleTwilioEndCall(reason, source === "tool" ? TWILIO_END_CALL_FALLBACK_MS : 5000);
    return result;
  }

  function scheduleTwilioEndCall(reason: string, delayMs: number): void {
    pendingEndCall = true;
    if (twilioEndCallFallbackStartedAt === null) {
      twilioEndCallFallbackStartedAt = Date.now();
    }
    if (endCallTimer) return;
    endCallTimer = setTimeout(() => {
      endCallTimer = null;
      const waitedMs = Date.now() - (twilioEndCallFallbackStartedAt || Date.now());
      if ((pendingTwilioClosingReason || twilioResponseActive || markQueue.length > 0) && waitedMs < TWILIO_END_CALL_MAX_WAIT_MS) {
        scheduleTwilioEndCall(reason, END_CALL_FALLBACK_RECHECK_MS);
        return;
      }
      completeTwilioEndCall(reason).catch((error) => {
        console.error("[VoiceAgent/Twilio] Scheduled end-call failed:", error);
      });
    }, delayMs);
  }

  async function completeTwilioEndCall(reason: string): Promise<void> {
    if (endingCall) return;
    endingCall = true;
    pendingEndCall = false;
    if (endCallTimer) {
      clearTimeout(endCallTimer);
      endCallTimer = null;
    }
    twilioEndCallFallbackStartedAt = null;

    console.log(`[VoiceAgent/Twilio] Ending call: ${reason}`);
    sendCallEnded();

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (activeCallSid && accountSid && authToken) {
      try {
        const twilioModule = (await import("twilio")).default;
        const client = twilioModule(accountSid, authToken);
        await client.calls(activeCallSid).update({ status: "completed" });
      } catch (error: any) {
        console.error("[VoiceAgent/Twilio] Twilio REST hangup failed:", error.message || error);
      }
    }

    openai?.close();
    openai = null;
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }

  async function sendCallerSummarySms(
    args: Record<string, any>,
    recipientPhone: string,
    agentId: string
  ): Promise<ToolExecutionResult> {
    const result = await executeTool(twilioCallerSummaryTool.name, {
      ...args,
      to: recipientPhone,
      correlationId: callSid || "caller-summary",
    });
    if (result.success) {
      sendTwilioMonitorEvent(agentId, {
        type: "smsSent",
        agentId,
        to: recipientPhone,
        timestamp: Date.now(),
      });
    }
    return result;
  }

  function clearTwilioIdleFollowUp(): void {
    if (idleFollowUpTimer) {
      clearTimeout(idleFollowUpTimer);
      idleFollowUpTimer = null;
    }
  }

  function clearTwilioUserTurnResponseWatchdog(): void {
    if (userTurnResponseTimer) {
      clearTimeout(userTurnResponseTimer);
      userTurnResponseTimer = null;
    }
  }

  function scheduleTwilioUserTurnResponseWatchdog(reason: string): void {
    clearTwilioUserTurnResponseWatchdog();
    userTurnResponseTimer = setTimeout(() => {
      userTurnResponseTimer = null;
      if (!openai || pendingEndCall || endingCall || twilioResponseActive) return;
      console.warn(`[VoiceAgent/Twilio] Retrying stalled response after accepted user turn: ${reason}`);
      openai.triggerResponse({
        input: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: getRetryAcceptedUserTurnPrompt(lastUserTranscript),
              },
            ],
          },
        ],
        output_modalities: ["audio"],
      });
    }, ACCEPTED_USER_TURN_RESPONSE_TIMEOUT_MS);
  }

  function sendTwilioFunctionOutput(callId: string, output: string, createResponse = true): void {
    openai?.sendFunctionOutput(callId, output, createResponse);
    if (createResponse) {
      scheduleTwilioUserTurnResponseWatchdog("function output response did not start");
    }
  }

  function hasActiveTwilioAssistantPlayback(): boolean {
    return twilioResponseActive || markQueue.length > 0 || responseStartTs !== null || currentTwilioAudioSentMs > 0;
  }

  function clearProvisionalTwilioBargeInRelease(): void {
    if (provisionalTwilioBargeInReleaseTimer) {
      clearTimeout(provisionalTwilioBargeInReleaseTimer);
      provisionalTwilioBargeInReleaseTimer = null;
    }
  }

  function releaseProvisionalTwilioBargeIn(): void {
    clearProvisionalTwilioBargeInRelease();
    if (!provisionalTwilioBargeInActive) return;
    provisionalTwilioBargeInActive = false;
    suppressAssistantOutput = false;
  }

  function clearPendingTwilioUserSpeechCandidate(): void {
    pendingTwilioUserSpeechStartedAt = null;
    pendingTwilioUserSpeechAudioStartMs = null;
    pendingTwilioUserSpeechItemId = null;
    twilioTranscriptPreview = "";
  }

  function maybeProvisionallyCutTwilioAssistantPlaybackFromTranscript(text: string): void {
    if (!text.trim()) return;
    if (!hasActiveTwilioAssistantPlayback()) return;
    if (!hasEnoughTranscriptForProvisionalBargeIn(text)) return;
    if (
      shouldSuppressTwilioUserTranscript(text, {
        lastAssistantAudioAt,
        lastAssistantDoneAt,
        lastAssistantTranscript: assistantTranscriptGuard || lastAssistantTranscript,
        twilioResponseActive,
      })
    ) return;
    provisionallyCutTwilioAssistantPlayback();
  }

  function provisionallyCutTwilioAssistantPlayback(): void {
    if (!openai || pendingEndCall || endingCall || provisionalTwilioBargeInActive) return;
    if (!hasActiveTwilioAssistantPlayback()) return;

    provisionalTwilioBargeInActive = true;
    suppressAssistantOutput = true;
    if (pendingTwilioUserSpeechStartedAt !== null) {
      console.debug("[VoiceAgent/Twilio] Accepted provisional barge-in", {
        elapsedMs: Date.now() - pendingTwilioUserSpeechStartedAt,
        itemId: pendingTwilioUserSpeechItemId,
        audioStartMs: pendingTwilioUserSpeechAudioStartMs,
      });
    }
    clearTwilioAssistantPlayback();
    clearProvisionalTwilioBargeInRelease();
    provisionalTwilioBargeInReleaseTimer = setTimeout(() => {
      clearPendingTwilioUserSpeechCandidate();
      releaseProvisionalTwilioBargeIn();
    }, VOICE_PROVISIONAL_BARGE_IN_RELEASE_MS);
  }

  function clearTwilioAssistantPlayback(): boolean {
    const hadBufferedPlayback = markQueue.length > 0 || responseStartTs !== null || currentTwilioAudioSentMs > 0;
    if (!hadBufferedPlayback) return false;

    const elapsed = responseStartTs === null
      ? currentTwilioAudioSentMs
      : Math.max(0, latestTs - responseStartTs);
    const audioEndMs = Math.max(
      0,
      Math.min(Math.round(elapsed), Math.round(currentTwilioAudioSentMs))
    );

    if (lastItemId && audioEndMs < Math.round(currentTwilioAudioSentMs) - 20) {
      openai?.truncateResponse(lastItemId, audioEndMs);
    }
    if (streamSid && ws.readyState === WebSocket.OPEN && markQueue.length > 0) {
      ws.send(JSON.stringify({ event: "clear", streamSid }));
    }

    markQueue = [];
    lastItemId = null;
    currentTwilioItemId = null;
    currentTwilioAudioSentMs = 0;
    responseStartTs = null;
    return true;
  }

  function respondToAcceptedTwilioUserTurn(): void {
    if (!openai || pendingEndCall || endingCall) return;

    const interruptedAssistant =
      twilioResponseActive ||
      markQueue.length > 0 ||
      responseStartTs !== null ||
      pendingTwilioUserSpeechStartedAt !== null;

    clearTwilioAssistantPlayback();

    if (twilioResponseActive) {
      suppressAssistantOutput = true;
      openai.cancelResponse();
      twilioResponseActive = false;
      setTimeout(() => {
        if (!openai || pendingEndCall || endingCall) return;
        suppressAssistantOutput = false;
        openai.triggerResponse();
        scheduleTwilioUserTurnResponseWatchdog("cancelled interrupted assistant response did not restart");
      }, interruptedAssistant ? 150 : 0);
      return;
    }

    openai.triggerResponse();
    scheduleTwilioUserTurnResponseWatchdog("accepted user turn response did not start");
  }

  function scheduleTwilioIdleFollowUp(): void {
    clearTwilioIdleFollowUp();
    if (
      assistantTurnCount <= 1 ||
      pendingEndCall ||
      endingCall ||
      idleFollowUpSent ||
      isAssistantWaitingForCallerAnswerTranscript(lastAssistantTranscript)
    ) return;
    idleFollowUpTimer = setTimeout(() => {
      idleFollowUpTimer = null;
      if (
        !openai ||
        twilioResponseActive ||
        pendingEndCall ||
        endingCall ||
        idleFollowUpSent ||
        isAssistantWaitingForCallerAnswerTranscript(lastAssistantTranscript)
      ) return;
      idleFollowUpSent = true;
      openai.triggerResponse({
        input: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: getIdleFollowUpInstruction(lastAssistantTranscript),
              },
            ],
          },
        ],
        output_modalities: ["audio"],
        instructions: getIdleFollowUpResponseInstructions(),
      });
    }, POST_RESPONSE_IDLE_FOLLOWUP_MS);
  }

  function startTwilioFinalCheckInResponse(reason: string): void {
    if (!openai || endingCall || pendingEndCall) return;
    pendingTwilioFinalCheckInReason = null;
    twilioFinalCheckInAsked = true;
    openai.triggerResponse({
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: getFinalCheckInInstruction(reason),
            },
          ],
        },
      ],
      output_modalities: ["audio"],
      instructions: getFinalCheckInResponseInstructions(),
    });
  }

  function startTwilioAddOnAnswerCheckInResponse(text: string): void {
    if (!openai || endingCall || pendingEndCall) return;
    pendingTwilioAddOnCheckInText = null;
    pendingTwilioFinalCheckInReason = null;
    twilioFinalCheckInAsked = true;
    openai.triggerResponse({
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: getAddOnAnswerCheckInPrompt(text, "twilio"),
            },
          ],
        },
      ],
      output_modalities: ["audio"],
      instructions: getExactTextResponseInstructions(text),
    });
  }

  function requestTwilioAddOnAnswerCheckIn(text: string): void {
    if (!openai || endingCall || pendingEndCall) return;
    clearTwilioIdleFollowUp();
    if (twilioResponseActive) {
      pendingTwilioAddOnCheckInText = text;
      return;
    }
    startTwilioAddOnAnswerCheckInResponse(text);
  }

  function requestTwilioProfileConfirmation(initialIntent: string): void {
    if (!openai || endingCall || pendingEndCall || twilioProfileConfirmationAsked || twilioProfileConfirmed) return;
    clearTwilioIdleFollowUp();
    twilioProfileConfirmationAsked = true;
    openai.triggerResponse({
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: getProfileConfirmationPrompt(initialIntent, "twilio"),
            },
          ],
        },
      ],
      output_modalities: ["audio"],
      instructions: getExactTextResponseInstructions(PROFILE_CONFIRMATION_TEXT),
    });
  }

  function requestTwilioFinalCheckIn(reason: string): void {
    if (!openai || endingCall || pendingEndCall) return;
    if (twilioFinalCheckInAsked) return;
    clearTwilioIdleFollowUp();
    if (twilioResponseActive) {
      pendingTwilioFinalCheckInReason = reason;
      return;
    }
    startTwilioFinalCheckInResponse(reason);
  }

  function startTwilioClosingResponse(reason: string): void {
    if (!openai || endingCall) return;
    pendingTwilioClosingReason = null;
    if (endCallTimer) {
      clearTimeout(endCallTimer);
      endCallTimer = null;
    }
    twilioEndCallFallbackStartedAt = null;
    openai.triggerResponse({
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: getClosingInstruction(reason),
            },
          ],
        },
      ],
      output_modalities: ["audio"],
      instructions: getClosingResponseInstructions(),
    });
    scheduleTwilioEndCall(reason, TWILIO_END_CALL_MAX_WAIT_MS);
  }

  function requestTwilioGracefulEndCall(reason: string, source: "tool" | "intent" = "intent"): void {
    if (pendingEndCall || endingCall) return;
    clearTwilioIdleFollowUp();
    pendingEndCall = true;
    sendTwilioMonitorEvent(monitorAgentId, {
      type: "toolCallStarted",
      agentId: monitorAgentId,
      toolName: voiceEndCallTool.name,
      args: { reason, source },
      timestamp: Date.now(),
    });
    sendTwilioMonitorEvent(monitorAgentId, {
      type: "toolCallCompleted",
      agentId: monitorAgentId,
      toolName: voiceEndCallTool.name,
      success: true,
      result: createEndCallResult(reason).result,
      data: { reason },
      timestamp: Date.now(),
    });
    const alreadySaidClosing = isAssistantClosingTranscript(lastAssistantTranscript);
    if (!alreadySaidClosing) {
      if (twilioResponseActive) {
        pendingTwilioClosingReason = reason;
        suppressAssistantOutput = true;
        clearTwilioAssistantPlayback();
        openai?.cancelResponse();
        twilioResponseActive = false;
        setTimeout(() => {
          if (pendingTwilioClosingReason !== reason || !pendingEndCall || endingCall) return;
          suppressAssistantOutput = false;
          startTwilioClosingResponse(reason);
        }, 700);
      } else {
        startTwilioClosingResponse(reason);
      }
    } else {
      scheduleTwilioEndCall(reason, END_CALL_FALLBACK_RECHECK_MS);
    }
  }

  function maybeCompleteTwilioPendingEndCall(reason: string): void {
    if (pendingTwilioClosingReason) return;
    if (!pendingEndCall || endingCall || twilioResponseActive || markQueue.length > 0) return;
    setTimeout(() => {
      if (pendingTwilioClosingReason) return;
      if (!pendingEndCall || endingCall || twilioResponseActive || markQueue.length > 0) return;
      completeTwilioEndCall(reason).catch((error) => {
        console.error("[VoiceAgent/Twilio] End-call completion failed:", error);
      });
    }, 700);
  }

  async function runStartupRetailProfileLookup(): Promise<string> {
    const lookupArgs = callerPhone !== "Unknown" ? { phone: callerPhone } : {};
    sendTwilioMonitorEvent(monitorAgentId, {
      type: "toolCallStarted",
      agentId: monitorAgentId,
      toolName: "retail_profile_lookup",
      args: lookupArgs,
      timestamp: Date.now(),
    });
    const profileLookup = await executeTool("retail_profile_lookup", lookupArgs);
    sendTwilioMonitorEvent(monitorAgentId, {
      type: "toolCallCompleted",
      agentId: monitorAgentId,
      toolName: "retail_profile_lookup",
      success: profileLookup.success,
      result: profileLookup.result,
      error: profileLookup.error,
      data: profileLookup.data,
      durationMs: profileLookup.durationMs,
      timestamp: Date.now(),
    });

    return [
      `retail_profile_lookup: ${formatJsonForInstructions(profileLookup.data || profileLookup.result || profileLookup.error)}`,
    ].join("\n\n");
  }
}

function handleBrowserSession(ws: WebSocket): void {
  let openai: OpenAIRealtimeClient | null = null;
  let responseActive = false;
  let browserPlaybackActive = false;
  let lastAssistantAudioAt = 0;
  let lastAssistantDoneAt = 0;
  let lastAssistantTranscript = "";
  let language = "en-US";
  let pendingEndCall = false;
  let endingCall = false;
  let endCallTimer: ReturnType<typeof setTimeout> | null = null;
  let initialGreetingActive = false;
  let initialGreetingReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  let browserUserSpeechUiActive = false;
  let browserInputEnabled = false;
  let currentAssistantItemId = "";
  let currentAssistantAudioSentMs = 0;
  let browserPlaybackStartedAt = 0;
  let agentName = "Store Assistant";
  let lastUserTranscript = "";
  let suppressAssistantOutput = false;
  let assistantTranscriptGuard = "";
  let browserCallStartedAt: number | null = null;
  let browserCallEndedSent = false;
  let latestReservation: RetailReservationDetails | null = null;
  let latestRecommendedUpsell = "";
  let inventoryLookupSucceeded = false;
  let startupRetailContext = "";
  let idleFollowUpTimer: ReturnType<typeof setTimeout> | null = null;
  let userTurnResponseTimer: ReturnType<typeof setTimeout> | null = null;
  let idleFollowUpSent = false;
  let assistantTurnCount = 0;
  let pendingBrowserUserSpeechStartedAt: number | null = null;
  let pendingBrowserUserSpeechAudioStartMs: number | null = null;
  let pendingBrowserUserSpeechItemId: string | null = null;
  let browserTranscriptPreview = "";
  let pendingBrowserClosingReason: string | null = null;
  let pendingBrowserFinalCheckInReason: string | null = null;
  let pendingBrowserAddOnCheckInText: string | null = null;
  let browserProfileCandidateAvailable = false;
  let browserProfileConfirmationAsked = false;
  let browserProfileConfirmed = false;
  let browserFinalCheckInAsked = false;
  let browserPendingAddOnOffer = false;
  let browserPendingPickupProposal = false;
  let browserEndCallFallbackStartedAt: number | null = null;
  let provisionalBrowserBargeInActive = false;
  let provisionalBrowserBargeInReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  const transcriptEntries: CallTranscriptEntry[] = [];

  ws.on("message", async (raw, isBinary) => {
    if (isBinary && openai) {
      if (!browserInputEnabled) {
        return;
      }
      const base64 = rawAudioToBase64(raw);
      openai.appendAudio(base64);
      return;
    }

    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "start") {
        const { agentId, config } = msg;
        let instructions = "";
        let voice = "marin";
        language = config?.language || language;
        agentName = "Store Assistant";
        lastAssistantTranscript = "";
        lastUserTranscript = "";
        browserCallStartedAt = Date.now();
        browserInputEnabled = false;
        browserCallEndedSent = false;
        latestReservation = null;
        latestRecommendedUpsell = "";
        startupRetailContext = "";
        idleFollowUpSent = false;
        assistantTurnCount = 0;
        pendingBrowserUserSpeechStartedAt = null;
        pendingBrowserUserSpeechAudioStartMs = null;
        pendingBrowserUserSpeechItemId = null;
        browserTranscriptPreview = "";
        pendingBrowserClosingReason = null;
        pendingBrowserFinalCheckInReason = null;
        pendingBrowserAddOnCheckInText = null;
        browserProfileCandidateAvailable = false;
        browserProfileConfirmationAsked = false;
        browserProfileConfirmed = false;
        browserFinalCheckInAsked = false;
        browserPendingAddOnOffer = false;
        browserPendingPickupProposal = false;
        browserEndCallFallbackStartedAt = null;
        provisionalBrowserBargeInActive = false;
        clearProvisionalBrowserBargeInRelease();
        clearBrowserIdleFollowUp();
        clearBrowserUserTurnResponseWatchdog();
        transcriptEntries.length = 0;

        if (agentId) {
          const agent = await storage.getAgent(parseInt(agentId));
          if (agent) {
            agentName = agent.name;
            voice = resolveRealtimeVoice(agent.voiceModel, agent.gender);
            language = agent.language || language;
          }
        }

        startupRetailContext = await runStartupRetailProfileLookup();
        const returningCallerName = startupRetailContext ? getDemoCustomerProfile().firstName : undefined;
        browserProfileCandidateAvailable = Boolean(startupRetailContext);
        const smsRecipientPhone = resolveDemoSmsRecipientPhone();
        const canSendCallerSummarySms = canSendCallSummarySms();

        const tools = buildRealtimeVoiceTools({
          smsEnabled: canUseDemoSms(),
          callerSummarySmsEnabled: canSendCallerSummarySms,
        });

        instructions = buildOpenAIVoiceAgentInstructions({
          confirmationSpokenRoute: getDemoConfirmationChannel(),
          canSendCallerSummarySms,
          returningCallerName,
          startupRetailContext,
        });

        openai = new OpenAIRealtimeClient(process.env.OPENAI_API_KEY || "", buildBrowserRealtimeConfig({
          instructions,
          voice,
          transcriptionLanguage: REALTIME_TRANSCRIPTION_LANGUAGE,
          transcriptionModel: REALTIME_TRANSCRIPTION_MODEL,
          retailTranscriptionKeywords: buildRetailTranscriptionKeywords(),
          tools,
        }));

        openai.on("audio", (base64: string, itemId: string) => {
          if (suppressAssistantOutput) return;
          responseActive = true;
          if (!initialGreetingActive) {
            browserInputEnabled = true;
          }
          lastAssistantAudioAt = Date.now();
          if (itemId && itemId !== currentAssistantItemId) {
            currentAssistantItemId = itemId;
            currentAssistantAudioSentMs = 0;
            browserPlaybackStartedAt = 0;
          }
          currentAssistantAudioSentMs += getPcm16DurationMs(base64, BROWSER_PCM16_SAMPLE_RATE);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(Buffer.from(base64, "base64"));
          }
        });

        openai.on("responseStarted", () => {
          clearBrowserUserTurnResponseWatchdog();
          responseActive = true;
          clearBrowserIdleFollowUp();
          suppressAssistantOutput = false;
          assistantTranscriptGuard = "";
        });

        openai.on("audioDone", () => {
          lastAssistantAudioAt = Date.now();
        });

        openai.on("userSpeechStarted", (event: RealtimeSpeechEvent = {}) => {
          clearBrowserIdleFollowUp();
          idleFollowUpSent = false;
          pendingBrowserUserSpeechStartedAt = Date.now();
          pendingBrowserUserSpeechAudioStartMs = typeof event.audio_start_ms === "number" ? event.audio_start_ms : null;
          pendingBrowserUserSpeechItemId = typeof event.item_id === "string" ? event.item_id : null;
          browserTranscriptPreview = "";
          browserUserSpeechUiActive = true;
          sendEvent({ type: "userSpeechStarted", timestamp: Date.now() });
          if (hasActiveBrowserAssistantPlayback()) {
            console.debug("[VoiceAgent/Browser] Candidate barge-in speech started", {
              itemId: pendingBrowserUserSpeechItemId,
              audioStartMs: pendingBrowserUserSpeechAudioStartMs,
            });
          }
        });

        openai.on("userSpeechStopped", () => {
          if (browserUserSpeechUiActive) {
            browserUserSpeechUiActive = false;
            sendEvent({ type: "userSpeechStopped", timestamp: Date.now() });
          }
        });

        const handleBrowserUserTranscript = async (text: string): Promise<void> => {
          const trimmed = text.trim();
          if (!trimmed) return;
          if (isIncompleteUserRequestTranscript(trimmed)) {
            console.warn(`[VoiceAgent/Browser] Suppressed incomplete user request fragment: ${trimmed}`);
            releaseProvisionalBrowserBargeIn();
            clearPendingBrowserUserSpeechCandidate();
            browserUserSpeechUiActive = false;
            sendEvent({ type: "userTranscriptSuppressed" });
            sendEvent({ type: "userSpeechStopped", timestamp: Date.now() });
            return;
          }
          if (
            shouldSuppressBrowserUserTranscript(trimmed, {
              browserPlaybackActive,
              lastAssistantAudioAt,
              lastAssistantDoneAt,
              lastAssistantTranscript: assistantTranscriptGuard || lastAssistantTranscript,
              responseActive,
            })
          ) {
            releaseProvisionalBrowserBargeIn();
            clearPendingBrowserUserSpeechCandidate();
            browserUserSpeechUiActive = false;
            sendEvent({ type: "userTranscriptSuppressed" });
            sendEvent({ type: "userSpeechStopped", timestamp: Date.now() });
            return;
          }

          const reviewed = await reviewEnglishUserTranscript(trimmed, {
            agentName,
            lastAssistantTranscript,
            lastUserTranscript,
          });
          if (reviewed.action === "suppress") {
            console.warn(`[VoiceAgent/Browser] Suppressed suspicious user transcript: ${trimmed}`);
            releaseProvisionalBrowserBargeIn();
            clearPendingBrowserUserSpeechCandidate();
            browserUserSpeechUiActive = false;
            sendEvent({ type: "userTranscriptSuppressed" });
            sendEvent({ type: "userSpeechStopped", timestamp: Date.now() });
            return;
          }
          if (reviewed.action === "replace") {
            console.warn(`[VoiceAgent/Browser] Corrected user transcript: "${trimmed}" -> "${reviewed.text}"`);
          }

          lastUserTranscript = reviewed.text;
          transcriptEntries.push({
            role: "Customer",
            text: reviewed.text,
            timestamp: Date.now(),
          });
          sendEvent({
            type: "userTranscript",
            text: reviewed.text,
            rawText: reviewed.action === "replace" ? trimmed : undefined,
            corrected: reviewed.action === "replace",
          });
          releaseProvisionalBrowserBargeIn();
          clearPendingBrowserUserSpeechCandidate();
          browserUserSpeechUiActive = false;
          const turnDecision = getAcceptedUserTurnDecision({
            text: reviewed.text,
            lastAssistantTranscript,
            pendingAddOnOffer: browserPendingAddOnOffer,
            pendingPickupProposal: browserPendingPickupProposal,
            finalCheckInAsked: browserFinalCheckInAsked,
            profileConfirmationNeeded: shouldRequestProfileConfirmation(reviewed.text, {
              candidateAvailable: browserProfileCandidateAvailable,
              confirmationAsked: browserProfileConfirmationAsked,
              confirmed: browserProfileConfirmed,
            }),
            softDeclineReason: "User gave a soft decline before the final anything-else check-in",
            endCallReason: "User expressed end-call intent",
          });
          browserPendingAddOnOffer = turnDecision.pendingAddOnOffer;
          browserPendingPickupProposal = turnDecision.pendingPickupProposal;
          browserFinalCheckInAsked = turnDecision.finalCheckInAsked;
          switch (turnDecision.action.type) {
            case "request_profile_confirmation":
              requestBrowserProfileConfirmation(turnDecision.action.initialIntent);
              return;
            case "request_add_on_check_in":
              requestBrowserAddOnAnswerCheckIn(turnDecision.action.text);
              return;
            case "request_final_check_in":
              requestBrowserFinalCheckIn(turnDecision.action.reason);
              return;
            case "request_graceful_end_call":
              requestBrowserGracefulEndCall(turnDecision.action.reason);
              return;
            case "respond":
              respondToAcceptedBrowserUserTurn();
              return;
          }
        };

        openai.on("userTranscript", (text: string) => {
          void handleBrowserUserTranscript(text);
        });

        openai.on("userTranscriptDelta", (delta: string) => {
          browserTranscriptPreview += delta || "";
          maybeProvisionallyCutBrowserAssistantPlaybackFromTranscript(browserTranscriptPreview);
          sendEvent({ type: "userTranscriptDelta", delta });
        });

        openai.on("userTranscriptSegment", (text: string) => {
          browserTranscriptPreview = text || browserTranscriptPreview;
          maybeProvisionallyCutBrowserAssistantPlaybackFromTranscript(browserTranscriptPreview);
        });

        openai.on("userTranscriptFailed", (error: any) => {
          const message = String(error?.message || "");
          if (message) {
            sendEvent({ type: "transcriptionWarning", message });
          }
        });

        openai.on("assistantTranscriptDelta", (delta: string) => {
          if (suppressAssistantOutput) return;
          assistantTranscriptGuard += delta || "";
          if (isUnsafeAssistantOutput(assistantTranscriptGuard)) {
            suppressBrowserAssistantResponse("Unsafe assistant output");
            return;
          }
          sendEvent({ type: "assistantTranscriptDelta", delta });
        });

        openai.on("assistantTranscriptDone", (text: string) => {
          const trimmed = text.trim();
          if (!trimmed) return;
          if (suppressAssistantOutput) {
            console.warn(`[VoiceAgent/Browser] Suppressed assistant output after prior response cancellation: ${trimmed}`);
            return;
          }
          if (isUnsafeAssistantOutput(trimmed)) {
            console.warn(`[VoiceAgent/Browser] Suppressed unsafe assistant output: ${trimmed}`);
            suppressBrowserAssistantResponse("Unsafe assistant transcript");
            return;
          }
          lastAssistantDoneAt = Date.now();
          assistantTurnCount++;
          lastAssistantTranscript = trimmed;
          transcriptEntries.push({
            role: "Assistant",
            text: trimmed,
            timestamp: Date.now(),
          });
          sendEvent({ type: "assistantTranscriptDone", text: trimmed });
          const transcriptEffects = getAssistantTranscriptEffects(trimmed);
          if (transcriptEffects.pendingAddOnOffer) {
            browserPendingAddOnOffer = true;
          }
          if (transcriptEffects.profileConfirmationAsked) {
            browserProfileConfirmationAsked = true;
          }
          if (transcriptEffects.finalCheckInAsked) {
            browserFinalCheckInAsked = true;
          }
          if (transcriptEffects.deliveredClosing && !pendingEndCall && !endingCall) {
            requestBrowserGracefulEndCall("Assistant delivered closing");
          } else {
            scheduleBrowserIdleFollowUp();
          }
        });

        openai.on("responseDone", () => {
          responseActive = false;
          if (initialGreetingActive && !browserPlaybackActive) {
            scheduleInitialGreetingRelease(850);
          }
          sendEvent({ type: "responseDone" });
          if (pendingBrowserAddOnCheckInText && !pendingEndCall && !endingCall) {
            startBrowserAddOnAnswerCheckInResponse(pendingBrowserAddOnCheckInText);
            return;
          }
          if (pendingBrowserFinalCheckInReason && !pendingEndCall && !endingCall) {
            startBrowserFinalCheckInResponse(pendingBrowserFinalCheckInReason);
            return;
          }
          if (pendingBrowserClosingReason && pendingEndCall && !endingCall) {
            startBrowserClosingResponse(pendingBrowserClosingReason);
            return;
          }
          maybeCompleteBrowserPendingEndCall("End-call final audio completed");
        });

        openai.on("responseCancelled", () => {
          responseActive = false;
          sendEvent({ type: "responseDone" });
          if (pendingBrowserAddOnCheckInText && !pendingEndCall && !endingCall) {
            startBrowserAddOnAnswerCheckInResponse(pendingBrowserAddOnCheckInText);
            return;
          }
          if (pendingBrowserFinalCheckInReason && !pendingEndCall && !endingCall) {
            startBrowserFinalCheckInResponse(pendingBrowserFinalCheckInReason);
            return;
          }
          if (pendingBrowserClosingReason && pendingEndCall && !endingCall) {
            startBrowserClosingResponse(pendingBrowserClosingReason);
            return;
          }
          maybeCompleteBrowserPendingEndCall("End-call response cancelled");
        });

        openai.once("sessionReady", () => {
          console.log("[VoiceAgent/Browser] Realtime session ready; sending opening greeting");
          initialGreetingActive = true;
          openai!.triggerResponse({
            input: [
              {
                type: "message",
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: getVoiceSessionStartedPrompt("browser"),
                  },
                ],
              },
            ],
            output_modalities: ["audio"],
            instructions: getOpeningGreetingInstructions(agentName || "the store assistant"),
          });
        });

        openai.on("error", (err: Error) => {
          console.error("[VoiceAgent/Browser] Error:", err.message);
          sendEvent({ type: "error", message: err.message });
        });

        openai.on("functionCall", async ({ callId, name, arguments: argsString }) => {
          clearBrowserIdleFollowUp();
          console.log(`[VoiceAgent/Browser] Function call: ${name}`);
          try {
            const args = JSON.parse(argsString);
            if (name === voiceEndCallTool.name) {
              const reason = String(args.reason || "User asked to end the call");
              if (hasActiveShoppingIntent(lastUserTranscript)) {
                const rejectedResult = createRejectedEndCallResult(reason, lastUserTranscript);
                console.warn(`[VoiceAgent/Browser] Rejected premature end-call request:`, rejectedResult);
                sendEvent({
                  type: "toolCallStarted",
                  toolName: voiceEndCallTool.name,
                  args: { reason, source: "tool", lastUserTranscript },
                  timestamp: Date.now(),
                });
                sendEvent({
                  type: "toolCallCompleted",
                  toolName: voiceEndCallTool.name,
                  success: false,
                  result: rejectedResult.result,
                  error: rejectedResult.error,
                  data: rejectedResult.data,
                  timestamp: Date.now(),
                });
                sendBrowserFunctionOutput(callId, JSON.stringify(rejectedResult));
                return;
              }
              if (
                !isAssistantClosingTranscript(lastAssistantTranscript) &&
                !canEndCallFromUserTranscript(lastUserTranscript, lastAssistantTranscript, browserFinalCheckInAsked)
              ) {
                const rejectedResult = createNeedsCheckInEndCallResult(reason, lastUserTranscript);
                console.warn(`[VoiceAgent/Browser] Rejected end-call before final check-in:`, rejectedResult);
                sendEvent({
                  type: "toolCallStarted",
                  toolName: voiceEndCallTool.name,
                  args: { reason, source: "tool", lastUserTranscript, requiredCheckIn: FINAL_CHECK_IN_TEXT },
                  timestamp: Date.now(),
                });
                sendEvent({
                  type: "toolCallCompleted",
                  toolName: voiceEndCallTool.name,
                  success: false,
                  result: rejectedResult.result,
                  error: rejectedResult.error,
                  data: rejectedResult.data,
                  timestamp: Date.now(),
                });
                sendBrowserFunctionOutput(callId, JSON.stringify(rejectedResult), false);
                requestBrowserFinalCheckIn(reason);
                return;
              }
              const result = createEndCallResult(reason);
              console.log(`[VoiceAgent/Browser] Function result:`, result);
              sendBrowserFunctionOutput(callId, JSON.stringify(result), false);
              requestBrowserGracefulEndCall(reason, "tool");
              return;
            }

            sendEvent({
              type: "toolCallStarted",
              toolName: name,
              args,
              timestamp: Date.now(),
            });
            const rawResult = name === "retail_reserve_item" && !inventoryLookupSucceeded
              ? {
                  success: false,
                  error: "Call retail_lookup_inventory successfully before creating a reservation.",
                  result: "Reservation blocked because inventory has not been checked in this call.",
                  data: { product: args.product, store: args.store, requiresInventoryLookup: true },
                }
              : name === twilioCallerSummaryTool.name
                ? await executeTool(twilioCallerSummaryTool.name, {
                    ...args,
                    to: smsRecipientPhone,
                    correlationId: "browser-caller-summary",
                  })
              : name === "twilio_sms"
                ? await executeTool(name, withDemoSmsRecipient(args))
                : await executeTool(name, args);
            let result = name === "twilio_sms" || name === twilioCallerSummaryTool.name
              ? sanitizeSmsToolResult(rawResult, latestReservation)
              : rawResult;
            let bundledProfileHistoryResult: ToolExecutionResult | null = null;
            let bundledProfileContextResult: ToolExecutionResult | null = null;
            if (result.success && name === "retail_confirm_profile") {
              const bundled = await addProfileContextBundle(result, args, { includeBrowserGuard: true });
              result = bundled.result;
              bundledProfileHistoryResult = bundled.historyResult;
              bundledProfileContextResult = bundled.contextResult;
            }
            if (result.success && name === "retail_lookup_inventory") {
              inventoryLookupSucceeded = true;
              browserPendingPickupProposal = true;
            }
            if (result.success && name === "retail_reserve_item") {
              latestReservation = getReservationDetails(result.data);
              browserPendingPickupProposal = false;
            }
            if (result.success && name === "retail_recommend_gift_accessory") {
              latestRecommendedUpsell = getRecommendedUpsell(result.data);
            }
            if (result.success && name === "retail_confirm_profile") {
              browserProfileConfirmed = true;
              browserProfileConfirmationAsked = true;
            }
            if (result.success && name === twilioCallerSummaryTool.name) {
              sendEvent({ type: "smsSent", to: smsRecipientPhone, timestamp: Date.now() });
            }
            sendEvent({
              type: "toolCallCompleted",
              toolName: name,
              success: result.success,
              result: result.result,
              error: result.error,
              data: result.data,
              durationMs: result.durationMs,
              timestamp: Date.now(),
            });
            const retailEventType = getRetailToolEventType(name);
            if (retailEventType && result.success && result.data !== undefined) {
              sendEvent({
                type: retailEventType,
                data: result.data,
                timestamp: Date.now(),
              });
            }
            if (bundledProfileHistoryResult) {
              sendEvent({
                type: "toolCallStarted",
                toolName: "retail_user_history_lookup",
                args: { customerId: (result.data as any)?.customerId, conversationLimit: 500, bundled: true },
                timestamp: Date.now(),
              });
              sendEvent({
                type: "toolCallCompleted",
                toolName: "retail_user_history_lookup",
                success: bundledProfileHistoryResult.success,
                result: bundledProfileHistoryResult.result,
                error: bundledProfileHistoryResult.error,
                data: bundledProfileHistoryResult.data,
                durationMs: bundledProfileHistoryResult.durationMs,
                timestamp: Date.now(),
              });
            }
            if (bundledProfileContextResult) {
              sendEvent({
                type: "toolCallStarted",
                toolName: "retail_get_customer_context",
                args: { customerName: (result.data as any)?.customerName, bundled: true },
                timestamp: Date.now(),
              });
              sendEvent({
                type: "toolCallCompleted",
                toolName: "retail_get_customer_context",
                success: bundledProfileContextResult.success,
                result: bundledProfileContextResult.result,
                error: bundledProfileContextResult.error,
                data: bundledProfileContextResult.data,
                durationMs: bundledProfileContextResult.durationMs,
                timestamp: Date.now(),
              });
              sendEvent({
                type: "customerContextLoaded",
                data: bundledProfileContextResult.data,
                timestamp: Date.now(),
              });
            }
            if (result.success && name === "retail_reserve_item" && latestReservation) {
              const accessoryArgs = {
                product: latestReservation.itemName,
                originalRequest: String(args.originalRequest || args.product || latestReservation.itemName),
                store: latestReservation.store,
                customerName: latestReservation.customerName,
                recentConversationSummary: `Customer reserved ${latestReservation.itemName} at ${latestReservation.store} for ${latestReservation.pickupTime}.`,
              };
              sendEvent({
                type: "toolCallStarted",
                toolName: "retail_recommend_gift_accessory",
                args: accessoryArgs,
                timestamp: Date.now(),
              });
              const accessoryResult = await executeTool("retail_recommend_gift_accessory", accessoryArgs);
              if (accessoryResult.success) {
                latestRecommendedUpsell = getRecommendedUpsell(accessoryResult.data);
              }
              sendEvent({
                type: "toolCallCompleted",
                toolName: "retail_recommend_gift_accessory",
                success: accessoryResult.success,
                result: accessoryResult.result,
                error: accessoryResult.error,
                data: accessoryResult.data,
                durationMs: accessoryResult.durationMs,
                timestamp: Date.now(),
              });
              if (accessoryResult.success && accessoryResult.data !== undefined) {
                sendEvent({
                  type: "recommendationCreated",
                  data: accessoryResult.data,
                  timestamp: Date.now(),
                });
                result = {
                  ...result,
                  result: `${result.result || ""} Accessory recommendation is ready: ${accessoryResult.result || latestRecommendedUpsell}`.trim(),
                  data: {
                    ...(typeof result.data === "object" && result.data ? result.data : {}),
                    accessoryRecommendation: accessoryResult.data,
                  },
                };
              }
            }
            console.log(`[VoiceAgent/Browser] Function result:`, result);
            if (pendingEndCall || endingCall || suppressAssistantOutput) {
              console.warn(`[VoiceAgent/Browser] Skipping stale function output for ${name}`);
              return;
            }
            sendBrowserFunctionOutput(callId, JSON.stringify(result));
          } catch (e: any) {
            console.error(`[VoiceAgent/Browser] Function execution failed:`, e);
            if (pendingEndCall || endingCall || suppressAssistantOutput) return;
            sendBrowserFunctionOutput(callId, JSON.stringify({ success: false, error: e.message }));
          }
        });

        openai.connect();
        sendEvent({ type: "connected" });
      } else if (msg.type === "stop") {
        clearBrowserIdleFollowUp();
        clearBrowserUserTurnResponseWatchdog();
        void sendBrowserCallEnded("Browser voice session stopped");
        openai?.close();
        openai = null;
      } else if (msg.type === "assistantPlaybackStarted") {
        browserPlaybackActive = true;
        if (!browserPlaybackStartedAt) {
          browserPlaybackStartedAt = Date.now();
        }
        if (initialGreetingReleaseTimer) {
          clearTimeout(initialGreetingReleaseTimer);
          initialGreetingReleaseTimer = null;
        }
      } else if (msg.type === "assistantPlaybackEnded") {
        browserPlaybackActive = false;
        browserPlaybackStartedAt = 0;
        if (initialGreetingActive) {
          scheduleInitialGreetingRelease(650);
        }
        maybeCompleteBrowserPendingEndCall("End-call audio playback ended");
      }
    } catch {}
  });

  ws.on("close", () => {
    if (initialGreetingReleaseTimer) {
      clearTimeout(initialGreetingReleaseTimer);
      initialGreetingReleaseTimer = null;
    }
    clearBrowserIdleFollowUp();
    clearBrowserUserTurnResponseWatchdog();
    clearProvisionalBrowserBargeInRelease();
    void sendBrowserCallEnded("Browser voice websocket closed");
    openai?.close();
    openai = null;
  });

  function runBrowserEndCallTool(reason: string, source: "tool" | "intent"): { success: boolean; result: string; data: { reason: string } } {
    const result = createEndCallResult(reason);
    if (pendingEndCall || endingCall) return result;
    sendEvent({
      type: "toolCallStarted",
      toolName: voiceEndCallTool.name,
      args: { reason, source },
      timestamp: Date.now(),
    });
    sendEvent({
      type: "toolCallCompleted",
      toolName: voiceEndCallTool.name,
      success: true,
      result: result.result,
      data: result.data,
      timestamp: Date.now(),
    });
    scheduleBrowserEndCall(reason, source === "tool" ? BROWSER_END_CALL_FALLBACK_MS : 5000);
    return result;
  }

  function scheduleBrowserEndCall(reason: string, delayMs: number): void {
    pendingEndCall = true;
    if (browserEndCallFallbackStartedAt === null) {
      browserEndCallFallbackStartedAt = Date.now();
    }
    if (endCallTimer) return;
    endCallTimer = setTimeout(() => {
      endCallTimer = null;
      const waitedMs = Date.now() - (browserEndCallFallbackStartedAt || Date.now());
      if ((pendingBrowserClosingReason || responseActive || browserPlaybackActive) && waitedMs < BROWSER_END_CALL_MAX_WAIT_MS) {
        scheduleBrowserEndCall(reason, END_CALL_FALLBACK_RECHECK_MS);
        return;
      }
      void completeBrowserEndCall(reason);
    }, delayMs);
  }

  async function completeBrowserEndCall(reason: string): Promise<void> {
    if (endingCall) return;
    endingCall = true;
    pendingEndCall = false;
    if (endCallTimer) {
      clearTimeout(endCallTimer);
      endCallTimer = null;
    }
    browserEndCallFallbackStartedAt = null;

    await sendBrowserCallEnded(reason);
    openai?.close();
    openai = null;
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }, 50);
  }

  async function sendBrowserCallEnded(reason: string): Promise<void> {
    if (browserCallEndedSent) return;
    browserCallEndedSent = true;
    const endedAt = Date.now();
    await Promise.all([
      sendBrowserOrderConfirmation(),
      sendBrowserStoreManagerSummary(endedAt),
    ]);
    sendEvent({ type: "callEnded", reason, timestamp: Date.now() });
  }

  async function sendBrowserStoreManagerSummary(endedAt: number): Promise<void> {
    if (!latestReservation) return;
    sendEvent({
      type: "toolCallStarted",
      toolName: "retail_store_manager_summary",
      args: {},
      timestamp: Date.now(),
    });
    try {
      const transcript = formatTranscript(transcriptEntries);
      const summary = await summarizeCallForStoreManager(transcript);
      const reservation = latestReservation;
      const reservedItem = reservation?.itemName || summary.reserved_item || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook.reservedItem;
      const pickupTime = reservation?.pickupTime || summary.pickup_time || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook.pickupTime;
      const recommendedUpsell = latestRecommendedUpsell || summary.recommended_upsell || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook.recommendedUpsell;
      const message = renderTemplate(STORE_MANAGER_WEBEX_TEMPLATE, {
        customer_name: reservation?.customerName || summary.customer_name,
        phone_number: "Browser voice session",
        call_duration: formatCallDuration(browserCallStartedAt, endedAt),
        final_resolution: summary.final_resolution,
        summary: summary.summary,
        customer_intent: summary.customer_intent,
        products_discussed: summary.products_discussed,
        customer_preferences: summary.customer_preferences,
        store_actions: summary.store_actions,
        recommended_next_step: summary.recommended_next_step,
        pickup_time: pickupTime,
        item_details: reservation?.itemDetails || reservedItem,
        reserved_item: reservedItem,
        recommended_upsell: recommendedUpsell,
        transcript,
      });

      const result = await executeTool("webex_message", buildConfiguredWebexMessageArgs(message));
      sendEvent({
        type: "toolCallCompleted",
        toolName: "retail_store_manager_summary",
        success: result.success,
        result: result.success ? "Store Manager Summary sent to Webex." : undefined,
        error: result.error,
        durationMs: result.durationMs,
        timestamp: Date.now(),
      });
      if (result.success) {
        console.log("[VoiceAgent/Browser] Store manager Webex summary sent");
      } else {
        console.error("[VoiceAgent/Browser] Store manager Webex summary failed:", result.error);
      }
    } catch (error: any) {
      sendEvent({
        type: "toolCallCompleted",
        toolName: "retail_store_manager_summary",
        success: false,
        error: error.message || "Failed to send Store Manager Summary.",
        timestamp: Date.now(),
      });
      console.error("[VoiceAgent/Browser] Store manager Webex summary error:", error.message);
    }
  }

  async function sendBrowserOrderConfirmation(): Promise<void> {
    const channel = getDemoConfirmationChannel();
    if (channel === "sms") {
      await sendBrowserOrderConfirmationSms();
      return;
    }
    if (channel === "email") {
      await sendBrowserOrderConfirmationEmail();
      return;
    }
  }

  async function sendBrowserOrderConfirmationEmail(): Promise<void> {
    if (!latestReservation) return;
    sendEvent({
      type: "toolCallStarted",
      toolName: "retail_order_confirmation",
      args: {
        reservationId: latestReservation.reservationId,
        channel: "email",
      },
      timestamp: Date.now(),
    });
    const result = await sendReservationConfirmationEmail(latestReservation);
    sendEvent({
      type: "toolCallCompleted",
      toolName: "retail_order_confirmation",
      success: result.success,
      result: result.success ? result.result : undefined,
      error: result.error,
      data: result.data,
      durationMs: result.durationMs,
      timestamp: Date.now(),
    });
    if (result.success) {
      console.log("[VoiceAgent/Browser] Post-call customer email confirmation sent");
    } else {
      console.error("[VoiceAgent/Browser] Post-call customer email confirmation failed:", result.error);
    }
  }

  async function sendBrowserOrderConfirmationSms(): Promise<void> {
    if (!latestReservation) return;
    sendEvent({
      type: "toolCallStarted",
      toolName: "retail_order_confirmation",
      args: {
        reservationId: latestReservation.reservationId,
        channel: "sms",
      },
      timestamp: Date.now(),
    });
    if (!canUseDemoSms()) {
      sendEvent({
        type: "toolCallCompleted",
        toolName: "retail_order_confirmation",
        success: false,
        error: "SMS delivery is not enabled or configured for this environment.",
        durationMs: 0,
        timestamp: Date.now(),
      });
      console.error(
        "[VoiceAgent/Browser] Post-call customer SMS skipped: SMS is not enabled or configured"
      );
      return;
    }
    const to = resolveDemoSmsRecipientPhone();
    const body = truncateForSms(
      `Here is your order confirmation: ${latestReservation.itemName} is confirmed for pickup at ${latestReservation.store} at ${latestReservation.pickupTime}. Reservation ${latestReservation.reservationId}.`
    );
    const rawResult = await executeTool("twilio_sms", {
      to,
      body,
      reservationId: latestReservation.reservationId,
    });
    const result = sanitizeSmsToolResult(rawResult, latestReservation);
    sendEvent({
      type: "toolCallCompleted",
      toolName: "retail_order_confirmation",
      success: result.success,
      result: result.success ? "Order Confirmation SMS sent to the customer." : undefined,
      error: result.error,
      durationMs: result.durationMs,
      timestamp: Date.now(),
    });
    if (result.success) {
      sendEvent({ type: "smsSent", to, timestamp: Date.now() });
      console.log("[VoiceAgent/Browser] Post-call customer SMS sent");
    } else {
      console.error("[VoiceAgent/Browser] Post-call customer SMS failed:", result.error);
    }
  }

  function clearBrowserIdleFollowUp(): void {
    if (idleFollowUpTimer) {
      clearTimeout(idleFollowUpTimer);
      idleFollowUpTimer = null;
    }
  }

  function clearBrowserUserTurnResponseWatchdog(): void {
    if (userTurnResponseTimer) {
      clearTimeout(userTurnResponseTimer);
      userTurnResponseTimer = null;
    }
  }

  function scheduleBrowserUserTurnResponseWatchdog(reason: string): void {
    clearBrowserUserTurnResponseWatchdog();
    userTurnResponseTimer = setTimeout(() => {
      userTurnResponseTimer = null;
      if (!openai || pendingEndCall || endingCall || responseActive) return;
      console.warn(`[VoiceAgent/Browser] Retrying stalled response after accepted user turn: ${reason}`);
      openai.triggerResponse({
        input: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: getRetryAcceptedUserTurnPrompt(lastUserTranscript),
              },
            ],
          },
        ],
        output_modalities: ["audio"],
      });
    }, ACCEPTED_USER_TURN_RESPONSE_TIMEOUT_MS);
  }

  function sendBrowserFunctionOutput(callId: string, output: string, createResponse = true): void {
    openai?.sendFunctionOutput(callId, output, createResponse);
    if (createResponse) {
      scheduleBrowserUserTurnResponseWatchdog("function output response did not start");
    }
  }

  function hasActiveBrowserAssistantPlayback(): boolean {
    return responseActive || browserPlaybackActive || Boolean(currentAssistantItemId) || currentAssistantAudioSentMs > 0;
  }

  function clearProvisionalBrowserBargeInRelease(): void {
    if (provisionalBrowserBargeInReleaseTimer) {
      clearTimeout(provisionalBrowserBargeInReleaseTimer);
      provisionalBrowserBargeInReleaseTimer = null;
    }
  }

  function releaseProvisionalBrowserBargeIn(): void {
    clearProvisionalBrowserBargeInRelease();
    if (!provisionalBrowserBargeInActive) return;
    provisionalBrowserBargeInActive = false;
    suppressAssistantOutput = false;
  }

  function clearPendingBrowserUserSpeechCandidate(): void {
    pendingBrowserUserSpeechStartedAt = null;
    pendingBrowserUserSpeechAudioStartMs = null;
    pendingBrowserUserSpeechItemId = null;
    browserTranscriptPreview = "";
  }

  function maybeProvisionallyCutBrowserAssistantPlaybackFromTranscript(text: string): void {
    if (!text.trim()) return;
    if (!hasActiveBrowserAssistantPlayback()) return;
    if (!hasEnoughTranscriptForProvisionalBargeIn(text, { allowBriefValid: true })) return;
    if (
      shouldSuppressBrowserUserTranscript(text, {
        browserPlaybackActive,
        lastAssistantAudioAt,
        lastAssistantDoneAt,
        lastAssistantTranscript: assistantTranscriptGuard || lastAssistantTranscript,
        responseActive,
      })
    ) return;
    provisionallyCutBrowserAssistantPlayback();
  }

  function provisionallyCutBrowserAssistantPlayback(): void {
    if (!openai || pendingEndCall || endingCall || provisionalBrowserBargeInActive) return;
    if (!hasActiveBrowserAssistantPlayback()) return;

    provisionalBrowserBargeInActive = true;
    suppressAssistantOutput = true;
    if (pendingBrowserUserSpeechStartedAt !== null) {
      console.debug("[VoiceAgent/Browser] Accepted provisional barge-in", {
        elapsedMs: Date.now() - pendingBrowserUserSpeechStartedAt,
        itemId: pendingBrowserUserSpeechItemId,
        audioStartMs: pendingBrowserUserSpeechAudioStartMs,
      });
    }
    clearBrowserAssistantPlayback();
    clearProvisionalBrowserBargeInRelease();
    provisionalBrowserBargeInReleaseTimer = setTimeout(() => {
      clearPendingBrowserUserSpeechCandidate();
      releaseProvisionalBrowserBargeIn();
    }, VOICE_PROVISIONAL_BARGE_IN_RELEASE_MS);
  }

  function scheduleBrowserIdleFollowUp(): void {
    clearBrowserIdleFollowUp();
    if (
      assistantTurnCount <= 1 ||
      pendingEndCall ||
      endingCall ||
      idleFollowUpSent ||
      isAssistantWaitingForCallerAnswerTranscript(lastAssistantTranscript)
    ) return;
    idleFollowUpTimer = setTimeout(() => {
      idleFollowUpTimer = null;
      if (
        !openai ||
        responseActive ||
        pendingEndCall ||
        endingCall ||
        idleFollowUpSent ||
        isAssistantWaitingForCallerAnswerTranscript(lastAssistantTranscript)
      ) return;
      idleFollowUpSent = true;
      openai.triggerResponse({
        input: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: getIdleFollowUpInstruction(lastAssistantTranscript),
              },
            ],
          },
        ],
        output_modalities: ["audio"],
        instructions: getIdleFollowUpResponseInstructions(),
      });
    }, POST_RESPONSE_IDLE_FOLLOWUP_MS);
  }

  function startBrowserFinalCheckInResponse(reason: string): void {
    if (!openai || endingCall || pendingEndCall) return;
    pendingBrowserFinalCheckInReason = null;
    browserFinalCheckInAsked = true;
    openai.triggerResponse({
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: getFinalCheckInInstruction(reason),
            },
          ],
        },
      ],
      output_modalities: ["audio"],
      instructions: getFinalCheckInResponseInstructions(),
    });
  }

  function startBrowserAddOnAnswerCheckInResponse(text: string): void {
    if (!openai || endingCall || pendingEndCall) return;
    pendingBrowserAddOnCheckInText = null;
    pendingBrowserFinalCheckInReason = null;
    browserFinalCheckInAsked = true;
    openai.triggerResponse({
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: getAddOnAnswerCheckInPrompt(text, "browser"),
            },
          ],
        },
      ],
      output_modalities: ["audio"],
      instructions: getExactTextResponseInstructions(text),
    });
  }

  function requestBrowserAddOnAnswerCheckIn(text: string): void {
    if (!openai || endingCall || pendingEndCall) return;
    clearBrowserIdleFollowUp();
    if (responseActive) {
      pendingBrowserAddOnCheckInText = text;
      return;
    }
    startBrowserAddOnAnswerCheckInResponse(text);
  }

  function requestBrowserProfileConfirmation(initialIntent: string): void {
    if (!openai || endingCall || pendingEndCall || browserProfileConfirmationAsked || browserProfileConfirmed) return;
    clearBrowserIdleFollowUp();
    browserProfileConfirmationAsked = true;
    openai.triggerResponse({
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: getProfileConfirmationPrompt(initialIntent, "browser"),
            },
          ],
        },
      ],
      output_modalities: ["audio"],
      instructions: getExactTextResponseInstructions(PROFILE_CONFIRMATION_TEXT),
    });
  }

  function requestBrowserFinalCheckIn(reason: string): void {
    if (!openai || endingCall || pendingEndCall) return;
    if (browserFinalCheckInAsked) return;
    clearBrowserIdleFollowUp();
    if (responseActive) {
      pendingBrowserFinalCheckInReason = reason;
      return;
    }
    startBrowserFinalCheckInResponse(reason);
  }

  function startBrowserClosingResponse(reason: string): void {
    if (!openai || endingCall) return;
    pendingBrowserClosingReason = null;
    if (endCallTimer) {
      clearTimeout(endCallTimer);
      endCallTimer = null;
    }
    browserEndCallFallbackStartedAt = null;
    openai.triggerResponse({
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: getClosingInstruction(reason),
            },
          ],
        },
      ],
      output_modalities: ["audio"],
      instructions: getClosingResponseInstructions(),
    });
    scheduleBrowserEndCall(reason, BROWSER_END_CALL_MAX_WAIT_MS);
  }

  function requestBrowserGracefulEndCall(reason: string, source: "tool" | "intent" = "intent"): void {
    if (pendingEndCall || endingCall) return;
    clearBrowserIdleFollowUp();
    pendingEndCall = true;
    sendEvent({
      type: "toolCallStarted",
      toolName: voiceEndCallTool.name,
      args: { reason, source },
      timestamp: Date.now(),
    });
    sendEvent({
      type: "toolCallCompleted",
      toolName: voiceEndCallTool.name,
      success: true,
      result: createEndCallResult(reason).result,
      data: { reason },
      timestamp: Date.now(),
    });
    const alreadySaidClosing = isAssistantClosingTranscript(lastAssistantTranscript);
    if (!alreadySaidClosing) {
      if (responseActive) {
        pendingBrowserClosingReason = reason;
        suppressAssistantOutput = true;
        clearBrowserAssistantPlayback();
        openai?.cancelResponse();
        responseActive = false;
        setTimeout(() => {
          if (pendingBrowserClosingReason !== reason || !pendingEndCall || endingCall) return;
          suppressAssistantOutput = false;
          startBrowserClosingResponse(reason);
        }, 700);
      } else {
        startBrowserClosingResponse(reason);
      }
    } else {
      scheduleBrowserEndCall(reason, END_CALL_FALLBACK_RECHECK_MS);
    }
  }

  function maybeCompleteBrowserPendingEndCall(reason: string): void {
    if (pendingBrowserClosingReason) return;
    if (!pendingEndCall || endingCall || responseActive || browserPlaybackActive) return;
    setTimeout(() => {
      if (pendingBrowserClosingReason) return;
      if (!pendingEndCall || endingCall || responseActive || browserPlaybackActive) return;
      void completeBrowserEndCall(reason);
    }, 700);
  }

  async function runStartupRetailProfileLookup(): Promise<string> {
    const lookupArgs = {};
    sendEvent({
      type: "toolCallStarted",
      toolName: "retail_profile_lookup",
      args: lookupArgs,
      timestamp: Date.now(),
    });
    const profileLookup = await executeTool("retail_profile_lookup", lookupArgs);
    sendEvent({
      type: "toolCallCompleted",
      toolName: "retail_profile_lookup",
      success: profileLookup.success,
      result: profileLookup.result,
      error: profileLookup.error,
      data: profileLookup.data,
      durationMs: profileLookup.durationMs,
      timestamp: Date.now(),
    });

    return [
      `retail_profile_lookup: ${formatJsonForInstructions(profileLookup.data || profileLookup.result || profileLookup.error)}`,
    ].join("\n\n");
  }

  function suppressBrowserAssistantResponse(reason: string): void {
    clearBrowserIdleFollowUp();
    suppressAssistantOutput = true;
    assistantTranscriptGuard = "";
    responseActive = false;
    currentAssistantItemId = "";
    currentAssistantAudioSentMs = 0;
    browserPlaybackStartedAt = 0;
    browserPlaybackActive = false;
    openai?.cancelResponse();
    sendEvent({ type: "interruptClear", timestamp: Date.now() });
    sendEvent({ type: "responseDone" });
    console.warn(`[VoiceAgent/Browser] Response suppressed: ${reason}`);
  }

  function clearBrowserAssistantPlayback(): boolean {
    const hadPlayback =
      responseActive ||
      browserPlaybackActive ||
      Boolean(currentAssistantItemId) ||
      currentAssistantAudioSentMs > 0;
    if (!hadPlayback) return false;

    truncateBrowserAssistantAudio();
    browserPlaybackActive = false;
    currentAssistantItemId = "";
    currentAssistantAudioSentMs = 0;
    browserPlaybackStartedAt = 0;
    sendEvent({ type: "interruptClear", timestamp: Date.now() });
    return true;
  }

  function respondToAcceptedBrowserUserTurn(): void {
    if (!openai || pendingEndCall || endingCall) return;

    const interruptedAssistant =
      responseActive ||
      browserPlaybackActive ||
      Boolean(currentAssistantItemId) ||
      pendingBrowserUserSpeechStartedAt !== null;

    if (interruptedAssistant) {
      clearBrowserAssistantPlayback();
      sendEvent({ type: "bargeInDetected", timestamp: Date.now() });
    }

    if (responseActive) {
      suppressAssistantOutput = true;
      openai.cancelResponse();
      responseActive = false;
      setTimeout(() => {
        if (!openai || pendingEndCall || endingCall) return;
        suppressAssistantOutput = false;
        openai.triggerResponse();
        scheduleBrowserUserTurnResponseWatchdog("cancelled interrupted assistant response did not restart");
      }, interruptedAssistant ? 150 : 0);
      return;
    }

    openai.triggerResponse();
    scheduleBrowserUserTurnResponseWatchdog("accepted user turn response did not start");
  }

  function scheduleInitialGreetingRelease(delayMs: number): void {
    if (initialGreetingReleaseTimer) {
      clearTimeout(initialGreetingReleaseTimer);
    }
    initialGreetingReleaseTimer = setTimeout(() => {
      initialGreetingActive = false;
      browserInputEnabled = true;
      initialGreetingReleaseTimer = null;
    }, delayMs);
  }

  function truncateBrowserAssistantAudio(): void {
    if (!currentAssistantItemId) return;
    const playbackElapsedMs = browserPlaybackStartedAt ? Date.now() - browserPlaybackStartedAt : 0;
    const audioEndMs = Math.max(
      0,
      Math.min(Math.round(playbackElapsedMs), Math.round(currentAssistantAudioSentMs))
    );
    openai?.truncateResponse(currentAssistantItemId, audioEndMs);
  }

  function sendEvent(event: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }
}
