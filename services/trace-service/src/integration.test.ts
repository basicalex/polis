// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import postgres from 'postgres';

import { verifyReceiptHash, verifyShellHash } from './canonical.js';
import { parseTraceConfig } from './config.js';
import { DomainError } from './domain.js';
import { runTraceMigrations, verifyTraceMigrations } from './migrations.js';
import { TraceRepository } from './repository.js';
import type {
  Actor,
  CommandContext,
  DisputeInput,
  GatewayCreateInput,
  PrivateRecord,
  TraceRole,
} from './types.js';
import {
  normalizeAssign,
  normalizeClose,
  normalizeCommitment,
  normalizeCreate,
  normalizeDispute,
  normalizeHold,
  normalizeLabel,
  normalizeRelease,
  normalizeReopen,
  normalizeResolution,
} from './validation.js';

const OFFICIAL = 'trace-official-test';
const RESIDENT = 'trace-resident-test';
const OTHER_RESIDENT = 'trace-resident-other-test';
const GATEWAY = 'trace-gateway-test';
const ATTENTION_PEPPER = 'trace-integration-attention-pepper-value';
const SIGNED_BY = { name: 'Ana Anić', title: 'Head of public works' };

function actor(id: string, role: TraceRole): Actor {
  return { id, role, email: null };
}

function ctx(
  commandActor: Actor,
  path: string,
  normalizedBody: Record<string, unknown>,
  key = randomUUID(),
): CommandContext {
  return { actor: commandActor, method: 'POST', path, normalizedBody, idempotencyKey: key };
}

function recordFrom(body: unknown): PrivateRecord {
  assert.ok(body && typeof body === 'object' && 'record' in body);
  const record = body.record;
  assert.ok(record && typeof record === 'object' && 'id' in record);
  return record as PrivateRecord;
}

async function rejectsCode(run: () => Promise<unknown>, expected: string): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) => error instanceof DomainError && error.code === expected,
  );
}

