import { runTraceMigrations } from './migrations.js';

try {
  await runTraceMigrations(process.env.DATABASE_URL);
  console.log(JSON.stringify({ service: 'trace-service', stage: 'migrate', status: 'complete' }));
} catch {
  console.error(
    JSON.stringify({ service: 'trace-service', stage: 'migrate', error: 'migration_failed' }),
  );
  process.exitCode = 1;
}
