// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SttProvider } from './pipeline-types.js';
import { SttProviderError } from './stt-provider.js';

const STUB_TRANSCRIPT = 'Ulična rasvjeta ne radi u ulici Primjer, već tri dana.';

export function wavDurationSeconds(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.byteLength < 44 ||
    readAscii(bytes, 0, 4) !== 'RIFF' ||
    readAscii(bytes, 8, 4) !== 'WAVE'
  ) {
    throw new SttProviderError('audio/wav input must contain a RIFF WAVE header', {
      code: 'invalid_wav',
    });
  }

  let offset = 12;
  let byteRate: number | null = null;
  let dataBytes: number | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > bytes.byteLength) {
      throw new SttProviderError('audio/wav chunk exceeds input size', { code: 'invalid_wav' });
    }
    if (chunkId === 'fmt ') {
      if (chunkSize < 16)
        throw new SttProviderError('audio/wav fmt chunk is too short', { code: 'invalid_wav' });
      byteRate = view.getUint32(dataOffset + 8, true);
    } else if (chunkId === 'data') {
      dataBytes = chunkSize;
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  if (!byteRate || dataBytes === null) {
    throw new SttProviderError('audio/wav input must contain fmt and data chunks', {
      code: 'invalid_wav',
    });
  }
  return dataBytes / byteRate;
}

export function createStubSttProvider(): SttProvider {
  return {
    name: 'stub',
    async transcribe(input) {
      return {
        text: STUB_TRANSCRIPT,
        durationSeconds: wavDurationSeconds(input.audio),
      };
    },
  };
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
