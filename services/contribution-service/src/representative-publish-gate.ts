import { schema, type DbClient } from '@polis/db';
import { desc, eq } from 'drizzle-orm';
import { result, type HttpResult } from '@polis/service-runtime';

export type RequestedCommitmentScope = {
  jurisdictionId?: string | null;
  processId?: string | null;
};

export type PublishDenial = {
  error: string;
  reason: string;
  field?: string;
};

type PublishGateDenied = {
  denied: true;
  body: PublishDenial;
  response: HttpResult;
};

function charterScopeCovers(
  scope: unknown,
  requested: RequestedCommitmentScope,
): true | PublishDenial {
  const jurisdictionId = requested.jurisdictionId ?? null;
  const processId = requested.processId ?? null;
  if (scope == null) {
    return {
      error: 'charter_scope_not_covered',
      reason: 'charter_scope_required',
      field: 'scope',
    };
  }
  if (scope === 'all') return true;
  if (typeof scope === 'string') {
    if (scope === jurisdictionId || scope === processId) return true;
    return {
      error: 'charter_scope_not_covered',
      reason: jurisdictionId || processId ? 'legacy_scope_mismatch' : 'invalid_charter_scope',
      field: 'scope',
    };
  }
  if (typeof scope !== 'object' || Array.isArray(scope)) {
    return { error: 'charter_scope_not_covered', reason: 'invalid_charter_scope', field: 'scope' };
  }
  const scoped = scope as { jurisdictions?: unknown; processes?: unknown };
  const invalidScopeList = (value: unknown): boolean =>
    value !== undefined &&
    (!Array.isArray(value) ||
      value.length === 0 ||
      value.some((entry) => typeof entry !== 'string' || !entry.trim()));
  if (invalidScopeList(scoped.jurisdictions) || invalidScopeList(scoped.processes)) {
    return {
      error: 'charter_scope_not_covered',
      reason: 'invalid_charter_scope',
      field: 'scope',
    };
  }
  const hasJurisdictions = Array.isArray(scoped.jurisdictions) && scoped.jurisdictions.length > 0;
  const hasProcesses = Array.isArray(scoped.processes) && scoped.processes.length > 0;
  if (!hasJurisdictions && !hasProcesses) {
    return {
      error: 'charter_scope_not_covered',
      reason: 'charter_scope_required',
      field: 'scope',
    };
  }
  if (jurisdictionId) {
    if (
      !Array.isArray(scoped.jurisdictions) ||
      (!scoped.jurisdictions.includes('all') && !scoped.jurisdictions.includes(jurisdictionId))
    ) {
      return {
        error: 'charter_scope_not_covered',
        reason: 'jurisdiction_not_covered',
        field: 'jurisdictionId',
      };
    }
  }
  if (processId) {
    if (
      !Array.isArray(scoped.processes) ||
      (!scoped.processes.includes('all') && !scoped.processes.includes(processId))
    ) {
      return {
        error: 'charter_scope_not_covered',
        reason: 'process_not_covered',
        field: 'processId',
      };
    }
  }
  return true;
}

/**
 * citizen identity is verified_official, the matching mandate_holder row is
 * active, their latest effective charter is accepted and signature-backed,
 * and that charter covers the requested commitment jurisdiction/process.
 */
