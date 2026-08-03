import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));

async function source(path) {
  return readFile(new URL(path, `file://${root}/`), 'utf8');
}

test('runtime images use explicit non-root users with owned application copies', async () => {
  const [node, python, aiGateway] = await Promise.all([
    source('infra/docker/node.Dockerfile'),
    source('infra/docker/python.Dockerfile'),
    source('infra/docker/ai-gateway.Dockerfile'),
  ]);

  assert.match(node, /COPY --from=build --chown=bun:bun \/app \/app/);
  assert.match(node, /USER bun/);

  for (const dockerfile of [python, aiGateway]) {
    assert.match(dockerfile, /groupadd --system polis/);
    assert.match(dockerfile, /useradd --system --gid polis/);
    assert.match(dockerfile, /COPY --from=build --chown=polis:polis \/app \/app/);
    assert.match(dockerfile, /USER polis/);
  }

  assert.match(
    aiGateway,
    /COPY --chown=polis:polis packages\/policy-rules\/ai\/ai\.rego \/app\/policy\/ai\.rego/,
  );
});

test('Bun service image is pinned, installs, builds, and runs with Bun', async () => {
  const dockerfile = await source('infra/docker/node.Dockerfile');

  assert.match(dockerfile, /^FROM oven\/bun:1\.3\.14-debian AS build$/m);
  assert.match(dockerfile, /^FROM oven\/bun:1\.3\.14-debian AS runner$/m);
  assert.doesNotMatch(dockerfile, /^FROM node:/m);
  assert.doesNotMatch(dockerfile, /\b(?:p[n]pm|npm|yarn|corepack)\b/);

  assert.match(dockerfile, /^ARG SERVICE=platform-api$/m);
  assert.match(dockerfile, /^ENV NODE_ENV=production SERVICE=\$\{SERVICE\}$/m);
  assert.match(dockerfile, /bun install --frozen-lockfile/);
  assert.match(
    dockerfile,
    /bun run --filter @polis\/domain build\s+\\\n\s+&& bun run --filter @polis\/db build\s+\\\n\s+&& bun run --filter @polis\/service-runtime build\s+ARG SERVICE=platform-api\s+RUN bun run --filter @polis\/\$\{SERVICE\} build/,
  );
  assert.match(
    dockerfile,
    /CMD \["sh", "-c", "exec bun services\/\$\{SERVICE\}\/dist\/index\.js"\]/,
  );
  assert.match(dockerfile, /^ENV DEBIAN_FRONTEND=noninteractive$/m);
  assert.match(dockerfile, /apt-get -o Acquire::Retries=5 update/);
  assert.match(
    dockerfile,
    /apt-get -o Acquire::Retries=5 install -y --no-install-recommends curl ca-certificates/,
  );
  assert.match(dockerfile, /rm -rf \/var\/lib\/apt\/lists\/\*/);
});

test('Node service workspace dependencies stay inside the Docker build closure', async () => {
  const allowed = new Set(['@polis/db', '@polis/domain', '@polis/service-runtime']);
  const entries = await readdir(new URL('services/', `file://${root}/`), { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let manifest;
    try {
      manifest = JSON.parse(await source(`services/${entry.name}/package.json`));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    const workspaceDependencies = [
      ...Object.entries(manifest.dependencies ?? {}),
      ...Object.entries(manifest.devDependencies ?? {}),
      ...Object.entries(manifest.optionalDependencies ?? {}),
      ...Object.entries(manifest.peerDependencies ?? {}),
    ]
      .filter(([, version]) => String(version).startsWith('workspace:'))
      .map(([name]) => name);
    const unsupported = workspaceDependencies.filter((name) => !allowed.has(name)).sort();
    assert.deepEqual(
      unsupported,
      [],
      `${manifest.name} has workspace dependencies missing from the Docker build closure`,
    );
  }
});

test('AI gateway requires and verifies the OPA download checksum', async () => {
  const [dockerfile, compose] = await Promise.all([
    source('infra/docker/ai-gateway.Dockerfile'),
    source('infra/compose/docker-compose.yml'),
  ]);

  assert.match(dockerfile, /^ARG OPA_SHA256$/m);
  assert.match(dockerfile, /test -n "\$OPA_SHA256"/);
  assert.match(dockerfile, /curl -fsSL -o \/usr\/local\/bin\/opa/);
  assert.match(dockerfile, /sha256sum -c -/);
  assert.doesNotMatch(dockerfile, /curl[^\n]*\s-k(?:\s|$)/);
  assert.match(
    compose,
    /OPA_SHA256: \$\{OPA_SHA256:-3d4bb88482958d990351ec5d2f7558509992776bc473bc1b78d86d76cb993ca3\}/,
  );
});

test('pilot proxy is HTTPS-only, bounded, and exposes only the BFF', async () => {
  const caddyfile = await source('infra/proxy/Caddyfile');

  assert.match(caddyfile, /email \{\$PILOT_ACME_EMAIL\}/);
  assert.match(caddyfile, /^\{\$PILOT_HOSTNAME\} \{$/m);
  assert.match(caddyfile, /max_size 1MB/);
  assert.match(caddyfile, /reverse_proxy platform-api:8080/);
  assert.doesNotMatch(caddyfile, /reverse_proxy\s+(?!platform-api:8080)/);
  assert.match(caddyfile, /dial_timeout 5s/);
  assert.match(caddyfile, /read_timeout 30s/);
  assert.match(caddyfile, /write_timeout 30s/);
  assert.match(caddyfile, /response_header_timeout 30s/);

  for (const header of [
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Content-Security-Policy',
    'Referrer-Policy',
    'Permissions-Policy',
  ]) {
    assert.match(caddyfile, new RegExp(header));
  }

  assert.match(caddyfile, /separately hosted Astro applications/);
  assert.doesNotMatch(caddyfile, /tls_insecure_skip_verify/);
});
