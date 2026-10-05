export function hasHrDeliveryClosing(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[’‘]/g, "'");
  return /summary/.test(normalized) && /webex/.test(normalized)
    && /\b(sent|delivered)\b/.test(normalized)
    && /\b(?:have a (?:nice|great|good|wonderful) day|enjoy (?:the rest of )?your day)\b/.test(normalized);
}

// Nudge only on a stalled or incomplete closing. Never repeat delivery or
// interrupt ongoing speech just because a fixed timer elapsed.
export function shouldNudgeHrClosing(input: {
  attempts: number; sinceNudgeMs: number; transcriptQuietMs: number;
  audioLevel: number | null; text: string;
}): boolean {
  if (input.attempts >= 3 || hasHrDeliveryClosing(input.text)) return false;
  if (input.audioLevel !== null && input.audioLevel >= 0.015) return false;
  return input.sinceNudgeMs > 10000 && input.transcriptQuietMs > 5000;
}
