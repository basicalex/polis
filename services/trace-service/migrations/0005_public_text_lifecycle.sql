-- SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
-- SPDX-License-Identifier: AGPL-3.0-or-later

ALTER TABLE trace_records
  ADD COLUMN terminal_at timestamptz,
  ADD COLUMN removed_reason text,
  ADD COLUMN notice_count integer NOT NULL DEFAULT 0 CHECK (notice_count >= 0);

UPDATE trace_records
SET terminal_at = updated_at
WHERE status IN ('resolved', 'closed');

ALTER TABLE trace_records
  DROP CONSTRAINT trace_records_text_status_check,
  DROP CONSTRAINT trace_records_hold_reason_check,
  DROP CONSTRAINT trace_records_text_visibility_check,
  ADD CONSTRAINT trace_records_text_status_check
    CHECK (text_status IN ('public', 'held', 'redacted', 'removed')),
  ADD CONSTRAINT trace_records_hold_reason_check
    CHECK (hold_reason IN (
      'personal-data', 'abuse', 'off-topic', 'other',
      'pending-release', 'policy', 'notices', 'confidential'
    )),
  ADD CONSTRAINT trace_records_text_visibility_check CHECK (
    (text_status = 'held' AND hold_reason IS NOT NULL AND redacted_text IS NULL)
    OR (text_status = 'public' AND hold_reason IS NULL AND redacted_text IS NULL)
    OR (text_status = 'redacted' AND hold_reason IS NULL AND redacted_text IS NOT NULL)
    OR (text_status = 'removed' AND hold_reason IS NULL AND redacted_text IS NULL)
  ),
  ADD CONSTRAINT trace_records_removed_reason_value_check
    CHECK (removed_reason IN ('filer', 'retention')),
  ADD CONSTRAINT trace_records_removed_reason_presence_check
    CHECK ((text_status = 'removed') = (removed_reason IS NOT NULL));

ALTER TABLE trace_case_shells
  ADD COLUMN removed_reason text,
  ADD COLUMN notice_count integer NOT NULL DEFAULT 0 CHECK (notice_count >= 0),
  DROP CONSTRAINT trace_case_shells_text_status_check,
  DROP CONSTRAINT trace_case_shells_hold_reason_check,
  DROP CONSTRAINT trace_case_shells_text_visibility_check,
  ADD CONSTRAINT trace_case_shells_text_status_check
    CHECK (text_status IN ('public', 'held', 'redacted', 'removed')),
  ADD CONSTRAINT trace_case_shells_hold_reason_check
    CHECK (hold_reason IN (
      'personal-data', 'abuse', 'off-topic', 'other',
      'pending-release', 'policy', 'notices', 'confidential'
    )),
  ADD CONSTRAINT trace_case_shells_text_visibility_check CHECK (
    (text_status = 'held' AND text IS NULL AND location IS NULL AND hold_reason IS NOT NULL)
    OR (text_status IN ('public', 'redacted') AND text IS NOT NULL AND location IS NOT NULL AND hold_reason IS NULL)
    OR (text_status = 'removed' AND text IS NULL AND location IS NULL AND hold_reason IS NULL)
  ),
  ADD CONSTRAINT trace_case_shells_removed_reason_value_check
    CHECK (removed_reason IN ('filer', 'retention')),
  ADD CONSTRAINT trace_case_shells_removed_reason_presence_check
    CHECK ((text_status = 'removed') = (removed_reason IS NOT NULL));

ALTER TABLE trace_case_attention
  ADD COLUMN reason text,
  DROP CONSTRAINT trace_case_attention_kind_check,
  ADD CONSTRAINT trace_case_attention_kind_check
    CHECK (kind IN ('follow', 'also-affected', 'not-fixed', 'notice')),
  ADD CONSTRAINT trace_case_attention_reason_value_check
    CHECK (reason IN ('personal-data', 'abuse', 'off-topic', 'other')),
  ADD CONSTRAINT trace_case_attention_reason_presence_check
    CHECK ((kind = 'notice') = (reason IS NOT NULL));

ALTER TABLE trace_case_messages
  ADD COLUMN notice_reason text,
  DROP CONSTRAINT trace_case_messages_kind_check,
  ADD CONSTRAINT trace_case_messages_kind_check
    CHECK (kind IN (
      'append', 'label-appeal', 'dispute', 'answer', 'question', 'status-update',
      'receipt', 'transcript', 'transcript-failed', 'notice'
    )),
  ADD CONSTRAINT trace_case_messages_notice_reason_value_check
    CHECK (notice_reason IN ('personal-data', 'abuse', 'off-topic', 'other')),
  ADD CONSTRAINT trace_case_messages_notice_reason_presence_check
    CHECK ((kind = 'notice') = (notice_reason IS NOT NULL));

CREATE FUNCTION trace_migration_canonical_json(value jsonb) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  kind text := jsonb_typeof(value);
  encoded text;
BEGIN
  IF kind = 'object' THEN
    SELECT '{' || COALESCE(
      string_agg(to_json(key)::text || ':' || trace_migration_canonical_json(item), ',' ORDER BY key COLLATE "C"),
      ''
    ) || '}'
    INTO encoded
    FROM jsonb_each(value) AS fields(key, item);
    RETURN encoded;
  ELSIF kind = 'array' THEN
    SELECT '[' || COALESCE(
      string_agg(trace_migration_canonical_json(item), ',' ORDER BY ordinal),
      ''
    ) || ']'
    INTO encoded
    FROM jsonb_array_elements(value) WITH ORDINALITY AS elements(item, ordinal);
    RETURN encoded;
  END IF;
  RETURN value::text;
END;
$$;

UPDATE trace_case_shells AS shells
SET shell_hash = encode(
  sha256(
    convert_to(
      trace_migration_canonical_json(
        jsonb_build_object(
          'caseNumber', shells.case_number,
          'municipalityId', shells.municipality_id,
          'area', shells.area,
          'category', shells.category,
          'track', shells.track,
          'state', shells.state,
          'text', shells.text,
          'location', shells.location,
          'textStatus', shells.text_status,
          'holdReason', shells.hold_reason,
          'removedReason', shells.removed_reason,
          'textSha256', trim(shells.text_sha256),
          'labels', to_jsonb(shells.labels),
          'closedPublicReason', shells.closed_public_reason,
          'filedAt', to_char(
            shells.filed_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'clockDueAt', CASE
            WHEN shells.clock_due_at IS NULL THEN NULL
            ELSE to_char(shells.clock_due_at, 'YYYY-MM-DD')
          END,
          'followerCount', shells.follower_count,
          'alsoAffectedCount', shells.also_affected_count,
          'notFixedCount', shells.not_fixed_count,
          'disputeCount', shells.dispute_count,
          'noticeCount', shells.notice_count,
          'testEnvironment', true
        )
      ),
      'UTF8'
    )
  ),
  'hex'
);

DROP FUNCTION trace_migration_canonical_json(jsonb);
