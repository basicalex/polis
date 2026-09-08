CREATE TABLE trace_records (
  id uuid PRIMARY KEY,
  municipality_id text NOT NULL CHECK (municipality_id = 'vrsar-orsera'),
  category text NOT NULL CHECK (category = 'public-lighting'),
  office text NOT NULL CHECK (office = 'communal-system'),
  owner_actor_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'assigned', 'commitment-pending-review', 'returned', 'published', 'resolution-pending-review', 'resolved')),
  version integer NOT NULL CHECK (version >= 0),
  public_summary text,
  commitment text,
  due_date date,
  evidence_note text,
  evidence_urls jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_urls) = 'array'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX trace_records_owner_created_idx ON trace_records (owner_actor_id, created_at DESC);
CREATE INDEX trace_records_queue_idx ON trace_records (municipality_id, updated_at DESC);

CREATE TABLE trace_report_private (
  record_id uuid PRIMARY KEY REFERENCES trace_records(id) ON DELETE RESTRICT,
  subject text NOT NULL,
  narrative text NOT NULL,
  location text NOT NULL,
  contact_email text
);

CREATE TABLE trace_record_participants (
  record_id uuid NOT NULL REFERENCES trace_records(id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  filed_report boolean NOT NULL DEFAULT false,
  acted_as_official boolean NOT NULL DEFAULT false,
  PRIMARY KEY (record_id, actor_id)
);

CREATE TABLE trace_events (
  id uuid PRIMARY KEY,
  record_id uuid NOT NULL REFERENCES trace_records(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  previous_hash char(64),
  hash char(64) NOT NULL,
  stage text NOT NULL CHECK (stage IN ('voice', 'responsibility', 'response', 'check', 'receipt')),
  action text NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('resident', 'official', 'reviewer')),
  note text,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  resulting_version integer NOT NULL CHECK (resulting_version >= 0),
  resulting_status text NOT NULL CHECK (resulting_status IN ('open', 'assigned', 'commitment-pending-review', 'returned', 'published', 'resolution-pending-review', 'resolved')),
  created_at timestamptz NOT NULL,
  UNIQUE (record_id, sequence)
);

CREATE INDEX trace_events_record_sequence_idx ON trace_events (record_id, sequence);

CREATE FUNCTION trace_reject_event_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trace_events are append-only';
END;
$$;

CREATE TRIGGER trace_events_reject_update
BEFORE UPDATE ON trace_events
FOR EACH ROW EXECUTE FUNCTION trace_reject_event_mutation();

CREATE TRIGGER trace_events_reject_delete
BEFORE DELETE ON trace_events
FOR EACH ROW EXECUTE FUNCTION trace_reject_event_mutation();

CREATE TABLE trace_command_idempotency (
  actor_id text NOT NULL,
  idempotency_key uuid NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  request_hash char(64) NOT NULL,
  record_id uuid REFERENCES trace_records(id) ON DELETE RESTRICT,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (actor_id, idempotency_key),
  CHECK ((response_status IS NULL) = (response_body IS NULL))
);

CREATE INDEX trace_command_idempotency_record_idx ON trace_command_idempotency (record_id);

CREATE TABLE trace_attachments (
  id uuid PRIMARY KEY,
  record_id uuid NOT NULL REFERENCES trace_records(id) ON DELETE RESTRICT,
  filename text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('application/pdf', 'image/png', 'image/jpeg', 'text/plain')),
  content bytea NOT NULL,
  byte_count integer NOT NULL CHECK (byte_count >= 0 AND byte_count <= 2097152),
  sha256 char(64) NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX trace_attachments_record_created_idx ON trace_attachments (record_id, created_at);

CREATE TABLE trace_public_snapshots (
  record_id uuid PRIMARY KEY REFERENCES trace_records(id) ON DELETE RESTRICT,
  municipality_id text NOT NULL CHECK (municipality_id = 'vrsar-orsera'),
  category text NOT NULL CHECK (category = 'public-lighting'),
  office text NOT NULL CHECK (office = 'communal-system'),
  public_status text NOT NULL CHECK (public_status IN ('published', 'resolved')),
  public_summary text NOT NULL,
  commitment text NOT NULL,
  due_date date NOT NULL,
  evidence_note text,
  evidence_urls jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_urls) = 'array'),
  published_at timestamptz NOT NULL,
  resolved_at timestamptz,
  public_events jsonb NOT NULL CHECK (jsonb_typeof(public_events) = 'array'),
  receipt_hash char(64) NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX trace_public_snapshots_updated_idx ON trace_public_snapshots (updated_at DESC);
