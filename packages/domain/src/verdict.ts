import type { DocumentProof } from './index.js';

export type VerificationState =
  | 'valid'
  | 'valid_but_superseded'
  | 'valid_but_expired'
  | 'revoked'
  | 'integrity_failure'
  | 'signature_invalid'
  | 'timestamp_invalid'
  | 'issuer_unknown'
  | 'status_unknown'
  | 'private_or_restricted'
  | 'not_found';

export type VerdictTone = 'valid' | 'warning' | 'invalid' | 'unknown' | 'restricted';

export type Mechanism = 'hash' | 'signature' | 'timestamp' | 'registry' | 'issuer';

export type CheckStatus = 'pass' | 'fail' | 'indeterminate' | 'not_present' | 'not_checked';

export type VerdictCheck = {
  mechanism: Mechanism;
  status: CheckStatus;
  labelKey: string;
  detail?: string;
};

export type VerificationVerdict = {
  state: VerificationState;
  tone: VerdictTone;
  headlineKey: `verdict.${VerificationState}.headline`;
  explanationKeys: string[];
  checks: VerdictCheck[];
  proofNotTruthKey: 'verdict.note.proof_not_truth';
};

export type VerdictInput = {
  proof: DocumentProof | null;
  /** Hash the citizen computed or pasted, when this was a hash verification. */
  computedHash?: string | null;
  /** Status returned by POST /api/v1/verify/hash, when that endpoint was used. */
  apiStatus?: 'valid' | 'not_found' | 'error' | null;
};

const STATE_TONES: Record<VerificationState, VerdictTone> = {
  valid: 'valid',
  valid_but_superseded: 'warning',
  valid_but_expired: 'warning',
  revoked: 'invalid',
  integrity_failure: 'invalid',
  signature_invalid: 'invalid',
  timestamp_invalid: 'invalid',
  issuer_unknown: 'warning',
  status_unknown: 'warning',
  private_or_restricted: 'restricted',
  not_found: 'unknown',
};

function normalizeHash(hash: string): string {
  return hash.trim().toLowerCase();
}

function hashMatchesProof(proof: DocumentProof, computedHash: string): boolean {
  const hash = normalizeHash(computedHash);
  const candidates = [proof.hashes.originalFileHash, proof.hashes.canonicalPdfHash].filter(
    (h): h is string => typeof h === 'string' && h.length > 0,
  );
  return candidates.some((candidate) => normalizeHash(candidate) === hash);
}

function validationCheckStatus(
  statuses: Array<'valid' | 'invalid' | 'indeterminate' | 'not_checked'>,
): CheckStatus {
  if (statuses.length === 0) return 'not_present';
  if (statuses.some((s) => s === 'invalid')) return 'fail';
  if (statuses.some((s) => s === 'indeterminate')) return 'indeterminate';
  if (statuses.some((s) => s === 'not_checked')) return 'not_checked';
  return 'pass';
}

function buildChecks(input: {
  proof: DocumentProof;
  computedHash: string | null;
  hashMatched: boolean | null;
}): VerdictCheck[] {
  const { proof, computedHash, hashMatched } = input;

  const hashCheck: VerdictCheck =
    computedHash === null
      ? {
          mechanism: 'hash',
          status: 'not_checked',
          labelKey: 'check.hash.not_checked',
        }
      : {
          mechanism: 'hash',
          status: hashMatched ? 'pass' : 'fail',
          labelKey: hashMatched ? 'check.hash.pass' : 'check.hash.fail',
          detail: normalizeHash(computedHash),
        };

  const signatureStatus = validationCheckStatus(proof.signatures.map((s) => s.validationStatus));
  const hasTestKeySignature = proof.signatures.some((s) => s.standard === 'test-key');
  const signatureCheck: VerdictCheck = {
    mechanism: 'signature',
    // §15.7: a test-key signature must never be presented as legally meaningful.
    status: signatureStatus,
    labelKey: hasTestKeySignature
      ? 'check.signature.test_key'
      : `check.signature.${signatureStatus}`,
    detail:
      proof.signatures.length > 0
        ? proof.signatures.map((s) => `${s.type}:${s.standard}:${s.signerRef}`).join('; ')
        : undefined,
  };

  const timestampStatus = validationCheckStatus(proof.timestamps.map((t) => t.validationStatus));
  const timestampCheck: VerdictCheck = {
    mechanism: 'timestamp',
    status: timestampStatus,
    labelKey: `check.timestamp.${timestampStatus}`,
    detail:
      proof.timestamps.length > 0
        ? proof.timestamps
            .map((t) => `${t.type}:${t.tsa ?? 'unknown-tsa'}:${t.timestampedAt}`)
            .join('; ')
        : undefined,
  };

  const registryCheck: VerdictCheck = {
    mechanism: 'registry',
    status:
      proof.registryStatus === 'active'
        ? 'pass'
        : proof.registryStatus === 'unknown'
          ? 'indeterminate'
          : 'fail',
    labelKey: `check.registry.${proof.registryStatus}`,
    detail: proof.registryStatus,
  };

  const knownIssuer =
    proof.signatures.length === 0 || proof.signatures.some((s) => s.issuerId !== null);
  const issuerCheck: VerdictCheck = {
    mechanism: 'issuer',
    status: proof.signatures.length === 0 ? 'not_checked' : knownIssuer ? 'pass' : 'indeterminate',
    labelKey:
      proof.signatures.length === 0
        ? 'check.issuer.not_checked'
        : knownIssuer
          ? 'check.issuer.pass'
          : 'check.issuer.unknown',
    detail: proof.issuer.name,
  };

  return [hashCheck, signatureCheck, timestampCheck, registryCheck, issuerCheck];
}

