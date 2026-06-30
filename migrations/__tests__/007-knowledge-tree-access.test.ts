import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../007_knowledge-tree-access.mjs'; // @allow-missing-js -- migration modules are .mjs

const expectedKnowledgeTreeIndexes = [
  {
    collectionGroup: 'fa_knowledge_nodes',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'parentId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'sortIndex', order: 'ASCENDING' },
      { fieldPath: 'title', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_nodes',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'categoryId', order: 'ASCENDING' },
      { fieldPath: 'type', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'sortIndex', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_pages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'categoryId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_pages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'syncStatus', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_pages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'indexingStatus', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_pages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_pages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'syncStatus', order: 'ASCENDING' },
      { fieldPath: 'indexingStatus', order: 'ASCENDING' },
      { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_pages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'access.effective.accessRevision', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_chunks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'pageId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'index', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_chunks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'categoryId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
      { fieldPath: 'accessRevision', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_chunks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
      { fieldPath: 'accessRefreshedAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_chunks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
      { fieldPath: 'embedding', vectorConfig: { dimension: 2048, flat: {} } },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_refresh_jobs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'nextRunAt', order: 'ASCENDING' },
      { fieldPath: 'priority', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_refresh_jobs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'leaseExpiresAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_refresh_jobs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'target.categoryId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_refresh_jobs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_refresh_jobs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'finishedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_audits',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'severity', order: 'ASCENDING' },
      { fieldPath: 'detectedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_audits',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'pageId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'detectedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_audits',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'chunkId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'detectedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_audits',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'kind', order: 'ASCENDING' },
      { fieldPath: 'detectedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_audits',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'kind', order: 'ASCENDING' },
      { fieldPath: 'resolvedAt', order: 'DESCENDING' },
    ],
  },
];

const previousReducedIndex = {
  collectionGroup: 'fa_knowledge_nodes',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'type', order: 'ASCENDING' },
    { fieldPath: 'sortIndex', order: 'ASCENDING' },
  ],
};

describe('migration 007 - knowledge tree access', () => {
  it('exports metadata', () => {
    expect(metadata).toEqual({
      id: '007',
      name: 'knowledge-tree-access',
      description: 'Current-schema Knowledge Base tree/page/chunk indexes',
      createdAt: '2026-06-17',
    });
  });

  it('defines current-schema Knowledge Base indexes', () => {
    expect(indexes).toEqual(expectedKnowledgeTreeIndexes);
  });

  it('deploys indexes through the migration context', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();
  });

  it('keeps firestore.indexes.json in sync with current-schema Knowledge Base indexes', () => {
    const artifact = JSON.parse(readFileSync(resolve('firestore.indexes.json'), 'utf8')) as {
      indexes: unknown[];
    };

    expect(artifact.indexes).toEqual(expect.arrayContaining([...expectedKnowledgeTreeIndexes]));
    expect(artifact.indexes).not.toContainEqual(previousReducedIndex);
  });
});
