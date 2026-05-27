import type { RawData } from "ws";

const OPENAI_BEST_QUALITY_REALTIME_VOICES = new Set(["marin", "cedar"]);

export function mapRealtimeVoice(voice: string): string {
  const normalized = String(voice || "").trim().toLowerCase();
  return OPENAI_BEST_QUALITY_REALTIME_VOICES.has(normalized) ? normalized : "marin";
}

export function resolveRealtimeVoice(voice: string, gender?: string): string {
  const normalizedVoice = String(voice || "").trim().toLowerCase();
  const normalizedGender = String(gender || "").trim().toLowerCase();

  if (OPENAI_BEST_QUALITY_REALTIME_VOICES.has(normalizedVoice)) return normalizedVoice;
  if (normalizedGender === "male") return "cedar";

  return "marin";
}

export function rawAudioToBase64(raw: RawData): string {
  if (Buffer.isBuffer(raw)) return raw.toString("base64");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("base64");
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("base64");
  }
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("base64");
  return Buffer.from(raw as any).toString("base64");
}

export function getPcm16DurationMs(base64Audio: string, sampleRate: number): number {
  const byteLength = Buffer.byteLength(base64Audio, "base64");
  const samples = byteLength / 2;
  return (samples / sampleRate) * 1000;
}

export function getG711DurationMs(base64Audio: string, sampleRate: number): number {
  const byteLength = Buffer.byteLength(base64Audio, "base64");
  return (byteLength / sampleRate) * 1000;
}
