import { randomUUID } from 'node:crypto';
import { schema, type DbClient } from '@polis/db';
import { and, eq, isNull } from 'drizzle-orm';
import { result, type HttpResult } from '@polis/service-runtime';

import { finishMutation } from './audit.js';
import {
  complaintReader,
  holderWithRight,
  INSTITUTION_ID,
  JURISDICTION_ID,
  staffWithRight,
} from './authorization.js';
import {
  appendEvent,
  findComplaint,
  listComplaintQueue,
  listResidentComplaints,
  loadDetail,
  lockComplaint,
  statusConflict,
} from './repository.js';
import {
  complaintAppealWire,
  complaintDecisionWire,
  complaintSummaryWire,
  informationRequestWire,
} from './serialize.js';
import type { Actor, MutationOutcome, SafeAuditData } from './types.js';

const PROCESS_ID = 'process-citizen-service-complaint';

export async function createComplaint(
  db: DbClient,
  actor: Actor,
  subject: string,
  narrative: string,
  requestCorrelationId: string | null,
): Promise<HttpResult> {
  const outcome = await db.transaction(async (tx): Promise<MutationOutcome<unknown>> => {
    const inserted = await tx
      .insert(schema.complaintCases)
      .values({
        id: `complaint-${randomUUID()}`,
        caseNumber: `CMP-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 12).toUpperCase()}`,
        residentCitizenId: actor.citizenId,
        institutionId: INSTITUTION_ID,
        processId: PROCESS_ID,
        jurisdictionId: JURISDICTION_ID,
        subject,
        narrative,
        auditCorrelationId: requestCorrelationId,
      })
      .returning();
    const complaint = inserted[0];
    await appendEvent(tx, {
      complaintId: complaint.id,
      eventType: 'submitted',
      actorId: actor.citizenId,
      fromStatus: null,
      toStatus: 'submitted',
      auditCorrelationId: requestCorrelationId,
    });
    return {
      status: 201,
      value: complaintSummaryWire(complaint),
      audit: {
        caseId: complaint.id,
        action: 'submitted',
        actor,
        actorRole: 'resident',
        fromStatus: null,
        toStatus: 'submitted',
        correlationId: requestCorrelationId,
      },
    };
  });
  return finishMutation(outcome);
}

export async function listMine(db: DbClient, actor: Actor) {
  const rows = await listResidentComplaints(db, actor.citizenId);
  return { items: rows.map(complaintSummaryWire) };
}

export async function listQueue(db: DbClient, actor: Actor) {
  if (!(await complaintReader(db, actor))) {
    return result(403, { error: 'complaint_staff_access_denied' });
  }
  const rows = await listComplaintQueue(db);
  return { items: rows.map(complaintSummaryWire) };
}

export async function getComplaintDetail(db: DbClient, actor: Actor, id: string) {
  const complaint = await findComplaint(db, id);
  if (!complaint) return result(404, { error: 'complaint_not_found' });
  if (complaint.residentCitizenId !== actor.citizenId && !(await complaintReader(db, actor))) {
    return result(403, { error: 'complaint_access_denied' });
  }
  return loadDetail(db, complaint);
}

export async function assignComplaint(
  db: DbClient,
  actor: Actor,
  id: string,
  targetId: string,
  requestCorrelationId: string | null,
): Promise<HttpResult> {
  const outcome = await db.transaction(async (tx): Promise<MutationOutcome<unknown>> => {
    const intake = await staffWithRight(tx, actor, 'route_case_to_sector_office');
    if (!intake) return result(403, { error: 'assignment_not_authorized' });
    const target = await holderWithRight(tx, targetId, 'decide_complaint');
    if (!target) return result(400, { error: 'invalid_assignment_target' });
    const complaint = await lockComplaint(tx, id);
    if (!complaint) return result(404, { error: 'complaint_not_found' });
    if (complaint.status !== 'submitted') return statusConflict('submitted', complaint.status);
    const now = new Date();
    const updated = await tx
      .update(schema.complaintCases)
      .set({ status: 'assigned', assignedMandateHolderId: target.id, updatedAt: now })
      .where(eq(schema.complaintCases.id, complaint.id))
      .returning();
    const eventData = { assignedMandateHolderId: target.id };
    const auditCorrelationId = requestCorrelationId ?? complaint.auditCorrelationId;
    await appendEvent(tx, {
      complaintId: complaint.id,
      eventType: 'assigned',
      actorId: actor.citizenId,
      fromStatus: 'submitted',
      toStatus: 'assigned',
      data: eventData,
      auditCorrelationId,
    });
    return {
      status: 200,
      value: complaintSummaryWire(updated[0]),
      audit: {
        caseId: complaint.id,
        action: 'assigned',
        actor,
        actorRole: 'staff',
        fromStatus: 'submitted',
        toStatus: 'assigned',
        correlationId: auditCorrelationId,
        data: eventData,
      },
    };
  });
  return finishMutation(outcome);
}

