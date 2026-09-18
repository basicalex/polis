// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * The two public reads the place ledger (S3) makes: one page of cases, and the
 * counts for the whole municipality.
 *
 * The ledger used to fetch the newest hundred shells and count them in the
 * browser, which made every number a number about that hundred. The counts now
 * come from the summary, computed over every case, and the list arrives one
 * page at a time behind a cursor.
 *
 * Same root, same conventions as lib/pilot/vrsar/api.ts: a JSON envelope, an
 * accept header, same-origin credentials, and PilotApiError on anything else.
 */

import { PilotApiError } from '../pilot/vrsar/api.ts';
import { publicCasesFromEnvelope, type PublicCaseShell } from '../pilot/vrsar/model.ts';
import { LEDGER_STAGES, type LedgerStage } from './ledger-stages.ts';

const API_ROOT = '/pilot/vrsar/api';

/** The counts for the whole place, never for the page the reader is looking at. */
export interface PublicSummary {
  total: number;
  byState: Record<LedgerStage, number>;
  open: number;
  overdue: number;
  held: number;
  pendingRelease: number;
  removed: number;
  computedAt: string;
}

/** One page of the public list, and the cursor that opens the next one. */
export interface PublicCasePage {
  cases: PublicCaseShell[];
  nextCursor: string | null;
}

async function readJson(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: new Headers({ accept: 'application/json' }),
      signal,
    });
  } catch {
    throw new PilotApiError('upstream_unavailable', 'Network request failed', 0);
  }

  let payload: unknown = null;
  let validJson = false;
  try {
    payload = await response.json();
    validJson = true;
  } catch {
    validJson = false;
  }

  if (!response.ok) {
    const error = validJson && payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
    const code = typeof error.error === 'string' ? error.error : `http_${response.status}`;
    const message = typeof error.message === 'string' ? error.message : 'Request failed';
    throw new PilotApiError(code, message, response.status);
  }

  if (!validJson) {
    throw new PilotApiError('invalid_response', 'The server returned invalid JSON', response.status);
  }
  return payload;
}

/**
 * One page of public cases, in the API's order. `state` is one of the six shell
 * states and filters on the server; `cursor` is whatever the previous page
 * returned as `nextCursor`.
 */
export async function listPublicCasesPage(
  options: { limit?: number; state?: string | null; cursor?: string | null; signal?: AbortSignal } = {},
): Promise<PublicCasePage> {
  const query = new URLSearchParams();
  const { limit, state, cursor } = options;
  if (Number.isInteger(limit) && limit) query.set('limit', String(limit));
  if (state) query.set('state', state);
  if (cursor) query.set('cursor', cursor);
  const search = query.toString();
  const payload = await readJson(`/public/cases${search ? `?${search}` : ''}`, options.signal);
  let cases: PublicCaseShell[];
  try {
    cases = publicCasesFromEnvelope(payload);
  } catch {
    throw new PilotApiError('invalid_response', 'The server returned an invalid response', 200);
  }
  const next = payload && typeof payload === 'object'
    ? (payload as { nextCursor?: unknown }).nextCursor
    : null;
  return { cases, nextCursor: typeof next === 'string' && next ? next : null };
}

/** The counts for the whole place. A missing number reads as zero, never as blank. */
export async function getPublicSummary(signal?: AbortSignal): Promise<PublicSummary> {
  const payload = await readJson('/public/summary', signal);
  if (!payload || typeof payload !== 'object') {
    throw new PilotApiError('invalid_response', 'The server returned an invalid response', 200);
  }
  return publicSummaryFromResponse(payload as Record<string, unknown>);
}

/** Exported for the tests: the shape the page relies on, whatever the server sends. */
export function publicSummaryFromResponse(payload: Record<string, unknown>): PublicSummary {
  const states = payload.byState && typeof payload.byState === 'object'
    ? (payload.byState as Record<string, unknown>)
    : {};
  const byState = {} as Record<LedgerStage, number>;
  for (const stage of LEDGER_STAGES) byState[stage] = count(states[stage]);
  return {
    total: count(payload.total),
    byState,
    open: count(payload.open),
    overdue: count(payload.overdue),
    held: count(payload.held),
    pendingRelease: count(payload.pendingRelease),
    removed: count(payload.removed),
    computedAt: typeof payload.computedAt === 'string' ? payload.computedAt : '',
  };
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}
