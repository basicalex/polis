// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handlePilotProxy } from '../../../../lib/pilot/vrsar/proxy';

export const prerender = false;

/** Worker bindings and secrets are runtime values, so each one is read here. */
function binding(name: string): string | undefined {
  const value = (env as Record<string, unknown>)[name];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

const handler: APIRoute = async (context) => {
  const backendBase = binding('PILOT_API_BASE');
  const demoPasscode = binding('PILOT_DEMO_STAFF_PASSCODE');
  const demoOfficialEmail = binding('PILOT_DEMO_OFFICIAL_EMAIL');
  const edgeKey = binding('PILOT_EDGE_KEY');
  return handlePilotProxy(context, {
    ...(backendBase ? { backendBase } : {}),
    ...(demoPasscode ? { demoPasscode } : {}),
    ...(demoOfficialEmail ? { demoOfficialEmail } : {}),
    ...(edgeKey ? { edgeKey } : {}),
  });
};

export const GET = handler;
export const POST = handler;
export const ALL = handler;
