// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getClient } from '@polis/db';
import { startService } from '@polis/service-runtime';

import { databaseReadiness } from './config.js';
import { complaintRoutes } from './routes.js';

export { databaseReadiness } from './config.js';
export { canComplaintTransition } from './lifecycle.js';
export { complaintRoutes } from './routes.js';

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? process.env.COMPLAINTS_SERVICE_PORT ?? 8970);
  const db = getClient();
  startService('complaints-service', port, complaintRoutes(db), { readiness: databaseReadiness });
  console.log(JSON.stringify({ service: 'complaints-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();
