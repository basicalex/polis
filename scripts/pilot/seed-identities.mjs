import {
  parseArgs,
  assertOwnedRuntime,
  databaseUrl,
  runBounded,
  TEST_MARKER,
  PG_BIN,
  curatedEnvironment,
} from './runtime-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const runtimePath = args.value('runtime') ?? process.env.PILOT_RUNTIME_DIR;
if (!runtimePath) throw new Error('seed identities requires --runtime');
if (process.env.PILOT_TEST_DATABASE_MARKER !== TEST_MARKER) {
  throw new Error('seed identities requires the explicit pilot test marker');
}
const runtime = await (async () => {
  const { metadata, paths } = await assertOwnedRuntime(runtimePath);
  const secrets = JSON.parse(
    await (await import('node:fs/promises')).readFile(paths.secrets, 'utf8'),
  );
  return { metadata, paths, secrets };
})();
const url = new URL(databaseUrl(runtime.metadata, runtime.secrets, 'superuser'));
if (
  url.hostname !== '127.0.0.1' ||
  !url.pathname.endsWith('_test') ||
  runtime.metadata.testMarker !== TEST_MARKER
) {
  throw new Error('seed identities requires an owned loopback *_test database');
}
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
  ['trace-reviewer-test', 'reviewer@vrsar.example.test', 'Trace reviewer test', 'staff'],
];
const values = rows
  .map(
    ([id, email, name, level]) =>
      `(${[id, email, name, level].map((value) => `'${value.replaceAll("'", "''")}'`).join(', ')})`,
  )
  .join(', ');
const query = `
  INSERT INTO citizens (id, email, display_name, identity_level)
  VALUES ${values}
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    identity_level = EXCLUDED.identity_level,
    magic_token_hash = NULL,
    magic_token_expires_at = NULL;
`;
await runBounded(
  `${PG_BIN}/psql`,
  ['--no-password', '--set', 'ON_ERROR_STOP=1', '--dbname', 'polis_trace_test', '--command', query],
  {
    env: curatedEnvironment({
      PGHOST: '127.0.0.1',
      PGPORT: String(runtime.metadata.database.port),
      PGUSER: runtime.secrets.postgres.superuser,
      PGPASSWORD: runtime.secrets.postgres.superuserPassword,
      PGDATABASE: 'polis_trace_test',
    }),
    timeoutMs: 20_000,
  },
);
