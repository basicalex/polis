import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'http://localhost:4322',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { host: '0.0.0.0', port: 4322 },
});
