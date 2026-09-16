// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { phoneHashPrefix } from './log.js';
import type { PipelineDeps, TraceCaseClosure } from './pipeline-types.js';
import type { ChannelStore } from './store.js';
import type { PurgeCounts } from './types.js';

export async function purgeExpired(
  store: ChannelStore,
  now: Date = new Date(),
): Promise<PurgeCounts> {
  return store.purgeExpired(now);
}

export async function sweepCaseClosures(
  deps: PipelineDeps,
  limit = 200,
): Promise<{ closed: number; reopened: number; skipped: number }> {
  const now = deps.now();
  const retentionMs = deps.config.closedRetentionDays * 86_400_000;
  const ceilingMs = deps.config.vaultTtlDays * 86_400_000;
  const links = [
    ...(await deps.store.listLinksByState('open', limit)),
    ...(await deps.store.listLinksByState('closed', limit)),
  ];
  let closed = 0;
  let reopened = 0;
  let skipped = 0;

  for (const link of links) {
    let closure: TraceCaseClosure | null;
    try {
      closure = await deps.trace.readCaseClosure(link.caseNumber);
    } catch (error) {
      skipped += 1;
      deps.log({
        service: 'channel-gateway',
        stage: 'retention',
        code: 'closure_unknown',
        caseNumber: link.caseNumber,
        ...(error instanceof Error ? { error: error.message } : {}),
      });
      continue;
    }
    if (!closure) {
      skipped += 1;
      deps.log({
        service: 'channel-gateway',
        stage: 'retention',
        code: 'closure_unknown',
        caseNumber: link.caseNumber,
      });
      continue;
    }

    const parsedTerminalAt = closure.terminalAt ? new Date(closure.terminalAt) : null;
    const terminalAt =
      parsedTerminalAt && !Number.isNaN(parsedTerminalAt.getTime()) ? parsedTerminalAt : null;

    if (link.state === 'open' && terminalAt) {
      const expiresAt = new Date(
        Math.min(link.expiresAt.getTime(), terminalAt.getTime() + retentionMs),
      );
      await deps.store.closeLink(link.phoneHash, link.recordId, {
        closedAt: terminalAt,
        expiresAt,
      });
      if ((await deps.store.listOpenLinks(link.phoneHash)).length === 0) {
        await deps.store.capIdentityExpiry(link.phoneHash, expiresAt);
      }
      closed += 1;
      void deps.audit
        .emit({
          eventType: 'channel.link.closed',
          code: 'closed',
          channel: link.channel,
          phoneHashPrefix: phoneHashPrefix(link.phoneHash),
          recordId: link.recordId,
          caseNumber: link.caseNumber,
        })
        .catch(() => undefined);
      continue;
    }

    if (link.state === 'closed' && !terminalAt) {
      const ceiling = new Date(now.getTime() + ceilingMs);
      await deps.store.upsertLink({
        ...link,
        state: 'open',
        closedAt: null,
        expiresAt: new Date(Math.max(link.expiresAt.getTime(), ceiling.getTime())),
      });
      const identity = await deps.store.getIdentity(link.phoneHash);
      if (identity) {
        await deps.store.upsertIdentity({ ...identity, expiresAt: ceiling });
      }
      reopened += 1;
    }
  }

  return { closed, reopened, skipped };
}

export async function runRetentionCycle(
  deps: PipelineDeps,
): Promise<{ sweep: Awaited<ReturnType<typeof sweepCaseClosures>>; purged: PurgeCounts }> {
  const sweep = await sweepCaseClosures(deps);
  const purged = await purgeExpired(deps.store, deps.now());
  return { sweep, purged };
}
