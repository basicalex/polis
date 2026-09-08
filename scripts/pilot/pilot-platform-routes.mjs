const requiredIdentityRoutes = Object.freeze([
  'POST /api/v1/identity/magic-link',
  'POST /api/v1/identity/exchange',
  'POST /api/v1/identity/logout',
  'GET /api/v1/identity/authorize',
  'POST /api/v1/identity/callback',
]);

function routeKey(route) {
  return `${route.method} ${route.path}`;
}

export function selectPilotPlatformRoutes(platformRoutes, traceRoutes, operationalRoutes) {
  const selectedIdentity = platformRoutes.filter((route) =>
    requiredIdentityRoutes.includes(routeKey(route)),
  );
  if (selectedIdentity.length !== requiredIdentityRoutes.length) {
    throw new Error('platform identity route contract is incomplete');
  }
  const selectedKeys = new Set(selectedIdentity.map(routeKey));
  if (selectedKeys.size !== requiredIdentityRoutes.length) {
    throw new Error('platform identity route contract contains duplicates');
  }
  return [...operationalRoutes, ...traceRoutes, ...selectedIdentity];
}

export function createPilotReadiness({
  databaseCheck,
  fetchReady,
  databaseUrl,
  identityUrl,
  traceUrl,
}) {
  return async () => {
    try {
      await databaseCheck(databaseUrl, 3_000);
    } catch {
      return { ready: false, dependency: 'database' };
    }
    try {
      const identity = await fetchReady(identityUrl);
      if (!identity.ok) return { ready: false, dependency: 'identity' };
    } catch {
      return { ready: false, dependency: 'identity' };
    }
    try {
      const trace = await fetchReady(traceUrl);
      if (!trace.ok) return { ready: false, dependency: 'trace' };
    } catch {
      return { ready: false, dependency: 'trace' };
    }
    return { ready: true };
  };
}

export { requiredIdentityRoutes };
