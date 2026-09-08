import { access } from 'node:fs/promises';
import path from 'node:path';

import { ROOT, TEST_MARKER } from './runtime-lib.mjs';

if (process.env.PILOT_TEST_DATABASE_MARKER !== TEST_MARKER) {
  throw new Error('core migrations require the explicit pilot test marker');
}
const url = new URL(process.env.DATABASE_URL ?? '');
if (url.hostname !== '127.0.0.1' || !url.pathname.endsWith('_test')) {
  throw new Error('core migrations require a loopback *_test database');
}
const modulePath = path.join(ROOT, 'packages/db/dist/index.js');
await access(modulePath).catch(() => {
  throw new Error('packages/db is not built; run the runtime launcher with --build');
});
const { runMigrationsOnce } = await import(modulePath);
await runMigrationsOnce(process.env.DATABASE_URL);
