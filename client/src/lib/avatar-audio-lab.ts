/**
 * The audio GPT-Live speaks is relayed to the ANAM avatar as 16 kHz PCM. This module is the single place that audio
 * passes through on the way, and it exists so the "buzzing on the Webex device" investigation can be done on the device:
 * every suspected cause has a switch (gain, chunking and pre-buffering, sequence end, local interruption), plus meters
 * and a WAV capture of exactly what is sent. Defaults reproduce the previous behaviour.
 */
export interface LabConfig {
  /** Gain applied before sending, with a soft limiter above -3 dBFS. GPT-Live's output is quiet (about -29 dBFS RMS). */
  gainDb: number;
  /** Send audio to ANAM in chunks of at least this many ms (the worklet produces 20 ms packets). */
  chunkMs: number;
  /** At the start of each utterance, hold this much audio before sending anything, to absorb main-thread stalls. */
  prebufferMs: number;
  /** End the ANAM audio sequence after this many ms without audio (GPT-Live never says when it has finished). 0 = never. */
  idleEndMs: number;
  /** Call interruptPersona() when the caller starts speaking. Off lets GPT-Live stop its own audio instead. */
  localInterrupt: boolean;
  /** Sample rate of the PCM sent to ANAM. ANAM's engine runs at 24 kHz and GPT-Live produces 24 kHz, so 24000 avoids a resample. */
  rate: number;
}

/**
 * The avatar's output carried a 50 Hz click train (harmonics at 51.7, 100, 149, 202 and 248 Hz in the 9-20 kHz band,
 * which the 16 kHz input cannot contain) matching the 20 ms chunking. On the Webex device 200 ms chunks reduced the
 * buzz a lot, but sending 24 kHz (ANAM's engine rate, and GPT-Live's native rate) removed it completely, so packets
 * can go out one by one (20 ms, no added latency).
 * See the buzzing notes in the README.
 */
export const DEFAULT_LAB_CONFIG: LabConfig = { gainDb: 0, chunkMs: 20, prebufferMs: 0, idleEndMs: 0, localInterrupt: true, rate: 24000 };

export function configFromParams(params: URLSearchParams): LabConfig {
  const number = (key: string, fallback: number) => { const value = Number(params.get(key)); return params.has(key) && Number.isFinite(value) ? value : fallback; };
  return {
    gainDb: number("gain", DEFAULT_LAB_CONFIG.gainDb),
    chunkMs: Math.max(20, number("chunk", DEFAULT_LAB_CONFIG.chunkMs)),
    prebufferMs: Math.max(0, number("prebuffer", DEFAULT_LAB_CONFIG.prebufferMs)),
    idleEndMs: Math.max(0, number("idleend", DEFAULT_LAB_CONFIG.idleEndMs)),
    localInterrupt: params.get("interrupt") !== "off",
    rate: [16000, 24000, 48000].includes(number("rate", DEFAULT_LAB_CONFIG.rate)) ? number("rate", DEFAULT_LAB_CONFIG.rate) : DEFAULT_LAB_CONFIG.rate,
  };
}

/** The settings as URL parameters, so a combination found in the panel survives a reload. */
export function configToParams(config: LabConfig): URLSearchParams {
  return new URLSearchParams({ gain: String(config.gainDb), chunk: String(config.chunkMs), prebuffer: String(config.prebufferMs), idleend: String(config.idleEndMs), interrupt: config.localInterrupt ? "on" : "off", rate: String(config.rate) });
}

export interface LabStats {
  packets: number;
  /** Longest wait between two 20 ms worklet packets, and how many exceeded 60 ms: the main thread stalling. */
  maxGapMs: number;
  gapsOver60: number;
  sentChunks: number;
  sentMs: number;
  /** Levels of the audio sent, over the most recent ~0.5 s. */
  peakDb: number;
  rmsDb: number;
  /** Samples at or beyond -0.1 dBFS after gain (clipping). */
  clipped: number;
  endSequences: number;
  interrupts: number;
  /** Times the caller's speech was detected while the avatar was speaking (echo or a real interruption). */
  speechWhileSpeaking: number;
}

const FULL_SCALE = 32768;
const KNEE = 0.7; // about -3 dBFS
const CEILING = 0.891; // -1 dBFS: the limiter never reaches full scale
export const toDb = (linear: number) => (linear > 0 ? 20 * Math.log10(linear) : -Infinity);

/** Linear gain with a soft knee above -3 dBFS and a -1 dBFS ceiling, so added gain compresses peaks instead of hard-clipping them. */
export function applyGain(input: Int16Array, gainDb: number): Int16Array {
  if (gainDb === 0) return input;
  const gain = 10 ** (gainDb / 20);
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    let y = (input[i] / FULL_SCALE) * gain;
    const magnitude = Math.abs(y);
    if (magnitude > KNEE) y = Math.sign(y) * (KNEE + (CEILING - KNEE) * Math.tanh((magnitude - KNEE) / (CEILING - KNEE)));
    out[i] = Math.max(-FULL_SCALE, Math.min(FULL_SCALE - 1, Math.round(y * FULL_SCALE)));
  }
  return out;
}

export function pcmToWav(samples: Int16Array, sampleRate: number): Blob {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  return new Blob([header, samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength) as ArrayBuffer], { type: "audio/wav" });
}

