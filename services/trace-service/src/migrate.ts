// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

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
