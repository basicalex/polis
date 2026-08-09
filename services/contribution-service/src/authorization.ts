import type { IncomingMessage } from 'node:http';
import { schema, type DbClient } from '@polis/db';
import { and, eq } from 'drizzle-orm';
import { result, type HttpResult } from '@polis/service-runtime';

/** §21 submission authorization accepts only identity-service session levels. */
const ALLOWED_IDENTITY: Record<string, true> = {
  verified_resident: true,
  verified_official: true,
  staff: true,
};

function identityOk(level: unknown): level is string {
  return typeof level === 'string' && Object.prototype.hasOwnProperty.call(ALLOWED_IDENTITY, level);
}

export type TrustedContributionActor = {
  citizenId: string;
  identityLevel: string;
};

export function isTrustedContributionActor(value: unknown): value is TrustedContributionActor {
  return (
    typeof value === 'object' && value !== null && 'citizenId' in value && 'identityLevel' in value
  );
}

export function trustedContributionActor(
  req: IncomingMessage,
): TrustedContributionActor | HttpResult {
  const citizenId = req.headers['x-polis-citizen'];
  const identityLevel = req.headers['x-polis-identity-level'];
  if (
    typeof citizenId !== 'string' ||
    !citizenId.trim() ||
    typeof identityLevel !== 'string' ||
    !identityLevel.trim()
  ) {
    return result(401, { error: 'trusted_actor_required' });
  }
  if (!identityOk(identityLevel)) return result(403, { error: 'identity_required' });
  return { citizenId, identityLevel };
}

export function hasAuthorityFields(body: unknown, fields: readonly string[]): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    fields.some((field) => Object.prototype.hasOwnProperty.call(body, field))
  );
}

/** Map real session levels onto the legacy contributor storage enum without widening authorization. */
export function storedContributorIdentity(identityLevel: string): 'verified' | 'staff' {
  return identityLevel === 'staff' ? 'staff' : 'verified';
}

const REVIEW_CONTRIBUTION_RIGHT = 'review_contribution';

function bindingIsActive(row: { status: string; startsAt: Date; endsAt: Date | null }): boolean {
  const now = Date.now();
  return (
    row.status === 'active' &&
    row.startsAt.getTime() <= now &&
    (!row.endsAt || row.endsAt.getTime() > now)
  );
}

export async function hasReviewAuthority(
  db: Pick<DbClient, 'select'>,
  actor: TrustedContributionActor,
): Promise<boolean> {
  if (actor.identityLevel !== 'staff') return false;
  const rows = await db
    .select({
      status: schema.mandateHolders.status,
      startsAt: schema.mandateHolders.startsAt,
      endsAt: schema.mandateHolders.endsAt,
      decisionRightName: schema.decisionRights.name,
    })
    .from(schema.mandateHolders)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.mandateHolders.roleId))
    .innerJoin(schema.decisionRights, eq(schema.decisionRights.roleId, schema.roles.id))
    .where(
      and(
        eq(schema.mandateHolders.citizenId, actor.citizenId),
        eq(schema.decisionRights.name, REVIEW_CONTRIBUTION_RIGHT),
      ),
    );
  return rows.some(
    (row) => bindingIsActive(row) && row.decisionRightName === REVIEW_CONTRIBUTION_RIGHT,
  );
}
