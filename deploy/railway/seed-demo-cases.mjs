import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const STAFF_EMAILS = ['official@vrsar.example.test', 'reviewer@vrsar.example.test'];
const PUBLIC_WEB_BASE = 'https://polis-interface-web-preview.polis-apps-web.workers.dev';
const REQUEST_DELAY_MS = 250;
const MAX_RATE_LIMIT_RETRIES = 5;

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
if (staffPasscode.length > 256) throw new SafeError('DEMO_STAFF_PASSCODE must be at most 256 characters');

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

let platformBase;
try {
  const parsed = new URL(process.env.PLATFORM_API_BASE);
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error();
  }
  platformBase = parsed.href.replace(/\/+$/, '');
} catch {
  throw new SafeError('PLATFORM_API_BASE must be an HTTP(S) origin without credentials');
}

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

const demoCases = [
  {
    target: 'received',
    text: 'Ulična svjetiljka na Obali maršala Tita uz marinu ne radi već nekoliko večeri. Dio šetnice ostaje potpuno neosvijetljen.',
    location: 'Obala maršala Tita, uz marinu',
  },
  {
    target: 'assigned',
    text: 'Svjetiljka u Ulici Rade Končara stalno treperi i povremeno se potpuno ugasi. Kvar je vidljiv svake večeri.',
    location: 'Ulica Rade Končara, kod raskrižja',
  },
  {
    target: 'in-review',
    text: 'Rasvjetni stup na parkiralištu Montraker srušen je uz rub kolnika. Svjetiljka je razbijena, a područje noću ostaje u mraku.',
    location: 'Parkiralište Montraker, zapadni ulaz',
    publicSummary: 'Prijavljen je srušen rasvjetni stup na zapadnom ulazu parkirališta Montraker.',
    commitment: 'Upravni odjel za komunalni sustav uklonit će oštećeni stup, postaviti novi stup sa svjetiljkom i provjeriti električni priključak.',
    dueInDays: 21,
  },
  {
    target: 'returned-in-review',
    text: 'Pješački prijelaz kod škole u Ulici Aldo Negri noću je slabo osvijetljen jer obližnja svjetiljka ne radi. Pješaci se teško uočavaju.',
    location: 'Ulica Aldo Negri, kod škole',
    firstPublicSummary: 'Prijavljeno je slabo osvjetljenje u blizini škole.',
    firstCommitment: 'Upravni odjel za komunalni sustav pregledat će javnu rasvjetu i odrediti potrebne radove.',
    publicSummary: 'Prijavljen je kvar svjetiljke koja osvjetljava pješački prijelaz kod škole u Ulici Aldo Negri.',
    commitment: 'Upravni odjel za komunalni sustav zamijenit će neispravnu svjetiljku, izmjeriti osvijetljenost prijelaza i po potrebi podesiti rasvjetno tijelo.',
    dueInDays: 14,
  },
  {
    target: 'published',
    text: 'Javna rasvjeta u Dalmatinskoj ulici ostaje uključena tijekom cijelog dana. Čini se da vremenski program ne prebacuje rasvjetu na dnevni režim.',
    location: 'Dalmatinska ulica, kod pošte',
    publicSummary: 'Prijavljeno je da javna rasvjeta u Dalmatinskoj ulici ostaje uključena tijekom dana.',
    commitment: 'Upravni odjel za komunalni sustav provjerit će upravljački sat, podesiti dnevno-noćni program i ispitati uključenje cijele rasvjetne grane.',
    dueInDays: 10,
  },
  {
    target: 'published',
    text: 'Ormarić javne rasvjete na autobusnom stajalištu je oštećen i vrata se ne mogu zatvoriti. Kroz otvor se vide električni vodovi.',
    location: 'Autobusno stajalište Vrsar centar',
    publicSummary: 'Prijavljen je oštećen ormarić javne rasvjete s vidljivim električnim vodovima na autobusnom stajalištu.',
    commitment: 'Upravni odjel za komunalni sustav osigurat će ormarić, zamijeniti oštećena vrata i zatražiti pregled električnih spojeva.',
    dueInDays: 7,
  },
  {
    target: 'resolved',
    text: 'Pješačka staza prema plaži Valkanela nema rasvjetu na dijelu između naselja i obalnog puta. Prolaz je nakon zalaska sunca potpuno taman.',
    location: 'Pješačka staza prema plaži Valkanela',
    publicSummary: 'Prijavljen je neosvijetljen dio pješačke staze prema plaži Valkanela.',
    commitment: 'Upravni odjel za komunalni sustav postavit će dvije svjetiljke na neosvijetljenom dijelu staze i provjeriti napajanje rasvjetne linije.',
    dueInDays: 30,
    evidenceNote: 'Dana 11. rujna 2026. postavljena su dva nova rasvjetna tijela, popravljen je priključni vod i potvrđen je rad rasvjete duž cijelog dijela staze.',
    evidenceUrl: 'https://www.vrsar.hr/komunalne-obavijesti/rasvjeta-staza-valkanela',
  },
  {
    target: 'resolved',
    text: 'Nova LED svjetiljka u Gradskoj ulici usmjerena je prema prozorima stanova i stvara jako blještanje tijekom noći. Potrebno je prilagoditi kut svjetiljke.',
    location: 'Gradska ulica, kod broja 12',
    publicSummary: 'Prijavljeno je blještanje nove LED svjetiljke prema stanovima u Gradskoj ulici.',
    commitment: 'Upravni odjel za komunalni sustav podesit će nagib LED svjetiljke, ugraditi zaslon prema pročelju i provjeriti osvijetljenost kolnika.',
    dueInDays: 14,
    evidenceNote: 'Dana 12. rujna 2026. podešen je nagib LED svjetiljke i ugrađen je bočni zaslon; večernjom provjerom potvrđeno je da svjetlo više ne pada na prozore.',
    evidenceUrl: 'https://www.vrsar.hr/komunalne-obavijesti/podesavanje-led-gradska',
  },
  {
    target: 'closed',
    text: 'Svjetiljka na cesti prema groblju ne radi već nekoliko tjedana. Na tom dijelu nema drugog izvora javne rasvjete.',
    location: 'Cesta prema groblju, prvi zavoj',
    closeReason: 'duplicate',
    closePublicReason: 'Prijava je zatvorena kao duplikat već evidentiranog kvara javne rasvjete na istoj lokaciji. Radovi se prate u ranijem zapisu.',
  },
];

