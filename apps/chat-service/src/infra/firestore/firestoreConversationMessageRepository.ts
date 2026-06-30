import { err, getErrorMessage, ok, type Result } from '@fa/common-core';
import { getFirestore, type Firestore } from '@fa/infra-firestore';

import type {
  Citation,
  ConversationMessage,
  ConversationMessagePromptVersions,
  PromptVersionReference,
  RetrievalTrace,
} from '../../domain/models/chat.js';
import type {
  ChatRepositoryError,
  ConversationMessageRepository,
} from '../../domain/repositories/chatRepositories.js';
import { CONVERSATION_MESSAGES_COLLECTION } from './collections.js';
import { isoFromTimestamp, timestampFromIso } from './firestoreMapping.js';

export function chatFirestoreRepositoryError(error: unknown): ChatRepositoryError {
  return { code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'Firestore operation failed') };
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

function stringArrayField(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function citationArrayField(data: Record<string, unknown>): Citation[] {
  const value = data['citations'];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      entry !== null &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      typeof (entry as Record<string, unknown>)['sourceId'] === 'string' &&
      typeof (entry as Record<string, unknown>)['usedFor'] === 'string'
    ) {
      const record = entry as Record<string, unknown>;
      const sourceId = record['sourceId'];
      const usedFor = record['usedFor'];
      if (typeof sourceId === 'string' && typeof usedFor === 'string') {
        return [{ sourceId, usedFor }];
      }
    }

    return [];
  });
}

function optionalString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' ? value : undefined;
}

function promptVersionReference(value: unknown): PromptVersionReference | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const name = record['name'];
  const version = record['version'];
  return typeof name === 'string' && typeof version === 'string' ? { name, version } : undefined;
}

function promptVersionsField(
  data: Record<string, unknown>
): ConversationMessagePromptVersions | undefined {
  const value = data['promptVersions'];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const answer = promptVersionReference(record['answer']);
  if (answer === undefined) {
    return undefined;
  }

  return { answer };
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

function retrievalTrace(data: Record<string, unknown>): RetrievalTrace | undefined {
  const value = data['retrieval'];
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RetrievalTrace)
    : undefined;
}

export function messageToDoc(message: ConversationMessage): Record<string, unknown> {
  const promptVersions = clonePromptVersions(message.promptVersions);
  return {
    ...message,
    citations: message.citations.map((citation) => ({ ...citation })),
    missingInformation: [...message.missingInformation],
    ...(promptVersions !== undefined ? { promptVersions } : {}),
    createdAt: timestampFromIso(message.createdAt),
  };
}

function messageFromDoc(id: string, data: Record<string, unknown>): ConversationMessage {
  const modelId = optionalString(data, 'modelId');
  const confidence = optionalString(data, 'confidence') as
    | ConversationMessage['confidence']
    | undefined;
  const retrieval = retrievalTrace(data);
  const promptVersions = promptVersionsField(data);
  const streamStatus = optionalString(data, 'streamStatus') as
    | ConversationMessage['streamStatus']
    | undefined;
  const errorMessage = optionalString(data, 'errorMessage');

  return {
    id,
    userId: stringField(data, 'userId'),
    conversationId: stringField(data, 'conversationId'),
    role: stringField(data, 'role') as ConversationMessage['role'],
    content: stringField(data, 'content'),
    createdAt: isoFromTimestamp(data['createdAt'], 'createdAt'),
    ...(modelId !== undefined ? { modelId } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    citations: citationArrayField(data),
    missingInformation: stringArrayField(data, 'missingInformation'),
    ...(promptVersions !== undefined ? { promptVersions } : {}),
    ...(retrieval !== undefined ? { retrieval } : {}),
    ...(streamStatus !== undefined ? { streamStatus } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  };
}

export class FirestoreConversationMessageRepository implements ConversationMessageRepository {
  constructor(private readonly firestore?: Firestore) {}

  private get db(): Firestore {
    return this.firestore ?? getFirestore();
  }

  async create(
    message: ConversationMessage
  ): Promise<Result<ConversationMessage, ChatRepositoryError>> {
    try {
      await this.db
        .collection(CONVERSATION_MESSAGES_COLLECTION)
        .doc(message.id)
        .create(messageToDoc(message));
      return ok(message);
    } catch (error) {
      const candidate = error as { code?: unknown };
      if (candidate.code === 6 || candidate.code === 'already-exists') {
        return err({
          code: 'CONFLICT',
          message: `Conversation message ${message.id} already exists`,
        });
      }

      return err(chatFirestoreRepositoryError(error));
    }
  }

  async listByConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<Result<ConversationMessage[], ChatRepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(CONVERSATION_MESSAGES_COLLECTION)
        .where('userId', '==', input.userId)
        .where('conversationId', '==', input.conversationId)
        .orderBy('createdAt', 'asc')
        .get();

      return ok(
        snapshot.docs
          .map((doc) => messageFromDoc(doc.id, doc.data() as Record<string, unknown>))
          .filter(
            (message) =>
              message.userId === input.userId && message.conversationId === input.conversationId
          )
      );
    } catch (error) {
      return err(chatFirestoreRepositoryError(error));
    }
  }
}
