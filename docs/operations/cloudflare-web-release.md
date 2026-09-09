# Cloudflare web release

This runbook publishes the read-only Polis public release from `apps/web` to Cloudflare Workers. It does not deploy Polis services, create backend routes, or approve any private or state-changing workflow.

## Release boundary

`PUBLIC_RELEASE=1` enables the central route policy in `apps/web/src/lib/release-route-policy.mjs`. Only routes classified `safe` render. Backend-dependent, restricted, not-live, unknown, and non-GET/HEAD requests rewrite to `/release-boundary`; the browser keeps the original URL. The boundary response is non-cacheable and carries `X-Robots-Tag: noindex, noarchive`.

Local development with `PUBLIC_RELEASE` unset retains the full demonstrator route behavior.

## Prerequisites

- Bun `1.3.14`, matching the root `packageManager` field.
- A clean reviewed release commit.
- Wrangler OAuth authenticated to the intended Cloudflare account: `bunx wrangler whoami`.
- System Google Chrome or Chromium. Set `CHROME_PATH` when it is not in a standard macOS or Linux location. Playwright browser downloads are not used.
- The `intrface.eu` zone active in the same Cloudflare account.
- A named operator who can change the `polis.intrface.eu` DNS record and reverse the change.
- The current DNS record captured before cutover: record type, name, value, TTL, and proxy state.

Never print credentials or put account IDs, API tokens, or filled environment files in the repository.

## Install and validate locally

Run from the repository root:

```bash
bun install --frozen-lockfile
bun run --filter @polis/apps-web test
PUBLIC_RELEASE=1 PUBLIC_SITE_URL=https://polis.intrface.eu \
  bun run --filter @polis/apps-web typecheck
PUBLIC_RELEASE=1 PUBLIC_SITE_URL=https://polis.intrface.eu \
  bun run --filter @polis/apps-web build
bunx prettier --check \
  apps/web/package.json \
  apps/web/astro.config.mjs \
  apps/web/src/lib/release-route-policy.mjs \
  apps/web/src/middleware.ts \
  apps/web/test/release-policy.test.mjs \
  apps/web/scripts/release-smoke.mjs \
  apps/web/scripts/run-with-timeout.mjs \
  apps/web/wrangler.jsonc \
  apps/web/public/_headers \
  apps/web/public/robots.txt \
  docs/operations/cloudflare-web-release.md
```

Run browser QA through the hard timeout wrapper:

```bash
bun run --filter @polis/apps-web qa:release
```

The smoke script builds with an explicit loopback-only release exception, starts the built Worker with `wrangler dev --env preview --local`, launches system Chrome through `playwright-core`, and closes Chrome and Wrangler in `finally`. Wrangler runs in its own process group so the Bun wrapper cannot leave a descendant behind. Screenshots are written to `/tmp/polis-release-qa`.

Required QA results:

- `/` (Croatian) and `/en/` (English) render all five stages, and `/hr/` still returns 301 to `/`.
- Match and changed-byte verifier states both work without a network request.
- Backend-dependent, restricted, and not-live representatives render the boundary.
- No request reaches `/api/*`, `/version`, another origin, or a backend port.
- Desktop, mobile, and presenter layouts have no horizontal overflow.
- Visible controls are at least 44 by 44 CSS pixels.
- Keyboard navigation, focus, presenter keys, form-control exclusions, and reduced motion pass.

## Preview deploy

The preview environment has a different Worker name, `workers_dev: true`, and an explicit empty `routes` array. It cannot attach `polis.intrface.eu`.

```bash
bun run --filter @polis/apps-web deploy:preview
```

Wrangler prints the preview `workers.dev` URL. Record that URL and the version ID. They can also be inspected with:

```bash
bunx wrangler deployments list --config apps/web/wrangler.jsonc --env preview
bunx wrangler versions list --config apps/web/wrangler.jsonc --env preview
```

Run the exact verification against the printed URL:

```bash
export PREVIEW_URL='https://<printed-preview-host>'
curl --fail-with-body --silent --show-error --dump-header - --output /dev/null "$PREVIEW_URL/"
curl --fail-with-body --silent --show-error "$PREVIEW_URL/en/" >/dev/null
curl --fail-with-body --silent --show-error --dump-header - --output /dev/null "$PREVIEW_URL/complaints/example"
POLIS_RELEASE_BASE_URL="$PREVIEW_URL" bun run --filter @polis/apps-web smoke:release
```

