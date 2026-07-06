import { en, type MessageKey } from './en.ts';
import { hr } from './hr.ts';

export type Locale = 'en' | 'hr';
export type { MessageKey };
export { en, hr };

const catalogs: Record<Locale, Partial<Record<MessageKey, string>>> = { en, hr };

export function t(key: MessageKey, locale: Locale = 'en'): string {
  return catalogs[locale][key] ?? en[key];
}
