/**
 * The caller's most recent utterance from GPT-Live input-transcript fragments.
 *
 * Fragments carry timeline positions (start_ms / end_ms). Background speech and earlier turns sit in the same
 * transcript, so the question is the run of fragments leading up to the delegation with no long pause inside it.
 */
export interface TranscriptFragment { text: string; startMs: number; endMs: number }

const MAX_PAUSE_MS = 1000;
const MAX_WORDS = 30;

export function lastUtterance(fragments: TranscriptFragment[], delegationOffsetMs?: number): string {
  // ignore fragments that begin well after the delegation point (they belong to whatever was said next)
  const usable = fragments.filter((fragment) => delegationOffsetMs === undefined || fragment.startMs <= delegationOffsetMs + 1500);
  if (!usable.length) return "";
  const picked: TranscriptFragment[] = [usable[usable.length - 1]];
  for (let i = usable.length - 2; i >= 0; i--) {
    if (picked[0].startMs - usable[i].endMs > MAX_PAUSE_MS) break;
    picked.unshift(usable[i]);
  }
  const words = picked.map((fragment) => fragment.text).join("").trim().split(/\s+/);
  return words.slice(-MAX_WORDS).join(" ");
}
