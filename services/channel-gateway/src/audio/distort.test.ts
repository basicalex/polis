// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { distortRecording } from './distort.js';
import { decodeWav, encodeWav, generateTone } from './wav.js';

function estimateFrequency(samples: Float32Array, sampleRate: number): number {
  let crossings = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if ((samples[index - 1] ?? 0) <= 0 && (samples[index] ?? 0) > 0) crossings += 1;
  }
  return crossings / (samples.length / sampleRate);
}

test('WAV codec accepts strict PCM16 mono and rejects stereo and overlong input', () => {
  const originalLimit = process.env.CHANNEL_MAX_RECORDING_SECONDS;
  try {
    process.env.CHANNEL_MAX_RECORDING_SECONDS = '1';
    const wav = generateTone(0.25, 440, 16_000);
    const decoded = decodeWav(wav);
    assert.equal(decoded.sampleRate, 16_000);
    assert.equal(decoded.samples.length, 4_000);
    assert.equal(decodeWav(encodeWav(decoded.samples, decoded.sampleRate)).samples.length, 4_000);

    const stereo = new Uint8Array(wav);
    const view = new DataView(stereo.buffer, stereo.byteOffset, stereo.byteLength);
    view.setUint16(22, 2, true);
    assert.throws(() => decodeWav(stereo), /mono/);

    assert.throws(() => generateTone(1.01, 440, 16_000), /CHANNEL_MAX_RECORDING_SECONDS/);
  } finally {
    if (originalLimit === undefined) delete process.env.CHANNEL_MAX_RECORDING_SECONDS;
    else process.env.CHANNEL_MAX_RECORDING_SECONDS = originalLimit;
  }
});

test('distortion is deterministic by seed and emits bounded 8 kHz mono WAV', () => {
  const input = generateTone(1, 440, 16_000);
  const first = distortRecording(input, { semitones: -4, seed: 'same-seed' });
  const second = distortRecording(input, { semitones: -4, seed: 'same-seed' });
  const other = distortRecording(input, { semitones: -4, seed: 'other-seed' });

  assert.equal(first.sha256, second.sha256);
  assert.notEqual(first.sha256, other.sha256);
  assert.deepEqual(first.bytes, second.bytes);

  const decoded = decodeWav(first.bytes);
  assert.equal(decoded.sampleRate, 8_000);
  assert.ok(Math.abs(decoded.samples.length / decoded.sampleRate - 1) <= 0.02);
});

test('minus four semitone distortion shifts a 440 Hz tone near 349 Hz', () => {
  const input = generateTone(1.5, 440, 16_000);
  const output = distortRecording(input, { semitones: -4, seed: 'pitch-seed' });
  const decoded = decodeWav(output.bytes);
  const frequency = estimateFrequency(decoded.samples.subarray(1_000), decoded.sampleRate);
  assert.ok(frequency > 335 && frequency < 365, `expected frequency near 349 Hz, got ${frequency}`);
});
