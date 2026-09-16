// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';

import { internalHeaders } from '@polis/service-runtime';
import type { HoldReason } from './types.js';

const EMAIL_PATTERN = /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+\b/i;
const PHONE_PATTERN = /(?<!\d)(?:\+385(?:[\s/-]?\d){8,9}|09\d(?:[\s/-]?\d){6,7})(?!(?:[\s/-]?\d))/;
const OIB_PATTERN = /(?<!\d)\d{11}(?!\d)/g;
const PLATE_PATTERN = /(?<![\p{L}\d])[A-ZŠĐČĆŽ]{2}[ -]?\d{3,4}[ -]?[A-ZŠĐČĆŽ]{1,2}(?![\p{L}\d])/u;
const TERM_EDGE = '[\\p{L}\\p{N}_]';
const BUILT_IN_HOLD_TERMS = [
  'peder',
  'pederčina',
  'cigan',
  'ciganin',
  'ustaško smeće',
  'četničko smeće',
  'jebem ti',
  'zaklat ću te',
  'ubit ću te',
  'spalit ću te',
  'nigger',
  'faggot',
  'kike',
  'chink',
  'retard',
  'cunt',
  'kill you',
  'murder you',
  'shoot you',
  'bomb you',
] as const;

export const CONFIDENTIAL_TERMS = [
  'mito',
  'namještanje natječaja',
  'zlouporaba položaja',
  'zviždač',
  'prijavljujem nepravilnost',
  'corruption',
  'bribe',
  'bribery',
  'kickback',
  'rigged procurement',
  'abuse of office',
  'whistleblower',
  'whistleblowing',
] as const;

export const SPECIAL_CATEGORY_TERMS = [
  'zdravstveno stanje',
  'boluje od dijabetesa',
  'hiv pozitivan',
  'multipla skleroza',
  'etnička pripadnost',
  'nacionalna pripadnost',
  'vjerska pripadnost',
  'seksualna orijentacija',
  'član političke stranke',
  'političko članstvo',
  'član sindikata',
  'sindikalno članstvo',
  'podaci treće osobe',
  'osobni podaci susjeda',
  'ime i prezime susjeda',
] as const;

function hasEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

function hasCroatianPhone(value: string): boolean {
  return PHONE_PATTERN.test(value);
}

function isValidOib(value: string): boolean {
  let remainder = 10;
  for (const digit of value.slice(0, 10)) {
    remainder = (remainder + Number(digit)) % 10;
    if (remainder === 0) remainder = 10;
    remainder = (remainder * 2) % 11;
  }
  const checkDigit = 11 - remainder;
  return Number(value[10]) === (checkDigit === 10 ? 0 : checkDigit);
}

function hasOib(value: string): boolean {
  for (const match of value.matchAll(OIB_PATTERN)) {
    if (isValidOib(match[0])) return true;
  }
  return false;
}

function hasCroatianPlate(value: string): boolean {
  return PLATE_PATTERN.test(value.normalize('NFKC').toUpperCase());
}

