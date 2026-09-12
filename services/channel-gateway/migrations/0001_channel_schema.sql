-- SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
-- SPDX-License-Identifier: AGPL-3.0-or-later

CREATE TABLE channel_identities (
  phone_hash char(64) PRIMARY KEY,
  phone_ciphertext bytea NOT NULL,
  phone_nonce bytea NOT NULL,
  phone_tag bytea NOT NULL,
  key_version smallint NOT NULL,
  municipality_id text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  blocked boolean NOT NULL DEFAULT false
);

CREATE TABLE channel_links (
  phone_hash char(64) NOT NULL REFERENCES channel_identities(phone_hash),
  record_id uuid NOT NULL,
  case_number text NOT NULL,
  reopen_key_ciphertext bytea NOT NULL,
  reopen_key_nonce bytea NOT NULL,
  reopen_key_tag bytea NOT NULL,
  key_version smallint NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'voice')),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  last_message_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (phone_hash, record_id)
);

CREATE INDEX channel_links_phone_state_message_idx
  ON channel_links (phone_hash, state, last_message_at DESC);

CREATE TABLE channel_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload_sha256 char(64) NOT NULL,
  state text NOT NULL DEFAULT 'received' CHECK (state IN ('received', 'processed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  received_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE channel_inbox (
  id uuid PRIMARY KEY,
  provider_event_id text UNIQUE,
  kind text NOT NULL CHECK (kind IN ('sms_inbound', 'voice_recording', 'voice_call')),
  phone_hash char(64) NOT NULL,
  body_ciphertext bytea,
  body_nonce bytea,
  body_tag bytea,
  key_version smallint,
  provider_ref text,
  call_control_id text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'processing', 'done', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  last_error text,
  record_id uuid,
  case_number text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX channel_inbox_state_attempt_idx ON channel_inbox (state, next_attempt_at);

CREATE TABLE channel_outbox (
  id uuid PRIMARY KEY,
  source_message_id text UNIQUE,
  record_id uuid NOT NULL,
  case_number text NOT NULL,
  phone_hash char(64) NOT NULL,
  body_ciphertext bytea NOT NULL,
  body_nonce bytea NOT NULL,
  body_tag bytea NOT NULL,
  key_version smallint NOT NULL,
  origin text NOT NULL CHECK (origin IN ('relay', 'confirmation', 'system')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'delivered', 'failed')),
  provider_message_id text,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX channel_outbox_state_attempt_idx ON channel_outbox (state, next_attempt_at);
CREATE INDEX channel_outbox_provider_message_idx ON channel_outbox (provider_message_id);

CREATE TABLE channel_recordings (
  id uuid PRIMARY KEY,
  provider_recording_id text UNIQUE,
  inbox_id uuid REFERENCES channel_inbox(id) ON DELETE SET NULL,
  state text NOT NULL CHECK (state IN ('fetched', 'distorted', 'transcribed', 'discarded', 'failed')),
  distorted_sha256 char(64),
  bytes bytea,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE channel_rate_windows (
  scope text NOT NULL,
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (scope, key, window_start)
);
