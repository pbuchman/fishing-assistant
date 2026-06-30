import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../003_knowledge-indexes.mjs'; // @allow-missing-js -- migration modules are .mjs

describe('migration 003 - knowledge indexes', () => {
  it('exports metadata', () => {
    expect(metadata).toEqual({
      id: '003',
      name: 'knowledge-indexes',
      description: 'Composite and vector indexes for Knowledge Service document and chunk queries',
      createdAt: '2026-06-14',
    });
  });

  it('defines the required knowledge document and chunk indexes', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'fishing_knowledge_documents',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'workspaceId', order: 'ASCENDING' },
          { fieldPath: 'status', order: 'ASCENDING' },
          { fieldPath: 'updatedAt', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'fishing_knowledge_documents',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'workspaceId', order: 'ASCENDING' },
          { fieldPath: 'status', order: 'ASCENDING' },
          { fieldPath: 'syncStatus', order: 'ASCENDING' },
          { fieldPath: 'updatedAt', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'fishing_knowledge_documents',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'workspaceId', order: 'ASCENDING' },
          { fieldPath: 'status', order: 'ASCENDING' },
          { fieldPath: 'indexingStatus', order: 'ASCENDING' },
          { fieldPath: 'updatedAt', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'fishing_knowledge_chunks',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'workspaceId', order: 'ASCENDING' },
          { fieldPath: 'status', order: 'ASCENDING' },
          { fieldPath: 'documentId', order: 'ASCENDING' },
          { fieldPath: 'index', order: 'ASCENDING' },
        ],
      },
      {
        collectionGroup: 'fishing_knowledge_chunks',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'workspaceId', order: 'ASCENDING' },
          { fieldPath: 'status', order: 'ASCENDING' },
          {
            fieldPath: 'embedding',
            order: 'ASCENDING',
            vectorConfig: {
              dimension: 2048,
              flatIndexEnabled: true,
            },
          },
        ],
      },
    ]);
  });

  it('deploys indexes through the migration context', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();
  });
});
