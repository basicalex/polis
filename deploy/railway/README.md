# Railway hosted test backend

This deploys a controlled hosted **TEST** instance with synthetic identities and data only. It is not a municipal release, partner deployment, production database, or authorization to accept real reports. The 2026-09-05 decision in `docs/pilot/minimal-backend-plan.md` permits bounded synthetic pre-partner engineering and leaves the municipal NO-GO unchanged.

Only `trace-service`, `platform-api`, and `citizen-identity-service` are deployed. `channel-gateway` and the other platform upstreams are out of scope.

## Image selection

Set `RAILWAY_DOCKERFILE_PATH` per Railway service:

| Railway service | Dockerfile |
| --- | --- |
| `trace-service` | `deploy/railway/trace-service.Dockerfile` |
| `platform-api` | `deploy/railway/platform-api.Dockerfile` |
| `citizen-identity-service` | `deploy/railway/citizen-identity-service.Dockerfile` |

`deploy/railway/Dockerfile` is the canonical manual-build form and requires `--build-arg SERVICE=<name>`. Railway selects a Dockerfile path but does not supply a different `SERVICE` build argument per service. Dockerfiles cannot inherit stages from another local Dockerfile, so the three selectable files repeat the canonical stages and set a safe default `ARG SERVICE`. `SERVICE` remains build-time only; the build writes a fixed service marker consumed by `start.sh`.

The build stage uses Bun 1.3.14, installs pinned OPA 1.17.1 for the required `@polis/policy-rules` build, builds the four shared packages in root order, then builds the selected service. The runtime is Node 22 Bookworm slim, runs as UID/GID 10001, contains production dependencies plus only the selected service and required shared build output, and starts `/app/deploy/railway/start.sh`. The OPA download is pinned to the Railway Linux AMD64 artifact and verified with the repository's existing SHA-256 pin.

## Runtime posture

Use `NODE_ENV=production` on all three services. `DEPLOYMENT_PROFILE=pilot` on trace and identity keeps the runtime validation active: `INTERNAL_API_TOKEN` is required, must not be a known development value, and must be at least 32 bytes, and `CORS_ALLOWED_ORIGINS` must be an explicit allowlist. platform-api runs `DEPLOYMENT_PROFILE=dev` with `PUBLIC_EDGE` unset, the same as the local pilot launcher: `PUBLIC_EDGE=true` installs the older public-read allowlist, which answers every `/api/trace/*` route with 405 (verified on the first hosted deploy, 2026-09-13). The trace routes stay safe to expose because platform-api rejects trusted identity headers from clients and verifies sessions against the identity service itself; the Cloudflare proxy adds a second layer. `NODE_ENV=production` disables the identity dev-token route even if it were accidentally requested and rejects loopback HTTP identity URLs.

Set `SERVICE_HOST=::`. Node reports `isIP('::') === 6`, so the runtime accepts it. `server.listen(port, '::')` was locally exercised on Node and accepted an IPv4 connection too; Linux's default IPv6 socket is dual-stack because the code does not request `ipv6Only`. Do not leave `SERVICE_HOST` unset: that would use Node's unspecified-host behavior rather than making the Railway IPv6 bind explicit.

## Variables

Use the Cloudflare preview Worker origin, without a trailing slash, for `<PREVIEW_ORIGIN>`, for example `https://polis-preview.<account>.workers.dev`. Use URL-encoded credentials in `DATABASE_URL`.

For a service, apply every row whose **Services** cell names it. `all` means all three services. Rows marked `omit` document local-launcher variables intentionally not sent to Railway.

