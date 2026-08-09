import type { DbClient, schema } from '@polis/db';
import type { ComplaintStatus } from '@polis/domain';
import type { HttpResult } from '@polis/service-runtime';

export type Actor = { citizenId: string; identityLevel: string };
export type ComplaintRow = typeof schema.complaintCases.$inferSelect;
export type StaffBinding = {
  id: string;
  citizenId: string;
  roleId: string | null;
  jurisdictionId: string | null;
  rights: string[];
};
export type SelectDb = Pick<DbClient, 'select'>;
export type Transaction = Parameters<Parameters<DbClient['transaction']>[0]>[0];

export type SafeAuditData = {
  assignedMandateHolderId?: string;
  informationRequestId?: string;
  dueAt?: string;
  decisionId?: string;
  outcome?: string;
  appealId?: string;
};

export type AuditSpec = {
  caseId: string;
  action: string;
  actor: Actor;
  actorRole: 'resident' | 'staff';
  fromStatus: ComplaintStatus | null;
  toStatus: ComplaintStatus;
  correlationId: string | null;
  data?: SafeAuditData;
};

export type MutationSuccess<T> = {
  status: number;
  value: T;
  audit: AuditSpec;
};

export type MutationOutcome<T> = HttpResult | MutationSuccess<T>;
