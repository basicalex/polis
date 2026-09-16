-- SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Event rows are append-only and hash-chained; the rewrite below only makes
-- sense on a synthetic database. Refuse when review-era rows exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM trace_records
    WHERE status IN ('commitment-pending-review', 'returned', 'published', 'resolution-pending-review')
  ) OR EXISTS (
    SELECT 1 FROM trace_events
    WHERE resulting_status IN ('commitment-pending-review', 'returned', 'published', 'resolution-pending-review')
       OR actor_role = 'reviewer'
  ) OR EXISTS (
    SELECT 1 FROM trace_public_snapshots WHERE public_status = 'published'
  ) THEN
    RAISE EXCEPTION 'migration 0004: review-era rows present; reset this synthetic database and re-seed before migrating';
  END IF;
END;
$$;
ALTER TABLE trace_records
  ADD COLUMN text_status text NOT NULL DEFAULT 'public'
    CHECK (text_status IN ('public', 'held', 'redacted')),
  ADD COLUMN hold_reason text
    CHECK (hold_reason IN ('personal-data', 'abuse', 'off-topic', 'other')),
  ADD COLUMN text_sha256 char(64),
  ADD COLUMN redacted_text text,
  ADD COLUMN labels text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN not_fixed_count integer NOT NULL DEFAULT 0 CHECK (not_fixed_count >= 0),
  ADD COLUMN dispute_count integer NOT NULL DEFAULT 0 CHECK (dispute_count >= 0),
  ADD COLUMN signed_by_name text,
  ADD COLUMN signed_by_title text,
  ADD CONSTRAINT trace_records_text_visibility_check CHECK (
    (text_status = 'held' AND hold_reason IS NOT NULL AND redacted_text IS NULL)
    OR (text_status = 'public' AND hold_reason IS NULL AND redacted_text IS NULL)
    OR (text_status = 'redacted' AND hold_reason IS NULL AND redacted_text IS NOT NULL)
  ),
  ADD CONSTRAINT trace_records_labels_check CHECK (labels <@ ARRAY['form-letter']::text[]);

UPDATE trace_records AS records
SET text_sha256 = encode(
  sha256(
    convert_to(
      trim(
        regexp_replace(
          regexp_replace(
            lower(normalize(private.narrative, NFKC)),
            '[^[:alnum:][:space:]]+',
            ' ',
            'g'
          ),
          '[[:space:]]+',
          ' ',
          'g'
        )
      ),
      'UTF8'
    )
  ),
  'hex'
)
FROM trace_report_private AS private
WHERE private.record_id = records.id;

ALTER TABLE trace_records ALTER COLUMN text_sha256 SET NOT NULL;

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

ALTER TABLE trace_records DROP CONSTRAINT trace_records_status_check;
ALTER TABLE trace_events
  DROP CONSTRAINT trace_events_resulting_status_check,
  DROP CONSTRAINT trace_events_actor_role_check;
ALTER TABLE trace_events DISABLE TRIGGER trace_events_reject_update;

UPDATE trace_records SET status = CASE status
  WHEN 'commitment-pending-review' THEN 'assigned'
  WHEN 'returned' THEN 'assigned'
  WHEN 'published' THEN 'answered'
  WHEN 'resolution-pending-review' THEN 'answered'
  ELSE status
END;

DO $$
DECLARE
  event_row record;
  current_record_id uuid;
  mapped_status text;
  new_previous_hash text;
  new_hash text;
  material jsonb;
