// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  RELEASE_KINDS,
  RELEASE_ROUTE_POLICY,
  classifyReleasePath,
  isReleaseAssetPath,
  matchReleasePattern,
  matchingReleasePolicies,
  normalizeReleasePath,
} from '../src/lib/release-route-policy.mjs';
import { createReleaseMiddleware } from '../src/middleware.ts';

const pagesRoot = new URL('../src/pages/', import.meta.url);
const pageExtensions = /\.(astro|md|mdx|ts)$/;

const expectedCurrentByKind = {
  safe: [
    '/',
    '/en',
    '/presentation',
    '/hr/presentation',
    '/en/presentation',
    '/demo',
    '/demo/citizen',
    '/demo/official',
    '/demo/review',
    '/demo/record',
    '/demo/embed',
    '/docs',
    '/methodology',
    '/privacy',
    '/security',
    '/source',
    '/transparency',
  ],
  'backend-dependent': [
    '/assistant',
    '/audit',
    '/verify',
    '/claims/:id',
    '/commitments/:id',
    '/deliberate',
    '/governance/:jurisdiction',
    '/governance/:jurisdiction/:domain',
    '/governance/:jurisdiction/institutions/:institutionId',
    '/governance/:jurisdiction/processes/:processId',
    '/governance/:jurisdiction/roles/:roleId',
    '/issues',
    '/issues/:issueId',
    '/mandate-holders',
    '/mandate-holders/:id',
    '/partners',
    '/pilot/results',
    '/pilot/vrsar/receipts',
    '/pilot/vrsar/receipts/:receiptId',
    '/proofs',
    '/proofs/:id',
    '/rewards',
  ],
  restricted: [
    '/complaints',
    '/complaints/:id',
    '/contribute/evidence',
    '/contribute/graph-edit',
    '/contributions/:id',
    '/contributors/:id',
    '/login',
    '/login/callback',
    '/pilot/vrsar',
    '/pilot/vrsar/login',
    '/pilot/vrsar/file',
    '/pilot/vrsar/cases',
    '/pilot/vrsar/cases/:caseId',
    '/pilot/vrsar/staff',
    '/pilot/vrsar/review',
    '/pilot/vrsar/api/*path',
  ],
  'not-live': ['/contribute/maps', '/contribute/review'],
};

async function pageFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return pageFiles(new URL(`${entry.name}/`, directory), relative);
      return pageExtensions.test(entry.name) ? [relative] : [];
    }),
  );
  return nested.flat();
}

