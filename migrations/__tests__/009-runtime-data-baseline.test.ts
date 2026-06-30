import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { pricingSeed } from '../002_seed-llm-pricing.mjs'; // @allow-missing-js -- migration modules are .mjs
import { indexes as chatIndexes } from '../006_chat-user-ownership.mjs'; // @allow-missing-js -- migration modules are .mjs
import { indexes as knowledgeIndexes } from '../007_knowledge-tree-access.mjs'; // @allow-missing-js -- migration modules are .mjs
import { indexes as userAuthIndexes } from '../005_user-auth.mjs'; // @allow-missing-js -- migration modules are .mjs

const migrationPath = resolve(import.meta.dirname, '../009_runtime-data-baseline.mjs');
const registryPath = resolve(import.meta.dirname, '../../firestore-collections.json');
const indexesPath = resolve(import.meta.dirname, '../../firestore.indexes.json');
const baselineReportDocumentId = '009_runtime-data-baseline-report';

interface MigrationModule {
  metadata: {
    id: string;
    name: string;
    description: string;
    createdAt: string;
  };
  removedIndexes: unknown[];
  validateRuntimeDataBaselineArtifacts(root: string): string[];
  up(input: {
    firestore: FakeFirestore;
    deployIndexes: () => Promise<void>;
    deletePageSize?: number;
  }): Promise<unknown>;
}

type SeedRows = Record<string, [string, Record<string, unknown>][]>;

const expectedRemovedIndexes = [
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
      { fieldPath: 'embedding', vectorConfig: { dimension: 2048, flat: {} } },
    ],
  },
];

const requiredUsageOwnerDayAggregateIndex = {
  collectionGroup: 'llm_usage_daily_aggregates',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'owner.id', order: 'ASCENDING' },
    { fieldPath: 'bucket.day', order: 'ASCENDING' },
  ],
};

const nonRequiredUsageBucketHourIndex = {
  collectionGroup: 'llm_usage_daily_aggregates',
  queryScope: 'COLLECTION',
  fields: [{ fieldPath: 'bucket.hour', order: 'ASCENDING' }],
};

class FakeDocRef {
  constructor(
    private readonly firestore: FakeFirestore,
    readonly collectionName: string,
    readonly id: string
  ) {}

  set(value: Record<string, unknown>): Promise<void> {
    this.firestore.write(this.collectionName, this.id, value);
    return Promise.resolve();
  }

  delete(): Promise<void> {
    this.firestore.delete(this.collectionName, this.id);
    return Promise.resolve();
  }
}

class FakeDocSnapshot {
  constructor(
    readonly ref: FakeDocRef,
    readonly id: string,
    private readonly value: Record<string, unknown>
  ) {}

  data(): Record<string, unknown> {
    return structuredClone(this.value);
  }
}

class FakeQuerySnapshot {
  constructor(readonly docs: FakeDocSnapshot[]) {}

  get empty(): boolean {
    return this.docs.length === 0;
  }

  get size(): number {
    return this.docs.length;
  }
}

class FakeCollectionRef {
  constructor(
    private readonly firestore: FakeFirestore,
    private readonly name: string,
    private readonly maxRows?: number
  ) {}

  doc(id: string): FakeDocRef {
    return new FakeDocRef(this.firestore, this.name, id);
  }

  limit(maxRows: number): FakeCollectionRef {
    return new FakeCollectionRef(this.firestore, this.name, maxRows);
  }

  count(): { get: () => Promise<{ data: () => { count: number } }> } {
    return {
      get: () =>
        Promise.resolve({
          data: () => ({ count: this.firestore.aggregateCount(this.name) }),
        }),
    };
  }

  get(): Promise<FakeQuerySnapshot> {
    if (this.maxRows === undefined) {
      this.firestore.recordUnboundedGet(this.name);
    }
    const documents = this.firestore
      .readCollection(this.name)
      .slice(0, this.maxRows ?? Number.MAX_SAFE_INTEGER)
      .map(
        ({ id, value }) =>
          new FakeDocSnapshot(new FakeDocRef(this.firestore, this.name, id), id, value)
      );
    return Promise.resolve(new FakeQuerySnapshot(documents));
  }
}

