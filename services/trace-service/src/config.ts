// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  LocalizedText,
  ParsedTraceConfig,
  PilotConfig,
  PilotSource,
  TraceConfig,
  TraceUnit,
} from './types.js';

export type PilotLoader = () => unknown;

const pilotPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../config/pilots/vrsar-orsera.json',
);

export const loadPilotConfig: PilotLoader = () =>
  JSON.parse(readFileSync(pilotPath, 'utf8')) as unknown;

function hasControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function requiredSecret(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || value.trim() !== value || value.length > 4_096 || hasControl(value)) {
    throw new Error(`${key} is required, bounded, and must not contain unsafe whitespace`);
  }
  return value;
}

function parseActorIds(raw: string | undefined, key: string): Set<string> {
  if (!raw || !raw.trim()) throw new Error(`${key} must be present and nonempty`);
  const values = raw.split(',').map((value) => value.trim());
  if (values.length > 1_000) throw new Error(`${key} contains too many citizen ids`);
  if (values.some((value) => !value || value.length > 200 || hasControl(value))) {
    throw new Error(`${key} contains an invalid citizen id`);
  }
  const unique = new Set(values);
  if (unique.size !== values.length) throw new Error(`${key} must not contain duplicates`);
  return unique;
}

function parseIntakeOpen(raw: string | undefined): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error('TRACE_INTAKE_OPEN must be explicitly true or false');
}

