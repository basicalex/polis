// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

const DEFAULT_BASE_URL = process.env.CHANNEL_INTERNAL_URL ?? 'http://127.0.0.1:8990';
const DEFAULT_TOKEN = process.env.INTERNAL_API_TOKEN;

function usage(exitCode = 1) {
  const out = exitCode === 0 ? console.log : console.error;
  out(`Usage:
  bun --no-env-file scripts/channel/stub-inbound.mjs sms --from +385911234567 --text "..." [--base-url URL] [--token TOKEN]
  bun --no-env-file scripts/channel/stub-inbound.mjs call --from +385911234567 [--base-url URL] [--token TOKEN]

Environment:
  CHANNEL_INTERNAL_URL  Gateway base URL (default ${DEFAULT_BASE_URL})
  INTERNAL_API_TOKEN    Internal bearer token`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const positional = [];
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    token: DEFAULT_TOKEN,
    from: undefined,
    text: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') usage(0);
    if (arg === '--base-url') {
      options.baseUrl = argv[++index];
      continue;
    }
    if (arg === '--token') {
      options.token = argv[++index];
      continue;
    }
    if (arg === '--from') {
      options.from = argv[++index];
      continue;
    }
    if (arg === '--text') {
      options.text = argv[++index];
      continue;
    }
    if (arg?.startsWith('--')) throw new Error(`unknown option: ${arg}`);
    positional.push(arg);
  }
  const [kind, ...extra] = positional;
  if ((kind !== 'sms' && kind !== 'call') || extra.length > 0) usage();
  if (!options.from || !/^\+[1-9]\d{7,14}$/.test(options.from)) {
    throw new Error('--from must be E.164, e.g. +385911234567');
  }
  if (kind === 'sms' && !options.text) throw new Error('sms requires --text');
  if (kind === 'call' && options.text !== undefined) throw new Error('call does not accept --text');
  if (!options.baseUrl) throw new Error('CHANNEL_INTERNAL_URL or --base-url is required');
  if (!options.token) throw new Error('INTERNAL_API_TOKEN or --token is required');
  return {
    kind,
    body: { from: options.from, text: kind === 'sms' ? options.text : undefined },
    from: options.from,
    baseUrl: options.baseUrl,
    token: options.token,
  };
}

function endpoint(baseUrl, kind) {
  const url = new URL(`/internal/channel/stub/inbound-${kind === 'sms' ? 'sms' : 'call'}`, baseUrl);
  return url.toString();
}

function assertRedacted(value, rawNumber) {
  if (JSON.stringify(value).includes(rawNumber)) {
    throw new Error('gateway response exposed the raw phone number');
  }
}

const request = parseArgs(process.argv.slice(2));
const response = await fetch(endpoint(request.baseUrl, request.kind), {
  method: 'POST',
  headers: {
    authorization: `Bearer ${request.token}`,
    'x-polis-internal-token': request.token,
    'content-type': 'application/json',
  },
  body: JSON.stringify(request.body),
});
const text = await response.text();
let payload;
try {
  payload = text ? JSON.parse(text) : null;
} catch {
  payload = { raw: text };
}
if (!response.ok) {
  console.error(JSON.stringify({ status: response.status, response: payload }, null, 2));
  process.exit(1);
}
assertRedacted(payload, request.from);
console.log(JSON.stringify(payload, null, 2));
