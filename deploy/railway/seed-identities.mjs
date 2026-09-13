import { createRequire } from 'node:module';

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== '--yes') {
  throw new Error('identity seeding requires the explicit --yes flag');
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

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
  ['trace-resident-test', 'resident@vrsar.example.test', 'Trace resident test', 'verified_resident'],
  [
    'trace-resident-other-test',
    'other@vrsar.example.test',
    'Trace resident other test',
    'verified_resident',
  ],
  ['trace-official-test', 'official@vrsar.example.test', 'Trace official test', 'staff'],
  ['trace-reviewer-test', 'reviewer@vrsar.example.test', 'Trace reviewer test', 'staff'],
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

console.log(JSON.stringify({ stage: 'seed-identities', status: 'complete', rows: rows.length }));
