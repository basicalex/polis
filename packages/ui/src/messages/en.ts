export const en = {
  // ---- verdict headlines (§15.3) ----
  'verdict.valid.headline': 'Proof valid',
  'verdict.valid_but_superseded.headline': 'Valid, but superseded by a newer version',
  'verdict.valid_but_expired.headline': 'Valid, but expired',
  'verdict.revoked.headline': 'Proof revoked',
  'verdict.integrity_failure.headline': 'Integrity check failed',
  'verdict.signature_invalid.headline': 'Signature invalid',
  'verdict.timestamp_invalid.headline': 'Timestamp invalid',
  'verdict.issuer_unknown.headline': 'Issuer unknown',
  'verdict.status_unknown.headline': 'Registry status unknown',
  'verdict.private_or_restricted.headline': 'Private or restricted proof',
  'verdict.not_found.headline': 'No proof found',

  // ---- verdict explanations ----
  'verdict.valid.explanation':
    'This exact content matches a registered proof. Its signatures and timestamps check out, and the proof is active in the registry.',
  'verdict.valid_but_superseded.explanation':
    'The proof is genuine, but a newer version of this document has been registered. Check the superseding proof for the current version.',
  'verdict.valid_but_expired.explanation':
    'The proof is genuine, but its validity period has ended. The content was authentic at the time, but it is no longer presented as current.',
  'verdict.revoked.explanation':
    'The issuer has revoked this proof. The document should no longer be relied on, even though it may have been valid in the past.',
  'verdict.integrity_failure.explanation':
    'The content you checked does not match the registered proof. The file may have been altered, corrupted, or it may be a different document.',
  'verdict.signature_invalid.explanation':
    'A signature on this proof failed validation. The signed data does not match what the signer sealed, or the signature is malformed.',
  'verdict.timestamp_invalid.explanation':
    'A timestamp on this proof failed validation. The time attestation cannot be trusted.',
  'verdict.issuer_unknown.explanation':
    'The proof is signed, but the signer is not linked to a registered issuer. Treat the origin of this document with caution.',
  'verdict.status_unknown.explanation':
    'The registry could not report a definitive status for this proof. Try again later or contact the issuer.',
  'verdict.private_or_restricted.explanation':
    'A proof exists, but it is private or restricted. No verification details are disclosed for restricted proofs — neither confirmation nor denial.',
  'verdict.not_found.explanation':
    'No registered proof matches this content. That does not mean the document is false — it may simply never have been registered here.',

  // ---- verdict notes ----
  'verdict.note.proof_not_truth':
    'A valid proof shows this exact file existed and was signed and timestamped as shown. It does not prove the content is true, fair, or still in force.',
  'verdict.note.test_signature':
    'This proof carries a test signature. It demonstrates the mechanism but is not legally meaningful.',

  // ---- mechanisms ----
  'mechanism.hash': 'Content hash',
  'mechanism.signature': 'Signature',
  'mechanism.timestamp': 'Timestamp',
  'mechanism.registry': 'Registry status',
  'mechanism.issuer': 'Issuer',

  // ---- check statuses (generic) ----
  'status.pass': 'Pass',
  'status.fail': 'Fail',
  'status.indeterminate': 'Indeterminate',
  'status.not_present': 'Not present',
  'status.not_checked': 'Not checked',

  // ---- check labels ----
  'check.hash.pass': 'Your content matches the registered hash exactly.',
  'check.hash.fail': 'Your content does not match the registered hash.',
  'check.hash.not_checked': 'No content was provided to compare — proof looked up by reference.',
  'check.signature.pass': 'All signatures validated against the sealed data.',
  'check.signature.fail': 'At least one signature failed validation.',
  'check.signature.indeterminate': 'Signature validation was inconclusive.',
  'check.signature.not_checked': 'Signatures present but not yet validated.',
  'check.signature.not_present': 'No signatures attached to this proof.',
  'check.signature.test_key':
    'Test signature — demonstrates the mechanism, not legally meaningful.',
  'check.timestamp.pass': 'All timestamps validated.',
  'check.timestamp.fail': 'At least one timestamp failed validation.',
  'check.timestamp.indeterminate': 'Timestamp validation was inconclusive.',
  'check.timestamp.not_checked': 'Timestamps present but not yet validated.',
  'check.timestamp.not_present': 'No timestamps attached to this proof.',
  'check.registry.active': 'Proof is active in the registry.',
  'check.registry.superseded': 'A newer proof supersedes this one.',
  'check.registry.revoked': 'The issuer revoked this proof.',
  'check.registry.expired': 'The validity period of this proof has ended.',
  'check.registry.sealed': 'This proof is sealed.',
  'check.registry.unknown': 'The registry did not report a definitive status.',
  'check.issuer.pass': 'The signer is linked to a registered issuer.',
  'check.issuer.unknown': 'The signer is not linked to a registered issuer.',
  'check.issuer.not_checked': 'No signatures, so issuer linkage was not evaluated.',
  'check.generic.not_found': 'Not evaluated — no proof was found.',
  'check.generic.restricted': 'Not disclosed — this proof is restricted.',

  // ---- §15.4 what each mechanism proves / does not prove ----
  'teach.title': 'What verification proves — and what it does not',
  'teach.proves': 'Proves',
  'teach.not_proves': 'Does not prove',
  'teach.hash.proves': 'The file is byte-for-byte unchanged since registration.',
  'teach.hash.not_proves': 'That the content of the file is true.',
  'teach.signature.proves': 'The signer sealed exactly this data.',
  'teach.signature.not_proves': 'That the signer was authorized or correct.',
  'teach.timestamp.proves': 'The data existed at or before the attested time.',
  'teach.timestamp.not_proves': 'Legal acceptance or that the content is current.',
  'teach.registry.proves': 'The issuer still stands behind (or has withdrawn) the proof.',
  'teach.registry.not_proves': 'Anything about the quality of the content.',

  // ---- confidence states (§11.5) ----
  'confidence.unsupported_draft': 'Unsupported draft',
  'confidence.single_source': 'Single source',
  'confidence.multi_source': 'Multiple sources',
  'confidence.official_source': 'Official source',
  'confidence.official_confirmed': 'Officially confirmed',
  'confidence.expert_reviewed': 'Expert reviewed',
  'confidence.contested': 'Contested',
  'confidence.outdated': 'Outdated',
  'confidence.superseded': 'Superseded',

  // ---- review states ----
  'review.draft': 'Draft',
  'review.submitted': 'Submitted',
  'review.needs_revision': 'Needs revision',
  'review.under_review': 'Under review',
  'review.approved': 'Approved',
  'review.contested': 'Contested',
  'review.deprecated': 'Deprecated',
  'review.rejected': 'Rejected',
  'review.archived': 'Archived',

  // ---- risk levels ----
  'risk.low': 'Low risk',
  'risk.medium': 'Medium risk',
  'risk.high': 'High risk',
  'risk.critical': 'Critical risk',

  // ---- trust strip ----
  'strip.signed': 'Signed',
  'strip.timestamped': 'Timestamped',
  'strip.sourced': 'Source-linked',
  'strip.unsourced': 'No sources',
  'strip.audited': 'Audit trail',
  'strip.proof': 'Proof',

  // ---- AI label (§2.8) ----
  'ai.label': 'AI-assisted',
  'ai.explanation':
    'Parts of this content were produced with AI assistance. It carries source traceability and a review state, and can be challenged.',

  // ---- verifier flow ----
  'verifier.tab.file': 'Check a file',
  'verifier.tab.hash': 'Paste a hash',
  'verifier.tab.reference': 'Proof link or ID',
  'verifier.dropzone': 'Drop a file here or choose one',
  'verifier.privacy':
    'Your file is hashed on your device and never uploaded. Only the hash is sent for verification.',
  'verifier.computed_hash': 'Computed SHA-256 hash',
  'verifier.hash_label': 'SHA-256 hash of the document',
  'verifier.hash_placeholder': 'Paste a 64-character hexadecimal hash',
  'verifier.reference_label': 'Proof URL or proof ID',
  'verifier.reference_placeholder': 'https://…/proofs/… or a proof ID',
  'verifier.submit': 'Verify',
  'verifier.checking': 'Verifying…',
  'verifier.error': 'Verification service unreachable. Please try again.',
  'verifier.invalid_hash': 'That does not look like a SHA-256 hash (64 hex characters).',
  'verifier.view_proof': 'View full proof',

  // ---- proof manifest ----
  'manifest.document': 'Document',
  'manifest.filename': 'Original filename',
  'manifest.mime': 'File type',
  'manifest.bytes': 'Size (bytes)',
  'manifest.class': 'Document class',
  'manifest.issuer': 'Issuer',
  'manifest.created': 'Registered',
  'manifest.hashes': 'Hashes',
  'manifest.hash.originalFileHash': 'Original file',
  'manifest.hash.canonicalPdfHash': 'Canonical PDF',
  'manifest.hash.ocrTextHash': 'OCR text',
  'manifest.hash.metadataHash': 'Metadata',
  'manifest.hash.manifestHash': 'Manifest',
  'manifest.signatures': 'Signatures',
  'manifest.timestamps': 'Timestamps',
  'manifest.visibility': 'Visibility',
  'manifest.content_visibility': 'Content visibility',
  'manifest.proof_visibility': 'Proof visibility',
  'manifest.registry_status': 'Registry status',
  'manifest.superseded_by': 'Superseded by',
  'manifest.signer': 'Signer',
  'manifest.standard': 'Standard',
  'manifest.signed_at': 'Signed at',
  'manifest.tsa': 'Time-stamping authority',
  'manifest.timestamped_at': 'Timestamped at',
  'manifest.validation': 'Validation',

  // ---- audit trail ----
  'audit.title': 'Audit trail',
  'audit.empty': 'No audit events recorded for this object.',
  'audit.chained': 'Hash-chained',
  'audit.redacted': 'Redacted event',

  // ---- sources ----
  'sources.title': 'Sources & evidence',
  'sources.empty': 'No evidence links attached.',
  'sources.retrieved': 'Retrieved',
  'sources.hash': 'Source hash',
  'sources.locator': 'Location',
  'sources.external': 'external link',

  // ---- misc ----
  'demo.banner': 'Demo environment — data is simulated, proofs use development keys.',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
} as const;

export type MessageKey = keyof typeof en;
