#!/usr/bin/env python3
"""
Look for chunk-boundary artifacts in the WAV files the avatar debug panel saves ("Save SENT audio" / "Save AVATAR audio").

A click at every audio chunk boundary shows up as modulation of the HIGH-frequency band at the chunk rate and its harmonics
(20 ms chunks -> 50, 100, 150 ... Hz; 200 ms chunks -> 5, 10, 15 ... Hz). For the avatar output (48 kHz) the 9-20 kHz band is
the telling one: the audio we send is capped at half its sample rate, so anything up there was added by ANAM.

  python3 scripts/analyze-avatar-wav.py avatar-output.wav [sent-to-avatar.wav ...]
Needs numpy and scipy.
"""
import sys, wave
import numpy as np
from scipy import signal

def load(path):
    with wave.open(path) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768, w.getframerate()

def db(v): return 20 * np.log10(max(v, 1e-9))

def report(path):
    x, rate = load(path)
    print(f"\n===== {path}: {rate} Hz, {len(x) / rate:.1f} s")
    frame = int(rate * 0.02); n = len(x) // frame
    rms = np.sqrt((x[:n * frame].reshape(n, frame) ** 2).mean(1)); active = rms > 10 ** (-45 / 20)
    print(f"overall rms {db(np.sqrt(np.mean(x ** 2))):.1f} dBFS, peak {db(np.max(np.abs(x))):.1f} dBFS, clipped samples {(np.abs(x) >= 0.9886).sum()}, speech frames {active.mean() * 100:.0f}%")
    hi = min(rate / 2 - 500, 20000); lo = 9000 if rate >= 48000 else 5000
    h = signal.sosfiltfilt(signal.butter(6, (lo, hi), btype="band", fs=rate, output="sos"), x)
    step = int(rate / 1000)
    env = signal.decimate(np.abs(signal.hilbert(h)), step)
    speech = np.convolve(signal.decimate(np.abs(x), step), np.ones(50) / 50, "same") > 10 ** (-40 / 20)
    seg = env[speech]
    if len(seg) < 1000:
        print("not enough speech to analyse"); return
    seg = seg - seg.mean(); length = len(seg) // 1000 * 1000
    power = np.abs(np.fft.rfft(seg[:length] * np.hanning(length))) ** 2; freq = np.fft.rfftfreq(length, 1 / 1000)
    median = np.median(power[(freq > 10) & (freq < 300)])
    print(f"modulation of the {lo}-{int(hi)} Hz band (dB above median):")
    for target in (5, 10, 25, 50, 100, 150):
        m = (freq > target - 1.5) & (freq < target + 1.5)
        print(f"  {target:>3} Hz: {10 * np.log10(power[m].max() / median):5.1f}")
    idx = np.where((freq > 3) & (freq < 300))[0]; best = idx[np.argsort(power[idx])[-6:][::-1]]
    print("  strongest lines:", [(round(float(freq[i]), 1), round(float(10 * np.log10(power[i] / median)), 1)) for i in best])
    print("  a harmonic series (50, 100, 150, 200 Hz...) well above ~12 dB is a click train at the 20 ms chunk rate")

for path in sys.argv[1:] or ["avatar-output.wav"]:
    report(path)
