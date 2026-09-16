-- SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
-- SPDX-License-Identifier: AGPL-3.0-or-later

ALTER TABLE channel_links ADD COLUMN closed_at timestamptz;
CREATE INDEX channel_links_state_expires_idx ON channel_links (state, expires_at);
