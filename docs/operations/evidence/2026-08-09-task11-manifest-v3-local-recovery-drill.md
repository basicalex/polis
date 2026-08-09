# Task 11 manifest-v3 local recovery drill — 2026-08-09

## Decision

**NO-GO for the production recovery gate.** This run proves manifest-v3 mechanics from a clean synthetic checkout. Its repository was deliberately classified `local-test` with `productionEligible:false`. It does not prove off-host storage, the partner database, a main-repository release commit, or human operator/reviewer approval.

## Snapshot construction

The current Polis working-tree file view was copied to an isolated temporary repository, excluding only the pre-existing unrelated `.omp/RULES.md`. The 903-file snapshot was committed as `f63099ebe136b55d0140f22d9bef97f5c4ac7104` and remained clean while the backup and restore scripts ran. Ignored dependency links and generated build output did not enter the commit. This synthetic SHA is not a main-repository release identifier.

## Scope

| Field | Value |
| --- | --- |
| Classification | `clean-snapshot-local-tool-drill` |
| Operator | Prime Agent |
| Independent human reviewer | Missing |
| Repository class | `local-test` |
| Production eligible | `false` |
| Off-host | No |
| Manifest format | 3 |
| Synthetic Git SHA | `f63099ebe136b55d0140f22d9bef97f5c4ac7104` |
| PostgreSQL image/client | `pgvector/pgvector:pg16` / 16.14 |
| Restic | 0.19.1 |
| Snapshot | `7bf7eefaaff5a58e17911b0051a6bed2b31ffa7c951a203f752ce24011ce7d38` |
| Backup UTC | `2026-08-09T03:57:38Z` |
| Restore verified UTC | `2026-08-09T03:57:46Z` |
| Disposable cleanup verified UTC | `2026-08-09T03:59:11Z` |
| Task 11 containers remaining | 0 |

## Results

- The backup script accepted only the clean synthetic checkout and bound its Git SHA into manifest v3.
- The exact local-test override was required. Backup JSON, manifest, and restore JSON all record `repositoryClass:"local-test"` and `productionEligible:false`.
- A migrated and seeded PostgreSQL 16 source had 66 public tables, 15 migration-ledger rows, and one synthetic restricted audit event.
- Audit metadata, migration metadata, and `pg_dump` shared one exported PostgreSQL snapshot.
- The restic snapshot contained exactly `polis.dump` and `manifest.json`; restic check and retention passed.
- The nominated snapshot restored to a distinct disposable database after logical and physical source/production/target identity checks.
- Backup JSON, manifest, and restore JSON match on repository class, production eligibility, Git SHA, PostgreSQL major, dump/TOC digests, table count, migration count/head, and audit count/head.
- The restored canonical audit chain verified; a modified record failed with `recomputed hash mismatch at record 1`.
- Backup and restore each emitted one nonsecret JSON object on stdout.
- The current ops contract suite passed 15/15 from the synthetic checkout.
- Cleanup removed both labeled database containers, the local restic repository, and the temporary password file.

## Cross-matched values

| Field | Value |
| --- | --- |
| `repositoryClass` | `local-test` |
| `productionEligible` | `false` |
| `postgresMajor` | `16` |
| `dumpSha256` | `7b0ff1f35eaff031f8a353c5a10605ab2a3baa8e2682e562d9798527b8eaebe0` |
| `restoreListSha256` | `89477c6b5df7826d548a440862e648520d03a142f63528848d7b6d84720fead2` |
| `publicTableCount` | `66` |
| `migrationCount` | `15` |
| `latestMigrationHash` | `3e3634b31c63efe7803ad17e84ac5009d74ab906123d84055b41da237949ae8f` |
| `auditEventCount` | `1` |
| `auditHeadHash` | `10c03462592eab763a43cf93b724f264c13cbaa9c9e45ffec54051986d621ad0` |

## Nonsecret evidence

| File | SHA-256 |
| --- | --- |
| `2026-08-09-task11-manifest-v3-local-recovery-drill/audit-tampered-result.json` | `7a019553bbfbe473d396dc40267c2f39487ca9f605ee3a84845e448619740dac` |
| `2026-08-09-task11-manifest-v3-local-recovery-drill/audit-valid-result.json` | `d94c8a5209e16806df34ef8c5e1d279ba94e50e0e31f3ab8d12d71e74f49d156` |
| `2026-08-09-task11-manifest-v3-local-recovery-drill/backup-check-retention.log` | `d18bb18564a79b1dc377f2a172780c4833c9bd9b693e72ddeccbbb9bff078d79` |
| `2026-08-09-task11-manifest-v3-local-recovery-drill/backup.json` | `43ae408369eb1bd04e8ebf84ad93e137f7957ad1cb5b87a89d8856df9a6edf78` |
| `2026-08-09-task11-manifest-v3-local-recovery-drill/context.json` | `f5a54a90aa9bb8ac095c929751ccd136d18e55ce86e49d482b866f75dab223e4` |
| `2026-08-09-task11-manifest-v3-local-recovery-drill/manifest.json` | `2b6aac33230a9c616d8dd1d378119283d811a27eab5ca7e5ce9557eccf6bf1d2` |
| `2026-08-09-task11-manifest-v3-local-recovery-drill/ops-test.log` | `0d17350f3a0c792af5d48842af25e1731191ee8c7bd6a67e44ba40faeb5b1c5c` |
| `2026-08-09-task11-manifest-v3-local-recovery-drill/restore-transcript.log` | `df2398f11f67e687b51ae6b39939f2f3789f9e48de4e4867c4ba555ef2fffed8` |
| `2026-08-09-task11-manifest-v3-local-recovery-drill/restore.json` | `cb6c4db1cb29a9076cce74e886863037bb0bfc487911499f57afabb8e1d89851` |
| `2026-08-09-task11-manifest-v3-local-recovery-drill/snapshot-commit.txt` | `6e8ec45bb8925b449983e1be16c1ff1fd934299aae21680c5128eb70286e9c07` |
| `2026-08-09-task11-manifest-v3-local-recovery-drill/snapshot-tree.txt` | `dd475e19015c490d89770ae8e93a8f1c11eec35a35ff2433cb3fd8fbdcf555e3` |
| `2026-08-09-task11-manifest-v3-local-recovery-drill/source-script-hashes.txt` | `7ad3643b867cb4a818820ae8afa73017ebcecc5a348a7c863fe739e5f2f53d7e` |

## Remaining production gate

Task 11 remains open. Production evidence must rerun manifest-v3 backup and exact-snapshot restore from an approved clean main-repository release commit against the partner source database and encrypted off-host restic repository. The raw backup JSON, manifest, and restore JSON must all say `repositoryClass:"off-host"` and `productionEligible:true`. A named human operator must record provider-side check/retention evidence and disposable-target destruction, then obtain named independent human reviewer approval.
