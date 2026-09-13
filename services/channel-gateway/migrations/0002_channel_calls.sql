-- SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
-- SPDX-License-Identifier: AGPL-3.0-or-later

CREATE TABLE channel_calls (
  call_id text PRIMARY KEY,
  phone_hash char(64) NOT NULL,
  case_number text,
  record_id uuid,
  step text NOT NULL CHECK (step IN ('answered', 'prompt', 'readback', 'recording', 'done')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX channel_calls_expires_idx ON channel_calls (expires_at);
