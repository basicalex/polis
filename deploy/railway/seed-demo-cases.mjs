import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const STAFF_EMAIL = 'official@vrsar.example.test';
const DEFAULT_PUBLIC_WEB_BASE = 'https://polis-interface-web-preview.polis-apps-web.workers.dev';
const REQUEST_DELAY_MS = 250;
const RATE_LIMIT_WAIT_STEPS_MS = [30_000, 60_000];
const MAX_RATE_LIMIT_WAIT_MS = 11 * 60_000;
const MARKER_VERSION = 2;
const SIGNED_BY = { name: 'Ivana Testić', title: 'Viša stručna suradnica za komunalni sustav' };

class SafeError extends Error {}

const args = new Set(process.argv.slice(2));
if (!args.has('--yes') || [...args].some((arg) => arg !== '--yes' && arg !== '--reset')) {
  throw new SafeError('demo case seeding requires --yes; the only optional flag is --reset');
}

const requiredEnvironment = [
  'DATABASE_URL',
  'IDENTITY_HMAC_KEY',
  'DEMO_STAFF_PASSCODE',
  'PLATFORM_API_BASE',
];
for (const name of requiredEnvironment) {
  if (!process.env[name]?.trim()) throw new SafeError(`${name} is required`);
}

const databaseUrl = process.env.DATABASE_URL;
const identityHmacKey = process.env.IDENTITY_HMAC_KEY;
const staffPasscode = process.env.DEMO_STAFF_PASSCODE;
if (staffPasscode.length > 256)
  throw new SafeError('DEMO_STAFF_PASSCODE must be at most 256 characters');

let databaseTarget;
try {
  databaseTarget = new URL(databaseUrl);
} catch {
  throw new SafeError('DATABASE_URL must be a valid PostgreSQL URL');
}
if (
  (databaseTarget.protocol !== 'postgres:' && databaseTarget.protocol !== 'postgresql:') ||
  !databaseTarget.hostname ||
  !databaseTarget.pathname ||
  databaseTarget.pathname === '/'
) {
  throw new SafeError('DATABASE_URL must name a PostgreSQL host and database');
}

function parseOrigin(value, name) {
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error();
    }
    return parsed.href.replace(/\/+$/, '');
  } catch {
    throw new SafeError(`${name} must be an HTTP(S) origin without credentials`);
  }
}

const platformBase = parseOrigin(process.env.PLATFORM_API_BASE, 'PLATFORM_API_BASE');
const publicWebBase = parseOrigin(
  process.env.PUBLIC_WEB_BASE?.trim() || DEFAULT_PUBLIC_WEB_BASE,
  'PUBLIC_WEB_BASE',
);

const stateRoot = process.env.XDG_STATE_HOME?.trim() || join(homedir(), '.local', 'state');
const markerPath = join(stateRoot, 'polis', 'seed-demo-cases.json');
const reset = args.has('--reset');
let requestCount = 0;
let rateLimitRetries = 0;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function dateAfter(days) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function followerKey() {
  return randomBytes(24).toString('base64url');
}

/**
 * Demo spread. Every entry names the public shell state it must end in plus
 * the text visibility and label the shell must show. Cases 1 and 2 share one
 * text on purpose: the compliance pass sees the first filing's hash and puts
 * the soft form-letter label on the second. Case 3 carries a synthetic phone
 * number so the pass holds it for personal data.
 */
const FORM_LETTER_TEXT =
  'Ulična svjetiljka na Obali maršala Tita uz marinu ne radi već nekoliko večeri. Dio šetnice ostaje potpuno neosvijetljen.';

