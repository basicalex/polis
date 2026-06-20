/**
 * Wire serializers for polis-bridge-service. DB rows are snake_case; these map
 * to the §13 camelCase wire types declared in @polis/domain (Issue,
 * PolisConversation, ConversationResult) so the public contract has one home.
 */
import type { ConversationResult, Issue, PolisConversation } from '@polis/domain';
import type { schema } from '@polis/db';

type Row<T extends keyof typeof schema> = (typeof schema)[T]['$inferSelect'];

type IssueRow = Row<'issues'>;
export type ConversationRow = Row<'conversations'>;
type ConversationResultRow = Row<'conversationResults'>;

export const issueWire = (r: IssueRow): Issue => ({
  id: r.id,
  jurisdictionId: r.jurisdictionId,
  processId: r.processId,
  slug: r.slug,
  title: r.title,
  summary: r.summary,
  status: r.status as Issue['status'],
  createdAt: r.createdAt.toISOString(),
});

export const conversationWire = (r: ConversationRow): PolisConversation => ({
  id: r.id,
  externalPolisId: r.externalPolisId,
  issueId: r.issueId,
  title: r.title,
  framingQuestion: r.framingQuestion,
  participationMode: r.participationMode as PolisConversation['participationMode'],
  status: r.status as PolisConversation['status'],
  reportUrl: r.reportUrl,
  createdAt: r.createdAt.toISOString(),
  closedAt: r.closedAt ? new Date(r.closedAt).toISOString() : null,
});

export const conversationResultWire = (r: ConversationResultRow): ConversationResult => ({
  id: r.id,
  conversationId: r.conversationId,
  // jsonb snapshot passed through verbatim; numeric arrives as a string.
  consensusGroups: r.consensusGroups,
  participantCount: r.participantCount == null ? null : Number(r.participantCount),
  capturedAt: r.capturedAt.toISOString(),
});
