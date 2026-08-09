# Isolated public-read pilot runbook

## Scope and non-claims

This profile exposes one API edge over Caddy and seeded synthetic/public data only. It runs PostgreSQL, the seed/migration job, governance graph, public audit, proof, Polis bridge, platform API, and Caddy. `PUBLIC_EDGE=true` denies write, login, and participation routes. Stateless proof verification remains available.

This is not a writable pilot, a real-person-data pilot, a production identity system, or a private-document system. It does not run identity, vault, contribution, complaints, AI, signing, Paperless, Keycloak, TSA, rewards, VC issuance, payment, or private-document services. Seeded proof and Polis records do not establish that external signing, timestamping, or upstream Polis providers are live. Do not add provider services to this profile.

TLS is not active merely because Compose is running. It becomes active only after public DNS resolves the configured hostname to this host, inbound TCP 80/443 is reachable, and Caddy obtains a valid certificate. Record the certificate check before opening the pilot.

## Required owners and evidence

Name people, not teams, before deployment:

| Duty | Named owner | Backup owner | Evidence location |
| --- | --- | --- | --- |
| Deployment and release |  |  |  |
| Security and incident command |  |  |  |
| Backup operation |  |  |  |
| Restore drill |  |  |  |
| DNS and TLS |  |  |  |
| Pilot exit and data disposition |  |  |  |

Launch requires a dated successful restore report naming the snapshot ID, source Git SHA, dump digest, disposable target, table count, audit-event count, operator, and reviewer.

## External prerequisites

Use a dedicated Linux host with:

- supported Docker Engine and Compose v2, with operator access restricted to named administrators;
- repository checkout at the reviewed Git SHA and enough local space to build the first-party Node images;
- public DNS control for one hostname and an accountable ACME email address;
- inbound TCP 80/443 and UDP 443 allowed; no database or application port allowed at the host firewall;
- outbound DNS and HTTPS for image pulls and ACME;
- host `node`, `git`, PostgreSQL client tools (`pg_dump`, `pg_restore`, `psql`), `restic`, and `timeout` for backups;
- an encrypted off-host restic repository and an operator-readable, owner-only restic password file outside the repository;
- monitoring for HTTPS availability, response status/latency, container restarts, disk use, certificate expiry, and backup age;
- synchronized UTC time and a reviewed incident contact channel.

Do not deploy if the current checkout, DNS target, firewall rules, backup repository, owners, or restore evidence is unknown.

## Prepare secrets and deployment input

From the repository root:

```sh
cp .env.pilot.example .env.pilot
chmod 600 .env.pilot
openssl rand -hex 32
openssl rand -hex 48
```

Put the first value in `POSTGRES_PASSWORD` and the second in `INTERNAL_API_TOKEN`. The token is 48 random bytes and exceeds the 32-byte minimum. Choose explicit non-default `POSTGRES_USER` and `POSTGRES_DB` values. Set `DATABASE_URL` to the same values with host `postgres` and port `5432`; percent-encode any URL-sensitive credential characters. Hex-generated secrets avoid that ambiguity.

Fill every other required field:

- `PILOT_HOSTNAME` and `PILOT_ACME_EMAIL`;
- an explicit `CORS_ALLOWED_ORIGINS` comma-separated allowlist with no `*`;
- `PILOT_IMAGE_REPOSITORY` and immutable `PILOT_IMAGE_TAG`;
- exact `GIT_SHA`, UTC `BUILD_TIME`, and public `SOURCE_URL` for `/version`;
- off-host `RESTIC_REPOSITORY`, external `RESTIC_PASSWORD_FILE`, retention values, and restore-drill placeholders.

A filled `.env.pilot` is secret. Keep it mode `0600`, outside backups and support bundles, and never commit it. Review without printing values:

```sh
stat -c '%a %U:%G %n' .env.pilot
awk -F= '/^[A-Z0-9_]+=$/{print "EMPTY " $1}' .env.pilot
```

