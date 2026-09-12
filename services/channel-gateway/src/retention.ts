// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChannelStore } from './store.js';
import type { PurgeCounts } from './types.js';

export async function purgeExpired(
  store: ChannelStore,
  now: Date = new Date(),
): Promise<PurgeCounts> {
  return store.purgeExpired(now);
}
