import { err, type Clock, type Result } from '@fa/common-core';

import type { Conversation, ConversationMessage } from '../models/chat.js';
import type {
  ChatRepositoryError,
  ConversationMessageAppendMetadata,
  ConversationMessageRepository,
  ConversationMessageWriteRepository,
  ConversationRepository,
} from '../repositories/chatRepositories.js';
import { getConversation, type ChatUseCaseError } from './conversationUsecases.js';

export interface MessageUseCaseDeps {
  conversationRepository: ConversationRepository;
  messageRepository: ConversationMessageRepository;
}

export interface PersistUserMessageDeps extends MessageUseCaseDeps {
  messageWriteRepository: ConversationMessageWriteRepository;
  clock: Clock;
  generateId: () => string;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function shorten(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function messagePreview(value: string): string {
  return shorten(value, 180);
}

function titleForFirstUserMessage(value: string): string {
  return shorten(value, 120);
}

function metadataAfterMessage(message: ConversationMessage): ConversationMessageAppendMetadata {
  return {
    updatedAt: message.createdAt,
    lastMessageAt: message.createdAt,
    lastMessagePreview: messagePreview(message.content),
    lastMessageRole: message.role,
    ...(message.role === 'assistant'
      ? { lastAssistantStreamStatus: message.streamStatus ?? null }
      : {}),
    ...(message.role === 'user'
      ? { titleIfFirstMessage: titleForFirstUserMessage(message.content) }
      : {}),
  };
}

export function conversationAfterMessage(
  conversation: Conversation,
  metadata: ConversationMessageAppendMetadata
): Conversation {
  return {
    ...conversation,
    title:
      conversation.messageCount === 0 && metadata.titleIfFirstMessage !== undefined
        ? metadata.titleIfFirstMessage
        : conversation.title,
    updatedAt: metadata.updatedAt,
    lastMessageAt: metadata.lastMessageAt,
    lastMessagePreview: metadata.lastMessagePreview,
    ...(metadata.lastMessageRole !== undefined
      ? { lastMessageRole: metadata.lastMessageRole }
      : {}),
    ...(metadata.lastAssistantStreamStatus !== undefined
      ? { lastAssistantStreamStatus: metadata.lastAssistantStreamStatus }
      : {}),
    messageCount: conversation.messageCount + 1,
  };
}

export async function listConversationMessages(
  deps: MessageUseCaseDeps,
  input: { userId: string; conversationId: string }
): Promise<Result<ConversationMessage[], ChatUseCaseError>> {
  const conversation = await getConversation(
    { conversationRepository: deps.conversationRepository },
    input
  );
  if (!conversation.ok) {
    return conversation;
  }

  return await deps.messageRepository.listByConversation(input);
}

export async function persistUserMessage(
  deps: PersistUserMessageDeps,
  input: { userId: string; conversationId: string; content: string }
): Promise<Result<ConversationMessage, ChatUseCaseError>> {
  const content = input.content.trim();
  if (content.length === 0) {
    return err({ code: 'INVALID_REQUEST', message: 'message must not be empty' });
  }

  const now = deps.clock.now().toISOString();
  const message: ConversationMessage = {
    id: deps.generateId(),
    userId: input.userId,
    conversationId: input.conversationId,
    role: 'user',
    content,
    createdAt: now,
    citations: [],
    missingInformation: [],
  };
  return await deps.messageWriteRepository.appendToActiveConversation({
    message,
    metadata: metadataAfterMessage(message),
  });
}

export async function persistAssistantMessage(
  deps: PersistUserMessageDeps,
  message: ConversationMessage
): Promise<Result<ConversationMessage, ChatRepositoryError | ChatUseCaseError>> {
  return await deps.messageWriteRepository.appendToActiveConversation({
    message,
    metadata: metadataAfterMessage(message),
  });
}

export const messageUseCaseInternals = {
  metadataAfterMessage,
  normalizeWhitespace,
  shorten,
  titleForFirstUserMessage,
};
