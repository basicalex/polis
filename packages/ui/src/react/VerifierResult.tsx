import type { CheckStatus, DocumentProof, VerdictTone, VerificationVerdict } from '@polis/domain';
import { t, type Locale, type MessageKey } from '../messages/index.ts';

const TONE_GLYPHS: Record<VerdictTone, string> = {
  valid: '✓',
  warning: '⚠',
  invalid: '✕',
  unknown: '?',
  restricted: '🔒',
};

const CHECK_TONE: Record<CheckStatus, VerdictTone> = {
  pass: 'valid',
  fail: 'invalid',
  indeterminate: 'warning',
  not_present: 'unknown',
  not_checked: 'unknown',
};

export type VerifierResultProps = {
  verdict: VerificationVerdict;
  proof: DocumentProof | null;
  computedHash?: string;
  proofBasePath?: string;
  locale?: Locale;
};

export function VerifierResult({
  verdict,
  proof,
  computedHash,
  proofBasePath = '/proofs',
  locale = 'en',
}: VerifierResultProps) {
  return (
    <article className="verdict-card" data-tone={verdict.tone}>
      <h2 className="verdict-headline">
        <span className="trust-badge" data-tone={verdict.tone} role="status">
          <span aria-hidden="true">{TONE_GLYPHS[verdict.tone]}</span>
          {t(verdict.headlineKey as MessageKey, locale)}
        </span>
      </h2>
      {verdict.explanationKeys.map((key) => (
        <p key={key}>{t(key as MessageKey, locale)}</p>
      ))}
      {computedHash ? (
        <p>
          {t('verifier.computed_hash', locale)}: <span className="hash-value">{computedHash}</span>
        </p>
      ) : null}
      <ul className="check-list">
        {verdict.checks.map((check) => (
          <li key={check.mechanism} className="check-row">
            <span className="trust-badge" data-tone={CHECK_TONE[check.status]}>
              <span aria-hidden="true">{TONE_GLYPHS[CHECK_TONE[check.status]]}</span>
              {t(`status.${check.status}` as MessageKey, locale)}
            </span>
            <span className="check-mechanism">
              {t(`mechanism.${check.mechanism}` as MessageKey, locale)}
            </span>
            <span>
              {t(check.labelKey as MessageKey, locale)}
              {check.detail ? <span className="check-detail"> {check.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {proof ? (
        <a href={`${proofBasePath}/${encodeURIComponent(proof.id)}`}>
          {t('verifier.view_proof', locale)}
        </a>
      ) : null}
      <p className="trust-note trust-note--compact">{t('verdict.note.proof_not_truth', locale)}</p>
    </article>
  );
}
