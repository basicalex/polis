/** @polis/platform-api — the single public BFF edge (spec §23). */
import { startService } from '@polis/service-runtime';

import { checkPlatformReadiness, runPlatformMigrations, validatePlatformConfig } from './config.js';
import { withPublicEdge } from './public-edge.js';
import { platformRoutes } from './routes.js';

export {
  checkPlatformReadiness,
  parseInternalFetchTimeoutMs,
  runPlatformMigrations,
  validatePlatformConfig,
  type PlatformMigrationOptions,
  type PlatformReadinessOptions,
} from './config.js';
export { withPublicEdge } from './public-edge.js';
export { platformRoutes } from './routes.js';

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? process.env.PLATFORM_API_PORT ?? 8080);
  validatePlatformConfig();
  await runPlatformMigrations();
  startService('platform-api', port, withPublicEdge(platformRoutes()), {
    readiness: checkPlatformReadiness,
    validateConfig: validatePlatformConfig,
  });
  console.log(JSON.stringify({ service: 'platform-api', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();