Expected boundary header for the final command:

```text
X-Polis-Release-Boundary: restricted
```

Also verify the screenshots and browser-smoke output produced from the same reviewed source commit.

## Capture the current origin and DNS

The pre-release baseline for `https://polis.intrface.eu` is HTTP `503`. It is not a healthy rollback target, but it must be recorded exactly.

```bash
dig +short polis.intrface.eu CNAME
dig +short polis.intrface.eu A
dig +short polis.intrface.eu AAAA
curl --silent --show-error --dump-header - --output /dev/null https://polis.intrface.eu/
```

Record the Cloudflare dashboard values for the exact existing DNS record. DNS responses through the proxy do not reveal its configured origin value.

## Production cutover

Do not continue unless preview QA passed for the exact release source.

The production Wrangler configuration has `workers_dev: false` and one Worker Route, `polis.intrface.eu/*`, in the `intrface.eu` zone:

```bash
bun run --filter @polis/apps-web deploy:production
```

The existing proxied DNS record and certificate remain in place. Cloudflare runs the Worker before the unavailable origin, so the cutover does not delete or replace DNS. Do not point a CNAME at a `workers.dev` hostname and do not edit the unrelated local `cloudflared` configuration.

If Wrangler cannot attach the route, stop and inspect the reported zone or route conflict. Do not change DNS as a workaround.

## Production verification

```bash
export PRODUCTION_URL='https://polis.intrface.eu'

curl --fail-with-body --silent --show-error --dump-header - --output /dev/null "$PRODUCTION_URL/"
curl --fail-with-body --silent --show-error "$PRODUCTION_URL/en/" >/dev/null
curl --fail-with-body --silent --show-error --dump-header - --output /dev/null "$PRODUCTION_URL/partners"
curl --fail-with-body --silent --show-error --dump-header - --output /dev/null "$PRODUCTION_URL/complaints/example"
POLIS_RELEASE_BASE_URL="$PRODUCTION_URL" bun run --filter @polis/apps-web smoke:release
bunx wrangler deployments list --config apps/web/wrangler.jsonc --env=""
```

Verify:

- `/` (Croatian) and `/en/` (English) return `200` with the expected release content; `/hr/` returns `301` to `/`.
- `/partners` carries `X-Polis-Release-Boundary: backend-dependent`.
- `/complaints/example` carries `X-Polis-Release-Boundary: restricted`.
- HTML responses contain the configured CSP, HSTS, frame, MIME, referrer, permissions, and cache headers.
- `/_astro/*` and `/fonts/*` use immutable caching.
- A `CF-Ray` response header is present.
- No backend/API request appears in browser network logs.

Verify TLS hostname and dates:

```bash
openssl s_client \
  -connect polis.intrface.eu:443 \
  -servername polis.intrface.eu \
  </dev/null 2>/dev/null | \
openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

## Version rollback

List production deployments and identify the last known-good version:

```bash
bun run --filter @polis/apps-web rollback:list
bunx wrangler versions list --config apps/web/wrangler.jsonc --env=""
```

Rollback the Worker version without changing DNS:

```bash
bunx wrangler rollback \
  '<KNOWN_GOOD_VERSION_ID>' \
  --config apps/web/wrangler.jsonc \
  --env="" \
  --message 'Rollback Polis public web release'
```

Repeat all production verification commands after rollback.

## First-cutover reversal

There is no healthy pre-existing Worker version for the first release. If the Worker Route itself must be removed:

1. Cloudflare dashboard → Worker `polis-interface-web` → Settings → Domains & Routes.
2. Remove only the `polis.intrface.eu/*` Worker Route.
3. Leave the existing DNS record unchanged.
4. Leave Worker versions intact for diagnosis.
5. Repeat the DNS and HTTP baseline commands.

Removing the route restores the recorded `503` origin baseline. It does not recover a healthy service.

## CI boundary

CI continues to build and test the repository. It does not deploy this Worker. Preview and production deployment remain manual release gates until repository protection, named release ownership, and Cloudflare credential custody are approved.
