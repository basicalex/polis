// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChannelProvider } from './channel-provider.js';
import type { RecordStartInput, SendSmsInput, SpeakInput } from './pipeline-types.js';

export interface StubSentMessage {
  to: string;
  text: string;
  idempotencyKey: string;
  providerMessageId: string;
}

function nextId(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(4, '0')}`;
}

function wavTone(): Uint8Array {
  const sampleRate = 8_000;
  const seconds = 1;
  const samples = sampleRate * seconds;
  const dataBytes = samples * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1)
      bytes[offset + index] = value.charCodeAt(index);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples; index += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 12_000);
    view.setInt16(44 + index * 2, sample, true);
  }
  return bytes;
}

export class StubChannelProvider implements ChannelProvider {
  readonly name = 'stub' as const;
  readonly sentMessages: StubSentMessage[] = [];
  readonly commands: string[] = [];
  #messageCounter = 0;
  #recordingCounter = 0;

  async sendSms(input: SendSmsInput): Promise<{ providerMessageId: string }> {
    this.#messageCounter += 1;
    const providerMessageId = nextId('stub-msg', this.#messageCounter);
    this.sentMessages.push({ ...input, providerMessageId });
    return { providerMessageId };
  }

  async answerCall(callControlId: string, clientState: string): Promise<void> {
    this.commands.push(`answer:${callControlId}:${clientState}`);
  }

  async speak(callControlId: string, input: SpeakInput): Promise<void> {
    this.commands.push(`speak:${callControlId}:${input.language}:${input.voice}:${input.text}`);
  }

  async recordStart(callControlId: string, input: RecordStartInput): Promise<void> {
    this.#recordingCounter += 1;
    this.commands.push(
      `record_start:${callControlId}:${input.commandId}:${nextId('stub-rec', this.#recordingCounter)}`,
    );
  }

  async hangup(callControlId: string): Promise<void> {
    this.commands.push(`hangup:${callControlId}`);
  }

  async fetchRecording(): Promise<Uint8Array> {
    return wavTone();
  }

  async deleteRecording(recordingId: string): Promise<void> {
    this.commands.push(`delete_recording:${recordingId}`);
  }
}
