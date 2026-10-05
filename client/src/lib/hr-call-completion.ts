export function hasHrClosingFinished(input: {
  responseSeen: boolean;
  speechHeard: boolean;
  audioLevel: number | null;
  quietForMs: number;
  transcriptQuietForMs: number;
  closingText: string;
}): boolean {
  if (!input.responseSeen) return false;
  if (input.audioLevel !== null) {
    return input.speechHeard && input.audioLevel < 0.015
      && input.quietForMs > 1200 && input.transcriptQuietForMs > 1200;
  }
  // Fallback only for browsers without receiver-level audio measurements.
  const words = input.closingText.trim().split(/\s+/).length;
  return input.transcriptQuietForMs > Math.max(6000, words / 2.5 * 1000 + 2000);
}
