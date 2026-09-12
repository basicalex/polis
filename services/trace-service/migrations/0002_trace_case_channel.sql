-- SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- This migration is additive: it preserves the original trace schema and backfills every
-- existing record with a deterministic municipality case number and public case shell.

ALTER TABLE trace_records
  ADD COLUMN case_number text,
  ADD COLUMN origin text NOT NULL DEFAULT 'web'
    CHECK (origin IN ('web', 'sms', 'voice')),
  ADD COLUMN filer_kind text NOT NULL DEFAULT 'account'
    CHECK (filer_kind IN ('account', 'anonymous-channel')),
  ADD COLUMN gateway_actor_id text,
  ADD COLUMN reopen_key_hash char(64),
  ADD COLUMN reopen_key_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN duplicate_of_record_id uuid REFERENCES trace_records(id) ON DELETE RESTRICT,
  ADD COLUMN closed_reason text
    CHECK (closed_reason IN (
      'duplicate',
      'out-of-scope',
      'withdrawn',
      'insufficient-information',
      'no-action-possible',
      'resolved-elsewhere'
    )),
  ADD COLUMN closed_note text,
  ADD COLUMN closed_public_reason text,
  ADD COLUMN follower_count integer NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
  ADD COLUMN also_affected_count integer NOT NULL DEFAULT 0 CHECK (also_affected_count >= 0);

ALTER TABLE trace_records
  ALTER COLUMN owner_actor_id DROP NOT NULL,
  ADD CONSTRAINT trace_records_account_owner_check
    CHECK ((filer_kind = 'account') = (owner_actor_id IS NOT NULL)),
  ADD CONSTRAINT trace_records_anonymous_reopen_key_check
    CHECK ((filer_kind = 'anonymous-channel') = (reopen_key_hash IS NOT NULL)),
  ADD CONSTRAINT trace_records_gateway_origin_check
    CHECK ((gateway_actor_id IS NULL) = (origin = 'web')),
  ADD CONSTRAINT trace_records_closed_reason_check
    CHECK ((status = 'closed') = (closed_reason IS NOT NULL)),
  ADD CONSTRAINT trace_records_not_self_duplicate_check
    CHECK (duplicate_of_record_id IS DISTINCT FROM id);

WITH numbered AS (
  SELECT
    id,
    row_number() OVER (ORDER BY created_at, id) AS n
  FROM trace_records
  WHERE case_number IS NULL
)
UPDATE trace_records AS records
SET case_number = 'VRS-' || lpad((1000 + numbered.n - 1)::text, 4, '0')
FROM numbered
WHERE records.id = numbered.id;

ALTER TABLE trace_records ALTER COLUMN case_number SET NOT NULL;
CREATE UNIQUE INDEX trace_records_case_number_idx ON trace_records (case_number);
CREATE UNIQUE INDEX trace_records_reopen_key_hash_idx
  ON trace_records (reopen_key_hash)
  WHERE reopen_key_hash IS NOT NULL;

ALTER TABLE trace_records
  DROP CONSTRAINT trace_records_status_check,
  ADD CONSTRAINT trace_records_status_check
    CHECK (status IN (
      'open',
      'assigned',
      'commitment-pending-review',
      'returned',
      'published',
      'resolution-pending-review',
      'resolved',
      'closed'
    ));

ALTER TABLE trace_events
  DROP CONSTRAINT trace_events_resulting_status_check,
  ADD CONSTRAINT trace_events_resulting_status_check
    CHECK (resulting_status IN (
      'open',
      'assigned',
      'commitment-pending-review',
      'returned',
      'published',
      'resolution-pending-review',
      'resolved',
      'closed'
    )),
  DROP CONSTRAINT trace_events_actor_role_check,
  ADD CONSTRAINT trace_events_actor_role_check
    CHECK (actor_role IN ('resident', 'official', 'reviewer', 'gateway'));

CREATE TABLE trace_case_counters (
  municipality_id text PRIMARY KEY CHECK (municipality_id = 'vrsar-orsera'),
  next_value bigint NOT NULL CHECK (next_value > 0),
  updated_at timestamptz NOT NULL
);

INSERT INTO trace_case_counters (municipality_id, next_value, updated_at)
SELECT
  'vrsar-orsera',
  COALESCE(MAX(substring(case_number FROM '^VRS-([0-9]+)$')::bigint) + 1, 1000),
  NOW()
FROM trace_records;

CREATE TABLE trace_case_shells (
  record_id uuid PRIMARY KEY REFERENCES trace_records(id) ON DELETE RESTRICT,
  case_number text NOT NULL UNIQUE,
  municipality_id text NOT NULL CHECK (municipality_id = 'vrsar-orsera'),
  area text NOT NULL,
  category text NOT NULL CHECK (category = 'public-lighting'),
  track text NOT NULL CHECK (track IN ('standard')),
  state text NOT NULL
    CHECK (state IN ('received', 'assigned', 'in-review', 'published', 'resolved', 'closed')),
  closed_public_reason text,
  filed_at timestamptz NOT NULL,
  clock_due_at date,
  follower_count integer NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
  also_affected_count integer NOT NULL DEFAULT 0 CHECK (also_affected_count >= 0),
  shell_hash char(64) NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((state = 'closed') = (closed_public_reason IS NOT NULL))
);

