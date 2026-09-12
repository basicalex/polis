// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handlePilotProxy } from '../../../../lib/pilot/vrsar/proxy';

export const prerender = false;

const handler: APIRoute = async (context) => {
  const binding = (env as Record<string, unknown>).PILOT_API_BASE;
  return handlePilotProxy(
    context,
    typeof binding === 'string' && binding.trim() ? { backendBase: binding } : {},
  );
};

export const GET = handler;
export const POST = handler;
export const ALL = handler;