| Variable | Services | Hosted value | Secret / rationale |
| --- | --- | --- | --- |
| `RAILWAY_DOCKERFILE_PATH` | each | Service-specific path from the image table | No |
| `PORT` | all | Pinned: trace `8980`, identity `8650`, platform `8080` | No; pinned so the `.railway.internal` URLs are stable |
| `NODE_ENV` | all | `production` | No |
| `DEPLOYMENT_PROFILE` | trace, identity | `pilot` | No; platform-api uses `dev` (see Runtime posture) |
| `SERVICE_HOST` | all | `::` | No; Railway private-network IPv6 bind |
| `DATABASE_URL` | all | `postgresql://postgres.<SUPABASE_REF>:<PASSWORD>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require` | **Secret**; pooler user is `postgres.<ref>` |
| `POSTGRES_SSL` | all | `true` | No; compatibility/operator signal only; URL controls the driver |
| `INTERNAL_API_TOKEN` | all | `<SAME_RANDOM_SECRET_AT_LEAST_32_BYTES>` | **Secret**; identical on all three services |
| `CORS_ALLOWED_ORIGINS` | all | `<PREVIEW_ORIGIN>` | No; runtime-enforced allowlist |
| `CORS_ORIGINS` | all | `<PREVIEW_ORIGIN>` | No; launcher parity, currently not read by these services |
| `IDENTITY_MODE` | identity | `stub` | No; no OIDC provider is configured |
| `IDENTITY_HMAC_KEY` | identity | `<RANDOM_SECRET_AT_LEAST_32_BYTES>` | **Secret** |
| `IDENTITY_DEV_TOKENS` | identity | `false` | No; no browser bypass |
| `IDENTITY_MAGIC_LINK_DELIVERY` | identity | `dev` | No; send is a no-op, while the request still returns the enumeration-safe `{ "sent": true }` response |
| `PUBLIC_APP_URL` | identity | `<PREVIEW_ORIGIN>` | No; ready for later SMTP links |
| `PUBLIC_SITE_URL` | identity, platform | `<PREVIEW_ORIGIN>` | No; launcher parity/public origin |
| `IDENTITY_ALLOW_HTTP_LOCALHOST` | identity | `false` | No; hosted URLs must use HTTPS |
| `OIDC_REDIRECT_URIS` | identity | `<PREVIEW_ORIGIN>/pilot/vrsar/login` | No; inactive while `IDENTITY_MODE=stub` |
| `IDENTITY_INTERNAL_URL` | platform | `http://citizen-identity-service.railway.internal:8650` | No; replace the port with that service's Railway `PORT` |
| `TRACE_INTERNAL_URL` | platform | `http://trace-service.railway.internal:8980` | No; replace the port with that service's Railway `PORT` |
| `TRACE_ENABLED` | platform | `true` | No |
| `TRACE_WEB_GATEWAY_ACTOR_ID` | platform | `pilot-web` | No; must be present in trace's gateway allowlist |
| `PUBLIC_EDGE_TRUSTED_KEY` | platform | `<RANDOM_SECRET_AT_LEAST_32_BYTES>` | **Secret**; must equal the Worker's `PILOT_EDGE_KEY` |
| `PUBLIC_EDGE_TRUST_XFF` | platform | `false` | No; the paired Worker headers are authoritative |
| `TRACE_OFFICIAL_CITIZEN_IDS` | trace | `trace-official-test` | No; the only staff role since the 2026-09-16 policy (`docs/pilot/public-text-policy.md`) |
| `TRACE_GATEWAY_ACTOR_IDS` | trace | `pilot-web` | No; local `pilot-gateway` is omitted because channel-gateway is not deployed |
| `TRACE_ATTENTION_PEPPER` | trace | `<RANDOM_SECRET_AT_LEAST_32_CHARACTERS>` | **Secret** |
| `TRACE_INTAKE_OPEN` | trace | `true` | No; set `false` to fail closed without redeploying code |
| `TRACE_RETENTION_INTERVAL_MINUTES` | trace | `60` | No; runs the retention sweeper hourly |
| `PILOT_CONFIG_PATH` | trace | `/app/config/pilots/vrsar-orsera.json` | No; launcher parity |
| `TRACE_PILOT_CONFIG_PATH` | trace | `/app/config/pilots/vrsar-orsera.json` | No; launcher parity |
| `PUBLIC_EDGE` | platform | unset | No; `true` blocks every trace route (see Runtime posture) |
| `PUBLIC_EDGE_RATE_LIMIT_PER_MIN` | platform | `60` | No |
| `INTERNAL_FETCH_TIMEOUT_MS` | platform | `5000` | No |
| `CHANNEL_ENABLED` | platform | `false` | No; channel-gateway is not deployed |

### Omitted launcher variables

