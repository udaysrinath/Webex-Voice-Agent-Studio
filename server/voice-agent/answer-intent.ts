export type FinalCheckInAnswerIntent = "negative" | "positive" | "unknown";
export type AddOnOfferAnswerIntent = "negative" | "positive" | "unknown";

function normalizeAnswerText(text: string): string {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,\s]+$/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stripLeadingDiscourseMarkers(text: string): string {
  let normalized = text;
  const markerPattern = /^(uh|um|hm|hmm|well|so|okay|ok|alright|right|cool|great|perfect|thanks|thank you|yes|yeah|yep|yup|sure|actually|you know)\s+(.+)$/;
  while (true) {
    const next = normalized.replace(markerPattern, "$2").trim();
    if (next === normalized) return normalized;
    normalized = next;
  }
}

function hasAdditionalHelpRequest(text: string): boolean {
  if (!text) return false;
  if (/\b(dont|do not|no need|not now|not right now)\b.*\b(need|want|have|anything|something|else|more)\b/.test(text)) {
    return false;
  }
  const negativeLeadInRequest =
    /^(no|nope|nah|not really|negative)\s+(but\s+|actually\s+|i think\s+|i guess\s+|maybe\s+|i mean\s+|)?/.test(text) &&
    (
      /\b(how about|what about|instead|another|different|change|switch|move|reschedule|pickup|pick it up|pick up|reserve|hold)\b/.test(text) ||
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|morning|afternoon|evening|tonight|am|pm|oclock|o clock)\b/.test(text) ||
      /\b(palo alto|fremont|san jose)\b/.test(text) ||
      /\b((can|could|would|will)\s+you|i\s+(still\s+)?(need|want|would like|have)|we\s+(still\s+)?(need|want|would like|have))\b/.test(text)
    );
  return (
    negativeLeadInRequest ||
    /^(yes|yeah|yep|yup|sure|please|absolutely|definitely|i do|we do|i have|we have|there is|theres|there are)\b/.test(text) ||
    /^(can|could|would|will)\s+you\b/.test(text) ||
    /^(i|we)\s+(still\s+)?(need|want|would like|have|am looking for|are looking for|am looking|are looking)\b/.test(text) ||
    /\bi\s+(said\s+)?(still\s+)?want\s+to\s+(pick|pick up|reserve|hold|change|move|set)\b/.test(text) ||
    /^(help me|show me|tell me|find|look up|check|reserve|add|change|cancel|send)\b/.test(text) ||
    /^(do you have|is there|are there|what about|how about)\b/.test(text) ||
    /\b(what about|how about)\b/.test(text) ||
    /\b(one more thing|another thing|something else|one question|quick question|another question|i have a question|i have another question)\b/.test(text) ||
    /\b(also|actually)\b.*\b(can|could|would|need|want|looking|check|find|show|reserve|add|change|send)\b/.test(text) ||
    /^(no|nope|nah)\s+(but\s+|actually\s+|i think\s+|i guess\s+|maybe\s+)?((can|could|would|will)\s+you|i\s+(still\s+)?(need|want|would like|have)|we\s+(still\s+)?(need|want|would like|have))\b/.test(text)
  );
}

export function isAnythingElseCheckInTranscript(text: string): boolean {
  const normalized = normalizeAnswerText(text);
  return /\b(anything else|anything more|something else|anything i can help|else i can help|need anything else|help with anything else)\b/.test(normalized);
}

export function isAssistantAddOnOfferTranscript(text: string): boolean {
  const normalized = normalizeAnswerText(text);
  if (!normalized) return false;
  const offersAccessory =
    /\b(would you like|do you want|should i|can i|shall i)\b.*\b(add|include|reserve|hold|set aside)\b/.test(normalized) ||
    /\b(add|include|reserve|hold|set aside)\b.*\b(for you|to go along|with it|with that|for the)\b/.test(normalized);
  const mentionsAccessory =
    /\b(add on|addon|accessory|case|cover|folio|protector|charger|keyboard|pencil|stylus|band|headphones|earbuds)\b/.test(normalized);
  return offersAccessory && mentionsAccessory;
}

export function isCombinedAddOnAndFinalCheckInTranscript(text: string): boolean {
  return isAssistantAddOnOfferTranscript(text) && isAnythingElseCheckInTranscript(text);
}

export function isStandaloneFinalCheckInTranscript(text: string): boolean {
  return isAnythingElseCheckInTranscript(text) && !isCombinedAddOnAndFinalCheckInTranscript(text);
}

export function isAssistantWaitingForCallerAnswerTranscript(text: string): boolean {
  const raw = String(text || "").toLowerCase();
  const normalized = normalizeAnswerText(text);
  return (
    raw.includes("?") ||
    /\b(would you like|would you prefer|if youd like|if you would like|if you want|if you need|if you prefer|what time|what day|what date|when would|which store|which one|does that work|can you confirm|could you confirm|please confirm|confirm your|let me know|tell me what|tell me when)\b/.test(normalized) ||
    /\b(i can|i could|i can also|i could also|i can help|i could help|we can|we could)\b.*\b(check|look up|confirm|look at|find|show|walk through|compare)\b.*\b(availability|preferred pickup store|pickup store|store|next|other|different|alternative|alternatives|models|options|colors)\b/.test(normalized) ||
    /\b(if you want|if you need|if you prefer|if youd like|if you would like)\b.*\b(other|different|alternative|alternatives|models|options|colors|look at|help you)\b/.test(normalized)
  );
}