class FakeBatch {
  private readonly deletes: FakeDocRef[] = [];
  private readonly firestore: FakeFirestore;

  constructor(firestore: FakeFirestore) {
    this.firestore = firestore;
  }

  delete(ref: FakeDocRef): this {
    this.deletes.push(ref);
    return this;
  }

  async commit(): Promise<void> {
    this.firestore.recordBatchCommit(this.deletes.length);
    if (this.firestore.shouldFailBatchCommit()) {
      throw new Error('simulated batch failure');
    }
    for (const ref of this.deletes) {
      await ref.delete();
    }
  }
}

class FakeFirestore {
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>();
  readonly collectionReadCounts = new Map<string, number>();
  readonly unboundedGetCounts = new Map<string, number>();
  readonly aggregateCountCalls = new Map<string, number>();
  batchCommitCount = 0;
  lastBatchSizes: number[] = [];
  failOnBatchCommitNumber?: number;

  seed(collectionName: string, id: string, value: Record<string, unknown>): void {
    this.write(collectionName, id, value);
  }

  collection(name: string): FakeCollectionRef {
    return new FakeCollectionRef(this, name);
  }

  batch(): FakeBatch {
    return new FakeBatch(this);
  }

  write(collectionName: string, id: string, value: Record<string, unknown>): void {
    const collection =
      this.collections.get(collectionName) ?? new Map<string, Record<string, unknown>>();
    collection.set(id, structuredClone(value));
    this.collections.set(collectionName, collection);
  }

  delete(collectionName: string, id: string): void {
    this.collections.get(collectionName)?.delete(id);
  }

  readCollection(collectionName: string): { id: string; value: Record<string, unknown> }[] {
    this.collectionReadCounts.set(
      collectionName,
      (this.collectionReadCounts.get(collectionName) ?? 0) + 1
    );
    const collection = this.collections.get(collectionName);
    if (collection === undefined) {
      return [];
    }

    return [...collection.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, value]) => ({ id, value: structuredClone(value) }));
  }

  recordUnboundedGet(collectionName: string): void {
    this.unboundedGetCounts.set(
      collectionName,
      (this.unboundedGetCounts.get(collectionName) ?? 0) + 1
    );
  }

  aggregateCount(collectionName: string): number {
    this.aggregateCountCalls.set(
      collectionName,
      (this.aggregateCountCalls.get(collectionName) ?? 0) + 1
    );
    return this.readCollection(collectionName).length;
  }

  recordBatchCommit(batchSize: number): void {
    this.batchCommitCount += 1;
    this.lastBatchSizes.push(batchSize);
  }

  shouldFailBatchCommit(): boolean {
    return (
      this.failOnBatchCommitNumber !== undefined &&
      this.batchCommitCount >= this.failOnBatchCommitNumber
    );
  }
}

async function loadMigrationModule(): Promise<MigrationModule | null> {
  expect(existsSync(migrationPath)).toBe(true);
  if (!existsSync(migrationPath)) {
    return null;
  }

  const module: unknown = await import(pathToFileURL(migrationPath).href);
  return module as MigrationModule;
}

