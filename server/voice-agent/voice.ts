const OPENAI_REALTIME_VOICE_MAP: Record<string, string> = {
  alloy: "alloy",
  echo: "echo",
  fable: "ash",
  nova: "shimmer",
  onyx: "echo",
  shimmer: "shimmer",
  "aura-asteria-en": "alloy",
  "aura-luna-en": "shimmer",
  "aura-stella-en": "shimmer",
  "aura-orion-en": "echo",
  "aura-arcas-en": "ash",
  "aura-perseus-en": "echo",
};

const VALID_OPENAI_REALTIME_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
]);

export function mapRealtimeVoice(voice: string): string {
  const normalized = String(voice || "").trim().toLowerCase();
  if (VALID_OPENAI_REALTIME_VOICES.has(normalized)) return normalized;
  return OPENAI_REALTIME_VOICE_MAP[normalized] || "alloy";
}
