import type {
  ChatStreamCitation,
  ChatStreamConversationMessage,
  ChatStreamConversationMessagePromptVersions,
  ChatStreamEvent as HttpChatStreamEvent,
  ChatStreamPromptVersionReference,
  ChatStreamRetrievalTrace,
  AnswerGapCandidateSummary,
} from '@fa/http-contracts';

import { config } from '../config.js';
import { apiRequest, apiSseRequest, normalizeApiTimestamp, type ApiSseEvent } from './apiClient.js';

export type ConversationStatus = 'active' | 'deleted';
export type ConversationMessageRole = 'user' | 'assistant';
export type AnswerConfidence = 'high' | 'medium' | 'low';
export type StreamStatus = 'completed' | 'failed';

export type Citation = ChatStreamCitation;
export type PromptVersionReference = ChatStreamPromptVersionReference;
export type ConversationMessagePromptVersions = ChatStreamConversationMessagePromptVersions;
export type RetrievalTrace = ChatStreamRetrievalTrace;
export type RetrievalTraceSource = ChatStreamRetrievalTrace['sources'][number];
export type RetrievalEvidenceSummary = ChatStreamRetrievalTrace['evidence'][number];
export type AnswerGapCandidate = AnswerGapCandidateSummary;

export interface ShareAnswerGapCandidateInput {
  includeContext: boolean;
  includeContact: boolean;
}

export interface ShareAnswerGapCandidateResponse {
  candidate: AnswerGapCandidate;
  created: boolean;
}

export interface DeclineAnswerGapCandidateResponse {
  candidate: AnswerGapCandidate;
}

export interface WithdrawAnswerGapCandidateResponse {
  candidate: AnswerGapCandidate;
}

export interface Conversation {
  id: string;
  title: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastMessageRole?: ConversationMessageRole;
  lastAssistantStreamStatus?: StreamStatus | null;
  messageCount: number;
  deletedAt: string | null;
}

export type ConversationMessage = ChatStreamConversationMessage;

export type ChatStreamEvent = HttpChatStreamEvent;

const chatBaseUrl = config.services.CHAT_SERVICE;

function jsonBody(value: unknown): RequestInit {
  return { body: JSON.stringify(value) };
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function normalizeConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    createdAt: normalizeApiTimestamp(conversation.createdAt),
    updatedAt: normalizeApiTimestamp(conversation.updatedAt),
    lastMessageAt: normalizeApiTimestamp(conversation.lastMessageAt),
    deletedAt:
      conversation.deletedAt === null ? null : normalizeApiTimestamp(conversation.deletedAt),
  };
}

function normalizeRetrievalTrace(retrieval: RetrievalTrace): RetrievalTrace {
  return {
    ...retrieval,
    startedAt: normalizeApiTimestamp(retrieval.startedAt),
    completedAt: normalizeApiTimestamp(retrieval.completedAt),
  };
}

function normalizeConversationMessage(message: ConversationMessage): ConversationMessage {
  return {
    ...message,
    createdAt: normalizeApiTimestamp(message.createdAt),
    ...(message.retrieval !== undefined
      ? { retrieval: normalizeRetrievalTrace(message.retrieval) }
      : {}),
  };
}

function normalizeSseEvents(event: ApiSseEvent): ChatStreamEvent[] {
  if (event.event === 'message.created' || event.event === 'answer.final') {
    return [
      {
        type: event.event,
        data: normalizeConversationMessage(event.data as ConversationMessage),
      },
    ];
  }

  return [{ type: event.event, data: event.data } as ChatStreamEvent];
}

export async function listConversations(): Promise<Conversation[]> {
  const conversations = await apiRequest<Conversation[]>(`${chatBaseUrl}/conversations`);
  return conversations.map(normalizeConversation);
}

export async function createConversation(): Promise<Conversation> {
  return normalizeConversation(
    await apiRequest<Conversation>(`${chatBaseUrl}/conversations`, { method: 'POST' })
  );
}

export async function deleteConversation(conversationId: string): Promise<{ deleted: true }> {
  return await apiRequest<{ deleted: true }>(
    `${chatBaseUrl}/conversations/${encodePathSegment(conversationId)}`,
    { method: 'DELETE' }
  );
}

export async function listConversationMessages(
  conversationId: string
): Promise<ConversationMessage[]> {
  const messages = await apiRequest<ConversationMessage[]>(
    `${chatBaseUrl}/conversations/${encodePathSegment(conversationId)}/messages`
  );
  return messages.map(normalizeConversationMessage);
}

export async function streamConversationMessage(
  conversationId: string,
  message: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  await apiSseRequest(
    `${chatBaseUrl}/conversations/${encodePathSegment(conversationId)}/messages/stream`,
    {
      method: 'POST',
      ...jsonBody({ message }),
      ...(signal !== undefined ? { signal } : {}),
      onEvent: (event) => {
        for (const normalizedEvent of normalizeSseEvents(event)) {
          onEvent(normalizedEvent);
        }
      },
    }
  );
}

export async function shareAnswerGapCandidate(
  candidateId: string,
  input: ShareAnswerGapCandidateInput
): Promise<ShareAnswerGapCandidateResponse> {
  return await apiRequest<ShareAnswerGapCandidateResponse>(
    `${chatBaseUrl}/answer-gap-candidates/${encodePathSegment(candidateId)}/share`,
    {
      method: 'POST',
      ...jsonBody(input),
    }
  );
}

export async function declineAnswerGapCandidate(
  candidateId: string
): Promise<DeclineAnswerGapCandidateResponse> {
  return await apiRequest<DeclineAnswerGapCandidateResponse>(
    `${chatBaseUrl}/answer-gap-candidates/${encodePathSegment(candidateId)}/decline`,
    {
      method: 'POST',
      ...jsonBody({}),
    }
  );
}

export async function withdrawAnswerGapCandidate(
  candidateId: string
): Promise<WithdrawAnswerGapCandidateResponse> {
  return await apiRequest<WithdrawAnswerGapCandidateResponse>(
    `${chatBaseUrl}/answer-gap-candidates/${encodePathSegment(candidateId)}/withdraw`,
    {
      method: 'POST',
      ...jsonBody({}),
    }
  );
}
