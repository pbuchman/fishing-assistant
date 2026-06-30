import { err, ok, type Clock, type Result } from '@fa/common-core';

import type { Conversation } from '../models/chat.js';
import type {
  ChatRepositoryError,
  ConversationRepository,
} from '../repositories/chatRepositories.js';

export type ChatUseCaseError =
  | ChatRepositoryError
  | { code: 'INVALID_REQUEST' | 'NOT_FOUND'; message: string };

export interface ConversationUseCaseDeps {
  conversationRepository: ConversationRepository;
}

export interface CreateConversationDeps extends ConversationUseCaseDeps {
  clock: Clock;
  generateId: () => string;
}

export interface DeleteConversationDeps extends ConversationUseCaseDeps {
  clock: Clock;
}

function notFound(conversationId: string): ChatUseCaseError {
  return { code: 'NOT_FOUND', message: `Conversation ${conversationId} not found` };
}

function activeConversationOrNotFound(
  conversation: Conversation | null,
  conversationId: string
): Result<Conversation, ChatUseCaseError> {
  if (conversation === null || conversation.status === 'deleted') {
    return err(notFound(conversationId));
  }

  return ok(conversation);
}

export async function createConversation(
  deps: CreateConversationDeps,
  input: { userId: string }
): Promise<Result<Conversation, ChatUseCaseError>> {
  const now = deps.clock.now().toISOString();
  return await deps.conversationRepository.create({
    id: deps.generateId(),
    userId: input.userId,
    title: 'New Chat',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    lastMessagePreview: '',
    messageCount: 0,
    deletedAt: null,
  });
}

export async function listConversations(
  deps: ConversationUseCaseDeps,
  input: { userId: string }
): Promise<Result<Conversation[], ChatUseCaseError>> {
  return await deps.conversationRepository.listActive(input);
}

export async function getConversation(
  deps: ConversationUseCaseDeps,
  input: { userId: string; conversationId: string }
): Promise<Result<Conversation, ChatUseCaseError>> {
  const result = await deps.conversationRepository.getById(input);
  if (!result.ok) {
    return result;
  }

  return activeConversationOrNotFound(result.value, input.conversationId);
}

export async function deleteConversation(
  deps: DeleteConversationDeps,
  input: { userId: string; conversationId: string }
): Promise<Result<{ deleted: true }, ChatUseCaseError>> {
  const result = await getConversation(deps, input);
  if (!result.ok) {
    return result;
  }

  const now = deps.clock.now().toISOString();
  const updateResult = await deps.conversationRepository.update({
    ...result.value,
    status: 'deleted',
    deletedAt: now,
    updatedAt: now,
  });
  if (!updateResult.ok) {
    return updateResult;
  }

  return ok({ deleted: true });
}
