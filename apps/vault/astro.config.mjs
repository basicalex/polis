// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from 'astro/config';

export default defineConfig({
  server: { port: 4323, host: '0.0.0.0' },
  output: 'static',
  vite: {
    ssr: { noExternal: ['@polis/ui'] },
  },
});