test(
  'trace database implements immediate public text, official answers, disputes, and policy controls',
  {
    timeout: 120_000,
    skip: process.env.TRACE_TEST_DATABASE_URL ? false : 'TRACE_TEST_DATABASE_URL is not set',
  },
  async () => {
    const databaseUrl = process.env.TRACE_TEST_DATABASE_URL;
    if (!databaseUrl) return;
    assert.equal(process.env.DATABASE_URL, databaseUrl);
    const target = new URL(databaseUrl);
    assert.ok(target.hostname === '127.0.0.1' || target.hostname === 'localhost');
    assert.equal(target.port, '55432');
    assert.equal(target.pathname, '/polis_trace_test');
    assert.equal(target.username, 'polis_test_owner');

    await runTraceMigrations(databaseUrl);
    await verifyTraceMigrations(databaseUrl);

    const config = parseTraceConfig({
      ...process.env,
      DATABASE_URL: databaseUrl,
      INTERNAL_API_TOKEN: 'trace-integration-internal-token',
      TRACE_INTAKE_OPEN: 'true',
      TRACE_OFFICIAL_CITIZEN_IDS: OFFICIAL,
      TRACE_GATEWAY_ACTOR_IDS: GATEWAY,
      TRACE_ATTENTION_PEPPER: ATTENTION_PEPPER,
      TRACE_AI_INTAKE_URL: '',
      TRACE_AI_COMPLIANCE_URL: '',
      TRACE_HOLD_TERMS: 'blocked-term',
    });
    const repository = new TraceRepository(databaseUrl, config);
    const sql = postgres(databaseUrl, { prepare: false, onnotice: () => undefined });
    const resident = actor(RESIDENT, 'resident');
    const otherResident = actor(OTHER_RESIDENT, 'resident');
    const official = actor(OFFICIAL, 'official');
    const gateway = actor(`gateway:${GATEWAY}`, 'gateway');

    await sql.unsafe(`
      TRUNCATE TABLE
        trace_reopen_attempts,
        trace_case_attention,
        trace_case_messages,
        trace_ai_proposals,
        trace_command_idempotency,
        trace_attachments,
        trace_events,
        trace_public_snapshots,
        trace_case_shells,
        trace_record_participants,
        trace_report_private,
        trace_records
      CASCADE
    `);

    try {
      const createBody = normalizeCreate({
        subject: 'Lamp outage',
        narrative: 'The lamp beside the harbour is dark.',
        location: 'Harbour square',
        contactEmail: 'resident@example.test',
      });
      const createKey = randomUUID();
      const created = await repository.create(
        ctx(resident, '/internal/trace/records', createBody, createKey),
      );
      const replay = await repository.create(
        ctx(resident, '/internal/trace/records', createBody, createKey),
      );
      assert.deepEqual(replay, created);
      let primary = recordFrom(created.body);
      const publicAtFiling = await repository.getPublicCase(primary.caseNumber);
      assert.ok(publicAtFiling);
      assert.equal(publicAtFiling.record, null);
      assert.equal(publicAtFiling.case.state, 'received');
      assert.equal(publicAtFiling.case.text, createBody.narrative);
      assert.equal(publicAtFiling.case.location, createBody.location);
      assert.equal(publicAtFiling.case.textStatus, 'public');
      assert.equal(publicAtFiling.case.holdReason, null);
      assert.equal(publicAtFiling.case.labels.length, 0);
      assert.equal(publicAtFiling.case.notFixedCount, 0);
      assert.equal(publicAtFiling.case.disputeCount, 0);
      assert.equal(JSON.stringify(publicAtFiling.case).includes('contactEmail'), false);
      assert.equal(verifyShellHash(publicAtFiling.case), true);

      await rejectsCode(
        () =>
          repository.recordAttention(primary.caseNumber, {
            followerKey: 'not_fixed_follower_1',
            kind: 'not-fixed',
            action: 'add',
          }),
        'invalid_state',
      );

      primary = recordFrom(
        (
          await repository.assign(
            ctx(
              official,
              `/internal/trace/records/${primary.id}/assign`,
              normalizeAssign({ expectedVersion: primary.version }),
            ),
            primary.id,
          )
        ).body,
      );
      primary = recordFrom(
        (
          await repository.commitment(
            ctx(
              official,
              `/internal/trace/records/${primary.id}/commitment`,
              normalizeCommitment({
                expectedVersion: primary.version,
                commitment: 'Inspect and replace the failed lamp.',
                dueDate: '2026-12-01',
                signedBy: SIGNED_BY,
              }),
            ),
            primary.id,
          )
        ).body,
      );
      assert.equal(primary.status, 'answered');
      const answered = await repository.getPublic(primary.id);
      assert.ok(answered);
      assert.equal(answered.status, 'answered');
      assert.deepEqual(answered.signedBy, SIGNED_BY);
      assert.equal(verifyReceiptHash(answered), true);
      assert.deepEqual(
        answered.events.map((event) => event.action),
        ['report-filed', 'office-assigned', 'commitment-published'],
      );

      primary = recordFrom(
        (
          await repository.resolution(
            ctx(
              official,
              `/internal/trace/records/${primary.id}/resolution`,
              normalizeResolution({
                expectedVersion: primary.version,
                evidenceNote: 'The lamp was replaced and tested.',
                evidenceUrls: ['https://example.test/evidence/lamp'],
                signedBy: SIGNED_BY,
              }),
            ),
            primary.id,
          )
        ).body,
      );
      assert.equal(primary.status, 'resolved');
      const resolved = await repository.getPublic(primary.id);
      assert.ok(resolved);
      assert.equal(resolved.status, 'resolved');
      assert.equal(verifyReceiptHash(resolved), true);
      assert.deepEqual(
        resolved.events.slice(-2).map((event) => event.action),
        ['completion-reported', 'case-resolved-standing'],
      );
      const attention = await repository.recordAttention(primary.caseNumber, {
        followerKey: 'not_fixed_follower_1',
        kind: 'not-fixed',
        action: 'add',
      });
      assert.equal(attention.counts.notFixedCount, 1);
      assert.equal((await repository.getPublicCase(primary.caseNumber))?.case.notFixedCount, 1);

      const heldCreated = await repository.create(
        ctx(
          otherResident,
          '/internal/trace/records',
          normalizeCreate({
            subject: 'Held report',
            narrative: 'This report contains blocked-term and must wait.',
            location: 'Private lane',
          }),
        ),
      );
      let held = recordFrom(heldCreated.body);
      let heldPublic = await repository.getPublicCase(held.caseNumber);
      assert.ok(heldPublic);
      assert.equal(heldPublic.case.textStatus, 'held');
      assert.equal(heldPublic.case.holdReason, 'abuse');
      assert.equal(heldPublic.case.text, null);
      assert.equal(heldPublic.case.location, null);
      assert.match(heldPublic.case.textSha256, /^[0-9a-f]{64}$/);
      held = recordFrom(
        (
          await repository.release(
            ctx(
              official,
              `/internal/trace/records/${held.id}/release`,
              normalizeRelease({ redactedText: 'A lamp on a private lane is dark.' }),
            ),
            held.id,
          )
        ).body,
      );
      heldPublic = await repository.getPublicCase(held.caseNumber);
      assert.ok(heldPublic);
      assert.equal(heldPublic.case.textStatus, 'redacted');
      assert.equal(heldPublic.case.text, 'A lamp on a private lane is dark.');
      assert.equal(heldPublic.case.location, 'Private lane');
      assert.equal(heldPublic.case.holdReason, null);

      const duplicate = recordFrom(
        (
          await repository.create(
            ctx(
              otherResident,
              '/internal/trace/records',
              normalizeCreate({
                subject: 'Same lamp outage',
                narrative: createBody.narrative,
                location: 'Another square',
              }),
            ),
          )
        ).body,
      );
      const duplicatePublic = await repository.getPublicCase(duplicate.caseNumber);
      assert.ok(duplicatePublic);
      assert.deepEqual(duplicatePublic.case.labels, ['form-letter']);
      await repository.label(
        ctx(
          official,
          `/internal/trace/records/${duplicate.id}/label`,
          normalizeLabel({ label: 'form-letter', action: 'clear' }),
        ),
        duplicate.id,
      );
      assert.deepEqual((await repository.getPublicCase(duplicate.caseNumber))?.case.labels, []);

      const channelInput = {
        channel: 'sms' as const,
        text: 'A second lamp is dark.',
        location: 'Old town',
        source: 'typed' as const,
        occurredAt: '2026-09-16T10:00:00.000Z',
      };
      const channel = await repository.createChannelCase(
        ctx(gateway, '/internal/trace/channel/cases', channelInput),
        channelInput as GatewayCreateInput,
      );
      assert.equal(channel.shell.text, channelInput.text);
      assert.equal(JSON.stringify(channel.shell).includes('contactEmail'), false);
      let channelRecord = await repository.getPrivate(official, channel.case.recordId);
      assert.ok(channelRecord);
      channelRecord = recordFrom(
        (
          await repository.assign(
            ctx(
              official,
              `/internal/trace/records/${channelRecord.id}/assign`,
              normalizeAssign({ expectedVersion: channelRecord.version }),
            ),
            channelRecord.id,
          )
        ).body,
      );
      channelRecord = recordFrom(
        (
          await repository.commitment(
            ctx(
              official,
              `/internal/trace/records/${channelRecord.id}/commitment`,
              normalizeCommitment({
                expectedVersion: channelRecord.version,
                commitment: 'Replace the second lamp.',
                dueDate: '2026-12-02',
                signedBy: SIGNED_BY,
              }),
            ),
            channelRecord.id,
          )
        ).body,
      );
      channelRecord = recordFrom(
        (
          await repository.resolution(
            ctx(
              official,
              `/internal/trace/records/${channelRecord.id}/resolution`,
              normalizeResolution({
                expectedVersion: channelRecord.version,
                evidenceNote: 'Second lamp replaced.',
                evidenceUrls: ['https://example.test/evidence/second-lamp'],
                signedBy: SIGNED_BY,
              }),
            ),
            channelRecord.id,
          )
        ).body,
      );

      for (let disputeNumber = 1; disputeNumber <= 3; disputeNumber += 1) {
        const normalized = normalizeDispute({
          reopenKey: channel.case.reopenKey,
          text: `The lamp is still dark after check ${disputeNumber}.`,
        }) as unknown as DisputeInput;
        const disputed = await repository.dispute(channel.case.caseNumber, normalized);
        assert.equal(disputed.case.state, 'disputed');
        assert.equal(disputed.case.disputeCount, disputeNumber);
        assert.equal(disputed.record.status, 'disputed');
        assert.equal(disputed.record.disputes.length, disputeNumber);
        assert.equal(disputed.record.disputes.at(-1)?.text, normalized.text);
        assert.equal(verifyReceiptHash(disputed.record), true);

        channelRecord = await repository.getPrivate(official, channel.case.recordId);
        assert.ok(channelRecord);
        channelRecord = recordFrom(
          (
            await repository.reopen(
              ctx(
                official,
                `/internal/trace/records/${channelRecord.id}/reopen`,
                normalizeReopen({ note: 'The office will repair it again.' }),
              ),
              channelRecord.id,
            )
          ).body,
        );
        assert.equal(channelRecord.status, 'answered');
        channelRecord = recordFrom(
          (
            await repository.resolution(
              ctx(
                official,
                `/internal/trace/records/${channelRecord.id}/resolution`,
                normalizeResolution({
                  expectedVersion: channelRecord.version,
                  evidenceNote: `Follow-up repair ${disputeNumber} completed.`,
                  evidenceUrls: [`https://example.test/evidence/follow-up-${disputeNumber}`],
                  signedBy: SIGNED_BY,
                }),
              ),
              channelRecord.id,
            )
          ).body,
        );
      }

      await rejectsCode(
        () =>
          repository.dispute(
            channel.case.caseNumber,
            normalizeDispute({
              reopenKey: channel.case.reopenKey,
              text: 'The lamp is still dark for a fourth time.',
            }) as unknown as DisputeInput,
          ),
        'dispute_limit',
      );
      const appeal = await repository.appendFilerMessage(
        channel.case.caseNumber,
        channel.case.reopenKey,
        { kind: 'label-appeal', body: 'This report was written by the filer.' },
      );
      assert.equal(appeal.message.kind, 'label-appeal');

      const closeCandidate = await repository.getPrivate(official, duplicate.id);
      assert.ok(closeCandidate);
      const closed = await repository.closeCase(
        ctx(
          official,
          `/internal/trace/records/${duplicate.id}/close`,
          normalizeClose({
            expectedVersion: closeCandidate.version,
            reason: 'duplicate',
            publicReason: 'This report duplicates an existing case.',
          }),
        ),
        duplicate.id,
        {
          reason: 'duplicate',
          publicReason: 'This report duplicates an existing case.',
        },
      );
      assert.equal(closed.shell.state, 'closed');
      assert.equal(closed.shell.closedPublicReason, 'This report duplicates an existing case.');

      await repository.hold(
        ctx(
          official,
          `/internal/trace/records/${held.id}/hold`,
          normalizeHold({ reason: 'other', note: 'Final policy check.' }),
        ),
        held.id,
      );
      const heldAgain = await repository.getPublicCase(held.caseNumber);
      assert.ok(heldAgain);
      assert.equal(heldAgain.case.textStatus, 'held');
    } finally {
      await sql.unsafe(`
        TRUNCATE TABLE
          trace_reopen_attempts,
          trace_case_attention,
          trace_case_messages,
          trace_ai_proposals,
          trace_command_idempotency,
          trace_attachments,
          trace_events,
          trace_public_snapshots,
          trace_case_shells,
          trace_record_participants,
          trace_report_private,
          trace_records
        CASCADE
      `);
      await repository.close();
      await sql.end({ timeout: 5 });
    }
  },
);
