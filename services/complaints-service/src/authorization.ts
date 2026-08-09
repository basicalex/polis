import type { IncomingMessage } from 'node:http';
import { schema } from '@polis/db';
import { eq } from 'drizzle-orm';
import { result, type HttpResult } from '@polis/service-runtime';

import type { Actor, SelectDb, StaffBinding } from './types.js';

export const JURISDICTION_ID = 'jur-croatia-local';
export const INSTITUTION_ID = 'inst-complaints-office';

const COMPLAINT_READER_RIGHTS = [
  'decide_complaint',
  'decide_complaint_appeal',
  'route_case_to_sector_office',
  'request_missing_identity_or_residence_evidence',
] as const;

export function resolveActor(req: IncomingMessage): Actor | null {
  const citizen = req.headers['x-polis-citizen'];
  const identity = req.headers['x-polis-identity-level'];
  if (typeof citizen !== 'string' || !citizen.trim()) return null;
  if (typeof identity !== 'string' || !identity.trim()) return null;
  return { citizenId: citizen.trim(), identityLevel: identity.trim() };
}

export function requireActor(req: IncomingMessage): Actor | HttpResult {
  return resolveActor(req) ?? result(401, { error: 'unauthenticated' });
}

export function isActor(value: Actor | HttpResult): value is Actor {
  return 'citizenId' in value;
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

export async function staffWithRight(
  db: SelectDb,
  actor: Actor,
  requiredRight: string,
): Promise<StaffBinding | null> {
  const bindings = await staffBindings(db, actor);
  return bindings.find((binding) => binding.rights.includes(requiredRight)) ?? null;
}

export async function complaintReader(db: SelectDb, actor: Actor): Promise<StaffBinding | null> {
  const bindings = await staffBindings(db, actor);
  return (
    bindings.find((binding) =>
      COMPLAINT_READER_RIGHTS.some((right) => binding.rights.includes(right)),
    ) ?? null
  );
}

export async function holderWithRight(
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
