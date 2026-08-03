import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { checkDatabase, getClient, schema, type DbClient } from '@polis/db';
import type { ComplaintStatus } from '@polis/domain';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import {
  fetchWithTimeout,
  internalHeaders,
  operationalRoutes,
  result,
  startService,
  type HttpResult,
  type Route,
} from '@polis/service-runtime';

import {
  complaintAppealWire,
  complaintDecisionWire,
  complaintDetailWire,
  complaintSummaryWire,
  informationRequestWire,
} from './serialize.js';

const JURISDICTION_ID = 'jur-croatia-local';
const INSTITUTION_ID = 'inst-complaints-office';
const PROCESS_ID = 'process-citizen-service-complaint';
const AUDIT_TIMEOUT_MS = 5_000;
const COMPLAINT_READER_RIGHTS = [
  'decide_complaint',
  'decide_complaint_appeal',
  'route_case_to_sector_office',
  'request_missing_identity_or_residence_evidence',
] as const;

/** Bounded database readiness without exposing database failure details. */
export async function databaseReadiness(
  check: () => Promise<unknown> = checkDatabase,
): Promise<{ ready: true } | { ready: false; dependency: 'database' }> {
  try {
    await check();
    return { ready: true };
  } catch {
    return { ready: false, dependency: 'database' };
  }
}

const TRANSITIONS: Readonly<Record<ComplaintStatus, readonly ComplaintStatus[]>> = {
  submitted: ['assigned'],
  assigned: ['awaiting_information', 'decided'],
  awaiting_information: ['assigned'],
  decided: ['appealed', 'closed'],
  appealed: ['closed'],
  closed: [],
};

export function canComplaintTransition(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

type Actor = { citizenId: string; identityLevel: string };
type ComplaintRow = typeof schema.complaintCases.$inferSelect;
type StaffBinding = {
  id: string;
  citizenId: string;
  roleId: string | null;
  jurisdictionId: string | null;
  rights: string[];
};
type SelectDb = Pick<DbClient, 'select'>;
type Transaction = Parameters<Parameters<DbClient['transaction']>[0]>[0];

type SafeAuditData = {
  assignedMandateHolderId?: string;
  informationRequestId?: string;
  dueAt?: string;
  decisionId?: string;
  outcome?: string;
  appealId?: string;
};

type AuditSpec = {
  caseId: string;
  action: string;
  actor: Actor;
  actorRole: 'resident' | 'staff';
  fromStatus: ComplaintStatus | null;
  toStatus: ComplaintStatus;
  correlationId: string | null;
  data?: SafeAuditData;
};

type MutationSuccess<T> = {
  status: number;
  value: T;
  audit: AuditSpec;
};

type MutationOutcome<T> = HttpResult | MutationSuccess<T>;

function resolveActor(req: IncomingMessage): Actor | null {
  const citizen = req.headers['x-polis-citizen'];
  const identity = req.headers['x-polis-identity-level'];
  if (typeof citizen !== 'string' || !citizen.trim()) return null;
  if (typeof identity !== 'string' || !identity.trim()) return null;
  return { citizenId: citizen.trim(), identityLevel: identity.trim() };
}

function requireActor(req: IncomingMessage): Actor | HttpResult {
  return resolveActor(req) ?? result(401, { error: 'unauthenticated' });
}

function isActor(value: Actor | HttpResult): value is Actor {
  return 'citizenId' in value;
}

function isMutationSuccess<T>(value: MutationOutcome<T>): value is MutationSuccess<T> {
  return typeof value === 'object' && value !== null && 'audit' in value;
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= maximum ? text : null;
}

function bodyField(body: unknown, key: string): unknown {
  if (!body || typeof body !== 'object' || !(key in body)) return undefined;
  return Reflect.get(body, key);
}

function safeOutcome(value: unknown): string | null {
  const outcome = boundedText(value, 64);
  return outcome && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(outcome) ? outcome : null;
}

function optionalDueAt(value: unknown): Date | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function correlationId(req: IncomingMessage): string | null {
  const value = req.headers['x-correlation-id'];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : null;
}

function rights(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function bindingIsActive(row: { status: string; startsAt: Date; endsAt: Date | null }): boolean {
  const now = Date.now();
  return (
    row.status === 'active' &&
    row.startsAt.getTime() <= now &&
    (!row.endsAt || row.endsAt.getTime() > now)
  );
}

async function staffBindings(db: SelectDb, actor: Actor): Promise<StaffBinding[]> {
  if (actor.identityLevel !== 'staff') return [];
  const rows = await db
    .select({
      id: schema.mandateHolders.id,
      citizenId: schema.mandateHolders.citizenId,
      roleId: schema.mandateHolders.roleId,
      jurisdictionId: schema.mandateHolders.jurisdictionId,
      status: schema.mandateHolders.status,
      startsAt: schema.mandateHolders.startsAt,
      endsAt: schema.mandateHolders.endsAt,
      institutionId: schema.roles.institutionId,
      decisionRights: schema.roles.decisionRights,
    })
    .from(schema.mandateHolders)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.mandateHolders.roleId))
    .where(eq(schema.mandateHolders.citizenId, actor.citizenId));
  return rows
    .filter(
      (row) =>
        bindingIsActive(row) &&
        row.jurisdictionId === JURISDICTION_ID &&
        row.institutionId === INSTITUTION_ID,
    )
    .map((row) => ({
      id: row.id,
      citizenId: row.citizenId,
      roleId: row.roleId,
      jurisdictionId: row.jurisdictionId,
      rights: rights(row.decisionRights),
    }));
}

