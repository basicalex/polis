// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkDatabase } from '@polis/db';

/** Bounded database readiness without exposing database failure details. */
export async function databaseReadiness(
  check: () => Promise<unknown> = checkDatabase,
): Promise<{ ready: true } | { ready: false; dependency: 'database' }> {
  try {
    await check();
    return { ready: true };
  } catch {
    return { ready: false, dependency: 'database' };
  }
}