const RECORD_SECONDS = 10;
const UTTERANCE_GAP_MS = 300;
/** Audio held back in a partial chunk is sent after this long without new packets, so sentence endings are never stuck in the buffer. */
const TAIL_FLUSH_MS = 60;

export class AudioLab {
  readonly stats: LabStats = { packets: 0, maxGapMs: 0, gapsOver60: 0, sentChunks: 0, sentMs: 0, peakDb: -Infinity, rmsDb: -Infinity, clipped: 0, endSequences: 0, interrupts: 0, speechWhileSpeaking: 0 };
  private pending: Int16Array[] = [];
  private pendingSamples = 0;
  private holding = false;
  private sequenceOpen = false;
  private lastPacketAt = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private tailTimer: ReturnType<typeof setTimeout> | undefined;
  private ring: Int16Array[] = [];
  private ringSamples = 0;
  private windowSquares = 0;
  private windowSamples = 0;
  private windowPeak = 0;

  constructor(
    public config: LabConfig,
    private readonly sampleRate: number,
    private readonly send: (chunk: ArrayBuffer) => void,
    private readonly endSequenceNow: () => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** One 20 ms packet from the worklet. */
  push(packet: ArrayBuffer): void {
    if (!packet.byteLength) return;
    const at = this.now();
    if (this.lastPacketAt) {
      const gap = at - this.lastPacketAt;
      if (gap <= UTTERANCE_GAP_MS) { this.stats.maxGapMs = Math.max(this.stats.maxGapMs, gap); if (gap > 60) this.stats.gapsOver60 += 1; }
    }
    const startsUtterance = !this.lastPacketAt || at - this.lastPacketAt > UTTERANCE_GAP_MS || !this.sequenceOpen;
    this.lastPacketAt = at;
    this.stats.packets += 1;
    if (startsUtterance && this.config.prebufferMs > 0) this.holding = true;
    this.sequenceOpen = true;

    const samples = applyGain(new Int16Array(packet.slice(0)), this.config.gainDb);
    this.measure(samples);
    this.record(samples);
    this.pending.push(samples);
    this.pendingSamples += samples.length;
    const pendingMs = (this.pendingSamples / this.sampleRate) * 1000;
    if (this.holding) { if (pendingMs >= this.config.prebufferMs) { this.holding = false; this.flush(); } }
    else if (pendingMs >= this.config.chunkMs) this.flush();
    this.scheduleIdleEnd();
    clearTimeout(this.tailTimer);
    this.tailTimer = setTimeout(() => { this.holding = false; this.flush(); }, TAIL_FLUSH_MS);
  }

  /** Send everything held back. */
  flush(): void {
    if (!this.pendingSamples) return;
    const merged = new Int16Array(this.pendingSamples);
    let offset = 0;
    for (const part of this.pending) { merged.set(part, offset); offset += part.length; }
    this.pending = [];
    this.pendingSamples = 0;
    this.stats.sentChunks += 1;
    this.stats.sentMs += (merged.length / this.sampleRate) * 1000;
    this.send(merged.buffer);
  }

  /** The avatar's audio for this utterance is complete (or was cut). */
  endSequence(): void {
    this.holding = false;
    this.flush();
    if (!this.sequenceOpen) return;
    this.sequenceOpen = false;
    this.stats.endSequences += 1;
    this.endSequenceNow();
  }

  interrupted(): void { this.stats.interrupts += 1; }

  /** The caller started speaking. True (and counted) when the avatar was mid-speech: echo from the speaker or a real interruption. */
  speechStarted(): boolean {
    const speaking = this.sequenceOpen && this.now() - this.lastPacketAt < 700;
    if (speaking) this.stats.speechWhileSpeaking += 1;
    return speaking;
  }

  reset(): void {
    clearTimeout(this.idleTimer);
    clearTimeout(this.tailTimer);
    this.pending = []; this.pendingSamples = 0; this.holding = false; this.sequenceOpen = false; this.lastPacketAt = 0;
  }

  recentWav(): Blob | undefined {
    if (!this.ringSamples) return undefined;
    const merged = new Int16Array(this.ringSamples);
    let offset = 0;
    for (const part of this.ring) { merged.set(part, offset); offset += part.length; }
    return pcmToWav(merged, this.sampleRate);
  }

  private scheduleIdleEnd(): void {
    clearTimeout(this.idleTimer);
    if (this.config.idleEndMs > 0) this.idleTimer = setTimeout(() => this.endSequence(), this.config.idleEndMs);
  }

  private record(samples: Int16Array): void {
    this.ring.push(samples);
    this.ringSamples += samples.length;
    const max = this.sampleRate * RECORD_SECONDS;
    while (this.ringSamples > max && this.ring.length > 1) this.ringSamples -= this.ring.shift()!.length;
  }

  private measure(samples: Int16Array): void {
    for (let i = 0; i < samples.length; i++) {
      const v = Math.abs(samples[i]) / FULL_SCALE;
      this.windowSquares += v * v;
      if (v > this.windowPeak) this.windowPeak = v;
      if (v >= 0.9989) this.stats.clipped += 1;
    }
    this.windowSamples += samples.length;
    if (this.windowSamples >= this.sampleRate / 2) {
      this.stats.rmsDb = toDb(Math.sqrt(this.windowSquares / this.windowSamples));
      this.stats.peakDb = toDb(this.windowPeak);
      this.windowSquares = 0; this.windowSamples = 0; this.windowPeak = 0;
    }
  }
}
