import { err, getErrorMessage, ok, type Result } from '@fa/common-core';
import { getFirestore, type Firestore } from '@fa/infra-firestore';

import type {
  KnowledgeContentQualityAcknowledgement,
  KnowledgePage,
  KnowledgePageAccessOverride,
} from '../../domain/models/knowledge.js';
import {
  validateKnowledgeAccess,
  validateKnowledgePage,
  validateKnowledgeSourceUrl,
} from '../../domain/models/knowledgeValidation.js';
import type {
  KnowledgePageRepository,
  KnowledgeRetrievalPageMetadata,
  KnowledgeRepositoryError,
} from '../../domain/repositories/knowledgeRepositories.js';
import { KNOWLEDGE_PAGES_COLLECTION } from './collections.js';
import { isoFromTimestamp, timestampFromIso } from './firestoreMapping.js';

const retrievalMetadataBatchSize = 300;
const retrievalMetadataFieldMask = [
  'nodeId',
  'status',
  'title',
  'slug',
  'categoryId',
  'sectionId',
  'pathIds',
  'pathTitles',
  'hierarchy',
  'source',
  'access',
  'relations',
  'markdownContentHash',
  'indexingStatus',
  'syncStatus',
  'accessSyncStatus',
  'indexingError',
  'syncError',
  'accessSyncError',
  'chunkCount',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'createdByUserId',
  'updatedByUserId',
  'deletedByUserId',
] as const satisfies readonly Exclude<keyof KnowledgeRetrievalPageMetadata, 'id'>[];

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

function stringArrayField(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${key} must be a string array`);
  }
  return value.map((entry) => entry as string);
}

function contentQualityAcknowledgementsFromObject(
  data: Record<string, unknown>
): KnowledgeContentQualityAcknowledgement[] {
  const value = data['contentQualityAcknowledgements'];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('contentQualityAcknowledgements must be an array');
  }

  return value.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('contentQualityAcknowledgements entries must be objects');
    }
    const acknowledgement = entry as Record<string, unknown>;
    return {
      issueType: stringField(
        acknowledgement,
        'issueType'
      ) as KnowledgeContentQualityAcknowledgement['issueType'],
      markdownContentHash: stringField(acknowledgement, 'markdownContentHash'),
      issueFingerprints: stringArrayField(acknowledgement, 'issueFingerprints'),
      reason: nullableStringField(acknowledgement, 'reason'),
      acknowledgedAt: stringField(acknowledgement, 'acknowledgedAt'),
      acknowledgedByUserId: stringField(acknowledgement, 'acknowledgedByUserId'),
    };
  });
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

function nullableObjectField(
  data: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  if (!(key in data)) {
    throw new Error(`${key} must be present as object or null`);
  }
  const value = data[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${key} must be an object or null`);
  }
  return value as Record<string, unknown>;
}

export function pageToDoc(page: KnowledgePage): Record<string, unknown> {
  return {
    ...page,
    pathIds: [...page.pathIds],
    pathTitles: [...page.pathTitles],
    hierarchy: { ...page.hierarchy },
    source: {
      ...page.source,
      importer: page.source.importer === null ? null : { ...page.source.importer },
    },
    access: {
      ...page.access,
      override: page.access.override === null ? null : { ...page.access.override },
      effective: { ...page.access.effective },
    },
    relations: {
      relatedTo: [...page.relations.relatedTo],
      linksTo: [...page.relations.linksTo],
      supersedes: [...page.relations.supersedes],
    },
    contentQualityAcknowledgements: (page.contentQualityAcknowledgements ?? []).map(
      (acknowledgement) => ({
        ...acknowledgement,
        issueFingerprints: [...acknowledgement.issueFingerprints],
      })
    ),
    createdAt: timestampFromIso(page.createdAt),
    updatedAt: timestampFromIso(page.updatedAt),
    deletedAt: page.deletedAt === null ? null : timestampFromIso(page.deletedAt),
  };
}

