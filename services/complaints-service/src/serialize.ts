import type {
  ComplaintAppeal,
  ComplaintDecision,
  ComplaintDetail,
  ComplaintEvent,
  ComplaintEventData,
  ComplaintInformationRequest,
  ComplaintSummary,
} from '@polis/domain';
import type { schema } from '@polis/db';

type ComplaintCaseRow = typeof schema.complaintCases.$inferSelect;
type InformationRequestRow = typeof schema.complaintInformationRequests.$inferSelect;
type DecisionRow = typeof schema.complaintDecisions.$inferSelect;
type AppealRow = typeof schema.complaintAppeals.$inferSelect;
type EventRow = typeof schema.complaintCaseEvents.$inferSelect;

const iso = (value: Date): string => value.toISOString();
const nullableIso = (value: Date | null): string | null => (value ? iso(value) : null);

export function complaintSummaryWire(row: ComplaintCaseRow): ComplaintSummary {
  return {
    id: row.id,
    caseNumber: row.caseNumber,
    subject: row.subject,
    status: row.status as ComplaintSummary['status'],
    institutionId: row.institutionId,
    processId: row.processId,
    jurisdictionId: row.jurisdictionId,
    assignedMandateHolderId: row.assignedMandateHolderId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    closedAt: nullableIso(row.closedAt),
  };
}

export function informationRequestWire(row: InformationRequestRow): ComplaintInformationRequest {
  return {
    id: row.id,
    complaintId: row.complaintId,
    requestedBy: row.requestedBy,
    question: row.question,
    dueAt: nullableIso(row.dueAt),
    respondedBy: row.respondedBy,
    response: row.response,
    respondedAt: nullableIso(row.respondedAt),
    createdAt: iso(row.createdAt),
  };
}

export function complaintDecisionWire(row: DecisionRow): ComplaintDecision {
  return {
    id: row.id,
    complaintId: row.complaintId,
    appealId: row.appealId,
    kind: row.kind as ComplaintDecision['kind'],
    outcome: row.outcome,
    reason: row.reason,
    decidedBy: row.decidedBy,
    decidedAt: iso(row.decidedAt),
  };
}

export function complaintAppealWire(row: AppealRow): ComplaintAppeal {
  return {
    id: row.id,
    complaintId: row.complaintId,
    initialDecisionId: row.initialDecisionId,
    grounds: row.grounds,
    status: row.status as ComplaintAppeal['status'],
    filedAt: iso(row.filedAt),
    decidedAt: nullableIso(row.decidedAt),
  };
}

type SafeEventData = ComplaintEventData & {
  assignedMandateHolderId?: string;
  dueAt?: string;
  outcome?: string;
};

const safeEventData = (value: unknown): SafeEventData => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const informationRequestId = Reflect.get(value, 'informationRequestId');
  const decisionId = Reflect.get(value, 'decisionId');
  const appealId = Reflect.get(value, 'appealId');
  const assignedMandateHolderId = Reflect.get(value, 'assignedMandateHolderId');
  const dueAt = Reflect.get(value, 'dueAt');
  const outcome = Reflect.get(value, 'outcome');
  return {
    ...(typeof informationRequestId === 'string' ? { informationRequestId } : {}),
    ...(typeof decisionId === 'string' ? { decisionId } : {}),
    ...(typeof appealId === 'string' ? { appealId } : {}),
    ...(typeof assignedMandateHolderId === 'string' ? { assignedMandateHolderId } : {}),
    ...(typeof dueAt === 'string' ? { dueAt } : {}),
    ...(typeof outcome === 'string' ? { outcome } : {}),
  };
};

export function complaintEventWire(row: EventRow): ComplaintEvent {
  return {
    id: row.id,
    complaintId: row.complaintId,
    eventType: row.eventType as ComplaintEvent['eventType'],
    actorId: row.actorId,
    actorType: row.actorType as ComplaintEvent['actorType'],
    fromStatus: row.fromStatus as ComplaintEvent['fromStatus'],
    toStatus: row.toStatus as ComplaintEvent['toStatus'],
    data: safeEventData(row.data),
    occurredAt: iso(row.occurredAt),
  };
}

export function complaintDetailWire(
  row: ComplaintCaseRow,
  informationRequests: InformationRequestRow[],
  decisions: DecisionRow[],
  appeal: AppealRow | null,
  events: EventRow[],
): ComplaintDetail {
  return {
    ...complaintSummaryWire(row),
    narrative: row.narrative,
    informationRequests: informationRequests.map(informationRequestWire),
    decisions: decisions.map(complaintDecisionWire),
    appeal: appeal ? complaintAppealWire(appeal) : null,
    events: events.map(complaintEventWire),
  };
}
