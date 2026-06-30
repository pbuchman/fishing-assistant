import { err, ok, type Result } from '@fa/common-core';

import type { Conversation, ConversationMessage } from '../../domain/models/chat.js';
import type {
  ChatRepositoryError,
  ConversationMessageWriteRepository,
  ConversationMessageRepository,
  ConversationRepository,
} from '../../domain/repositories/chatRepositories.js';
import { conversationAfterMessage } from '../../domain/usecases/messageUsecases.js';

function cloneConversation(conversation: Conversation): Conversation {
  return { ...conversation };
}

function clonePromptVersions(
  promptVersions: ConversationMessage['promptVersions']
): ConversationMessage['promptVersions'] {
  return promptVersions === undefined
    ? undefined
    : {
        answer: { ...promptVersions.answer },
      };
}

function cloneMessage(message: ConversationMessage): ConversationMessage {
  const promptVersions = clonePromptVersions(message.promptVersions);
  return {
    ...message,
    citations: message.citations.map((citation) => ({ ...citation })),
    missingInformation: [...message.missingInformation],
    ...(promptVersions !== undefined ? { promptVersions } : {}),
    ...(message.retrieval !== undefined
      ? {
          retrieval: {
            ...message.retrieval,
            sources: message.retrieval.sources.map((source) => ({
              ...source,
              diagnostics: { ...source.diagnostics },
              ...(source.performance !== undefined
                ? { performance: { ...source.performance } }
                : {}),
            })),
            evidence: message.retrieval.evidence.map((evidence) => ({
              ...evidence,
              metadata: { ...evidence.metadata },
            })),
          },
        }
      : {}),
  };
}

export class MemoryConversationRepository implements ConversationRepository {
  readonly conversations = new Map<string, Conversation>();

  create(conversation: Conversation): Promise<Result<Conversation, ChatRepositoryError>> {
    if (this.conversations.has(conversation.id)) {
      return Promise.resolve(
        err({ code: 'CONFLICT', message: `Conversation ${conversation.id} already exists` })
      );
    }

    this.conversations.set(conversation.id, cloneConversation(conversation));
    return Promise.resolve(ok(cloneConversation(conversation)));
  }

  getById(input: {
    userId: string;
    conversationId: string;
  }): Promise<Result<Conversation | null, ChatRepositoryError>> {
    const conversation = this.conversations.get(input.conversationId);
    if (conversation?.userId !== input.userId) {
      return Promise.resolve(ok(null));
    }

    return Promise.resolve(ok(cloneConversation(conversation)));
  }

  listActive(input: { userId: string }): Promise<Result<Conversation[], ChatRepositoryError>> {
    return Promise.resolve(
      ok(
        [...this.conversations.values()]
          .filter(
            (conversation) =>
              conversation.userId === input.userId && conversation.status === 'active'
          )
          .sort((left, right) => right.lastMessageAt.localeCompare(left.lastMessageAt))
          .map(cloneConversation)
      )
    );
  }

  update(conversation: Conversation): Promise<Result<Conversation, ChatRepositoryError>> {
    const existing = this.conversations.get(conversation.id);
    if (existing?.userId !== conversation.userId) {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: `Conversation ${conversation.id} not found` })
      );
    }

    this.conversations.set(conversation.id, cloneConversation(conversation));
    return Promise.resolve(ok(cloneConversation(conversation)));
  }
}

export class MemoryConversationMessageRepository implements ConversationMessageRepository {
  readonly messages = new Map<string, ConversationMessage>();

  create(message: ConversationMessage): Promise<Result<ConversationMessage, ChatRepositoryError>> {
    if (this.messages.has(message.id)) {
      return Promise.resolve(
        err({ code: 'CONFLICT', message: `Conversation message ${message.id} already exists` })
      );
    }

    this.messages.set(message.id, cloneMessage(message));
    return Promise.resolve(ok(cloneMessage(message)));
  }

  listByConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<Result<ConversationMessage[], ChatRepositoryError>> {
    return Promise.resolve(
      ok(
        [...this.messages.values()]
          .filter(
            (message) =>
              message.userId === input.userId && message.conversationId === input.conversationId
          )
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .map(cloneMessage)
      )
    );
  }
}

export class MemoryConversationMessageWriteRepository implements ConversationMessageWriteRepository {
  constructor(
    private readonly conversationRepository: MemoryConversationRepository,
    private readonly messageRepository: MemoryConversationMessageRepository
  ) {}

  appendToActiveConversation(
    input: Parameters<ConversationMessageWriteRepository['appendToActiveConversation']>[0]
  ): Promise<Result<ConversationMessage, ChatRepositoryError>> {
    const conversation = this.conversationRepository.conversations.get(
      input.message.conversationId
    );
    if (conversation?.userId !== input.message.userId || conversation.status !== 'active') {
      return Promise.resolve(
        err({
          code: 'NOT_FOUND',
          message: `Conversation ${input.message.conversationId} not found`,
        })
      );
    }

    if (this.messageRepository.messages.has(input.message.id)) {
      return Promise.resolve(
        err({
          code: 'CONFLICT',
          message: `Conversation message ${input.message.id} already exists`,
        })
      );
    }

    this.messageRepository.messages.set(input.message.id, cloneMessage(input.message));
    this.conversationRepository.conversations.set(
      conversation.id,
      conversationAfterMessage(conversation, input.metadata)
    );

    return Promise.resolve(ok(cloneMessage(input.message)));
  }
}
