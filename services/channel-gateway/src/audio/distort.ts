// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';

import { decodeWav, encodeWav } from './wav.js';

export interface DistortOptions {
  semitones: number;
  seed: string;
}

export interface DistortedRecording {
  bytes: Uint8Array;
  sha256: string;
}

const OUTPUT_SAMPLE_RATE = 8_000;
const LOW_PASS_HZ = 3_400;
const WINDOW_SECONDS = 0.03;
const HOP_RATIO = 0.5;

function xorshift32(seed: number): () => number {
  let state = seed || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function seedToUint32(seed: string): number {
  const digest = createHash('sha256').update(seed).digest();
  return digest.readUInt32BE(0);
}

function resampleLinear(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (input.length === 0) return new Float32Array();
  const outputLength = Math.max(1, Math.round((input.length * outputRate) / inputRate));
  const output = new Float32Array(outputLength);
  const ratio = inputRate / outputRate;
  for (let index = 0; index < outputLength; index += 1) {
    const source = index * ratio;
    const left = Math.floor(source);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = source - left;
    output[index] = (input[left] ?? 0) * (1 - fraction) + (input[right] ?? 0) * fraction;
  }
  return output;
}

function hannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, length - 1));
  }
  return window;
}

function timeStretch(input: Float32Array, sampleRate: number, outputLength: number, random: () => number): Float32Array {
  if (input.length === 0 || outputLength <= 0) return new Float32Array();
  const frameLength = Math.max(16, Math.round(sampleRate * WINDOW_SECONDS));
  const synthesisHop = Math.max(1, Math.round(frameLength * HOP_RATIO));
  const stretchRatio = outputLength / input.length;
  const analysisHop = Math.max(1, synthesisHop / stretchRatio);
  const frameCount = Math.max(1, Math.ceil(outputLength / synthesisHop) + 2);
  const output = new Float32Array(outputLength + frameLength);
  const weights = new Float32Array(output.length);
  const window = hannWindow(frameLength);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const outOffset = frame * synthesisHop;
    if (outOffset >= output.length) break;
    const jitter = 1 + (random() * 2 - 1) * 0.01;
    const inOffset = Math.max(0, Math.min(input.length - 1, Math.round(frame * analysisHop * jitter)));
    for (let index = 0; index < frameLength && outOffset + index < output.length; index += 1) {
      const sample = input[inOffset + index] ?? 0;
      const weight = window[index] ?? 0;
      output[outOffset + index] += sample * weight;
      weights[outOffset + index] += weight;
    }
  }

  const trimmed = new Float32Array(outputLength);
  for (let index = 0; index < trimmed.length; index += 1) {
    trimmed[index] = weights[index] > 0 ? output[index] / weights[index] : output[index];
  }
  return trimmed;
}

function lowPass(input: Float32Array, sampleRate: number): Float32Array {
  if (input.length === 0) return new Float32Array();
  const output = new Float32Array(input.length);
  const omega = (2 * Math.PI * LOW_PASS_HZ) / sampleRate;
  const cos = Math.cos(omega);
  const sin = Math.sin(omega);
  const q = Math.SQRT1_2;
  const alpha = sin / (2 * q);
  const a0 = 1 + alpha;
  const b0 = ((1 - cos) / 2) / a0;
  const b1 = (1 - cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < input.length; index += 1) {
    const x0 = input[index] ?? 0;
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    output[index] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return output;
}

export function distortRecording(bytes: Uint8Array, options: DistortOptions): DistortedRecording {
  const decoded = decodeWav(bytes);
  const pitchFactor = 2 ** (options.semitones / 12);
  if (!Number.isFinite(pitchFactor) || pitchFactor <= 0) throw new Error('semitones must be finite');
  const shifted = resampleLinear(decoded.samples, decoded.sampleRate, decoded.sampleRate / pitchFactor);
  const random = xorshift32(seedToUint32(options.seed));
  const stretched = timeStretch(shifted, decoded.sampleRate, decoded.samples.length, random);
  const filtered = lowPass(stretched, decoded.sampleRate);
  const outputSamples = resampleLinear(filtered, decoded.sampleRate, OUTPUT_SAMPLE_RATE);
  const outputBytes = encodeWav(outputSamples, OUTPUT_SAMPLE_RATE);
  return {
    bytes: outputBytes,
    sha256: createHash('sha256').update(outputBytes).digest('hex'),
  };
}
