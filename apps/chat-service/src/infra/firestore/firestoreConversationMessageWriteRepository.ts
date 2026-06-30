import { err, ok, type Result } from '@fa/common-core';
import { FieldValue, getFirestore, type Firestore } from '@fa/infra-firestore';

import type { ConversationMessage } from '../../domain/models/chat.js';
import type {
  ChatRepositoryError,
  ConversationMessageAppendMetadata,
  ConversationMessageWriteRepository,
} from '../../domain/repositories/chatRepositories.js';
import { CONVERSATION_MESSAGES_COLLECTION, CONVERSATIONS_COLLECTION } from './collections.js';
import {
  chatFirestoreRepositoryError,
  messageToDoc,
} from './firestoreConversationMessageRepository.js';
import { timestampFromIso } from './firestoreMapping.js';

function notFound(conversationId: string): ChatRepositoryError {
  return { code: 'NOT_FOUND', message: `Conversation ${conversationId} not found` };
}

function conflict(messageId: string): ChatRepositoryError {
  return { code: 'CONFLICT', message: `Conversation message ${messageId} already exists` };
}

function metadataPatch(input: {
  conversationData: Record<string, unknown>;
  message: ConversationMessage;
  metadata: ConversationMessageAppendMetadata;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    updatedAt: timestampFromIso(input.metadata.updatedAt),
    lastMessageAt: timestampFromIso(input.metadata.lastMessageAt),
    lastMessagePreview: input.metadata.lastMessagePreview,
    lastMessageRole: input.message.role,
    messageCount: FieldValue.increment(1),
  };

  if (input.message.role === 'assistant') {
    patch['lastAssistantStreamStatus'] = input.message.streamStatus ?? null;
  }

  if (
    input.message.role === 'user' &&
    input.conversationData['messageCount'] === 0 &&
    input.metadata.titleIfFirstMessage !== undefined
  ) {
    patch['title'] = input.metadata.titleIfFirstMessage;
  }

  return patch;
}

export class FirestoreConversationMessageWriteRepository implements ConversationMessageWriteRepository {
  constructor(private readonly firestore?: Firestore) {}

  private get db(): Firestore {
    return this.firestore ?? getFirestore();
  }

  async appendToActiveConversation(input: {
    message: ConversationMessage;
    metadata: ConversationMessageAppendMetadata;
  }): Promise<Result<ConversationMessage, ChatRepositoryError>> {
    try {
      const result = await this.db.runTransaction(async (transaction) => {
        const conversationRef = this.db
          .collection(CONVERSATIONS_COLLECTION)
          .doc(input.message.conversationId);
        const messageRef = this.db
          .collection(CONVERSATION_MESSAGES_COLLECTION)
          .doc(input.message.id);

        const [conversationSnapshot, messageSnapshot] = await Promise.all([
          transaction.get(conversationRef),
          transaction.get(messageRef),
        ]);
        const conversationData = conversationSnapshot.data() as Record<string, unknown> | undefined;
        if (
          !conversationSnapshot.exists ||
          conversationData?.['userId'] !== input.message.userId ||
          conversationData['status'] !== 'active'
        ) {
          return err(notFound(input.message.conversationId));
        }

        if (messageSnapshot.exists) {
          return err(conflict(input.message.id));
        }

        transaction.create(messageRef, messageToDoc(input.message));
        transaction.update(
          conversationRef,
          metadataPatch({
            conversationData,
            message: input.message,
            metadata: input.metadata,
          })
        );

        return ok(input.message);
      });

      return result;
    } catch (error) {
      return err(chatFirestoreRepositoryError(error));
    }
  }
}

export const firestoreMessageWriteInternals = {
  metadataPatch,
};