export async function requestInformation(
  db: DbClient,
  actor: Actor,
  id: string,
  question: string,
  dueAt: Date | null,
  requestCorrelationId: string | null,
): Promise<HttpResult> {
  const outcome = await db.transaction(async (tx): Promise<MutationOutcome<unknown>> => {
    const staff = await staffWithRight(tx, actor, 'request_missing_identity_or_residence_evidence');
    if (!staff) return result(403, { error: 'information_request_not_authorized' });
    const complaint = await lockComplaint(tx, id);
    if (!complaint) return result(404, { error: 'complaint_not_found' });
    if (complaint.status !== 'assigned') return statusConflict('assigned', complaint.status);
    const active = await tx
      .select({ id: schema.complaintInformationRequests.id })
      .from(schema.complaintInformationRequests)
      .where(
        and(
          eq(schema.complaintInformationRequests.complaintId, complaint.id),
          isNull(schema.complaintInformationRequests.respondedAt),
        ),
      )
      .limit(1);
    if (active[0]) return result(409, { error: 'information_request_already_pending' });
    const inserted = await tx
      .insert(schema.complaintInformationRequests)
      .values({
        id: `complaint-information-request-${randomUUID()}`,
        complaintId: complaint.id,
        requestedBy: staff.id,
        question,
        dueAt,
      })
      .returning();
    const now = new Date();
    await tx
      .update(schema.complaintCases)
      .set({ status: 'awaiting_information', updatedAt: now })
      .where(eq(schema.complaintCases.id, complaint.id));
    const eventData: SafeAuditData = {
      informationRequestId: inserted[0].id,
      ...(dueAt ? { dueAt: dueAt.toISOString() } : {}),
    };
    const auditCorrelationId = requestCorrelationId ?? complaint.auditCorrelationId;
    await appendEvent(tx, {
      complaintId: complaint.id,
      eventType: 'information_requested',
      actorId: actor.citizenId,
      fromStatus: 'assigned',
      toStatus: 'awaiting_information',
      data: eventData,
      auditCorrelationId,
    });
    return {
      status: 201,
      value: informationRequestWire(inserted[0]),
      audit: {
        caseId: complaint.id,
        action: 'information_requested',
        actor,
        actorRole: 'staff',
        fromStatus: 'assigned',
        toStatus: 'awaiting_information',
        correlationId: auditCorrelationId,
        data: eventData,
      },
    };
  });
  return finishMutation(outcome);
}

export async function respondToInformationRequest(
  db: DbClient,
  actor: Actor,
  id: string,
  requestId: string,
  response: string,
  requestCorrelationId: string | null,
): Promise<HttpResult> {
  const outcome = await db.transaction(async (tx): Promise<MutationOutcome<unknown>> => {
    const complaint = await lockComplaint(tx, id);
    if (!complaint) return result(404, { error: 'complaint_not_found' });
    if (complaint.residentCitizenId !== actor.citizenId) {
      return result(403, { error: 'complaint_owner_required' });
    }
    if (complaint.status !== 'awaiting_information') {
      return statusConflict('awaiting_information', complaint.status);
    }
    const rows = await tx
      .select()
      .from(schema.complaintInformationRequests)
      .where(
        and(
          eq(schema.complaintInformationRequests.id, requestId),
          eq(schema.complaintInformationRequests.complaintId, complaint.id),
          isNull(schema.complaintInformationRequests.respondedAt),
        ),
      )
      .limit(1);
    if (!rows[0]) return result(404, { error: 'pending_information_request_not_found' });
    const now = new Date();
    const updatedRequest = await tx
      .update(schema.complaintInformationRequests)
      .set({ respondedBy: actor.citizenId, response, respondedAt: now })
      .where(eq(schema.complaintInformationRequests.id, rows[0].id))
      .returning();
    await tx
      .update(schema.complaintCases)
      .set({ status: 'assigned', updatedAt: now })
      .where(eq(schema.complaintCases.id, complaint.id));
    const eventData = { informationRequestId: rows[0].id };
    const auditCorrelationId = requestCorrelationId ?? complaint.auditCorrelationId;
    await appendEvent(tx, {
      complaintId: complaint.id,
      eventType: 'information_received',
      actorId: actor.citizenId,
      fromStatus: 'awaiting_information',
      toStatus: 'assigned',
      data: eventData,
      auditCorrelationId,
    });
    return {
      status: 200,
      value: informationRequestWire(updatedRequest[0]),
      audit: {
        caseId: complaint.id,
        action: 'information_received',
        actor,
        actorRole: 'resident',
        fromStatus: 'awaiting_information',
        toStatus: 'assigned',
        correlationId: auditCorrelationId,
        data: eventData,
      },
    };
  });
  return finishMutation(outcome);
}

