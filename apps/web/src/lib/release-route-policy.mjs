// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

export const RELEASE_KINDS = Object.freeze([
  'safe',
  'backend-dependent',
  'restricted',
  'not-live',
]);

const policy = [
  { id: 'home', pattern: '/', kind: 'safe', inventory: 'current' },
  { id: 'place', pattern: '/:place', kind: 'safe', inventory: 'current' },
  { id: 'place-en', pattern: '/en/:place', kind: 'safe', inventory: 'current' },
  { id: 'home-hr', pattern: '/hr', kind: 'safe', inventory: 'planned' },
  { id: 'home-en', pattern: '/en', kind: 'safe', inventory: 'current' },
  { id: 'presentation', pattern: '/presentation', kind: 'safe', inventory: 'current' },
  { id: 'presentation-hr', pattern: '/hr/presentation', kind: 'safe', inventory: 'current' },
  { id: 'presentation-en', pattern: '/en/presentation', kind: 'safe', inventory: 'current' },
  { id: 'demo-hub', pattern: '/demo', kind: 'safe', inventory: 'current' },
  { id: 'demo-citizen', pattern: '/demo/citizen', kind: 'safe', inventory: 'current' },
  { id: 'demo-official', pattern: '/demo/official', kind: 'safe', inventory: 'current' },
  { id: 'demo-review', pattern: '/demo/review', kind: 'safe', inventory: 'current' },
  { id: 'demo-record', pattern: '/demo/record', kind: 'safe', inventory: 'current' },
  { id: 'demo-embed', pattern: '/demo/embed', kind: 'safe', inventory: 'current' },
  { id: 'release-boundary', pattern: '/release-boundary', kind: 'safe', inventory: 'planned' },
  { id: 'docs', pattern: '/docs', kind: 'safe', inventory: 'current' },
  { id: 'methodology', pattern: '/methodology', kind: 'safe', inventory: 'current' },
  { id: 'privacy', pattern: '/privacy', kind: 'safe', inventory: 'current' },
  { id: 'security', pattern: '/security', kind: 'safe', inventory: 'current' },
  { id: 'source', pattern: '/source', kind: 'safe', inventory: 'current' },
  { id: 'transparency', pattern: '/transparency', kind: 'safe', inventory: 'current' },
  { id: 'verify', pattern: '/verify', kind: 'backend-dependent', inventory: 'current' },

  { id: 'assistant', pattern: '/assistant', kind: 'backend-dependent', inventory: 'current' },
  { id: 'audit', pattern: '/audit', kind: 'backend-dependent', inventory: 'current' },
  { id: 'claim-detail', pattern: '/claims/:id', kind: 'backend-dependent', inventory: 'current' },
  { id: 'commitment-detail', pattern: '/commitments/:id', kind: 'backend-dependent', inventory: 'current' },
  { id: 'deliberate', pattern: '/deliberate', kind: 'backend-dependent', inventory: 'current' },
  { id: 'governance', pattern: '/governance/:jurisdiction', kind: 'backend-dependent', inventory: 'current' },
  { id: 'governance-domain', pattern: '/governance/:jurisdiction/:domain', kind: 'backend-dependent', inventory: 'current' },
  {
    id: 'governance-institution',
    pattern: '/governance/:jurisdiction/institutions/:institutionId',
    kind: 'backend-dependent',
    inventory: 'current',
  },
  {
    id: 'governance-process',
    pattern: '/governance/:jurisdiction/processes/:processId',
    kind: 'backend-dependent',
    inventory: 'current',
  },
  {
    id: 'governance-role',
    pattern: '/governance/:jurisdiction/roles/:roleId',
    kind: 'backend-dependent',
    inventory: 'current',
  },
  { id: 'issues', pattern: '/issues', kind: 'backend-dependent', inventory: 'current' },
  { id: 'issue-detail', pattern: '/issues/:issueId', kind: 'backend-dependent', inventory: 'current' },
  { id: 'mandate-holders', pattern: '/mandate-holders', kind: 'backend-dependent', inventory: 'current' },
  {
    id: 'mandate-holder-detail',
    pattern: '/mandate-holders/:id',
    kind: 'backend-dependent',
    inventory: 'current',
  },
  { id: 'partners', pattern: '/partners', kind: 'backend-dependent', inventory: 'current' },
  { id: 'pilot-results', pattern: '/pilot/results', kind: 'backend-dependent', inventory: 'current' },
  { id: 'pilot-vrsar-receipts', pattern: '/pilot/vrsar/receipts', kind: 'backend-dependent', inventory: 'current' },
  { id: 'pilot-vrsar-receipt-detail', pattern: '/pilot/vrsar/receipts/:receiptId', kind: 'backend-dependent', inventory: 'current' },
  { id: 'pilot-vrsar-public-case', pattern: '/pilot/vrsar/zapis/:caseNumber', kind: 'backend-dependent', inventory: 'current' },
  { id: 'place-record', pattern: '/:place/zapis', kind: 'backend-dependent', inventory: 'planned' },
  {
    id: 'place-record-case',
    pattern: '/:place/zapis/:caseNumber',
    kind: 'backend-dependent',
    inventory: 'planned',
  },
  { id: 'place-report', pattern: '/:place/prijava', kind: 'backend-dependent', inventory: 'planned' },
  {
    id: 'place-report-case',
    pattern: '/:place/prijava/:caseNumber',
    kind: 'backend-dependent',
    inventory: 'planned',
  },
  { id: 'proofs', pattern: '/proofs', kind: 'backend-dependent', inventory: 'current' },
  { id: 'proof-detail', pattern: '/proofs/:id', kind: 'backend-dependent', inventory: 'current' },
  { id: 'rewards', pattern: '/rewards', kind: 'backend-dependent', inventory: 'current' },

  { id: 'complaints', pattern: '/complaints', kind: 'restricted', inventory: 'current' },
  { id: 'complaint-detail', pattern: '/complaints/:id', kind: 'restricted', inventory: 'current' },
  { id: 'contribute-evidence', pattern: '/contribute/evidence', kind: 'restricted', inventory: 'current' },
  { id: 'contribute-graph-edit', pattern: '/contribute/graph-edit', kind: 'restricted', inventory: 'current' },
  { id: 'contribution-detail', pattern: '/contributions/:id', kind: 'restricted', inventory: 'current' },
  { id: 'contributor-detail', pattern: '/contributors/:id', kind: 'restricted', inventory: 'current' },
  { id: 'login', pattern: '/login', kind: 'restricted', inventory: 'current' },
  { id: 'login-callback', pattern: '/login/callback', kind: 'restricted', inventory: 'current' },
  { id: 'pilot-vrsar', pattern: '/pilot/vrsar', kind: 'restricted', inventory: 'current' },
  { id: 'pilot-vrsar-login', pattern: '/pilot/vrsar/login', kind: 'restricted', inventory: 'current' },
  { id: 'pilot-vrsar-file', pattern: '/pilot/vrsar/file', kind: 'restricted', inventory: 'current' },
  { id: 'pilot-vrsar-cases', pattern: '/pilot/vrsar/cases', kind: 'restricted', inventory: 'current' },
  { id: 'pilot-vrsar-case-detail', pattern: '/pilot/vrsar/cases/:caseId', kind: 'restricted', inventory: 'current' },
  { id: 'pilot-vrsar-staff', pattern: '/pilot/vrsar/staff', kind: 'restricted', inventory: 'current' },
  { id: 'pilot-vrsar-review', pattern: '/pilot/vrsar/review', kind: 'restricted', inventory: 'current' },
  { id: 'pilot-vrsar-api', pattern: '/pilot/vrsar/api/*path', kind: 'restricted', inventory: 'current' },

  { id: 'contribute-maps', pattern: '/contribute/maps', kind: 'not-live', inventory: 'current' },
  { id: 'contribute-review', pattern: '/contribute/review', kind: 'not-live', inventory: 'current' },
];