function holdTermPattern(rawTerm: string): RegExp | null {
  const term = rawTerm.normalize('NFKC').toLowerCase().trim();
  if (!term) return null;
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<!${TERM_EDGE})${escapedTerm}(?!${TERM_EDGE})`, 'u');
}

const BUILT_IN_HOLD_PATTERNS = BUILT_IN_HOLD_TERMS.map(holdTermPattern).filter(
  (pattern): pattern is RegExp => pattern !== null,
);

const CONFIDENTIAL_PATTERNS = [
  ...CONFIDENTIAL_TERMS.map(holdTermPattern).filter(
    (pattern): pattern is RegExp => pattern !== null,
  ),
  /(?<![\p{L}\p{N}_])korupcij\p{L}*(?![\p{L}\p{N}_])/u,
] as const;
const SPECIAL_CATEGORY_PATTERNS = SPECIAL_CATEGORY_TERMS.map(holdTermPattern).filter(
  (pattern): pattern is RegExp => pattern !== null,
);

function hasHoldTerm(value: string, configuredTerms: readonly string[]): boolean {
  const normalizedValue = value.normalize('NFKC').toLowerCase();
  if (BUILT_IN_HOLD_PATTERNS.some((pattern) => pattern.test(normalizedValue))) return true;
  for (const rawTerm of configuredTerms) {
    const pattern = holdTermPattern(rawTerm);
    if (pattern?.test(normalizedValue)) return true;
  }
  return false;
}

function hasPatterns(value: string, patterns: readonly RegExp[]): boolean {
  const normalizedValue = value.normalize('NFKC').toLowerCase();
  return patterns.some((pattern) => pattern.test(normalizedValue));
}

function hasConfidentialTerm(value: string, configuredTerms: readonly string[]): boolean {
  if (hasPatterns(value, CONFIDENTIAL_PATTERNS)) return true;
  return configuredTerms.some((term) =>
    holdTermPattern(term)?.test(value.normalize('NFKC').toLowerCase()),
  );
}

const HOLD_RANK: Record<HoldReason, number> = {
  confidential: 4,
  'personal-data': 3,
  abuse: 2,
  'off-topic': 1,
  other: 1,
  'pending-release': 0,
  policy: 0,
  notices: 0,
};

function strongerHold(current: HoldReason | null, candidate: HoldReason | null): HoldReason | null {
  if (candidate === null) return current;
  if (current === null || HOLD_RANK[candidate] > HOLD_RANK[current]) return candidate;
  return current;
}

export function isHoldReason(value: unknown): value is HoldReason {
  return (
    value === 'personal-data' ||
    value === 'abuse' ||
    value === 'off-topic' ||
    value === 'other' ||
    value === 'confidential'
  );
}

interface GatewayReply {
  hold: HoldReason | null;
  formLetterScore: number;
  note?: string;
}

function parseGatewayReply(value: unknown): GatewayReply | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<GatewayReply>;
  if (candidate.hold !== null && !isHoldReason(candidate.hold)) return null;
  if (
    typeof candidate.formLetterScore !== 'number' ||
    !Number.isFinite(candidate.formLetterScore)
  ) {
    return null;
  }
  if (candidate.note !== undefined && typeof candidate.note !== 'string') return null;
  return candidate as GatewayReply;
}

export interface AssessTextInput {
  text: string;
  location: string | null;
  municipalityId: string;
  recentNarrativeHashes: string[];
}

export interface AssessTextDeps {
  gatewayUrl: string | null;
  holdTerms: string[];
  confidentialTerms: string[];
  fetch?: typeof fetch;
}

export interface AssessTextResult {
  hold: HoldReason | null;
  formLetter: boolean;
  signals: string[];
  normalizedSha256: string;
}

export function normalizeNarrative(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizedSha256(text: string): string {
  return createHash('sha256').update(normalizeNarrative(text)).digest('hex');
}

export async function assessText(
  input: AssessTextInput,
  deps: AssessTextDeps,
): Promise<AssessTextResult> {
  const combinedText = input.location ? `${input.text}\n${input.location}` : input.text;
  const signals: string[] = [];

  const email = hasEmail(combinedText);
  const phone = hasCroatianPhone(combinedText);
  const oib = hasOib(combinedText);
  const plate = hasCroatianPlate(combinedText);
  const holdTerm = hasHoldTerm(combinedText, deps.holdTerms);
  const confidential = hasConfidentialTerm(combinedText, deps.confidentialTerms);
  const specialCategory = hasPatterns(combinedText, SPECIAL_CATEGORY_PATTERNS);

  if (email) signals.push('local:email');
  if (phone) signals.push('local:phone');
  if (oib) signals.push('local:oib');
  if (plate) signals.push('local:plate');
  if (holdTerm) signals.push('local:hold-term');
  if (confidential) signals.push('local:confidential');
  if (specialCategory) signals.push('local:special-category');

  const hasPersonalData = email || phone || oib || plate || specialCategory;
  let hold: HoldReason | null = null;
  hold = strongerHold(hold, holdTerm ? 'abuse' : null);
  hold = strongerHold(hold, hasPersonalData ? 'personal-data' : null);
  hold = strongerHold(hold, confidential ? 'confidential' : null);

  const hash = normalizedSha256(input.text);
  let formLetter = input.recentNarrativeHashes.includes(hash);
  if (formLetter) signals.push('local:duplicate');

  if (deps.gatewayUrl) {
    try {
      const fetchImpl = deps.fetch ?? globalThis.fetch;
      const response = await fetchImpl(
        `${deps.gatewayUrl.replace(/\/+$/, '')}/internal/ai/compliance`,
        {
          method: 'POST',
          headers: internalHeaders(),
          body: JSON.stringify({
            text: input.text,
            location: input.location,
            language: 'hr',
          }),
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) throw new Error(`ai_compliance_http_${response.status}`);
      const reply = parseGatewayReply(await response.json());
      if (!reply) throw new Error('ai_compliance_invalid_response');

      const gatewayHold = strongerHold(hold, reply.hold);
      if (gatewayHold !== hold) {
        hold = gatewayHold;
        signals.push('gateway:hold');
      }
      if (reply.formLetterScore >= 0.8) {
        formLetter = true;
        signals.push('gateway:form-letter');
      }
    } catch {
      signals.push('gateway:skipped');
    }
  }

  return {
    hold,
    formLetter,
    signals,
    normalizedSha256: hash,
  };
}