export async function decideComplaint(
  db: DbClient,
  actor: Actor,
  id: string,
  decisionOutcome: string,
  reason: string,
  requestCorrelationId: string | null,
): Promise<HttpResult> {
  const outcome = await db.transaction(async (tx): Promise<MutationOutcome<unknown>> => {
    const staff = await staffWithRight(tx, actor, 'decide_complaint');
    if (!staff) return result(403, { error: 'decision_not_authorized' });
    const complaint = await lockComplaint(tx, id);
    if (!complaint) return result(404, { error: 'complaint_not_found' });
    if (complaint.status !== 'assigned') return statusConflict('assigned', complaint.status);
    if (complaint.assignedMandateHolderId !== staff.id) {
      return result(403, { error: 'assigned_decision_officer_required' });
    }
    const [pending, existing] = await Promise.all([
      tx
        .select({ id: schema.complaintInformationRequests.id })
        .from(schema.complaintInformationRequests)
        .where(
          and(
            eq(schema.complaintInformationRequests.complaintId, complaint.id),
            isNull(schema.complaintInformationRequests.respondedAt),
          ),
        )
        .limit(1),
      tx
        .select({ id: schema.complaintDecisions.id })
        .from(schema.complaintDecisions)
        .where(
          and(
            eq(schema.complaintDecisions.complaintId, complaint.id),
            eq(schema.complaintDecisions.kind, 'initial'),
          ),
        )
        .limit(1),
    ]);
    if (pending[0]) return result(409, { error: 'information_request_pending' });
    if (existing[0]) return result(409, { error: 'initial_decision_already_exists' });
    const auditCorrelationId = requestCorrelationId ?? complaint.auditCorrelationId;
    const inserted = await tx
      .insert(schema.complaintDecisions)
      .values({
        id: `complaint-decision-${randomUUID()}`,
        complaintId: complaint.id,
        kind: 'initial',
        outcome: decisionOutcome,
        reason,
        decidedBy: staff.id,
        auditCorrelationId,
      })
      .returning();
    const now = new Date();
    await tx
      .update(schema.complaintCases)
      .set({ status: 'decided', updatedAt: now })
      .where(eq(schema.complaintCases.id, complaint.id));
    const eventData = { decisionId: inserted[0].id, outcome: decisionOutcome };
    await appendEvent(tx, {
      complaintId: complaint.id,
      eventType: 'decided',
      actorId: actor.citizenId,
      fromStatus: 'assigned',
      toStatus: 'decided',
      data: eventData,
      auditCorrelationId,
    });
    return {
      status: 201,
      value: complaintDecisionWire(inserted[0]),
      audit: {
        caseId: complaint.id,
        action: 'decided',
        actor,
        actorRole: 'staff',
        fromStatus: 'assigned',
        toStatus: 'decided',
        correlationId: auditCorrelationId,
        data: eventData,
      },
    };
  });
  return finishMutation(outcome);
}

