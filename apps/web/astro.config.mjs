import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

const releaseMode = process.env.PUBLIC_RELEASE === '1';
const localReleaseQa = process.env.PUBLIC_RELEASE_LOCAL_QA === '1';
const pilotRuntime = Boolean(process.env.PILOT_RUNTIME_DIR?.trim());
const loopbackHosts = Object.freeze({ localhost: true, '127.0.0.1': true, '[::1]': true });
const domainSource = fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url));
const releaseVerifierStub = fileURLToPath(
  new URL('./src/components/ReleaseVerifierStub.tsx', import.meta.url),
);

function resolveSite() {
  const configured = process.env.PUBLIC_SITE_URL?.trim();
  if (!releaseMode) return configured || 'http://localhost:4321';
  if (!configured) {
    throw new Error('PUBLIC_SITE_URL is required when PUBLIC_RELEASE=1');
  }

  let site;
  try {
    site = new URL(configured);
  } catch {
    throw new Error('PUBLIC_SITE_URL must be an absolute URL when PUBLIC_RELEASE=1');
  }

  if (site.username || site.password || site.pathname !== '/' || site.search || site.hash) {
    throw new Error('PUBLIC_SITE_URL must be an origin without credentials, path, query, or fragment');
  }

  const isLoopback = loopbackHosts[site.hostname] === true;
  if (localReleaseQa) {
    if (!isLoopback || (site.protocol !== 'http:' && site.protocol !== 'https:')) {
      throw new Error('PUBLIC_RELEASE_LOCAL_QA=1 requires an HTTP(S) loopback PUBLIC_SITE_URL');
    }
  } else if (site.protocol !== 'https:' || isLoopback) {
    throw new Error('Production PUBLIC_RELEASE requires a non-local HTTPS PUBLIC_SITE_URL');
  }

  return site.origin;
}

export default defineConfig({
  site: resolveSite(),
  session: false,
  output: 'server',
  devToolbar: { enabled: !pilotRuntime },
  integrations: [react()],
  adapter: cloudflare({ imageService: 'compile' }),
  server: { host: '0.0.0.0', port: 4321 },
  vite: {
    define: { __POLIS_PUBLIC_RELEASE__: JSON.stringify(releaseMode) },
    plugins: [tailwindcss()],
    resolve: releaseMode
      ? {
          alias: {
            '@polis/domain': domainSource,
            '@polis/ui/react/VerifierFlow.tsx': releaseVerifierStub,
          },
        }
      : undefined,
    ssr: { noExternal: ['@polis/ui'] },
  },
});
