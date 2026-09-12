// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseChannelConfig } from './config.js';
import { verifyChannelMigrations } from './migrations.js';
import { PostgresChannelStore } from './repository.js';
import { purgeExpired } from './retention.js';

let repository: PostgresChannelStore | undefined;
try {
  const config = parseChannelConfig(process.env);
  await verifyChannelMigrations(config.databaseUrl);
  repository = new PostgresChannelStore(config.databaseUrl);
  const counts = await purgeExpired(repository);
  console.log(
    JSON.stringify({ service: 'channel-gateway', stage: 'purge', status: 'complete', ...counts }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      service: 'channel-gateway',
      stage: 'purge',
      error: error instanceof Error ? error.message : 'purge_failed',
    }),
  );
  process.exitCode = 1;
} finally {
  await repository?.close().catch(() => undefined);
}