function unavailableChecks(state: 'not_found' | 'private_or_restricted'): VerdictCheck[] {
  const mechanisms: Mechanism[] = ['hash', 'signature', 'timestamp', 'registry', 'issuer'];
  const labelKey = state === 'not_found' ? 'check.generic.not_found' : 'check.generic.restricted';
  return mechanisms.map((mechanism) => ({
    mechanism,
    status: 'not_checked' as const,
    labelKey,
  }));
}

function verdict(
  state: VerificationState,
  checks: VerdictCheck[],
  extraExplanations: string[] = [],
): VerificationVerdict {
  return {
    state,
    tone: STATE_TONES[state],
    headlineKey: `verdict.${state}.headline`,
    explanationKeys: [`verdict.${state}.explanation`, ...extraExplanations],
    checks,
    proofNotTruthKey: 'verdict.note.proof_not_truth',
  };
}

/**
 * Maps a proof (plus optional citizen-computed hash) to one of the §15.3
 * verification states. Precedence is deliberate: restricted proofs are
 * reported before any failure detail so the UI never confirms or denies
 * check results for a proof the public may not inspect (§15.9).
 */
export function composeVerificationVerdict(input: VerdictInput): VerificationVerdict {
  const { proof, computedHash = null, apiStatus = null } = input;

  if (proof === null || apiStatus === 'not_found') {
    return verdict('not_found', unavailableChecks('not_found'));
  }

  if (
    proof.proofVisibility === 'private' ||
    proof.proofVisibility === 'commitment_only' ||
    proof.registryStatus === 'sealed'
  ) {
    return verdict('private_or_restricted', unavailableChecks('private_or_restricted'));
  }

  const hashMatched = computedHash !== null ? hashMatchesProof(proof, computedHash) : null;
  const checks = buildChecks({ proof, computedHash, hashMatched });
  const extra: string[] = [];
  if (proof.signatures.some((s) => s.standard === 'test-key')) {
    extra.push('verdict.note.test_signature');
  }

  if (hashMatched === false) return verdict('integrity_failure', checks, extra);
  if (proof.signatures.some((s) => s.validationStatus === 'invalid')) {
    return verdict('signature_invalid', checks, extra);
  }
  if (proof.timestamps.some((t) => t.validationStatus === 'invalid')) {
    return verdict('timestamp_invalid', checks, extra);
  }
  if (proof.registryStatus === 'revoked') return verdict('revoked', checks, extra);
  if (proof.registryStatus === 'expired') return verdict('valid_but_expired', checks, extra);
  if (proof.registryStatus === 'superseded' || proof.supersededBy !== null) {
    return verdict('valid_but_superseded', checks, extra);
  }
  if (proof.signatures.length > 0 && proof.signatures.every((s) => s.issuerId === null)) {
    return verdict('issuer_unknown', checks, extra);
  }
  if (proof.registryStatus === 'unknown') return verdict('status_unknown', checks, extra);
  return verdict('valid', checks, extra);
}