export const RELEASE_ROUTE_POLICY = Object.freeze(policy.map((entry) => Object.freeze(entry)));

export function normalizeReleasePath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return null;
  if (pathname.includes('?') || pathname.includes('#') || pathname.includes('//')) return null;
  if (pathname === '/') return pathname;
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

export function matchReleasePattern(pattern, pathname) {
  const normalizedPattern = normalizeReleasePath(pattern);
  const normalizedPath = normalizeReleasePath(pathname);
  if (!normalizedPattern || !normalizedPath) return false;
  if (normalizedPattern === '/') return normalizedPath === '/';

  const patternSegments = normalizedPattern.slice(1).split('/');
  const pathSegments = normalizedPath.slice(1).split('/');
  const restIndex = patternSegments.findIndex((segment) => segment.startsWith('*'));
  if (restIndex !== -1) {
    if (restIndex !== patternSegments.length - 1 || pathSegments.length <= restIndex) return false;
    return patternSegments.slice(0, restIndex).every((segment, index) => {
      const value = pathSegments[index];
      return Boolean(value) && (segment.startsWith(':') || segment === value);
    });
  }
  if (patternSegments.length !== pathSegments.length) return false;

  return patternSegments.every((segment, index) => {
    const value = pathSegments[index];
    if (!value) return false;
    return segment.startsWith(':') || segment === value;
  });
}