function accessFromObject(data: Record<string, unknown>): {
  gate: KnowledgePage['access']['effective']['gate'];
  requiredLevel: number | null;
  accessRevision: string;
} {
  return {
    gate: stringField(data, 'gate') as KnowledgePage['access']['effective']['gate'],
    requiredLevel: data['requiredLevel'] === null ? null : numberField(data, 'requiredLevel'),
    accessRevision: stringField(data, 'accessRevision'),
  };
}

function overrideFromObject(
  data: Record<string, unknown> | null
): KnowledgePageAccessOverride | null {
  if (data === null) {
    return null;
  }

  return {
    gate: stringField(data, 'gate') as KnowledgePageAccessOverride['gate'],
    requiredLevel: data['requiredLevel'] === null ? null : numberField(data, 'requiredLevel'),
    source: stringField(data, 'source') as KnowledgePageAccessOverride['source'],
    recordedAt: stringField(data, 'recordedAt'),
    recordedByUserId: nullableStringField(data, 'recordedByUserId'),
  };
}

function pageFromDoc(id: string, data: Record<string, unknown>): KnowledgePage {
  const hierarchy = objectField(data, 'hierarchy');
  const source = objectField(data, 'source');
  const importer = nullableObjectField(source, 'importer');
  const access = objectField(data, 'access');
  const effective = objectField(access, 'effective');
  const overrideValue = access['override'];
  const override =
    overrideValue !== null && typeof overrideValue === 'object' && !Array.isArray(overrideValue)
      ? (overrideValue as Record<string, unknown>)
      : null;
  const relations = objectField(data, 'relations');

  const page = {
    id,
    nodeId: stringField(data, 'nodeId'),
    status: stringField(data, 'status') as KnowledgePage['status'],
    title: stringField(data, 'title'),
    slug: stringField(data, 'slug'),
    categoryId: stringField(data, 'categoryId'),
    sectionId: nullableStringField(data, 'sectionId'),
    pathIds: stringArrayField(data, 'pathIds'),
    pathTitles: stringArrayField(data, 'pathTitles'),
    hierarchy: {
      category: stringField(hierarchy, 'category'),
      ...(typeof hierarchy['section'] === 'string' ? { section: hierarchy['section'] } : {}),
    },
    source: {
      type: stringField(source, 'type') as KnowledgePage['source']['type'],
      url: nullableStringField(source, 'url'),
      label: nullableStringField(source, 'label'),
      importer:
        importer === null
          ? null
          : {
              provider: stringField(importer, 'provider'),
              externalId: stringField(importer, 'externalId'),
              importedAt: stringField(importer, 'importedAt'),
            },
    },
    access: {
      inheritedFromCategoryId: stringField(access, 'inheritedFromCategoryId'),
      categoryAccessRevision: stringField(access, 'categoryAccessRevision'),
      override: overrideFromObject(override),
      effective: accessFromObject(effective),
    },
    relations: {
      relatedTo: stringArrayField(relations, 'relatedTo'),
      linksTo: stringArrayField(relations, 'linksTo'),
      supersedes: stringArrayField(relations, 'supersedes'),
    },
    markdown: stringField(data, 'markdown'),
    normalizedMarkdown: stringField(data, 'normalizedMarkdown'),
    markdownContentHash: stringField(data, 'markdownContentHash'),
    contentQualityAcknowledgements: contentQualityAcknowledgementsFromObject(data),
    indexingStatus: stringField(data, 'indexingStatus') as KnowledgePage['indexingStatus'],
    syncStatus: stringField(data, 'syncStatus') as KnowledgePage['syncStatus'],
    accessSyncStatus: stringField(data, 'accessSyncStatus') as KnowledgePage['accessSyncStatus'],
    indexingError: nullableStringField(data, 'indexingError'),
    syncError: nullableStringField(data, 'syncError'),
    accessSyncError: nullableStringField(data, 'accessSyncError'),
    chunkCount: numberField(data, 'chunkCount'),
    createdAt: isoFromTimestamp(data['createdAt'], 'createdAt'),
    updatedAt: isoFromTimestamp(data['updatedAt'], 'updatedAt'),
    deletedAt: data['deletedAt'] === null ? null : isoFromTimestamp(data['deletedAt'], 'deletedAt'),
    createdByUserId: stringField(data, 'createdByUserId'),
    updatedByUserId: stringField(data, 'updatedByUserId'),
    deletedByUserId: nullableStringField(data, 'deletedByUserId'),
  };
  const validation = validateKnowledgePage(page);
  if (!validation.ok) {
    throw new Error(validation.error.message);
  }
  return page;
}

