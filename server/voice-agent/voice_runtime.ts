import {
  classifyAddOnOfferAnswer,
  classifyFinalCheckInAnswer,
  isAssistantAddOnOfferTranscript,
  isAssistantProfileConfirmationTranscript,
  isNoMoreHelpAnswerTranscript,
  isStandaloneFinalCheckInTranscript,
} from "./answer-intent";
import { FINAL_CLOSING_TEXT, getAddOnAnswerCheckInText } from "./prompt";

type AcceptedUserTurnAction =
  | { type: "request_profile_confirmation"; initialIntent: string }
  | { type: "request_add_on_check_in"; text: string }
  | { type: "request_final_check_in"; reason: string }
  | { type: "request_graceful_end_call"; reason: string }
  | { type: "respond" };

export type AcceptedUserTurnDecision = {
  pendingAddOnOffer: boolean;
  pendingPickupProposal: boolean;
  finalCheckInAsked: boolean;
  action: AcceptedUserTurnAction;
};

export type AcceptedUserTurnOptions = {
  text: string;
  lastAssistantTranscript: string;
  pendingAddOnOffer: boolean;
  pendingPickupProposal: boolean;
  finalCheckInAsked: boolean;
  profileConfirmationNeeded: boolean;
  softDeclineReason: string;
  endCallReason: string;
};

export type AssistantTranscriptEffects = {
  pendingAddOnOffer: boolean;
  profileConfirmationAsked: boolean;
  finalCheckInAsked: boolean;
  deliveredClosing: boolean;
};

function normalizeIntentText(text: string): string {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,\s]+$/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isEndCallIntent(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (!normalized) return false;
  if (/\b(dont|do not|not)\s+(end|hang up|disconnect|stop)\b/.test(normalized)) return false;
  if (isNoMoreHelpAnswerTranscript(normalized)) return true;
  if (/^(bye|goodbye|bye bye|thanks bye|thank you bye|ok bye|okay bye)$/.test(normalized)) return true;
  if (/^(thats all|that is all|im done|i am done|were done|we are done|no thats all|no that is all)$/.test(normalized)) return true;
  if (/^(thats|that is|thatll be|that will be) all( i (had|have|needed|need))?$/.test(normalized)) return true;
  if (/^(no )?(im|i am) (good|all set|fine|ok|okay)( thank(s| you))?( thats all( i (had|have))?)?$/.test(normalized)) return true;
  if (/^no (thank(s| you) )?(im|i am) (good|all set|fine|ok|okay)( thank(s| you))?$/.test(normalized)) return true;
  if (/^no (thank(s| you) )?(thats|that is) all( i (had|have|needed|need))?$/.test(normalized)) return true;
  if (/^(end|stop|disconnect|hang up)( the)? (call|conversation)$/.test(normalized)) return true;
  if (/^(please )?(end|stop|disconnect|hang up)( this| the)? (call|conversation)( please)?$/.test(normalized)) return true;
  if (/^(you can|you may|go ahead and) (hang up|end the call|disconnect)$/.test(normalized)) return true;
  if (/^(nothing else|no more questions|no i dont need anything else|no i do not need anything else|i dont need anything else|i do not need anything else|no i dont want anything else|no i do not want anything else|i dont want anything else|i do not want anything else|no thank you thats all)$/.test(normalized)) return true;
  return false;
}

export function isDefiniteEndCallIntent(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (!normalized) return false;
  if (/\b(dont|do not|not)\s+(end|hang up|disconnect|stop)\b/.test(normalized)) return false;
  return (
    /^(bye|goodbye|bye bye|thanks bye|thank you bye|ok bye|okay bye)$/.test(normalized) ||
    /^(thats all|that is all|im done|i am done|were done|we are done|no thats all|no that is all)$/.test(normalized) ||
    /^(thats|that is|thatll be|that will be) all( i (had|have|needed|need))?$/.test(normalized) ||
    /^(end|stop|disconnect|hang up)( the)? (call|conversation)$/.test(normalized) ||
    /^(please )?(end|stop|disconnect|hang up)( this| the)? (call|conversation)( please)?$/.test(normalized) ||
    /^(you can|you may|go ahead and) (hang up|end the call|disconnect)$/.test(normalized) ||
    /^(nothing else|no more questions|no i dont need anything else|no i do not need anything else|i dont need anything else|i do not need anything else|no i dont want anything else|no i do not want anything else|i dont want anything else|i do not want anything else|no thank you thats all)$/.test(normalized)
  );
}

export function hasFinalCheckInBeenAsked(lastAssistantTranscript: string, finalCheckInAsked: boolean): boolean {
  return finalCheckInAsked || isStandaloneFinalCheckInTranscript(lastAssistantTranscript);
}

