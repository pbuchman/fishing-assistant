import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../001_llm-usage-indexes.mjs'; // @allow-missing-js -- migration modules are .mjs

describe('migration 001 - llm usage indexes', () => {
  it('exports metadata', () => {
    expect(metadata).toEqual({
      id: '001',
      name: 'llm-usage-indexes',
      description: 'Composite indexes for LLM usage event and daily aggregate queries',
      createdAt: '2026-06-13',
    });
  });

  it('defines the required usage indexes only', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'llm_usage_events',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'ownerId', order: 'ASCENDING' },
          { fieldPath: 'createdAt', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'llm_usage_events',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'ownerId', order: 'ASCENDING' },
          { fieldPath: 'service', order: 'ASCENDING' },
          { fieldPath: 'createdAt', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'llm_usage_events',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'ownerId', order: 'ASCENDING' },
          { fieldPath: 'operation', order: 'ASCENDING' },
          { fieldPath: 'createdAt', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'llm_usage_events',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'ownerId', order: 'ASCENDING' },
          { fieldPath: 'service', order: 'ASCENDING' },
          { fieldPath: 'operation', order: 'ASCENDING' },
          { fieldPath: 'createdAt', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'llm_usage_daily_aggregates',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'ownerId', order: 'ASCENDING' },
          { fieldPath: 'date', order: 'ASCENDING' },
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
