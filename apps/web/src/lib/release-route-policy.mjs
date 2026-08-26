export const RELEASE_KINDS = Object.freeze([
  'safe',
  'backend-dependent',
  'restricted',
  'not-live',
]);

const policy = [
  { id: 'home', pattern: '/', kind: 'safe', inventory: 'current' },
  { id: 'home-hr', pattern: '/hr', kind: 'safe', inventory: 'planned' },
  { id: 'presentation', pattern: '/presentation', kind: 'safe', inventory: 'current' },
  { id: 'presentation-hr', pattern: '/hr/presentation', kind: 'safe', inventory: 'current' },
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

export function classifyReleasePath(pathname) {
  const matches = matchingReleasePolicies(pathname);
  if (matches.length > 1) {
    throw new Error(`Release route policy overlap for ${pathname}: ${matches.map((entry) => entry.id).join(', ')}`);
  }
  if (matches.length === 1) return matches[0];
  return Object.freeze({ id: 'unclassified', pattern: null, kind: 'not-live', inventory: 'implicit' });
}

export function isReleaseAssetPath(pathname) {
  const normalized = normalizeReleasePath(pathname);
  if (!normalized) return false;
  return (
    normalized === '/robots.txt' ||
    normalized === '/favicon.ico' ||
    normalized === '/favicon.svg' ||
    normalized.startsWith('/_astro/') ||
    normalized.startsWith('/fonts/')
  );
}
