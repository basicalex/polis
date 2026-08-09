import type { DbClient } from '@polis/db';
import { operationalRoutes, result, type Route } from '@polis/service-runtime';

import { correlationId } from './audit.js';
import { isActor, requireActor } from './authorization.js';
import {
  appealComplaint,
  assignComplaint,
  closeComplaint,
  createComplaint,
  decideAppeal,
  decideComplaint,
  getComplaintDetail,
  listMine,
  listQueue,
  requestInformation,
  respondToInformationRequest,
} from './orchestration.js';

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= maximum ? text : null;
}

function bodyField(body: unknown, key: string): unknown {
  if (!body || typeof body !== 'object' || !(key in body)) return undefined;
  return Reflect.get(body, key);
}

function safeOutcome(value: unknown): string | null {
  const outcome = boundedText(value, 64);
  return outcome && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(outcome) ? outcome : null;
}

function optionalDueAt(value: unknown): Date | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function complaintRoutes(db: DbClient): Route[] {
  return [
    ...operationalRoutes('complaints-service'),
    {
      method: 'POST',
      path: '/internal/complaints',
      handler: async (req, body) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        if (!['verified_resident', 'verified_official'].includes(actor.identityLevel)) {
          return result(403, { error: 'resident_identity_required' });
        }
        const subject = boundedText(bodyField(body, 'subject'), 200);
        const narrative = boundedText(bodyField(body, 'narrative'), 10_000);
        if (!subject || !narrative) return result(400, { error: 'invalid_complaint' });
        return createComplaint(db, actor, subject, narrative, correlationId(req));
      },
    },
    {
      method: 'GET',
      path: '/internal/complaints/mine',
      handler: async (req) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        return listMine(db, actor);
      },
    },
    {
      method: 'GET',
      path: '/internal/complaints/queue',
      handler: async (req) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        return listQueue(db, actor);
      },
    },
    {
      method: 'GET',
      path: '/internal/complaints/:id',
      handler: async (req, _body, params) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        return getComplaintDetail(db, actor, params.id);
      },
    },
    {
      method: 'POST',
      path: '/internal/complaints/:id/assign',
      handler: async (req, body, params) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        const targetId = boundedText(bodyField(body, 'assignedMandateHolderId'), 200);
        if (!targetId) return result(400, { error: 'assigned_mandate_holder_required' });
        return assignComplaint(db, actor, params.id, targetId, correlationId(req));
      },
    },
    {
      method: 'POST',
      path: '/internal/complaints/:id/information-requests',
      handler: async (req, body, params) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        const question = boundedText(bodyField(body, 'question'), 10_000);
        const dueAt = optionalDueAt(bodyField(body, 'dueAt'));
        if (!question || dueAt === undefined) {
          return result(400, { error: 'invalid_information_request' });
        }
        return requestInformation(db, actor, params.id, question, dueAt, correlationId(req));
      },
    },
    {
      method: 'POST',
      path: '/internal/complaints/:id/information-requests/:requestId/respond',
      handler: async (req, body, params) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        const response = boundedText(bodyField(body, 'response'), 10_000);
        if (!response) return result(400, { error: 'invalid_information_response' });
        return respondToInformationRequest(
          db,
          actor,
          params.id,
          params.requestId,
          response,
          correlationId(req),
        );
      },
    },
    {
      method: 'POST',
      path: '/internal/complaints/:id/decisions',
      handler: async (req, body, params) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        const decisionOutcome = safeOutcome(bodyField(body, 'outcome'));
        const reason = boundedText(bodyField(body, 'reason'), 10_000);
        if (!decisionOutcome || !reason) return result(400, { error: 'invalid_decision' });
        return decideComplaint(db, actor, params.id, decisionOutcome, reason, correlationId(req));
      },
    },
    {
      method: 'POST',
      path: '/internal/complaints/:id/appeals',
      handler: async (req, body, params) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        const grounds = boundedText(bodyField(body, 'grounds'), 10_000);
        if (!grounds) return result(400, { error: 'invalid_appeal' });
        return appealComplaint(db, actor, params.id, grounds, correlationId(req));
      },
    },
    {
      method: 'POST',
      path: '/internal/complaints/:id/appeals/:appealId/decisions',
      handler: async (req, body, params) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        const decisionOutcome = safeOutcome(bodyField(body, 'outcome'));
        const reason = boundedText(bodyField(body, 'reason'), 10_000);
        if (!decisionOutcome || !reason) return result(400, { error: 'invalid_decision' });
        return decideAppeal(
          db,
          actor,
          params.id,
          params.appealId,
          decisionOutcome,
          reason,
          correlationId(req),
        );
      },
    },
    {
      method: 'POST',
      path: '/internal/complaints/:id/close',
      handler: async (req, _body, params) => {
        const actor = requireActor(req);
        if (!isActor(actor)) return actor;
        return closeComplaint(db, actor, params.id, correlationId(req));
      },
    },
  ];
}