function parseOptionalHttpUrl(raw: string | undefined, key: string): string | null {
  if (raw === undefined || raw === '') return null;
  if (raw.trim() !== raw || raw.length > 2_048 || hasControl(raw)) {
    throw new Error(`${key} must be an absolute HTTP(S) URL without credentials`);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${key} must be an absolute HTTP(S) URL without credentials`);
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(`${key} must be an absolute HTTP(S) URL without credentials`);
  }
  return parsed.href;
}

function parseHoldTerms(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function parseRetentionInterval(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('TRACE_RETENTION_INTERVAL_MINUTES must be a non-negative integer');
  }
  return value;
}

function localized(value: unknown, field: string): LocalizedText {
  if (!value || typeof value !== 'object') throw new Error(`invalid pilot ${field}`);
  const record = value as Record<string, unknown>;
  for (const language of ['hr', 'it', 'en'] as const) {
    if (
      typeof record[language] !== 'string' ||
      !record[language]!.trim() ||
      record[language]!.length > 200 ||
      hasControl(record[language]!)
    ) {
      throw new Error(`invalid pilot ${field}.${language}`);
    }
  }
  return { hr: record.hr as string, it: record.it as string, en: record.en as string };
}

function validDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function source(value: unknown): PilotSource {
  if (!value || typeof value !== 'object') throw new Error('invalid pilot source');
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string' ||
    !item.id ||
    item.id.length > 100 ||
    hasControl(item.id) ||
    typeof item.title !== 'string' ||
    !item.title ||
    item.title.length > 500 ||
    hasControl(item.title) ||
    typeof item.url !== 'string' ||
    item.url.length > 2_048 ||
    !validDateOnly(item.retrievedAt) ||
    !Array.isArray(item.supports) ||
    item.supports.length === 0 ||
    item.supports.length > 20 ||
    item.supports.some(
      (entry) =>
        typeof entry !== 'string' || !entry.trim() || entry.length > 1_000 || hasControl(entry),
    )
  ) {
    throw new Error('invalid pilot source');
  }
  let parsed: URL;
  try {
    parsed = new URL(item.url);
  } catch {
    throw new Error('invalid pilot source URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('invalid pilot source URL');
  }
  return {
    id: item.id,
    title: item.title,
    url: parsed.href,
    retrievedAt: item.retrievedAt,
    supports: [...(item.supports as string[])],
  };
}
function units(value: unknown): TraceUnit[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error('invalid pilot office.units');
  }
  const ids = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('invalid pilot office.units');
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string' || !/^[a-z0-9-]{2,40}$/.test(item.id) || ids.has(item.id)) {
      throw new Error('invalid pilot office.units');
    }
    ids.add(item.id);
    return { id: item.id, name: localized(item.name, `office.units.${item.id}.name`) };
  });
}


export function validatePilotConfig(value: unknown): PilotConfig {
  if (!value || typeof value !== 'object') throw new Error('invalid pilot config');
  const root = value as Record<string, unknown>;
  const municipality = root.municipality as Record<string, unknown> | undefined;
  const caseNumber = municipality?.caseNumber as Record<string, unknown> | undefined;
  const category = root.category as Record<string, unknown> | undefined;
  const office = root.office as Record<string, unknown> | undefined;
  const publicTextMode = root.publicTextMode ?? 'open';
  const publicTextRetentionDays = root.publicTextRetentionDays ?? 730;
  if (
    root.id !== 'vrsar-orsera' ||
    root.testEnvironment !== true ||
    municipality?.id !== 'vrsar-orsera' ||
    typeof caseNumber?.prefix !== 'string' ||
    !/^[A-Z]{2,4}$/.test(caseNumber.prefix) ||
    category?.id !== 'public-lighting' ||
    office?.id !== 'communal-system' ||
    typeof office.routingStatus !== 'string' ||
    !office.routingStatus ||
    office.routingStatus.length > 100 ||
    office.routingStatus.trim() !== office.routingStatus ||
    hasControl(office.routingStatus) ||
    !Array.isArray(root.sources) ||
    root.sources.length === 0 ||
    root.sources.length > 50 ||
    (publicTextMode !== 'open' && publicTextMode !== 'release' && publicTextMode !== 'shell') ||
    !Number.isInteger(publicTextRetentionDays) ||
    (publicTextRetentionDays as number) < 30
  ) {
    throw new Error('pilot config does not match fixed trace authority');
  }
  return {
    id: 'vrsar-orsera',
    testEnvironment: true,
    publicTextMode,
    publicTextRetentionDays: publicTextRetentionDays as number,
    municipality: {
      id: 'vrsar-orsera',
      name: localized(municipality.name, 'municipality.name'),
      caseNumber: { prefix: caseNumber.prefix },
    },
    category: { id: 'public-lighting', name: localized(category.name, 'category.name') },
    office: {
      id: 'communal-system',
      name: localized(office.name, 'office.name'),
      routingStatus: office.routingStatus,
      units: units(office.units),
    },
    sources: root.sources.map(source),
  };
}

export function parseTraceConfig(
  env: NodeJS.ProcessEnv = process.env,
  pilotLoader: PilotLoader = loadPilotConfig,
): ParsedTraceConfig {
  const internalApiToken = requiredSecret(env, 'INTERNAL_API_TOKEN');
  const databaseUrl = requiredSecret(env, 'DATABASE_URL');
  let database: URL;
  try {
    database = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be an explicit PostgreSQL URL');
  }
  if (
    (database.protocol !== 'postgres:' && database.protocol !== 'postgresql:') ||
    !database.hostname ||
    !database.pathname ||
    database.pathname === '/'
  ) {
    throw new Error('DATABASE_URL must be an explicit PostgreSQL URL with a database name');
  }
  const officialIds = parseActorIds(env.TRACE_OFFICIAL_CITIZEN_IDS, 'TRACE_OFFICIAL_CITIZEN_IDS');
  const gatewayIds = parseActorIds(env.TRACE_GATEWAY_ACTOR_IDS, 'TRACE_GATEWAY_ACTOR_IDS');
  for (const id of officialIds) {
    if (gatewayIds.has(id)) {
      throw new Error('trace official and gateway mappings must be disjoint');
    }
  }
  const attentionPepper = requiredSecret(env, 'TRACE_ATTENTION_PEPPER');
  if (attentionPepper.length < 32) {
    throw new Error('TRACE_ATTENTION_PEPPER must contain at least 32 characters');
  }
  const pilot = validatePilotConfig(pilotLoader());
  const pilotCaseNumber = pilot.municipality.caseNumber!;
  const parsedPilot = {
    ...pilot,
    municipality: { ...pilot.municipality, caseNumber: pilotCaseNumber },
  };
  return {
    internalApiToken,
    databaseUrl,
    intakeOpen: parseIntakeOpen(env.TRACE_INTAKE_OPEN),
    officialIds,
    gatewayIds,
    attentionPepper,
    aiIntakeUrl: parseOptionalHttpUrl(env.TRACE_AI_INTAKE_URL, 'TRACE_AI_INTAKE_URL'),
    aiComplianceUrl: parseOptionalHttpUrl(env.TRACE_AI_COMPLIANCE_URL, 'TRACE_AI_COMPLIANCE_URL'),
    holdTerms: parseHoldTerms(env.TRACE_HOLD_TERMS),
    confidentialTerms: parseHoldTerms(env.TRACE_CONFIDENTIAL_TERMS),
    retentionIntervalMinutes: parseRetentionInterval(env.TRACE_RETENTION_INTERVAL_MINUTES),
    caseNumberPrefix: pilotCaseNumber.prefix,
    pilot: parsedPilot,
  };
}

export function publicTraceConfig(config: TraceConfig): Record<string, unknown> {
  return {
    municipality: config.pilot.municipality,
    category: config.pilot.category,
    office: config.pilot.office,
    units: config.pilot.office.units,
    testEnvironment: true,
    intakeOpen: config.intakeOpen,
    publicTextMode: config.pilot.publicTextMode,
    publicTextRetentionDays: config.pilot.publicTextRetentionDays,
    sources: config.pilot.sources,
  };
}
