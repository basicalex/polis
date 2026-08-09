import { randomUUID } from 'node:crypto';
import { schema } from '@polis/db';
import type { ComplaintStatus } from '@polis/domain';
import { asc, desc, eq } from 'drizzle-orm';
import { result, type HttpResult } from '@polis/service-runtime';

import { canComplaintTransition } from './lifecycle.js';
import { complaintDetailWire } from './serialize.js';
import type { ComplaintRow, SafeAuditData, SelectDb, Transaction } from './types.js';

export async function lockComplaint(tx: Transaction, id: string): Promise<ComplaintRow | null> {
  const rows = await tx
    .select()
    .from(schema.complaintCases)
    .where(eq(schema.complaintCases.id, id))
    .limit(1)
    .for('update');
  return rows[0] ?? null;
}

export function statusConflict(expected: string, actual: string): HttpResult {
  return result(409, { error: 'invalid_complaint_state', expected, actual });
}

export async function appendEvent(
  tx: Transaction,
  input: {
    complaintId: string;
    eventType: string;
    actorId: string;
    fromStatus: ComplaintStatus | null;
    toStatus: ComplaintStatus;
    data?: SafeAuditData;
    auditCorrelationId: string | null;
  },
): Promise<void> {
  if (input.fromStatus !== null && !canComplaintTransition(input.fromStatus, input.toStatus)) {
    throw new Error(`invalid complaint transition: ${input.fromStatus} -> ${input.toStatus}`);
  }
  await tx.insert(schema.complaintCaseEvents).values({
    id: `complaint-event-${randomUUID()}`,
    complaintId: input.complaintId,
    eventType: input.eventType,
    actorId: input.actorId,
    actorType: 'user',
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    data: input.data ?? {},
    auditCorrelationId: input.auditCorrelationId,
  });
}

export async function listResidentComplaints(db: SelectDb, citizenId: string) {
  return db
    .select()
    .from(schema.complaintCases)
    .where(eq(schema.complaintCases.residentCitizenId, citizenId))
    .orderBy(desc(schema.complaintCases.createdAt));
}

export async function listComplaintQueue(db: SelectDb) {
  return db.select().from(schema.complaintCases).orderBy(asc(schema.complaintCases.createdAt));
}

export async function findComplaint(db: SelectDb, id: string): Promise<ComplaintRow | null> {
  const rows = await db
    .select()
    .from(schema.complaintCases)
    .where(eq(schema.complaintCases.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function loadDetail(db: SelectDb, complaint: ComplaintRow) {
  const [requestRows, decisionRows, appealRows, eventRows] = await Promise.all([
    db
      .select()
      .from(schema.complaintInformationRequests)
      .where(eq(schema.complaintInformationRequests.complaintId, complaint.id))
      .orderBy(asc(schema.complaintInformationRequests.createdAt)),
    db
      .select()
      .from(schema.complaintDecisions)
      .where(eq(schema.complaintDecisions.complaintId, complaint.id))
      .orderBy(asc(schema.complaintDecisions.decidedAt)),
    db
      .select()
      .from(schema.complaintAppeals)
      .where(eq(schema.complaintAppeals.complaintId, complaint.id))
      .limit(1),
    db
      .select()
      .from(schema.complaintCaseEvents)
      .where(eq(schema.complaintCaseEvents.complaintId, complaint.id))
      .orderBy(asc(schema.complaintCaseEvents.occurredAt), asc(schema.complaintCaseEvents.id)),
  ]);
  return complaintDetailWire(
    complaint,
    requestRows,
    decisionRows,
    appealRows[0] ?? null,
    eventRows,
  );
}