const demoCases = [
  {
    target: 'received',
    textStatus: 'public',
    labels: [],
    text: FORM_LETTER_TEXT,
    location: 'Obala maršala Tita, uz marinu',
  },
  {
    target: 'received',
    textStatus: 'public',
    labels: ['form-letter'],
    text: FORM_LETTER_TEXT,
    location: 'Obala maršala Tita, uz marinu',
  },
  {
    target: 'received',
    textStatus: 'held',
    holdReason: 'personal-data',
    labels: [],
    text: 'Svjetiljka ispred zgrade u Ulici Rade Končara ne radi. Nazovite me na 091 234 5678 da vam pokažem gdje je kvar.',
    location: 'Ulica Rade Končara, kod raskrižja',
  },
  {
    target: 'assigned',
    textStatus: 'public',
    labels: [],
    text: 'Rasvjetni stup na parkiralištu Montraker srušen je uz rub kolnika. Svjetiljka je razbijena, a područje noću ostaje u mraku.',
    location: 'Parkiralište Montraker, zapadni ulaz',
  },
  {
    target: 'answered',
    textStatus: 'public',
    labels: [],
    text: 'Pješački prijelaz kod škole u Ulici Aldo Negri noću je slabo osvijetljen jer obližnja svjetiljka ne radi. Pješaci se teško uočavaju.',
    location: 'Ulica Aldo Negri, kod škole',
    commitment:
      'Upravni odjel za komunalni sustav zamijenit će neispravnu svjetiljku, izmjeriti osvijetljenost prijelaza i po potrebi podesiti rasvjetno tijelo.',
    dueInDays: 14,
  },
  {
    target: 'answered',
    textStatus: 'public',
    labels: [],
    overdue: true,
    text: 'Javna rasvjeta u Dalmatinskoj ulici ostaje uključena tijekom cijelog dana. Čini se da vremenski program ne prebacuje rasvjetu na dnevni režim.',
    location: 'Dalmatinska ulica, kod pošte',
    commitment:
      'Upravni odjel za komunalni sustav provjerit će upravljački sat, podesiti dnevno-noćni program i ispitati uključenje cijele rasvjetne grane.',
    dueInDays: -5,
  },
  {
    target: 'resolved',
    textStatus: 'public',
    labels: [],
    text: 'Pješačka staza prema plaži Valkanela nema rasvjetu na dijelu između naselja i obalnog puta. Prolaz je nakon zalaska sunca potpuno taman.',
    location: 'Pješačka staza prema plaži Valkanela',
    commitment:
      'Upravni odjel za komunalni sustav postavit će dvije svjetiljke na neosvijetljenom dijelu staze i provjeriti napajanje rasvjetne linije.',
    dueInDays: 30,
    evidenceNote:
      'Dana 11. rujna 2026. postavljena su dva nova rasvjetna tijela, popravljen je priključni vod i potvrđen je rad rasvjete duž cijelog dijela staze.',
    evidenceUrl: 'https://www.vrsar.hr/komunalne-obavijesti/rasvjeta-staza-valkanela',
    followers: 2,
    notFixed: 1,
  },
  {
    target: 'disputed',
    textStatus: 'public',
    labels: [],
    text: 'Nova LED svjetiljka u Gradskoj ulici usmjerena je prema prozorima stanova i stvara jako blještanje tijekom noći. Potrebno je prilagoditi kut svjetiljke.',
    location: 'Gradska ulica, kod broja 12',
    commitment:
      'Upravni odjel za komunalni sustav podesit će nagib LED svjetiljke, ugraditi zaslon prema pročelju i provjeriti osvijetljenost kolnika.',
    dueInDays: 14,
    evidenceNote:
      'Dana 12. rujna 2026. podešen je nagib LED svjetiljke i ugrađen je bočni zaslon; večernjom provjerom potvrđeno je da svjetlo više ne pada na prozore.',
    evidenceUrl: 'https://www.vrsar.hr/komunalne-obavijesti/podesavanje-led-gradska',
    disputeText:
      'Svjetiljka i dalje osvjetljava prozore na drugom katu. Zaslon je postavljen, ali kut nije promijenjen; blještanje je isto kao prije.',
  },
  {
    target: 'closed',
    textStatus: 'public',
    labels: [],
    text: 'Svjetiljka na cesti prema groblju ne radi već nekoliko tjedana. Na tom dijelu nema drugog izvora javne rasvjete.',
    location: 'Cesta prema groblju, prvi zavoj',
    closeReason: 'duplicate',
    closePublicReason:
      'Prijava je zatvorena kao duplikat već evidentiranog kvara javne rasvjete na istoj lokaciji. Radovi se prate u ranijem zapisu.',
  },
];