export function isAssistantProfileConfirmationTranscript(text: string): boolean {
  const normalized = normalizeAnswerText(text);
  return (
    /\b(profile|phone number|caller id)\b.*\b(confirm|verify)\b.*\b(first and last name|name|last name)\b/.test(normalized) ||
    /\b(confirm|verify|please confirm)\b.*\b(first and last name|your name|last name)\b/.test(normalized)
  );
}

export function isIncompleteUserRequestTranscript(text: string): boolean {
  const normalized = normalizeAnswerText(text);
  if (!normalized) return false;
  const withoutGreeting = normalized.replace(/^(hi|hello|hey|hi there|hello there|hey there)\s+/, "");
  return (
    /^(i was|id like to|i would like to|i want to|i need to|im looking to|i am looking to|im calling to|i am calling to|i was trying to|i was calling to|im calling about|i am calling about|i was calling about|i want|i need|im looking for|i am looking for)$/.test(withoutGreeting) ||
    /\b(id like to|i would like to|i want to|i need to|im looking to|i am looking to|im calling to|i am calling to|i was trying to|i was calling to|im calling about|i am calling about|i was calling about)$/.test(withoutGreeting)
  );
}

function startsWithNegativeAnswer(text: string): boolean {
  return /^(no|nope|nah|not really|negative)\b/.test(text);
}

function isNegativeNoMoreHelpAnswer(text: string): boolean {
  if (!text) return false;
  return (
    /^(no|nope|nah|not really|no worries)$/.test(text) ||
    /^(no|nope|nah)\s+(thanks|thank you)\s+(im|i am)\s+(good|okay|ok|fine|all good|all set)(\s+(thanks|thank you))?$/.test(text) ||
    /^(no|nope|nah)\s+(thanks|thank you)\s+(thats all|that is all|thats it|that is it|all good|nothing else)$/.test(text) ||
    /^(no|nope|nah)\s+(thanks|thank you|im good|i am good|im okay|i am okay|im ok|i am ok|im fine|i am fine|im all good|i am all good|im all set|i am all set|all good|all set|thats all|that is all|thats all good|that is all good|thats it|that is it|that should do it|thatll do it|nothing else|not right now|not at the moment|not today|no more|no more questions)(\s+(thanks|thank you))?$/.test(text) ||
    /^(all good|all set|im good|i am good|im okay|i am okay|im ok|i am ok|im fine|i am fine|im all good|i am all good|im all set|i am all set|were good|we are good|were all set|we are all set)(\s+(for now|thanks|thank you))?$/.test(text) ||
    /^(thats all|that is all|thats it|that is it|thats about it|that is about it|thats everything|that is everything|that should do it|thatll do it|that will do it|that does it|that should be all|that should be it|this is all|this is it)(\s+(thanks|thank you))?$/.test(text) ||
    /^(good|thats good|that is good|that sounds good|that works|that should work)(\s+(for now|right now))?$/.test(text) ||
    /^(nothing else|nothing more|no more questions|no other questions|no further questions|not right now|not at the moment|not today|not for now)$/.test(text) ||
    /^(i|we)\s+(dont|do not)\s+(need|want|have)\s+(anything|something)?\s*(else|more|right now|at the moment|today)?$/.test(text) ||
    /^(i think|i believe|i guess)?\s*(thats all|that is all|thats it|that is it|thats good|that is good|that sounds good|that works|that should work|were good|we are good|im good|i am good|im all set|i am all set)(\s+(for now|right now))?$/.test(text) ||
    /^(thanks|thank you|appreciate it|thanks a lot|thank you so much)(\s+(thats all|that is all|im good|i am good|im all set|i am all set))?$/.test(text)
  );
}

export function classifyFinalCheckInAnswer(text: string): FinalCheckInAnswerIntent {
  const normalized = normalizeAnswerText(text);
  if (!normalized) return "unknown";
  const stripped = stripLeadingDiscourseMarkers(normalized);

  if (isNegativeNoMoreHelpAnswer(stripped) || isNegativeNoMoreHelpAnswer(normalized)) {
    return "negative";
  }
  if (hasAdditionalHelpRequest(stripped) || hasAdditionalHelpRequest(normalized)) {
    return "positive";
  }
  if (startsWithNegativeAnswer(stripped) || startsWithNegativeAnswer(normalized)) {
    return "negative";
  }
  return "unknown";
}

export function classifyAddOnOfferAnswer(text: string): AddOnOfferAnswerIntent {
  const normalized = normalizeAnswerText(text);
  if (!normalized) return "unknown";
  const stripped = stripLeadingDiscourseMarkers(normalized);

  if (
    /^(no|nope|nah)\b/.test(stripped) ||
    /^(no thanks|no thank you|ill pass|i will pass|pass|skip|not interested|im not interested|i am not interested|im good|i am good|im all good|i am all good|all good|no need)\b/.test(stripped) ||
    /\b(dont add|do not add|dont include|do not include|dont want|do not want|leave it off|without that|pass on that|not interested in that|not needed|no need)\b/.test(stripped)
  ) {
    return "negative";
  }

  if (
    /^(yes|yeah|yep|yup|sure|please|ok|okay|absolutely|definitely|sounds good|that sounds good|great)\b/.test(stripped) ||
    /\b(add it|add that|include it|include that|reserve it|reserve that|take it|ill take it|i will take it|interested in that|i want that|id like that|i would like that)\b/.test(stripped)
  ) {
    return "positive";
  }

  return "unknown";
}

export function isNoMoreHelpAnswerTranscript(text: string): boolean {
  return classifyFinalCheckInAnswer(text) === "negative";
}
