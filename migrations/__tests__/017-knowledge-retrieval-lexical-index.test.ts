import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, migration, up } from '../017_knowledge-retrieval-lexical-index.mjs'; // @allow-missing-js -- migration modules are .mjs

const lexicalRetrievalIndex = {
  collectionGroup: 'fa_knowledge_chunks',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'pageId', order: 'ASCENDING' },
    { fieldPath: 'index', order: 'ASCENDING' },
  ],
};

describe('migration 017 - knowledge retrieval lexical index', () => {
  it('exports metadata and the projected lexical retrieval index', () => {
    expect(metadata).toEqual({
      id: '017',
      name: 'knowledge-retrieval-lexical-index',
      description: 'Composite index for projected Knowledge Service lexical retrieval candidates',
      createdAt: '2026-06-23',
    });

    expect(migration).toMatchObject({
      id: '017',
      name: 'knowledge-retrieval-lexical-index',
      indexes: [lexicalRetrievalIndex],
    });
    expect(indexes).toEqual([lexicalRetrievalIndex]);
  });

  it('deploys indexes through the migration context', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();
  });
});
