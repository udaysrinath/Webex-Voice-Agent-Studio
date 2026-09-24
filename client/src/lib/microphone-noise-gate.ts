export const MIN_MIC_RMS_THRESHOLD = 0.008;
export const MAX_MIC_RMS_THRESHOLD = 0.025;
export const MIC_NOISE_WINDOW_SIZE = 60;

export function calculateAdaptiveMicThreshold(samples: number[]): number {
  if (samples.length === 0) return MIN_MIC_RMS_THRESHOLD;
  const sorted = [...samples].sort((a, b) => a - b);
  const noiseFloorIndex = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.2));
  const noiseFloor = sorted[noiseFloorIndex] || 0;
  return Math.min(MAX_MIC_RMS_THRESHOLD, Math.max(MIN_MIC_RMS_THRESHOLD, noiseFloor * 2.2));
}
