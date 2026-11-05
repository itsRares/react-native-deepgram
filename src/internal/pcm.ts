/** Sample rate the native recorders capture at (PCM16 mono). */
export const NATIVE_SAMPLE_RATE = 16_000;

export function computeDownsampleFactor(
  targetSampleRate: number | undefined,
  nativeSampleRate: number = NATIVE_SAMPLE_RATE
): number {
  if (
    !targetSampleRate ||
    targetSampleRate >= nativeSampleRate ||
    nativeSampleRate <= 0
  ) {
    return 1;
  }
  return Math.max(1, Math.round(nativeSampleRate / targetSampleRate));
}

/** Like {@link computeDownsampleFactor}, but honours an explicit override. */
export function resolveDownsampleFactor(
  overrideFactor: number | undefined,
  targetSampleRate: number | undefined,
  nativeSampleRate: number | undefined
): number {
  if (overrideFactor == null) {
    return computeDownsampleFactor(targetSampleRate, nativeSampleRate);
  }
  if (
    nativeSampleRate &&
    targetSampleRate &&
    nativeSampleRate <= targetSampleRate
  ) {
    return 1;
  }
  return Math.max(1, Math.round(overrideFactor));
}

/** Keep every `factor`-th sample (the native capture is already filtered). */
export function downsampleInt16(
  samples: Int16Array<ArrayBuffer>,
  factor: number
): Int16Array<ArrayBuffer> {
  if (factor <= 1 || samples.length < factor) {
    return samples;
  }
  const out = new Int16Array(Math.floor(samples.length / factor));
  for (let i = 0; i < out.length; i++) {
    out[i] = samples[i * factor]!;
  }
  return out;
}

export interface DecodedPcmFrame {
  /** PCM16 audio ready to send, after downsampling. */
  audio: ArrayBuffer;
  /** Size of the decoded frame before downsampling. */
  decodedBytes: number;
}

/** Decode a base64 PCM16 frame from the native recorder and downsample it. */
export function decodePcmFrame(b64: string, factor: number): DecodedPcmFrame {
  const binary = atob(b64);
  // A trailing odd byte can't form a PCM16 sample.
  const length = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const samples = downsampleInt16(new Int16Array(bytes.buffer), factor);
  return { audio: samples.buffer, decodedBytes: length };
}

/**
 * Normalize binary payloads (ArrayBuffer, typed-array views, byte arrays) to
 * an ArrayBuffer containing exactly the viewed bytes.
 */
export function toArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return copy.buffer;
  }
  if (Array.isArray(data)) {
    return Uint8Array.from(data, (value) => Number(value) || 0).buffer;
  }
  return null;
}
