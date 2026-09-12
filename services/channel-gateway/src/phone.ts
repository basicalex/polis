// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

export function normalizeE164(input: string, defaultCountry = 'HR'): string {
  if (defaultCountry !== 'HR') throw new Error('defaultCountry must be HR');
  const trimmed = input.trim();
  if (!trimmed || !/^[+\d\s().-]+$/.test(trimmed)) throw new Error('phone number is invalid');
  const compact = trimmed.replace(/[\s().-]/g, '');
  let national: string;
  if (compact.startsWith('+385')) national = compact.slice(4);
  else if (compact.startsWith('00385')) national = compact.slice(5);
  else if (compact.startsWith('0')) national = compact.slice(1);
  else throw new Error('phone number must be Croatian E.164 or national format');
  if (!/^[1-9]\d{7,8}$/.test(national)) throw new Error('phone number is not valid Croatian E.164');
  return `+385${national}`;
}
