export const TWILIO_TRANSCRIPT_ECHO_GUARD_MS = 1200;
export const TWILIO_ASSISTANT_ECHO_MATCH_MS = 10000;
export const TWILIO_BARGE_IN_SPEECH_START_GUARD_MS = 250;
export const POST_RESPONSE_IDLE_FOLLOWUP_MS = 7000;
export const TWILIO_END_CALL_FALLBACK_MS = 9000;
export const VOICE_PROVISIONAL_BARGE_IN_RELEASE_MS = 5000;
export const BROWSER_END_CALL_FALLBACK_MS = 7000;
export const END_CALL_FALLBACK_RECHECK_MS = 1000;
export const TWILIO_END_CALL_MAX_WAIT_MS = 22000;
export const BROWSER_END_CALL_MAX_WAIT_MS = 18000;
export const ACCEPTED_USER_TURN_RESPONSE_TIMEOUT_MS = 3200;

export const REALTIME_TRANSCRIPTION_LANGUAGE = "en";
export const REALTIME_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
export const TRANSCRIPT_CORRECTION_MODEL = process.env.OPENAI_TRANSCRIPT_CORRECTION_MODEL || "gpt-4o-mini";

export const RETAIL_VOICE_PRODUCT_TERMS = new Set([
  "accessories",
  "airpods",
  "case",
  "charger",
  "earbuds",
  "headphones",
  "laptop",
  "pencil",
  "phone",
  "smartwatch",
  "tablet",
]);
