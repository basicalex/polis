import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle migration source of truth.
 * Schema lives in ./src/schema.ts; migrations are emitted to ./migrations and
 * committed (canonical, language-agnostic DDL).
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://polis:polis@localhost:5432/polis',
  },
});
