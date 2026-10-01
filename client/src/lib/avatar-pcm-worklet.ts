// Resampling is handled by the 16 kHz AudioContext, not by skipping/averaging
// samples here. This worklet only packs continuous mono audio as PCM16LE.
// No VAD, amplitude gate, noise detector, or interruption logic belongs here.
export const AVATAR_PCM_WORKLET_SOURCE = `class AvatarPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.packetSamples = Math.round(sampleRate * 0.02);
    this.allocatePacket();
  }
  allocatePacket() {
    this.packet = new ArrayBuffer(this.packetSamples * 2);
    this.view = new DataView(this.packet);
    this.position = 0;
  }
  process(inputs, outputs) {
    // Only ANAM plays the audio; don't play the source track a second time.
    for (const channel of outputs[0] || []) channel.fill(0);
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (const value of input) {
      const sample = Math.max(-1, Math.min(1, value));
      this.view.setInt16(this.position * 2,
        Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      if (++this.position === this.packetSamples) {
        this.port.postMessage(this.packet, [this.packet]);
        this.allocatePacket();
      }
    }
    return true;
  }
}
registerProcessor("avatar-pcm", AvatarPcm);`;
