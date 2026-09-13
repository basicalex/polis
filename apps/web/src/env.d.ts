// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/// <reference types="astro/client" />

interface ImportMetaEnv {
  /**
   * `'1'` on a hosted test build: every entry-flow page then carries the test
   * band. Any other value, including unset, is a normal build.
   */
  readonly PUBLIC_TEST_INSTANCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'cloudflare:workers' {
  export const env: Readonly<Record<string, unknown>> & {
    PILOT_API_BASE?: string;
  };
}