| Variables | Why omitted |
| --- | --- |
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | `@polis/db` and trace pass `DATABASE_URL` directly to the `postgres` driver. These split variables are not read and would duplicate the database password. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_USE_TLS`, `SMTP_USE_SSL` | `IDENTITY_MAGIC_LINK_DELIVERY=dev`; SMTP configuration is read only in `smtp` mode. When SMTP exists, set `PUBLIC_APP_URL=<PREVIEW_ORIGIN>`, switch the mode, and supply these values; user/password must be supplied together. |
| `OIDC_ISSUER`, `OIDC_AUTHORIZATION_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | `IDENTITY_MODE=stub`. They become required only in `oidc` mode; `OIDC_CLIENT_SECRET` is secret. |
| `CHANNEL_INTERNAL_URL` | `CHANNEL_ENABLED=false` and channel-gateway is not deployed. |
| `PILOT_API_BASE` | Web/Worker input, not read by these three services. Configure the Cloudflare preview deployment separately with the platform public domain. |
| `PUBLIC_RELEASE` | Web build input, not read by these services. This remains a hosted test, not a public release. |
| `PILOT_RUNTIME_DIR` | Local runtime ownership path; no Railway equivalent. |
| `PILOT_TEST_DATABASE_MARKER` | Only the loopback pilot scripts require it. The hosted scripts instead require an explicit `--yes`. No service requires it. |
| `TRACE_AI_INTAKE_URL` | Optional trace mirror; no AI intake service is deployed. |
| `TRACE_AI_COMPLIANCE_URL`, `TRACE_HOLD_TERMS` | Optional. Unset keeps the local filing-time compliance pass active without an AI gateway or extra hold terms. |
| second staff allowlist variable of the review era | Policy D2 (`docs/pilot/public-text-policy.md`) removed the second staff role, its trace allowlist variable and its `*-test` identity. Delete that variable from the `trace-service` Railway variables if it is still set; trace ignores it. |
| `AUDIT_INTERNAL_URL` | Optional identity audit sink; audit-service is not deployed. Identity logs a safe `audit_unavailable` warning if an audit emission is attempted. |
| `GRAPH_INTERNAL_URL`, `PROOF_INTERNAL_URL`, `POLIS_INTERNAL_URL`, `AI_INTERNAL_URL`, `CONTRIBUTION_INTERNAL_URL`, `REWARDS_INTERNAL_URL`, `VAULT_INTERNAL_URL`, `VC_ISSUER_INTERNAL_URL`, `SIGNING_INTERNAL_URL`, `COMPLAINTS_INTERNAL_URL` | Their services are not deployed in this three-service test. See the platform readiness limitation below. |
| `TRACE_SERVICE_PORT`, `PLATFORM_API_PORT` | Railway supplies `PORT`, which takes precedence. |

`PILOT_CONFIG_PATH` and `TRACE_PILOT_CONFIG_PATH` are documented and set to the image path requested by the deployment contract. Current trace code loads the same bundled file relative to `dist/config.js`; it does not read either variable.

## PostgreSQL TLS

The connection URL is authoritative. `postgres` 3.4.9 parses `sslmode=require` into its `ssl` option and performs TLS negotiation. The services do not read `POSTGRES_SSL`; setting it to `true` records the deployment intent but cannot enable TLS by itself. In this driver, `sslmode=require` encrypts the connection but sets `rejectUnauthorized=false`. Use `sslmode=verify-full` only after the orchestrator confirms the Supabase pooler's certificate chain and hostname work with Node's trust store.

No migration under `packages/db/migrations` or `services/trace-service/migrations` contains `CREATE EXTENSION`. The current schema uses built-in PostgreSQL types/functions only. The local runbook's `vector` prerequisite is not exercised by these migrations, so no Supabase extension needs enabling for this deployment.

## Migrate and seed

Run from the repository root on a trusted laptop. Load `DATABASE_URL` from a secret manager; do not paste it into the repository or shared logs. Both hosted scripts print only host, port, database, and user, never the password.

```sh
bun run --filter @polis/db build
DATABASE_URL="$DATABASE_URL" node deploy/railway/migrate-core.mjs --yes
DATABASE_URL="$DATABASE_URL" \
  TRACE_INTERNAL_URL="$TRACE_INTERNAL_URL" \
  INTERNAL_API_TOKEN="$INTERNAL_API_TOKEN" \
  TRACE_GATEWAY_ACTOR_ID=pilot-web \
  node deploy/railway/seed-identities.mjs --yes
```

