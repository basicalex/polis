import { createRequire } from 'node:module';

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== '--yes') {
  throw new Error('identity seeding requires the explicit --yes flag');
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const traceInternalUrl = process.env.TRACE_INTERNAL_URL?.trim();
const internalApiToken = process.env.INTERNAL_API_TOKEN?.trim();
const traceGatewayActorId = process.env.TRACE_GATEWAY_ACTOR_ID?.trim();
if (!traceInternalUrl) throw new Error('TRACE_INTERNAL_URL is required');
if (!internalApiToken) throw new Error('INTERNAL_API_TOKEN is required');
if (!traceGatewayActorId) throw new Error('TRACE_GATEWAY_ACTOR_ID is required');

let traceBase;
try {
  const parsed = new URL(traceInternalUrl);
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error();
  }
  traceBase = parsed.href.replace(/\/+$/, '');
} catch {
  throw new Error('TRACE_INTERNAL_URL must be an HTTP(S) origin without credentials');
}

let target;
try {
  target = new URL(databaseUrl);
} catch {
  throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
}
if (
  (target.protocol !== 'postgres:' && target.protocol !== 'postgresql:') ||
  !target.hostname ||
  !target.pathname ||
  target.pathname === '/'
) {
  throw new Error('DATABASE_URL must name a PostgreSQL host and database');
}

console.log(
  JSON.stringify({
    stage: 'seed-identities',
    target: {
      host: target.hostname,
      port: target.port || '5432',
      database: target.pathname.slice(1),
      user: target.username,
    },
  }),
);

const requireFromDatabasePackage = createRequire(
  new URL('../../packages/db/package.json', import.meta.url),
);
const postgres = requireFromDatabasePackage('postgres');
const sql = postgres(databaseUrl, { max: 1, prepare: false });
const rows = [
  [
    'trace-resident-test',
    'resident@vrsar.example.test',
    'Trace resident test',
    'verified_resident',
  ],
  [
    'trace-resident-other-test',
    'other@vrsar.example.test',
    'Trace resident other test',
    'verified_resident',
  ],
  ['trace-official-test', 'official@vrsar.example.test', 'Trace official test', 'staff'],
];

try {
  await sql.begin(async (transaction) => {
    for (const [id, email, displayName, identityLevel] of rows) {
      await transaction`
        INSERT INTO citizens (id, email, display_name, identity_level)
        VALUES (${id}, ${email}, ${displayName}, ${identityLevel})
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          display_name = EXCLUDED.display_name,
          identity_level = EXCLUDED.identity_level,
          magic_token_hash = NULL,
          magic_token_expires_at = NULL
      `;
    }
  });
} finally {
  await sql.end({ timeout: 5 });
}

let profileResponse;
try {
  profileResponse = await fetch(
    `${traceBase}/internal/trace/officials/trace-official-test`,
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-polis-internal-token': internalApiToken,
        'x-polis-trace-gateway': traceGatewayActorId,
      },
      body: JSON.stringify({
        name: 'Ivana Testić',
        title: 'Viša stručna suradnica za komunalni sustav',
        unitId: 'communal-system',
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
} catch {
  throw new Error('official profile seed request failed');
}
if (!profileResponse.ok) {
  throw new Error(`official profile seed failed with HTTP ${profileResponse.status}`);
}

console.log(JSON.stringify({ stage: 'seed-identities', status: 'complete', rows: rows.length }));
