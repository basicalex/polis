import { randomInt } from 'node:crypto';
import path from 'node:path';

import { PilotError, loadRuntime, parseArgs } from './runtime-lib.mjs';

const PHONE_PATTERN = /\+?\d{8,}/;
const CHANNEL_BASE = 'http://127.0.0.1:8990';
const TRACE_BASE = 'http://127.0.0.1:8980';
const PLATFORM_BASE = 'http://127.0.0.1:3000';
const TRACE_STAFF_ID = 'trace-official-test';

function printSafe(line, output = console.log) {
  if (PHONE_PATTERN.test(line)) throw new PilotError('unsafe smoke output blocked');
  output(line);
}

function requireValue(condition, message) {
  if (!condition) throw new PilotError(message);
}

async function requestJson(stage, url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new PilotError(`${stage} failed`);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new PilotError(`${stage} failed with HTTP ${response.status}`);
  return body;
}

function syntheticPhone(prefix) {
  return `+3859${prefix}${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
}

const args = parseArgs(process.argv.slice(2));
const runtimeInput = args.value('runtime') ?? process.env.PILOT_RUNTIME_DIR;

try {
  if (!runtimeInput) throw new PilotError('use --runtime <printed-runtime-path>');
  const runtimePath = path.resolve(runtimeInput);
  const runtime = await loadRuntime(runtimePath);
  if (runtime.state.phase !== 'running') throw new PilotError('runtime is not running');

  const internalHeaders = {
    authorization: `Bearer ${runtime.secrets.internalApiToken}`,
    'x-polis-internal-token': runtime.secrets.internalApiToken,
    'content-type': 'application/json',
  };
  const staffHeaders = {
    'x-polis-internal-token': runtime.secrets.internalApiToken,
    'x-polis-citizen': TRACE_STAFF_ID,
    'x-polis-identity-level': 'verified',
  };

  const postStub = (kind, body) =>
    requestJson(`stub ${kind}`, `${CHANNEL_BASE}/internal/channel/stub/inbound-${kind}`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify(body),
    });
  const listMessages = (recordId) =>
    requestJson(
      'trace message lookup',
      `${TRACE_BASE}/internal/trace/records/${encodeURIComponent(recordId)}/messages`,
      { headers: staffHeaders },
    );

  const staffSession = await requestJson(
    'trace staff session',
    `${TRACE_BASE}/internal/trace/session`,
    {
      headers: staffHeaders,
    },
  );
  requireValue(
    staffSession?.actorId === TRACE_STAFF_ID && staffSession.role === 'official',
    'configured trace official actor is unavailable',
  );

  const smsPhone = syntheticPhone('1');
  const firstSms = await postStub('sms', {
    from: smsPhone,
    text: 'Rupa na kolniku u Ulici Primjer.',
  });
  requireValue(/^VRS-\d+$/.test(firstSms?.caseNumber), 'stub SMS did not create a case');
  requireValue(typeof firstSms?.recordId === 'string', 'stub SMS did not return a record');
  const confirmation = firstSms.sentMessages?.find(
    (message) =>
      message?.to === '[redacted]' &&
      typeof message.text === 'string' &&
      message.text.includes(firstSms.caseNumber),
  );
  requireValue(confirmation, 'stub SMS did not record a redacted confirmation');
  printSafe(`SMS case ${firstSms.caseNumber}; confirmation: ${confirmation.text}`);

  const publicCase = await requestJson(
    'public shell lookup',
    `${PLATFORM_BASE}/api/trace/public/cases/${encodeURIComponent(firstSms.caseNumber)}`,
  );
  requireValue(
    publicCase?.case?.caseNumber === firstSms.caseNumber &&
      publicCase.case.state === 'received' &&
      publicCase.case.textStatus === 'public' &&
      publicCase.case.holdReason === null &&
      typeof publicCase.case.text === 'string' &&
      Array.isArray(publicCase.case.labels) &&
      typeof publicCase.case.textSha256 === 'string',
    'public shell did not match the SMS case',
  );
  printSafe(
    `Public shell ${firstSms.caseNumber}; state: ${publicCase.case.state}; text: ${publicCase.case.textStatus}`,
  );

  const beforeAppend = await listMessages(firstSms.recordId);
  requireValue(Array.isArray(beforeAppend?.messages), 'trace message lookup returned invalid data');
  const targetedText = `${firstSms.caseNumber} Dodatna poruka za isti predmet.`;
  const secondSms = await postStub('sms', { from: smsPhone, text: targetedText });
  requireValue(
    secondSms?.caseNumber === firstSms.caseNumber && secondSms?.recordId === firstSms.recordId,
    'targeted SMS did not select the existing case',
  );
  const afterAppend = await listMessages(firstSms.recordId);
  requireValue(
    Array.isArray(afterAppend?.messages) &&
      afterAppend.messages.length > beforeAppend.messages.length &&
      afterAppend.messages.some(
        (message) =>
          message?.kind === 'append' &&
          message?.channel === 'sms' &&
          message?.body === targetedText,
      ),
    'targeted SMS was not appended to the existing case',
  );
  printSafe(`SMS append verified for ${firstSms.caseNumber}`);

  const call = await postStub('call', { from: syntheticPhone('2') });
  requireValue(/^VRS-\d+$/.test(call?.caseNumber), 'stub call did not create a case');
  requireValue(typeof call?.recordId === 'string', 'stub call did not return a record');
  requireValue(
    Array.isArray(call?.commands) &&
      call.commands.some(
        (command) =>
          typeof command === 'string' &&
          command.startsWith('speak:') &&
          command.includes(`Broj predmeta: ${call.caseNumber}.`),
      ),
    'stub call did not record the spoken case readback',
  );
  const callMessages = await listMessages(call.recordId);
  requireValue(
    Array.isArray(callMessages?.messages) &&
      callMessages.messages.some(
        (message) =>
          message?.kind === 'transcript' &&
          message?.channel === 'voice' &&
          message?.source === 'transcript' &&
          typeof message?.body === 'string' &&
          message.body.length > 0,
      ),
    'stub call did not append a transcript message',
  );
  printSafe(`Voice case ${call.caseNumber}; spoken readback: recorded; transcript: recorded`);
} catch (error) {
  const message = error instanceof PilotError ? error.message : 'channel smoke failed';
  printSafe(PHONE_PATTERN.test(message) ? 'channel smoke failed' : message, console.error);
  process.exitCode = 1;
}
