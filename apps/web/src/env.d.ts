// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/// <reference types="astro/client" />

declare module 'cloudflare:workers' {
  export const env: Readonly<Record<string, unknown>> & {
    PILOT_API_BASE?: string;
  };
}
