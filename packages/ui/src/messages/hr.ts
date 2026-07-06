import type { MessageKey } from './en.ts';

// Croatian catalog scaffold. Keys are filled in as localization lands
// (post-M15); until then t() falls back to English.
export const hr: Partial<Record<MessageKey, string>> = {};
