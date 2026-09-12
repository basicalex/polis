// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

export interface DecodedWav {
  sampleRate: number;
  samples: Float32Array;
}

const PCM_FORMAT = 1;
const MONO_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const DEFAULT_MAX_RECORDING_SECONDS = 180;

function maxRecordingSeconds(): number {
  const parsed = Number(process.env.CHANNEL_MAX_RECORDING_SECONDS ?? DEFAULT_MAX_RECORDING_SECONDS);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 600)
    return DEFAULT_MAX_RECORDING_SECONDS;
  return parsed;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

export function decodeWav(bytes: Uint8Array): DecodedWav {
  if (bytes.byteLength < 44) throw new Error('WAV is too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    throw new Error('WAV must be a RIFF/WAVE file');
  }

  let offset = 12;
  let sampleRate = 0;
  let audioFormat = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const payloadOffset = offset + 8;
    const nextOffset = payloadOffset + size + (size % 2);
    if (payloadOffset + size > bytes.byteLength) throw new Error('WAV chunk exceeds file length');

    if (id === 'fmt ') {
      if (size < 16) throw new Error('WAV fmt chunk is too short');
      audioFormat = view.getUint16(payloadOffset, true);
      channels = view.getUint16(payloadOffset + 2, true);
      sampleRate = view.getUint32(payloadOffset + 4, true);
      bitsPerSample = view.getUint16(payloadOffset + 14, true);
    } else if (id === 'data') {
      dataOffset = payloadOffset;
      dataSize = size;
      break;
    }
    offset = nextOffset;
  }

  if (audioFormat !== PCM_FORMAT) throw new Error('WAV must be PCM');
  if (channels !== MONO_CHANNELS) throw new Error('WAV must be mono');
  if (bitsPerSample !== BITS_PER_SAMPLE) throw new Error('WAV must be PCM16');
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0)
    throw new Error('WAV sample rate is invalid');
  if (dataOffset < 0) throw new Error('WAV data chunk is missing');
  if (dataSize % 2 !== 0) throw new Error('WAV PCM16 data must be aligned');

  const sampleCount = dataSize / 2;
  if (sampleCount > sampleRate * maxRecordingSeconds()) {
    throw new Error('WAV exceeds CHANNEL_MAX_RECORDING_SECONDS');
  }

  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const value = view.getInt16(dataOffset + index * 2, true);
    samples[index] = Math.max(-1, value / 32768);
  }
  return { sampleRate, samples };
}

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0)
    throw new Error('sampleRate must be positive');
  if (samples.length > sampleRate * maxRecordingSeconds()) {
    throw new Error('WAV exceeds CHANNEL_MAX_RECORDING_SECONDS');
  }
  const dataSize = samples.length * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  bytes.set(Buffer.from('RIFF'), 0);
  view.setUint32(4, 36 + dataSize, true);
  bytes.set(Buffer.from('WAVE'), 8);
  bytes.set(Buffer.from('fmt '), 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, PCM_FORMAT, true);
  view.setUint16(22, MONO_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  bytes.set(Buffer.from('data'), 36);
  view.setUint32(40, dataSize, true);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const scaled = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    view.setInt16(44 + index * 2, scaled, true);
  }
  return bytes;
}

export function generateTone(seconds: number, hz: number, sampleRate: number): Uint8Array {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('seconds must be positive');
  if (!Number.isFinite(hz) || hz <= 0) throw new Error('hz must be positive');
  const count = Math.round(seconds * sampleRate);
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * hz * index) / sampleRate) * 0.5;
  }
  return encodeWav(samples, sampleRate);
}
