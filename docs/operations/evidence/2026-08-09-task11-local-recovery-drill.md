# Task 11 local recovery drill — 2026-08-09

## Decision

**NO-GO for the production recovery gate.** This run proves local mechanics only. It used an encrypted restic repository on the same host, an uncommitted working tree, synthetic data, and no named external operator or reviewer. It does not satisfy the required off-host reviewed drill and cannot complete Task 11.

## Scope

| Field | Value |
| --- | --- |
| Classification | `local-tool-drill` |
| Operator | Prime Agent |
| Independent reviewer | Pending |
| Repository class | Local encrypted restic test repository |
| Off-host | No |
| Source Git HEAD | `04993ec9dcb541b9ac5732714cbaf60e140f88b7` |
| Worktree clean | No |
| PostgreSQL image | `pgvector/pgvector:pg16` |
| PostgreSQL clients | 16.14 |
| Restic | 0.19.1 |
| Snapshot | `b2f8a990560363bd25f752993dccaebeb73f1e38b5b7b1ef1c4a13c6a4676a76` |
| Backup UTC | `2026-08-09T01:02:54Z` |
| Restore verified UTC | `2026-08-09T01:03:00Z` |
| Disposable targets destroyed UTC | `2026-08-09T01:03:25Z` |
| Task 11 containers remaining | 0 |

The recorded Git SHA does not bind the uncommitted Task 11 script changes used in this run. After this local mechanics run, the backup gate was hardened to reject any dirty working tree before connecting to PostgreSQL. This report is historical local-tool evidence, not proof of that final clean-checkout path. Production evidence must come from the exact clean release candidate.

## Results

- A clean database applied all 15 committed migrations and seeded twice without changing public-table row counts: 66 public tables, 101 seeded rows.
- The source contained one synthetic restricted audit event. Its chain verified before backup.
- Backup used one exported PostgreSQL snapshot for audit metadata, migration metadata, and `pg_dump`.
- Restic archived only `polis.dump` and `manifest.json`.
- The nominated snapshot restored into `polis_task11_disposable_restore_drill_af1bfa8dc489` after logical and physical source/production/target identity checks.
- Dump and TOC digests, PostgreSQL major 16, 66-table count, 15-migration ledger/head, one-event audit count/head, and canonical audit chain matched.
- Backup and restore each emitted exactly one nonsecret JSON object on stdout; restic progress went to stderr.
- A modified audit record failed with `recomputed hash mismatch at record 1`.
- Both disposable PostgreSQL containers and the local restic repository were removed after evidence capture.

## Failure found and corrected

The first real restore used PostgreSQL 18.4 host tools against PostgreSQL 16 and failed before completion because the archive emitted `SET transaction_timeout = 0`, which PostgreSQL 16 does not support. The gate now records `postgresMajor` and rejects backup or restore unless `pg_dump`, `pg_restore`, source PostgreSQL, target PostgreSQL, and the manifest use the same major version. The final successful run used PostgreSQL 16.14 clients.

An independent source review also found that URI query parameters could override a parsed PostgreSQL destination and that a tied migration timestamp could select different heads. The final gate rejects destination-changing and multi-host URIs, compares physical database identities, and orders both migration-head queries by `created_at DESC, id DESC`.

## Nonsecret raw evidence

| File | SHA-256 |
| --- | --- |
| `2026-08-09-task11-local-recovery-drill/clean-db-drill.json` | `3b4e4f5e44450a72facb37a995f633e744977dcf651f020ae416d6d1f978b387` |
| `2026-08-09-task11-local-recovery-drill/backup.json` | `224ceb00cba0d718bcc031103ed6a6c8c1c75f7f5356c9ca21e81a28204f2daf` |
| `2026-08-09-task11-local-recovery-drill/restore.json` | `bda28729e18d8aebe3e9e0dd75c2701c75c52c8b02a08fa4c459bb36ba0d515c` |
| `2026-08-09-task11-local-recovery-drill/audit-valid-result.json` | `2ed44dbe5e8d970421be137f0358646c7f1f85955bc0ea9e1f48c81bff86f06d` |
| `2026-08-09-task11-local-recovery-drill/audit-tampered-result.json` | `312ed51d9c274866e3dc7b89155d20eede5265bd5270518d798d224f8cffa3f4` |
| `2026-08-09-task11-local-recovery-drill/context.json` | `bde9565eebd073b8b4d46626138f1e5b6b3c997bfafb9a861acef1841635a4eb` |

## Production blockers

Task 11 remains open until a named operator runs the same gate from a clean immutable checkout against the partner database and encrypted off-host repository, a distinct disposable target is restored and destroyed, and a named independent reviewer signs the dated report. The report must attach the raw backup and restore JSON, manifest, tool versions, restic check evidence, retention result, and reviewer decision.
