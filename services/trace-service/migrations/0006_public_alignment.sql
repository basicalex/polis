-- SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
-- SPDX-License-Identifier: AGPL-3.0-or-later

ALTER TABLE trace_records
  ADD COLUMN text_normalized_sha256 char(64),
  ADD COLUMN text_hash_kind text DEFAULT 'raw'
    CHECK (text_hash_kind IN ('raw', 'normalized-legacy')),
  ADD COLUMN unit_id text;

UPDATE trace_records AS records
SET
  text_normalized_sha256 = records.text_sha256,
  text_hash_kind = CASE
    WHEN EXISTS (
      SELECT 1 FROM trace_report_private AS material WHERE material.record_id = records.id
    ) THEN 'raw'
    ELSE 'normalized-legacy'
  END,
  text_sha256 = COALESCE(
    (
      SELECT encode(sha256(convert_to(material.narrative, 'UTF8')), 'hex')
      FROM trace_report_private AS material
      WHERE material.record_id = records.id
    ),
    records.text_sha256
  );

ALTER TABLE trace_case_shells
  ADD COLUMN text_hash_kind text DEFAULT 'raw'
    CHECK (text_hash_kind IN ('raw', 'normalized-legacy')),
  ADD COLUMN unit_id text;

UPDATE trace_case_shells AS shells
SET
  text_sha256 = records.text_sha256,
  text_hash_kind = records.text_hash_kind,
  unit_id = records.unit_id
FROM trace_records AS records
WHERE records.id = shells.record_id;

CREATE TABLE trace_officials (
  citizen_id text PRIMARY KEY,
  name text NOT NULL,
  title text NOT NULL,
  unit_id text NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX trace_case_shells_state_updated_idx
  ON trace_case_shells (state, updated_at DESC, case_number ASC);

CREATE FUNCTION trace_alignment_canonical_json(value jsonb) RETURNS text
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
      string_agg(to_json(key)::text || ':' || trace_alignment_canonical_json(item), ',' ORDER BY key COLLATE "C"),
      ''
    ) || '}'
    INTO encoded
    FROM jsonb_each(value) AS fields(key, item);
    RETURN encoded;
  ELSIF kind = 'array' THEN
    SELECT '[' || COALESCE(
      string_agg(trace_alignment_canonical_json(item), ',' ORDER BY ordinal),
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
      trace_alignment_canonical_json(
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
          'textHashKind', shells.text_hash_kind,
          'unitId', shells.unit_id,
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

DO $$
DECLARE
  snapshot record;
  public_event jsonb;
  material jsonb;
  chained jsonb;
  previous_hash text;
  current_hash text;
BEGIN
  FOR snapshot IN
    SELECT record_id, public_events, signed_by_name, signed_by_title
    FROM trace_public_snapshots
  LOOP
    chained := '[]'::jsonb;
    previous_hash := '';
    FOR public_event IN
      SELECT item
      FROM jsonb_array_elements(snapshot.public_events) WITH ORDINALITY AS elements(item, ordinal)
      ORDER BY ordinal
    LOOP
      material := public_event - 'hash' - 'previousHash';
      IF material ->> 'action' = 'office-assigned' AND NOT (material ? 'unit') THEN
        material := material || jsonb_build_object('unit', NULL);
      END IF;
      IF material ->> 'action' = 'commitment-published'
        AND jsonb_typeof(material -> 'signedBy') = 'string'
      THEN
        material := material || jsonb_build_object(
          'signedBy',
          jsonb_build_object(
            'name', COALESCE(material ->> 'signedBy', snapshot.signed_by_name),
            'title', snapshot.signed_by_title
          )
        );
      END IF;
      IF material ->> 'action' = 'completion-reported' AND NOT (material ? 'signedBy') THEN
        material := material || jsonb_build_object(
          'signedBy',
          jsonb_build_object(
            'name', snapshot.signed_by_name,
            'title', snapshot.signed_by_title
          )
        );
      END IF;
      current_hash := encode(
        sha256(
          convert_to(trace_alignment_canonical_json(material) || previous_hash, 'UTF8')
        ),
        'hex'
      );
      chained := chained || jsonb_build_array(
        material || jsonb_build_object('previousHash', previous_hash, 'hash', current_hash)
      );
      previous_hash := current_hash;
    END LOOP;
    UPDATE trace_public_snapshots
    SET public_events = chained
    WHERE record_id = snapshot.record_id;
  END LOOP;
END;
$$;

UPDATE trace_public_snapshots AS snapshots
SET receipt_hash = encode(
  sha256(
    convert_to(
      trace_alignment_canonical_json(
        jsonb_build_object(
          'id', snapshots.record_id,
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
          'lastEventHash', COALESCE(snapshots.public_events -> -1 ->> 'hash', ''),
          'events', snapshots.public_events,
          'testEnvironment', true
        )
      ),
      'UTF8'
    )
  ),
  'hex'
);

DROP FUNCTION trace_alignment_canonical_json(jsonb);