The existing `scripts/pilot/seed-identities.mjs` cannot target Supabase: it requires an owned runtime, an explicit local marker, loopback, a `*_test` database, bundled local PostgreSQL binaries, and hard-codes `polis_trace_test`. The Railway seed script preserves its three synthetic rows and idempotent update behavior. `trace-official-test` receives `staff` identity level; its trace role comes from `TRACE_OFFICIAL_CITIZEN_IDS`. The fourth staff row an earlier seed created for the removed review role is harmless but unused; the demo seed no longer touches it.

## Demo cases and staff passcode

`seed-demo-cases.mjs` runs from a trusted laptop against the hosted test instance. It gives `official@vrsar.example.test` the configured passcode, signs that synthetic official in through platform-api, files nine synthetic Vrsar cases through the public filing route, and advances them with the official's session to a demo spread that covers every public state of the 2026-09-16 six-state model:

| # | public state | text | notes |
| --- | --- | --- | --- |
| 1 | `received` | public | plain open case |
| 2 | `received` | public, label `form-letter` | same text as case 1; the filing-time compliance pass sees the duplicate hash and sets the soft label |
| 3 | `received` | held, `personal-data` | text carries a synthetic phone number; the compliance pass holds it and the shell shows the reason |
| 4 | `assigned` | public | office accepted responsibility |
| 5 | `answered` | public | commitment signed with name, title and a due date 14 days ahead |
| 6 | `answered` | public | commitment whose due date is 5 days in the past |
| 7 | `resolved` | public | completion reported with evidence; two followers and one not-fixed mark |
| 8 | `disputed` | public | completion reported, then disputed by the filer with public text using the reopen key |
| 9 | `closed` | public | closed as a duplicate with a public reason |

The commitment and the completion report are signed as `Ivana Testić`, a synthetic name. No real official's name is a test identity.

Export `DATABASE_URL`, `IDENTITY_HMAC_KEY`, `DEMO_STAFF_PASSCODE`, and `PLATFORM_API_BASE`, then run:

```sh
node deploy/railway/seed-demo-cases.mjs --yes
```

Platform-api allows five public filings per ten minutes per IP. A fresh nine-case batch therefore waits inside the script for about ten minutes before filing cases six to nine, and the script prints a rate-limit stage line while it waits.

`PUBLIC_WEB_BASE` is optional and only changes the case URLs the script prints; set it to `http://127.0.0.1:4321` when running against the local runtime. The script never reads a local environment file. It records the filed case numbers, record IDs, the attention keys and the reopen key of the disputed case outside the repository at `${XDG_STATE_HOME:-~/.local/state}/polis/seed-demo-cases.json`, mode `0600`. When that marker exists, the script reuses the recorded cases instead of filing another batch and safely resumes any incomplete lifecycle work. A marker written by the review-era seed (version 1) is rejected; pass `--reset` with `--yes` to start a new nine-case batch. Existing hosted cases are never deleted by the script.

The passcode grants staff access to the synthetic official on the hosted test instance only. Keep it in the secret manager and never place it in the repository or shared logs.

The Cloudflare Worker secrets are `PILOT_DEMO_STAFF_PASSCODE` and `PILOT_EDGE_KEY`. `PILOT_EDGE_KEY` must equal platform-api's `PUBLIC_EDGE_TRUSTED_KEY`. Their values live in `~/.config/polis/polis-test.env`; never write them to Wrangler config or this repository. From `apps/web`, install both for preview with `bunx wrangler secret put <NAME> --env preview`.

## Reset and reseed for migration 0004

Trace migration `0004_public_text` must not run over review-era rows (the four removed statuses and the events of the removed staff role). Event rows are append-only and hash-chained, so the synthetic database is reset and reseeded rather than migrated in place. The hosted test instance holds synthetic data only, so a reset loses nothing that matters.

Run from the repository root on a trusted laptop with `DATABASE_URL` loaded from the secret manager. `psql` must reach the Supabase pooler; use the same URL.