async function requestJson(path, options = {}) {
  const method = options.method ?? 'GET';
  const headers = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.sessionToken) headers.authorization = `Bearer ${options.sessionToken}`;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  let retry = 0;
  let totalRateLimitWaitMilliseconds = 0;
  while (true) {
    if (requestCount > 0) await delay(REQUEST_DELAY_MS);
    requestCount += 1;

    let response;
    try {
      response = await fetch(platformBase + path, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new SafeError(`${options.label ?? 'API'} request failed`);
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.status === 429) {
      rateLimitRetries += 1;
      retry += 1;
      if (totalRateLimitWaitMilliseconds >= MAX_RATE_LIMIT_WAIT_MS) {
        throw new SafeError(`${options.label ?? 'API'} failed: 429 rate_limited`);
      }

      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
      const steppedWaitMilliseconds =
        RATE_LIMIT_WAIT_STEPS_MS[Math.min(retry - 1, RATE_LIMIT_WAIT_STEPS_MS.length - 1)];
      const requestedWaitMilliseconds = Number.isFinite(retryAfterSeconds)
        ? Math.max(1_000, Math.min(MAX_RATE_LIMIT_WAIT_MS, retryAfterSeconds * 1_000))
        : steppedWaitMilliseconds;
      const waitMilliseconds = Math.min(
        requestedWaitMilliseconds,
        MAX_RATE_LIMIT_WAIT_MS - totalRateLimitWaitMilliseconds,
      );
      console.log(
        JSON.stringify({
          stage: 'rate-limit',
          label: options.label ?? 'API',
          waitSeconds: waitMilliseconds / 1_000,
          retry,
        }),
      );
      await delay(waitMilliseconds);
      totalRateLimitWaitMilliseconds += waitMilliseconds;
      continue;
    }

    const expectedStatuses = options.expectedStatuses ?? [200];
    if (!expectedStatuses.includes(response.status)) {
      const code =
        payload && typeof payload === 'object' && typeof payload.error === 'string'
          ? payload.error
          : 'invalid_response';
      throw new SafeError(`${options.label ?? 'API'} failed: ${response.status} ${code}`);
    }
    if (!payload || typeof payload !== 'object') {
      throw new SafeError(`${options.label ?? 'API'} returned invalid JSON`);
    }
    return { status: response.status, payload };
  }
}

