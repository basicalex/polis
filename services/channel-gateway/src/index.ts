// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { startService, type ReadinessCheck } from '@polis/service-runtime';

import { createAuditClient } from './audit.js';
import { parseChannelConfig } from './config.js';
import { logEvent } from './log.js';
import { verifyChannelMigrations } from './migrations.js';
import { createChannelProvider } from './provider-factory.js';
import { PostgresChannelStore } from './repository.js';
import { purgeExpired } from './retention.js';
import { deliverOutbound, runRelayCycle } from './relay.js';
import { channelRoutes } from './routes.js';
import { createTraceClient } from './trace-client.js';
import { createSttProvider } from './stt-provider.js';
import type { PipelineDeps } from './pipeline-types.js';

export * from './audit.js';
export { ChannelProviderError } from './channel-provider.js';
export * from './config.js';
export * from './copy-hr.js';
export * from './crypto.js';
export * from './log.js';
export * from './memory-store.js';
export * from './migrations.js';
export * from './phone.js';
export * from './pipeline.js';
export * from './provider-factory.js';
export { deliverOutbound, runRelayCycle } from './relay.js';
export * from './repository.js';
export * from './retention.js';
export * from './routes.js';
export * from './store.js';
export * from './stub-provider.js';
export * from './infobip-client.js';
export * from './trace-client.js';
export * from './types.js';

async function main(): Promise<void> {
  const config = parseChannelConfig(process.env);
  await verifyChannelMigrations(config.databaseUrl);
  const port = Number(process.env.PORT ?? process.env.CHANNEL_GATEWAY_PORT ?? 8990);
  const portSetting = process.env.PORT === undefined ? 'CHANNEL_GATEWAY_PORT' : 'PORT';
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`${portSetting} must be an integer from 0 to 65535`);
  }

  const repository = new PostgresChannelStore(config.databaseUrl);
  const deps: PipelineDeps = {
    config,
    store: repository,
    provider: createChannelProvider(config, fetch),
    trace: createTraceClient(config, fetch),
    audit: createAuditClient(config, fetch),
    log: logEvent,
    now: () => new Date(),
    stt: createSttProvider(config, fetch),
  };
  const readiness: ReadinessCheck = async () => {
    try {
      await repository.ping();
      return { ready: true };
    } catch {
      return { ready: false, dependency: 'database' };
    }
  };
  const server = startService('channel-gateway', port, channelRoutes(deps), { readiness });
  const purgeTimer = setInterval(() => {
    void purgeExpired(repository, deps.now()).catch((error: unknown) => {
      logEvent({
        service: 'channel-gateway',
        stage: 'retention',
        code: 'purge_failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    });
  }, config.purgeIntervalMs);
  purgeTimer.unref();

  const relayTimer = setInterval(() => {
    void runRelayCycle(deps).catch((error: unknown) => {
      logEvent({
        service: 'channel-gateway',
        stage: 'relay',
        code: 'relay_failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    });
  }, config.relayIntervalMs);
  relayTimer.unref();

  const deliveryTimer = setInterval(() => {
    void deliverOutbound(deps).catch((error: unknown) => {
      logEvent({
        service: 'channel-gateway',
        stage: 'delivery',
        code: 'delivery_failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    });
  }, config.relayIntervalMs);
  deliveryTimer.unref();

  server.once('close', () => {
    clearInterval(purgeTimer);
    clearInterval(relayTimer);
    clearInterval(deliveryTimer);
    void repository.close().catch((error: unknown) => {
      logEvent({
        service: 'channel-gateway',
        stage: 'shutdown',
        code: 'database_close_failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    });
  });
  logEvent({ service: 'channel-gateway', stage: 'startup', code: `listening:${port}` });
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  void main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        service: 'channel-gateway',
        stage: 'startup',
        error: error instanceof Error ? error.message : 'startup_failed',
      }),
    );
    process.exitCode = 1;
  });
}