async function staffWithRight(
  db: SelectDb,
  actor: Actor,
  requiredRight: string,
): Promise<StaffBinding | null> {
  const bindings = await staffBindings(db, actor);
  return bindings.find((binding) => binding.rights.includes(requiredRight)) ?? null;
}

async function complaintReader(db: SelectDb, actor: Actor): Promise<StaffBinding | null> {
  const bindings = await staffBindings(db, actor);
  return (
    bindings.find((binding) =>
      COMPLAINT_READER_RIGHTS.some((right) => binding.rights.includes(right)),
    ) ?? null
  );
}

async function holderWithRight(
  db: SelectDb,
  holderId: string,
  requiredRight: string,
): Promise<StaffBinding | null> {
  const rows = await db
    .select({
      id: schema.mandateHolders.id,
      citizenId: schema.mandateHolders.citizenId,
      roleId: schema.mandateHolders.roleId,
      jurisdictionId: schema.mandateHolders.jurisdictionId,
      status: schema.mandateHolders.status,
      startsAt: schema.mandateHolders.startsAt,
      endsAt: schema.mandateHolders.endsAt,
      institutionId: schema.roles.institutionId,
      decisionRights: schema.roles.decisionRights,
    })
    .from(schema.mandateHolders)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.mandateHolders.roleId))
    .where(eq(schema.mandateHolders.id, holderId))
    .limit(1);
  const row = rows[0];
  if (
    !row ||
    !bindingIsActive(row) ||
    row.jurisdictionId !== JURISDICTION_ID ||
    row.institutionId !== INSTITUTION_ID ||
    !rights(row.decisionRights).includes(requiredRight)
  ) {
    return null;
  }
  return {
    id: row.id,
    citizenId: row.citizenId,
    roleId: row.roleId,
    jurisdictionId: row.jurisdictionId,
    rights: rights(row.decisionRights),
  };
}

async function lockComplaint(tx: Transaction, id: string): Promise<ComplaintRow | null> {
  const rows = await tx
    .select()
    .from(schema.complaintCases)
    .where(eq(schema.complaintCases.id, id))
    .limit(1)
    .for('update');
  return rows[0] ?? null;
}

function statusConflict(expected: string, actual: string): HttpResult {
  return result(409, { error: 'invalid_complaint_state', expected, actual });
}

