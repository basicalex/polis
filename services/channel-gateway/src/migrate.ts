// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { runChannelMigrations } from './migrations.js';

try {
  await runChannelMigrations(process.env.DATABASE_URL);
  console.log(JSON.stringify({ service: 'channel-gateway', stage: 'migrate', status: 'complete' }));
} catch (error) {
  console.error(
    JSON.stringify({
      service: 'channel-gateway',
      stage: 'migrate',
      error: error instanceof Error ? error.message : 'migration_failed',
    }),
  );
  process.exitCode = 1;
}
