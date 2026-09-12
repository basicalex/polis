// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { startService } from '@polis/service-runtime';

import { parseTraceConfig } from './config.js';
import { verifyTraceMigrations } from './migrations.js';
import { TraceRepository } from './repository.js';
import { traceRoutes } from './routes.js';

export * from './canonical.js';
export * from './config.js';
export * from './domain.js';
export * from './migrations.js';
export * from './repository.js';
export * from './routes.js';
export * from './types.js';
export * from './validation.js';

async function main(): Promise<void> {
  const config = parseTraceConfig(process.env);
  await verifyTraceMigrations(config.databaseUrl);
  const rawPort = process.env.PORT ?? process.env.TRACE_SERVICE_PORT ?? 8980;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('TRACE_SERVICE_PORT must be an integer from 0 to 65535');
  }
  const repository = new TraceRepository(config.databaseUrl, config);
  const server = startService('trace-service', port, traceRoutes(repository, config));
  server.once('close', () => {
    void repository.close().catch(() => {
      console.error(
        JSON.stringify({
          service: 'trace-service',
          stage: 'shutdown',
          error: 'database_close_failed',
        }),
      );
    });
  });
  console.log(JSON.stringify({ service: 'trace-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  void main().catch(() => {
    console.error(
      JSON.stringify({ service: 'trace-service', stage: 'startup', error: 'startup_failed' }),
    );
    process.exitCode = 1;
  });
}