BEGIN
  FOR event_row IN
    SELECT * FROM trace_events ORDER BY record_id, sequence
  LOOP
    IF current_record_id IS DISTINCT FROM event_row.record_id THEN
      current_record_id := event_row.record_id;
      new_previous_hash := NULL;
    END IF;
    mapped_status := CASE event_row.resulting_status
      WHEN 'commitment-pending-review' THEN 'assigned'
      WHEN 'returned' THEN 'assigned'
      WHEN 'published' THEN 'answered'
      WHEN 'resolution-pending-review' THEN 'answered'
      ELSE event_row.resulting_status
    END;
    material := jsonb_build_object(
      'id', event_row.id::text,
      'recordId', event_row.record_id::text,
      'sequence', event_row.sequence,
      'previousHash', new_previous_hash,
      'stage', event_row.stage,
      'action', event_row.action,
      'actorId', event_row.actor_id,
      'actorRole', event_row.actor_role,
      'note', event_row.note,
      'payload', event_row.payload,
      'resultingVersion', event_row.resulting_version,
      'resultingStatus', mapped_status,
      'createdAt', to_char(
        event_row.created_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    );
    new_hash := encode(
      sha256(convert_to(trace_migration_canonical_json(material), 'UTF8')),
      'hex'
    );
    UPDATE trace_events
    SET
      previous_hash = new_previous_hash,
      hash = new_hash,
      resulting_status = mapped_status
    WHERE id = event_row.id;
    new_previous_hash := new_hash;
  END LOOP;
END;
$$;

ALTER TABLE trace_events ENABLE TRIGGER trace_events_reject_update;

ALTER TABLE trace_records
  ADD CONSTRAINT trace_records_status_check
    CHECK (status IN ('open', 'assigned', 'answered', 'resolved', 'disputed', 'closed'));

ALTER TABLE trace_events
  ADD CONSTRAINT trace_events_resulting_status_check
    CHECK (resulting_status IN ('open', 'assigned', 'answered', 'resolved', 'disputed', 'closed'));
-- Keep the legacy reviewer value only when historical event rows still use it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM trace_events WHERE actor_role = 'reviewer') THEN
    ALTER TABLE trace_events ADD CONSTRAINT trace_events_actor_role_check
      CHECK (actor_role IN ('resident', 'official', 'gateway', 'system', 'reviewer'));
  ELSE
    ALTER TABLE trace_events ADD CONSTRAINT trace_events_actor_role_check
      CHECK (actor_role IN ('resident', 'official', 'gateway', 'system'));
  END IF;
END;
$$;

ALTER TABLE trace_public_snapshots
  DROP CONSTRAINT trace_public_snapshots_public_status_check,
  ALTER COLUMN public_summary DROP NOT NULL,
  ADD COLUMN signed_by_name text,
  ADD COLUMN signed_by_title text,
  ADD COLUMN disputes jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(disputes) = 'array');

-- Pre-policy snapshots have no signer name or title. Keep them readable with an
-- explicit provenance gap rather than publishing an internal actor identifier.
UPDATE trace_public_snapshots
SET
  public_status = CASE public_status WHEN 'published' THEN 'answered' ELSE public_status END,
  signed_by_name = COALESCE(signed_by_name, 'Not recorded (pre-policy)'),
  signed_by_title = COALESCE(signed_by_title, 'Not recorded (pre-policy)'),
  disputes = '[]'::jsonb,
  public_events = '[]'::jsonb;

UPDATE trace_records AS records
SET
  signed_by_name = snapshots.signed_by_name,
  signed_by_title = snapshots.signed_by_title
FROM trace_public_snapshots AS snapshots
WHERE snapshots.record_id = records.id
  AND (records.signed_by_name IS NULL OR records.signed_by_title IS NULL);

