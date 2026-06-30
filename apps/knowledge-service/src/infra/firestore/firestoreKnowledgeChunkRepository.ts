import { err, getErrorMessage, ok, type Result } from '@fa/common-core';
import { FieldValue, getFirestore, type Firestore } from '@fa/infra-firestore';

import type { KnowledgePage, KnowledgePageChunk } from '../../domain/models/knowledge.js';
import {
  validateKnowledgeAccess,
  validateKnowledgePageChunks,
  validationError,
} from '../../domain/models/knowledgeValidation.js';
import type {
  KnowledgePageChunkMatch,
  KnowledgePageChunkRepository,
  KnowledgeRetrievalChunkCandidate,
  KnowledgeRepositoryError,
} from '../../domain/repositories/knowledgeRepositories.js';
import { KNOWLEDGE_PAGE_CHUNKS_COLLECTION, KNOWLEDGE_PAGES_COLLECTION } from './collections.js';
import { isoFromTimestamp, timestampFromIso } from './firestoreMapping.js';
import { pageToDoc } from './firestoreKnowledgePageRepository.js';

interface VectorQuerySnapshot {
  docs: {
    id: string;
    data(): Record<string, unknown>;
  }[];
}

interface VectorQuery {
  get(): Promise<VectorQuerySnapshot>;
}

interface VectorQuerySource {
  where(fieldPath: string, opStr: string, value: unknown): VectorQuerySource;
  findNearest(options: {
    vectorField: string;
    queryVector: unknown;
    limit: number;
    distanceMeasure: 'COSINE';
    distanceResultField: string;
  }): VectorQuery;
}

function repositoryError(error: unknown): KnowledgeRepositoryError {
  return { code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'Firestore operation failed') };
}

function vectorValue(embedding: readonly number[]): unknown {
  return FieldValue.vector([...embedding]);
}

function nullableStringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string or null`);
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

function optionalObjectField(
  data: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const value = data[key];
  if (value === undefined) {
    return undefined;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`${key} must be an object when present`);
}

function authStringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

function authNumberField(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (typeof value !== 'number') {
    throw new Error(`${key} must be a number`);
  }
  return value;
}

function authStringArrayField(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${key} must be a string array`);
  }
  return value.map((entry) => entry as string);
}

function embeddingField(data: Record<string, unknown>): number[] {
  const value = data['embedding'];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is number => typeof entry === 'number');
  }

  if (value !== null && typeof value === 'object' && 'toArray' in value) {
    const vector = (value as { toArray: () => unknown }).toArray();
    if (Array.isArray(vector)) {
      return vector.filter((entry): entry is number => typeof entry === 'number');
    }
  }

  return [];
}

function pageChunkToDoc(chunk: KnowledgePageChunk): Record<string, unknown> {
  return {
    ...chunk,
    path: [...chunk.path],
    headingPath: [...chunk.headingPath],
    access: { ...chunk.access },
    source: { ...chunk.source },
    embedding: vectorValue(chunk.embedding),
    createdAt: timestampFromIso(chunk.createdAt),
    deletedAt: chunk.deletedAt === null ? null : timestampFromIso(chunk.deletedAt),
    accessRefreshedAt: timestampFromIso(chunk.accessRefreshedAt),
  };
}

function validatePersistedKnowledgePageChunk(
  chunk: KnowledgePageChunk
): Result<void, KnowledgeRepositoryError> {
  if (chunk.embedding.length !== 2048) {
    return validationError('Persisted page chunks must include a 2048-length embedding');
  }

  const validation = validateKnowledgeAccess(chunk.access, 'chunk', {
    allowManual: false,
  });
  if (!validation.ok) {
    return validation;
  }

  return ok(undefined);
}

