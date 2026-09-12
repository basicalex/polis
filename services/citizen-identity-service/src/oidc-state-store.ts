// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomUUID } from 'node:crypto';
import { schema, type DbClient } from '@polis/db';
import { and, eq, gt, lte } from 'drizzle-orm';

export type OidcLoginState = {
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
  expiresAt: Date;
};

export interface OidcLoginStateStore {
  create(state: string, entry: OidcLoginState, createdAt: Date): Promise<void>;
  consume(state: string, consumedAt: Date): Promise<OidcLoginState | null>;
}

export function hashOidcState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

/** PostgreSQL-backed, restart-safe state store used by every runtime route. */
export class DbOidcLoginStateStore implements OidcLoginStateStore {
  constructor(private readonly db: DbClient) {}

  async create(state: string, entry: OidcLoginState, createdAt: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.identityOidcLoginStates)
        .where(lte(schema.identityOidcLoginStates.expiresAt, createdAt));
      await tx.insert(schema.identityOidcLoginStates).values({
        id: `oidc-state-${randomUUID()}`,
        stateHash: hashOidcState(state),
        codeVerifier: entry.codeVerifier,
        nonce: entry.nonce,
        redirectUri: entry.redirectUri,
        expiresAt: entry.expiresAt,
        createdAt,
      });
    });
  }

  async consume(state: string, consumedAt: Date): Promise<OidcLoginState | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .delete(schema.identityOidcLoginStates)
        .where(
          and(
            eq(schema.identityOidcLoginStates.stateHash, hashOidcState(state)),
            gt(schema.identityOidcLoginStates.expiresAt, consumedAt),
          ),
        )
        .returning({
          codeVerifier: schema.identityOidcLoginStates.codeVerifier,
          nonce: schema.identityOidcLoginStates.nonce,
          redirectUri: schema.identityOidcLoginStates.redirectUri,
          expiresAt: schema.identityOidcLoginStates.expiresAt,
        });
      return rows[0] ?? null;
    });
  }
}
