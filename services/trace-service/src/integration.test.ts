// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import postgres from 'postgres';

import {
  verifyEventChain,
  verifyReceiptHash,
  verifyShellHash,
  type StoredEvent,
} from './canonical.js';
import { parseTraceConfig } from './config.js';
import { DomainError, reopenKeyHash } from './domain.js';
import { readMigrations, runTraceMigrations, verifyTraceMigrations } from './migrations.js';
import { TraceRepository } from './repository.js';
import type { Actor, CommandContext, PrivateRecord, TraceRole } from './types.js';
import {
  normalizeAssign,
  normalizeAttachment,
  normalizeCommitment,
  normalizeCreate,
  normalizeResolution,
  normalizeReview,
} from './validation.js';

const OFFICIAL = 'trace-official-test';
const REVIEWER = 'trace-reviewer-test';
const RESIDENT = 'trace-resident-test';
const OTHER_RESIDENT = 'trace-resident-other-test';
const GATEWAY = 'trace-gateway-test';
const ATTENTION_PEPPER = 'trace-integration-attention-pepper-value';

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

function hasRecordBody(value: unknown): value is { record: PrivateRecord } {
  if (!value || typeof value !== 'object' || !('record' in value)) return false;
  const record = value.record;
  return Boolean(record && typeof record === 'object' && 'id' in record && 'version' in record);
}

function recordFrom(body: unknown): PrivateRecord {
  assert.ok(hasRecordBody(body));
  return body.record;
}

async function rejectsCode(run: () => Promise<unknown>, expected: string): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) => error instanceof DomainError && error.code === expected,
  );
}

