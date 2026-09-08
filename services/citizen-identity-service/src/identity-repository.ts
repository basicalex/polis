import { randomBytes, randomUUID } from 'node:crypto';
import { schema, type DbClient } from '@polis/db';
import { and, eq, gt, lte, sql } from 'drizzle-orm';

export type CitizenRow = (typeof schema.citizens)['$inferSelect'];

const LEGACY_UNKNOWN_ISSUER_PROVIDER = 'keycloak';

export interface IdentityRepository {
  issueMagicToken(input: {
    email: string;
    displayName: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<CitizenRow>;
  consumeMagicToken(input: {
    email: string;
    tokenHash: string;
    consumedAt: Date;
  }): Promise<CitizenRow | null>;
  findByPasscodeHash(email: string, passcodeHash: string): Promise<CitizenRow | null>;
  findCitizenById(citizenId: string): Promise<CitizenRow | null>;
  revokeSession(input: {
    tokenHash: string;
    citizenId: string;
    expiresAt: Date;
    revokedAt: Date;
  }): Promise<boolean>;
  isSessionRevoked(tokenHash: string, checkedAt: Date): Promise<boolean>;
  resolveOidcCitizen(input: {
    provider: string;
    subject: string;
    email: string;
  }): Promise<CitizenRow>;
}

export class DbIdentityRepository implements IdentityRepository {
  constructor(private readonly db: DbClient) {}

  async issueMagicToken(input: {
    email: string;
    displayName: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<CitizenRow> {
    const rows = await this.db
      .insert(schema.citizens)
      .values({
        id: `cit-${randomBytes(8).toString('hex')}`,
        email: input.email,
        displayName: input.displayName,
        magicTokenHash: input.tokenHash,
        magicTokenExpiresAt: input.expiresAt,
      })
      .onConflictDoUpdate({
        target: schema.citizens.email,
        set: {
          magicTokenHash: input.tokenHash,
          magicTokenExpiresAt: input.expiresAt,
        },
      })
      .returning();
    const citizen = rows[0];
    if (!citizen) throw new Error('magic_token_issue_failed');
    return citizen;
  }

  async consumeMagicToken(input: {
    email: string;
    tokenHash: string;
    consumedAt: Date;
  }): Promise<CitizenRow | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(schema.citizens)
        .set({ magicTokenHash: null, magicTokenExpiresAt: null })
        .where(
          and(
            eq(schema.citizens.email, input.email),
            eq(schema.citizens.magicTokenHash, input.tokenHash),
            gt(schema.citizens.magicTokenExpiresAt, input.consumedAt),
          ),
        )
        .returning();
      return rows[0] ?? null;
    });
  }

  async findByPasscodeHash(email: string, passcodeHash: string): Promise<CitizenRow | null> {
    const rows = await this.db
      .select()
      .from(schema.citizens)
      .where(and(eq(schema.citizens.email, email), eq(schema.citizens.passcodeHash, passcodeHash)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findCitizenById(citizenId: string): Promise<CitizenRow | null> {
    const rows = await this.db
      .select()
      .from(schema.citizens)
      .where(eq(schema.citizens.id, citizenId))
      .limit(1);
    return rows[0] ?? null;
  }

  async revokeSession(input: {
    tokenHash: string;
    citizenId: string;
    expiresAt: Date;
    revokedAt: Date;
  }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(schema.identitySessionRevocations)
        .where(lte(schema.identitySessionRevocations.expiresAt, input.revokedAt));
      const inserted = await tx
        .insert(schema.identitySessionRevocations)
        .values({
          id: `session-rev-${randomUUID()}`,
          tokenHash: input.tokenHash,
          citizenId: input.citizenId,
          expiresAt: input.expiresAt,
          revokedAt: input.revokedAt,
        })
        .onConflictDoNothing({ target: schema.identitySessionRevocations.tokenHash })
        .returning({ id: schema.identitySessionRevocations.id });
      return inserted.length === 1;
    });
  }

  async isSessionRevoked(tokenHash: string, checkedAt: Date): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.identitySessionRevocations.id })
      .from(schema.identitySessionRevocations)
      .where(
        and(
          eq(schema.identitySessionRevocations.tokenHash, tokenHash),
          gt(schema.identitySessionRevocations.expiresAt, checkedAt),
        ),
      )
      .limit(1);
    return rows.length === 1;
  }

  async resolveOidcCitizen(input: {
    provider: string;
    subject: string;
    email: string;
  }): Promise<CitizenRow> {
    return this.db.transaction(async (tx) => {
      const legacySubject = await tx
        .select({ id: schema.externalIdentities.id })
        .from(schema.externalIdentities)
        .where(
          and(
            eq(schema.externalIdentities.provider, LEGACY_UNKNOWN_ISSUER_PROVIDER),
            eq(schema.externalIdentities.subject, input.subject),
          ),
        )
        .limit(1);
      if (legacySubject[0]) throw new Error('legacy_oidc_binding_review_required');

      const existingEmail = await tx
        .select({ id: schema.citizens.id })
        .from(schema.citizens)
        .where(eq(schema.citizens.email, input.email))
        .limit(1);
      if (existingEmail[0]) {
        const legacyEmailBinding = await tx
          .select({ id: schema.externalIdentities.id })
          .from(schema.externalIdentities)
          .where(
            and(
              eq(schema.externalIdentities.provider, LEGACY_UNKNOWN_ISSUER_PROVIDER),
              eq(schema.externalIdentities.citizenId, existingEmail[0].id),
            ),
          )
          .limit(1);
        if (legacyEmailBinding[0]) throw new Error('legacy_oidc_binding_review_required');
      }

      const linked = await tx
        .select({ citizenId: schema.externalIdentities.citizenId })
        .from(schema.externalIdentities)
        .where(
          and(
            eq(schema.externalIdentities.provider, input.provider),
            eq(schema.externalIdentities.subject, input.subject),
          ),
        )
        .limit(1);
      if (linked[0]) {
        const legacyLinkedCitizen = await tx
          .select({ id: schema.externalIdentities.id })
          .from(schema.externalIdentities)
          .where(
            and(
              eq(schema.externalIdentities.provider, LEGACY_UNKNOWN_ISSUER_PROVIDER),
              eq(schema.externalIdentities.citizenId, linked[0].citizenId),
            ),
          )
          .limit(1);
        if (legacyLinkedCitizen[0]) throw new Error('legacy_oidc_binding_review_required');
      }

      let citizenId = linked[0]?.citizenId;
      if (!citizenId) {
        const inserted = await tx
          .insert(schema.citizens)
          .values({
            id: `cit-${randomBytes(8).toString('hex')}`,
            email: input.email,
            displayName: input.email.split('@')[0] || 'Citizen',
          })
          .onConflictDoNothing({ target: schema.citizens.email })
          .returning();
        const byEmail =
          inserted[0] ??
          (
            await tx
              .select()
              .from(schema.citizens)
              .where(eq(schema.citizens.email, input.email))
              .limit(1)
          )[0];
        if (!byEmail) throw new Error('citizen_resolution_failed');
        citizenId = byEmail.id;

        const linkInsert = await tx
          .insert(schema.externalIdentities)
          .values({
            id: `ext-${randomBytes(8).toString('hex')}`,
            citizenId,
            provider: input.provider,
            subject: input.subject,
          })
          .onConflictDoNothing({
            target: [schema.externalIdentities.provider, schema.externalIdentities.subject],
          })
          .returning({ citizenId: schema.externalIdentities.citizenId });
        if (!linkInsert[0]) {
          const winner = await tx
            .select({ citizenId: schema.externalIdentities.citizenId })
            .from(schema.externalIdentities)
            .where(
              and(
                eq(schema.externalIdentities.provider, input.provider),
                eq(schema.externalIdentities.subject, input.subject),
              ),
            )
            .limit(1);
          citizenId = winner[0]?.citizenId;
        }
      }
      if (!citizenId) throw new Error('citizen_resolution_failed');

      const currentRows = await tx
        .select()
        .from(schema.citizens)
        .where(eq(schema.citizens.id, citizenId))
        .limit(1);
      let citizen = currentRows[0];
      if (!citizen) throw new Error('citizen_resolution_failed');

      if (citizen.email !== input.email) {
        const emailOwner = await tx
          .select({ id: schema.citizens.id })
          .from(schema.citizens)
          .where(eq(schema.citizens.email, input.email))
          .limit(1);
        if (!emailOwner[0] || emailOwner[0].id === citizen.id) {
          const updated = await tx
            .update(schema.citizens)
            .set({ email: input.email })
            .where(
              and(
                eq(schema.citizens.id, citizen.id),
                sql`${schema.citizens.email} is distinct from ${input.email}`,
              ),
            )
            .returning();
          citizen = updated[0] ?? citizen;
        }
      }
      return citizen;
    });
  }
}
