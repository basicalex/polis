// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/// <reference types="astro/client" />

interface ImportMetaEnv {
  /**
   * `'1'` on a hosted test build: every entry-flow page then carries the test
   * band. Any other value, including unset, is a normal build.
   */
  readonly PUBLIC_TEST_INSTANCE?: string;
  /**
   * The shared passcode of the two synthetic staff accounts. Set only on a
   * hosted test instance, and only as a secret: it turns the one-tap demo
   * sign-in on, and without it that route does not exist.
   */
  readonly PILOT_DEMO_STAFF_PASSCODE?: string;
  readonly PILOT_DEMO_OFFICIAL_EMAIL?: string;
  readonly PILOT_DEMO_REVIEWER_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'cloudflare:workers' {
  export const env: Readonly<Record<string, unknown>> & {
    PILOT_API_BASE?: string;
    PILOT_DEMO_STAFF_PASSCODE?: string;
    PILOT_DEMO_OFFICIAL_EMAIL?: string;
    PILOT_DEMO_REVIEWER_EMAIL?: string;
  };
}