function pageChunkFromDoc(id: string, data: Record<string, unknown>): KnowledgePageChunk {
  const access = optionalObjectField(data, 'access');
  const source = objectField(data, 'source');
  const embeddingDimensions = authNumberField(data, 'embeddingDimensions');
  if (embeddingDimensions !== 2048) {
    throw new Error('embeddingDimensions must be 2048');
  }

  const chunk: KnowledgePageChunk = {
    id,
    status: authStringField(data, 'status') as KnowledgePageChunk['status'],
    pageId: authStringField(data, 'pageId'),
    nodeId: authStringField(data, 'nodeId'),
    categoryId: authStringField(data, 'categoryId'),
    sectionId: nullableStringField(data, 'sectionId'),
    title: authStringField(data, 'title'),
    path: authStringArrayField(data, 'path'),
    headingPath: authStringArrayField(data, 'headingPath'),
    index: authNumberField(data, 'index'),
    text: authStringField(data, 'text'),
    searchableText: authStringField(data, 'searchableText'),
    markdownContentHash: authStringField(data, 'markdownContentHash'),
    access:
      access === undefined
        ? (undefined as never)
        : {
            gate: authStringField(access, 'gate') as KnowledgePageChunk['access']['gate'],
            requiredLevel:
              typeof access['requiredLevel'] === 'number' ? access['requiredLevel'] : null,
          },
    accessRevision: authStringField(data, 'accessRevision'),
    accessSyncStatus: authStringField(
      data,
      'accessSyncStatus'
    ) as KnowledgePageChunk['accessSyncStatus'],
    source: {
      type: authStringField(source, 'type') as KnowledgePageChunk['source']['type'],
      url: nullableStringField(source, 'url'),
      label: nullableStringField(source, 'label'),
    },
    embedding: embeddingField(data),
    embeddingModel: authStringField(data, 'embeddingModel'),
    embeddingProvider: authStringField(data, 'embeddingProvider'),
    embeddingDimensions: 2048,
    createdAt: isoFromTimestamp(data['createdAt'], 'createdAt'),
    deletedAt: data['deletedAt'] === null ? null : isoFromTimestamp(data['deletedAt'], 'deletedAt'),
    createdByJobId: nullableStringField(data, 'createdByJobId'),
    accessRefreshedAt: isoFromTimestamp(data['accessRefreshedAt'], 'accessRefreshedAt'),
    accessRefreshJobId: nullableStringField(data, 'accessRefreshJobId'),
  };

  const validation = validatePersistedKnowledgePageChunk(chunk);
  if (!validation.ok) {
    throw new Error(validation.error.message);
  }
  return chunk;
}

function maybePageChunkFromDoc(
  id: string,
  data: Record<string, unknown>
): KnowledgePageChunk | null {
  try {
    return pageChunkFromDoc(id, data);
  } catch {
    return null;
  }
}

const lexicalCandidateFields = [
  'status',
  'pageId',
  'nodeId',
  'categoryId',
  'sectionId',
  'title',
  'path',
  'headingPath',
  'index',
  'text',
  'searchableText',
  'markdownContentHash',
  'access',
  'accessRevision',
  'accessSyncStatus',
  'source',
  'createdAt',
  'deletedAt',
  'createdByJobId',
  'accessRefreshedAt',
  'accessRefreshJobId',
] satisfies readonly (keyof KnowledgeRetrievalChunkCandidate)[];

function lexicalCandidateFromDoc(
  id: string,
  data: Record<string, unknown>
): KnowledgeRetrievalChunkCandidate {
  const access = optionalObjectField(data, 'access');
  const source = objectField(data, 'source');

  return {
    id,
    status: authStringField(data, 'status') as KnowledgeRetrievalChunkCandidate['status'],
    pageId: authStringField(data, 'pageId'),
    nodeId: authStringField(data, 'nodeId'),
    categoryId: authStringField(data, 'categoryId'),
    sectionId: nullableStringField(data, 'sectionId'),
    title: authStringField(data, 'title'),
    path: authStringArrayField(data, 'path'),
    headingPath: authStringArrayField(data, 'headingPath'),
    index: authNumberField(data, 'index'),
    text: authStringField(data, 'text'),
    searchableText: authStringField(data, 'searchableText'),
    markdownContentHash: authStringField(data, 'markdownContentHash'),
    access:
      access === undefined
        ? (undefined as never)
        : {
            gate: authStringField(
              access,
              'gate'
            ) as KnowledgeRetrievalChunkCandidate['access']['gate'],
            requiredLevel:
              typeof access['requiredLevel'] === 'number' ? access['requiredLevel'] : null,
          },
    accessRevision: authStringField(data, 'accessRevision'),
    accessSyncStatus: authStringField(
      data,
      'accessSyncStatus'
    ) as KnowledgeRetrievalChunkCandidate['accessSyncStatus'],
    source: {
      type: authStringField(source, 'type') as KnowledgeRetrievalChunkCandidate['source']['type'],
      url: nullableStringField(source, 'url'),
      label: nullableStringField(source, 'label'),
    },
    createdAt: isoFromTimestamp(data['createdAt'], 'createdAt'),
    deletedAt: data['deletedAt'] === null ? null : isoFromTimestamp(data['deletedAt'], 'deletedAt'),
    createdByJobId: nullableStringField(data, 'createdByJobId'),
    accessRefreshedAt: isoFromTimestamp(data['accessRefreshedAt'], 'accessRefreshedAt'),
    accessRefreshJobId: nullableStringField(data, 'accessRefreshJobId'),
  };
}

