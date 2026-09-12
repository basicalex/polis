// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { schema, DbClient } from '@polis/db';

export type SubmissionRow = (typeof schema.submissions)['$inferSelect'];
export type MutationDb = Pick<DbClient, 'select' | 'insert' | 'update'>;

export type AuditEvent = {
  eventType: string;
  action: string;
  target: { type: string; id: string };
  data: Record<string, unknown>;
  correlationId?: string;
  visibility?: 'public' | 'restricted';
  actor?: { type: 'service' | 'user'; id: string };
};
