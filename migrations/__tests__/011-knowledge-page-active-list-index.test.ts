import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../011_knowledge-page-active-list-index.mjs'; // @allow-missing-js -- migration modules are .mjs

const activePageListIndex = {
  collectionGroup: 'fa_knowledge_pages',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'updatedAt', order: 'DESCENDING' },
    { fieldPath: '__name__', order: 'DESCENDING' },
  ],
};

describe('migration 011 - knowledge page active list index', () => {
  it('exports metadata', () => {
    expect(metadata).toEqual({
      id: '011',
      name: 'knowledge-page-active-list-index',
      description: 'Composite index for active Knowledge Base page list queries',
      createdAt: '2026-06-18',
    });
  });

  it('defines the active Knowledge Base page list index', () => {
    expect(indexes).toEqual([activePageListIndex]);
  });

  it('keeps firestore.indexes.json in sync with the migration', () => {
    const artifact = JSON.parse(readFileSync(resolve('firestore.indexes.json'), 'utf8')) as {
      indexes: unknown[];
    };

    expect(artifact.indexes).toContainEqual(activePageListIndex);
  });

  it('deploys indexes through the migration context', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();
  });
});
