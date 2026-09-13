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
  path: '/webhooks/infobip/sms' | '/webhooks/infobip/sms-reports' | '/webhooks/infobip/calls';
  upstreamPath:
    | '/internal/channel/webhooks/infobip/sms'
    | '/internal/channel/webhooks/infobip/sms-reports'
    | '/internal/channel/webhooks/infobip/calls';
};

const CHANNEL_WEBHOOKS: readonly ChannelWebhookSpec[] = [
  {
    path: '/webhooks/infobip/sms',
    upstreamPath: '/internal/channel/webhooks/infobip/sms',
  },
  {
    path: '/webhooks/infobip/sms-reports',
    upstreamPath: '/internal/channel/webhooks/infobip/sms-reports',
  },
  {
    path: '/webhooks/infobip/calls',
    upstreamPath: '/internal/channel/webhooks/infobip/calls',
  },
];

function configuredChannelBase(): string {
  return (process.env.CHANNEL_INTERNAL_URL ?? DEFAULT_CHANNEL_INTERNAL_URL).replace(/\/+$/, '');
}

function infobipHeaders(req: IncomingMessage): Record<string, string> {
  const signatureHeader = (
    process.env.INFOBIP_WEBHOOK_SIGNATURE_HEADER ?? 'x-hub-signature'
  ).toLowerCase();
  if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(signatureHeader)) {
    throw new Error('INFOBIP_WEBHOOK_SIGNATURE_HEADER must be a valid HTTP header name');
  }
  const value = req.headers[signatureHeader];
  return internalHeaders(typeof value === 'string' ? { [signatureHeader]: value } : {});
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
        headers: infobipHeaders(req),
        body: Buffer.from(body instanceof Uint8Array ? body : new Uint8Array()),
      },
      1500,
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

/** Feature-gated raw Infobip webhook ingress routes for channel-gateway. */
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
