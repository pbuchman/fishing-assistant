import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  countRetiredUsageDocuments,
  indexes,
  metadata,
  removedIndexes,
  up,
} from '../008_llm-usage-user-ownership.mjs'; // @allow-missing-js -- migration modules are .mjs

const invalidSingleFieldUsageComposites = [
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'createdAt', order: 'DESCENDING' }],
  },
  {
    collectionGroup: 'llm_usage_daily_aggregates',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'bucket.day', order: 'ASCENDING' }],
  },
  {
    collectionGroup: 'llm_usage_daily_aggregates',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'bucket.hour', order: 'ASCENDING' }],
  },
];

describe('migration 008 llm usage user ownership', () => {
  it('defines current-schema raw event and aggregate indexes', () => {
    expect(metadata).toEqual({
      id: '008',
      name: 'llm-usage-user-ownership',
      description: 'Current-schema user-owned LLM usage event and aggregate indexes',
      createdAt: '2026-06-17',
    });

    expect(indexes).toEqual([
      {
        collectionGroup: 'llm_usage_daily_aggregates',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'owner.id', order: 'ASCENDING' },
          { fieldPath: 'bucket.day', order: 'ASCENDING' },
        ],
      },
      {
        collectionGroup: 'llm_usage_daily_aggregates',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'request.model', order: 'ASCENDING' },
          { fieldPath: 'bucket.day', order: 'ASCENDING' },
        ],
      },
      {
        collectionGroup: 'llm_usage_daily_aggregates',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'source.promptType', order: 'ASCENDING' },
          { fieldPath: 'bucket.day', order: 'ASCENDING' },
        ],
      },
      {
        collectionGroup: 'llm_usage_daily_aggregates',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'source.service', order: 'ASCENDING' },
          { fieldPath: 'source.operation', order: 'ASCENDING' },
          { fieldPath: 'bucket.day', order: 'ASCENDING' },
        ],
      },
    ]);
  });

  it('does not declare invalid single-field usage composite indexes', () => {
    for (const index of invalidSingleFieldUsageComposites) {
      expect(indexes).not.toContainEqual(index);
    }
  });

  it('declares retired flat usage indexes for removal', () => {
    expect(removedIndexes).toEqual([
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

  it('keeps firestore.indexes.json synced to current-schema usage indexes', () => {
    const artifact = JSON.parse(readFileSync(resolve('firestore.indexes.json'), 'utf8')) as {
      indexes: unknown[];
    };

    for (const index of indexes) {
      expect(artifact.indexes).toContainEqual(index);
    }

    for (const index of invalidSingleFieldUsageComposites) {
      expect(artifact.indexes).not.toContainEqual(index);
    }

    for (const index of removedIndexes) {
      expect(artifact.indexes).not.toContainEqual(index);
    }
  });

  it('deploys indexes without mutating retired usage documents', async () => {
    const context = { deployIndexes: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) };

    await up(context);

    expect(context.deployIndexes).toHaveBeenCalledOnce();
  });

  it('counts retired usage documents non-destructively', () => {
    const docs = [
      { id: 'ok', owner: { type: 'user', id: 'user-1' } },
      { id: 'old-owner-type', ownerType: 'workspace', ownerId: 'workspace-1' },
      { id: 'old-owner-id', ownerId: 'anonymous' },
      { id: 'old-workspace-id', workspaceId: 'workspace-1' },
      { id: 'workspace-owner', owner: { type: 'workspace', id: 'workspace-1' } },
      { id: 'anonymous-owner', owner: { type: 'user', id: 'anonymous' } },
    ];

    expect(countRetiredUsageDocuments(docs)).toEqual({
      total: 5,
      ownerType: 1,
      ownerId: 2,
      workspaceId: 1,
      nonUserOwner: 1,
      anonymousOwner: 1,
    });
    expect(docs).toHaveLength(6);
  });
});