1. Stop writes: set `TRACE_INTAKE_OPEN=false` on `trace-service` and redeploy, or pause the service.
2. Drop the trace tables, the two trace functions and the trace migration ledger. Core tables (`citizens`, sessions) stay.

   ```sh
   psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --command "
     DROP TABLE IF EXISTS
       trace_reopen_attempts, trace_ai_proposals, trace_case_attention,
       trace_case_messages, trace_case_shells, trace_case_counters,
       trace_public_snapshots, trace_attachments, trace_command_idempotency,
       trace_events, trace_record_participants, trace_report_private,
       trace_records, trace_schema_migrations
     CASCADE;
     DROP FUNCTION IF EXISTS trace_reject_event_mutation();
     DROP FUNCTION IF EXISTS trace_migration_canonical_json(jsonb);"
   ```

   The list is every `CREATE TABLE` and `CREATE FUNCTION` in `services/trace-service/migrations/0001` to `0004` at commit `da060ead` plus the ledger table `trace_schema_migrations` that `src/migrations.ts` owns. `CASCADE` removes the event triggers with their table. Re-check the list against the migration files if trace has gained a migration since.

3. Remove the review-era identity and variable. Delete the second staff allowlist variable from the `trace-service` Railway variables (see the omitted-variables table). Optionally delete the unused fourth staff row:

   ```sh
   psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --command "
     DELETE FROM citizens
     WHERE email LIKE '%@vrsar.example.test'
       AND id NOT IN ('trace-resident-test', 'trace-resident-other-test', 'trace-official-test');"
   ```

4. Deploy the three services from a commit at or after `da060ead`. `start.sh` on `trace-service` runs `dist/migrate.js`, which now applies `0001` to `0004` to the empty trace schema.

   ```sh
   railway up --service trace-service --detach
   railway up --service citizen-identity-service --detach
   railway up --service platform-api --detach
   ```

5. Reseed identities and set `TRACE_INTAKE_OPEN=true` again.

   ```sh
   bun run --filter @polis/db build
   DATABASE_URL="$DATABASE_URL" TRACE_INTERNAL_URL="$TRACE_INTERNAL_URL" \
     INTERNAL_API_TOKEN="$INTERNAL_API_TOKEN" TRACE_GATEWAY_ACTOR_ID=pilot-web \
     node deploy/railway/seed-identities.mjs --yes
   ```

6. Discard the old demo marker and file the new spread.

   ```sh
   DATABASE_URL="$DATABASE_URL" IDENTITY_HMAC_KEY="$IDENTITY_HMAC_KEY" \
     DEMO_STAFF_PASSCODE="$DEMO_STAFF_PASSCODE" PLATFORM_API_BASE="https://<PLATFORM_DOMAIN>" \
     node deploy/railway/seed-demo-cases.mjs --yes --reset
   ```

7. Check the ledger: `GET https://<PLATFORM_DOMAIN>/api/trace/public/cases?limit=100` lists nine cases with states `received` (3, one held, one labelled), `assigned`, `answered` (2), `resolved`, `disputed`, `closed`.

Migration/deploy order:

1. Run core migrations with `migrate-core.mjs`.
2. Deploy `trace-service`; `start.sh` runs `services/trace-service/dist/migrate.js` before `dist/index.js`.
3. Run `seed-identities.mjs` with a reachable `TRACE_INTERNAL_URL`; it writes the identity rows, then idempotently upserts the official profile through trace.
4. Deploy `citizen-identity-service`; `start.sh` idempotently runs `@polis/db` core migrations before `dist/index.js`.
5. Deploy `platform-api`; `start.sh` only starts it. Its existing `main()` also runs core migrations and fails startup on migration error in `pilot` profile.

## Railway CLI sequence

Run from the repository root after linking the Railway project. Keep the three secrets in local environment variables populated from a secret manager.