function validateRetrievalPageMetadata(metadata: KnowledgeRetrievalPageMetadata): void {
  const effectiveAccess = validateKnowledgeAccess(metadata.access.effective, 'page effective', {
    allowManual: true,
  });
  if (!effectiveAccess.ok) {
    throw new Error(effectiveAccess.error.message);
  }

  if (metadata.access.override !== null) {
    const overrideAccess = validateKnowledgeAccess(metadata.access.override, 'page override', {
      allowManual: true,
    });
    if (!overrideAccess.ok) {
      throw new Error(overrideAccess.error.message);
    }
  }

  const sourceValidation = validateKnowledgeSourceUrl(metadata.source, 'page source');
  if (!sourceValidation.ok) {
    throw new Error(sourceValidation.error.message);
  }

  if (metadata.access.inheritedFromCategoryId !== metadata.categoryId) {
    throw new Error('Knowledge pages must inherit access from their category');
  }
}

function retrievalPageMetadataFromDoc(
  id: string,
  data: Record<string, unknown>
): KnowledgeRetrievalPageMetadata {
  const hierarchy = objectField(data, 'hierarchy');
  const source = objectField(data, 'source');
  const importer = nullableObjectField(source, 'importer');
  const access = objectField(data, 'access');
  const effective = objectField(access, 'effective');
  const overrideValue = access['override'];
  const override =
    overrideValue !== null && typeof overrideValue === 'object' && !Array.isArray(overrideValue)
      ? (overrideValue as Record<string, unknown>)
      : null;
  const relations = objectField(data, 'relations');

  const metadata = {
    id,
    nodeId: stringField(data, 'nodeId'),
    status: stringField(data, 'status') as KnowledgePage['status'],
    title: stringField(data, 'title'),
    slug: stringField(data, 'slug'),
    categoryId: stringField(data, 'categoryId'),
    sectionId: nullableStringField(data, 'sectionId'),
    pathIds: stringArrayField(data, 'pathIds'),
    pathTitles: stringArrayField(data, 'pathTitles'),
    hierarchy: {
      category: stringField(hierarchy, 'category'),
      ...(typeof hierarchy['section'] === 'string' ? { section: hierarchy['section'] } : {}),
    },
    source: {
      type: stringField(source, 'type') as KnowledgePage['source']['type'],
      url: nullableStringField(source, 'url'),
      label: nullableStringField(source, 'label'),
      importer:
        importer === null
          ? null
          : {
              provider: stringField(importer, 'provider'),
              externalId: stringField(importer, 'externalId'),
              importedAt: stringField(importer, 'importedAt'),
            },
    },
    access: {
      inheritedFromCategoryId: stringField(access, 'inheritedFromCategoryId'),
      categoryAccessRevision: stringField(access, 'categoryAccessRevision'),
      override: overrideFromObject(override),
      effective: accessFromObject(effective),
    },
    relations: {
      relatedTo: stringArrayField(relations, 'relatedTo'),
      linksTo: stringArrayField(relations, 'linksTo'),
      supersedes: stringArrayField(relations, 'supersedes'),
    },
    markdownContentHash: stringField(data, 'markdownContentHash'),
    indexingStatus: stringField(data, 'indexingStatus') as KnowledgePage['indexingStatus'],
    syncStatus: stringField(data, 'syncStatus') as KnowledgePage['syncStatus'],
    accessSyncStatus: stringField(data, 'accessSyncStatus') as KnowledgePage['accessSyncStatus'],
    indexingError: nullableStringField(data, 'indexingError'),
    syncError: nullableStringField(data, 'syncError'),
    accessSyncError: nullableStringField(data, 'accessSyncError'),
    chunkCount: numberField(data, 'chunkCount'),
    createdAt: isoFromTimestamp(data['createdAt'], 'createdAt'),
    updatedAt: isoFromTimestamp(data['updatedAt'], 'updatedAt'),
    deletedAt: data['deletedAt'] === null ? null : isoFromTimestamp(data['deletedAt'], 'deletedAt'),
    createdByUserId: stringField(data, 'createdByUserId'),
    updatedByUserId: stringField(data, 'updatedByUserId'),
    deletedByUserId: nullableStringField(data, 'deletedByUserId'),
  };
  validateRetrievalPageMetadata(metadata);
  return metadata;
}

