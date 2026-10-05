import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { AVATAR_PCM_WORKLET_SOURCE } from "./avatar-pcm-worklet";

function processorFixture() {
  let Processor: any;
  const packets: ArrayBuffer[] = [];
  vm.runInNewContext(AVATAR_PCM_WORKLET_SOURCE, {
    sampleRate: 16000, ArrayBuffer, DataView, Math,
    AudioWorkletProcessor: class { port = { postMessage: (packet: ArrayBuffer) => packets.push(packet) }; },
    registerProcessor: (_name: string, processor: any) => { Processor = processor; },
  });
  return { processor: new Processor(), packets };
}

test("packs exactly 20ms of PCM16LE across render-block boundaries", () => {
  const { processor, packets } = processorFixture();
  const signal = Float32Array.from({ length: 3200 }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 1000 * i / 16000));
  for (let i = 0; i < signal.length; i += 128) {
    const output = new Float32Array(128).fill(1);
    processor.process([[signal.subarray(i, i + 128)]], [[output]]);
    assert.ok(output.every((sample) => sample === 0), "source audio must not play locally");
  }
  assert.equal(packets.length, 10);
  let sampleIndex = 0;
  for (const packet of packets) {
    assert.equal(packet.byteLength, 640);
    const view = new DataView(packet);
    for (let i = 0; i < packet.byteLength; i += 2) {
      const sample = signal[sampleIndex++];
      assert.equal(view.getInt16(i, true), Math.round(sample * (sample < 0 ? 32768 : 32767)) || 0);
    }
  }
  assert.equal(sampleIndex, signal.length);
});

test("forwards quiet speech and silence without amplitude gating", () => {
  const { processor, packets } = processorFixture();
  for (const value of [0, 0.0001, -0.0001]) {
    processor.process([[new Float32Array(320).fill(value)]], [[new Float32Array(320)]]);
  }
  assert.equal(packets.length, 3);
  assert.equal(new DataView(packets[0]).getInt16(0, true), 0);
  assert.equal(new DataView(packets[1]).getInt16(0, true), 3);
  assert.equal(new DataView(packets[2]).getInt16(0, true), -3);
});

test("clamps PCM safely without integer overflow", () => {
  const { processor, packets } = processorFixture();
  const input = Float32Array.from({ length: 320 }, (_, i) => i % 2 ? -1.5 : 1.5);
  processor.process([[input]], [[new Float32Array(320)]]);
  const view = new DataView(packets[0]);
  assert.equal(view.getInt16(0, true), 32767);
  assert.equal(view.getInt16(2, true), -32768);
});
