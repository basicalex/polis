/**
 * Wire serializer for citizen-identity-service. DB rows are snake_case; this
 * maps to the §21 camelCase wire contract. Mirrors the per-service serializer
 * convention (services keep their own; cross-service src imports are not the
 * pattern). `passcodeHash`/`magicTokenHash` are NEVER serialized out.
 */
import type { schema } from '@polis/db';

type CitizenRow = (typeof schema.citizens)['$inferSelect'];

export const citizenWire = (r: CitizenRow) => ({
  id: r.id,
  email: r.email,
  displayName: r.displayName,
  identityLevel: r.identityLevel,
  createdAt: r.createdAt.toISOString(),
});