export class FirestoreKnowledgePageRepository implements KnowledgePageRepository {
  constructor(private readonly firestore?: Firestore) {}

  private get db(): Firestore {
    return this.firestore ?? getFirestore();
  }

  async create(page: KnowledgePage): Promise<Result<KnowledgePage, KnowledgeRepositoryError>> {
    const validation = validateKnowledgePage(page);
    if (!validation.ok) {
      return validation;
    }

    try {
      await this.db.collection(KNOWLEDGE_PAGES_COLLECTION).doc(page.id).create(pageToDoc(page));
      return ok(page);
    } catch (error) {
      const candidate = error as { code?: unknown };
      if (candidate.code === 6 || candidate.code === 'already-exists') {
        return err({ code: 'CONFLICT', message: `Knowledge page ${page.id} already exists` });
      }

      return err(repositoryError(error));
    }
  }

  async getById(pageId: string): Promise<Result<KnowledgePage | null, KnowledgeRepositoryError>> {
    try {
      const snapshot = await this.db.collection(KNOWLEDGE_PAGES_COLLECTION).doc(pageId).get();
      const data = snapshot.data() as Record<string, unknown> | undefined;
      return ok(!snapshot.exists || data === undefined ? null : pageFromDoc(snapshot.id, data));
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async getRetrievalMetadataByIds(
    pageIds: string[]
  ): Promise<Result<Map<string, KnowledgeRetrievalPageMetadata>, KnowledgeRepositoryError>> {
    try {
      const uniquePageIds = [...new Set(pageIds)];
      const metadataById = new Map<string, KnowledgeRetrievalPageMetadata>();

      for (
        let startIndex = 0;
        startIndex < uniquePageIds.length;
        startIndex += retrievalMetadataBatchSize
      ) {
        const batchPageIds = uniquePageIds.slice(
          startIndex,
          startIndex + retrievalMetadataBatchSize
        );
        if (batchPageIds.length === 0) {
          continue;
        }

        const refs = batchPageIds.map((pageId) =>
          this.db.collection(KNOWLEDGE_PAGES_COLLECTION).doc(pageId)
        );
        const snapshots = await this.db.getAll(...refs, {
          fieldMask: [...retrievalMetadataFieldMask],
        });

        for (const snapshot of snapshots) {
          const data = snapshot.data() as Record<string, unknown> | undefined;
          if (!snapshot.exists || data === undefined) {
            continue;
          }
          metadataById.set(snapshot.id, retrievalPageMetadataFromDoc(snapshot.id, data));
        }
      }

      return ok(metadataById);
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async listActive(): Promise<Result<KnowledgePage[], KnowledgeRepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(KNOWLEDGE_PAGES_COLLECTION)
        .where('status', '==', 'active')
        .orderBy('updatedAt', 'desc')
        .get();

      return ok(
        snapshot.docs
          .map((doc) => pageFromDoc(doc.id, doc.data() as Record<string, unknown>))
          .filter((page) => page.status === 'active')
      );
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async recordEffectiveAccessOverride(input: {
    pageId: string;
    override: KnowledgePageAccessOverride;
    effectiveAccessRevision: string;
    updatedAt: string;
  }): Promise<Result<KnowledgePage, KnowledgeRepositoryError>> {
    const overrideValidation = validateKnowledgeAccess(input.override, 'page override', {
      allowManual: true,
    });
    if (!overrideValidation.ok) {
      return overrideValidation;
    }

    try {
      const ref = this.db.collection(KNOWLEDGE_PAGES_COLLECTION).doc(input.pageId);
      const snapshot = await ref.get();
      const data = snapshot.data() as Record<string, unknown> | undefined;
      if (!snapshot.exists || data === undefined || data['status'] === 'deleted') {
        return err({ code: 'NOT_FOUND', message: `Knowledge page ${input.pageId} not found` });
      }

      const existing = pageFromDoc(snapshot.id, data);
      const next: KnowledgePage = {
        ...existing,
        access: {
          ...existing.access,
          override: { ...input.override },
          effective: {
            gate: input.override.gate,
            requiredLevel: input.override.requiredLevel,
            accessRevision: input.effectiveAccessRevision,
          },
        },
        accessSyncStatus: 'stale',
        updatedAt: input.updatedAt,
      };
      await ref.set(pageToDoc(next));
      return ok(next);
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async listActiveByCategory(input: {
    categoryId: string;
  }): Promise<Result<KnowledgePage[], KnowledgeRepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(KNOWLEDGE_PAGES_COLLECTION)
        .where('status', '==', 'active')
        .where('categoryId', '==', input.categoryId)
        .orderBy('updatedAt', 'desc')
        .get();

      return ok(
        snapshot.docs
          .map((doc) => pageFromDoc(doc.id, doc.data() as Record<string, unknown>))
          .filter((page) => page.status === 'active' && page.categoryId === input.categoryId)
      );
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async listActiveBySection(input: {
    sectionId: string;
  }): Promise<Result<KnowledgePage[], KnowledgeRepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(KNOWLEDGE_PAGES_COLLECTION)
        .where('status', '==', 'active')
        .where('sectionId', '==', input.sectionId)
        .orderBy('updatedAt', 'desc')
        .get();

      return ok(
        snapshot.docs
          .map((doc) => pageFromDoc(doc.id, doc.data() as Record<string, unknown>))
          .filter((page) => page.status === 'active' && page.sectionId === input.sectionId)
      );
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async update(page: KnowledgePage): Promise<Result<KnowledgePage, KnowledgeRepositoryError>> {
    const validation = validateKnowledgePage(page);
    if (!validation.ok) {
      return validation;
    }

    try {
      const ref = this.db.collection(KNOWLEDGE_PAGES_COLLECTION).doc(page.id);
      const snapshot = await ref.get();
      const data = snapshot.data() as Record<string, unknown> | undefined;
      if (!snapshot.exists || data === undefined || data['status'] === 'deleted') {
        return err({ code: 'NOT_FOUND', message: `Knowledge page ${page.id} not found` });
      }

      await ref.set(pageToDoc(page));
      return ok(page);
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async markAccessRefreshState(input: {
    pageId: string;
    expectedAccessRevision?: string;
    accessSyncStatus: KnowledgePage['accessSyncStatus'];
    accessSyncError: string | null;
    updatedAt: string;
    updatedByUserId: string;
  }): Promise<Result<void, KnowledgeRepositoryError>> {
    try {
      return await this.db.runTransaction(async (transaction) => {
        const ref = this.db.collection(KNOWLEDGE_PAGES_COLLECTION).doc(input.pageId);
        const snapshot = await transaction.get(ref);
        const data = snapshot.data() as Record<string, unknown> | undefined;
        if (!snapshot.exists || data === undefined || data['status'] === 'deleted') {
          return err({ code: 'NOT_FOUND', message: `Knowledge page ${input.pageId} not found` });
        }
        const existing = pageFromDoc(snapshot.id, data);
        if (
          input.expectedAccessRevision !== undefined &&
          existing.access.effective.accessRevision !== input.expectedAccessRevision
        ) {
          return err({
            code: 'CONFLICT',
            message: 'Knowledge page access revision changed before refresh state update',
          });
        }
        transaction.update(ref, {
          accessSyncStatus: input.accessSyncStatus,
          accessSyncError: input.accessSyncError,
          updatedAt: timestampFromIso(input.updatedAt),
          updatedByUserId: input.updatedByUserId,
        });
        return ok(undefined);
      });
    } catch (error) {
      return err(repositoryError(error));
    }
  }
}
