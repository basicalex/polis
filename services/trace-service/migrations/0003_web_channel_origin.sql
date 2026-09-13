-- SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
-- SPDX-License-Identifier: AGPL-3.0-or-later

ALTER TABLE trace_records
  DROP CONSTRAINT trace_records_gateway_origin_check,
  ADD CONSTRAINT trace_records_gateway_origin_check
    CHECK ((gateway_actor_id IS NULL) = (filer_kind = 'account'));