function isSoftDeclineTranscript(text: string): boolean {
  const normalized = normalizeIntentText(text);
  return /^(no thanks|no thank you|im good|i am good|im good with that|i am good with that|no im good|no i am good|no im good with that|no i am good with that|im all set|i am all set|no im all set|no i am all set|thats okay|that is okay|no thats okay|no that is okay)$/.test(normalized);
}

function isNegativeAnswerTranscript(text: string): boolean {
  return /^(no|nope|nah|no thanks|no thank you)$/i.test(normalizeIntentText(text)) || isNoMoreHelpAnswerTranscript(text);
}

function isAffirmativeAnswerTranscript(text: string): boolean {
  return /^(yes|yeah|yep|yup|sure|ok|okay|perfect|great|sounds good|that sounds good|that works|that works for me|yes that works|yeah that works|sure that works|yes please|please do)\b/.test(normalizeIntentText(text));
}

export function canEndCallFromUserTranscript(text: string, lastAssistantTranscript: string, finalCheckInAsked = false): boolean {
  if (isDefiniteEndCallIntent(text)) return true;
  const checkInWasAsked = hasFinalCheckInBeenAsked(lastAssistantTranscript, finalCheckInAsked);
  return checkInWasAsked && (isEndCallIntent(text) || isNegativeAnswerTranscript(text));
}

export function shouldAskFinalCheckInBeforeEnding(text: string, lastAssistantTranscript: string, finalCheckInAsked = false): boolean {
  if (hasFinalCheckInBeenAsked(lastAssistantTranscript, finalCheckInAsked)) return false;
  if (isDefiniteEndCallIntent(text)) return false;
  return isSoftDeclineTranscript(text) || isEndCallIntent(text);
}

export function isAssistantClosingTranscript(text: string): boolean {
  return normalizeIntentText(text).includes(normalizeIntentText(FINAL_CLOSING_TEXT));
}

export function getAcceptedUserTurnDecision(options: AcceptedUserTurnOptions): AcceptedUserTurnDecision {
  const finalCheckInWasAsked = hasFinalCheckInBeenAsked(
    options.lastAssistantTranscript,
    options.finalCheckInAsked
  );
  let pendingAddOnOffer = options.pendingAddOnOffer;
  let pendingPickupProposal = options.pendingPickupProposal;
  let finalCheckInAsked = options.finalCheckInAsked;

  if (options.profileConfirmationNeeded) {
    return {
      pendingAddOnOffer,
      pendingPickupProposal,
      finalCheckInAsked,
      action: { type: "request_profile_confirmation", initialIntent: options.text },
    };
  }

  if (pendingAddOnOffer) {
    pendingAddOnOffer = false;
    const addOnAnswer = classifyAddOnOfferAnswer(options.text);
    if ((addOnAnswer === "negative" || addOnAnswer === "positive") && !isDefiniteEndCallIntent(options.text)) {
      return {
        pendingAddOnOffer,
        pendingPickupProposal,
        finalCheckInAsked,
        action: { type: "request_add_on_check_in", text: getAddOnAnswerCheckInText(addOnAnswer) },
      };
    }
  }

  const finalCheckInAnswer = finalCheckInWasAsked
    ? classifyFinalCheckInAnswer(options.text)
    : "unknown";
  if (finalCheckInAnswer === "positive") {
    finalCheckInAsked = false;
  }

  if (pendingPickupProposal && isAffirmativeAnswerTranscript(options.text)) {
    pendingPickupProposal = false;
    return {
      pendingAddOnOffer,
      pendingPickupProposal,
      finalCheckInAsked,
      action: { type: "respond" },
    };
  }

  if (shouldAskFinalCheckInBeforeEnding(options.text, options.lastAssistantTranscript, finalCheckInWasAsked)) {
    return {
      pendingAddOnOffer,
      pendingPickupProposal,
      finalCheckInAsked,
      action: { type: "request_final_check_in", reason: options.softDeclineReason },
    };
  }

  if (canEndCallFromUserTranscript(options.text, options.lastAssistantTranscript, finalCheckInWasAsked)) {
    return {
      pendingAddOnOffer,
      pendingPickupProposal,
      finalCheckInAsked: finalCheckInWasAsked,
      action: { type: "request_graceful_end_call", reason: options.endCallReason },
    };
  }

  return {
    pendingAddOnOffer,
    pendingPickupProposal: false,
    finalCheckInAsked,
    action: { type: "respond" },
  };
}

export function getAssistantTranscriptEffects(text: string): AssistantTranscriptEffects {
  return {
    pendingAddOnOffer: isAssistantAddOnOfferTranscript(text),
    profileConfirmationAsked: isAssistantProfileConfirmationTranscript(text),
    finalCheckInAsked: isStandaloneFinalCheckInTranscript(text),
    deliveredClosing: isAssistantClosingTranscript(text),
  };
}
