// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import postgres from 'postgres';

import {
  buildShellHashMaterial,
  canonicalJson,
  sha256,
  verifyEventChain,
  verifyReceiptHash,
  verifyShellHash,
  type StoredEvent,
} from './canonical.js';
import { parseTraceConfig } from './config.js';
import { DomainError } from './domain.js';
import {
  migrationsFolder,
  readMigrations,
  runTraceMigrations,
  verifyTraceMigrations,
} from './migrations.js';
import { TraceRepository } from './repository.js';
import { runRetention } from './retention.js';
import type {
  Actor,
  CommandContext,
  DisputeInput,
  GatewayCreateInput,
  PrivateRecord,
  TraceRole,
  TraceStatus,
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

async function assertValidChain(sql: postgres.Sql, recordId: string): Promise<void> {
  const records = await sql<{ version: number; status: TraceStatus }[]>`
    SELECT version, status FROM trace_records WHERE id = ${recordId}
  `;
  const rows = await sql<
    Array<{
      id: string;
      record_id: string;
      sequence: number;
      previous_hash: string | null;
      hash: string;
      stage: StoredEvent['stage'];
      action: string;
      actor_id: string;
      actor_role: StoredEvent['actorRole'];
      note: string | null;
      payload: Record<string, unknown>;
      resulting_version: number;
      resulting_status: TraceStatus;
      created_at: Date | string;
    }>
  >`
    SELECT * FROM trace_events WHERE record_id = ${recordId} ORDER BY sequence
  `;
  const events: StoredEvent[] = rows.map((row) => ({
    id: row.id,
    recordId: row.record_id,
    sequence: row.sequence,
    previousHash: row.previous_hash?.trim() ?? null,
    hash: row.hash.trim(),
    stage: row.stage,
    action: row.action,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    note: row.note,
    payload: row.payload,
    resultingVersion: row.resulting_version,
    resultingStatus: row.resulting_status,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
  }));
  assert.deepEqual(verifyEventChain(events, records[0]), { valid: true });
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

    const migrationSql = postgres(databaseUrl, { prepare: false, onnotice: () => undefined });
    const schema = await migrationSql<{ relation: string | null }[]>`
      SELECT to_regclass('public.trace_schema_migrations')::text AS relation
    `;
    if (!schema[0]?.relation) {
      const stagedFolder = mkdtempSync(join(tmpdir(), 'trace-migrations-'));
      try {
        for (const migration of readMigrations(migrationsFolder).slice(0, -1)) {
          writeFileSync(join(stagedFolder, `${migration.version}_staged.sql`), migration.sql);
        }
        await runTraceMigrations(databaseUrl, stagedFolder);
        const seedId = '90000000-0000-4000-8000-000000000005';
        const seedTime = '2026-09-01T10:00:00.000Z';
        await migrationSql`
          INSERT INTO trace_records (
            id, municipality_id, category, office, owner_actor_id, status, version,
            created_at, updated_at, case_number, text_sha256
          ) VALUES (
            ${seedId}, 'vrsar-orsera', 'public-lighting', 'communal-system',
            'migration-seed-resident', 'open', 0, ${seedTime}, ${seedTime},
            'VRS-900005', ${'a'.repeat(64)}
          )
        `;
        await migrationSql`
          INSERT INTO trace_report_private (record_id, subject, narrative, location, contact_email)
          VALUES (${seedId}, 'Migration seed', 'Seed report text', 'Seed location', NULL)
        `;
        await migrationSql`
          INSERT INTO trace_case_shells (
            record_id, case_number, municipality_id, area, category, track, state,
            text, location, text_status, hold_reason, text_sha256, closed_public_reason,
            filed_at, clock_due_at, shell_hash, updated_at
          ) VALUES (
            ${seedId}, 'VRS-900005', 'vrsar-orsera', 'vrsar-orsera', 'public-lighting',
            'standard', 'received', 'Seed report text', 'Seed location', 'public', NULL,
            ${'a'.repeat(64)}, NULL, ${seedTime}, NULL, ${'0'.repeat(64)}, ${seedTime}
          )
        `;
        await runTraceMigrations(databaseUrl);
        const migrated = (
          await migrationSql<
            Array<{
              shell_hash: string;
              case_number: string;
              municipality_id: string;
              area: string;
              category: string;
              track: 'standard';
              state: 'received';
              text: string;
              location: string;
              text_status: 'public';
              hold_reason: null;
              removed_reason: null;
              text_sha256: string;
              labels: string[];
              closed_public_reason: null;
              filed_at: Date | string;
              clock_due_at: null;
              follower_count: number;
              also_affected_count: number;
              not_fixed_count: number;
              dispute_count: number;
              notice_count: number;
            }>
          >`SELECT * FROM trace_case_shells WHERE record_id = ${seedId}`
        )[0]!;
        const material = buildShellHashMaterial({
          caseNumber: migrated.case_number,
          municipalityId: migrated.municipality_id,
          area: migrated.area,
          category: migrated.category,
          track: migrated.track,
          state: migrated.state,
          text: migrated.text,
          location: migrated.location,
          textStatus: migrated.text_status,
          holdReason: migrated.hold_reason,
          removedReason: migrated.removed_reason,
          textSha256: migrated.text_sha256.trim(),
          labels: migrated.labels,
          closedPublicReason: migrated.closed_public_reason,
          filedAt:
            migrated.filed_at instanceof Date
              ? migrated.filed_at.toISOString()
              : new Date(migrated.filed_at).toISOString(),
          clockDueAt: migrated.clock_due_at,
          followerCount: migrated.follower_count,
          alsoAffectedCount: migrated.also_affected_count,
          notFixedCount: migrated.not_fixed_count,
          disputeCount: migrated.dispute_count,
          noticeCount: migrated.notice_count,
          updatedAt: seedTime,
          testEnvironment: true,
        });
        assert.equal(migrated.shell_hash.trim(), sha256(canonicalJson(material)));
      } finally {
        rmSync(stagedFolder, { recursive: true, force: true });
      }
    } else {
      await runTraceMigrations(databaseUrl);
    }
    await migrationSql.end({ timeout: 5 });
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
      assert.equal(
        sha256(canonicalJson(buildShellHashMaterial(publicAtFiling.case))),
        publicAtFiling.case.shellHash,
      );

      const releaseRepository = new TraceRepository(databaseUrl, {
        ...config,
        pilot: { ...config.pilot, publicTextMode: 'release' },
      });
      try {
        const releaseMode = recordFrom(
          (
            await releaseRepository.create(
              ctx(
                actor('trace-release-mode-resident', 'resident'),
                '/internal/trace/records',
                normalizeCreate({
                  subject: 'Release mode report',
                  narrative: 'A lamp near the park is dark.',
                  location: 'Park',
                }),
              ),
            )
          ).body,
        );
        const releaseShell = await releaseRepository.getPublicCase(releaseMode.caseNumber);
        assert.ok(releaseShell);
        assert.equal(releaseShell.case.textStatus, 'held');
        assert.equal(releaseShell.case.holdReason, 'pending-release');
      } finally {
        await releaseRepository.close();
      }

      const shellRepository = new TraceRepository(databaseUrl, {
        ...config,
        pilot: { ...config.pilot, publicTextMode: 'shell' },
      });
      try {
        const shellMode = recordFrom(
          (
            await shellRepository.create(
              ctx(
                actor('trace-shell-mode-resident', 'resident'),
                '/internal/trace/records',
                normalizeCreate({
                  subject: 'Shell mode report',
                  narrative: 'A lamp at the school is dark.',
                  location: 'School',
                }),
              ),
            )
          ).body,
        );
        const shellCase = await shellRepository.getPublicCase(shellMode.caseNumber);
        assert.ok(shellCase);
        assert.equal(shellCase.case.textStatus, 'held');
        assert.equal(shellCase.case.holdReason, 'policy');
        await rejectsCode(
          () =>
            shellRepository.release(
              ctx(
                official,
                `/internal/trace/records/${shellMode.id}/release`,
                normalizeRelease({}),
              ),
              shellMode.id,
            ),
          'release_not_permitted',
        );
      } finally {
        await shellRepository.close();
      }

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

      const noticePath = `/internal/trace/public/cases/${held.caseNumber}/notice`;
      const firstNotice = await repository.recordNotice(
        held.caseNumber,
        { followerKey: 'notice_follower_key_1', reason: 'personal-data', note: 'Contains a name.' },
        ctx(resident, noticePath, {}),
      );
      assert.equal(firstNotice.case.noticeCount, 1);
      const duplicateNotice = await repository.recordNotice(
        held.caseNumber,
        { followerKey: 'notice_follower_key_1', reason: 'personal-data' },
        ctx(resident, noticePath, {}),
      );
      assert.equal(duplicateNotice.case.noticeCount, 1);
      await repository.recordNotice(
        held.caseNumber,
        { followerKey: 'notice_follower_key_2', reason: 'abuse' },
        ctx(resident, noticePath, {}),
      );
      const thirdNotice = await repository.recordNotice(
        held.caseNumber,
        { followerKey: 'notice_follower_key_3', reason: 'off-topic' },
        ctx(resident, noticePath, {}),
      );
      assert.equal(thirdNotice.case.noticeCount, 3);
      assert.equal(thirdNotice.case.textStatus, 'held');
      assert.equal(thirdNotice.case.holdReason, 'notices');
      const fourthNotice = await repository.recordNotice(
        held.caseNumber,
        { followerKey: 'notice_follower_key_4', reason: 'other' },
        ctx(resident, noticePath, {}),
      );
      assert.equal(fourthNotice.case.noticeCount, 3);
      assert.equal(fourthNotice.case.shellHash, thirdNotice.case.shellHash);
      const noticeMessages = (
        await repository.listMessages(
          ctx(official, `/internal/trace/records/${held.id}/messages`, {}),
          held.id,
        )
      ).messages.filter((message) => message.kind === 'notice');
      assert.equal(noticeMessages.length, 3);
      assert.deepEqual(
        noticeMessages.map((message) => message.noticeReason),
        ['personal-data', 'abuse', 'off-topic'],
      );

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

      const beforeErase = await repository.getPublicCase(channel.case.caseNumber);
      assert.ok(beforeErase);
      await rejectsCode(
        () =>
          repository.eraseText(
            channel.case.caseNumber,
            { reopenKey: 'wrong_reopen_key_1234' },
            ctx(resident, `/internal/trace/cases/${channel.case.caseNumber}/erase-text`, {}),
          ),
        'case_not_found',
      );
      const erased = await repository.eraseText(
        channel.case.caseNumber,
        { reopenKey: channel.case.reopenKey },
        ctx(resident, `/internal/trace/cases/${channel.case.caseNumber}/erase-text`, {}),
      );
      assert.equal(erased.case.textStatus, 'removed');
      assert.equal(erased.case.removedReason, 'filer');
      assert.equal(erased.case.text, null);
      assert.equal(erased.case.location, null);
      assert.equal(erased.case.textSha256, beforeErase.case.textSha256);
      const erasedPublic = await repository.getPublicCase(channel.case.caseNumber);
      assert.ok(erasedPublic?.record);
      assert.equal(
        erasedPublic.record.disputes.every(
          (dispute) => dispute.text === null && dispute.textStatus === 'removed',
        ),
        true,
      );
      const erasedAgain = await repository.eraseText(
        channel.case.caseNumber,
        { reopenKey: channel.case.reopenKey },
        ctx(resident, `/internal/trace/cases/${channel.case.caseNumber}/erase-text`, {}),
      );
      assert.equal(erasedAgain.case.shellHash, erased.case.shellHash);
      await rejectsCode(
        () =>
          repository.release(
            ctx(
              official,
              `/internal/trace/records/${channel.case.recordId}/release`,
              normalizeRelease({}),
            ),
            channel.case.recordId,
          ),
        'text_removed',
      );
      await rejectsCode(
        () =>
          repository.hold(
            ctx(
              official,
              `/internal/trace/records/${channel.case.recordId}/hold`,
              normalizeHold({ reason: 'other' }),
            ),
            channel.case.recordId,
          ),
        'text_removed',
      );
      const privateAfterErase = await repository.getPrivate(official, channel.case.recordId);
      assert.equal(privateAfterErase?.narrative, channelInput.text);
      await assertValidChain(sql, channel.case.recordId);

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

      await sql`
        UPDATE trace_records
        SET terminal_at = '2020-01-01T00:00:00.000Z'
        WHERE id IN (${duplicate.id}, ${held.id}, ${channel.case.recordId})
      `;
      const retained = await runRetention(repository, {
        now: new Date('2026-09-16T12:00:00.000Z'),
        batchSize: 100,
        retentionDays: 730,
      });
      assert.equal(retained, 1);
      const retainedShell = await repository.getPublicCase(duplicate.caseNumber);
      assert.ok(retainedShell);
      assert.equal(retainedShell.case.textStatus, 'removed');
      assert.equal(retainedShell.case.removedReason, 'retention');
      assert.equal(retainedShell.case.text, null);
      assert.equal(retainedShell.case.location, null);
      assert.equal(verifyShellHash(retainedShell.case), true);
      assert.equal((await repository.getPublicCase(held.caseNumber))?.case.textStatus, 'held');
      assert.equal(
        (await repository.getPublicCase(channel.case.caseNumber))?.case.removedReason,
        'filer',
      );
      assert.notEqual((await repository.getPrivate(official, duplicate.id))?.narrative, '');
      await assertValidChain(sql, duplicate.id);

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
