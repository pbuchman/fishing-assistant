import type { Result } from '@fa/common-core';

import type { Conversation, ConversationMessage } from '../models/chat.js';

export interface ChatRepositoryError {
  code: 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL_ERROR';
  message: string;
}

export interface ConversationRepository {
  create(conversation: Conversation): Promise<Result<Conversation, ChatRepositoryError>>;
  getById(input: {
    userId: string;
    conversationId: string;
  }): Promise<Result<Conversation | null, ChatRepositoryError>>;
  listActive(input: { userId: string }): Promise<Result<Conversation[], ChatRepositoryError>>;
  update(conversation: Conversation): Promise<Result<Conversation, ChatRepositoryError>>;
}

export interface ConversationMessageRepository {
  create(message: ConversationMessage): Promise<Result<ConversationMessage, ChatRepositoryError>>;
  listByConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<Result<ConversationMessage[], ChatRepositoryError>>;
}

export interface ConversationMessageAppendMetadata {
  updatedAt: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastMessageRole?: ConversationMessage['role'];
  lastAssistantStreamStatus?: ConversationMessage['streamStatus'] | null;
  titleIfFirstMessage?: string;
}

export interface ConversationMessageWriteRepository {
  appendToActiveConversation(input: {
    message: ConversationMessage;
    metadata: ConversationMessageAppendMetadata;
  }): Promise<Result<ConversationMessage, ChatRepositoryError>>;
}
