import assert from "node:assert/strict";
import test from "node:test";
import { applyGain, AudioLab, configFromParams, DEFAULT_LAB_CONFIG, pcmToWav, toDb } from "./avatar-audio-lab";

const RATE = 16000;
const packet = (value: number, samples = 320) => new Int16Array(samples).fill(value).buffer;

test("defaults reproduce the previous behaviour and URL parameters override them", () => {
  assert.deepEqual(configFromParams(new URLSearchParams("")), DEFAULT_LAB_CONFIG);
  const config = configFromParams(new URLSearchParams("gain=6&chunk=100&prebuffer=150&idleend=600&interrupt=off"));
  assert.deepEqual(config, { gainDb: 6, chunkMs: 100, prebufferMs: 150, idleEndMs: 600, localInterrupt: false });
});

test("gain raises level by the requested amount and limits instead of hard-clipping", () => {
  const quiet = new Int16Array([1000, -1000]);
  const boosted = applyGain(quiet, 6);
  assert.ok(Math.abs(toDb(boosted[0] / 32768) - toDb(1000 / 32768) - 6) < 0.1);
  const loud = applyGain(new Int16Array([30000, -30000]), 12);
  assert.ok(Math.abs(loud[0]) <= 29200 && Math.abs(loud[0]) > 26000, "peaks are compressed below -1 dBFS");
  assert.equal(applyGain(quiet, 0), quiet, "0 dB passes the same samples through");
});

test("20 ms packets are forwarded one by one by default", () => {
  const sent: ArrayBuffer[] = [];
  const lab = new AudioLab({ ...DEFAULT_LAB_CONFIG }, RATE, (chunk) => sent.push(chunk), () => {});
  for (let i = 0; i < 5; i++) lab.push(packet(100));
  assert.equal(sent.length, 5);
  assert.equal(lab.stats.sentMs, 100);
});

test("chunking joins packets into larger sends without losing samples", () => {
  const sent: ArrayBuffer[] = [];
  const lab = new AudioLab({ ...DEFAULT_LAB_CONFIG, chunkMs: 100 }, RATE, (chunk) => sent.push(chunk), () => {});
  for (let i = 0; i < 10; i++) lab.push(packet(i + 1));
  assert.equal(sent.length, 2);
  assert.equal(sent[0].byteLength, 5 * 640);
  lab.endSequence();
  assert.equal(lab.stats.sentMs, 200);
});

test("pre-buffering holds the start of an utterance, then releases it", () => {
  const sent: ArrayBuffer[] = [];
  let now = 0;
  const lab = new AudioLab({ ...DEFAULT_LAB_CONFIG, prebufferMs: 100, chunkMs: 20 }, RATE, (chunk) => sent.push(chunk), () => {}, () => now);
  for (let i = 0; i < 4; i++) { lab.push(packet(5)); now += 20; }
  assert.equal(sent.length, 0, "nothing is sent while the pre-buffer fills");
  lab.push(packet(5)); now += 20;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].byteLength, 5 * 640, "the whole pre-buffer goes out together");
  lab.push(packet(5)); now += 20;
  assert.equal(sent.length, 2, "after that packets flow at chunk size");
  now += 1000; // a pause starts a new utterance, which pre-buffers again
  lab.push(packet(5));
  assert.equal(sent.length, 2);
});

test("endSequence flushes held audio and ends the sequence once", () => {
  const sent: ArrayBuffer[] = [];
  let ended = 0;
  const lab = new AudioLab({ ...DEFAULT_LAB_CONFIG, chunkMs: 200 }, RATE, (chunk) => sent.push(chunk), () => { ended++; });
  lab.push(packet(1));
  lab.endSequence();
  lab.endSequence();
  assert.equal(sent.length, 1);
  assert.equal(ended, 1);
});

test("idle end closes the sequence after silence", async () => {
  let ended = 0;
  const lab = new AudioLab({ ...DEFAULT_LAB_CONFIG, idleEndMs: 30 }, RATE, () => {}, () => { ended++; });
  lab.push(packet(1));
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(ended, 1);
});

test("meters report level, clipping and main-thread stalls", () => {
  let now = 0;
  const lab = new AudioLab({ ...DEFAULT_LAB_CONFIG }, RATE, () => {}, () => {}, () => now);
  for (let i = 0; i < 30; i++) { lab.push(packet(16384)); now += i === 10 ? 120 : 20; }
  assert.ok(Math.abs(lab.stats.rmsDb - -6) < 0.1);
  assert.equal(lab.stats.gapsOver60, 1);
  assert.ok(lab.stats.maxGapMs >= 120);
  lab.push(packet(32767));
  assert.ok(lab.stats.clipped >= 320);
});

test("the capture keeps the last 10 seconds as a valid WAV", async () => {
  const lab = new AudioLab({ ...DEFAULT_LAB_CONFIG }, RATE, () => {}, () => {});
  for (let i = 0; i < 700; i++) lab.push(packet(2000));
  const wav = lab.recentWav()!;
  assert.equal(wav.size, 44 + RATE * 10 * 2 + 0);
  const header = new DataView(await wav.arrayBuffer());
  assert.equal(String.fromCharCode(header.getUint8(0), header.getUint8(1), header.getUint8(2), header.getUint8(3)), "RIFF");
  assert.equal(header.getUint32(24, true), RATE);
  assert.equal(pcmToWav(new Int16Array(10), 8000).size, 64);
});

test("speech detected while the avatar is talking is counted, speech after it finished is not", () => {
  let now = 0;
  const lab = new AudioLab({ ...DEFAULT_LAB_CONFIG }, RATE, () => {}, () => {}, () => now);
  assert.equal(lab.speechStarted(), false, "nothing playing yet");
  lab.push(packet(1)); now += 20;
  assert.equal(lab.speechStarted(), true);
  lab.endSequence();
  assert.equal(lab.speechStarted(), false, "after the sequence ended");
  assert.equal(lab.stats.speechWhileSpeaking, 1);
});