function fileToRoutePattern(file) {
  const withoutExtension = file.replace(pageExtensions, '');
  const segments = withoutExtension.split('/').filter((segment) => segment !== 'index');
  const routeSegments = segments.map((segment) => {
    const rest = segment.match(/^\[\.\.\.(.+)]$/);
    if (rest) return `*${rest[1]}`;
    const dynamic = segment.match(/^\[(.+)]$/);
    return dynamic ? `:${dynamic[1]}` : segment;
  });
  return routeSegments.length === 0 ? '/' : `/${routeSegments.join('/')}`;
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function requestContext(path, method = 'GET') {
  const url = new URL(path, 'https://polis.intrface.eu');
  return {
    url,
    request: new Request(url, { method }),
  };
}

test('release policy gives every current Astro page exactly one disposition', async () => {
  const discovered = sorted((await pageFiles(pagesRoot)).map(fileToRoutePattern));
  const requiredCurrent = sorted(Object.values(expectedCurrentByKind).flat());

  for (const route of requiredCurrent) assert.ok(discovered.includes(route), `missing page ${route}`);
  for (const route of discovered) {
    const matches = matchingReleasePolicies(route);
    assert.equal(matches.length, 1, `${route}: ${matches.map((entry) => entry.id).join(', ')}`);
  }
});

test('release policy fixes the exact current route disposition by category', () => {
  for (const kind of RELEASE_KINDS) {
    const actual = RELEASE_ROUTE_POLICY.filter(
      (entry) => entry.inventory === 'current' && entry.kind === kind,
    ).map((entry) => entry.pattern);
    assert.deepEqual(sorted(actual), sorted(expectedCurrentByKind[kind]), kind);
  }
});

test('release policy identifiers and patterns are unique', () => {
  assert.equal(new Set(RELEASE_ROUTE_POLICY.map((entry) => entry.id)).size, RELEASE_ROUTE_POLICY.length);
  assert.equal(
    new Set(RELEASE_ROUTE_POLICY.map((entry) => entry.pattern)).size,
    RELEASE_ROUTE_POLICY.length,
  );
});

test('release policy matches representative dynamic routes without overlap', () => {
  const cases = [
    ['/', 'safe'],
    ['/hr/', 'safe'],
    ['/en/', 'safe'],
    ['/presentation', 'safe'],
    ['/hr/presentation', 'safe'],
    ['/en/presentation', 'safe'],
    ['/demo', 'safe'],
    ['/demo/citizen', 'safe'],
    ['/demo/unknown-surface', 'not-live'],
    ['/release-boundary', 'safe'],
    ['/governance/jur-croatia-local', 'backend-dependent'],
    ['/governance/jur-croatia-local/institutions/inst-complaints-office', 'backend-dependent'],
    ['/claims/claim-1', 'backend-dependent'],
    ['/complaints/case-private', 'restricted'],
    ['/pilot/vrsar', 'restricted'],
    ['/pilot/vrsar/cases/case-private', 'restricted'],
    ['/pilot/vrsar/api/config', 'restricted'],
    ['/pilot/vrsar/api/records/case-private/attachments/file-private', 'restricted'],
    ['/pilot/vrsar/receipts', 'backend-dependent'],
    ['/pilot/vrsar/receipts/receipt-public', 'backend-dependent'],
    ['/contributors/person-private', 'restricted'],
    ['/contribute/review', 'not-live'],
    ['/unknown-release-route', 'not-live'],
  ];

  for (const [path, kind] of cases) {
    assert.equal(classifyReleasePath(path).kind, kind, path);
    assert.ok(matchingReleasePolicies(path).length <= 1, path);
  }
});

test('normalization, matching, and asset bypass reject ambiguous paths', () => {
  assert.equal(normalizeReleasePath('/privacy/'), '/privacy');
  assert.equal(normalizeReleasePath('/privacy//'), null);
  assert.equal(normalizeReleasePath('privacy'), null);
  assert.equal(matchReleasePattern('/issues/:issueId', '/issues/issue-1'), true);
  assert.equal(matchReleasePattern('/issues/:issueId', '/issues'), false);
  assert.equal(matchReleasePattern('/pilot/vrsar/api/*path', '/pilot/vrsar/api/config'), true);
  assert.equal(matchReleasePattern('/pilot/vrsar/api/*path', '/pilot/vrsar/api/records/id/review'), true);
  assert.equal(matchReleasePattern('/pilot/vrsar/api/*path', '/pilot/vrsar/api'), false);
  assert.equal(isReleaseAssetPath('/_astro/app.hash.js'), true);
  assert.equal(isReleaseAssetPath('/fonts/BarlowCondensed-Bold.ttf'), true);
  assert.equal(isReleaseAssetPath('/robots.txt'), true);
  assert.equal(isReleaseAssetPath('/login'), false);
});

test('release middleware rewrites a blocked route without rendering it', async () => {
  const middleware = createReleaseMiddleware(true);
  const context = requestContext('/complaints/case-private');
  let nextCalled = false;
  let rewrittenRequest;
  context.rewrite = async (request) => {
    rewrittenRequest = request;
    return new Response('release boundary');
  };

  const response = await middleware(context, async () => {
    nextCalled = true;
    throw new Error('blocked route rendered');
  });

  assert.equal(nextCalled, false);
  assert.ok(rewrittenRequest instanceof Request);
  const rewrittenUrl = new URL(rewrittenRequest.url);
  assert.equal(rewrittenUrl.pathname, '/release-boundary');
  assert.equal(rewrittenUrl.searchParams.get('kind'), 'restricted');
  assert.equal(rewrittenUrl.searchParams.get('path'), '/complaints/case-private');
  assert.equal(response.headers.get('x-polis-release-boundary'), 'restricted');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, noarchive');
});

test('release middleware boundary guard does not rewrite itself', async () => {
  const middleware = createReleaseMiddleware(true);
  const context = requestContext('/release-boundary?kind=restricted&path=%2Flogin');
  context.rewrite = async () => {
    throw new Error('boundary loop');
  };
  let nextCalls = 0;

  const response = await middleware(context, async () => {
    nextCalls += 1;
    return new Response('release boundary');
  });

  assert.equal(nextCalls, 1);
  assert.equal(await response.text(), 'release boundary');
});

test('local middleware mode preserves blocked demonstrator routes', async () => {
  const middleware = createReleaseMiddleware(false);
  const context = requestContext('/complaints/case-private');
  context.rewrite = async () => {
    throw new Error('local mode rewrote a route');
  };
  let nextCalls = 0;

  await middleware(context, async () => {
    nextCalls += 1;
    return new Response('local route');
  });

  assert.equal(nextCalls, 1);
});

test('preview Wrangler environment cannot attach the production Worker route', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.scripts['deploy:preview'], /^CLOUDFLARE_ENV=preview /);
  assert.deepEqual(config.routes, [{ pattern: 'polis.intrface.eu/*', zone_name: 'intrface.eu' }]);
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.env.preview.routes, []);
  assert.equal(config.env.preview.workers_dev, true);
  assert.equal(config.env.preview.name, 'polis-interface-web-preview');
  assert.equal(config.main, '@astrojs/cloudflare/entrypoints/server');
  assert.equal(config.env.preview.main, '@astrojs/cloudflare/entrypoints/server');
});