async function requestJson(path, options = {}) {
  const method = options.method ?? 'GET';
  const headers = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.sessionToken) headers.authorization = `Bearer ${options.sessionToken}`;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
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

    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      rateLimitRetries += 1;
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMilliseconds = Number.isFinite(retryAfter)
        ? Math.max(1_000, Math.min(15_000, retryAfter * 1_000))
        : 1_500 * (attempt + 1);
      console.log(JSON.stringify({ stage: 'rate-limit', retry: attempt + 1 }));
      await delay(waitMilliseconds);
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
  throw new SafeError(`${options.label ?? 'API'} failed: 429 rate_limited`);
}

async function saveMarker(marker) {
  await mkdir(dirname(markerPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${markerPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, markerPath);
}

function validateMarker(marker) {
  if (!marker || marker.version !== 1 || !Array.isArray(marker.cases) || marker.cases.length !== 9) {
    throw new SafeError('demo marker is invalid; use --reset to start a new batch');
  }
  for (const [index, entry] of marker.cases.entries()) {
    if (
      !entry ||
      entry.index !== index ||
      typeof entry.filingKey !== 'string' ||
      (entry.recordId !== null && typeof entry.recordId !== 'string') ||
      (entry.caseNumber !== null && typeof entry.caseNumber !== 'string')
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
    version: 1,
    createdAt: new Date().toISOString(),
    cases: demoCases.map((_item, index) => ({
      index,
      filingKey: randomUUID(),
      recordId: null,
      caseNumber: null,
    })),
  };
  await saveMarker(marker);
  console.log(JSON.stringify({ stage: 'demo-cases', filing: reset ? 'reset' : 'new' }));
  return marker;
}

async function setStaffPasscodes() {
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
      WHERE email IN (${STAFF_EMAILS[0]}, ${STAFF_EMAILS[1]})
      RETURNING email
    `;
  } catch {
    throw new SafeError('staff passcode database update failed');
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }

  const updatedEmails = rows.map((row) => row.email).sort();
  if (updatedEmails.length !== STAFF_EMAILS.length) {
    throw new SafeError(`staff passcode update expected 2 identities but updated ${updatedEmails.length}`);
  }
  console.log(JSON.stringify({ stage: 'staff-passcode', updatedEmails }));
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
      filed.state !== 'received'
    ) {
      throw new SafeError('case filing returned invalid JSON');
    }
    entry.recordId = filed.recordId;
    entry.caseNumber = filed.caseNumber;
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

async function command(record, suffix, sessionToken, body, officialToken) {
  await requestJson(`/api/trace/records/${encodeURIComponent(record.id)}/${suffix}`, {
    method: 'POST',
    body: { expectedVersion: record.version, ...body },
    sessionToken,
    idempotencyKey: randomUUID(),
    label: `record ${suffix}`,
  });
  return getRecord(record.id, officialToken);
}

function commitmentBody(definition, initial = false) {
  return {
    publicSummary: initial ? definition.firstPublicSummary : definition.publicSummary,
    commitment: initial ? definition.firstCommitment : definition.commitment,
    dueDate: dateAfter(definition.dueInDays),
  };
}

async function advanceStandard(record, definition, target, tokens) {
  if (record.status === 'open') {
    record = await command(record, 'assign', tokens.official, {}, tokens.official);
  }
  if (target === 'assigned') return record;

  if (record.status === 'assigned' || record.status === 'returned') {
    record = await command(
      record,
      'commitment',
      tokens.official,
      commitmentBody(definition),
      tokens.official,
    );
  }
  if (target === 'in-review') return record;

  if (record.status === 'commitment-pending-review') {
    record = await command(
      record,
      'review',
      tokens.reviewer,
      { decision: 'accept' },
      tokens.official,
    );
  }
  if (target === 'published') return record;

  if (record.status === 'published') {
    record = await command(
      record,
      'resolution',
      tokens.official,
      { evidenceNote: definition.evidenceNote, evidenceUrls: [definition.evidenceUrl] },
      tokens.official,
    );
  }
  if (record.status === 'resolution-pending-review') {
    record = await command(
      record,
      'resolution-review',
      tokens.reviewer,
      { decision: 'accept' },
      tokens.official,
    );
  }
  return record;
}

async function advanceReturnedCase(record, definition, tokens) {
  if (record.status === 'open') {
    record = await command(record, 'assign', tokens.official, {}, tokens.official);
  }
  if (record.status === 'assigned') {
    record = await command(
      record,
      'commitment',
      tokens.official,
      commitmentBody(definition, true),
      tokens.official,
    );
  }
  const hasReturn = record.events.some((event) => event?.action === 'commitment-returned');
  if (record.status === 'commitment-pending-review' && !hasReturn) {
    record = await command(
      record,
      'review',
      tokens.reviewer,
      { decision: 'return', note: 'Navesti točnu svjetiljku uz pješački prijelaz, konkretne radove i provjeru osvijetljenosti.' },
      tokens.official,
    );
  }
  if (record.status === 'returned') {
    record = await command(
      record,
      'commitment',
      tokens.official,
      commitmentBody(definition),
      tokens.official,
    );
  }
  return record;
}

async function driveCases(marker, tokens) {
  const expectedStatus = {
    received: 'open',
    assigned: 'assigned',
    'in-review': 'commitment-pending-review',
    'returned-in-review': 'commitment-pending-review',
    published: 'published',
    resolved: 'resolved',
    closed: 'closed',
  };

  for (const entry of marker.cases) {
    const definition = demoCases[entry.index];
    let record = await getRecord(entry.recordId, tokens.official);

    if (definition.target === 'received') {
      // Intentionally untouched.
    } else if (definition.target === 'returned-in-review') {
      record = await advanceReturnedCase(record, definition, tokens);
    } else if (definition.target === 'closed') {
      if (record.status === 'open' || record.status === 'assigned' || record.status === 'returned') {
        record = await command(
          record,
          'close',
          tokens.reviewer,
          {
            reason: definition.closeReason,
            publicReason: definition.closePublicReason,
          },
          tokens.official,
        );
      }
    } else {
      record = await advanceStandard(record, definition, definition.target, tokens);
    }

    if (record.status !== expectedStatus[definition.target]) {
      throw new SafeError(
        `case ${entry.index + 1} expected ${expectedStatus[definition.target]} but is ${record.status}`,
      );
    }
  }
}

async function verifyAndPrint(marker) {
  const { payload } = await requestJson('/api/trace/public/cases?limit=100', {
    label: 'public case list',
  });
  if (!Array.isArray(payload.cases)) throw new SafeError('public case list returned invalid JSON');

  const byNumber = new Map(payload.cases.map((item) => [item.caseNumber, item]));
  const rows = marker.cases.map((entry) => {
    const publicCase = byNumber.get(entry.caseNumber);
    if (!publicCase || typeof publicCase.state !== 'string') {
      throw new SafeError(`seeded case ${entry.caseNumber} is missing from the public list`);
    }
    return {
      caseNumber: entry.caseNumber,
      state: publicCase.state,
      url: `${PUBLIC_WEB_BASE}/vrsar/zapis/${entry.caseNumber}`,
    };
  });

  const expectedSpread = {
    received: 1,
    assigned: 1,
    'in-review': 2,
    published: 2,
    resolved: 2,
    closed: 1,
  };
  const actualSpread = Object.fromEntries(Object.keys(expectedSpread).map((state) => [state, 0]));
  for (const row of rows) {
    if (!(row.state in actualSpread)) throw new SafeError(`unexpected public state ${row.state}`);
    actualSpread[row.state] += 1;
  }
  for (const [state, count] of Object.entries(expectedSpread)) {
    if (actualSpread[state] !== count) {
      throw new SafeError(`public state ${state} expected ${count} but found ${actualSpread[state]}`);
    }
  }

  console.table(rows);
  console.log(
    JSON.stringify({
      stage: 'seed-demo-cases',
      status: 'complete',
      cases: rows.length,
      stateSpread: actualSpread,
      rateLimitRetries,
      marker: markerPath,
    }),
  );
}

async function main() {
  await setStaffPasscodes();
  const tokens = {
    official: await signIn(STAFF_EMAILS[0]),
    reviewer: await signIn(STAFF_EMAILS[1]),
  };
  console.log(JSON.stringify({ stage: 'staff-sign-in', status: 'complete', users: 2 }));

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
