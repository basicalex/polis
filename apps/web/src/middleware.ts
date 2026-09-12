// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MiddlewareHandler } from 'astro';
import * as untypedReleasePolicy from './lib/release-route-policy.mjs';

const releasePolicy = untypedReleasePolicy as {
  classifyReleasePath: (pathname: string) => { id: string; kind: string };
  isReleaseAssetPath: (pathname: string) => boolean;
  normalizeReleasePath: (pathname: string) => string | null;
};
const { classifyReleasePath, isReleaseAssetPath, normalizeReleasePath } = releasePolicy;

declare const __POLIS_PUBLIC_RELEASE__: boolean;
const releaseMode =
  typeof __POLIS_PUBLIC_RELEASE__ !== 'undefined' && __POLIS_PUBLIC_RELEASE__;
const boundaryPath = '/release-boundary';
const allowedMethods: Readonly<Record<string, true>> = Object.freeze({ GET: true, HEAD: true });

const releaseSecurityHeaders = Object.freeze({
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; media-src 'self'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'self'; upgrade-insecure-requests",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
});

function withReleaseHeaders(response: Response, blocked: boolean): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(releaseSecurityHeaders)) headers.set(name, value);
  headers.set('Cache-Control', blocked ? 'no-store' : 'public, max-age=0, must-revalidate');
  if (blocked) headers.set('X-Robots-Tag', 'noindex, noarchive');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createReleaseMiddleware(enabled: boolean): MiddlewareHandler {
  return async (context, next) => {
    if (!enabled) return next();

    const pathname = normalizeReleasePath(context.url.pathname);
    if (pathname && isReleaseAssetPath(pathname)) return next();

    if (pathname === boundaryPath) {
      if (!allowedMethods[context.request.method]) {
        return withReleaseHeaders(new Response('Method Not Allowed', { status: 405 }), true);
      }
      return withReleaseHeaders(await next(), false);
    }

    const classification = pathname
      ? classifyReleasePath(pathname)
      : { id: 'invalid-path', kind: 'not-live' };
    const allowed = classification.kind === 'safe' && allowedMethods[context.request.method] === true;
    if (allowed) return withReleaseHeaders(await next(), false);

    const kind = allowedMethods[context.request.method] ? classification.kind : 'restricted';
    const boundaryUrl = new URL(boundaryPath, context.url);
    boundaryUrl.searchParams.set('kind', kind);
    boundaryUrl.searchParams.set('path', pathname ?? '/');

    const rewrittenRequest = new Request(boundaryUrl, {
      method: 'GET',
      headers: { accept: context.request.headers.get('accept') ?? 'text/html' },
    });
    const response = await context.rewrite(rewrittenRequest);
    const bounded = withReleaseHeaders(response, true);
    bounded.headers.set('X-Polis-Release-Boundary', kind);
    return bounded;
  };
}

export const onRequest = createReleaseMiddleware(releaseMode);