function pageChunkNeedsAccessRefresh(
  chunk: KnowledgePageChunk,
  input: {
    access: KnowledgePageChunk['access'];
    accessRevision: string;
    accessSyncStatus: KnowledgePageChunk['accessSyncStatus'];
  }
): boolean {
  return (
    chunk.access.gate !== input.access.gate ||
    chunk.access.requiredLevel !== input.access.requiredLevel ||
    chunk.accessRevision !== input.accessRevision ||
    chunk.accessSyncStatus !== input.accessSyncStatus
  );
}

export class FirestoreKnowledgeChunkRepository implements KnowledgePageChunkRepository {
  constructor(private readonly firestore?: Firestore) {}

  private get db(): Firestore {
    return this.firestore ?? getFirestore();
  }

  async replaceActiveForPage(input: {
    pageId: string;
    chunks: KnowledgePageChunk[];
    deletedAt: string;
  }): Promise<Result<void, KnowledgeRepositoryError>> {
    const validation = validateKnowledgePageChunks(input);
    if (!validation.ok) {
      return validation;
    }

    try {
      const collection = this.db.collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION);
      const existing = await collection
        .where('status', '==', 'active')
        .where('pageId', '==', input.pageId)
        .get();
      const batch = this.db.batch();
      const deletedAt = timestampFromIso(input.deletedAt);

      for (const doc of existing.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (data['pageId'] === input.pageId) {
          batch.update(collection.doc(doc.id), {
            status: 'deleted',
            deletedAt,
          });
        }
      }

      for (const chunk of input.chunks) {
        batch.set(collection.doc(chunk.id), pageChunkToDoc(chunk));
      }

      await batch.commit();
      return ok(undefined);
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async getPageChunkById(input: {
    chunkId: string;
  }): Promise<Result<KnowledgePageChunk | null, KnowledgeRepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION)
        .doc(input.chunkId)
        .get();
      const data = snapshot.data() as Record<string, unknown> | undefined;
      if (!snapshot.exists || data === undefined) {
        return ok(null);
      }

      return ok(maybePageChunkFromDoc(snapshot.id, data));
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async claimPageSync(input: {
    page: KnowledgePage;
    deletedAt: string;
  }): Promise<Result<KnowledgePage, KnowledgeRepositoryError>> {
    try {
      const pages = this.db.collection(KNOWLEDGE_PAGES_COLLECTION);
      const pageSnapshot = await pages.doc(input.page.id).get();
      const pageData = pageSnapshot.data() as Record<string, unknown> | undefined;
      if (!pageSnapshot.exists || pageData === undefined || pageData['status'] === 'deleted') {
        return err({ code: 'NOT_FOUND', message: `Knowledge page ${input.page.id} not found` });
      }

      const collection = this.db.collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION);
      const existing = await collection
        .where('status', '==', 'active')
        .where('pageId', '==', input.page.id)
        .get();
      const batch = this.db.batch();
      const deletedAt = timestampFromIso(input.deletedAt);
      batch.set(pages.doc(input.page.id), pageToDoc(input.page));

      for (const doc of existing.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (data['pageId'] === input.page.id) {
          batch.update(collection.doc(doc.id), {
            status: 'deleted',
            deletedAt,
          });
        }
      }

      await batch.commit();
      return ok(input.page);
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async softDeleteForPage(input: {
    pageId: string;
    deletedAt: string;
  }): Promise<Result<void, KnowledgeRepositoryError>> {
    try {
      const collection = this.db.collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION);
      const snapshot = await collection
        .where('status', '==', 'active')
        .where('pageId', '==', input.pageId)
        .get();
      const batch = this.db.batch();
      const deletedAt = timestampFromIso(input.deletedAt);

      for (const doc of snapshot.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (data['pageId'] === input.pageId) {
          batch.update(collection.doc(doc.id), {
            status: 'deleted',
            deletedAt,
          });
        }
      }

      await batch.commit();
      return ok(undefined);
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async listActiveForPage(input: {
    pageId: string;
  }): Promise<Result<KnowledgePageChunk[], KnowledgeRepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION)
        .where('status', '==', 'active')
        .where('pageId', '==', input.pageId)
        .orderBy('index', 'asc')
        .get();

      return ok(
        snapshot.docs.flatMap((doc) => {
          const chunk = maybePageChunkFromDoc(doc.id, doc.data());
          return chunk?.pageId !== input.pageId || chunk.status !== 'active' ? [] : [chunk];
        })
      );
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async listRetrievableActiveForPage(input: {
    pageId: string;
  }): Promise<Result<KnowledgePageChunk[], KnowledgeRepositoryError>> {
    return await this.listActiveForPage(input);
  }

  async listRetrievableActive(input: {
    limit: number;
  }): Promise<Result<KnowledgePageChunk[], KnowledgeRepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION)
        .where('status', '==', 'active')
        .limit(input.limit)
        .get();