The second command must print nothing before preflight.

## DNS, firewall, and fail-closed preflight

Confirm the reviewed commit and tool versions, then validate DNS from an external resolver:

```sh
git rev-parse HEAD
docker version
docker compose version
dig +short A "$(sed -n 's/^PILOT_HOSTNAME=//p' .env.pilot)" @1.1.1.1
dig +short AAAA "$(sed -n 's/^PILOT_HOSTNAME=//p' .env.pilot)" @1.1.1.1
```

At least one returned address must be an intended public address for this host. Remove stale A/AAAA records rather than relying on routing failure. Independently inspect the host and cloud firewall: only Caddy may receive public 80/443; PostgreSQL and ports 8080, 8100, 8200, 8600, and 8700 must not be published.

Resolve and inspect the exact standalone model:

```sh
docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml config
docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml config --services
```

The service list must be exactly `postgres`, `seed`, `governance-graph-api`, `audit-service`, `proof-service`, `polis-bridge-service`, `platform-api`, and `caddy`. A missing required variable must make `config` fail. Stop if any other service or published port appears.

## Build and deploy

Build the reviewed source, start the profile, and inspect all states:

```sh
docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml build --pull
docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml up --detach
docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml ps --all
docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml logs --no-color seed
```

`seed` runs `node packages/db/dist/seed.js`. It runs migrations and idempotent upserts once, then must exit with code 0. API services wait for that successful exit. A non-zero seed exit blocks deployment; inspect its logs and fix the cause instead of bypassing the dependency. To re-run the idempotent job after reviewing the same seed set:

```sh
docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml run --rm seed
```

Do not use the development Compose file, an override, or a broader service list.

## Readiness and public-edge checks

Check each internal `/readyz` from its own container:

```sh
for target in \
  governance-graph-api:8100 \
  audit-service:8600 \
  proof-service:8700 \
  polis-bridge-service:8200 \
  platform-api:8080
do
  service=${target%:*}
  port=${target#*:}
  docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml \
    exec -T "$service" curl -fsS "http://127.0.0.1:${port}/readyz"
done
```

Then verify the public TLS boundary and a seeded read:

