import { err, getErrorMessage, ok, type Result } from '@fa/common-core';
import { getFirestore, type Firestore } from '@fa/infra-firestore';

import type {
  AnswerGapCandidate,
  AnswerGapCandidateConversationSnapshot,
  AnswerGapCandidateStatus,
} from '../../domain/models/answerGapCandidate.js';
import type {
  AnswerGapCandidateRepository,
  AnswerGapCandidateRepositoryError,
} from '../../domain/repositories/answerGapCandidateRepository.js';
import { ANSWER_GAP_CANDIDATES_COLLECTION } from './collections.js';
import { isoFromTimestamp, timestampFromIso } from './firestoreMapping.js';

function repositoryError(error: unknown): AnswerGapCandidateRepositoryError {
  return { code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'Firestore operation failed') };
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

function nullableStringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' ? value : null;
}

function nullableTimestamp(data: Record<string, unknown>, key: string): string | null {
  return data[key] === null || data[key] === undefined ? null : isoFromTimestamp(data[key], key);
}

function objectField(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = data[key];
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArrayField(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function contextWindowField(
  data: Record<string, unknown>
): AnswerGapCandidateConversationSnapshot['contextWindow'] {
  const value = data['contextWindow'];
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) =>
      item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : null
    )
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      role: stringField(item, 'role') === 'assistant' ? 'assistant' : 'user',
      content: stringField(item, 'content'),
    }));
}

function timestampOrNull(value: string | null) {
  return value === null ? null : timestampFromIso(value);
}

function candidateToDoc(candidate: AnswerGapCandidate): Record<string, unknown> {
  return {
    ...candidate,
    missingInformation: [...candidate.missingInformation],
    requester: { ...candidate.requester },
    conversation: {
      ...candidate.conversation,
      contextWindow: candidate.conversation.contextWindow.map((message) => ({ ...message })),
    },
    coverageProbe: { ...candidate.coverageProbe },
    createdAt: timestampFromIso(candidate.createdAt),
    updatedAt: timestampFromIso(candidate.updatedAt),
    expiresAt: timestampFromIso(candidate.expiresAt),
    sharedAt: timestampOrNull(candidate.sharedAt),
    declinedAt: timestampOrNull(candidate.declinedAt),
    withdrawnAt: timestampOrNull(candidate.withdrawnAt),
  };
}

function conversationFromDoc(
  data: Record<string, unknown>
): AnswerGapCandidateConversationSnapshot {
  const conversation = objectField(data, 'conversation');
  return {
    conversationId: stringField(conversation, 'conversationId'),
    userMessageId: stringField(conversation, 'userMessageId'),
    assistantMessageId: stringField(conversation, 'assistantMessageId'),
    contextWindow: contextWindowField(conversation),
  };
}

function candidateFromDoc(id: string, data: Record<string, unknown>): AnswerGapCandidate {
  const requester = objectField(data, 'requester');
  const coverageProbe = objectField(data, 'coverageProbe');

  return {
    id,
    status: stringField(data, 'status') as AnswerGapCandidateStatus,
    userId: stringField(data, 'userId'),
    source: stringField(data, 'source') as AnswerGapCandidate['source'],
    question: stringField(data, 'question'),
    missingInformation: stringArrayField(data, 'missingInformation'),
    requester: {
      userId: stringField(requester, 'userId'),
      email: nullableStringField(requester, 'email'),
      firstName: nullableStringField(requester, 'firstName'),
      lastName: nullableStringField(requester, 'lastName'),
      role: stringField(requester, 'role') === 'admin' ? 'admin' : 'user',
      effectiveLevel:
        typeof requester['effectiveLevel'] === 'number' ? requester['effectiveLevel'] : 0,
    },
    conversation: conversationFromDoc(data),
    coverageProbe: {
      classification: stringField(
        coverageProbe,
        'classification'
      ) as AnswerGapCandidate['coverageProbe']['classification'],
      minRequiredLevel:
        typeof coverageProbe['minRequiredLevel'] === 'number'
          ? coverageProbe['minRequiredLevel']
          : null,
      candidateCountBucket: stringField(
        coverageProbe,
        'candidateCountBucket'
      ) as AnswerGapCandidate['coverageProbe']['candidateCountBucket'],
      probeVersion: '1.0.0',
    },
    coverageKind: stringField(data, 'coverageKind') as AnswerGapCandidate['coverageKind'],
    createdAt: isoFromTimestamp(data['createdAt'], 'createdAt'),
    updatedAt: isoFromTimestamp(data['updatedAt'], 'updatedAt'),
    expiresAt: isoFromTimestamp(data['expiresAt'], 'expiresAt'),
    sharedAt: nullableTimestamp(data, 'sharedAt'),
    declinedAt: nullableTimestamp(data, 'declinedAt'),
    withdrawnAt: nullableTimestamp(data, 'withdrawnAt'),
    sharedGapId: nullableStringField(data, 'sharedGapId'),
  };
}

export class FirestoreAnswerGapCandidateRepository implements AnswerGapCandidateRepository {
  constructor(private readonly firestore?: Firestore) {}

  private get db(): Firestore {
    return this.firestore ?? getFirestore();
  }

  async getById(
    id: string
  ): Promise<Result<AnswerGapCandidate | null, AnswerGapCandidateRepositoryError>> {
    try {
      const snapshot = await this.db.collection(ANSWER_GAP_CANDIDATES_COLLECTION).doc(id).get();
      if (!snapshot.exists) {
        return ok(null);
      }

      return ok(candidateFromDoc(snapshot.id, snapshot.data() as Record<string, unknown>));
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async create(
    candidate: AnswerGapCandidate
  ): Promise<Result<AnswerGapCandidate, AnswerGapCandidateRepositoryError>> {
    try {
      await this.db
        .collection(ANSWER_GAP_CANDIDATES_COLLECTION)
        .doc(candidate.id)
        .create(candidateToDoc(candidate));
      return ok(candidate);
    } catch (error) {
      const candidateError = error as { code?: unknown };
      if (candidateError.code === 6 || candidateError.code === 'already-exists') {
        return err({
          code: 'CONFLICT',
          message: `Answer gap candidate ${candidate.id} already exists`,
        });
      }

      return err(repositoryError(error));
    }
  }

  async update(
    candidate: AnswerGapCandidate
  ): Promise<Result<AnswerGapCandidate, AnswerGapCandidateRepositoryError>> {
    try {
      const ref = this.db.collection(ANSWER_GAP_CANDIDATES_COLLECTION).doc(candidate.id);
      const existing = await ref.get();
      if (!existing.exists) {
        return err({
          code: 'NOT_FOUND',
          message: `Answer gap candidate ${candidate.id} not found`,
        });
      }

      await ref.set(candidateToDoc(candidate));
      return ok(candidate);
    } catch (error) {
      return err(repositoryError(error));
    }
  }
}