export async function assertCanPublish(
  db: Pick<DbClient, 'select'>,
  citizenId: string,
  mandateHolderId: string,
  requestedScope: RequestedCommitmentScope = {},
): Promise<null | PublishGateDenied> {
  const citizenRows = await db
    .select({ identityLevel: schema.citizens.identityLevel })
    .from(schema.citizens)
    .where(eq(schema.citizens.id, citizenId))
    .limit(1);
  const citizen = citizenRows[0];
  if (!citizen || citizen.identityLevel !== 'verified_official') {
    const body = {
      error: 'not_verified_official',
      reason: 'identity_level_required',
      field: 'identityLevel',
    };
    return { denied: true, body, response: result(403, body) };
  }
  const holderRows = await db
    .select({
      citizenId: schema.mandateHolders.citizenId,
      status: schema.mandateHolders.status,
      jurisdictionId: schema.mandateHolders.jurisdictionId,
    })
    .from(schema.mandateHolders)
    .where(eq(schema.mandateHolders.id, mandateHolderId))
    .limit(1);
  const holder = holderRows[0];
  if (!holder || holder.citizenId !== citizenId) {
    const body = {
      error: 'not_mandate_holder',
      reason: 'citizen_mismatch',
      field: 'mandateHolderId',
    };
    return { denied: true, body, response: result(403, body) };
  }
  if (holder.status !== 'active') {
    const body = {
      error: 'mandate_inactive',
      reason: 'mandate_holder_not_active',
      field: 'status',
    };
    return { denied: true, body, response: result(403, body) };
  }
  const charterRows = await db
    .select({
      id: schema.mandateHolderCharters.id,
      status: schema.mandateHolderCharters.status,
      charterDoc: schema.mandateHolderCharters.charterDoc,
      acceptedSigningRequestId: schema.mandateHolderCharters.acceptedSigningRequestId,
      signedArtifactId: schema.mandateHolderCharters.signedArtifactId,
      proofManifestId: schema.mandateHolderCharters.proofManifestId,
    })
    .from(schema.mandateHolderCharters)
    .where(eq(schema.mandateHolderCharters.mandateHolderId, mandateHolderId))
    .orderBy(
      desc(schema.mandateHolderCharters.version),
      desc(schema.mandateHolderCharters.updatedAt),
    )
    .limit(1);
  const charter = charterRows[0];
  if (!charter || charter.status !== 'accepted') {
    const body = {
      error: 'charter_required',
      reason: 'accepted_charter_required',
      field: 'charter',
    };
    return { denied: true, body, response: result(403, body) };
  }
  let signatureBacked = false;
  if (charter.acceptedSigningRequestId && charter.signedArtifactId && charter.proofManifestId) {
    const requestRows = await db
      .select({
        id: schema.signingRequests.id,
        charterId: schema.signingRequests.charterId,
        mandateHolderId: schema.signingRequests.mandateHolderId,
        status: schema.signingRequests.status,
        signedArtifactId: schema.signingRequests.signedArtifactId,
        proofManifestId: schema.signingRequests.proofManifestId,
      })
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, charter.acceptedSigningRequestId))
      .limit(1);
    const signingRequest = requestRows[0];
    if (
      signingRequest?.status === 'completed' &&
      signingRequest.charterId === charter.id &&
      signingRequest.mandateHolderId === mandateHolderId &&
      signingRequest.signedArtifactId === charter.signedArtifactId &&
      signingRequest.proofManifestId === charter.proofManifestId
    ) {
      const artifactRows = await db
        .select({ id: schema.documentArtifacts.id, kind: schema.documentArtifacts.kind })
        .from(schema.documentArtifacts)
        .where(eq(schema.documentArtifacts.id, charter.signedArtifactId))
        .limit(1);
      const proofRows = await db
        .select({
          id: schema.proofManifests.id,
          registryStatus: schema.proofManifests.registryStatus,
        })
        .from(schema.proofManifests)
        .where(eq(schema.proofManifests.id, charter.proofManifestId))
        .limit(1);
      const revocationRows = await db
        .select({ id: schema.proofRevocations.id })
        .from(schema.proofRevocations)
        .where(eq(schema.proofRevocations.proofId, charter.proofManifestId))
        .limit(1);
      const supersessionRows = await db
        .select({ id: schema.proofSupersessions.id })
        .from(schema.proofSupersessions)
        .where(eq(schema.proofSupersessions.supersededProofId, charter.proofManifestId))
        .limit(1);
      const proof = proofRows[0];
      signatureBacked = Boolean(
        artifactRows[0]?.kind === 'charter_signed' &&
        proof?.registryStatus === 'active' &&
        !revocationRows[0] &&
        !supersessionRows[0],
      );
    }
  }
  if (!signatureBacked) {
    const body = {
      error: 'charter_signature_required',
      reason: 'signature_backed_charter_required',
      field: 'charter',
    };
    return { denied: true, body, response: result(403, body) };
  }
  const charterScope =
    charter.charterDoc && typeof charter.charterDoc === 'object' && 'scope' in charter.charterDoc
      ? charter.charterDoc.scope
      : undefined;
  const scopeCheck = charterScopeCovers(charterScope, requestedScope);
  if (scopeCheck !== true) {
    return { denied: true, body: scopeCheck, response: result(403, scopeCheck) };
  }
  return null;
}
