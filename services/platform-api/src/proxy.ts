import type { IncomingMessage } from 'node:http';

import {
  FetchTimeoutError,
  fetchWithTimeout,
  internalHeaders,
  result,
} from '@polis/service-runtime';

import { parseInternalFetchTimeoutMs } from './config.js';

export function upstreamFailure(error: unknown): unknown {
  return error instanceof FetchTimeoutError
    ? result(504, { error: 'upstream_timeout' })
    : result(502, { error: 'bad_gateway' });
}

export async function proxyTo(
  base: string,
  req: IncomingMessage,
  body?: unknown,
): Promise<unknown> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const hasBody = req.method !== 'GET' && body !== undefined;
    const upstream = await fetchWithTimeout(
      base + url.pathname + url.search,
      {
        method: req.method,
        headers: internalHeaders(),
        body: hasBody ? JSON.stringify(body) : undefined,
      },
      parseInternalFetchTimeoutMs(),
    );

    if (!upstream.ok) {
      return result(
        upstream.status,
        await upstream.json().catch(() => ({ error: 'upstream_error' })),
      );
    }

    return result(upstream.status, await upstream.json());
  } catch (error) {
    return upstreamFailure(error);
  }
}

export async function proxyToPath(
  base: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  try {
    const hasBody = method !== 'GET' && body !== undefined;
    const upstream = await fetchWithTimeout(
      base + path,
      {
        method,
        headers: internalHeaders(),
        body: hasBody ? JSON.stringify(body) : undefined,
      },
      parseInternalFetchTimeoutMs(),
    );
    if (!upstream.ok) {
      return result(
        upstream.status,
        await upstream.json().catch(() => ({ error: 'upstream_error' })),
      );
    }
    return result(upstream.status, await upstream.json());
  } catch (error) {
    return upstreamFailure(error);
  }
}