async function saveMarker(marker) {
  await mkdir(dirname(markerPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${markerPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, markerPath);
}

function validateMarker(marker) {
  if (
    !marker ||
    marker.version !== MARKER_VERSION ||
    !Array.isArray(marker.cases) ||
    marker.cases.length !== demoCases.length
  ) {
    throw new SafeError(
      'demo marker is missing, invalid, or from the review-era seed; use --reset to start a new batch',
    );
  }
  for (const [index, entry] of marker.cases.entries()) {
    if (
      !entry ||
      entry.index !== index ||
      typeof entry.filingKey !== 'string' ||
      (entry.recordId !== null && typeof entry.recordId !== 'string') ||
      (entry.caseNumber !== null && typeof entry.caseNumber !== 'string') ||
      (entry.reopenKey !== null && typeof entry.reopenKey !== 'string') ||
      !Array.isArray(entry.followerKeys) ||
      !entry.followerKeys.every((key) => typeof key === 'string') ||
      !Array.isArray(entry.notFixedKeys) ||
      !entry.notFixedKeys.every((key) => typeof key === 'string') ||
      typeof entry.disputed !== 'boolean'
    ) {
      throw new SafeError('demo marker is invalid; use --reset to start a new batch');
    }
  }
  return marker;
}

async function loadOrCreateMarker() {
  if (!reset) {
    try {
      const marker = validateMarker(JSON.parse(await readFile(markerPath, 'utf8')));
      console.log(JSON.stringify({ stage: 'demo-cases', filing: 'skipped-existing-marker' }));
      return marker;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        if (error instanceof SafeError) throw error;
        throw new SafeError('demo marker cannot be read; use --reset to start a new batch');
      }
    }
  }

  const marker = {
    version: MARKER_VERSION,
    createdAt: new Date().toISOString(),
    cases: demoCases.map((definition, index) => ({
      index,
      filingKey: randomUUID(),
      recordId: null,
      caseNumber: null,
      reopenKey: null,
      followerKeys: Array.from({ length: definition.followers ?? 0 }, followerKey),
      notFixedKeys: Array.from({ length: definition.notFixed ?? 0 }, followerKey),
      disputed: false,
    })),
  };
  await saveMarker(marker);
  console.log(JSON.stringify({ stage: 'demo-cases', filing: reset ? 'reset' : 'new' }));
  return marker;
}

async function setStaffPasscode() {
  console.log(
    JSON.stringify({
      stage: 'staff-passcode',
      target: {
        host: databaseTarget.hostname,
        port: databaseTarget.port || '5432',
        database: databaseTarget.pathname.slice(1),
        user: databaseTarget.username,
      },
    }),
  );

  const passcodeHash = createHmac('sha256', identityHmacKey).update(staffPasscode).digest('hex');
  const requireFromDatabasePackage = createRequire(
    new URL('../../packages/db/package.json', import.meta.url),
  );
  const postgres = requireFromDatabasePackage('postgres');
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  let rows;
  try {
    rows = await sql`
      UPDATE citizens
      SET passcode_hash = ${passcodeHash}
      WHERE email = ${STAFF_EMAIL}
      RETURNING email
    `;
  } catch {
    throw new SafeError('staff passcode database update failed');
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }

  if (rows.length !== 1) {
    throw new SafeError(`staff passcode update expected 1 identity but updated ${rows.length}`);
  }
  console.log(JSON.stringify({ stage: 'staff-passcode', updatedEmails: [STAFF_EMAIL] }));
}

async function signIn(email) {
  const { payload } = await requestJson('/api/v1/identity/exchange', {
    method: 'POST',
    body: { email, passcode: staffPasscode },
    expectedStatuses: [200],
    label: 'identity exchange',
  });
  if (typeof payload.sessionToken !== 'string' || !payload.sessionToken) {
    throw new SafeError('identity exchange returned invalid JSON');
  }
  return payload.sessionToken;
}

async function fileCases(marker) {
  // Sequential on purpose: the form-letter label depends on the earlier filing
  // being on record before the duplicate is assessed.
  for (const entry of marker.cases) {
    if (entry.recordId && entry.caseNumber) continue;
    const definition = demoCases[entry.index];
    const { payload } = await requestJson('/api/trace/public/cases', {
      method: 'POST',
      body: { text: definition.text, location: definition.location },
      idempotencyKey: entry.filingKey,
      expectedStatuses: [201],
      label: 'case filing',
    });
    const filed = payload.case;
    if (
      !filed ||
      typeof filed.recordId !== 'string' ||
      typeof filed.caseNumber !== 'string' ||
      typeof filed.reopenKey !== 'string' ||
      filed.state !== 'received'
    ) {
      throw new SafeError('case filing returned invalid JSON');
    }
    entry.recordId = filed.recordId;
    entry.caseNumber = filed.caseNumber;
    entry.reopenKey = definition.target === 'disputed' ? filed.reopenKey : null;
    await saveMarker(marker);
  }
}

async function getRecord(recordId, officialToken) {
  const { payload } = await requestJson(`/api/trace/records/${encodeURIComponent(recordId)}`, {
    sessionToken: officialToken,
    label: 'record read',
  });
  const record = payload.record;
  if (
    !record ||
    typeof record.id !== 'string' ||
    typeof record.status !== 'string' ||
    !Number.isInteger(record.version) ||
    !Array.isArray(record.events)
  ) {
    throw new SafeError('record read returned invalid JSON');
  }
  return record;
}

async function command(record, suffix, officialToken, body) {
  await requestJson(`/api/trace/records/${encodeURIComponent(record.id)}/${suffix}`, {
    method: 'POST',
    body: { expectedVersion: record.version, ...body },
    sessionToken: officialToken,
    idempotencyKey: randomUUID(),
    label: `record ${suffix}`,
  });
  return getRecord(record.id, officialToken);
}

function commitmentBody(definition) {
  return {
    commitment: definition.commitment,
    dueDate: dateAfter(definition.dueInDays),
    signedBy: SIGNED_BY,
  };
}

function resolutionBody(definition) {
  return {
    evidenceNote: definition.evidenceNote,
    evidenceUrls: [definition.evidenceUrl],
    signedBy: SIGNED_BY,
  };
}

async function recordAttention(caseNumber, key, kind) {
  await requestJson(`/api/trace/public/cases/${encodeURIComponent(caseNumber)}/attention`, {
    method: 'POST',
    body: { followerKey: key, kind, action: 'add' },
    idempotencyKey: randomUUID(),
    label: `attention ${kind}`,
  });
}

async function disputeCase(entry, definition) {
  if (!entry.reopenKey) throw new SafeError('dispute needs the reopen key from the filing');
  await requestJson(`/api/trace/cases/${encodeURIComponent(entry.caseNumber)}/dispute`, {
    method: 'POST',
    body: { reopenKey: entry.reopenKey, text: definition.disputeText },
    idempotencyKey: randomUUID(),
    label: 'case dispute',
  });
}

/**
 * Drives one record toward its target along the six-state lifecycle:
 * open -> assigned -> answered -> resolved -> disputed. Every step checks the
 * current status first, so an interrupted run resumes where it stopped.
 */
async function advance(record, definition, entry, tokens, marker) {
  const { target } = definition;
  if (target === 'received') return record;

  if (target === 'closed') {
    if (record.status === 'open' || record.status === 'assigned') {
      record = await command(record, 'close', tokens.official, {
        reason: definition.closeReason,
        publicReason: definition.closePublicReason,
      });
    }
    return record;
  }

  if (record.status === 'open') {
    record = await command(record, 'assign', tokens.official, {});
  }
  if (target === 'assigned') return record;

  if (record.status === 'assigned') {
    record = await command(record, 'commitment', tokens.official, commitmentBody(definition));
  }
  if (target === 'answered') return record;

  if (record.status === 'answered') {
    record = await command(record, 'resolution', tokens.official, resolutionBody(definition));
  }

  if (record.status === 'resolved' && target === 'resolved') {
    for (const key of entry.followerKeys) await recordAttention(entry.caseNumber, key, 'follow');
    for (const key of entry.notFixedKeys) {
      await recordAttention(entry.caseNumber, key, 'not-fixed');
    }
    return getRecord(record.id, tokens.official);
  }

  if (record.status === 'resolved' && target === 'disputed' && !entry.disputed) {
    await disputeCase(entry, definition);
    entry.disputed = true;
    await saveMarker(marker);
    record = await getRecord(record.id, tokens.official);
  }
  return record;
}

const EXPECTED_STATUS = {
  received: 'open',
  assigned: 'assigned',
  answered: 'answered',
  resolved: 'resolved',
  disputed: 'disputed',
  closed: 'closed',
};

async function driveCases(marker, tokens) {
  for (const entry of marker.cases) {
    const definition = demoCases[entry.index];
    let record = await getRecord(entry.recordId, tokens.official);
    record = await advance(record, definition, entry, tokens, marker);
    if (record.status !== EXPECTED_STATUS[definition.target]) {
      throw new SafeError(
        `case ${entry.index + 1} expected ${EXPECTED_STATUS[definition.target]} but is ${record.status}`,
      );
    }
  }
}

function sameLabels(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((label) => actual.includes(label))
  );
}