describe('migration 009 - runtime data baseline cleanup', () => {
  it('exports metadata and declares the removed Knowledge Base indexes for removal', async () => {
    const migration = await loadMigrationModule();
    if (migration === null) {
      return;
    }

    expect(migration.metadata).toEqual({
      id: '009',
      name: 'runtime-data-baseline',
      description: 'Current Firestore data baseline and Knowledge Base index cleanup',
      createdAt: '2026-06-17',
    });
    expect(migration.removedIndexes).toEqual(expectedRemovedIndexes);
  });

  it('keeps firestore.indexes.json synced to current-schema baseline indexes only', () => {
    const artifact = JSON.parse(readFileSync(indexesPath, 'utf8')) as {
      indexes: unknown[];
    };

    expect(artifact.indexes).toEqual(
      expect.arrayContaining([
        chatIndexes[0],
        userAuthIndexes[0],
        knowledgeIndexes[11],
        knowledgeIndexes[12],
        requiredUsageOwnerDayAggregateIndex,
      ])
    );
    expect(artifact.indexes).not.toEqual(expect.arrayContaining(expectedRemovedIndexes));
  });

  it('requires the explicit current-schema usage owner/day aggregate index during baseline validation', async () => {
    const migration = await loadMigrationModule();
    if (migration === null) {
      return;
    }

    const tempRoot = mkdtempSync(resolve(tmpdir(), 'fa-baseline-index-'));
    try {
      writeFileSync(
        resolve(tempRoot, 'firestore-collections.json'),
        JSON.stringify(
          {
            collections: {
              fa_knowledge_nodes: {},
              fa_knowledge_pages: {},
              fa_knowledge_chunks: {},
              fa_knowledge_access_refresh_jobs: {},
              fa_knowledge_access_audits: {},
              fa_users: {},
              fa_user_identity_reservations: {},
              fa_user_change_events: {},
              llm_pricing: {},
            },
          },
          null,
          2
        )
      );
      writeFileSync(
        resolve(tempRoot, 'firestore.indexes.json'),
        JSON.stringify(
          {
            indexes: [
              chatIndexes[0],
              userAuthIndexes[0],
              knowledgeIndexes[11],
              knowledgeIndexes[12],
              nonRequiredUsageBucketHourIndex,
            ],
            fieldOverrides: [],
          },
          null,
          2
        )
      );

      expect(migration.validateRuntimeDataBaselineArtifacts(tempRoot)).toEqual([
        'firestore.indexes.json must keep required current-schema user, knowledge, and usage indexes before runtime data baseline',
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('removes removed Knowledge Base collections from the ownership registry', () => {
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
      collections: Record<string, unknown>;
    };

    expect(registry.collections).not.toHaveProperty('fishing_knowledge_documents');
    expect(registry.collections).not.toHaveProperty('fishing_knowledge_chunks');
    expect(registry.collections).toMatchObject({
      fa_knowledge_nodes: { owner: 'knowledge-service' },
      fa_knowledge_pages: { owner: 'knowledge-service' },
      fa_knowledge_chunks: { owner: 'knowledge-service' },
    });
  });

  it('destructively resets product-owned runtime collections, repairs baseline pricing, records counts, and is idempotent', async () => {
    const migration = await loadMigrationModule();
    if (migration === null) {
      return;
    }

    const firestore = new FakeFirestore();
    const seededCollections: SeedRows = {
      fishing_knowledge_documents: [
        ['doc-1', { workspaceId: 'anonymous' }],
        ['doc-2', { workspaceId: 'anonymous' }],
      ],
      fishing_knowledge_chunks: [['chunk-1', { workspaceId: 'anonymous', documentId: 'doc-1' }]],
      fishing_conversations: [['conversation-1', { userId: 'user-1' }]],
      fishing_conversation_messages: [['message-1', { conversationId: 'conversation-1' }]],
      llm_usage_events: [['event-1', { ownerType: 'workspace', ownerId: 'anonymous' }]],
      llm_usage_daily_aggregates: [['aggregate-1', { owner: { type: 'system', id: 'system' } }]],
      fa_knowledge_nodes: [['node-1', { categoryId: 'category-1' }]],
      fa_knowledge_pages: [['page-1', { categoryId: 'category-1' }]],
      fa_knowledge_chunks: [['page-chunk-1', { pageId: 'page-1' }]],
      fa_knowledge_access_refresh_jobs: [['job-1', { status: 'queued' }]],
      fa_knowledge_access_audits: [['audit-1', { status: 'open' }]],
      fa_users: [['user-1', { auth0Subject: 'auth0|user-1' }]],
      fa_user_identity_reservations: [['reservation-1', { key: 'user-1' }]],
      fa_user_change_events: [['change-1', { targetUserId: 'user-1' }]],
      llm_pricing: [
        ['stale-price', { provider: 'stale', model: 'stale-model' }],
        ['openrouter__google%2Fgemini-3.5-flash', { provider: 'openrouter', model: 'stale' }],
      ],
      _migrations: [['005', { status: 'applied' }]],
      external_shared: [['keep-me', { value: true }]],
    };
    for (const [collectionName, rows] of Object.entries(seededCollections)) {
      for (const [id, value] of rows) {
        firestore.seed(collectionName, id, value);
      }
    }

    const deployIndexes = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const firstRun = await migration.up({ firestore, deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();
    expect(firstRun).toMatchObject({
      baseline: {
        status: 'reset_completed',
        resetCounts: {
          fishing_knowledge_documents: 2,
          fishing_knowledge_chunks: 1,
          fishing_conversations: 1,
          fishing_conversation_messages: 1,
          llm_usage_events: 1,
          llm_usage_daily_aggregates: 1,
          fa_knowledge_nodes: 1,
          fa_knowledge_pages: 1,
          fa_knowledge_chunks: 1,
          fa_knowledge_access_refresh_jobs: 1,
          fa_knowledge_access_audits: 1,
          fa_users: 1,
          fa_user_identity_reservations: 1,
          fa_user_change_events: 1,
        },
        removedPricingRecords: 1,
        preservedCollections: ['_migrations'],
      },
    });
    const firstRunMigrationRows = firestore.readCollection('_migrations');
    expect(
      firstRunMigrationRows.find(({ id }) => id === baselineReportDocumentId)?.value
    ).toMatchObject({
      status: 'reset_completed',
      preResetCounts: {
        fishing_knowledge_documents: 2,
        fishing_knowledge_chunks: 1,
        fishing_conversations: 1,
        fishing_conversation_messages: 1,
        llm_usage_events: 1,
        llm_usage_daily_aggregates: 1,
        fa_knowledge_nodes: 1,
        fa_knowledge_pages: 1,
        fa_knowledge_chunks: 1,
        fa_knowledge_access_refresh_jobs: 1,
        fa_knowledge_access_audits: 1,
        fa_users: 1,
        fa_user_identity_reservations: 1,
        fa_user_change_events: 1,
      },
    });

    for (const collectionName of [
      'fishing_knowledge_documents',
      'fishing_knowledge_chunks',
      'fishing_conversations',
      'fishing_conversation_messages',
      'llm_usage_events',
      'llm_usage_daily_aggregates',
      'fa_knowledge_nodes',
      'fa_knowledge_pages',
      'fa_knowledge_chunks',
      'fa_knowledge_access_refresh_jobs',
      'fa_knowledge_access_audits',
      'fa_users',
      'fa_user_identity_reservations',
      'fa_user_change_events',
    ]) {
      expect(firestore.readCollection(collectionName)).toEqual([]);
    }

    const migrationRowsAfterReset = firestore.readCollection('_migrations');
    expect(migrationRowsAfterReset).toContainEqual({ id: '005', value: { status: 'applied' } });
    expect(
      migrationRowsAfterReset.find(({ id }) => id === baselineReportDocumentId)?.value
    ).toMatchObject({
      migrationId: '009',
      migrationName: 'runtime-data-baseline',
    });
    expect(firestore.readCollection('external_shared')).toEqual([
      { id: 'keep-me', value: { value: true } },
    ]);
    expect(
      firestore.readCollection('llm_pricing').map(({ value }) => ({
        provider: value['provider'],
        model: value['model'],
        inputUsdPer1M: value['inputUsdPer1M'],
        outputUsdPer1M: value['outputUsdPer1M'],
        embeddingUsdPer1M: value['embeddingUsdPer1M'],
      }))
    ).toEqual(
      pricingSeed.map((pricing) => ({
        provider: pricing.provider,
        model: pricing.model,
        inputUsdPer1M: pricing.inputUsdPer1M,
        outputUsdPer1M: pricing.outputUsdPer1M,
        embeddingUsdPer1M: pricing.embeddingUsdPer1M,
      }))
    );

    const secondRun = await migration.up({ firestore, deployIndexes });

    expect(deployIndexes).toHaveBeenCalledTimes(2);
    expect(secondRun).toMatchObject({
      baseline: {
        status: 'reset_completed',
        resetCounts: {
          fishing_knowledge_documents: 0,
          fishing_knowledge_chunks: 0,
          fishing_conversations: 0,
          fishing_conversation_messages: 0,
          llm_usage_events: 0,
          llm_usage_daily_aggregates: 0,
          fa_knowledge_nodes: 0,
          fa_knowledge_pages: 0,
          fa_knowledge_chunks: 0,
          fa_knowledge_access_refresh_jobs: 0,
          fa_knowledge_access_audits: 0,
          fa_users: 0,
          fa_user_identity_reservations: 0,
          fa_user_change_events: 0,
        },
        removedPricingRecords: 0,
      },
    });
    expect(firestore.readCollection('llm_pricing')).toHaveLength(pricingSeed.length);
  });

  it('writes the pre-reset report before destructive deletes and leaves it behind when reset deletion fails', async () => {
    const migration = await loadMigrationModule();
    if (migration === null) {
      return;
    }

    const firestore = new FakeFirestore();
    firestore.seed('fishing_conversations', 'conversation-1', { userId: 'user-1' });
    firestore.seed('llm_pricing', 'stale-price', { provider: 'stale', model: 'stale-model' });
    firestore.failOnBatchCommitNumber = 1;

    await expect(
      migration.up({
        firestore,
        deployIndexes: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      })
    ).rejects.toThrow('simulated batch failure');

    const migrationRows = firestore.readCollection('_migrations');
    expect(migrationRows.find(({ id }) => id === baselineReportDocumentId)?.value).toMatchObject({
      status: 'reset_started',
      preResetCounts: {
        fishing_conversations: 1,
      },
    });
  });

  it('deletes reset collections in bounded pages and multiple batch commits when a collection spans more than one page', async () => {
    const migration = await loadMigrationModule();
    if (migration === null) {
      return;
    }

    const firestore = new FakeFirestore();
    for (let index = 0; index < 5; index += 1) {
      firestore.seed('fishing_conversations', `conversation-${String(index)}`, {
        userId: `user-${String(index)}`,
      });
    }

    await migration.up({
      firestore,
      deployIndexes: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      deletePageSize: 2,
    });

    expect(firestore.readCollection('fishing_conversations')).toEqual([]);
    expect((firestore.collectionReadCounts.get('fishing_conversations') ?? 0) > 2).toBe(true);
    expect(firestore.batchCommitCount > 1).toBe(true);
    expect(firestore.lastBatchSizes).toEqual(expect.arrayContaining([2, 2, 1]));
  });

  it('records pre-reset counts through a bounded count path instead of unbounded collection gets', async () => {
    const migration = await loadMigrationModule();
    if (migration === null) {
      return;
    }

    const firestore = new FakeFirestore();
    for (let index = 0; index < 3; index += 1) {
      firestore.seed('fishing_conversations', `conversation-${String(index)}`, {
        userId: `user-${String(index)}`,
      });
    }
    firestore.seed('llm_usage_events', 'event-1', {
      owner: { type: 'user', id: 'user-1' },
    });

    await migration.up({
      firestore,
      deployIndexes: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      deletePageSize: 2,
    });

    expect(firestore.aggregateCountCalls.get('fishing_conversations')).toBe(1);
    expect(firestore.aggregateCountCalls.get('llm_usage_events')).toBe(1);
    expect(firestore.unboundedGetCounts.get('fishing_conversations') ?? 0).toBe(0);
    expect(firestore.unboundedGetCounts.get('llm_usage_events') ?? 0).toBe(0);
  });
});
