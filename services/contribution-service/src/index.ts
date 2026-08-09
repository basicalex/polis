/**
 * @polis/contribution-service — §19/§21/§22 contribution + review v0 (M6).
 */
import { getClient } from '@polis/db';
import { startService } from '@polis/service-runtime';
import { contributionRoutes } from './routes.js';

export { contributionRoutes } from './routes.js';

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8450);
  const db = getClient();
  startService('contribution-service', port, contributionRoutes(db));
  console.log(JSON.stringify({ service: 'contribution-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();