async function verifyAndPrint(marker) {
  const { payload } = await requestJson('/api/trace/public/cases?limit=100', {
    label: 'public case list',
  });
  if (!Array.isArray(payload.cases)) throw new SafeError('public case list returned invalid JSON');

  const byNumber = new Map(payload.cases.map((item) => [item.caseNumber, item]));
  const rows = marker.cases.map((entry) => {
    const definition = demoCases[entry.index];
    const shell = byNumber.get(entry.caseNumber);
    if (!shell || typeof shell.state !== 'string') {
      throw new SafeError(`seeded case ${entry.caseNumber} is missing from the public list`);
    }
    if (shell.state !== definition.target) {
      throw new SafeError(
        `case ${entry.index + 1} expected public state ${definition.target} but is ${shell.state}`,
      );
    }
    if (shell.textStatus !== definition.textStatus) {
      throw new SafeError(
        `case ${entry.index + 1} expected text ${definition.textStatus} but is ${shell.textStatus}`,
      );
    }
    if (definition.textStatus === 'held' && shell.holdReason !== definition.holdReason) {
      throw new SafeError(`case ${entry.index + 1} expected hold reason ${definition.holdReason}`);
    }
    if (!sameLabels(shell.labels, definition.labels)) {
      throw new SafeError(`case ${entry.index + 1} expected labels ${definition.labels.join(',')}`);
    }
    if (definition.followers && shell.followerCount < definition.followers) {
      throw new SafeError(`case ${entry.index + 1} expected ${definition.followers} followers`);
    }
    if (definition.notFixed && shell.notFixedCount < definition.notFixed) {
      throw new SafeError(
        `case ${entry.index + 1} expected ${definition.notFixed} not-fixed marks`,
      );
    }
    if (definition.target === 'disputed' && !(shell.disputeCount >= 1)) {
      throw new SafeError(`case ${entry.index + 1} expected a public dispute`);
    }
    if (definition.overdue) {
      const today = dateAfter(0);
      if (typeof shell.clockDueAt !== 'string' || shell.clockDueAt.slice(0, 10) >= today) {
        throw new SafeError(`case ${entry.index + 1} expected a due date in the past`);
      }
    }
    return {
      caseNumber: entry.caseNumber,
      state: shell.state,
      text: shell.textStatus,
      labels: (shell.labels ?? []).join(',') || '-',
      url: `${publicWebBase}/vrsar/zapis/${entry.caseNumber}`,
    };
  });

  const expectedSpread = {
    received: 3,
    assigned: 1,
    answered: 2,
    resolved: 1,
    disputed: 1,
    closed: 1,
  };
  const actualSpread = Object.fromEntries(Object.keys(expectedSpread).map((state) => [state, 0]));
  for (const row of rows) {
    if (!(row.state in actualSpread)) throw new SafeError(`unexpected public state ${row.state}`);
    actualSpread[row.state] += 1;
  }
  for (const [state, count] of Object.entries(expectedSpread)) {
    if (actualSpread[state] !== count) {
      throw new SafeError(
        `public state ${state} expected ${count} but found ${actualSpread[state]}`,
      );
    }
  }

  console.table(rows);
  console.log(
    JSON.stringify({
      stage: 'seed-demo-cases',
      status: 'complete',
      cases: rows.length,
      stateSpread: actualSpread,
      held: rows.filter((row) => row.text === 'held').length,
      formLetter: rows.filter((row) => row.labels.includes('form-letter')).length,
      rateLimitRetries,
      marker: markerPath,
    }),
  );
}

async function main() {
  await setStaffPasscode();
  const tokens = { official: await signIn(STAFF_EMAIL) };
  console.log(JSON.stringify({ stage: 'staff-sign-in', status: 'complete', users: 1 }));

  const marker = await loadOrCreateMarker();
  await fileCases(marker);
  await driveCases(marker, tokens);
  await verifyAndPrint(marker);
}

try {
  await main();
} catch (error) {
  const message = error instanceof SafeError ? error.message : 'unexpected_error';
  console.error(JSON.stringify({ stage: 'seed-demo-cases', status: 'failed', error: message }));
  process.exitCode = 1;
}
