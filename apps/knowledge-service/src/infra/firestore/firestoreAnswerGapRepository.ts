import { FieldPath } from 'firebase-admin/firestore';

import { err, getErrorMessage, ok, type Result } from '@fa/common-core';
import { getFirestore, type Firestore, type Query } from '@fa/infra-firestore';

import {
  answerGapOriginFromSource,
  encodeAnswerGapCursor,
  type AnswerGap,
  type AnswerGapContextMessage,
} from '../../domain/models/answerGap.js';
import type {
  AnswerGapListQuery,
  AnswerGapRepository,
} from '../../domain/repositories/answerGapRepository.js';
import type { KnowledgeRepositoryError } from '../../domain/repositories/knowledgeRepositories.js';
import { ANSWER_GAPS_COLLECTION } from './collections.js';
import { isoFromTimestamp, timestampFromIso } from './firestoreMapping.js';

type StoredAnswerGapCoverageKind = NonNullable<AnswerGap['coverageKind']>;

function repositoryError(error: unknown): KnowledgeRepositoryError {
  return { code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'Firestore operation failed') };
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

function nullableStringField(data: Record<string, unknown>, key: string): string | null {
  if (!(key in data)) {
    throw new Error(`${key} must be present as string or null`);
  }
  const value = data[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string or null`);
  }
  return value;
}

function booleanField(data: Record<string, unknown>, key: string): boolean {
  const value = data[key];
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function optionalNullableStringField(data: Record<string, unknown>, key: string): string | null {
  if (!(key in data)) {
    return null;
  }
  return nullableStringField(data, key);
}

function numberField(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (typeof value !== 'number') {
    throw new Error(`${key} must be a number`);
  }
  return value;
}

function objectField(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = data[key];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringArrayField(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${key} must be a string array`);
  }
  return value.map((entry) => entry as string);
}

function contextWindowFromData(data: Record<string, unknown>): AnswerGapContextMessage[] {
  const value = data['contextWindow'];
  if (!Array.isArray(value)) {
    throw new Error('contextWindow must be an array');
  }
  return value.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`contextWindow[${String(index)}] must be an object`);
    }
    const message = entry as Record<string, unknown>;
    return {
      role: stringField(message, 'role') as AnswerGapContextMessage['role'],
      content: stringField(message, 'content'),
    };
  });
}

function answerGapToDoc(gap: AnswerGap): Record<string, unknown> {
  return {
    ...gap,
    missingInformation: [...gap.missingInformation],
    requester: { ...gap.requester },
    ...(gap.consent === undefined ? {} : { consent: { ...gap.consent } }),
    conversation: {
      ...gap.conversation,
      contextWindow: gap.conversation.contextWindow.map((message) => ({ ...message })),
    },
    coverageProbe: { ...gap.coverageProbe },
    processing: { ...gap.processing },
    createdAt: timestampFromIso(gap.createdAt),
    updatedAt: timestampFromIso(gap.updatedAt),
    doneAt: gap.doneAt === null ? null : timestampFromIso(gap.doneAt),
  };
}

function coverageKindFromData(data: Record<string, unknown>): StoredAnswerGapCoverageKind {
  return 'coverageKind' in data && data['coverageKind'] !== undefined
    ? (stringField(data, 'coverageKind') as StoredAnswerGapCoverageKind)
    : 'coverage_unknown';
}

function consentFromData(data: Record<string, unknown>): NonNullable<AnswerGap['consent']> {
  if (!('consent' in data) || data['consent'] === undefined) {
    return {
      status: 'system_imported',
      sharedAt: null,
      withdrawnAt: null,
      includeContext: true,
      includeContact: true,
      candidateId: null,
    };
  }

  const consent = objectField(data, 'consent');
  return {
    status: stringField(consent, 'status') as NonNullable<AnswerGap['consent']>['status'],
    sharedAt: nullableStringField(consent, 'sharedAt'),
    withdrawnAt: nullableStringField(consent, 'withdrawnAt'),
    includeContext: booleanField(consent, 'includeContext'),
    includeContact: booleanField(consent, 'includeContact'),
    candidateId: nullableStringField(consent, 'candidateId'),
  };
}

