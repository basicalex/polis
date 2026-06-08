import { defineConfig } from 'astro/config';
export default defineConfig({ server: { port: 4324, host: '0.0.0.0' }, output: 'static' });
