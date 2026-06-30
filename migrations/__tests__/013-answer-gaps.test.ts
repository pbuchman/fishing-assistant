import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { migration } from '../013_answer-gaps.mjs'; // @allow-missing-js -- migration modules are .mjs

const answerGapIndexes = [
  {
    collectionGroup: 'fa_answer_gaps',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_answer_gaps',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'createdAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
];

describe('migration 013 - answer gaps', () => {
  it('exports the Answer Gap migration metadata and indexes', () => {
    expect(migration).toMatchObject({
      id: '013',
      name: 'answer-gaps',
    });
    expect(migration.indexes).toEqual(answerGapIndexes);
  });

  it('registers the Answer Gap collection owner', () => {
    const registry = JSON.parse(readFileSync(resolve('firestore-collections.json'), 'utf8')) as {
      collections: Record<string, { owner: string }>;
    };

    const answerGapsCollection = registry.collections['fa_answer_gaps'];
    expect(answerGapsCollection).toBeDefined();
    expect(answerGapsCollection?.owner).toBe('knowledge-service');
  });
});