export async function appealComplaint(
  db: DbClient,
  actor: Actor,
  id: string,
  grounds: string,
  requestCorrelationId: string | null,
): Promise<HttpResult> {
  const outcome = await db.transaction(async (tx): Promise<MutationOutcome<unknown>> => {
    const complaint = await lockComplaint(tx, id);
    if (!complaint) return result(404, { error: 'complaint_not_found' });
    if (complaint.residentCitizenId !== actor.citizenId) {
      return result(403, { error: 'complaint_owner_required' });
    }
    if (complaint.status !== 'decided') return statusConflict('decided', complaint.status);
    const [decisions, appeals] = await Promise.all([
      tx
        .select()
        .from(schema.complaintDecisions)
        .where(
          and(
            eq(schema.complaintDecisions.complaintId, complaint.id),
            eq(schema.complaintDecisions.kind, 'initial'),
          ),
        )
        .limit(1),
      tx
        .select({ id: schema.complaintAppeals.id })
        .from(schema.complaintAppeals)
        .where(eq(schema.complaintAppeals.complaintId, complaint.id))
        .limit(1),
    ]);
    if (!decisions[0]) return result(409, { error: 'initial_decision_required' });
    if (appeals[0]) return result(409, { error: 'appeal_already_exists' });
    const inserted = await tx
      .insert(schema.complaintAppeals)
      .values({
        id: `complaint-appeal-${randomUUID()}`,
        complaintId: complaint.id,
        residentCitizenId: actor.citizenId,
        initialDecisionId: decisions[0].id,
        grounds,
      })
      .returning();
    const now = new Date();
    await tx
      .update(schema.complaintCases)
      .set({ status: 'appealed', updatedAt: now })
      .where(eq(schema.complaintCases.id, complaint.id));
    const eventData = { appealId: inserted[0].id, decisionId: decisions[0].id };
    const auditCorrelationId = requestCorrelationId ?? complaint.auditCorrelationId;
    await appendEvent(tx, {
      complaintId: complaint.id,
      eventType: 'appealed',
      actorId: actor.citizenId,
      fromStatus: 'decided',
      toStatus: 'appealed',
      data: eventData,
      auditCorrelationId,
    });
    return {
      status: 201,
      value: complaintAppealWire(inserted[0]),
      audit: {
        caseId: complaint.id,
        action: 'appealed',
        actor,
        actorRole: 'resident',
        fromStatus: 'decided',
        toStatus: 'appealed',
        correlationId: auditCorrelationId,
        data: eventData,
      },
    };
  });
  return finishMutation(outcome);
}

export async function decideAppeal(
  db: DbClient,
  actor: Actor,
  id: string,
  appealId: string,
  decisionOutcome: string,
  reason: string,
  requestCorrelationId: string | null,
): Promise<HttpResult> {
  const outcome = await db.transaction(async (tx): Promise<MutationOutcome<unknown>> => {
    const staff = await staffWithRight(tx, actor, 'decide_complaint_appeal');
    if (!staff) return result(403, { error: 'appeal_decision_not_authorized' });
    const complaint = await lockComplaint(tx, id);
    if (!complaint) return result(404, { error: 'complaint_not_found' });
    if (complaint.status !== 'appealed') return statusConflict('appealed', complaint.status);
    const [appeals, initialDecisions, appealDecisions] = await Promise.all([
      tx
        .select()
        .from(schema.complaintAppeals)
        .where(
          and(
            eq(schema.complaintAppeals.id, appealId),
            eq(schema.complaintAppeals.complaintId, complaint.id),
          ),
        )
        .limit(1),
      tx
        .select()
        .from(schema.complaintDecisions)
        .where(
          and(
            eq(schema.complaintDecisions.complaintId, complaint.id),
            eq(schema.complaintDecisions.kind, 'initial'),
          ),
        )
        .limit(1),
      tx
        .select({ id: schema.complaintDecisions.id })
        .from(schema.complaintDecisions)
        .where(
          and(
            eq(schema.complaintDecisions.complaintId, complaint.id),
            eq(schema.complaintDecisions.kind, 'appeal'),
          ),
        )
        .limit(1),
    ]);
    const appeal = appeals[0];
    const initialDecision = initialDecisions[0];
    if (!appeal || appeal.status !== 'filed') {
      return result(404, { error: 'filed_appeal_not_found' });
    }
    if (!initialDecision) return result(409, { error: 'initial_decision_required' });
    if (appealDecisions[0]) return result(409, { error: 'appeal_decision_already_exists' });
    const initialHolderRows = await tx
      .select({ citizenId: schema.mandateHolders.citizenId })
      .from(schema.mandateHolders)
      .where(eq(schema.mandateHolders.id, initialDecision.decidedBy))
      .limit(1);
    if (
      staff.id === initialDecision.decidedBy ||
      initialHolderRows[0]?.citizenId === staff.citizenId
    ) {
      return result(403, { error: 'separation_of_duty_required' });
    }
    const now = new Date();
    const auditCorrelationId = requestCorrelationId ?? complaint.auditCorrelationId;
    const inserted = await tx
      .insert(schema.complaintDecisions)
      .values({
        id: `complaint-decision-${randomUUID()}`,
        complaintId: complaint.id,
        appealId: appeal.id,
        kind: 'appeal',
        outcome: decisionOutcome,
        reason,
        decidedBy: staff.id,
        auditCorrelationId,
        decidedAt: now,
      })
      .returning();
    await tx
      .update(schema.complaintAppeals)
      .set({ status: 'decided', decidedAt: now })
      .where(eq(schema.complaintAppeals.id, appeal.id));
    await tx
      .update(schema.complaintCases)
      .set({ status: 'closed', updatedAt: now, closedAt: now })
      .where(eq(schema.complaintCases.id, complaint.id));
    const eventData = {
      appealId: appeal.id,
      decisionId: inserted[0].id,
      outcome: decisionOutcome,
    };
    await appendEvent(tx, {
      complaintId: complaint.id,
      eventType: 'appeal_decided',
      actorId: actor.citizenId,
      fromStatus: 'appealed',
      toStatus: 'closed',
      data: eventData,
      auditCorrelationId,
    });
    return {
      status: 201,
      value: complaintDecisionWire(inserted[0]),
      audit: {
        caseId: complaint.id,
        action: 'appeal_decided',
        actor,
        actorRole: 'staff',
        fromStatus: 'appealed',
        toStatus: 'closed',
        correlationId: auditCorrelationId,
        data: eventData,
      },
    };
  });
  return finishMutation(outcome);
}