      return ok(
        snapshot.docs.flatMap((doc) => {
          const chunk = maybePageChunkFromDoc(doc.id, doc.data());
          return chunk?.status === 'active' && chunk.accessSyncStatus === 'current' ? [chunk] : [];
        })
      );
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async listRetrievableActiveLexicalCandidates(input: { limit: number }): Promise<
    Result<
      {
        chunks: KnowledgeRetrievalChunkCandidate[];
        scannedCount: number;
        limitHit: boolean;
        activeCurrentChunkCount?: number;
      },
      KnowledgeRepositoryError
    >
  > {
    try {
      const snapshot = await this.db
        .collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION)
        .where('status', '==', 'active')
        .where('accessSyncStatus', '==', 'current')
        .orderBy('pageId', 'asc')
        .orderBy('index', 'asc')
        .select(...lexicalCandidateFields)
        .limit(input.limit + 1)
        .get();

      return ok({
        chunks: snapshot.docs
          .slice(0, input.limit)
          .map((doc) => lexicalCandidateFromDoc(doc.id, doc.data())),
        scannedCount: snapshot.docs.length,
        limitHit: snapshot.docs.length > input.limit,
      });
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async findNearestPageChunks(input: {
    embedding: number[];
    limit: number;
  }): Promise<Result<KnowledgePageChunkMatch[], KnowledgeRepositoryError>> {
    try {
      const source = this.db
        .collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION)
        .where('status', '==', 'active')
        .where('accessSyncStatus', '==', 'current') as unknown as VectorQuerySource;
      const snapshot = await source
        .findNearest({
          vectorField: 'embedding',
          queryVector: vectorValue(input.embedding),
          limit: input.limit,
          distanceMeasure: 'COSINE',
          distanceResultField: 'vectorDistance',
        })
        .get();

      return ok(
        snapshot.docs.flatMap((doc) => {
          const chunk = maybePageChunkFromDoc(doc.id, doc.data());
          if (chunk?.status !== 'active') {
            return [];
          }
          const distanceValue = doc.data()['vectorDistance'];
          const distance = typeof distanceValue === 'number' ? distanceValue : 1;
          return [{ ...chunk, vectorScore: 1 - distance }];
        })
      );
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async refreshAccessForPage(input: {
    pageId: string;
    access: KnowledgePageChunk['access'];
    accessRevision: string;
    accessSyncStatus: KnowledgePageChunk['accessSyncStatus'];
    expectedPageAccessRevision?: string;
    accessRefreshedAt: string;
    accessRefreshJobId: string;
    limit: number;
  }): Promise<
    Result<
      { processedChunkCount: number; hasMore: boolean; revisionConflict?: true },
      KnowledgeRepositoryError
    >
  > {
    try {
      if (input.expectedPageAccessRevision !== undefined) {
        const pages = this.db.collection(KNOWLEDGE_PAGES_COLLECTION);
        const pageSnapshot = await pages.doc(input.pageId).get();
        const pageData = pageSnapshot.data() as Record<string, unknown> | undefined;
        if (
          !pageSnapshot.exists ||
          pageData?.['status'] !== 'active' ||
          (
            (pageData['access'] as Record<string, unknown> | undefined)?.['effective'] as
              | Record<string, unknown>
              | undefined
          )?.['accessRevision'] !== input.expectedPageAccessRevision
        ) {
          return ok({ processedChunkCount: 0, hasMore: false, revisionConflict: true });
        }
      }

      const collection = this.db.collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION);
      const snapshot = await collection
        .where('status', '==', 'active')
        .where('pageId', '==', input.pageId)
        .orderBy('index', 'asc')
        .get();
      const candidates = snapshot.docs.filter((doc) => {
        const chunk = maybePageChunkFromDoc(doc.id, doc.data());
        return chunk !== null && pageChunkNeedsAccessRefresh(chunk, input);
      });
      const selected = candidates.slice(0, input.limit);
      const batch = this.db.batch();

      for (const doc of selected) {
        batch.update(collection.doc(doc.id), {
          access: { ...input.access },
          accessRevision: input.accessRevision,
          accessSyncStatus: input.accessSyncStatus,
          accessRefreshedAt: timestampFromIso(input.accessRefreshedAt),
          accessRefreshJobId: input.accessRefreshJobId,
        });
      }

      await batch.commit();
      return ok({
        processedChunkCount: selected.length,
        hasMore: candidates.length > selected.length,
      });
    } catch (error) {
      return err(repositoryError(error));
    }
  }
}
