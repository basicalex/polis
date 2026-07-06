import node from '@astrojs/node';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'http://localhost:4322',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { host: '0.0.0.0', port: 4322 },
  integrations: [react()],
  vite: {
    ssr: { noExternal: ['@polis/ui'] },
  },
});
