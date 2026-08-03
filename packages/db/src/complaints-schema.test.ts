import assert from 'node:assert/strict';
import test from 'node:test';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  COMPLAINT_APPEAL_STATUSES,
  COMPLAINT_DECISION_KINDS,
  COMPLAINT_EVENT_TYPES,
  COMPLAINT_STATUSES,
  complaintAppeals,
  complaintCaseEvents,
  complaintCases,
  complaintDecisions,
  complaintInformationRequests,
  schema,
} from './schema.js';

const names = (items: ReadonlyArray<{ name: string }>) => items.map((item) => item.name).sort();

const indexNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table)
    .indexes.map((item) => item.config.name)
    .sort();

const checkNames = (table: Parameters<typeof getTableConfig>[0]) =>
  names(getTableConfig(table).checks);

test('schema exports all private complaint tables', () => {
  assert.equal(schema.complaintCases, complaintCases);
  assert.equal(schema.complaintInformationRequests, complaintInformationRequests);
  assert.equal(schema.complaintDecisions, complaintDecisions);
  assert.equal(schema.complaintAppeals, complaintAppeals);
  assert.equal(schema.complaintCaseEvents, complaintCaseEvents);

  assert.deepEqual(
    [
      complaintCases,
      complaintInformationRequests,
      complaintDecisions,
      complaintAppeals,
      complaintCaseEvents,
    ].map((table) => getTableConfig(table).name),
    [
      'complaint_cases',
      'complaint_information_requests',
      'complaint_decisions',
      'complaint_appeals',
      'complaint_case_events',
    ],
  );
});

test('complaint lifecycle values and checks are canonical', () => {
  assert.deepEqual(COMPLAINT_STATUSES, [
    'submitted',
    'assigned',
    'awaiting_information',
    'decided',
    'appealed',
    'closed',
  ]);
  assert.deepEqual(COMPLAINT_EVENT_TYPES, [
    'submitted',
    'assigned',
    'information_requested',
    'information_received',
    'decided',
    'appealed',
    'appeal_decided',
    'closed',
  ]);
  assert.deepEqual(COMPLAINT_DECISION_KINDS, ['initial', 'appeal']);
  assert.deepEqual(COMPLAINT_APPEAL_STATUSES, ['filed', 'decided']);

  assert.deepEqual(checkNames(complaintCases), [
    'ck_complaint_cases_case_number_nonempty',
    'ck_complaint_cases_narrative_nonempty',
    'ck_complaint_cases_status',
    'ck_complaint_cases_subject_nonempty',
  ]);
  assert.deepEqual(checkNames(complaintInformationRequests), [
    'ck_complaint_information_requests_question_nonempty',
    'ck_complaint_information_requests_response_nonempty',
  ]);
  assert.deepEqual(checkNames(complaintDecisions), [
    'ck_complaint_decisions_kind',
    'ck_complaint_decisions_outcome_nonempty',
    'ck_complaint_decisions_reason_nonempty',
  ]);
  assert.deepEqual(checkNames(complaintAppeals), [
    'ck_complaint_appeals_grounds_nonempty',
    'ck_complaint_appeals_status',
  ]);
  assert.deepEqual(checkNames(complaintCaseEvents), [
    'ck_complaint_case_events_actor_type',
    'ck_complaint_case_events_event_type',
    'ck_complaint_case_events_from_status',
    'ck_complaint_case_events_to_status',
    'ck_complaint_case_events_transition',
  ]);
});

test('complaint indexes enforce lookup and one-appeal contracts', () => {
  assert.deepEqual(indexNames(complaintCases), [
    'complaint_cases_assigned_holder_idx',
    'complaint_cases_case_number_idx',
    'complaint_cases_resident_created_idx',
    'complaint_cases_status_created_idx',
  ]);
  assert.deepEqual(indexNames(complaintInformationRequests), [
    'complaint_information_requests_complaint_created_idx',
  ]);
  assert.deepEqual(indexNames(complaintDecisions), [
    'complaint_decisions_complaint_decided_idx',
    'complaint_decisions_complaint_kind_idx',
  ]);
  assert.deepEqual(indexNames(complaintAppeals), ['complaint_appeals_complaint_idx']);
  assert.deepEqual(indexNames(complaintCaseEvents), [
    'complaint_case_events_complaint_occurred_id_idx',
  ]);

  const caseNumberIndex = getTableConfig(complaintCases).indexes.find(
    (item) => item.config.name === 'complaint_cases_case_number_idx',
  );
  const decisionKindIndex = getTableConfig(complaintDecisions).indexes.find(
    (item) => item.config.name === 'complaint_decisions_complaint_kind_idx',
  );
  const appealIndex = getTableConfig(complaintAppeals).indexes.find(
    (item) => item.config.name === 'complaint_appeals_complaint_idx',
  );
  assert.equal(caseNumberIndex?.config.unique, true);
  assert.equal(decisionKindIndex?.config.unique, true);
  assert.equal(appealIndex?.config.unique, true);
});

test('complaint event data is non-null and defaults to an empty object', () => {
  const dataColumn = getTableConfig(complaintCaseEvents).columns.find(
    (column) => column.name === 'data',
  );
  assert.equal(dataColumn?.notNull, true);
  assert.equal(dataColumn?.hasDefault, true);
});
