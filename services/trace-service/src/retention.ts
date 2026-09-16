// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseTraceConfig } from './config.js';
import { verifyTraceMigrations } from './migrations.js';
import { TraceRepository } from './repository.js';

export interface RetentionRepository {
  removeExpiredText(now: Date, batchSize: number, retentionDays: number): Promise<number>;
}

export interface RetentionOptions {
  now: Date;
  batchSize: number;
  retentionDays: number;
}

export async function runRetention(
  repository: RetentionRepository,
  options: RetentionOptions,
): Promise<number> {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1) {
    throw new Error('retention batchSize must be a positive integer');
  }
  if (!Number.isInteger(options.retentionDays) || options.retentionDays < 30) {
    throw new Error('retention retentionDays must be an integer of at least 30');
  }
  if (Number.isNaN(options.now.getTime())) throw new Error('retention now must be valid');
  return repository.removeExpiredText(options.now, options.batchSize, options.retentionDays);
}

async function main(): Promise<void> {
  const config = parseTraceConfig(process.env);
  await verifyTraceMigrations(config.databaseUrl);
  const repository = new TraceRepository(config.databaseUrl, config);
  try {
    const removed = await runRetention(repository, {
      now: new Date(),
      batchSize: 100,
      retentionDays: config.pilot.publicTextRetentionDays,
    });
    console.log(
      JSON.stringify({ service: 'trace-service', stage: 'retention', status: 'complete', removed }),
    );
  } finally {
    await repository.close();
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  void main().catch(() => {
    console.error(
      JSON.stringify({ service: 'trace-service', stage: 'retention', error: 'retention_failed' }),
    );
    process.exitCode = 1;
  });
}