```sh
railway variable set --service trace-service \
  RAILWAY_DOCKERFILE_PATH=deploy/railway/trace-service.Dockerfile \
  NODE_ENV=production DEPLOYMENT_PROFILE=pilot SERVICE_HOST=:: PORT=8980 \
  DATABASE_URL="$DATABASE_URL" POSTGRES_SSL=true \
  INTERNAL_API_TOKEN="$INTERNAL_API_TOKEN" \
  CORS_ALLOWED_ORIGINS='<PREVIEW_ORIGIN>' CORS_ORIGINS='<PREVIEW_ORIGIN>' \
  TRACE_OFFICIAL_CITIZEN_IDS=trace-official-test \
  TRACE_GATEWAY_ACTOR_IDS=pilot-web \
  TRACE_ATTENTION_PEPPER="$TRACE_ATTENTION_PEPPER" TRACE_INTAKE_OPEN=true \
  TRACE_RETENTION_INTERVAL_MINUTES=60 \
  PILOT_CONFIG_PATH=/app/config/pilots/vrsar-orsera.json \
  TRACE_PILOT_CONFIG_PATH=/app/config/pilots/vrsar-orsera.json

railway variable set --service citizen-identity-service \
  RAILWAY_DOCKERFILE_PATH=deploy/railway/citizen-identity-service.Dockerfile \
  NODE_ENV=production DEPLOYMENT_PROFILE=pilot SERVICE_HOST=:: PORT=8650 \
  DATABASE_URL="$DATABASE_URL" POSTGRES_SSL=true \
  INTERNAL_API_TOKEN="$INTERNAL_API_TOKEN" \
  CORS_ALLOWED_ORIGINS='<PREVIEW_ORIGIN>' CORS_ORIGINS='<PREVIEW_ORIGIN>' \
  IDENTITY_MODE=stub IDENTITY_HMAC_KEY="$IDENTITY_HMAC_KEY" \
  IDENTITY_DEV_TOKENS=false IDENTITY_MAGIC_LINK_DELIVERY=dev \
  PUBLIC_APP_URL='<PREVIEW_ORIGIN>' PUBLIC_SITE_URL='<PREVIEW_ORIGIN>' \
  IDENTITY_ALLOW_HTTP_LOCALHOST=false \
  OIDC_REDIRECT_URIS='<PREVIEW_ORIGIN>/pilot/vrsar/login'

railway variable set --service platform-api \
  RAILWAY_DOCKERFILE_PATH=deploy/railway/platform-api.Dockerfile \
  NODE_ENV=production DEPLOYMENT_PROFILE=dev SERVICE_HOST=:: PORT=8080 \
  DATABASE_URL="$DATABASE_URL" POSTGRES_SSL=true \
  INTERNAL_API_TOKEN="$INTERNAL_API_TOKEN" \
  CORS_ALLOWED_ORIGINS='<PREVIEW_ORIGIN>' CORS_ORIGINS='<PREVIEW_ORIGIN>' \
  PUBLIC_SITE_URL='<PREVIEW_ORIGIN>' \
  IDENTITY_INTERNAL_URL='http://citizen-identity-service.railway.internal:8650' \
  TRACE_INTERNAL_URL='http://trace-service.railway.internal:8980' \
  TRACE_ENABLED=true TRACE_WEB_GATEWAY_ACTOR_ID=pilot-web \
  PUBLIC_EDGE_TRUSTED_KEY="$PUBLIC_EDGE_TRUSTED_KEY" PUBLIC_EDGE_TRUST_XFF=false \
  CHANNEL_ENABLED=false INTERNAL_FETCH_TIMEOUT_MS=5000 \
  PUBLIC_EDGE_RATE_LIMIT_PER_MIN=60

railway up --service trace-service --detach
railway up --service citizen-identity-service --detach
railway up --service platform-api --detach
railway domain --service platform-api
```

Do not create public domains for trace or identity. They are private-network services behind platform-api.

## Smoke checks

All three services expose `GET /healthz` and `GET /readyz`.

- `trace-service`: both query PostgreSQL; expect HTTP 200 after trace migrations.
- `citizen-identity-service`: both are runtime operational endpoints; expect HTTP 200 after startup.
- `platform-api`: `/healthz` should return HTTP 200. In current source `/readyz` checks governance-graph, audit, proof, and Polis upstreams. Those services are intentionally absent, so `/readyz` returns HTTP 503 even though this three-service image is running. Configure Railway's platform health check to `/healthz`; do not misreport `/readyz` as healthy until those dependencies are deployed or the platform contract changes.

From outside Railway, smoke only the platform public domain:

```sh
curl --fail https://<PLATFORM_DOMAIN>/healthz
```

Use Railway's private-network shell or logs to check trace and identity `/healthz` and `/readyz` at their `.railway.internal:<port>` URLs. No Docker binary is available on the preparation machine, so image assembly, Linux AMD64 OPA execution, non-root filesystem access, and Railway private-network routing must be confirmed by the orchestrator's first Railway builds.