test(
  'explicit trace database supports the complete reviewed publication and resolution loop',
  {
    timeout: 120_000,
    skip: process.env.TRACE_TEST_DATABASE_URL ? false : 'TRACE_TEST_DATABASE_URL is not set',
  },
  async () => {
    const databaseUrl = process.env.TRACE_TEST_DATABASE_URL;
    if (!databaseUrl) return;
    assert.equal(
      process.env.DATABASE_URL,
      databaseUrl,
      'DATABASE_URL must explicitly match TRACE_TEST_DATABASE_URL',
    );
    const target = new URL(databaseUrl);
    assert.ok(
      target.hostname === '127.0.0.1' || target.hostname === 'localhost',
      'trace integration database must use a loopback host',
    );
    assert.equal(
      target.port,
      '55432',
      'trace integration database must use the isolated test port',
    );
    assert.equal(
      target.pathname,
      '/polis_trace_test',
      'trace integration database name is not authorized',
    );
    assert.equal(
      target.username,
      'polis_test_owner',
      'trace integration database owner is not authorized',
    );
    await runTraceMigrations(databaseUrl);
    await verifyTraceMigrations(databaseUrl);

    const config = parseTraceConfig({
      ...process.env,
      DATABASE_URL: databaseUrl,
      INTERNAL_API_TOKEN: 'trace-integration-internal-token',
      TRACE_INTAKE_OPEN: 'true',
      TRACE_OFFICIAL_CITIZEN_IDS: OFFICIAL,
      TRACE_REVIEWER_CITIZEN_IDS: REVIEWER,
      TRACE_GATEWAY_ACTOR_IDS: GATEWAY,
      TRACE_ATTENTION_PEPPER: ATTENTION_PEPPER,
    });
    const repository = new TraceRepository(databaseUrl, config);
    const sql = postgres(databaseUrl, { prepare: false, onnotice: () => undefined });
    const resident = actor(RESIDENT, 'resident');
    const otherResident = actor(OTHER_RESIDENT, 'resident');
    const official = actor(OFFICIAL, 'official');
    const reviewer = actor(REVIEWER, 'reviewer');

    await sql.unsafe(`
    TRUNCATE TABLE
      trace_command_idempotency,
      trace_attachments,
      trace_events,
      trace_public_snapshots,
      trace_record_participants,
      trace_report_private,
      trace_records
    CASCADE
  `);

    try {
      await repository.check();
      const createKey = randomUUID();
      const createBody = normalizeCreate({
        subject: "Light outage'); DROP TABLE trace_records; --",
        narrative: 'Private resident narrative',
        location: 'Private location detail',
        contactEmail: 'resident@example.test',
      });
      const created = await repository.create(
        ctx(resident, '/internal/trace/records', createBody, createKey),
      );
      assert.equal(created.status, 201);
      let primary = recordFrom(created.body);
      assert.equal(primary.status, 'open');
      assert.equal(primary.version, 0);
      assert.equal(primary.subject, createBody.subject);

      const replay = await repository.create(
        ctx(resident, '/internal/trace/records', createBody, createKey),
      );
      assert.deepEqual(replay, created);
      const initialEvents = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM trace_events WHERE record_id = ${primary.id}
    `;
      assert.equal(initialEvents[0]!.count, 1);
      await rejectsCode(
        () =>
          repository.create(
            ctx(
              resident,
              '/internal/trace/records',
              { ...createBody, subject: 'Changed' },
              createKey,
            ),
          ),
        'idempotency_conflict',
      );

      const closedRepository = new TraceRepository(databaseUrl, {
        ...config,
        intakeOpen: false,
      });
      try {
        assert.deepEqual(
          await closedRepository.create(
            ctx(resident, '/internal/trace/records', createBody, createKey),
          ),
          created,
        );
        await rejectsCode(
          () =>
            closedRepository.create(
              ctx(
                resident,
                '/internal/trace/records',
                { ...createBody, subject: 'Changed while closed' },
                createKey,
              ),
            ),
          'idempotency_conflict',
        );
        await rejectsCode(
          () =>
            closedRepository.create(
              ctx(actor(RESIDENT, 'official'), '/internal/trace/records', createBody, createKey),
            ),
          'forbidden',
        );
        const closedKey = randomUUID();
        await rejectsCode(
          () =>
            closedRepository.create(
              ctx(resident, '/internal/trace/records', createBody, closedKey),
            ),
          'intake_closed',
        );
        const closedReservations = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM trace_command_idempotency
          WHERE actor_id = ${resident.id} AND idempotency_key = ${closedKey}
        `;
        assert.equal(closedReservations[0]!.count, 0);
      } finally {
        await closedRepository.close();
      }

      assert.equal(await repository.getPrivate(otherResident, primary.id), null);
      assert.ok(await repository.getPrivate(official, primary.id));
      assert.ok(await repository.getPrivate(reviewer, primary.id));
      assert.equal(await repository.getPublic(primary.id), null);

      await sql`UPDATE trace_records SET version = 99 WHERE id = ${primary.id}`;
      await rejectsCode(
        () => repository.getPrivate(resident, primary.id),
        'trace_integrity_failed',
      );
      await rejectsCode(() => repository.listPrivate(resident, 100), 'trace_integrity_failed');
      await sql`UPDATE trace_records SET version = 0 WHERE id = ${primary.id}`;

      const originalPayload = (
        await sql<{ payload: Record<string, unknown> }[]>`
          SELECT payload FROM trace_events WHERE record_id = ${primary.id} AND sequence = 1
        `
      )[0]!.payload;
      await sql.unsafe('ALTER TABLE trace_events DISABLE TRIGGER trace_events_reject_update');
      try {
        await sql`
          UPDATE trace_events SET payload = ${sql.json({ corrupted: true })}
          WHERE record_id = ${primary.id} AND sequence = 1
        `;
      } finally {
        await sql.unsafe('ALTER TABLE trace_events ENABLE TRIGGER trace_events_reject_update');
      }
      await rejectsCode(
        () => repository.getPrivate(resident, primary.id),
        'trace_integrity_failed',
      );
      await sql.unsafe('ALTER TABLE trace_events DISABLE TRIGGER trace_events_reject_update');
      try {
        await sql`
          UPDATE trace_events SET payload = ${sql.json(originalPayload as postgres.JSONValue)}
          WHERE record_id = ${primary.id} AND sequence = 1
        `;
      } finally {
        await sql.unsafe('ALTER TABLE trace_events ENABLE TRIGGER trace_events_reject_update');
      }
      assert.ok(await repository.getPrivate(resident, primary.id));

      await rejectsCode(
        () =>
          repository.assign(
            ctx(
              resident,
              `/internal/trace/records/${primary.id}/assign`,
              normalizeAssign({ expectedVersion: 0 }),
            ),
            primary.id,
          ),
        'forbidden',
      );
      const assigned = await repository.assign(
        ctx(
          official,
          `/internal/trace/records/${primary.id}/assign`,
          normalizeAssign({ expectedVersion: 0 }),
        ),
        primary.id,
      );
      primary = recordFrom(assigned.body);
      assert.equal(primary.status, 'assigned');
      assert.equal(primary.version, 1);
      await rejectsCode(
        () =>
          repository.assign(
            ctx(
              official,
              `/internal/trace/records/${primary.id}/assign`,
              normalizeAssign({ expectedVersion: 0 }),
            ),
            primary.id,
          ),
        'stale_version',
      );

      const commitment = await repository.commitment(
        ctx(
          official,
          `/internal/trace/records/${primary.id}/commitment`,
          normalizeCommitment({
            expectedVersion: 1,
            publicSummary: 'Reviewed-safe public lighting report',
            commitment: 'Inspect and replace the affected luminaire',
            dueDate: '2026-12-01',
          }),
        ),
        primary.id,
      );
      primary = recordFrom(commitment.body);
      assert.equal(primary.status, 'commitment-pending-review');
      assert.equal(primary.version, 2);

      await rejectsCode(
        () =>
          repository.review(
            ctx(
              actor(OFFICIAL, 'reviewer'),
              `/internal/trace/records/${primary.id}/review`,
              normalizeReview({ expectedVersion: 2, decision: 'accept', note: null }),
            ),
            primary.id,
          ),
        'self_review_forbidden',
      );
      await rejectsCode(
        () =>
          repository.review(
            ctx(
              official,
              `/internal/trace/records/${primary.id}/review`,
              normalizeReview({ expectedVersion: 2, decision: 'accept', note: null }),
            ),
            primary.id,
          ),
        'forbidden',
      );

      const returned = await repository.review(
        ctx(
          reviewer,
          `/internal/trace/records/${primary.id}/review`,
          normalizeReview({
            expectedVersion: 2,
            decision: 'return',
            note: 'Remove location detail.',
          }),
        ),
        primary.id,
      );
      primary = recordFrom(returned.body);
      assert.equal(primary.status, 'returned');
      assert.equal(primary.version, 3);
      assert.equal(await repository.getPublic(primary.id), null);
      await rejectsCode(
        () =>
          repository.assign(
            ctx(
              official,
              `/internal/trace/records/${primary.id}/assign`,
              normalizeAssign({ expectedVersion: 3 }),
            ),
            primary.id,
          ),
        'invalid_state',
      );

      const resubmitted = await repository.commitment(
        ctx(
          official,
          `/internal/trace/records/${primary.id}/commitment`,
          normalizeCommitment({
            expectedVersion: 3,
            publicSummary: 'A public-lighting issue was reviewed.',
            commitment: 'Inspect and replace the affected luminaire',
            dueDate: '2026-12-01',
          }),
        ),
        primary.id,
      );
      primary = recordFrom(resubmitted.body);
      assert.equal(primary.version, 4);

      const published = await repository.review(
        ctx(
          reviewer,
          `/internal/trace/records/${primary.id}/review`,
          normalizeReview({ expectedVersion: 4, decision: 'accept', note: 'Privacy reviewed.' }),
        ),
        primary.id,
      );
      primary = recordFrom(published.body);
      assert.equal(primary.status, 'published');
      assert.equal(primary.version, 5);
      const publicPublished = await repository.getPublic(primary.id);
      assert.ok(publicPublished);
      assert.equal(publicPublished.status, 'published');
      const createdEvent = primary.events.find((event) => event.action === 'record-created');
      const assignedEvent = primary.events.find((event) => event.action === 'record-assigned');
      const approvedFilingEvent = [...primary.events]
        .reverse()
        .find((event) => event.action === 'commitment-submitted');
      const approvalEvent = primary.events.find((event) => event.action === 'commitment-approved');
      assert.ok(createdEvent && assignedEvent && approvedFilingEvent && approvalEvent);
      assert.deepEqual(publicPublished.events, [
        {
          stage: 'voice',
          action: 'report-filed',
          actorRole: 'resident',
          createdAt: createdEvent.createdAt,
        },
        {
          stage: 'responsibility',
          action: 'office-assigned',
          actorRole: 'official',
          createdAt: assignedEvent.createdAt,
        },
        {
          stage: 'response',
          action: 'commitment-filed',
          actorRole: 'official',
          createdAt: approvedFilingEvent.createdAt,
        },
        {
          stage: 'check',
          action: 'commitment-accepted',
          actorRole: 'reviewer',
          createdAt: approvalEvent.createdAt,
        },
        {
          stage: 'receipt',
          action: 'published',
          actorRole: 'reviewer',
          createdAt: approvalEvent.createdAt,
        },
      ]);
      assert.equal(verifyReceiptHash(publicPublished), true);
      const publicJson = JSON.stringify(publicPublished);
      for (const privateValue of [
        'Private resident narrative',
        'Private location detail',
        'resident@example.test',
        RESIDENT,
        OFFICIAL,
        REVIEWER,
        'Remove location detail.',
        'record-created',
        'commitment-submitted',
        'commitment-returned',
        'commitment-approved',
        primary.events[0]!.hash,
      ]) {
        assert.equal(publicJson.includes(privateValue), false, privateValue);
      }
      await sql`
        UPDATE trace_public_snapshots SET receipt_hash = ${'0'.repeat(64)}
        WHERE record_id = ${primary.id}
      `;
      await rejectsCode(() => repository.getPublic(primary.id), 'trace_integrity_failed');
      await rejectsCode(() => repository.listPublic(100), 'trace_integrity_failed');
      await sql`
        UPDATE trace_public_snapshots SET receipt_hash = ${publicPublished.receiptHash}
        WHERE record_id = ${primary.id}
      `;
      assert.deepEqual(await repository.getPublic(primary.id), publicPublished);

      const resolution = await repository.resolution(
        ctx(
          official,
          `/internal/trace/records/${primary.id}/resolution`,
          normalizeResolution({
            expectedVersion: 5,
            evidenceNote: 'The luminaire was replaced.',
            evidenceUrls: ['https://example.test/evidence/one'],
          }),
        ),
        primary.id,
      );
      primary = recordFrom(resolution.body);
      assert.equal(primary.status, 'resolution-pending-review');
      assert.equal(primary.version, 6);
      assert.deepEqual(await repository.getPublic(primary.id), publicPublished);

      const resolutionReturned = await repository.resolutionReview(
        ctx(
          reviewer,
          `/internal/trace/records/${primary.id}/resolution-review`,
          normalizeReview({
            expectedVersion: 6,
            decision: 'return',
            note: 'Provide a clearer receipt.',
          }),
        ),
        primary.id,
      );
      primary = recordFrom(resolutionReturned.body);
      assert.equal(primary.status, 'published');
      assert.equal(primary.version, 7);
      assert.deepEqual(await repository.getPublic(primary.id), publicPublished);

      const resolutionResubmitted = await repository.resolution(
        ctx(
          official,
          `/internal/trace/records/${primary.id}/resolution`,
          normalizeResolution({
            expectedVersion: 7,
            evidenceNote: 'Replacement completed and checked.',
            evidenceUrls: ['https://example.test/evidence/two'],
          }),
        ),
        primary.id,
      );
      primary = recordFrom(resolutionResubmitted.body);
      assert.equal(primary.version, 8);

      const resolved = await repository.resolutionReview(
        ctx(
          reviewer,
          `/internal/trace/records/${primary.id}/resolution-review`,
          normalizeReview({ expectedVersion: 8, decision: 'accept', note: 'Evidence reviewed.' }),
        ),
        primary.id,
      );
      primary = recordFrom(resolved.body);
      assert.equal(primary.status, 'resolved');
      assert.equal(primary.version, 9);
      const publicResolved = await repository.getPublic(primary.id);
      assert.ok(publicResolved);
      assert.equal(publicResolved.status, 'resolved');
      assert.equal(publicResolved.evidenceNote, 'Replacement completed and checked.');
      assert.deepEqual(publicResolved.evidenceUrls, ['https://example.test/evidence/two']);
      const completionEvent = primary.events.find(
        (event) => event.action === 'resolution-approved',
      );
      assert.ok(completionEvent);
      assert.deepEqual(publicResolved.events, [
        ...publicPublished.events,
        {
          stage: 'receipt',
          action: 'completion-approved',
          actorRole: 'reviewer',
          createdAt: completionEvent.createdAt,
        },
      ]);
      const resolvedPublicJson = JSON.stringify(publicResolved);
      for (const privateAction of [
        'resolution-submitted',
        'resolution-returned',
        'resolution-approved',
      ]) {
        assert.equal(resolvedPublicJson.includes(privateAction), false, privateAction);
      }
      assert.equal(verifyReceiptHash(publicResolved), true);

      const attachmentKey = randomUUID();
      const attachmentBody = normalizeAttachment({
        expectedVersion: 9,
        filename: 'receipt.txt',
        contentType: 'text/plain',
        base64: Buffer.from('private attachment').toString('base64'),
      });
      const attached = await repository.addAttachment(
        ctx(
          resident,
          `/internal/trace/records/${primary.id}/attachments`,
          attachmentBody,
          attachmentKey,
        ),
        primary.id,
      );
      assert.equal(attached.status, 201);
      assert.equal(recordFrom(attached.body).version, 10);
      const afterAttachment = await repository.getPrivate(resident, primary.id);
      assert.ok(afterAttachment);
      assert.equal(afterAttachment.version, 10);
      assert.equal(afterAttachment.attachments.length, 1);
      assert.deepEqual(await repository.getPublic(primary.id), publicResolved);
      const attachmentId = afterAttachment.attachments[0]!.id;
      const downloaded = await repository.downloadAttachment(resident, primary.id, attachmentId);
      assert.ok(downloaded);
      assert.equal(Buffer.from(downloaded.bytes).toString(), 'private attachment');
      assert.equal(
        await repository.downloadAttachment(otherResident, primary.id, attachmentId),
        null,
      );
      assert.ok(await repository.downloadAttachment(reviewer, primary.id, attachmentId));
      await rejectsCode(
        () =>
          repository.addAttachment(
            ctx(reviewer, `/internal/trace/records/${primary.id}/attachments`, {
              ...attachmentBody,
              expectedVersion: 10,
            }),
            primary.id,
          ),
        'forbidden',
      );
      for (let index = 0; index < 19; index += 1) {
        await sql`
        INSERT INTO trace_attachments (
          id, record_id, filename, content_type, content, byte_count, sha256, created_by, created_at
        ) VALUES (
          ${randomUUID()}, ${primary.id}, ${`extra-${index}.txt`}, 'text/plain', ${Buffer.from('x')},
          1, ${'0'.repeat(64)}, ${OFFICIAL}, NOW()
        )
      `;
      }
      await rejectsCode(
        () =>
          repository.addAttachment(
            ctx(resident, `/internal/trace/records/${primary.id}/attachments`, {
              ...attachmentBody,
              expectedVersion: 10,
            }),
            primary.id,
          ),
        'attachment_limit_reached',
      );

      const rawEvents = await sql<
        {
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
          resulting_status: StoredEvent['resultingStatus'];
          created_at: Date;
        }[]
      >`SELECT * FROM trace_events WHERE record_id = ${primary.id} ORDER BY sequence`;
      const storedEvents: StoredEvent[] = rawEvents.map((row) => ({
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
        createdAt: row.created_at.toISOString(),
      }));
      assert.deepEqual(verifyEventChain(storedEvents, { version: 10, status: 'resolved' }), {
        valid: true,
      });
      await assert.rejects(
        () => sql`UPDATE trace_events SET action = action WHERE id = ${storedEvents[0]!.id}`,
      );
      await assert.rejects(() => sql`DELETE FROM trace_events WHERE id = ${storedEvents[0]!.id}`);

      for (const readKind of ['get', 'list'] as const) {
        const snapshotCreated = await repository.create(
          ctx(
            otherResident,
            '/internal/trace/records',
            normalizeCreate({
              subject: `Snapshot ${readKind}`,
              narrative: 'snapshot narrative',
              location: 'snapshot location',
            }),
          ),
        );
        const snapshotRecord = recordFrom(snapshotCreated.body);
        let selectedResolve!: () => void;
        let releaseResolve!: () => void;
        const selected = new Promise<void>((resolve) => {
          selectedResolve = resolve;
        });
        const release = new Promise<void>((resolve) => {
          releaseResolve = resolve;
        });
        const snapshotRepository: TraceRepository = new TraceRepository(databaseUrl, config, {
          afterPrivateRecordsSelected: async () => {
            selectedResolve();
            await release;
          },
        });
        try {
          const read: Promise<PrivateRecord | null> =
            readKind === 'get'
              ? snapshotRepository.getPrivate(otherResident, snapshotRecord.id)
              : snapshotRepository
                  .listPrivate(otherResident, 100)
                  .then(
                    (records) => records.find((record) => record.id === snapshotRecord.id) ?? null,
                  );
          await selected;
          await repository.assign(
            ctx(
              official,
              `/internal/trace/records/${snapshotRecord.id}/assign`,
              normalizeAssign({ expectedVersion: 0 }),
            ),
            snapshotRecord.id,
          );
          releaseResolve();
          const coherentSnapshot: PrivateRecord | null = await read;
          assert.ok(coherentSnapshot);
          assert.equal(coherentSnapshot.version, 0);
          assert.equal(coherentSnapshot.status, 'open');
          assert.equal(coherentSnapshot.events.length, 1);
          assert.equal(coherentSnapshot.events.at(-1)?.action, 'record-created');
          const latest = await repository.getPrivate(otherResident, snapshotRecord.id);
          assert.ok(latest);
          assert.equal(latest.version, 1);
          assert.equal(latest.status, 'assigned');
          assert.equal(latest.events.length, 2);
          assert.equal(latest.events.at(-1)?.action, 'record-assigned');
        } finally {
          releaseResolve();
          await snapshotRepository.close();
        }
      }

      const concurrentCreated = await repository.create(
        ctx(
          otherResident,
          '/internal/trace/records',
          normalizeCreate({ subject: 'Concurrent', narrative: 'n', location: 'l' }),
        ),
      );
      const concurrent = recordFrom(concurrentCreated.body);
      const attempts = await Promise.allSettled([
        repository.assign(
          ctx(
            official,
            `/internal/trace/records/${concurrent.id}/assign`,
            normalizeAssign({ expectedVersion: 0 }),
          ),
          concurrent.id,
        ),
        repository.assign(
          ctx(
            official,
            `/internal/trace/records/${concurrent.id}/assign`,
            normalizeAssign({ expectedVersion: 0 }),
          ),
          concurrent.id,
        ),
      ]);
      assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
      const rejected = attempts.find((attempt) => attempt.status === 'rejected');
      assert.ok(rejected && rejected.status === 'rejected');
      assert.ok(rejected.reason instanceof DomainError);
      assert.equal(rejected.reason.code, 'stale_version');
      assert.equal(await repository.getPublic(concurrent.id), null);

      const replayCreated = await repository.create(
        ctx(
          otherResident,
          '/internal/trace/records',
          normalizeCreate({ subject: 'Replay access', narrative: 'n', location: 'l' }),
        ),
      );
      const replayRecord = recordFrom(replayCreated.body);
      const assignKey = randomUUID();
      const assignBody = normalizeAssign({ expectedVersion: 0 });
      await repository.assign(
        ctx(official, `/internal/trace/records/${replayRecord.id}/assign`, assignBody, assignKey),
        replayRecord.id,
      );
      await rejectsCode(
        () =>
          repository.assign(
            ctx(
              actor(OFFICIAL, 'resident'),
              `/internal/trace/records/${replayRecord.id}/assign`,
              assignBody,
              assignKey,
            ),
            replayRecord.id,
          ),
        'record_not_found',
      );

      const rollbackCreated = await repository.create(
        ctx(
          otherResident,
          '/internal/trace/records',
          normalizeCreate({ subject: 'Rollback', narrative: 'n', location: 'l' }),
        ),
      );
      const rollbackRecord = recordFrom(rollbackCreated.body);
      const rollbackKey = randomUUID();
      await sql.unsafe(`
      CREATE OR REPLACE FUNCTION trace_test_reject_assign() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'record-assigned' THEN RAISE EXCEPTION 'forced trace test failure'; END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER trace_test_reject_assign_trigger
      BEFORE INSERT ON trace_events
      FOR EACH ROW EXECUTE FUNCTION trace_test_reject_assign();
    `);
      try {
        await assert.rejects(() =>
          repository.assign(
            ctx(
              official,
              `/internal/trace/records/${rollbackRecord.id}/assign`,
              normalizeAssign({ expectedVersion: 0 }),
              rollbackKey,
            ),
            rollbackRecord.id,
          ),
        );
      } finally {
        await sql.unsafe(`
        DROP TRIGGER IF EXISTS trace_test_reject_assign_trigger ON trace_events;
        DROP FUNCTION IF EXISTS trace_test_reject_assign();
      `);
      }
      const rolledBack = await repository.getPrivate(otherResident, rollbackRecord.id);
      assert.ok(rolledBack);
      assert.equal(rolledBack.status, 'open');
      assert.equal(rolledBack.version, 0);
      assert.equal(rolledBack.events.length, 1);
      const reservations = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM trace_command_idempotency WHERE idempotency_key = ${rollbackKey}
    `;
      assert.equal(reservations[0]!.count, 0);

      const migration = readMigrations()[0]!;
      await sql`UPDATE trace_schema_migrations SET sha256 = ${'0'.repeat(64)} WHERE version = ${migration.version}`;
      await assert.rejects(() => verifyTraceMigrations(databaseUrl), /hash mismatch/);
      await sql`UPDATE trace_schema_migrations SET sha256 = ${migration.hash} WHERE version = ${migration.version}`;
      await verifyTraceMigrations(databaseUrl);
    } finally {
      await sql.unsafe('DROP TRIGGER IF EXISTS trace_test_reject_assign_trigger ON trace_events');
      await sql.unsafe('DROP FUNCTION IF EXISTS trace_test_reject_assign()');
      const bundledMigration = readMigrations()[0];
      if (bundledMigration) {
        await sql`
        UPDATE trace_schema_migrations SET sha256 = ${bundledMigration.hash}
        WHERE version = ${bundledMigration.version}
      `;
      }
      await sql.unsafe(`
      TRUNCATE TABLE
        trace_command_idempotency,
        trace_attachments,
        trace_events,
        trace_public_snapshots,
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

test(
  'channel cases preserve reopen privacy, outbox delivery, AI review, closure, and publication',
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
      TRACE_REVIEWER_CITIZEN_IDS: REVIEWER,
      TRACE_GATEWAY_ACTOR_IDS: GATEWAY,
      TRACE_ATTENTION_PEPPER: ATTENTION_PEPPER,
      TRACE_AI_INTAKE_URL: '',
    });
    const repository = new TraceRepository(databaseUrl, config);
    const sql = postgres(databaseUrl, { prepare: false, onnotice: () => undefined });
    const gateway = actor(`gateway:${GATEWAY}`, 'gateway');
    const official = actor(OFFICIAL, 'official');
    const reviewer = actor(REVIEWER, 'reviewer');

    await sql.unsafe(`
      TRUNCATE TABLE
        trace_reopen_attempts,
        trace_case_counters,
        trace_command_idempotency,
        trace_attachments,
        trace_events,
        trace_public_snapshots,
        trace_record_participants,
        trace_report_private,
        trace_records
      CASCADE
    `);

    try {
      const firstInput = {
        channel: 'voice' as const,
        text: null,
        location: 'Privatna lokacija',
        source: 'transcript' as const,
        occurredAt: '2026-09-12T12:00:00.000Z',
      };
      const first = await repository.createChannelCase(
        ctx(gateway, '/internal/trace/channel/cases', firstInput),
        firstInput,
      );
      assert.match(first.case.caseNumber, /^VRS-[0-9]{1,8}$/);
      assert.equal(first.case.state, 'received');
      assert.equal(first.shell.state, 'received');
      assert.equal(verifyShellHash(first.shell), true);
      const storedFirst = (
        await sql<
          {
            owner_actor_id: string | null;
            filer_kind: string;
            reopen_key_hash: string;
            version: number;
          }[]
        >`
          SELECT owner_actor_id, filer_kind, reopen_key_hash, version
          FROM trace_records WHERE id = ${first.case.recordId}
        `
      )[0]!;
      assert.equal(storedFirst.owner_actor_id, null);
      assert.equal(storedFirst.filer_kind, 'anonymous-channel');
      assert.equal(storedFirst.reopen_key_hash.trim(), reopenKeyHash(first.case.reopenKey));

      const secondInput = {
        channel: 'sms' as const,
        text: 'Druga prijava za objavu',
        location: 'Druga privatna lokacija',
        source: 'typed' as const,
        occurredAt: '2026-09-12T12:01:00.000Z',
      };
      const second = await repository.createChannelCase(
        ctx(gateway, '/internal/trace/channel/cases', secondInput),
        secondInput,
      );
      const firstNumber = Number(first.case.caseNumber.split('-')[1]);
      const secondNumber = Number(second.case.caseNumber.split('-')[1]);
      assert.equal(secondNumber, firstNumber + 1);

      const transcriptInput = {
        channel: 'voice' as const,
        kind: 'transcript' as const,
        text: 'Transkript glasovne prijave',
        source: 'transcript' as const,
        occurredAt: '2026-09-12T12:02:00.000Z',
      };
      const appended = await repository.appendChannelMessage(
        ctx(
          gateway,
          `/internal/trace/channel/cases/${first.case.caseNumber}/messages`,
          { reopenKey: first.case.reopenKey, ...transcriptInput },
        ),
        first.case.caseNumber,
        transcriptInput,
      );
      assert.equal(appended.message.body, transcriptInput.text);
      const recordAfterAppend = (
        await sql<{ version: number; status: StoredEvent['resultingStatus'] }[]>`
          SELECT version, status FROM trace_records WHERE id = ${first.case.recordId}
        `
      )[0]!;
      assert.equal(recordAfterAppend.version, 1);
      const eventRows = await sql<
        {
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
          resulting_status: StoredEvent['resultingStatus'];
          created_at: Date;
        }[]
      >`SELECT * FROM trace_events WHERE record_id = ${first.case.recordId} ORDER BY sequence`;
      const storedEvents: StoredEvent[] = eventRows.map((row) => ({
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
        createdAt: row.created_at.toISOString(),
      }));
      assert.deepEqual(
        verifyEventChain(storedEvents, {
          version: recordAfterAppend.version,
          status: recordAfterAppend.status,
        }),
        { valid: true },
      );
      const messageEvent = storedEvents.find((event) => event.action === 'message-appended');
      assert.ok(messageEvent);
      assert.deepEqual(messageEvent.payload, {
        bodySha256: appended.message.bodySha256,
        kind: 'transcript',
      });
      assert.equal(JSON.stringify(messageEvent.payload).includes(transcriptInput.text), false);

      const officialInput = {
        kind: 'question' as const,
        body: 'Možete li dodati još detalja?',
        channel: 'voice' as const,
      };
      const officialMessage = await repository.postOfficialMessage(
        ctx(
          official,
          `/internal/trace/records/${first.case.recordId}/messages`,
          { expectedVersion: 1, ...officialInput },
        ),
        first.case.recordId,
        officialInput,
      );
      assert.equal(officialMessage.record.version, 2);
      const outbox = await repository.listOutbox(
        ctx(gateway, '/internal/trace/channel/outbox', {}),
        10,
      );
      const queued = outbox.messages.find(
        (message) => message.id === officialMessage.message.id,
      );
      assert.ok(queued);
      assert.equal(queued.authorActorId, null);
      assert.equal(JSON.stringify(queued).includes(OFFICIAL), false);
      const delivered = await repository.markOutboxDelivery(
        ctx(
          gateway,
          `/internal/trace/channel/outbox/${queued.id}/delivery`,
          { state: 'delivered' },
        ),
        queued.id,
        { state: 'delivered' },
      );
      assert.equal(delivered.message.deliveryState, 'delivered');
      assert.ok(delivered.message.deliveredAt);

      const reopened = await repository.readFilerCase(
        first.case.caseNumber,
        first.case.reopenKey,
      );
      assert.equal(reopened.case.narrative, transcriptInput.text);
      assert.equal(reopened.case.messages.length, 2);
      assert.ok(reopened.case.events.every((event) => !('note' in event)));
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await assert.rejects(
          () => repository.readFilerCase(first.case.caseNumber, 'x'.repeat(27)),
          (error: unknown) =>
            error instanceof DomainError &&
            error.status === 404 &&
            error.code === 'case_not_found',
        );
      }
      await assert.rejects(
        () => repository.readFilerCase(first.case.caseNumber, 'x'.repeat(27)),
        (error: unknown) =>
          error instanceof DomainError &&
          error.status === 429 &&
          error.code === 'too_many_attempts',
      );

      const proposalInput = {
        kind: 'location' as const,
        proposedValue: { locationText: 'AI predložena lokacija' },
        confidence: 0.9,
        modelId: 'ai-gateway/case-intake-v1',
        modelVersion: '0.1',
        promptSha256: 'a'.repeat(64),
      };
      const proposed = await repository.proposeAi(
        ctx(
          official,
          `/internal/trace/records/${first.case.recordId}/ai-proposals`,
          proposalInput,
        ),
        first.case.recordId,
        proposalInput,
      );
      const beforeDecision = (
        await sql<{ category: string; location: string }[]>`
          SELECT records.category, private.location
          FROM trace_records AS records
          JOIN trace_report_private AS private ON private.record_id = records.id
          WHERE records.id = ${first.case.recordId}
        `
      )[0]!;
      assert.equal(beforeDecision.category, 'public-lighting');
      assert.equal(beforeDecision.location, firstInput.location);
      const accepted = await repository.decideAi(
        ctx(
          official,
          `/internal/trace/records/${first.case.recordId}/ai-proposals/${proposed.proposal.id}/decision`,
          { expectedVersion: 2, decision: 'accepted' },
        ),
        first.case.recordId,
        proposed.proposal.id,
        { decision: 'accepted' },
      );
      assert.equal(accepted.proposal.status, 'accepted');
      assert.equal(accepted.record.version, 3);
      assert.equal(accepted.record.category, 'public-lighting');
      const acceptedLocation = (
        await sql<{ location: string }[]>`
          SELECT location FROM trace_report_private WHERE record_id = ${first.case.recordId}
        `
      )[0]!.location;
      assert.equal(acceptedLocation, 'AI predložena lokacija');
      assert.ok(
        accepted.record.events.some((event) => event.action === 'ai-proposal-accepted'),
      );
      await repository.proposeAi(
        ctx(
          official,
          `/internal/trace/records/${first.case.recordId}/ai-proposals`,
          { ...proposalInput, promptSha256: 'b'.repeat(64) },
        ),
        first.case.recordId,
        { ...proposalInput, promptSha256: 'b'.repeat(64) },
      );
      await assert.rejects(() =>
        repository.proposeAi(
          ctx(
            official,
            `/internal/trace/records/${first.case.recordId}/ai-proposals`,
            { ...proposalInput, promptSha256: 'c'.repeat(64) },
          ),
          first.case.recordId,
          { ...proposalInput, promptSha256: 'c'.repeat(64) },
        ),
      );

      const closed = await repository.closeCase(
        ctx(
          reviewer,
          `/internal/trace/records/${first.case.recordId}/close`,
          {
            expectedVersion: 3,
            reason: 'out-of-scope',
            publicReason: 'Prijava nije u nadležnosti.',
          },
        ),
        first.case.recordId,
        {
          reason: 'out-of-scope',
          publicReason: 'Prijava nije u nadležnosti.',
        },
      );
      assert.equal(closed.record.status, 'closed');
      assert.equal(closed.shell.state, 'closed');
      assert.equal(closed.shell.closedPublicReason, 'Prijava nije u nadležnosti.');
      assert.equal(verifyShellHash(closed.shell), true);
      const closedSnapshots = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM trace_public_snapshots WHERE record_id = ${first.case.recordId}
      `;
      assert.equal(closedSnapshots[0]!.count, 0);

      let publishRecord = (
        await repository.assign(
          ctx(
            official,
            `/internal/trace/records/${second.case.recordId}/assign`,
            { expectedVersion: 0 },
          ),
          second.case.recordId,
        )
      ).body;
      assert.ok(hasRecordBody(publishRecord));
      publishRecord = (
        await repository.commitment(
          ctx(
            official,
            `/internal/trace/records/${second.case.recordId}/commitment`,
            {
              expectedVersion: 1,
              publicSummary: 'Javna prijava rasvjete',
              commitment: 'Pregledati i popraviti rasvjetu',
              dueDate: '2026-12-01',
            },
          ),
          second.case.recordId,
        )
      ).body;
      assert.ok(hasRecordBody(publishRecord));
      publishRecord = (
        await repository.review(
          ctx(
            reviewer,
            `/internal/trace/records/${second.case.recordId}/review`,
            { expectedVersion: 2, decision: 'accept', note: null },
          ),
          second.case.recordId,
        )
      ).body;
      assert.ok(hasRecordBody(publishRecord));
      publishRecord = (
        await repository.resolution(
          ctx(
            official,
            `/internal/trace/records/${second.case.recordId}/resolution`,
            {
              expectedVersion: 3,
              evidenceNote: 'Rasvjeta je popravljena.',
              evidenceUrls: ['https://example.test/channel-proof'],
            },
          ),
          second.case.recordId,
        )
      ).body;
      assert.ok(hasRecordBody(publishRecord));
      publishRecord = (
        await repository.resolutionReview(
          ctx(
            reviewer,
            `/internal/trace/records/${second.case.recordId}/resolution-review`,
            { expectedVersion: 4, decision: 'accept', note: null },
          ),
          second.case.recordId,
        )
      ).body;
      assert.ok(hasRecordBody(publishRecord));
      const publicCase = await repository.getPublicCase(second.case.caseNumber);
      assert.ok(publicCase?.record);
      assert.equal(publicCase.record.status, 'resolved');
      assert.equal(verifyReceiptHash(publicCase.record), true);
      assert.deepEqual(publicCase.record.events[0], {
        stage: 'voice',
        action: 'report-filed',
        actorRole: 'resident',
        createdAt: publicCase.record.events[0]!.createdAt,
      });
      assert.equal(verifyShellHash(publicCase.case), true);
      assert.equal(publicCase.case.state, 'resolved');
    } finally {
      await sql.unsafe(`
        TRUNCATE TABLE
          trace_reopen_attempts,
          trace_case_counters,
          trace_command_idempotency,
          trace_attachments,
          trace_events,
          trace_public_snapshots,
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
