import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LocalizedText, PilotConfig, PilotSource, TraceConfig } from './types.js';

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

export function validatePilotConfig(value: unknown): PilotConfig {
  if (!value || typeof value !== 'object') throw new Error('invalid pilot config');
  const root = value as Record<string, unknown>;
  const municipality = root.municipality as Record<string, unknown> | undefined;
  const category = root.category as Record<string, unknown> | undefined;
  const office = root.office as Record<string, unknown> | undefined;
  if (
    root.id !== 'vrsar-orsera' ||
    root.testEnvironment !== true ||
    municipality?.id !== 'vrsar-orsera' ||
    category?.id !== 'public-lighting' ||
    office?.id !== 'communal-system' ||
    typeof office.routingStatus !== 'string' ||
    !office.routingStatus ||
    office.routingStatus.length > 100 ||
    office.routingStatus.trim() !== office.routingStatus ||
    hasControl(office.routingStatus) ||
    !Array.isArray(root.sources) ||
    root.sources.length === 0 ||
    root.sources.length > 50
  ) {
    throw new Error('pilot config does not match fixed trace authority');
  }
  return {
    id: 'vrsar-orsera',
    testEnvironment: true,
    municipality: { id: 'vrsar-orsera', name: localized(municipality.name, 'municipality.name') },
    category: { id: 'public-lighting', name: localized(category.name, 'category.name') },
    office: {
      id: 'communal-system',
      name: localized(office.name, 'office.name'),
      routingStatus: office.routingStatus,
    },
    sources: root.sources.map(source),
  };
}

export function parseTraceConfig(
  env: NodeJS.ProcessEnv = process.env,
  pilotLoader: PilotLoader = loadPilotConfig,
): TraceConfig {
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
  const reviewerIds = parseActorIds(env.TRACE_REVIEWER_CITIZEN_IDS, 'TRACE_REVIEWER_CITIZEN_IDS');
  for (const id of officialIds) {
    if (reviewerIds.has(id))
      throw new Error('trace official and reviewer mappings must be disjoint');
  }
  return {
    internalApiToken,
    databaseUrl,
    intakeOpen: parseIntakeOpen(env.TRACE_INTAKE_OPEN),
    officialIds,
    reviewerIds,
    pilot: validatePilotConfig(pilotLoader()),
  };
}

export function publicTraceConfig(config: TraceConfig): Record<string, unknown> {
  return {
    municipality: config.pilot.municipality,
    category: config.pilot.category,
    office: config.pilot.office,
    testEnvironment: true,
    intakeOpen: config.intakeOpen,
    sources: config.pilot.sources,
  };
}
