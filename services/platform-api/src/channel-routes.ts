// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IncomingMessage } from 'node:http';

import {
  binaryResult,
  fetchWithTimeout,
  internalHeaders,
  type Route,
} from '@polis/service-runtime';

import { upstreamFailure } from './proxy.js';

const DEFAULT_CHANNEL_INTERNAL_URL = 'http://localhost:8990';
const BODY_LIMIT_BYTES = 65_536;

type ChannelWebhookSpec = {
  path: '/webhooks/telnyx/messaging' | '/webhooks/telnyx/voice';
  upstreamPath:
    '/internal/channel/webhooks/telnyx/messaging' | '/internal/channel/webhooks/telnyx/voice';
  timeoutMs: 1500 | 5000;
};

const CHANNEL_WEBHOOKS: readonly ChannelWebhookSpec[] = [
  {
    path: '/webhooks/telnyx/messaging',
    upstreamPath: '/internal/channel/webhooks/telnyx/messaging',
    timeoutMs: 1500,
  },
  {
    path: '/webhooks/telnyx/voice',
    upstreamPath: '/internal/channel/webhooks/telnyx/voice',
    timeoutMs: 5000,
  },
];

function configuredChannelBase(): string {
  return (process.env.CHANNEL_INTERNAL_URL ?? DEFAULT_CHANNEL_INTERNAL_URL).replace(/\/+$/, '');
}

function telnyxHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of ['telnyx-signature-ed25519', 'telnyx-timestamp'] as const) {
    const value = req.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  return internalHeaders(headers);
}

async function proxyChannelWebhook(
  spec: ChannelWebhookSpec,
  req: IncomingMessage,
  body: unknown,
): Promise<unknown> {
  try {
    const upstream = await fetchWithTimeout(
      configuredChannelBase() + spec.upstreamPath,
      {
        method: 'POST',
        headers: telnyxHeaders(req),
        body: Buffer.from(body instanceof Uint8Array ? body : new Uint8Array()),
      },
      spec.timeoutMs,
    );
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    return binaryResult(
      upstream.status,
      bytes,
      upstream.headers.get('content-type') ?? 'application/octet-stream',
    );
  } catch (error) {
    return upstreamFailure(error);
  }
}

/** Feature-gated raw Telnyx webhook ingress routes for channel-gateway. */
export function channelRoutes(): Route[] {
  if (process.env.CHANNEL_ENABLED !== 'true') return [];

  return CHANNEL_WEBHOOKS.map((spec) => ({
    method: 'POST',
    path: spec.path,
    bodyMode: 'raw' as const,
    maxBodyBytes: BODY_LIMIT_BYTES,
    handler: async (req: IncomingMessage, body: unknown) => proxyChannelWebhook(spec, req, body),
  }));
}
