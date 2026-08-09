# Recovery drill report template

Do not record credentials, connection strings, restic passwords, `.env.pilot` values, private data, or raw dump contents in this report. Attach only nonsecret JSON, manifest text, tool versions, command transcripts with secrets redacted before capture, and reviewer notes.

Local restic tests and local tool drills can never satisfy Task 11 or the production off-host backup/restore gate. `bun run ops:clean-db-drill` is local tool proof only; it is not backup proof, restore proof, or off-host evidence. A `local-test` repository with `productionEligible:false` never satisfies Task 11; production evidence requires `repositoryClass:"off-host"` and `productionEligible:true`.

This template records manifest v3/current evidence only. Historical drill evidence captured before manifest v3 remains historical v2 evidence. A separate dated local manifest-v3 drill may prove `local-test` mechanics, but it cannot satisfy Task 11 or support an off-host claim.

## Drill identity

| Field | Value |
| --- | --- |
| Report ID |  |
| Repository class |  |
| Repository locator |  |
| Production eligible |  |
| Deployment profile | pilot |
| Source Git SHA |  |
| Source worktree clean |  |
| Snapshot ID nominated for restore |  |
| Backup created UTC |  |
| Restore verified UTC |  |
| Operator |  |
| Reviewer |  |
| Evidence location |  |

Record the current repository classification from the backup JSON, restore JSON, and manifest. It must be exactly `off-host` or `local-test`; the three values must match exactly.

## Tool versions

Record exact versions used by the operator.

| Tool | Version output |
| --- | --- |
| git |  |
| docker |  |
| docker compose |  |
| node |  |
| bun |  |
| pg_dump |  |
| pg_restore |  |
| psql |  |
| restic |  |

## Source-contract evidence

Attach the raw nonsecret backup JSON and manifest v3 `manifest.json`. Do not summarize instead of attaching raw JSON.

### Required backup JSON fields

- `ok`
- `snapshotId`
- `createdAt`
- `gitSha`
- `postgresMajor`
- `dumpSha256`
- `restoreListSha256`
- `publicTableCount`
- `migrationCount`
- `latestMigrationHash`
- `auditEventCount`
- `auditHeadHash`
- `repositoryClass`
- `productionEligible`

### Required manifest v3 fields

- `formatVersion` = `3`
- `createdAt`
- `gitSha`
- `postgresMajor`
- `dumpSha256`
- `restoreListSha256`
- `publicTableCount`
- `migrationCount`
- `latestMigrationHash`
- `auditEventCount`
- `auditHeadHash`
- `repositoryClass`
- `productionEligible`

### Source checks

| Check | Evidence / value | Reviewer initials |
| --- | --- | --- |
| Backup ran from a clean immutable checkout |  |  |
| Archive contains exactly `polis.dump` and `manifest.json` |  |  |
| `manifest.json` is formatVersion 3 |  |  |
| Backup JSON and manifest have matching `repositoryClass` |  |  |
| Backup JSON and manifest have matching `productionEligible` |  |  |
| `productionEligible` is true iff `repositoryClass` is `off-host` |  |  |
| Production evidence uses `repositoryClass:"off-host"` and `productionEligible:true` |  |  |
| Any `local-test` evidence is marked `productionEligible:false` and rejected for Task 11 |  |  |
| Explicit HTTP REST/S3 transports (`rest:http://...`, `s3:http://...`) were rejected for production/off-host classification |  |  |
| `RESTIC_PASSWORD_FILE` resolved target was readable, nonempty, regular, and owner-only before restic use; `0400`, `0600`, and other owner-only modes accepted, group/other bits rejected |  |  |
| `pg_dump` major matches source PostgreSQL and `postgresMajor` |  |  |
| Source audit chain is non-empty |  |  |
| Source audit chain verifies in `created_at,id` order |  |  |
| `drizzle.__drizzle_migrations` count is positive |  |  |
| Latest migration hash is lowercase 64-hex SHA-256 |  |  |
| Dump SHA-256 matches manifest |  |  |
| Restore-list/TOC SHA-256 matches manifest |  |  |
| Secrets excluded from evidence and backup artifacts |  |  |
| Off-host restic repository check passed for `repositoryClass:"off-host"` |  |  |
| Retention/check step completed |  |  |

### Raw attachments

| Attachment | Location | SHA-256 |
| --- | --- | --- |
| Backup JSON |  |  |
| `manifest.json` |  |  |
| Restic snapshot metadata |  |  |
| Restic check transcript |  |  |

## Local-tool clean DB drill evidence

This section proves only the local clean-database seed/migration tooling. It does not satisfy backup proof, restore proof, Task 11, or the production off-host gate.

| Field | Value |
| --- | --- |
| Command | `bun run ops:clean-db-drill` |
| Started UTC |  |
| Finished UTC |  |
| Disposable container/database name |  |
| Tool transcript location |  |
| Journal migration count |  |
| Live migration count |  |
| Latest migration SHA-256 |  |
| Required workflow tables verified |  |
| First seed public table count |  |
| Second seed public table count |  |
| Counts unchanged after second seed |  |
| Cleanup verified owner label before removal |  |