```sh
set -a
. ./.env.pilot
set +a
curl --fail --silent --show-error "https://${PILOT_HOSTNAME}/readyz"
curl --fail --silent --show-error "https://${PILOT_HOSTNAME}/api/v1/jurisdictions"
curl --fail --silent --show-error "https://${PILOT_HOSTNAME}/version"
openssl s_client -connect "${PILOT_HOSTNAME}:443" -servername "$PILOT_HOSTNAME" </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

Do not use `curl -k`. Failure means TLS is not ready. Record DNS output, certificate subject/issuer/dates, image tag, Git SHA, seed exit, container health, and read response in deployment evidence.

Prove that the edge denies representative write, login, and participation routes:

```sh
expect_405() {
  path=$1
  body=$2
  code=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    -H 'content-type: application/json' --data "$body" "https://${PILOT_HOSTNAME}${path}")
  test "$code" = 405 || { printf 'expected 405, got %s for %s\n' "$code" "$path" >&2; return 1; }
}
expect_405 /api/v1/identity/magic-link '{"email":"nobody@example.invalid"}'
expect_405 /api/v1/contribute/evidence '{}'
expect_405 /api/v1/vault/documents '{}'
expect_405 /api/v1/mandate-holders/example/commitments '{}'
```

These checks do not mean every POST is denied: stateless proof verification is an intentional public operation. They prove the named state-changing/authentication paths are blocked by `PUBLIC_EDGE=true`.

## Backup

Run at least daily and before any image, schema, secret, or host change. Run from a clean immutable checkout: the backup script rejects tracked, staged, or untracked working-tree changes before it connects to PostgreSQL, so the recorded Git SHA binds the tools and migrations used. The production gate is an encrypted off-host restic repository plus reviewed operator evidence. Local restic repositories, local-tool tests, or `bun run ops:clean-db-drill` prove tooling only; they never satisfy the production off-host backup gate. A `local-test` repository with `productionEligible:false` never satisfies Task 11; Task 11 production evidence requires `repositoryClass:"off-host"` and `productionEligible:true`.

The backend network has no host port, so derive the current PostgreSQL container address without publishing one. Run in a subshell from the repository root:

```sh
(
  set -a
  . ./.env.pilot
  set +a
  POSTGRES_ID=$(docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml ps -q postgres)
  POSTGRES_IP=$(docker inspect --format '{{with index .NetworkSettings.Networks "polis-pilot_backend"}}{{.IPAddress}}{{end}}' "$POSTGRES_ID")
  test -n "$POSTGRES_IP"
  HOST_DATABASE_URL=$(docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml config --format json \
    | POSTGRES_IP="$POSTGRES_IP" node -e '
        const fs = require("node:fs");
        const config = JSON.parse(fs.readFileSync(0, "utf8"));
        const url = new URL(config.services["platform-api"].environment.DATABASE_URL);
        url.hostname = process.env.POSTGRES_IP;
        process.stdout.write(url.toString());
      ')
  DEPLOYMENT_PROFILE=pilot DATABASE_URL="$HOST_DATABASE_URL" BACKUP_ENABLED=true \
    scripts/ops/backup.sh
)
```

The command must print one nonsecret JSON object with `ok:true`, `snapshotId`, `createdAt`, `gitSha`, `postgresMajor`, `dumpSha256`, `restoreListSha256`, `repositoryClass`, `productionEligible`, `publicTableCount`, `migrationCount`, `latestMigrationHash`, `auditEventCount`, and `auditHeadHash`. Save the raw JSON as evidence; do not paste secrets or connection strings into the report. `pg_dump` must have the same major version as the source PostgreSQL server; the script rejects a mismatch before creating a snapshot.

`RESTIC_PASSWORD_FILE` must resolve, before restic use, to a readable, nonempty, regular file whose permission bits are owner-only. `0400`, `0600`, and other owner-only modes are accepted; any group or other bit is a failed backup precheck. Do not record the resolved path, mode, password content, or other secret detail in evidence or error notes.

The effective `RESTIC_REPOSITORY` is classified as exactly `off-host` or `local-test`. Production/off-host classification rejects loopback or local endpoints, `rclone:`, explicit HTTP REST transports (`rest:http://...`), explicit HTTP S3 endpoints (`s3:http://...`), and otherwise ineligible repositories. These may run only as `local-test` when `OPS_ALLOW_LOCAL_RESTIC_REPOSITORY_FOR_TESTS=true`; without that exact override they must fail before backup with a transport/off-host error. Supported secure remote schemes remain `off-host` even when the local-test override is set.

The backup archive must contain exactly two named artifacts:

- `polis.dump`
- `manifest.json`

`manifest.json` must be manifest `formatVersion` 3 and bind the backup to `createdAt`, `gitSha`, `postgresMajor`, `dumpSha256`, `restoreListSha256`, `publicTableCount`, `migrationCount`, `latestMigrationHash`, `auditEventCount`, `auditHeadHash`, `repositoryClass`, and `productionEligible`. The source audit chain must be non-empty and valid, using the canonical verification order `created_at,id`; an empty chain is a failed backup, not a bypass. The migration ledger is `drizzle.__drizzle_migrations`; `migrationCount` must be positive, and `latestMigrationHash` must be a lowercase 64-character hex SHA-256. `productionEligible` is true if and only if `repositoryClass` is `off-host`; `local-test` must record `productionEligible:false`.

The script creates a custom-format dump, writes the v3 manifest, validates the source audit table, verifies the migration ledger, sends only `polis.dump` and `manifest.json` to the classified repository, runs `restic check`, and applies retention. Alert if no verified off-host backup completes within 24 hours. Never back up `.env.pilot`, database URLs, restic credentials, the restic password file, or other secret material with this job. Historical evidence captured before manifest v3 remains historical v2 evidence. The dated local manifest-v3 drill in `docs/operations/evidence/2026-08-09-task11-manifest-v3-local-recovery-drill.md` proves only `local-test` mechanics with `productionEligible:false`; it does not satisfy Task 11 or support an off-host claim.

## Disposable restore drill

Run after initial deployment, monthly, and before relying on a backup for recovery. The drill must use the exact nominated snapshot ID from reviewed backup evidence. Do not use `latest`. Provision a separate PostgreSQL database whose name contains `restore_drill` or `disposable`; it must not be the pilot source or any production database. Export the nominated snapshot ID and the three distinct URLs, then run:

```sh
set -a
. ./.env.pilot
set +a
DEPLOYMENT_PROFILE=pilot \
RESTORE_TARGET_IS_DISPOSABLE=true \
RESTORE_DRILL_CONFIRMATION=DESTROY_ONLY_POLIS_DISPOSABLE_RESTORE_TARGET \
DATABASE_URL="$RESTORE_TARGET_DATABASE_URL" \
SOURCE_DATABASE_URL="$DATABASE_URL" \
PRODUCTION_DATABASE_URL="$PRODUCTION_DATABASE_URL" \
RESTIC_SNAPSHOT="$RESTIC_SNAPSHOT" \
RESTIC_REPOSITORY="$RESTIC_REPOSITORY" \
RESTIC_PASSWORD_FILE="$RESTIC_PASSWORD_FILE" \
  scripts/ops/restore-verify.sh
```

The script must reject `latest`, identical source/target identities, production targets, system databases, targets without the disposable naming marker, multiple-host URIs, and URI query parameters that can override the effective host, port, database, or libpq service. It also compares PostgreSQL system identifiers plus database names for the target, source, and production URLs before `pg_restore`, so DNS aliases cannot bypass the string-level guard; failure to read any physical identity is a failed drill. Before any destructive restore, it must validate the exact snapshot metadata, manifest v3 fields, repository classification fields, dump digest, and restore-list/TOC digest. Stop if any manifest value is missing, if the archive contains anything other than `polis.dump` and `manifest.json`, if the current repository class does not exactly match the manifest `repositoryClass`, if `productionEligible` is not exactly true for `off-host` and false for `local-test`, or if a digest does not match.

Restore applies the same repository and password-file invariants as backup: the current effective repository class must be recomputed before restore, the resolved `RESTIC_PASSWORD_FILE` target must be checked before restic use, and evidence/errors must not disclose password-file path, mode, or content.

Before restore, require `pg_restore`, the target PostgreSQL server, and the manifest `postgresMajor` to use the same major version. After restore, compare the restored public table count, migration count, latest migration hash, audit-event count, and audit head hash to the manifest and backup JSON. The restored audit chain must be non-empty and valid in canonical `created_at,id` order. The restored migration ledger must be `drizzle.__drizzle_migrations`, with positive `migrationCount` and a lowercase 64-character hex `latestMigrationHash`.

The restore command must print one nonsecret JSON object with `ok`, `snapshotId`, `createdAt`, `verifiedAt`, `gitSha`, `postgresMajor`, `dumpSha256`, `restoreListSha256`, `repositoryClass`, `productionEligible`, `disposableDbName`, `publicTableCount`, `migrationCount`, `latestMigrationHash`, `auditEventCount`, and `auditHeadHash`. Save the raw JSON and operator transcript as evidence without secrets. Destroy only the disposable target after a reviewer checks the backup JSON, restore JSON, manifest v3 fields, repository class, production eligibility, digests, table/migration/audit comparisons, and records approval. Never point this command at the live pilot.

`bun run ops:clean-db-drill` is useful local proof that the clean-database seed/migration tooling still works. It is not backup proof, restore proof, or off-host evidence. Local restic/tool tests and any `local-test` backup or restore with `productionEligible:false` never satisfy Task 11 or the production off-host gate.

## Monitoring and thresholds

Page the deployment owner and security owner when any of these occurs:

- external `/readyz` or a seeded read fails twice within 60 seconds;
- any API container is unhealthy for 60 seconds or restarts unexpectedly;
- HTTP 5xx exceeds 1% of requests or five responses in five minutes, whichever occurs first;
- public API p95 latency exceeds one second for ten minutes;
- database or Docker volume use reaches 75% (warning) or 85% (page);
- host memory or inode exhaustion exceeds 85% for five minutes;
- the latest verified off-host backup is older than 24 hours or a monthly restore drill is overdue;
- the public certificate has fewer than 21 days remaining or renewal fails;
- any 2xx/3xx response is observed for a denied write/login/participation probe.

Retain Caddy access/error logs and Docker events under the operator's approved retention policy without recording secrets or real-person data.

## Incident response and rotation

First remove ingress while preserving evidence:

```sh
docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml stop caddy
docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml ps --all
docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml logs --no-color --since 2h > polis-pilot-incident.log
chmod 600 polis-pilot-incident.log
```

Also remove public 80/443 at the host/cloud firewall when compromise is suspected. Record UTC time, reporter, image/Git SHA, container states, DNS, certificate, affected routes, and backup snapshot. Do not put `.env.pilot` or raw credentials in the incident log.

For internal-token rotation, generate a new 48-byte hex value, replace only `INTERNAL_API_TOKEN` in `.env.pilot`, validate config, and atomically recreate the Node jobs/services before restoring ingress:

```sh
docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml config >/dev/null
docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml up --detach --force-recreate seed governance-graph-api audit-service proof-service polis-bridge-service platform-api
docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml up --detach caddy
```

For database-password rotation, keep ingress stopped. As the current database owner, alter the live role password first; then update both `POSTGRES_PASSWORD` and the password in `DATABASE_URL`, validate config, and recreate PostgreSQL plus all Node services. Have a second operator review the role, database, and URL before execution. Never assume changing the container environment changes an existing PostgreSQL role.

If credentials or data may have escaped, keep ingress closed, rotate ACME/account credentials through the provider, revoke exposed off-host backup credentials, preserve the affected snapshot, and notify the named security owner. This profile must be torn down rather than expanded to handle affected real-person or private data.

## Rollback constraints

Rollback means returning to a reviewed immutable image tag that is compatible with the current schema. Do not run an older image against a newer schema without an explicit compatibility decision. Do not edit or reverse migrations in the live database. Do not use `docker compose down --volumes` as rollback. A backup restore is a recovery operation: validate the nominated snapshot in a disposable target first, obtain incident-owner approval, keep ingress closed, and document any data-loss window.

Stop the profile without deleting durable volumes:

```sh
docker compose --project-name polis-pilot --env-file .env.pilot -f infra/compose/docker-compose.pilot.yml down
```

Re-deploy the approved image tag with the normal config/build/up/readiness/denial sequence. Restore ingress only after the security owner accepts the evidence.

## Pilot exit

1. Stop Caddy and remove public DNS/firewall ingress.
2. Run a final backup and a successful disposable restore drill; record the snapshot, digest, operator, reviewer, and retention deadline.
3. Export only approved public/synthetic results and operational evidence.
4. Run Compose `down` without `--volumes`.
5. Apply the charter's retention and disposition decision to PostgreSQL/Caddy volumes. Delete volumes only with written approval from the pilot-exit and backup owners.
6. Revoke restic, registry, ACME, and internal/database credentials; securely delete `.env.pilot` and external password files after evidence retention is settled.
7. Publish the exit status and remaining non-claims. Do not repurpose this profile for writable workflows or real-person data.
