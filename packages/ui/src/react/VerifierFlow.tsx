import { useCallback, useId, useRef, useState, type DragEvent } from 'react';
import { composeVerificationVerdict, type DocumentProof } from '@polis/domain';
import { t, type Locale } from '../messages/index.ts';
import { useFileHash } from './useFileHash.ts';
import { VerifierResult } from './VerifierResult.tsx';

type Tab = 'file' | 'hash' | 'reference';

type Result = {
  proof: DocumentProof | null;
  computedHash?: string;
  apiStatus: 'valid' | 'not_found' | 'error';
};

const HASH_RE = /^[0-9a-f]{64}$/i;

export type VerifierFlowProps = {
  apiUrl: string;
  proofBasePath?: string;
  locale?: Locale;
};

export function VerifierFlow({
  apiUrl,
  proofBasePath = '/proofs',
  locale = 'en',
}: VerifierFlowProps) {
  const [tab, setTab] = useState<Tab>('file');
  const [busy, setBusy] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [hashInput, setHashInput] = useState('');
  const [refInput, setRefInput] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const { fileName, hashing, hashFile } = useFileHash();

  const verifyHash = useCallback(
    async (hash: string) => {
      setBusy(true);
      setInputError(null);
      try {
        const res = await fetch(`${apiUrl}/api/v1/verify/hash`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ hash }),
        });
        const body = (await res.json()) as {
          status?: 'valid' | 'not_found';
          manifest?: DocumentProof | null;
        };
        setResult({
          proof: body.manifest ?? null,
          computedHash: hash,
          apiStatus: body.status === 'valid' ? 'valid' : 'not_found',
        });
      } catch {
        setResult(null);
        setInputError(t('verifier.error', locale));
      } finally {
        setBusy(false);
      }
    },
    [apiUrl, locale],
  );

  const fetchProofById = useCallback(
    async (proofId: string) => {
      setBusy(true);
      setInputError(null);
      try {
        const res = await fetch(`${apiUrl}/api/v1/proofs/${encodeURIComponent(proofId)}`);
        if (res.status === 404) {
          setResult({ proof: null, apiStatus: 'not_found' });
          return;
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as { proof?: DocumentProof } | DocumentProof;
        const proof = 'proof' in body && body.proof ? body.proof : (body as DocumentProof);
        setResult({ proof, apiStatus: 'valid' });
      } catch {
        setResult(null);
        setInputError(t('verifier.error', locale));
      } finally {
        setBusy(false);
      }
    },
    [apiUrl, locale],
  );

  const onFile = useCallback(
    async (file: File) => {
      setResult(null);
      const hash = await hashFile(file);
      if (hash) await verifyHash(hash);
    },
    [hashFile, verifyHash],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void onFile(file);
    },
    [onFile],
  );

  const onHashSubmit = useCallback(() => {
    const hash = hashInput.trim().toLowerCase();
    if (!HASH_RE.test(hash)) {
      setInputError(t('verifier.invalid_hash', locale));
      return;
    }
    void verifyHash(hash);
  }, [hashInput, locale, verifyHash]);

  const onReferenceSubmit = useCallback(() => {
    const raw = refInput.trim();
    if (raw.length === 0) return;
    let proofId = raw;
    const match = raw.match(/\/proofs\/([^/?#]+)/);
    if (match) proofId = decodeURIComponent(match[1]);
    void fetchProofById(proofId);
  }, [refInput, fetchProofById]);

  const verdict =
    result === null
      ? null
      : composeVerificationVerdict({
          proof: result.proof,
          computedHash: result.computedHash ?? null,
          apiStatus: result.apiStatus,
        });

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'file', label: t('verifier.tab.file', locale) },
    { id: 'hash', label: t('verifier.tab.hash', locale) },
    { id: 'reference', label: t('verifier.tab.reference', locale) },
  ];

  return (
    <div className="verifier-flow">
      <div className="verifier-tabs" role="tablist">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            id={`${baseId}-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`${baseId}-panel-${id}`}
            onClick={() => {
              setTab(id);
              setInputError(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'file' && (
        <div
          id={`${baseId}-panel-file`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-file`}
          className="stack"
        >
          <p className="privacy-note">
            <span aria-hidden="true">🔒</span> {t('verifier.privacy', locale)}
          </p>
          <div
            className="dropzone"
            data-active={dragActive}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
          >
            <p>{t('verifier.dropzone', locale)}</p>
            <input
              ref={fileInputRef}
              type="file"
              aria-label={t('verifier.tab.file', locale)}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
          </div>
          {fileName && (
            <p className="muted">
              {fileName}
              {hashing ? ` — ${t('verifier.checking', locale)}` : ''}
            </p>
          )}
        </div>
      )}

      {tab === 'hash' && (
        <div
          id={`${baseId}-panel-hash`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-hash`}
          className="stack"
        >
          <label htmlFor={`${baseId}-hash-input`}>{t('verifier.hash_label', locale)}</label>
          <input
            id={`${baseId}-hash-input`}
            type="text"
            className="hash-value"
            placeholder={t('verifier.hash_placeholder', locale)}
            value={hashInput}
            onChange={(e) => setHashInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onHashSubmit();
            }}
          />
          <div>
            <button onClick={onHashSubmit} disabled={busy}>
              {busy ? t('verifier.checking', locale) : t('verifier.submit', locale)}
            </button>
          </div>
        </div>
      )}

      {tab === 'reference' && (
        <div
          id={`${baseId}-panel-reference`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-reference`}
          className="stack"
        >
          <label htmlFor={`${baseId}-ref-input`}>{t('verifier.reference_label', locale)}</label>
          <input
            id={`${baseId}-ref-input`}
            type="text"
            placeholder={t('verifier.reference_placeholder', locale)}
            value={refInput}
            onChange={(e) => setRefInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onReferenceSubmit();
            }}
          />
          <div>
            <button onClick={onReferenceSubmit} disabled={busy}>
              {busy ? t('verifier.checking', locale) : t('verifier.submit', locale)}
            </button>
          </div>
        </div>
      )}

      {inputError && (
        <p className="trust-note" role="alert">
          {inputError}
        </p>
      )}

      {verdict && result && (
        <VerifierResult
          verdict={verdict}
          proof={result.proof}
          computedHash={result.computedHash}
          proofBasePath={proofBasePath}
          locale={locale}
        />
      )}
    </div>
  );
}
