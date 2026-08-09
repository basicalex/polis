# Task 11 clean-snapshot local recovery drill — 2026-08-09

## Decision

**NO-GO for the production recovery gate.** This run proves the final clean-checkout guard and local recovery mechanics. It does not prove off-host storage, the partner database, a main-repository release commit, or human operator/reviewer approval.

## Snapshot construction

The current Polis tracked and nonignored untracked file view was copied to an isolated temporary repository, excluding only the pre-existing unrelated `.omp/RULES.md`. The snapshot was committed there as `fec6bbec179808121cbb2912c693851f4bec45da` and remained clean while the final backup and restore scripts ran. Ignored dependency links and generated build output did not enter the commit. This synthetic SHA is not a commit in the main Polis repository and must not be used as a release identifier.

## Scope

| Field | Value |
| --- | --- |
| Classification | `clean-snapshot-local-tool-drill` |
| Operator | Prime Agent |
| Independent human reviewer | Missing |
| Repository class | Local encrypted restic test repository |
| Off-host | No |
| Synthetic clean Git SHA | `fec6bbec179808121cbb2912c693851f4bec45da` |
| PostgreSQL image | `pgvector/pgvector:pg16` |
| PostgreSQL clients | 16.14 |
| Restic | 0.19.1 |
| Snapshot | `4200d5b7fd95210bf4acc2154b50af479831e7e346d42801c5d5c29b365f6fb5` |
| Backup UTC | `2026-08-09T02:45:24Z` |
| Restore verified UTC | `2026-08-09T02:45:30Z` |
| Disposable targets destroyed UTC | `2026-08-09T02:45:53Z` |
| Task 11 containers remaining | 0 |

## Results

- The final backup script accepted the clean synthetic checkout and bound its Git SHA into manifest v2.
- A clean database applied all 15 migrations and seeded twice without count changes: 66 public tables and 101 seeded rows.
- One synthetic restricted audit event verified before backup.
- Audit metadata, migration metadata, and `pg_dump` shared one exported PostgreSQL snapshot.
- The restic snapshot contained exactly `polis.dump` and `manifest.json`.
- Restic check passed and retention kept the nominated snapshot; the attached transcript redacts only the local hostname.
- The nominated snapshot restored into `polis_task11_disposable_restore_drill_de30a14c1753` after logical and physical source/production/target identity checks.
- Backup JSON, manifest, and restore JSON match on Git SHA, PostgreSQL major, dump/TOC digests, table count, migration count/head, and audit count/head.
- The restored canonical audit chain verified; a modified record failed with `recomputed hash mismatch at record 1`.
- Backup and restore each emitted exactly one JSON object on stdout.
- All disposable containers and the local restic repository were removed.

## Cross-matched values

| Field | Value |
| --- | --- |
| `postgresMajor` | `16` |
| `dumpSha256` | `3e764992fd8eb368e97ccec1436c1c603951590f2ac4a32074866c195ff8e289` |
| `restoreListSha256` | `fc0d4b2ac17993e52f32788a39106586ed35ff1376b04c4e1230b8d4776b36a9` |
| `migrationCount` | `15` |
| `latestMigrationHash` | `3e3634b31c63efe7803ad17e84ac5009d74ab906123d84055b41da237949ae8f` |
| `auditEventCount` | `1` |
| `auditHeadHash` | `862b682a696bf5e9fda06ad6b4c1b10bee8afee7d4e7b1af88c6f8355f057590` |

## Nonsecret evidence

The raw synthetic commit object hashes to `fec6bbec179808121cbb2912c693851f4bec45da`. Its tree inventory lists 889 files and does not contain `.omp/RULES.md`. The clean snapshot's source-only operations suite passed 13/13.

| File | SHA-256 |
| --- | --- |
| `2026-08-09-task11-clean-snapshot-recovery-drill/audit-tampered-result.json` | `312ed51d9c274866e3dc7b89155d20eede5265bd5270518d798d224f8cffa3f4` |
| `2026-08-09-task11-clean-snapshot-recovery-drill/audit-valid-result.json` | `4fbfa917294da0ceaf16000ac47e4095b20b25ca0a970331b06f18a24ae90a10` |
| `2026-08-09-task11-clean-snapshot-recovery-drill/backup-check-retention.log` | `b0f5474acd86b0457a04440e1a735ddebdabe9b587ae0fe53745d39b482a5420` |
| `2026-08-09-task11-clean-snapshot-recovery-drill/backup.json` | `e5b492e21525ec534fd580d24ee099e22abdba337a717cedb01c76ad8ce91c66` |
| `2026-08-09-task11-clean-snapshot-recovery-drill/clean-db-drill.json` | `3b4e4f5e44450a72facb37a995f633e744977dcf651f020ae416d6d1f978b387` |
| `2026-08-09-task11-clean-snapshot-recovery-drill/context.json` | `677d2f73b2eba9feb0023673324e2ecc12da5f7568673470a538225c14731290` |
| `2026-08-09-task11-clean-snapshot-recovery-drill/manifest.json` | `8418b39cb160335c6f505b8e25b647a72ef8cb7ceaa89977bae17869a818c4f5` |
| `2026-08-09-task11-clean-snapshot-recovery-drill/ops-test.log` | `d9502f849091f91c5889caed14569cc465043a22ec8042ea2830a388a3cb04d3` |
| `2026-08-09-task11-clean-snapshot-recovery-drill/restore-transcript.log` | `d44b3b754e67f5ff5c6f07cf14965b1420b02f33f8e17b5868744ec4468bf7f4` |
| `2026-08-09-task11-clean-snapshot-recovery-drill/restore.json` | `043a095bc52f75e294503f9504bb689a4ae44a478e5e4b5a42f6a9b437dfaa46` |
| `2026-08-09-task11-clean-snapshot-recovery-drill/snapshot-commit.txt` | `4f6e6f9fc1065a8ff59fb9f06aa88bbf601c236bfb0cb2357191691d96b4c5d5` |
| `2026-08-09-task11-clean-snapshot-recovery-drill/snapshot-tree.txt` | `f82c8757db045b392bb9e1fbb9ea745d076a0f80577f3da279e83348af9db6c1` |

## Remaining production gate

Task 11 remains open until the same commands run from an approved clean main-repository release commit against the partner source database and encrypted off-host restic repository. A named human operator must restore the exact nominated snapshot to a distinct disposable target, record its destruction, attach provider-side repository evidence, and obtain named independent reviewer approval.