function answerGapFromDoc(id: string, data: Record<string, unknown>): AnswerGap {
  const requester = objectField(data, 'requester');
  const source = stringField(data, 'source') as AnswerGap['source'];
  const origin =
    'origin' in data && data['origin'] !== undefined
      ? {
          reason: stringField(objectField(data, 'origin'), 'reason') as NonNullable<
            AnswerGap['origin']
          >['reason'],
        }
      : answerGapOriginFromSource(source);
  const conversation = objectField(data, 'conversation');
  const coverageProbe = objectField(data, 'coverageProbe');
  const processing = objectField(data, 'processing');
  return {
    id,
    status: stringField(data, 'status') as AnswerGap['status'],
    source,
    origin,
    question: stringField(data, 'question'),
    formulatedQuestion: stringField(data, 'formulatedQuestion'),
    missingInformation: stringArrayField(data, 'missingInformation'),
    requester: {
      userId: stringField(requester, 'userId'),
      email: nullableStringField(requester, 'email'),
      firstName: optionalNullableStringField(requester, 'firstName'),
      lastName: optionalNullableStringField(requester, 'lastName'),
      role: stringField(requester, 'role') as AnswerGap['requester']['role'],
      effectiveLevel: numberField(requester, 'effectiveLevel'),
    },
    conversation: {
      conversationId: stringField(conversation, 'conversationId'),
      userMessageId: stringField(conversation, 'userMessageId'),
      assistantMessageId: stringField(conversation, 'assistantMessageId'),
      contextWindow: contextWindowFromData(conversation),
    },
    coverageProbe: {
      classification: stringField(
        coverageProbe,
        'classification'
      ) as AnswerGap['coverageProbe']['classification'],
      minRequiredLevel:
        coverageProbe['minRequiredLevel'] === null
          ? null
          : numberField(coverageProbe, 'minRequiredLevel'),
      candidateCountBucket: stringField(
        coverageProbe,
        'candidateCountBucket'
      ) as AnswerGap['coverageProbe']['candidateCountBucket'],
      probeVersion: stringField(coverageProbe, 'probeVersion') as '1.0.0',
    },
    coverageKind: coverageKindFromData(data),
    consent: consentFromData(data),
    processing: {
      similarityStatus: stringField(
        processing,
        'similarityStatus'
      ) as AnswerGap['processing']['similarityStatus'],
    },
    createdAt: isoFromTimestamp(data['createdAt'], 'createdAt'),
    updatedAt: isoFromTimestamp(data['updatedAt'], 'updatedAt'),
    doneAt: data['doneAt'] === null ? null : isoFromTimestamp(data['doneAt'], 'doneAt'),
    doneByUserId: nullableStringField(data, 'doneByUserId'),
  };
}

function compareAnswerGaps(left: AnswerGap, right: AnswerGap): number {
  return right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id);
}

function isAfterCursor(gap: AnswerGap, query: AnswerGapListQuery): boolean {
  if (query.cursor === undefined) {
    return true;
  }
  if (gap.createdAt < query.cursor.createdAt) {
    return true;
  }
  return gap.createdAt === query.cursor.createdAt && gap.id > query.cursor.id;
}

export class FirestoreAnswerGapRepository implements AnswerGapRepository {
  constructor(private readonly firestore?: Firestore) {}

  private get db(): Firestore {
    return this.firestore ?? getFirestore();
  }

  async getById(id: string): Promise<Result<AnswerGap | null, KnowledgeRepositoryError>> {
    try {
      const snapshot = await this.db.collection(ANSWER_GAPS_COLLECTION).doc(id).get();
      const data = snapshot.data() as Record<string, unknown> | undefined;
      return ok(
        !snapshot.exists || data === undefined ? null : answerGapFromDoc(snapshot.id, data)
      );
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async create(gap: AnswerGap): Promise<Result<AnswerGap, KnowledgeRepositoryError>> {
    try {
      await this.db.collection(ANSWER_GAPS_COLLECTION).doc(gap.id).create(answerGapToDoc(gap));
      return ok(gap);
    } catch (error) {
      const candidate = error as { code?: unknown };
      if (candidate.code === 6 || candidate.code === 'already-exists') {
        return err({ code: 'CONFLICT', message: `Answer Gap ${gap.id} exists` });
      }
      return err(repositoryError(error));
    }
  }

  async update(gap: AnswerGap): Promise<Result<AnswerGap, KnowledgeRepositoryError>> {
    try {
      const ref = this.db.collection(ANSWER_GAPS_COLLECTION).doc(gap.id);
      const snapshot = await ref.get();
      if (!snapshot.exists) {
        return err({ code: 'NOT_FOUND', message: `Answer Gap ${gap.id} not found` });
      }
      await ref.set(answerGapToDoc(gap));
      return ok(gap);
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async list(
    query: AnswerGapListQuery
  ): Promise<
    Result<
      { gaps: AnswerGap[]; nextCursor: string | null; totalCount: number },
      KnowledgeRepositoryError
    >
  > {
    try {
      let firestoreQuery: Query = this.db.collection(ANSWER_GAPS_COLLECTION);
      if (query.status === 'needs_answer') {
        firestoreQuery = firestoreQuery.where('status', '==', 'needs_answer');
      }
      firestoreQuery = firestoreQuery
        .orderBy('createdAt', 'desc')
        .orderBy(FieldPath.documentId(), 'asc');

      const snapshot = await firestoreQuery.get();
      const sorted = snapshot.docs
        .map((doc) => answerGapFromDoc(doc.id, doc.data() as Record<string, unknown>))
        .filter((gap) => query.status === 'all' || gap.status === 'needs_answer')
        .sort(compareAnswerGaps);
      const candidates = sorted.filter((gap) => isAfterCursor(gap, query));
      const page = candidates.slice(0, query.limit);
      const hasMore = candidates.length > query.limit;
      const lastGap = page.at(-1);
      return ok({
        gaps: page,
        totalCount: sorted.length,
        nextCursor:
          hasMore && lastGap !== undefined
            ? encodeAnswerGapCursor({
                filter: query.status,
                createdAt: lastGap.createdAt,
                id: lastGap.id,
              })
            : null,
      });
    } catch (error) {
      return err(repositoryError(error));
    }
  }
}
