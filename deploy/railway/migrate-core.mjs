import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== '--yes') {
  throw new Error('core migrations require the explicit --yes flag');
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
    stage: 'core-migrations',
    target: {
      host: target.hostname,
      port: target.port || '5432',
      database: target.pathname.slice(1),
      user: target.username,
    },
  }),
);

const moduleUrl = new URL('../../packages/db/dist/index.js', import.meta.url);
await access(fileURLToPath(moduleUrl)).catch(() => {
  throw new Error('packages/db is not built; run bun run --filter @polis/db build');
});
const { runMigrationsOnce } = await import(moduleUrl.href);
await runMigrationsOnce(databaseUrl);
console.log(JSON.stringify({ stage: 'core-migrations', status: 'complete' }));
