// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IncomingMessage } from 'node:http';

export const TRACE_STATUSES = [
  'open',
  'assigned',
  'commitment-pending-review',
  'returned',
  'published',
  'resolution-pending-review',
  'resolved',
] as const;
export type TraceStatus = (typeof TRACE_STATUSES)[number];
export type TraceRole = 'resident' | 'official' | 'reviewer';
export type TraceStage = 'voice' | 'responsibility' | 'response' | 'check' | 'receipt';

export interface Actor {
  id: string;
  email: string | null;
  role: TraceRole;
}

export interface LocalizedText {
  hr: string;
  it: string;
  en: string;
}

export interface PilotSource {
  id: string;
  title: string;
  url: string;
  retrievedAt: string;
  supports: string[];
}

export interface PilotConfig {
  id: 'vrsar-orsera';
  testEnvironment: true;
  municipality: { id: 'vrsar-orsera'; name: LocalizedText };
  category: { id: 'public-lighting'; name: LocalizedText };
  office: { id: 'communal-system'; name: LocalizedText; routingStatus: string };
  sources: PilotSource[];
}

export interface TraceConfig {
  internalApiToken: string;
  databaseUrl: string;
  intakeOpen: boolean;
  officialIds: ReadonlySet<string>;
  reviewerIds: ReadonlySet<string>;
  pilot: PilotConfig;
}

export interface PrivateEvent {
  id: string;
  sequence: number;
  stage: TraceStage;
  action: string;
  actorRole: TraceRole;
  note: string | null;
  createdAt: string;
  previousHash: string | null;
  hash: string;
}

export type PublicEvent =
  | {
      stage: 'voice';
      action: 'report-filed';
      actorRole: 'resident';
      createdAt: string;
    }
  | {
      stage: 'responsibility';
      action: 'office-assigned';
      actorRole: 'official';
      createdAt: string;
    }
  | {
      stage: 'response';
      action: 'commitment-filed';
      actorRole: 'official';
      createdAt: string;
    }
  | {
      stage: 'check';
      action: 'commitment-accepted';
      actorRole: 'reviewer';
      createdAt: string;
    }
  | {
      stage: 'receipt';
      action: 'published';
      actorRole: 'reviewer';
      createdAt: string;
    }
  | {
      stage: 'receipt';
      action: 'completion-approved';
      actorRole: 'reviewer';
      createdAt: string;
    };

export interface AttachmentMetadata {
  id: string;
  filename: string;
  contentType: string;
  byteCount: number;
  sha256: string;
  createdAt: string;
}

export interface PrivateRecord {
  id: string;
  municipalityId: string;
  category: string;
  status: TraceStatus;
  version: number;
  subject: string;
  narrative: string;
  location: string;
  contactEmail: string | null;
  office: string;
  publicSummary: string | null;
  commitment: string | null;
  dueDate: string | null;
  evidenceNote: string | null;
  evidenceUrls: string[];
  createdAt: string;
  updatedAt: string;
  events: PrivateEvent[];
  attachments: AttachmentMetadata[];
}

export interface PublicRecord {
  id: string;
  municipalityId: string;
  category: string;
  office: string;
  status: 'published' | 'resolved';
  publicSummary: string;
  commitment: string;
  dueDate: string;
  evidenceNote: string | null;
  evidenceUrls: string[];
  publishedAt: string;
  resolvedAt: string | null;
  events: PublicEvent[];
  receiptHash: string;
  testEnvironment: true;
}

export interface RecordRow {
  id: string;
  municipality_id: string;
  category: string;
  office: string;
  owner_actor_id: string;
  status: TraceStatus;
  version: number;
  public_summary: string | null;
  commitment: string | null;
  due_date: string | null;
  evidence_note: string | null;
  evidence_urls: string[] | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CommandContext {
  actor: Actor;
  method: string;
  path: string;
  idempotencyKey: string;
  normalizedBody: Record<string, unknown>;
}

export interface AttachmentDownload {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

export interface TraceStore {
  check(): Promise<void>;
  listPrivate(actor: Actor, limit: number): Promise<PrivateRecord[]>;
  getPrivate(actor: Actor, id: string): Promise<PrivateRecord | null>;
  create(ctx: CommandContext): Promise<{ status: number; body: unknown }>;
  assign(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  commitment(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  review(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  resolution(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  resolutionReview(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  addAttachment(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  downloadAttachment(
    actor: Actor,
    recordId: string,
    attachmentId: string,
  ): Promise<AttachmentDownload | null>;
  listPublic(limit: number): Promise<PublicRecord[]>;
  getPublic(id: string): Promise<PublicRecord | null>;
  close(): Promise<void>;
}

export type RequestLike = Pick<IncomingMessage, 'headers' | 'url'>;
