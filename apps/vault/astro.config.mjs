import { defineConfig } from 'astro/config';

export default defineConfig({
  server: { port: 4323, host: '0.0.0.0' },
  output: 'static',
  vite: {
    ssr: { noExternal: ['@polis/ui'] },
  },
});
