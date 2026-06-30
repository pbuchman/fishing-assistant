import { err, getErrorMessage, ok, type Result } from '@fa/common-core';
import { getFirestore, type Firestore } from '@fa/infra-firestore';

import type { KnowledgeNode } from '../../domain/models/knowledge.js';
import { validateKnowledgeNode } from '../../domain/models/knowledgeValidation.js';
import type {
  KnowledgeNodeRepository,
  KnowledgeRepositoryError,
} from '../../domain/repositories/knowledgeRepositories.js';
import { KNOWLEDGE_NODES_COLLECTION } from './collections.js';
import { isoFromTimestamp, timestampFromIso } from './firestoreMapping.js';

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

function numberField(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (typeof value !== 'number') {
    throw new Error(`${key} must be a number`);
  }
  return value;
}

function objectField(data: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = data[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${key} must be an object or null`);
  }
  return value as Record<string, unknown>;
}

function nodeToDoc(node: KnowledgeNode): Record<string, unknown> {
  return {
    ...node,
    pathIds: [...node.pathIds],
    pathTitles: [...node.pathTitles],
    categoryAccess: node.categoryAccess === null ? null : { ...node.categoryAccess },
    createdAt: timestampFromIso(node.createdAt),
    updatedAt: timestampFromIso(node.updatedAt),
    deletedAt: node.deletedAt === null ? null : timestampFromIso(node.deletedAt),
  };
}

function nodeFromDoc(id: string, data: Record<string, unknown>): KnowledgeNode {
  const categoryAccess = objectField(data, 'categoryAccess');
  const mappedNode: KnowledgeNode = {
    id,
    type: stringField(data, 'type') as KnowledgeNode['type'],
    status: stringField(data, 'status') as KnowledgeNode['status'],
    title: stringField(data, 'title'),
    slug: stringField(data, 'slug'),
    sortIndex: numberField(data, 'sortIndex'),
    parentId: nullableStringField(data, 'parentId'),
    categoryId: nullableStringField(data, 'categoryId'),
    sectionId: nullableStringField(data, 'sectionId'),
    pageId: nullableStringField(data, 'pageId'),
    depth: numberField(data, 'depth') as KnowledgeNode['depth'],
    pathIds: stringArrayField(data, 'pathIds'),
    pathTitles: stringArrayField(data, 'pathTitles'),
    categoryAccess:
      categoryAccess === null
        ? null
        : {
            gate: stringField(categoryAccess, 'gate') as NonNullable<
              KnowledgeNode['categoryAccess']
            >['gate'],
            requiredLevel:
              typeof categoryAccess['requiredLevel'] === 'number'
                ? categoryAccess['requiredLevel']
                : null,
            accessRevision: stringField(categoryAccess, 'accessRevision'),
          },
    createdAt: isoFromTimestamp(data['createdAt'], 'createdAt'),
    updatedAt: isoFromTimestamp(data['updatedAt'], 'updatedAt'),
    deletedAt: data['deletedAt'] === null ? null : isoFromTimestamp(data['deletedAt'], 'deletedAt'),
    createdByUserId: nullableStringField(data, 'createdByUserId'),
    updatedByUserId: nullableStringField(data, 'updatedByUserId'),
    deletedByUserId: nullableStringField(data, 'deletedByUserId'),
  };
  const validation = validateKnowledgeNode(mappedNode);
  if (!validation.ok) {
    throw new Error(validation.error.message);
  }
  return mappedNode;
}

export class FirestoreKnowledgeNodeRepository implements KnowledgeNodeRepository {
  constructor(private readonly firestore?: Firestore) {}

  private get db(): Firestore {
    return this.firestore ?? getFirestore();
  }

  async create(node: KnowledgeNode): Promise<Result<KnowledgeNode, KnowledgeRepositoryError>> {
    const validation = validateKnowledgeNode(node);
    if (!validation.ok) {
      return validation;
    }

    try {
      await this.db.collection(KNOWLEDGE_NODES_COLLECTION).doc(node.id).create(nodeToDoc(node));
      return ok(node);
    } catch (error) {
      const candidate = error as { code?: unknown };
      if (candidate.code === 6 || candidate.code === 'already-exists') {
        return err({ code: 'CONFLICT', message: `Knowledge node ${node.id} already exists` });
      }

      return err(repositoryError(error));
    }
  }

  async getById(nodeId: string): Promise<Result<KnowledgeNode | null, KnowledgeRepositoryError>> {
    try {
      const snapshot = await this.db.collection(KNOWLEDGE_NODES_COLLECTION).doc(nodeId).get();
      const data = snapshot.data() as Record<string, unknown> | undefined;
      return ok(!snapshot.exists || data === undefined ? null : nodeFromDoc(snapshot.id, data));
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async listActive(): Promise<Result<KnowledgeNode[], KnowledgeRepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(KNOWLEDGE_NODES_COLLECTION)
        .where('status', '==', 'active')
        .orderBy('sortIndex', 'asc')
        .get();

      return ok(
        snapshot.docs
          .map((doc) => nodeFromDoc(doc.id, doc.data() as Record<string, unknown>))
          .filter((node) => node.status === 'active')
          .sort(
            (left, right) =>
              left.pathIds.length - right.pathIds.length || left.sortIndex - right.sortIndex
          )
      );
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async update(node: KnowledgeNode): Promise<Result<KnowledgeNode, KnowledgeRepositoryError>> {
    const validation = validateKnowledgeNode(node);
    if (!validation.ok) {
      return validation;
    }

    try {
      const ref = this.db.collection(KNOWLEDGE_NODES_COLLECTION).doc(node.id);
      const snapshot = await ref.get();
      const data = snapshot.data() as Record<string, unknown> | undefined;
      if (!snapshot.exists || data === undefined || data['status'] === 'deleted') {
        return err({ code: 'NOT_FOUND', message: `Knowledge node ${node.id} not found` });
      }

      await ref.set(nodeToDoc(node));
      return ok(node);
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async softDeleteSubtree(input: {
    rootNodeId: string;
    deletedAt: string;
    deletedByUserId: string;
  }): Promise<Result<KnowledgeNode[], KnowledgeRepositoryError>> {
    try {
      const root = await this.getById(input.rootNodeId);
      if (!root.ok) {
        return root;
      }
      if (root.value === null || root.value.status === 'deleted') {
        return err({ code: 'NOT_FOUND', message: `Knowledge node ${input.rootNodeId} not found` });
      }

      const snapshot = await this.db
        .collection(KNOWLEDGE_NODES_COLLECTION)
        .where('status', '==', 'active')
        .get();
      const collection = this.db.collection(KNOWLEDGE_NODES_COLLECTION);
      const batch = this.db.batch();
      const deletedAt = timestampFromIso(input.deletedAt);
      const deleted: KnowledgeNode[] = [];

      for (const doc of snapshot.docs) {
        const node = nodeFromDoc(doc.id, doc.data());
        if (node.id !== root.value.id && !node.pathIds.includes(root.value.id)) {
          continue;
        }

        const next: KnowledgeNode = {
          ...node,
          status: 'deleted',
          updatedAt: input.deletedAt,
          deletedAt: input.deletedAt,
          deletedByUserId: input.deletedByUserId,
        };
        batch.update(collection.doc(doc.id), {
          status: 'deleted',
          updatedAt: deletedAt,
          deletedAt,
          deletedByUserId: input.deletedByUserId,
        });
        deleted.push(next);
      }

      await batch.commit();
      return ok(deleted);
    } catch (error) {
      return err(repositoryError(error));
    }
  }
}
