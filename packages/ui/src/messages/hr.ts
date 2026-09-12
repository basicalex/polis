// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from './en.ts';

// Croatian catalog scaffold. Keys are filled in as localization lands
// (post-M15); until then t() falls back to English.
export const hr: Partial<Record<MessageKey, string>> = {};
