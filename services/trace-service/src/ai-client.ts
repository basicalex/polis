// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { internalHeaders } from '@polis/service-runtime';

export interface AiIntakeRequest {
  caseId: string;
  text: string;
  municipalityId: string;
  language: 'hr';
  knownOpenCases: Array<{
    caseId: string;
    category: string;
    locationText: '';
    summary: string;
  }>;
}

export interface AiIntakeProposal {
  category?: unknown;
  locationText?: unknown;
  duplicateOf?: unknown;
  office?: unknown;
  confidence?: unknown;
  traceId?: unknown;
  outputId?: unknown;
  injectionBlocked?: unknown;
}

export type AiIntakeResult =
  | { status: 'skipped' }
  | { status: 'blocked' }
  | { status: 'proposal'; proposal: AiIntakeProposal };

export async function requestAiIntake(
  baseUrl: string,
  input: AiIntakeRequest,
): Promise<AiIntakeResult> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/internal/ai/intake`, {
    method: 'POST',
    headers: internalHeaders(),
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status === 404) return { status: 'skipped' };
  if (!response.ok) throw new Error(`ai_intake_http_${response.status}`);
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ai_intake_invalid_response');
  }
  const proposal = value as AiIntakeProposal;
  if (proposal.injectionBlocked === true) return { status: 'blocked' };
  return { status: 'proposal', proposal };
}

export interface AiDecisionMirrorInput {
  outputId: string;
  decision: 'approved' | 'rejected';
  reviewerId: string;
}

export async function mirrorAiDecision(
  input: AiDecisionMirrorInput,
  baseUrl = process.env.TRACE_AI_INTAKE_URL,
): Promise<void> {
  if (!baseUrl) return;
  try {
    await fetch(
      `${baseUrl.replace(/\/$/, '')}/internal/ai/outputs/${encodeURIComponent(input.outputId)}/review`,
      {
        method: 'POST',
        headers: internalHeaders(),
        body: JSON.stringify({
          decision: input.decision,
          reviewerId: input.reviewerId,
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );
  } catch {
    // Decision mirroring is deliberately best-effort.
  }
}