async function appendEvent(
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

async function emitAudit(spec: AuditSpec): Promise<void> {
  const base = process.env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600';
  try {
    await fetchWithTimeout(
      base + '/internal/audit/events',
      {
        method: 'POST',
        headers: internalHeaders(),
        body: JSON.stringify({
          eventType: `complaint.${spec.action}`,
          action: spec.action,
          visibility: 'restricted',
          actor: { type: 'user', id: spec.actor.citizenId },
          target: { type: 'complaint_case', id: spec.caseId },
          correlationId: spec.correlationId,
          data: {
            actorRole: spec.actorRole,
            fromStatus: spec.fromStatus,
            toStatus: spec.toStatus,
            ...(spec.data ?? {}),
          },
        }),
      },
      AUDIT_TIMEOUT_MS,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        service: 'complaints-service',
        stage: 'audit-emit',
        warning: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
}

async function finishMutation<T>(outcome: MutationOutcome<T>): Promise<HttpResult> {
  if (!isMutationSuccess(outcome)) return outcome;
  await emitAudit(outcome.audit);
  return result(outcome.status, outcome.value);
}

async function loadDetail(db: SelectDb, complaint: ComplaintRow) {
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

export function complaintRoutes(db: DbClient): Route[] {
  return [
    ...operationalRoutes('complaints-service'),
    {
      method: 'POST',
      path: '/internal/complaints',
      handler: async (req, body) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        if (!['verified_resident', 'verified_official'].includes(actor.identityLevel)) {
          return result(403, { error: 'resident_identity_required' });
        }
        const subject = boundedText(bodyField(body, 'subject'), 200);
        const narrative = boundedText(bodyField(body, 'narrative'), 10_000);
        if (!subject || !narrative) return result(400, { error: 'invalid_complaint' });
        const requestCorrelationId = correlationId(req);
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
      },
    },
    {
      method: 'GET',
      path: '/internal/complaints/mine',
      handler: async (req) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        const rows = await db
          .select()
          .from(schema.complaintCases)
          .where(eq(schema.complaintCases.residentCitizenId, actor.citizenId))
          .orderBy(desc(schema.complaintCases.createdAt));
        return { items: rows.map(complaintSummaryWire) };
      },
    },
    {
      method: 'GET',
      path: '/internal/complaints/queue',
      handler: async (req) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        if (!(await complaintReader(db, actor))) {
          return result(403, { error: 'complaint_staff_access_denied' });
        }
        const rows = await db
          .select()
          .from(schema.complaintCases)
          .orderBy(asc(schema.complaintCases.createdAt));
        return { items: rows.map(complaintSummaryWire) };
      },
    },
    {
      method: 'GET',
      path: '/internal/complaints/:id',
      handler: async (req, _body, params) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        const rows = await db
          .select()
          .from(schema.complaintCases)
          .where(eq(schema.complaintCases.id, params.id))
          .limit(1);
        const complaint = rows[0];
        if (!complaint) return result(404, { error: 'complaint_not_found' });
        if (
          complaint.residentCitizenId !== actor.citizenId &&
          !(await complaintReader(db, actor))
        ) {
          return result(403, { error: 'complaint_access_denied' });
        }
        return loadDetail(db, complaint);
      },
    },
    {
      method: 'POST',
      path: '/internal/complaints/:id/assign',
      handler: async (req, body, params) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        const targetId = boundedText(bodyField(body, 'assignedMandateHolderId'), 200);
        if (!targetId) return result(400, { error: 'assigned_mandate_holder_required' });
        const requestCorrelationId = correlationId(req);
        const outcome = await db.transaction(async (tx): Promise<MutationOutcome<unknown>> => {
          const intake = await staffWithRight(tx, actor, 'route_case_to_sector_office');
          if (!intake) return result(403, { error: 'assignment_not_authorized' });
          const target = await holderWithRight(tx, targetId, 'decide_complaint');
          if (!target) return result(400, { error: 'invalid_assignment_target' });
          const complaint = await lockComplaint(tx, params.id);
          if (!complaint) return result(404, { error: 'complaint_not_found' });
          if (complaint.status !== 'submitted')
            return statusConflict('submitted', complaint.status);
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
      },
    },
    {
      method: 'POST',
      path: '/internal/complaints/:id/information-requests',
      handler: async (req, body, params) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        const question = boundedText(bodyField(body, 'question'), 10_000);
        const dueAt = optionalDueAt(bodyField(body, 'dueAt'));
        if (!question || dueAt === undefined)
          return result(400, { error: 'invalid_information_request' });
        const requestCorrelationId = correlationId(req);
        const outcome = await db.transaction(async (tx): Promise<MutationOutcome<unknown>> => {
          const staff = await staffWithRight(
            tx,
            actor,
            'request_missing_identity_or_residence_evidence',
          );
          if (!staff) return result(403, { error: 'information_request_not_authorized' });
          const complaint = await lockComplaint(tx, params.id);
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
      },
    },
    {
      method: 'POST',
      path: '/internal/complaints/:id/information-requests/:requestId/respond',
      handler: async (req, body, params) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        const response = boundedText(bodyField(body, 'response'), 10_000);
        if (!response) return result(400, { error: 'invalid_information_response' });
        const requestCorrelationId = correlationId(req);
        const outcome = await db.transaction(async (tx): Promise<MutationOutcome<unknown>> => {
          const complaint = await lockComplaint(tx, params.id);
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
                eq(schema.complaintInformationRequests.id, params.requestId),
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
      },
    },
    {
      method: 'POST',
      path: '/internal/complaints/:id/decisions',
      handler: async (req, body, params) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        const decisionOutcome = safeOutcome(bodyField(body, 'outcome'));
        const reason = boundedText(bodyField(body, 'reason'), 10_000);
        if (!decisionOutcome || !reason) return result(400, { error: 'invalid_decision' });
        const requestCorrelationId = correlationId(req);
        const outcome = await db.transaction(async (tx): Promise<MutationOutcome<unknown>> => {
          const staff = await staffWithRight(tx, actor, 'decide_complaint');
          if (!staff) return result(403, { error: 'decision_not_authorized' });
          const complaint = await lockComplaint(tx, params.id);
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
      },
    },
    {
      method: 'POST',
      path: '/internal/complaints/:id/appeals',
      handler: async (req, body, params) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        const grounds = boundedText(bodyField(body, 'grounds'), 10_000);
        if (!grounds) return result(400, { error: 'invalid_appeal' });
        const requestCorrelationId = correlationId(req);
        const outcome = await db.transaction(async (tx): Promise<MutationOutcome<unknown>> => {
          const complaint = await lockComplaint(tx, params.id);
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
      },
    },
    {
      method: 'POST',
      path: '/internal/complaints/:id/appeals/:appealId/decisions',
      handler: async (req, body, params) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        const decisionOutcome = safeOutcome(bodyField(body, 'outcome'));
        const reason = boundedText(bodyField(body, 'reason'), 10_000);
        if (!decisionOutcome || !reason) return result(400, { error: 'invalid_decision' });
        const requestCorrelationId = correlationId(req);
        const outcome = await db.transaction(async (tx): Promise<MutationOutcome<unknown>> => {
          const staff = await staffWithRight(tx, actor, 'decide_complaint_appeal');
          if (!staff) return result(403, { error: 'appeal_decision_not_authorized' });
          const complaint = await lockComplaint(tx, params.id);
          if (!complaint) return result(404, { error: 'complaint_not_found' });
          if (complaint.status !== 'appealed') return statusConflict('appealed', complaint.status);
          const [appeals, initialDecisions, appealDecisions] = await Promise.all([
            tx
              .select()
              .from(schema.complaintAppeals)
              .where(
                and(
                  eq(schema.complaintAppeals.id, params.appealId),
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
          if (!appeal || appeal.status !== 'filed')
            return result(404, { error: 'filed_appeal_not_found' });
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
      },
    },
    {
      method: 'POST',
      path: '/internal/complaints/:id/close',
      handler: async (req, _body, params) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        const requestCorrelationId = correlationId(req);
        const outcome = await db.transaction(async (tx): Promise<MutationOutcome<unknown>> => {
          const staff = await staffWithRight(tx, actor, 'decide_complaint');
          if (!staff) return result(403, { error: 'close_not_authorized' });
          const complaint = await lockComplaint(tx, params.id);
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
      },
    },
  ];
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? process.env.COMPLAINTS_SERVICE_PORT ?? 8970);
  const db = getClient();
  startService('complaints-service', port, complaintRoutes(db), { readiness: databaseReadiness });
  console.log(JSON.stringify({ service: 'complaints-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();