export async function closeComplaint(
  db: DbClient,
  actor: Actor,
  id: string,
  requestCorrelationId: string | null,
): Promise<HttpResult> {
  const outcome = await db.transaction(async (tx): Promise<MutationOutcome<unknown>> => {
    const staff = await staffWithRight(tx, actor, 'decide_complaint');
    if (!staff) return result(403, { error: 'close_not_authorized' });
    const complaint = await lockComplaint(tx, id);
    if (!complaint) return result(404, { error: 'complaint_not_found' });
    if (complaint.status !== 'decided') return statusConflict('decided', complaint.status);
    if (complaint.assignedMandateHolderId !== staff.id) {
      return result(403, { error: 'assigned_decision_officer_required' });
    }
    const [decisions, appeals] = await Promise.all([
      tx
        .select({ id: schema.complaintDecisions.id })
        .from(schema.complaintDecisions)
        .where(
          and(
            eq(schema.complaintDecisions.complaintId, complaint.id),
            eq(schema.complaintDecisions.kind, 'initial'),
          ),
        )
        .limit(1),
      tx
        .select({ id: schema.complaintAppeals.id })
        .from(schema.complaintAppeals)
        .where(eq(schema.complaintAppeals.complaintId, complaint.id))
        .limit(1),
    ]);
    if (!decisions[0]) return result(409, { error: 'initial_decision_required' });
    if (appeals[0]) return result(409, { error: 'appeal_already_exists' });
    const now = new Date();
    const updated = await tx
      .update(schema.complaintCases)
      .set({ status: 'closed', updatedAt: now, closedAt: now })
      .where(eq(schema.complaintCases.id, complaint.id))
      .returning();
    const auditCorrelationId = requestCorrelationId ?? complaint.auditCorrelationId;
    await appendEvent(tx, {
      complaintId: complaint.id,
      eventType: 'closed',
      actorId: actor.citizenId,
      fromStatus: 'decided',
      toStatus: 'closed',
      auditCorrelationId,
    });
    return {
      status: 200,
      value: complaintSummaryWire(updated[0]),
      audit: {
        caseId: complaint.id,
        action: 'closed',
        actor,
        actorRole: 'staff',
        fromStatus: 'decided',
        toStatus: 'closed',
        correlationId: auditCorrelationId,
      },
    };
  });
  return finishMutation(outcome);
}
