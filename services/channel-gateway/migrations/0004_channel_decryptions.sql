-- SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
-- SPDX-License-Identifier: AGPL-3.0-or-later

CREATE TABLE channel_decryptions (
  id uuid PRIMARY KEY,
  phone_hash_prefix char(8) NOT NULL,
  reason text NOT NULL CHECK (reason IN ('outbound-sms', 'reveal')),
  case_number text,
  request_ref text,
  actor text NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (reason <> 'reveal' OR request_ref IS NOT NULL)
);
