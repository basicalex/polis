/// <reference types="astro/client" />

declare module 'cloudflare:workers' {
  export const env: Readonly<Record<string, unknown>> & {
    PILOT_API_BASE?: string;
  };
}