## Production off-host reviewed backup/restore drill evidence

This section is the only section that can satisfy the production backup/restore gate, and only when the current manifest, backup JSON, and restore JSON all say `repositoryClass:"off-host"` and `productionEligible:true`.

### Required restore JSON fields

Attach the raw nonsecret restore JSON. It must include:

- `ok`
- `snapshotId`
- `createdAt`
- `verifiedAt`
- `gitSha`
- `postgresMajor`
- `dumpSha256`
- `restoreListSha256`
- `disposableDbName`
- `publicTableCount`
- `migrationCount`
- `latestMigrationHash`
- `auditEventCount`
- `auditHeadHash`
- `repositoryClass`
- `productionEligible`

### Restore checks

| Check | Evidence / value | Reviewer initials |
| --- | --- | --- |
| Restore used the exact nominated snapshot ID, not `latest` |  |  |
| Source, production, and restore target logical and physical database identities were distinct |  |  |
| Restore target name contained `restore_drill` or `disposable` |  |  |
| Guards accepted only a disposable target |  |  |
| `pg_restore`, target PostgreSQL, and manifest `postgresMajor` matched |  |  |
| Snapshot metadata validated before destructive restore |  |  |
| Manifest v3 fields validated before destructive restore |  |  |
| Restore recomputed current repository class before destructive restore |  |  |
| Restore JSON, backup JSON, and manifest have matching `repositoryClass` |  |  |
| Restore JSON, backup JSON, and manifest have matching `productionEligible` |  |  |
| `productionEligible` is true iff `repositoryClass` is `off-host` |  |  |
| Production evidence uses `repositoryClass:"off-host"` and `productionEligible:true` |  |  |
| Any `local-test` evidence is marked `productionEligible:false` and rejected for Task 11 |  |  |
| Explicit HTTP REST/S3 transports (`rest:http://...`, `s3:http://...`) were rejected for production/off-host classification |  |  |
| Restore checked the resolved `RESTIC_PASSWORD_FILE` target before restic use without disclosing path, mode, or content |  |  |
| Dump digest checked before destructive restore |  |  |
| Restore-list/TOC digest checked before destructive restore |  |  |
| Restored public table count matched manifest/backup JSON |  |  |
| Restored migration count matched manifest/backup JSON |  |  |
| Restored latest migration hash matched manifest/backup JSON |  |  |
| Restored audit event count matched manifest/backup JSON |  |  |
| Restored audit head hash matched manifest/backup JSON |  |  |
| Restored audit chain was non-empty and valid in `created_at,id` order |  |  |
| Restore JSON contained no secrets |  |  |
| Operator transcript contained no secrets |  |  |

### Raw attachments

| Attachment | Location | SHA-256 |
| --- | --- | --- |
| Restore JSON |  |  |
| Restore command transcript |  |  |
| Reviewer comparison notes |  |  |
| Target-destruction evidence |  |  |

## Target destruction

Destroy the disposable target only after reviewer approval. Never destroy the source database.

| Field | Value |
| --- | --- |
| Reviewer approval UTC |  |
| Disposable target destroyed UTC |  |
| Destruction command transcript location |  |
| Operator |  |
| Reviewer |  |

## Sign-off

| Role | Name | Decision | UTC timestamp | Signature / approval locator |
| --- | --- | --- | --- | --- |
| Operator |  | GO / NO-GO |  |  |
| Reviewer |  | GO / NO-GO |  |  |
| Backup owner |  | GO / NO-GO |  |  |
| Security owner |  | GO / NO-GO |  |  |

## GO / NO-GO rule

GO only if all are true:

1. Backup evidence came from the encrypted off-host restic repository.
2. The archive contained exactly `polis.dump` and `manifest.json`.
3. Backup JSON, manifest v3, restore JSON, and raw attachments are present and nonsecret.
4. Backup JSON, manifest, and restore JSON have matching `repositoryClass:"off-host"` and `productionEligible:true`.
5. `productionEligible` is true if and only if `repositoryClass` is `off-host`; `local-test` with `productionEligible:false` is NO-GO for Task 11.
6. Explicit HTTP REST/S3 transports (`rest:http://...`, `s3:http://...`) were rejected for production/off-host classification.
7. `RESTIC_PASSWORD_FILE` resolved target was checked before restic use and was readable, nonempty, regular, and owner-only; `0400`, `0600`, and other owner-only modes are accepted, group/other bits are rejected.
8. Source and restored public table count, migration count/head, and audit count/head match.
9. Source and restored audit chains are non-empty and valid in canonical `created_at,id` order.
10. Migration count is positive and latest migration hash is lowercase 64-hex SHA-256.
11. A reviewer approved the evidence before the disposable target was destroyed.
12. The disposable target destruction UTC timestamp is recorded.

NO-GO if any required field, raw attachment, digest comparison, count/head comparison, off-host proof, reviewer sign-off, destruction timestamp, repository-class check, production-eligibility check, or password-file invariant is missing or failed. NO-GO if the evidence is only local restic/tool output, only `bun run ops:clean-db-drill` output, historical v2 evidence, or any `local-test` evidence with `productionEligible:false`.
