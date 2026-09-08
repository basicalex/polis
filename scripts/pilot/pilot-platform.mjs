import path from 'node:path';

import { ROOT, PilotError } from './runtime-lib.mjs';
import { createPilotReadiness, selectPilotPlatformRoutes } from './pilot-platform-routes.mjs';

const serviceRuntime = await import(path.join(ROOT, 'packages/service-runtime/dist/index.js'));
const database = await import(path.join(ROOT, 'packages/db/dist/index.js'));
const platformRoutesModule = await import(path.join(ROOT, 'services/platform-api/dist/routes.js'));
const traceRoutesModule = await import(
  path.join(ROOT, 'services/platform-api/dist/trace-routes.js')
);

const port = Number(process.env.PORT ?? '3000');
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new PilotError('pilot platform port is invalid');
if (process.env.SERVICE_HOST !== '127.0.0.1')
  throw new PilotError('pilot platform requires SERVICE_HOST=127.0.0.1');
if (
  !process.env.DATABASE_URL ||
  !process.env.IDENTITY_INTERNAL_URL ||
  !process.env.TRACE_INTERNAL_URL
) {
  throw new PilotError(
    'pilot platform requires explicit database, identity, and trace configuration',
  );
}

const readiness = createPilotReadiness({
  databaseCheck: database.checkDatabase,
  fetchReady: (url) =>
    fetch(`${url.replace(/\/$/, '')}/readyz`, { signal: AbortSignal.timeout(3_000) }),
  databaseUrl: process.env.DATABASE_URL,
  identityUrl: process.env.IDENTITY_INTERNAL_URL,
  traceUrl: process.env.TRACE_INTERNAL_URL,
});
const routes = selectPilotPlatformRoutes(
  platformRoutesModule.platformRoutes(),
  traceRoutesModule.traceRoutes(),
  serviceRuntime.operationalRoutes('pilot-platform', readiness),
);
serviceRuntime.startService('pilot-platform', port, routes, { readiness });
console.log(JSON.stringify({ service: 'pilot-platform', port, status: 'listening' }));
