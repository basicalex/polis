// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { runMigrationsOnce, schema, type DbClient } from '@polis/db';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';

import { DbIdentityRepository } from './identity-repository.js';
import { DbOidcLoginStateStore, hashOidcState } from './oidc-state-store.js';

const identityDatabaseUrl = process.env.IDENTITY_TEST_DATABASE_URL;

test(
  'PostgreSQL grants one magic-token winner and persists hashed revocation and OIDC state',
  { skip: !identityDatabaseUrl },
  async () => {
    assert.ok(identityDatabaseUrl);
    await runMigrationsOnce(identityDatabaseUrl);
    const sql = postgres(identityDatabaseUrl, { max: 12 });
    const db = drizzle(sql, { schema }) as unknown as DbClient;
    const repository = new DbIdentityRepository(db);
    const suffix = randomUUID();
    const email = `identity-db-${suffix}@example.test`;
    const issuerAEmail = `issuer-a-${suffix}@example.test`;
    const issuerBEmail = `issuer-b-${suffix}@example.test`;
    const legacyEmail = `legacy-issuer-${suffix}@example.test`;
    const cleanupEmails = [email, issuerAEmail, issuerBEmail, legacyEmail];
    const redirectUri = `https://pilot.example/login/callback?test=${suffix}`;
    try {
      const issued = await repository.issueMagicToken({
        email,
        displayName: 'Identity DB Test',
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      });
      const claims = await Promise.all(
        Array.from({ length: 12 }, () =>
          repository.consumeMagicToken({
            email,
            tokenHash: 'a'.repeat(64),
            consumedAt: new Date(),
          }),
        ),
      );
      assert.equal(claims.filter(Boolean).length, 1);
      assert.equal(
        await repository.consumeMagicToken({
          email,
          tokenHash: 'a'.repeat(64),
          consumedAt: new Date(),
        }),
        null,
      );

      const rawSession = `raw-session-${suffix}.signature`;
      const tokenHash = 'b'.repeat(64);
      const revokedAt = new Date();
      const expiresAt = new Date(revokedAt.getTime() + 60_000);
      await Promise.all([
        repository.revokeSession({
          tokenHash,
          citizenId: issued.id,
          expiresAt,
          revokedAt,
        }),
        repository.revokeSession({
          tokenHash,
          citizenId: issued.id,
          expiresAt,
          revokedAt,
        }),
      ]);
      const restartedRepository = new DbIdentityRepository(db);
      assert.equal(await restartedRepository.isSessionRevoked(tokenHash, new Date()), true);
      const revocations = await sql<{ token_hash: string; citizen_id: string }[]>`
        SELECT token_hash, citizen_id
        FROM identity_session_revocations
        WHERE citizen_id = ${issued.id}
      `;
      assert.deepEqual(Array.from(revocations), [{ token_hash: tokenHash, citizen_id: issued.id }]);
      assert.doesNotMatch(JSON.stringify(revocations), new RegExp(rawSession.replace('.', '\\.')));
      const rawTokenColumns = await sql<{ column_name: string }[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'identity_session_revocations'
          AND column_name = 'session_token'
      `;
      assert.equal(rawTokenColumns.length, 0);

      const state = `raw-oidc-state-${suffix}`;
      const stateStoreBeforeRestart = new DbOidcLoginStateStore(db);
      const createdAt = new Date();
      await stateStoreBeforeRestart.create(
        state,
        {
          codeVerifier: `verifier-${suffix}`,
          nonce: `nonce-${suffix}`,
          redirectUri,
          expiresAt: new Date(createdAt.getTime() + 60_000),
        },
        createdAt,
      );
      const persisted = await sql<{ state_hash: string; redirect_uri: string }[]>`
        SELECT state_hash, redirect_uri
        FROM identity_oidc_login_states
        WHERE redirect_uri = ${redirectUri}
      `;
      assert.deepEqual(Array.from(persisted), [
        { state_hash: hashOidcState(state), redirect_uri: redirectUri },
      ]);
      assert.doesNotMatch(JSON.stringify(persisted), new RegExp(state));

      const stateStoreAfterRestart = new DbOidcLoginStateStore(db);
      const consumed = await Promise.all([
        stateStoreAfterRestart.consume(state, new Date()),
        stateStoreAfterRestart.consume(state, new Date()),
      ]);
      assert.equal(consumed.filter(Boolean).length, 1);
      assert.equal(await stateStoreAfterRestart.consume(state, new Date()), null);

      const sharedSubject = `shared-subject-${suffix}`;
      const issuerA = await repository.resolveOidcCitizen({
        provider: 'oidc:https://issuer-a.example',
        subject: sharedSubject,
        email: issuerAEmail,
      });
      const issuerB = await repository.resolveOidcCitizen({
        provider: 'oidc:https://issuer-b.example',
        subject: sharedSubject,
        email: issuerBEmail,
      });
      assert.notEqual(issuerA.id, issuerB.id);
      const issuerBindings = await sql<{ provider: string; subject: string; citizen_id: string }[]>`
        SELECT provider, subject, citizen_id
        FROM external_identities
        WHERE subject = ${sharedSubject}
        ORDER BY provider
      `;
      assert.deepEqual(Array.from(issuerBindings), [
        {
          provider: 'oidc:https://issuer-a.example',
          subject: sharedSubject,
          citizen_id: issuerA.id,
        },
        {
          provider: 'oidc:https://issuer-b.example',
          subject: sharedSubject,
          citizen_id: issuerB.id,
        },
      ]);

      const legacyCitizenId = `cit-legacy-${suffix}`;
      const legacySubject = `legacy-subject-${suffix}`;
      await db.insert(schema.citizens).values({
        id: legacyCitizenId,
        email: legacyEmail,
        displayName: 'Legacy OIDC Test',
      });
      await db.insert(schema.externalIdentities).values({
        id: `ext-legacy-${suffix}`,
        citizenId: legacyCitizenId,
        provider: 'keycloak',
        subject: legacySubject,
      });
      await assert.rejects(
        repository.resolveOidcCitizen({
          provider: 'oidc:https://reviewed-issuer.example',
          subject: legacySubject,
          email: `new-${legacyEmail}`,
        }),
        /legacy_oidc_binding_review_required/,
      );
      await assert.rejects(
        repository.resolveOidcCitizen({
          provider: 'oidc:https://reviewed-issuer.example',
          subject: `different-${legacySubject}`,
          email: legacyEmail,
        }),
        /legacy_oidc_binding_review_required/,
      );
      const silentlyBackfilled = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM external_identities
        WHERE subject = ${legacySubject}
          AND provider <> 'keycloak'
      `;
      assert.equal(silentlyBackfilled[0]?.count, '0');
    } finally {
      await db
        .delete(schema.identityOidcLoginStates)
        .where(eq(schema.identityOidcLoginStates.redirectUri, redirectUri))
        .catch(() => undefined);
      for (const cleanupEmail of cleanupEmails) {
        const cleanupCitizen = await db
          .select({ id: schema.citizens.id })
          .from(schema.citizens)
          .where(eq(schema.citizens.email, cleanupEmail))
          .limit(1)
          .catch(() => []);
        if (!cleanupCitizen[0]) continue;
        await db
          .delete(schema.identitySessionRevocations)
          .where(eq(schema.identitySessionRevocations.citizenId, cleanupCitizen[0].id))
          .catch(() => undefined);
        await db
          .delete(schema.externalIdentities)
          .where(eq(schema.externalIdentities.citizenId, cleanupCitizen[0].id))
          .catch(() => undefined);
        await db
          .delete(schema.citizens)
          .where(eq(schema.citizens.id, cleanupCitizen[0].id))
          .catch(() => undefined);
      }
      await sql.end({ timeout: 1 });
    }
  },
);
