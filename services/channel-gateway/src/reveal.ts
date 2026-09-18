// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createAuditClient } from './audit.js';
import { parseChannelConfig } from './config.js';
import { verifyChannelMigrations } from './migrations.js';
import { PostgresChannelStore } from './repository.js';
import { decryptPhone } from './relay.js';

export const REVEAL_USAGE =
  'Usage: bun run reveal --case <caseNumber> --request-ref <text> --actor <text>';

export interface RevealArgs {
  caseNumber: string;
  requestRef: string;
  actor: string;
}

export function parseRevealArgs(argv: readonly string[]): RevealArgs | null {
  const values = new Map<string, string>();
  const names: Record<string, true> = {
    '--case': true,
    '--request-ref': true,
    '--actor': true,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1]?.trim();
    if (!name || !names[name] || values.has(name) || !value || value.startsWith('--')) {
      return null;
    }
    values.set(name, value);
  }
  if (values.size !== Object.keys(names).length) return null;
  return {
    caseNumber: values.get('--case')!,
    requestRef: values.get('--request-ref')!,
    actor: values.get('--actor')!,
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const args = parseRevealArgs(argv);
  if (!args) {
    console.error(REVEAL_USAGE);
    return 2;
  }

  let repository: PostgresChannelStore | undefined;
  try {
    const config = parseChannelConfig(process.env);
    await verifyChannelMigrations(config.databaseUrl);
    repository = new PostgresChannelStore(config.databaseUrl);
    const link = await repository.findLinkByCase(args.caseNumber);
    if (!link) throw new Error('case has no channel identity');
    const identity = await repository.getIdentity(link.phoneHash);
    if (!identity) throw new Error('case channel identity is unavailable');
    const phone = await decryptPhone(
      {
        config,
        store: repository,
        audit: createAuditClient(config, fetch),
        now: () => new Date(),
      },
      identity,
      {
        reason: 'reveal',
        caseNumber: link.caseNumber,
        recordId: link.recordId,
        requestRef: args.requestRef,
        actor: args.actor,
      },
    );
    process.stdout.write(`${phone}\n`);
    return 0;
  } catch (error) {
    console.error(
      JSON.stringify({
        service: 'channel-gateway',
        stage: 'reveal',
        error: error instanceof Error ? error.message : 'reveal_failed',
      }),
    );
    return 1;
  } finally {
    await repository?.close().catch(() => undefined);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) process.exitCode = await main();