CREATE INDEX trace_case_shells_updated_idx ON trace_case_shells (updated_at DESC);

WITH shells AS (
  SELECT
    id AS record_id,
    case_number,
    municipality_id,
    'vrsar-orsera'::text AS area,
    category,
    'standard'::text AS track,
    CASE status
      WHEN 'open' THEN 'received'
      WHEN 'assigned' THEN 'assigned'
      WHEN 'commitment-pending-review' THEN 'in-review'
      WHEN 'returned' THEN 'in-review'
      WHEN 'resolution-pending-review' THEN 'in-review'
      WHEN 'published' THEN 'published'
      WHEN 'resolved' THEN 'resolved'
      WHEN 'closed' THEN 'closed'
    END AS state,
    closed_public_reason,
    created_at AS filed_at,
    due_date AS clock_due_at,
    follower_count,
    also_affected_count,
    updated_at
  FROM trace_records
)
INSERT INTO trace_case_shells (
  record_id,
  case_number,
  municipality_id,
  area,
  category,
  track,
  state,
  closed_public_reason,
  filed_at,
  clock_due_at,
  follower_count,
  also_affected_count,
  shell_hash,
  updated_at
)
SELECT
  record_id,
  case_number,
  municipality_id,
  area,
  category,
  track,
  state,
  closed_public_reason,
  filed_at,
  clock_due_at,
  follower_count,
  also_affected_count,
  encode(
    sha256(
      convert_to(
        concat(
          '{"alsoAffectedCount":', also_affected_count,
          ',"area":', to_json(area)::text,
          ',"caseNumber":', to_json(case_number)::text,
          ',"category":', to_json(category)::text,
          ',"clockDueAt":',
            CASE
              WHEN clock_due_at IS NULL THEN 'null'
              ELSE to_json(to_char(clock_due_at, 'YYYY-MM-DD'))::text
            END,
          ',"closedPublicReason":', COALESCE(to_json(closed_public_reason)::text, 'null'),
          ',"filedAt":',
            to_json(to_char(filed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text,
          ',"followerCount":', follower_count,
          ',"municipalityId":', to_json(municipality_id)::text,
          ',"state":', to_json(state)::text,
          ',"testEnvironment":true',
          ',"track":', to_json(track)::text,
          '}'
        ),
        'UTF8'
      )
    ),
    'hex'
  ),
  updated_at
FROM shells;

CREATE TABLE trace_case_messages (
  id uuid PRIMARY KEY,
  record_id uuid NOT NULL REFERENCES trace_records(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  kind text NOT NULL
    CHECK (kind IN (
      'append',
      'answer',
      'question',
      'status-update',
      'receipt',
      'transcript',
      'transcript-failed'
    )),
  channel text NOT NULL CHECK (channel IN ('web', 'sms', 'voice')),
  source text NOT NULL CHECK (source IN ('typed', 'transcript', 'system')),
  body text NOT NULL,
  body_sha256 char(64) NOT NULL,
  author_kind text NOT NULL CHECK (author_kind IN ('filer', 'official', 'reviewer', 'system')),
  author_actor_id text,
  in_reply_to uuid REFERENCES trace_case_messages(id),
  delivery_state text NOT NULL DEFAULT 'pending'
    CHECK (delivery_state IN ('pending', 'handed-off', 'delivered', 'failed', 'not-applicable')),
  delivery_failure_code text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL,
  CHECK ((direction = 'outbound') OR delivery_state = 'not-applicable'),
  CHECK ((author_kind = 'filer') = (author_actor_id IS NULL))
);

CREATE INDEX trace_case_messages_record_created_idx
  ON trace_case_messages (record_id, created_at);
CREATE INDEX trace_case_messages_pending_outbox_idx
  ON trace_case_messages (created_at)
  WHERE direction = 'outbound' AND delivery_state = 'pending';

CREATE TABLE trace_case_attention (
  record_id uuid NOT NULL REFERENCES trace_records(id),
  subject_hash char(64) NOT NULL,
  kind text NOT NULL CHECK (kind IN ('follow', 'also-affected')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (record_id, subject_hash, kind)
);

CREATE TABLE trace_ai_proposals (
  id uuid PRIMARY KEY,
  record_id uuid NOT NULL REFERENCES trace_records(id),
  kind text NOT NULL CHECK (kind IN ('category', 'location', 'duplicate-of', 'office')),
  proposed_value jsonb NOT NULL CHECK (jsonb_typeof(proposed_value) = 'object'),
  confidence numeric(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  model_id text NOT NULL,
  model_version text NOT NULL,
  prompt_sha256 char(64) NOT NULL,
  ai_trace_id text,
  ai_output_id text,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'accepted', 'rejected', 'superseded')),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL,
  CHECK ((status = 'proposed') = (decided_by IS NULL)),
  CHECK ((decided_by IS NULL) = (decided_at IS NULL))
);

CREATE UNIQUE INDEX trace_ai_proposals_active_kind_idx
  ON trace_ai_proposals (record_id, kind)
  WHERE status = 'proposed';

CREATE TABLE trace_reopen_attempts (
  case_number text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts >= 0)
);
