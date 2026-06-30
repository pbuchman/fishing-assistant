import { err, getErrorMessage, ok, type Result } from '@fa/common-core';
import { getFirestore, type Firestore } from '@fa/infra-firestore';

import type {
  KnowledgePageCascadeDeleteResult,
  KnowledgePageCascadeRepository,
  KnowledgeRepositoryError,
} from '../../domain/repositories/knowledgeRepositories.js';
import {
  KNOWLEDGE_PAGE_CHUNKS_COLLECTION,
  KNOWLEDGE_NODES_COLLECTION,
  KNOWLEDGE_PAGES_COLLECTION,
} from './collections.js';
import { timestampFromIso } from './firestoreMapping.js';

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

export class FirestoreKnowledgePageCascadeRepository implements KnowledgePageCascadeRepository {
  constructor(private readonly firestore?: Firestore) {}

  private get db(): Firestore {
    return this.firestore ?? getFirestore();
  }

  async softDeletePage(input: {
    pageId: string;
    deletedAt: string;
    deletedByUserId: string;
  }): Promise<Result<KnowledgePageCascadeDeleteResult, KnowledgeRepositoryError>> {
    try {
      const pages = this.db.collection(KNOWLEDGE_PAGES_COLLECTION);
      const nodes = this.db.collection(KNOWLEDGE_NODES_COLLECTION);
      const chunks = this.db.collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION);
      const pageRef = pages.doc(input.pageId);
      const pageSnapshot = await pageRef.get();
      const pageData = pageSnapshot.data() as Record<string, unknown> | undefined;
      if (!pageSnapshot.exists || pageData === undefined || pageData['status'] === 'deleted') {
        return err({ code: 'NOT_FOUND', message: `Knowledge page ${input.pageId} not found` });
      }

      const nodeId = stringField(pageData, 'nodeId');
      const nodeRef = nodes.doc(nodeId);
      const nodeSnapshot = await nodeRef.get();
      const nodeData = nodeSnapshot.data() as Record<string, unknown> | undefined;
      if (
        !nodeSnapshot.exists ||
        nodeData === undefined ||
        nodeData['status'] === 'deleted' ||
        nodeData['pageId'] !== input.pageId
      ) {
        return err({ code: 'NOT_FOUND', message: `Knowledge node ${nodeId} not found` });
      }

      const activeChunks = await chunks
        .where('status', '==', 'active')
        .where('pageId', '==', input.pageId)
        .get();
      const batch = this.db.batch();
      const deletedAt = timestampFromIso(input.deletedAt);
      batch.update(pageRef, {
        status: 'deleted',
        updatedAt: deletedAt,
        deletedAt,
        deletedByUserId: input.deletedByUserId,
        accessSyncStatus: 'invalid',
      });
      batch.update(nodeRef, {
        status: 'deleted',
        updatedAt: deletedAt,
        deletedAt,
        deletedByUserId: input.deletedByUserId,
      });

      let deletedChunkCount = 0;
      for (const chunkDoc of activeChunks.docs) {
        const chunkData = chunkDoc.data() as Record<string, unknown>;
        if (chunkData['pageId'] !== input.pageId) {
          continue;
        }

        batch.update(chunks.doc(chunkDoc.id), {
          status: 'deleted',
          deletedAt,
        });
        deletedChunkCount += 1;
      }

      await batch.commit();
      return ok({ pageId: input.pageId, nodeId, deletedChunkCount });
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async softDeleteSubtree(input: {
    rootNodeId: string;
    deletedAt: string;
    deletedByUserId: string;
  }): Promise<
    Result<
      {
        rootNodeId: string;
        deletedSectionCount: number;
        deletedPageCount: number;
        deletedChunkCount: number;
      },
      KnowledgeRepositoryError
    >
  > {
    try {
      const nodes = this.db.collection(KNOWLEDGE_NODES_COLLECTION);
      const pages = this.db.collection(KNOWLEDGE_PAGES_COLLECTION);
      const chunks = this.db.collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION);
      const rootSnapshot = await nodes.doc(input.rootNodeId).get();
      const rootData = rootSnapshot.data() as Record<string, unknown> | undefined;
      if (!rootSnapshot.exists || rootData === undefined || rootData['status'] === 'deleted') {
        return err({ code: 'NOT_FOUND', message: `Knowledge node ${input.rootNodeId} not found` });
      }

      const activeNodes = await nodes.where('status', '==', 'active').get();
      const nodesToDelete = activeNodes.docs.filter((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const pathIds = Array.isArray(data['pathIds']) ? data['pathIds'] : [];
        return doc.id === input.rootNodeId || pathIds.includes(input.rootNodeId);
      });
      const pageIds = new Set<string>();
      let deletedSectionCount = 0;
      for (const doc of nodesToDelete) {
        const data = doc.data() as Record<string, unknown>;
        if (data['type'] === 'section') {
          deletedSectionCount += 1;
        }
        if (data['type'] === 'page' && typeof data['pageId'] === 'string') {
          pageIds.add(data['pageId']);
        }
      }

      const batch = this.db.batch();
      const deletedAt = timestampFromIso(input.deletedAt);
      for (const doc of nodesToDelete) {
        batch.update(nodes.doc(doc.id), {
          status: 'deleted',
          updatedAt: deletedAt,
          deletedAt,
          deletedByUserId: input.deletedByUserId,
        });
      }

      let deletedPageCount = 0;
      let deletedChunkCount = 0;
      for (const pageId of pageIds) {
        const pageRef = pages.doc(pageId);
        const pageSnapshot = await pageRef.get();
        const pageData = pageSnapshot.data() as Record<string, unknown> | undefined;
        if (pageSnapshot.exists && pageData?.['status'] === 'active') {
          batch.update(pageRef, {
            status: 'deleted',
            updatedAt: deletedAt,
            deletedAt,
            deletedByUserId: input.deletedByUserId,
            accessSyncStatus: 'invalid',
          });
          deletedPageCount += 1;
        }

        const activeChunks = await chunks
          .where('status', '==', 'active')
          .where('pageId', '==', pageId)
          .get();
        for (const chunkDoc of activeChunks.docs) {
          const chunkData = chunkDoc.data() as Record<string, unknown>;
          if (chunkData['pageId'] !== pageId) {
            continue;
          }

          batch.update(chunks.doc(chunkDoc.id), {
            status: 'deleted',
            deletedAt,
          });
          deletedChunkCount += 1;
        }
      }

      await batch.commit();
      return ok({
        rootNodeId: input.rootNodeId,
        deletedSectionCount,
        deletedPageCount,
        deletedChunkCount,
      });
    } catch (error) {
      return err(repositoryError(error));
    }
  }
}
