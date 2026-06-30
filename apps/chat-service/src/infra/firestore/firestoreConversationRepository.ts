import { err, getErrorMessage, ok, type Result } from '@fa/common-core';
import { getFirestore, type Firestore } from '@fa/infra-firestore';

import type {
  Conversation,
  ConversationMessageRole,
  StreamStatus,
} from '../../domain/models/chat.js';
import type {
  ChatRepositoryError,
  ConversationRepository,
} from '../../domain/repositories/chatRepositories.js';
import { CONVERSATIONS_COLLECTION } from './collections.js';
import { isoFromTimestamp, timestampFromIso } from './firestoreMapping.js';

function repositoryError(error: unknown): ChatRepositoryError {
  return { code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'Firestore operation failed') };
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

function numberField(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  return typeof value === 'number' ? value : 0;
}

function optionalStringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' ? value : undefined;
}

function nullableTimestamp(data: Record<string, unknown>, key: string): string | null {
  return data[key] === null ? null : isoFromTimestamp(data[key], key);
}

function conversationToDoc(conversation: Conversation): Record<string, unknown> {
  return {
    ...conversation,
    createdAt: timestampFromIso(conversation.createdAt),
    updatedAt: timestampFromIso(conversation.updatedAt),
    lastMessageAt: timestampFromIso(conversation.lastMessageAt),
    deletedAt: conversation.deletedAt === null ? null : timestampFromIso(conversation.deletedAt),
  };
}

function conversationFromDoc(id: string, data: Record<string, unknown>): Conversation {
  const conversation: Conversation = {
    id,
    userId: stringField(data, 'userId'),
    title: stringField(data, 'title'),
    status: stringField(data, 'status') as Conversation['status'],
    createdAt: isoFromTimestamp(data['createdAt'], 'createdAt'),
    updatedAt: isoFromTimestamp(data['updatedAt'], 'updatedAt'),
    lastMessageAt: isoFromTimestamp(data['lastMessageAt'], 'lastMessageAt'),
    lastMessagePreview: stringField(data, 'lastMessagePreview'),
    messageCount: numberField(data, 'messageCount'),
    deletedAt: nullableTimestamp(data, 'deletedAt'),
  };

  const lastMessageRole = optionalStringField(data, 'lastMessageRole');
  if (lastMessageRole !== undefined) {
    conversation.lastMessageRole = lastMessageRole as ConversationMessageRole;
  }

  if (data['lastAssistantStreamStatus'] === null) {
    conversation.lastAssistantStreamStatus = null;
  } else {
    const lastAssistantStreamStatus = optionalStringField(data, 'lastAssistantStreamStatus');
    if (lastAssistantStreamStatus !== undefined) {
      conversation.lastAssistantStreamStatus = lastAssistantStreamStatus as StreamStatus;
    }
  }

  return conversation;
}

export class FirestoreConversationRepository implements ConversationRepository {
  constructor(private readonly firestore?: Firestore) {}

  private get db(): Firestore {
    return this.firestore ?? getFirestore();
  }

  async create(conversation: Conversation): Promise<Result<Conversation, ChatRepositoryError>> {
    try {
      await this.db
        .collection(CONVERSATIONS_COLLECTION)
        .doc(conversation.id)
        .create(conversationToDoc(conversation));
      return ok(conversation);
    } catch (error) {
      const candidate = error as { code?: unknown };
      if (candidate.code === 6 || candidate.code === 'already-exists') {
        return err({
          code: 'CONFLICT',
          message: `Conversation ${conversation.id} already exists`,
        });
      }

      return err(repositoryError(error));
    }
  }

  async getById(input: {
    userId: string;
    conversationId: string;
  }): Promise<Result<Conversation | null, ChatRepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(CONVERSATIONS_COLLECTION)
        .doc(input.conversationId)
        .get();
      const data = snapshot.data() as Record<string, unknown> | undefined;
      if (!snapshot.exists || data?.['userId'] !== input.userId) {
        return ok(null);
      }

      return ok(conversationFromDoc(snapshot.id, data));
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async listActive(input: {
    userId: string;
  }): Promise<Result<Conversation[], ChatRepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(CONVERSATIONS_COLLECTION)
        .where('userId', '==', input.userId)
        .where('status', '==', 'active')
        .orderBy('lastMessageAt', 'desc')
        .get();

      return ok(
        snapshot.docs
          .map((doc) => conversationFromDoc(doc.id, doc.data() as Record<string, unknown>))
          .filter(
            (conversation) =>
              conversation.userId === input.userId && conversation.status === 'active'
          )
      );
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async update(conversation: Conversation): Promise<Result<Conversation, ChatRepositoryError>> {
    try {
      const ref = this.db.collection(CONVERSATIONS_COLLECTION).doc(conversation.id);
      const existing = await ref.get();
      const data = existing.data() as Record<string, unknown> | undefined;
      if (!existing.exists || data?.['userId'] !== conversation.userId) {
        return err({ code: 'NOT_FOUND', message: `Conversation ${conversation.id} not found` });
      }

      await ref.set(conversationToDoc(conversation));
      return ok(conversation);
    } catch (error) {
      return err(repositoryError(error));
    }
  }
}