UPDATE trace_public_snapshots AS snapshots
SET receipt_hash = encode(
  sha256(
    convert_to(
      trace_migration_canonical_json(
        jsonb_build_object(
          'id', snapshots.record_id::text,
          'municipalityId', snapshots.municipality_id,
          'category', snapshots.category,
          'office', snapshots.office,
          'status', snapshots.public_status,
          'commitment', snapshots.commitment,
          'dueDate', to_char(snapshots.due_date, 'YYYY-MM-DD'),
          'signedBy', jsonb_build_object(
            'name', snapshots.signed_by_name,
            'title', snapshots.signed_by_title
          ),
          'evidenceNote', snapshots.evidence_note,
          'evidenceUrls', snapshots.evidence_urls,
          'publishedAt', to_char(
            snapshots.published_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'resolvedAt', CASE
            WHEN snapshots.resolved_at IS NULL THEN NULL
            ELSE to_char(
              snapshots.resolved_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
          END,
          'disputes', snapshots.disputes,
          'events', snapshots.public_events,
          'testEnvironment', true
        )
      ),
      'UTF8'
    )
  ),
  'hex'
);

ALTER TABLE trace_public_snapshots
  ADD CONSTRAINT trace_public_snapshots_public_status_check
    CHECK (public_status IN ('answered', 'resolved', 'disputed')),
  ALTER COLUMN signed_by_name SET NOT NULL,
  ALTER COLUMN signed_by_title SET NOT NULL;

DROP FUNCTION trace_migration_canonical_json(jsonb);

ALTER TABLE trace_case_shells
  DROP CONSTRAINT trace_case_shells_state_check,
  DROP CONSTRAINT trace_case_shells_check,
  ADD COLUMN text text,
  ADD COLUMN location text,
  ADD COLUMN text_status text NOT NULL DEFAULT 'public'
    CHECK (text_status IN ('public', 'held', 'redacted')),
  ADD COLUMN hold_reason text
    CHECK (hold_reason IN ('personal-data', 'abuse', 'off-topic', 'other')),
  ADD COLUMN text_sha256 char(64),
  ADD COLUMN labels text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN not_fixed_count integer NOT NULL DEFAULT 0 CHECK (not_fixed_count >= 0),
  ADD COLUMN dispute_count integer NOT NULL DEFAULT 0 CHECK (dispute_count >= 0);

UPDATE trace_case_shells AS shells
SET
  state = CASE records.status WHEN 'open' THEN 'received' ELSE records.status END,
  text = private.narrative,
  location = private.location,
  text_status = records.text_status,
  hold_reason = records.hold_reason,
  text_sha256 = records.text_sha256,
  labels = records.labels,
  not_fixed_count = records.not_fixed_count,
  dispute_count = records.dispute_count
FROM trace_records AS records
JOIN trace_report_private AS private ON private.record_id = records.id
WHERE shells.record_id = records.id;

ALTER TABLE trace_case_shells
  ALTER COLUMN text_sha256 SET NOT NULL,
  ADD CONSTRAINT trace_case_shells_state_check
    CHECK (state IN ('received', 'assigned', 'answered', 'resolved', 'disputed', 'closed')),
  ADD CONSTRAINT trace_case_shells_closed_reason_check
    CHECK ((state = 'closed') = (closed_public_reason IS NOT NULL)),
  ADD CONSTRAINT trace_case_shells_text_visibility_check CHECK (
    (text_status = 'held' AND text IS NULL AND location IS NULL AND hold_reason IS NOT NULL)
    OR (text_status IN ('public', 'redacted') AND text IS NOT NULL AND location IS NOT NULL AND hold_reason IS NULL)
  ),
  ADD CONSTRAINT trace_case_shells_labels_check CHECK (labels <@ ARRAY['form-letter']::text[]);

UPDATE trace_case_shells
SET shell_hash = encode(
  sha256(
    convert_to(
      concat(
        '{"alsoAffectedCount":', also_affected_count,
        ',"area":', to_json(area)::text,
        ',"caseNumber":', to_json(case_number)::text,
        ',"category":', to_json(category)::text,
        ',"clockDueAt":', CASE WHEN clock_due_at IS NULL THEN 'null' ELSE to_json(to_char(clock_due_at, 'YYYY-MM-DD'))::text END,
        ',"closedPublicReason":', COALESCE(to_json(closed_public_reason)::text, 'null'),
        ',"disputeCount":', dispute_count,
        ',"filedAt":', to_json(to_char(filed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text,
        ',"followerCount":', follower_count,
        ',"holdReason":', COALESCE(to_json(hold_reason)::text, 'null'),
        ',"labels":', to_json(labels)::text,
        ',"location":', COALESCE(to_json(location)::text, 'null'),
        ',"municipalityId":', to_json(municipality_id)::text,
        ',"notFixedCount":', not_fixed_count,
        ',"state":', to_json(state)::text,
        ',"testEnvironment":true',
        ',"text":', COALESCE(to_json(text)::text, 'null'),
        ',"textSha256":', to_json(trim(text_sha256))::text,
        ',"textStatus":', to_json(text_status)::text,
        ',"track":', to_json(track)::text,
        '}'
      ),
      'UTF8'
    )
  ),
  'hex'
);

ALTER TABLE trace_case_attention
  DROP CONSTRAINT trace_case_attention_kind_check,
  ADD CONSTRAINT trace_case_attention_kind_check
    CHECK (kind IN ('follow', 'also-affected', 'not-fixed'));

ALTER TABLE trace_case_messages
  DROP CONSTRAINT trace_case_messages_kind_check,
  ADD CONSTRAINT trace_case_messages_kind_check
    CHECK (kind IN (
      'append', 'label-appeal', 'dispute', 'answer', 'question', 'status-update',
      'receipt', 'transcript', 'transcript-failed'
    ));
