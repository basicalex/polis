// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PilotLang } from '../../../content/pilot/vrsar';

export type PilotRole = 'resident' | 'official' | 'reviewer';
export type TraceStatus =
  | 'open'
  | 'assigned'
  | 'commitment-pending-review'
  | 'returned'
  | 'published'
  | 'resolution-pending-review'
  | 'resolved';

export interface LocalizedName {
  hr?: string;
  it?: string;
  en?: string;
  [key: string]: unknown;
}

export interface PilotConfigEntity {
  id?: string;
  name?: LocalizedName | string;
  label?: LocalizedName | string;
  [key: string]: unknown;
}

export interface PilotSource {
  label?: LocalizedName | string;
  name?: LocalizedName | string;
  title?: LocalizedName | string;
  url: string;
}

export interface PilotConfig {
  municipality: PilotConfigEntity;
  category: PilotConfigEntity;
  office: PilotConfigEntity;
  testEnvironment: true;
  intakeOpen: boolean;
  sources: PilotSource[];
}

export interface PilotSession {
  actorId: string;
  email?: string;
  role: PilotRole;
  municipalityId: string;
}

export interface TraceAttachment {
  id: string;
  filename: string;
  contentType?: string;
  size?: number;
  sha256?: string;
  createdAt?: string;
}

export interface TraceEvent {
  id?: string;
  sequence?: number;
  stage: 'voice' | 'responsibility' | 'response' | 'check' | 'receipt' | string;
  action: string;
  actorRole: PilotRole | string;
  note?: string;
  createdAt: string;
  previousHash?: string;
  hash?: string;
}

export function latestTraceEvent(events: readonly TraceEvent[], stage: string): TraceEvent | undefined {
  let selected: TraceEvent | undefined;
  let selectedIndex = -1;
  for (const [index, event] of events.entries()) {
    if (event.stage !== stage) continue;
    if (!selected) {
      selected = event;
      selectedIndex = index;
      continue;
    }
    const eventSequence = typeof event.sequence === 'number' ? event.sequence : null;
    const selectedSequence = typeof selected.sequence === 'number' ? selected.sequence : null;
    if (eventSequence !== null && selectedSequence !== null && eventSequence !== selectedSequence) {
      if (eventSequence > selectedSequence) {
        selected = event;
        selectedIndex = index;
      }
      continue;
    }
    const eventTime = Date.parse(event.createdAt);
    const selectedTime = Date.parse(selected.createdAt);
    if (Number.isFinite(eventTime) && Number.isFinite(selectedTime) && eventTime !== selectedTime) {
      if (eventTime > selectedTime) {
        selected = event;
        selectedIndex = index;
      }
      continue;
    }
    if (index > selectedIndex) {
      selected = event;
      selectedIndex = index;
    }
  }
  return selected;
}

export interface PrivateTraceRecord {
  id: string;
  municipalityId: string;
  category: string | PilotConfigEntity;
  status: TraceStatus;
  version: number;
  subject: string;
  narrative: string;
  location: string;
  contactEmail?: string;
  office: string | PilotConfigEntity;
  publicSummary?: string;
  commitment?: string;
  dueDate?: string;
  evidenceNote?: string;
  evidenceUrls?: string[];
  createdAt: string;
  updatedAt: string;
  events: TraceEvent[];
  attachments: TraceAttachment[];
}

/** Public fields are deliberately separate from the private record type. */
export interface PublicTraceRecord {
  id: string;
  municipalityId: string;
  category: string | PilotConfigEntity;
  office: string | PilotConfigEntity;
  status: 'published' | 'resolved';
  publicSummary: string;
  commitment: string;
  dueDate: string;
  evidenceNote?: string;
  evidenceUrls?: string[];
  publishedAt: string;
  resolvedAt?: string;
  events: TraceEvent[];
  receiptHash: string;
  testEnvironment: true;
}

export function isPilotRole(value: unknown): value is PilotRole {
  return value === 'resident' || value === 'official' || value === 'reviewer';
}

export function isTraceStatus(value: unknown): value is TraceStatus {
  return (
    value === 'open' ||
    value === 'assigned' ||
    value === 'commitment-pending-review' ||
    value === 'returned' ||
    value === 'published' ||
    value === 'resolution-pending-review' ||
    value === 'resolved'
  );
}

export function recordFromEnvelope(value: unknown): PrivateTraceRecord {
  if (!value || typeof value !== 'object' || !('record' in value)) throw new Error('invalid_record_response');
  const record = (value as { record?: unknown }).record;
  if (!record || typeof record !== 'object') throw new Error('invalid_record_response');
  return record as PrivateTraceRecord;
}

export function publicRecordFromEnvelope(value: unknown): PublicTraceRecord {
  if (!value || typeof value !== 'object' || !('record' in value)) throw new Error('invalid_public_record_response');
  const record = (value as { record?: unknown }).record;
  if (!record || typeof record !== 'object') throw new Error('invalid_public_record_response');
  return record as PublicTraceRecord;
}

export function recordsFromEnvelope<T>(value: unknown): T[] {
  if (!value || typeof value !== 'object' || !('records' in value)) throw new Error('invalid_records_response');
  const records = (value as { records?: unknown }).records;
  if (!Array.isArray(records)) throw new Error('invalid_records_response');
  return records as T[];
}

export function entityName(entity: unknown, lang: PilotLang): string {
  if (typeof entity === 'string') return entity;
  if (!entity || typeof entity !== 'object') return '';
  const candidate = entity as PilotConfigEntity;
  const value = candidate.name ?? candidate.label;
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return candidate.id ?? '';
  const localized = value as LocalizedName;
  for (const key of [lang, 'hr', 'it', 'en'] as const) {
    if (typeof localized[key] === 'string' && localized[key]) return localized[key] as string;
  }
  return candidate.id ?? '';
}

export function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function safeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
