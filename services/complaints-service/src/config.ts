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
