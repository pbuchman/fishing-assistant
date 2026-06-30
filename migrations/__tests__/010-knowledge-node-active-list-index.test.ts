import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../010_knowledge-node-active-list-index.mjs'; // @allow-missing-js -- migration modules are .mjs

const activeNodeListIndex = {
  collectionGroup: 'fa_knowledge_nodes',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'sortIndex', order: 'ASCENDING' },
    { fieldPath: '__name__', order: 'ASCENDING' },
  ],
};

describe('migration 010 - knowledge node active list index', () => {
  it('exports metadata', () => {
    expect(metadata).toEqual({
      id: '010',
      name: 'knowledge-node-active-list-index',
      description: 'Composite index for active Knowledge Base node list queries',
      createdAt: '2026-06-18',
    });
  });

  it('defines the active Knowledge Base node list index', () => {
    expect(indexes).toEqual([activeNodeListIndex]);
  });

  it('keeps firestore.indexes.json in sync with the migration', () => {
    const artifact = JSON.parse(readFileSync(resolve('firestore.indexes.json'), 'utf8')) as {
      indexes: unknown[];
    };

    expect(artifact.indexes).toContainEqual(activeNodeListIndex);
  });

  it('deploys indexes through the migration context', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();
  });
});