export function matchingReleasePolicies(pathname) {
  return RELEASE_ROUTE_POLICY.filter((entry) => matchReleasePattern(entry.pattern, pathname));
}

/**
 * How specific a pattern is: which of its segments are literal.
 *
 * `/:place` now matches every one-segment path, so several patterns can match
 * at once and the policy needs an order. The more literal (non-param, non-rest)
 * segments a pattern has, the more specific it is; on an equal count the one
 * whose literals sit further left wins, the way a reader resolves `/en/:place`
 * against `/:place/zapis` for `/en/zapis`. Two patterns with literals in the
 * same places are a genuine tie and the policy refuses to guess.
 *
 * Returns `{ count, mask }`; `mask` is a bit per segment, high bits first.
 */
export function releasePatternSpecificity(pattern) {
  const normalized = normalizeReleasePath(pattern);
  if (!normalized) return { count: -1, mask: -1 };
  if (normalized === '/') return { count: 0, mask: 0 };
  const segments = normalized.slice(1).split('/');
  let count = 0;
  let mask = 0;
  segments.forEach((segment, index) => {
    const literal = !segment.startsWith(':') && !segment.startsWith('*');
    if (!literal) return;
    count += 1;
    mask += 2 ** (segments.length - index);
  });
  return { count, mask };
}

/** The most specific entry of a matching set. Throws only on a real tie. */
export function pickMostSpecific(entries, pathname) {
  if (entries.length <= 1) return entries[0];
  let winners = [];
  let best = { count: -1, mask: -1 };
  for (const entry of entries) {
    const score = releasePatternSpecificity(entry.pattern);
    if (score.count > best.count || (score.count === best.count && score.mask > best.mask)) {
      best = score;
      winners = [entry];
    } else if (score.count === best.count && score.mask === best.mask) {
      winners.push(entry);
    }
  }
  if (winners.length > 1) {
    throw new Error(
      `Release route policy overlap for ${pathname}: ${winners.map((entry) => entry.id).join(', ')}`,
    );
  }
  return winners[0];
}

export function classifyReleasePath(pathname) {
  const matches = matchingReleasePolicies(pathname);
  if (matches.length === 0) {
    return Object.freeze({ id: 'unclassified', pattern: null, kind: 'not-live', inventory: 'implicit' });
  }
  return pickMostSpecific(matches, pathname);
}

export function isReleaseAssetPath(pathname) {
  const normalized = normalizeReleasePath(pathname);
  if (!normalized) return false;
  return (
    normalized === '/robots.txt' ||
    normalized === '/favicon.ico' ||
    normalized === '/favicon.svg' ||
    normalized.startsWith('/_astro/') ||
    normalized.startsWith('/fonts/') ||
    // Boundary data for the entry map: static, same-origin, generated by
    // scripts/geo/split.ts. It is an asset, not a route.
    normalized.startsWith('/geo/')
  );
}
