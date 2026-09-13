// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

// Verify against the live account before go-live (gate L8).
export const INFOBIP_AUTHORIZATION_HEADER = 'Authorization';
export const INFOBIP_CONTENT_TYPE_HEADER = 'Content-Type';
export const INFOBIP_DEFAULT_WEBHOOK_SIGNATURE_HEADER = 'x-hub-signature';

export const INFOBIP_EVENT_TYPES = {
  smsReceived: 'sms.received',
  smsDelivery: 'sms.delivery',
  callReceived: 'CALL_RECEIVED',
  callEstablished: 'CALL_ESTABLISHED',
  sayFinished: 'SAY_FINISHED',
  callFinished: 'CALL_FINISHED',
  callFailed: 'CALL_FAILED',
  callRecordingStopped: 'CALL_RECORDING_STOPPED',
  recordingStopped: 'RECORDING_STOPPED',
} as const;

export const INFOBIP_API_PATHS = {
  sendSms: '/sms/2/text/advanced',
  answerCall: (callId: string) => `/calls/1/calls/${encodeURIComponent(callId)}/answer`,
  say: (callId: string) => `/calls/1/calls/${encodeURIComponent(callId)}/say`,
  startRecording: (callId: string) =>
    `/calls/1/calls/${encodeURIComponent(callId)}/start-recording`,
  stopRecording: (callId: string) => `/calls/1/calls/${encodeURIComponent(callId)}/stop-recording`,
  hangup: (callId: string) => `/calls/1/calls/${encodeURIComponent(callId)}/hangup`,
  listRecordings: (callId: string) => `/calls/1/recordings/calls/${encodeURIComponent(callId)}`,
  recordingFile: (fileId: string) => `/calls/1/recordings/files/${encodeURIComponent(fileId)}`,
  transcription: (fileId: string) =>
    `/calls/1/recordings/files/${encodeURIComponent(fileId)}/transcription`,
} as const;
