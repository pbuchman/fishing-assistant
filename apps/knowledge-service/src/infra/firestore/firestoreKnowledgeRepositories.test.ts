import { describe, expect, it } from 'vitest';

import type { AnswerGap } from '@fa/http-contracts';
import type {
  KnowledgeAccessAudit,
  KnowledgeAccessRefreshJob,
  KnowledgeNode,
  KnowledgePage,
  KnowledgePageChunk,
} from '../../domain/models/knowledge.js';
import {
  ANSWER_GAPS_COLLECTION,
  KNOWLEDGE_ACCESS_REFRESH_JOBS_COLLECTION,
  KNOWLEDGE_NODES_COLLECTION,
  KNOWLEDGE_PAGE_CHUNKS_COLLECTION,
  KNOWLEDGE_PAGES_COLLECTION,
} from './collections.js';
import { FirestoreAnswerGapRepository } from './firestoreAnswerGapRepository.js';
import { FirestoreKnowledgeAccessRefreshRepository } from './firestoreAccessRefreshRepository.js';
import { FirestoreKnowledgeChunkRepository } from './firestoreKnowledgeChunkRepository.js';
import { FirestoreKnowledgeNodeRepository } from './firestoreKnowledgeNodeRepository.js';
import { FirestoreKnowledgePageCascadeRepository } from './firestoreKnowledgePageCascadeRepository.js';
import { FirestoreKnowledgePageRepository } from './firestoreKnowledgePageRepository.js';

type Direction = 'asc' | 'desc';
type WhereOp = '==';

function sortableFieldValue(value: unknown): string | number | boolean | undefined {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === undefined
  ) {
    return value;
  }

  if (value !== null && typeof value === 'object' && 'toDate' in value) {
    const date = (value as { toDate: () => unknown }).toDate();
    if (date instanceof Date) {
      return date.getTime();
    }
  }

  return undefined;
}

class FakeDocumentSnapshot {
  constructor(
    readonly id: string,
    private readonly value: Record<string, unknown> | undefined
  ) {}

  get exists(): boolean {
    return this.value !== undefined;
  }

  data(): Record<string, unknown> | undefined {
    return this.value;
  }
}

interface FakeGetAllOptions {
  fieldMask?: readonly string[];
}

function isFakeGetAllOptions(value: unknown): value is FakeGetAllOptions {
  return value !== null && typeof value === 'object' && 'fieldMask' in value;
}

class FakeNearestDocumentSnapshot extends FakeDocumentSnapshot {
  override data(): Record<string, unknown> {
    return super.data() ?? {};
  }
}

class FakeDocumentRef {
  constructor(
    private readonly collection: FakeCollectionRef,
    readonly id: string
  ) {}

  create(value: Record<string, unknown>): Promise<void> {
    if (this.collection.docs.has(this.id)) {
      const error = new Error('document already exists') as Error & { code: number };
      error.code = 6;
      return Promise.reject(error);
    }
    this.collection.docs.set(this.id, value);
    return Promise.resolve();
  }

  get(): Promise<FakeDocumentSnapshot> {
    return Promise.resolve(this.snapshot());
  }

  set(value: Record<string, unknown>): Promise<void> {
    this.collection.docs.set(this.id, value);
    return Promise.resolve();
  }

  update(value: Record<string, unknown>): Promise<void> {
    const existing = this.collection.docs.get(this.id) ?? {};
    this.collection.docs.set(this.id, { ...existing, ...value });
    return Promise.resolve();
  }

  snapshot(fieldMask?: readonly string[]): FakeDocumentSnapshot {
    const value = this.collection.docs.get(this.id);
    if (value === undefined || fieldMask === undefined) {
      return new FakeDocumentSnapshot(this.id, value);
    }

    const projected = Object.fromEntries(
      fieldMask.filter((field) => field in value).map((field) => [field, value[field]])
    );
    return new FakeDocumentSnapshot(this.id, projected);
  }
}

class FakeBatch {
  private readonly writes: (() => Promise<void>)[] = [];

  constructor(private readonly firestore: FakeFirestore) {}

  set(ref: FakeDocumentRef, value: Record<string, unknown>): this {
    this.writes.push(() => ref.set(value));
    return this;
  }

  update(ref: FakeDocumentRef, value: Record<string, unknown>): this {
    this.writes.push(() => ref.update(value));
    return this;
  }

  async commit(): Promise<void> {
    for (const write of this.writes) {
      await write();
    }
    void this.firestore;
  }
}

class FakeTransaction {
  get(ref: FakeDocumentRef): Promise<FakeDocumentSnapshot> {
    return ref.get();
  }

  set(ref: FakeDocumentRef, value: Record<string, unknown>): this {
    void ref.set(value);
    return this;
  }

  update(ref: FakeDocumentRef, value: Record<string, unknown>): this {
    void ref.update(value);
    return this;
  }
}

class FakeQuery {
  constructor(
    private readonly collection: FakeCollectionRef,
    private readonly filters: { field: string; op: WhereOp; value: unknown }[] = [],
    private readonly orderings: { field: string; direction: Direction }[] = [],
    private readonly selectedFields?: readonly string[],
    private readonly maxDocs?: number
  ) {}

  where(field: string, op: WhereOp, value: unknown): FakeQuery {
    return new FakeQuery(
      this.collection,
      [...this.filters, { field, op, value }],
      this.orderings,
      this.selectedFields,
      this.maxDocs
    );
  }

  orderBy(field: string, direction: Direction): FakeQuery {
    return new FakeQuery(
      this.collection,
      this.filters,
      [...this.orderings, { field, direction }],
      this.selectedFields,
      this.maxDocs
    );
  }

  select(...fields: string[]): FakeQuery {
    this.collection.selectedFieldCalls.push([...fields]);
    return new FakeQuery(this.collection, this.filters, this.orderings, fields, this.maxDocs);
  }

  limit(maxDocs: number): FakeQuery {
    return new FakeQuery(
      this.collection,
      this.filters,
      this.orderings,
      this.selectedFields,
      maxDocs
    );
  }

  findNearest(options: { limit: number }): { get(): Promise<{ docs: FakeDocumentSnapshot[] }> } {
    return {
      get: async () => {
        const docs = (await this.get()).docs.slice(0, options.limit).map(
          (snapshot, index) =>
            new FakeNearestDocumentSnapshot(snapshot.id, {
              ...(snapshot.data() ?? {}),
              vectorDistance: index / 10,
            })
        );
        return { docs };
      },
    };
  }

  get(): Promise<{ docs: FakeDocumentSnapshot[] }> {
    const rows = [...this.collection.docs.entries()]
      .map(([id, value]) => ({ id, value }))
      .filter(({ value }) => this.filters.every((filter) => value[filter.field] === filter.value))
      .sort((left, right) => {
        for (const ordering of this.orderings) {
          const leftValue = sortableFieldValue(left.value[ordering.field]);
          const rightValue = sortableFieldValue(right.value[ordering.field]);
          if (leftValue === undefined || rightValue === undefined) {
            continue;
          }
          if (leftValue === rightValue) {
            continue;
          }
          if (ordering.direction === 'asc') {
            return leftValue < rightValue ? -1 : 1;
          }
          return leftValue > rightValue ? -1 : 1;
        }
        return 0;
      })
      .slice(0, this.maxDocs);

    return Promise.resolve({
      docs: rows.map((row) => {
        if (this.selectedFields === undefined) {
          return new FakeDocumentSnapshot(row.id, row.value);
        }

        const projected = Object.fromEntries(
          this.selectedFields
            .filter((field) => field in row.value)
            .map((field) => [field, row.value[field]])
        );
        return new FakeDocumentSnapshot(row.id, projected);
      }),
    });
  }
}

class FakeCollectionRef extends FakeQuery {
  readonly docs = new Map<string, Record<string, unknown>>();
  readonly selectedFieldCalls: string[][] = [];

  constructor(readonly name: string) {
    super(undefined as never);
    Object.defineProperty(this, 'collection', { value: this });
  }

  doc(id: string): FakeDocumentRef {
    return new FakeDocumentRef(this, id);
  }
}

class FakeFirestore {
  readonly collections = new Map<string, FakeCollectionRef>();
  readonly getAllCalls: { ids: string[]; fieldMask?: string[] }[] = [];

  collection(name: string): FakeCollectionRef {
    const existing = this.collections.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const created = new FakeCollectionRef(name);
    this.collections.set(name, created);
    return created;
  }

  getAll(
    ...refsAndOptions: (FakeDocumentRef | FakeGetAllOptions)[]
  ): Promise<FakeDocumentSnapshot[]> {
    const maybeOptions = refsAndOptions.at(-1);
    const options = isFakeGetAllOptions(maybeOptions) ? maybeOptions : undefined;
    const refs = (
      options === undefined ? refsAndOptions : refsAndOptions.slice(0, -1)
    ) as FakeDocumentRef[];
    this.getAllCalls.push({
      ids: refs.map((ref) => ref.id),
      ...(options?.fieldMask === undefined ? {} : { fieldMask: [...options.fieldMask] }),
    });
    return Promise.resolve(refs.map((ref) => ref.snapshot(options?.fieldMask)));
  }

  batch(): FakeBatch {
    return new FakeBatch(this);
  }

  runTransaction<T>(updateFunction: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
    return updateFunction(new FakeTransaction());
  }
}

function page(overrides: Partial<KnowledgePage> = {}): KnowledgePage {
  return {
    id: 'page-1',
    nodeId: 'page-node-1',
    status: 'active',
    title: 'Float Fishing Basics',
    slug: 'float-fishing-basics',
    categoryId: 'category-1',
    sectionId: 'section-1',
    pathIds: ['root', 'category-1', 'section-1', 'page-node-1'],
    pathTitles: ['Knowledge Base', 'Coarse Fishing', 'Floats', 'Float Fishing Basics'],
    hierarchy: { category: 'Coarse Fishing', section: 'Floats' },
    source: {
      type: 'external',
      url: 'https://example.com/fishing/float-basics',
      label: 'Example',
      importer: null,
    },
    access: {
      inheritedFromCategoryId: 'category-1',
      categoryAccessRevision: 'category-rev-2',
      override: null,
      effective: { gate: 'level', requiredLevel: 6, accessRevision: 'category-rev-2' },
    },
    relations: { relatedTo: [], linksTo: [], supersedes: [] },
    markdown: '# Float Fishing Basics',
    normalizedMarkdown: '# Float Fishing Basics',
    markdownContentHash: 'page-hash-1',
    indexingStatus: 'ready',
    syncStatus: 'synced',
    accessSyncStatus: 'current',
    indexingError: null,
    syncError: null,
    accessSyncError: null,
    chunkCount: 1,
    createdAt: '2026-06-14T12:00:00.000Z',
    updatedAt: '2026-06-14T12:00:00.000Z',
    deletedAt: null,
    createdByUserId: 'admin-user-1',
    updatedByUserId: 'admin-user-1',
    deletedByUserId: null,
    ...overrides,
  };
}

function rootNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return {
    id: 'root',
    type: 'root',
    status: 'active',
    title: 'Knowledge Base',
    slug: 'knowledge-base',
    sortIndex: 0,
    parentId: null,
    categoryId: null,
    sectionId: null,
    pageId: null,
    depth: 0,
    pathIds: ['root'],
    pathTitles: ['Knowledge Base'],
    categoryAccess: null,
    createdAt: '2026-06-14T12:00:00.000Z',
    updatedAt: '2026-06-14T12:00:00.000Z',
    deletedAt: null,
    createdByUserId: 'admin-user-1',
    updatedByUserId: 'admin-user-1',
    deletedByUserId: null,
    ...overrides,
  };
}

function categoryNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return {
    id: 'category-1',
    type: 'category',
    status: 'active',
    title: 'Coarse Fishing',
    slug: 'coarse-fishing',
    sortIndex: 0,
    parentId: 'root',
    categoryId: 'category-1',
    sectionId: null,
    pageId: null,
    depth: 1,
    pathIds: ['root', 'category-1'],
    pathTitles: ['Knowledge Base', 'Coarse Fishing'],
    categoryAccess: { gate: 'level', requiredLevel: 6, accessRevision: 'category-rev-2' },
    createdAt: '2026-06-14T12:00:00.000Z',
    updatedAt: '2026-06-14T12:00:00.000Z',
    deletedAt: null,
    createdByUserId: 'admin-user-1',
    updatedByUserId: 'admin-user-1',
    deletedByUserId: null,
    ...overrides,
  };
}

function sectionNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return {
    id: 'section-1',
    type: 'section',
    status: 'active',
    title: 'Floats',
    slug: 'floats',
    sortIndex: 1,
    parentId: 'category-1',
    categoryId: 'category-1',
    sectionId: 'section-1',
    pageId: null,
    depth: 2,
    pathIds: ['root', 'category-1', 'section-1'],
    pathTitles: ['Knowledge Base', 'Coarse Fishing', 'Floats'],
    categoryAccess: null,
    createdAt: '2026-06-14T12:00:00.000Z',
    updatedAt: '2026-06-14T12:00:00.000Z',
    deletedAt: null,
    createdByUserId: 'admin-user-1',
    updatedByUserId: 'admin-user-1',
    deletedByUserId: null,
    ...overrides,
  };
}

function pageNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return {
    id: 'page-node-1',
    type: 'page',
    status: 'active',
    title: 'Float Fishing Basics',
    slug: 'float-fishing-basics',
    sortIndex: 3,
    parentId: 'section-1',
    categoryId: 'category-1',
    sectionId: 'section-1',
    pageId: 'page-1',
    depth: 3,
    pathIds: ['root', 'category-1', 'section-1', 'page-node-1'],
    pathTitles: ['Knowledge Base', 'Coarse Fishing', 'Floats', 'Float Fishing Basics'],
    categoryAccess: null,
    createdAt: '2026-06-14T12:00:00.000Z',
    updatedAt: '2026-06-14T12:00:00.000Z',
    deletedAt: null,
    createdByUserId: 'admin-user-1',
    updatedByUserId: 'admin-user-1',
    deletedByUserId: null,
    ...overrides,
  };
}

function chunk(overrides: Partial<KnowledgePageChunk> = {}): KnowledgePageChunk {
  return {
    id: 'page-chunk-1',
    status: 'active',
    pageId: 'page-1',
    nodeId: 'page-node-1',
    categoryId: 'category-1',
    sectionId: 'section-1',
    title: 'Float Fishing Basics',
    path: ['Knowledge Base', 'Coarse Fishing', 'Floats', 'Float Fishing Basics'],
    headingPath: ['Float Fishing Basics'],
    index: 0,
    text: 'Use pellets.',
    searchableText: 'Float Fishing Basics\n\nUse pellets.',
    markdownContentHash: 'page-hash-1',
    access: { gate: 'level', requiredLevel: 6 },
    accessRevision: 'category-rev-2',
    accessSyncStatus: 'current',
    source: {
      type: 'external',
      url: 'https://example.com/fishing/float-basics',
      label: 'Example',
    },
    embedding: Array.from({ length: 2048 }, (_value, index) => index + 0.01),
    embeddingModel: 'qwen/qwen3-embedding-8b',
    embeddingProvider: 'openrouter',
    embeddingDimensions: 2048,
    createdAt: '2026-06-14T12:00:00.000Z',
    deletedAt: null,
    createdByJobId: null,
    accessRefreshedAt: '2026-06-14T12:00:00.000Z',
    accessRefreshJobId: null,
    ...overrides,
  };
}

function accessRefreshJob(
  overrides: Partial<KnowledgeAccessRefreshJob> = {}
): KnowledgeAccessRefreshJob {
  return {
    id: 'job-1',
    status: 'pending',
    kind: 'category_access_changed',
    target: { categoryId: 'category-1', pageId: null },
    requestedAccessRevision: 'category-rev-2',
    actorAdminUserId: 'admin-user-1',
    priority: 0,
    attempts: 0,
    maxAttempts: 6,
    nextRunAt: '2026-06-17T12:00:00.000Z',
    leaseOwnerId: null,
    leaseExpiresAt: null,
    processedPageCount: 0,
    processedChunkCount: 0,
    lastError: null,
    createdAt: '2026-06-17T12:00:00.000Z',
    updatedAt: '2026-06-17T12:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function accessAudit(overrides: Partial<KnowledgeAccessAudit> = {}): KnowledgeAccessAudit {
  return {
    id: 'audit-1',
    status: 'open',
    kind: 'stale_chunk_access_revision',
    severity: 'warning',
    categoryId: 'category-1',
    pageId: 'page-1',
    chunkId: 'page-chunk-1',
    expected: {
      gate: 'level',
      requiredLevel: 6,
      accessRevision: 'category-rev-2',
      sourceUrl: 'https://example.com/fishing/float-basics',
    },
    actual: { accessRevision: 'category-rev-1' },
    detectedAt: '2026-06-17T11:50:00.000Z',
    resolvedAt: null,
    resolutionJobId: null,
    ...overrides,
  };
}

function answerGap(overrides: Partial<AnswerGap> = {}): AnswerGap {
  return {
    id: 'answer-gap-1',
    status: 'needs_answer',
    source: 'no_accessible_evidence',
    question: 'How should I fish a canal in February?',
    formulatedQuestion:
      'Add or adjust Knowledge Base content so FA can answer: "How should I fish a canal in February?"',
    missingInformation: ['No accessible Knowledge Base evidence covers winter canal fishing.'],
    requester: {
      userId: 'user-1',
      email: 'user@example.com',
      role: 'user',
      effectiveLevel: 4,
    },
    conversation: {
      conversationId: 'conversation-1',
      userMessageId: 'user-message-1',
      assistantMessageId: 'assistant-message-1',
      contextWindow: [],
    },
    coverageProbe: {
      classification: 'no_candidate_seen',
      minRequiredLevel: null,
      candidateCountBucket: '0',
      probeVersion: '1.0.0',
    },
    coverageKind: 'global_no_candidate_seen',
    consent: {
      status: 'user_shared',
      sharedAt: '2026-06-14T11:59:00.000Z',
      withdrawnAt: null,
      includeContext: true,
      includeContact: true,
      candidateId: 'answer-gap-candidate-assistant-message-1',
    },
    processing: { similarityStatus: 'not_started' },
    createdAt: '2026-06-14T12:00:00.000Z',
    updatedAt: '2026-06-14T12:00:00.000Z',
    doneAt: null,
    doneByUserId: null,
    ...overrides,
  };
}

describe('firestore knowledge repositories', () => {
  it('creates, reads, lists, updates, and guards conflicts for pages', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreKnowledgePageRepository(db as never);
    const secondPage = page({
      id: 'page-2',
      nodeId: 'page-node-2',
      title: 'Ledgering Basics',
      slug: 'ledgering-basics',
      pathIds: ['root', 'category-1', 'section-1', 'page-node-2'],
      pathTitles: ['Knowledge Base', 'Coarse Fishing', 'Floats', 'Ledgering Basics'],
      markdown: '# Ledgering Basics',
      normalizedMarkdown: '# Ledgering Basics',
      markdownContentHash: 'page-hash-2',
      updatedAt: '2026-06-14T13:00:00.000Z',
    });
    const deletedPage = page({
      id: 'page-deleted',
      nodeId: 'page-node-deleted',
      status: 'deleted',
      title: 'Deleted Page',
      slug: 'deleted-page',
      pathIds: ['root', 'category-1', 'section-1', 'page-node-deleted'],
      pathTitles: ['Knowledge Base', 'Coarse Fishing', 'Floats', 'Deleted Page'],
      markdown: '# Deleted Page',
      normalizedMarkdown: '# Deleted Page',
      markdownContentHash: 'page-hash-deleted',
      updatedAt: '2026-06-14T14:00:00.000Z',
      deletedAt: '2026-06-14T14:00:00.000Z',
      deletedByUserId: 'admin-user-1',
    });

    await expect(repo.create(page())).resolves.toMatchObject({ ok: true, value: { id: 'page-1' } });
    await expect(repo.create(secondPage)).resolves.toMatchObject({
      ok: true,
      value: { id: 'page-2' },
    });
    await expect(repo.create(deletedPage)).resolves.toMatchObject({
      ok: true,
      value: { id: 'page-deleted' },
    });
    await expect(repo.create(page())).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });

    await expect(repo.getById('page-1')).resolves.toMatchObject({
      ok: true,
      value: { title: 'Float Fishing Basics' },
    });
    await expect(repo.getById('missing-page')).resolves.toEqual({ ok: true, value: null });

    const listed = await repo.listActive();
    expect(listed.ok ? listed.value.map((entry) => entry.id) : []).toEqual(['page-2', 'page-1']);
    const listedByCategory = await repo.listActiveByCategory({ categoryId: 'category-1' });
    expect(listedByCategory.ok ? listedByCategory.value.map((entry) => entry.id) : []).toEqual([
      'page-2',
      'page-1',
    ]);
    const listedBySection = await repo.listActiveBySection({ sectionId: 'section-1' });
    expect(listedBySection.ok ? listedBySection.value.map((entry) => entry.id) : []).toEqual([
      'page-2',
      'page-1',
    ]);

    await expect(
      repo.update(
        page({
          title: 'Float Fishing Advanced',
          slug: 'float-fishing-advanced',
          markdown: '# Float Fishing Advanced',
          normalizedMarkdown: '# Float Fishing Advanced',
          markdownContentHash: 'page-hash-advanced',
          syncStatus: 'sync_required',
          updatedAt: '2026-06-15T00:00:00.000Z',
          updatedByUserId: 'admin-user-2',
        })
      )
    ).resolves.toMatchObject({
      ok: true,
      value: {
        title: 'Float Fishing Advanced',
        syncStatus: 'sync_required',
        updatedByUserId: 'admin-user-2',
      },
    });
    await expect(
      repo.update(
        page({
          id: 'missing-page',
          nodeId: 'missing-page-node',
          pathIds: ['root', 'category-1', 'section-1', 'missing-page-node'],
          pathTitles: ['Knowledge Base', 'Coarse Fishing', 'Floats', 'Missing Page'],
        })
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    await expect(repo.update(deletedPage)).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('fetches retrieval page metadata in deduped getAll batches without markdown fields', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreKnowledgePageRepository(db as never);
    await repo.create(page());
    await repo.create(
      page({
        id: 'page-2',
        nodeId: 'page-node-2',
        title: 'Ledgering Basics',
        slug: 'ledgering-basics',
        pathIds: ['root', 'category-1', 'section-1', 'page-node-2'],
        pathTitles: ['Knowledge Base', 'Coarse Fishing', 'Floats', 'Ledgering Basics'],
        markdown: '# Ledgering Basics',
        normalizedMarkdown: '# Ledgering Basics',
        markdownContentHash: 'page-hash-2',
      })
    );

    const result = await repo.getRetrievalMetadataByIds([
      'page-1',
      'page-1',
      'missing-page',
      'page-2',
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval metadata lookup to succeed');
    }
    expect([...result.value.keys()]).toEqual(['page-1', 'page-2']);
    expect(result.value.get('page-1')).toMatchObject({
      id: 'page-1',
      title: 'Float Fishing Basics',
      access: {
        effective: { gate: 'level', requiredLevel: 6, accessRevision: 'category-rev-2' },
      },
    });
    const metadata = result.value.get('page-1');
    expect(metadata).toBeDefined();
    expect('markdown' in (metadata ?? {})).toBe(false);
    expect('normalizedMarkdown' in (metadata ?? {})).toBe(false);
    expect(db.getAllCalls).toHaveLength(1);
    expect(db.getAllCalls[0]?.ids).toEqual(['page-1', 'missing-page', 'page-2']);
    expect(db.getAllCalls[0]?.fieldMask).toContain('title');
    expect(db.getAllCalls[0]?.fieldMask).toContain('access');
    expect(db.getAllCalls[0]?.fieldMask).not.toContain('markdown');
    expect(db.getAllCalls[0]?.fieldMask).not.toContain('normalizedMarkdown');
  });

  it('splits retrieval page metadata getAll reads into safe batches', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreKnowledgePageRepository(db as never);
    const pageIds = Array.from({ length: 301 }, (_value, index) => `page-${String(index)}`);

    for (const [index, pageId] of pageIds.entries()) {
      const indexLabel = String(index);
      await repo.create(
        page({
          id: pageId,
          nodeId: `page-node-${indexLabel}`,
          title: `Page ${indexLabel}`,
          slug: `page-${indexLabel}`,
          pathIds: ['root', 'category-1', 'section-1', `page-node-${indexLabel}`],
          pathTitles: ['Knowledge Base', 'Coarse Fishing', 'Floats', `Page ${indexLabel}`],
          markdown: `# Page ${indexLabel}`,
          normalizedMarkdown: `# Page ${indexLabel}`,
          markdownContentHash: `page-hash-${indexLabel}`,
        })
      );
    }

    const result = await repo.getRetrievalMetadataByIds(pageIds);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval metadata lookup to succeed');
    }
    expect(result.value.size).toBe(301);
    expect(db.getAllCalls.map((call) => call.ids.length)).toEqual([300, 1]);
  });

  it('creates, reads, lists, and updates answer gaps', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreAnswerGapRepository(db as never);

    await expect(
      repo.create(answerGap({ id: 'answer-gap-1', createdAt: '2026-06-14T13:00:00.000Z' }))
    ).resolves.toMatchObject({ ok: true, value: { id: 'answer-gap-1' } });
    await expect(
      repo.create(
        answerGap({
          id: 'answer-gap-2',
          status: 'done',
          createdAt: '2026-06-14T12:00:00.000Z',
        })
      )
    ).resolves.toMatchObject({ ok: true, value: { id: 'answer-gap-2' } });
    expect(db.collection(ANSWER_GAPS_COLLECTION).docs.has('answer-gap-1')).toBe(true);

    await expect(repo.getById('answer-gap-1')).resolves.toMatchObject({
      ok: true,
      value: { question: 'How should I fish a canal in February?' },
    });
    await expect(repo.getById('missing-gap')).resolves.toEqual({ ok: true, value: null });

    const listedGaps = await repo.list({ status: 'all', limit: 1 });
    expect(listedGaps).toMatchObject({
      ok: true,
      value: {
        totalCount: 2,
        gaps: [expect.objectContaining({ id: 'answer-gap-1' })],
      },
    });
    if (!listedGaps.ok) {
      throw new Error('Expected answer gap list to succeed');
    }
    expect(typeof listedGaps.value.nextCursor).toBe('string');

    await expect(
      repo.update(answerGap({ id: 'answer-gap-1', status: 'done' }))
    ).resolves.toMatchObject({ ok: true, value: { status: 'done' } });
  });

  it('reads historical answer gaps without explicit consent fields as retired captures', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreAnswerGapRepository(db as never);
    await repo.create(answerGap({ id: 'retired-gap' }));
    const stored = db.collection(ANSWER_GAPS_COLLECTION).docs.get('retired-gap');
    if (stored === undefined) {
      throw new Error('Expected retired-gap document');
    }
    delete stored['coverageKind'];
    delete stored['consent'];

    await expect(repo.getById('retired-gap')).resolves.toMatchObject({
      ok: true,
      value: {
        id: 'retired-gap',
        coverageKind: 'coverage_unknown',
        consent: {
          status: 'system_imported',
          sharedAt: null,
          withdrawnAt: null,
          includeContext: true,
          includeContact: true,
          candidateId: null,
        },
      },
    });
  });

  it('records page access overrides and guards access refresh state revisions', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreKnowledgePageRepository(db as never);
    await repo.create(page());

    await expect(
      repo.recordEffectiveAccessOverride({
        pageId: 'page-1',
        override: {
          gate: 'approved',
          requiredLevel: null,
          source: 'storage',
          recordedAt: '2026-06-15T00:00:00.000Z',
          recordedByUserId: 'admin-user-2',
        },
        effectiveAccessRevision: 'manual-rev-1',
        updatedAt: '2026-06-15T00:00:00.000Z',
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        access: {
          override: { gate: 'approved', source: 'storage' },
          effective: { gate: 'approved', requiredLevel: null, accessRevision: 'manual-rev-1' },
        },
        accessSyncStatus: 'stale',
      },
    });
    await expect(
      repo.markAccessRefreshState({
        pageId: 'page-1',
        expectedAccessRevision: 'category-rev-2',
        accessSyncStatus: 'current',
        accessSyncError: null,
        updatedAt: '2026-06-15T00:05:00.000Z',
        updatedByUserId: 'access-worker-1',
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repo.markAccessRefreshState({
        pageId: 'page-1',
        expectedAccessRevision: 'manual-rev-1',
        accessSyncStatus: 'current',
        accessSyncError: null,
        updatedAt: '2026-06-15T00:06:00.000Z',
        updatedByUserId: 'access-worker-1',
      })
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(repo.getById('page-1')).resolves.toMatchObject({
      ok: true,
      value: { accessSyncStatus: 'current', updatedByUserId: 'access-worker-1' },
    });
    await expect(
      repo.recordEffectiveAccessOverride({
        pageId: 'missing-page',
        override: {
          gate: 'approved',
          requiredLevel: null,
          source: 'storage',
          recordedAt: '2026-06-15T00:00:00.000Z',
          recordedByUserId: 'admin-user-2',
        },
        effectiveAccessRevision: 'manual-rev-1',
        updatedAt: '2026-06-15T00:00:00.000Z',
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    await expect(
      repo.recordEffectiveAccessOverride({
        pageId: 'page-1',
        override: {
          gate: 'public',
          requiredLevel: 3,
          source: 'storage',
          recordedAt: '2026-06-15T00:00:00.000Z',
          recordedByUserId: 'admin-user-2',
        },
        effectiveAccessRevision: 'manual-rev-2',
        updatedAt: '2026-06-15T00:00:00.000Z',
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('creates, updates, lists, and soft-deletes knowledge nodes by subtree', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreKnowledgeNodeRepository(db as never);
    await repo.create(rootNode());
    await repo.create(categoryNode());
    await repo.create(sectionNode());
    await repo.create(pageNode());

    await expect(repo.create(pageNode())).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    await expect(repo.getById('missing-node')).resolves.toEqual({ ok: true, value: null });
    const listed = await repo.listActive();
    expect(listed.ok ? listed.value.map((entry) => entry.id) : []).toEqual([
      'root',
      'category-1',
      'section-1',
      'page-node-1',
    ]);

    await expect(
      repo.update(
        pageNode({
          title: 'Float Fishing Advanced',
          slug: 'float-fishing-advanced',
          pathTitles: ['Knowledge Base', 'Coarse Fishing', 'Floats', 'Float Fishing Advanced'],
          updatedAt: '2026-06-15T00:00:00.000Z',
          updatedByUserId: 'admin-user-2',
        })
      )
    ).resolves.toMatchObject({
      ok: true,
      value: { title: 'Float Fishing Advanced', updatedByUserId: 'admin-user-2' },
    });
    await expect(
      repo.update(
        pageNode({
          id: 'missing-node',
          pageId: 'missing-page',
          pathIds: ['root', 'category-1', 'section-1', 'missing-node'],
          pathTitles: ['Knowledge Base', 'Coarse Fishing', 'Floats', 'Missing Node'],
        })
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

    const deleted = await repo.softDeleteSubtree({
      rootNodeId: 'section-1',
      deletedAt: '2026-06-15T01:00:00.000Z',
      deletedByUserId: 'admin-user-3',
    });
    expect(deleted.ok ? deleted.value.map((entry) => entry.id) : []).toEqual([
      'section-1',
      'page-node-1',
    ]);
    await expect(repo.update(pageNode())).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    await expect(
      repo.softDeleteSubtree({
        rootNodeId: 'missing-node',
        deletedAt: '2026-06-15T01:00:00.000Z',
        deletedByUserId: 'admin-user-3',
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('claims page sync, replaces active page chunks, and lists them back', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreKnowledgeChunkRepository(db as never);
    db.collection(KNOWLEDGE_PAGES_COLLECTION).docs.set(
      'page-1',
      page() as unknown as Record<string, unknown>
    );

    await expect(
      repo.claimPageSync({
        page: page({ syncStatus: 'syncing', indexingStatus: 'pending' }),
        deletedAt: '2026-06-15T00:00:00.000Z',
      })
    ).resolves.toMatchObject({ ok: true });

    await expect(
      repo.replaceActiveForPage({
        pageId: 'page-1',
        deletedAt: '2026-06-15T01:00:00.000Z',
        chunks: [chunk()],
      })
    ).resolves.toEqual({ ok: true, value: undefined });

    await expect(repo.listActiveForPage({ pageId: 'page-1' })).resolves.toMatchObject({
      ok: true,
      value: [expect.objectContaining({ id: 'page-chunk-1' })],
    });
    expect(db.collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION).docs.get('page-chunk-1')).toBeDefined();
  });

  it('returns retrievable nearest chunks with vector scores and refreshes access', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreKnowledgeChunkRepository(db as never);
    db.collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION).docs.set(
      'page-chunk-1',
      chunk() as unknown as Record<string, unknown>
    );

    await expect(
      repo.findNearestPageChunks({
        embedding: Array.from({ length: 2048 }, () => 0.5),
        limit: 5,
      })
    ).resolves.toMatchObject({
      ok: true,
      value: [expect.objectContaining({ id: 'page-chunk-1', vectorScore: 1 })],
    });

    await expect(
      repo.refreshAccessForPage({
        pageId: 'page-1',
        access: { gate: 'approved', requiredLevel: null },
        accessRevision: 'category-rev-3',
        accessSyncStatus: 'current',
        accessRefreshedAt: '2026-06-15T02:00:00.000Z',
        accessRefreshJobId: 'job-1',
        limit: 10,
      })
    ).resolves.toEqual({
      ok: true,
      value: { processedChunkCount: 1, hasMore: false },
    });
  });

  it('excludes stale access chunks from nearest vector retrieval', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreKnowledgeChunkRepository(db as never);
    db.collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION).docs.set(
      'stale-page-chunk',
      chunk({
        id: 'stale-page-chunk',
        accessSyncStatus: 'stale',
        text: 'Stale access should not be retrievable.',
      }) as unknown as Record<string, unknown>
    );
    db.collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION).docs.set(
      'page-chunk-1',
      chunk() as unknown as Record<string, unknown>
    );

    await expect(
      repo.findNearestPageChunks({
        embedding: Array.from({ length: 2048 }, () => 0.5),
        limit: 5,
      })
    ).resolves.toMatchObject({
      ok: true,
      value: [expect.objectContaining({ id: 'page-chunk-1' })],
    });
  });

  it('lists projected lexical retrieval candidates without selecting embeddings', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreKnowledgeChunkRepository(db as never);
    const collection = db.collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION);
    const expectedProjection = [
      'status',
      'pageId',
      'nodeId',
      'categoryId',
      'sectionId',
      'title',
      'path',
      'headingPath',
      'index',
      'text',
      'searchableText',
      'markdownContentHash',
      'access',
      'accessRevision',
      'accessSyncStatus',
      'source',
      'createdAt',
      'deletedAt',
      'createdByJobId',
      'accessRefreshedAt',
      'accessRefreshJobId',
    ];

    collection.docs.set('chunk-b-1', {
      ...chunk({
        id: 'chunk-b-1',
        pageId: 'page-b',
        index: 1,
      }),
      embedding: ['not-a-number'],
      embeddingDimensions: 12,
    });
    collection.docs.set(
      'chunk-a-2',
      chunk({
        id: 'chunk-a-2',
        pageId: 'page-a',
        index: 2,
      }) as unknown as Record<string, unknown>
    );
    collection.docs.set(
      'chunk-a-0',
      chunk({
        id: 'chunk-a-0',
        pageId: 'page-a',
        index: 0,
      }) as unknown as Record<string, unknown>
    );
    collection.docs.set(
      'chunk-stale',
      chunk({
        id: 'chunk-stale',
        pageId: 'page-a',
        index: 1,
        accessSyncStatus: 'stale',
      }) as unknown as Record<string, unknown>
    );

    const result = await repo.listRetrievableActiveLexicalCandidates({
      limit: 2,
    });

    expect(collection.selectedFieldCalls).toEqual([expectedProjection]);
    expect(expectedProjection).not.toContain('embedding');
    expect(expectedProjection).not.toContain('embeddingModel');
    expect(expectedProjection).not.toContain('embeddingProvider');
    expect(expectedProjection).not.toContain('embeddingDimensions');

    expect(result).toEqual({
      ok: true,
      value: {
        chunks: [
          {
            id: 'chunk-a-0',
            status: 'active',
            pageId: 'page-a',
            nodeId: 'page-node-1',
            categoryId: 'category-1',
            sectionId: 'section-1',
            title: 'Float Fishing Basics',
            path: ['Knowledge Base', 'Coarse Fishing', 'Floats', 'Float Fishing Basics'],
            headingPath: ['Float Fishing Basics'],
            index: 0,
            text: 'Use pellets.',
            searchableText: 'Float Fishing Basics\n\nUse pellets.',
            markdownContentHash: 'page-hash-1',
            access: { gate: 'level', requiredLevel: 6 },
            accessRevision: 'category-rev-2',
            accessSyncStatus: 'current',
            source: {
              type: 'external',
              url: 'https://example.com/fishing/float-basics',
              label: 'Example',
            },
            createdAt: '2026-06-14T12:00:00.000Z',
            deletedAt: null,
            createdByJobId: null,
            accessRefreshedAt: '2026-06-14T12:00:00.000Z',
            accessRefreshJobId: null,
          },
          {
            id: 'chunk-a-2',
            status: 'active',
            pageId: 'page-a',
            nodeId: 'page-node-1',
            categoryId: 'category-1',
            sectionId: 'section-1',
            title: 'Float Fishing Basics',
            path: ['Knowledge Base', 'Coarse Fishing', 'Floats', 'Float Fishing Basics'],
            headingPath: ['Float Fishing Basics'],
            index: 2,
            text: 'Use pellets.',
            searchableText: 'Float Fishing Basics\n\nUse pellets.',
            markdownContentHash: 'page-hash-1',
            access: { gate: 'level', requiredLevel: 6 },
            accessRevision: 'category-rev-2',
            accessSyncStatus: 'current',
            source: {
              type: 'external',
              url: 'https://example.com/fishing/float-basics',
              label: 'Example',
            },
            createdAt: '2026-06-14T12:00:00.000Z',
            deletedAt: null,
            createdByJobId: null,
            accessRefreshedAt: '2026-06-14T12:00:00.000Z',
            accessRefreshJobId: null,
          },
        ],
        scannedCount: 3,
        limitHit: true,
      },
    });
  });

  it('handles chunk lookup, validation, soft delete, and access-refresh conflict branches', async () => {
    const db = new FakeFirestore();
    const pageRepo = new FirestoreKnowledgePageRepository(db as never);
    const chunkRepo = new FirestoreKnowledgeChunkRepository(db as never);
    await pageRepo.create(page());

    await expect(chunkRepo.getPageChunkById({ chunkId: 'missing-chunk' })).resolves.toEqual({
      ok: true,
      value: null,
    });
    await expect(
      chunkRepo.replaceActiveForPage({
        pageId: 'page-1',
        chunks: [
          chunk({
            id: 'refresh-chunk-1',
            access: { gate: 'approved', requiredLevel: null },
            accessRevision: 'category-rev-1',
            index: 0,
          }),
          chunk({
            id: 'refresh-chunk-2',
            access: { gate: 'approved', requiredLevel: null },
            accessRevision: 'category-rev-1',
            index: 1,
          }),
        ],
        deletedAt: '2026-06-15T03:00:00.000Z',
      })
    ).resolves.toEqual({ ok: true, value: undefined });
    db.collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION).docs.set('malformed-chunk', {
      ...chunk({ id: 'malformed-chunk' }),
      embeddingDimensions: 12,
    });

    await expect(chunkRepo.getPageChunkById({ chunkId: 'refresh-chunk-1' })).resolves.toMatchObject(
      {
        ok: true,
        value: { id: 'refresh-chunk-1' },
      }
    );
    await expect(chunkRepo.getPageChunkById({ chunkId: 'malformed-chunk' })).resolves.toEqual({
      ok: true,
      value: null,
    });
    await expect(
      chunkRepo.replaceActiveForPage({
        pageId: 'page-1',
        chunks: [chunk({ id: 'wrong-page-chunk', pageId: 'other-page' })],
        deletedAt: '2026-06-15T03:00:00.000Z',
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    await expect(
      chunkRepo.refreshAccessForPage({
        pageId: 'page-1',
        expectedPageAccessRevision: 'stale-rev',
        access: { gate: 'level', requiredLevel: 6 },
        accessRevision: 'category-rev-2',
        accessSyncStatus: 'current',
        accessRefreshedAt: '2026-06-15T03:05:00.000Z',
        accessRefreshJobId: 'job-refresh-1',
        limit: 1,
      })
    ).resolves.toEqual({
      ok: true,
      value: { processedChunkCount: 0, hasMore: false, revisionConflict: true },
    });
    await expect(
      chunkRepo.refreshAccessForPage({
        pageId: 'page-1',
        expectedPageAccessRevision: 'category-rev-2',
        access: { gate: 'level', requiredLevel: 6 },
        accessRevision: 'category-rev-2',
        accessSyncStatus: 'current',
        accessRefreshedAt: '2026-06-15T03:05:00.000Z',
        accessRefreshJobId: 'job-refresh-1',
        limit: 1,
      })
    ).resolves.toEqual({
      ok: true,
      value: { processedChunkCount: 1, hasMore: true },
    });

    await expect(
      chunkRepo.softDeleteForPage({
        pageId: 'page-1',
        deletedAt: '2026-06-15T03:10:00.000Z',
      })
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(chunkRepo.listActiveForPage({ pageId: 'page-1' })).resolves.toEqual({
      ok: true,
      value: [],
    });
    await expect(
      chunkRepo.claimPageSync({
        page: page({ id: 'missing-page' }),
        deletedAt: '2026-06-15T03:10:00.000Z',
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('cascade soft-deletes pages with their nodes and chunks', async () => {
    const db = new FakeFirestore();
    const nodeRepo = new FirestoreKnowledgeNodeRepository(db as never);
    const pageRepo = new FirestoreKnowledgePageRepository(db as never);
    const chunkRepo = new FirestoreKnowledgeChunkRepository(db as never);
    const cascadeRepo = new FirestoreKnowledgePageCascadeRepository(db as never);
    await nodeRepo.create(pageNode());
    await pageRepo.create(page());
    await chunkRepo.replaceActiveForPage({
      pageId: 'page-1',
      chunks: [
        chunk({ id: 'page-delete-chunk-1' }),
        chunk({ id: 'page-delete-chunk-2', index: 1 }),
      ],
      deletedAt: '2026-06-15T04:00:00.000Z',
    });

    await expect(
      cascadeRepo.softDeletePage({
        pageId: 'page-1',
        deletedAt: '2026-06-15T04:05:00.000Z',
        deletedByUserId: 'admin-user-4',
      })
    ).resolves.toEqual({
      ok: true,
      value: { pageId: 'page-1', nodeId: 'page-node-1', deletedChunkCount: 2 },
    });
    expect(db.collection(KNOWLEDGE_PAGES_COLLECTION).docs.get('page-1')).toMatchObject({
      status: 'deleted',
      accessSyncStatus: 'invalid',
      deletedByUserId: 'admin-user-4',
    });
    expect(db.collection(KNOWLEDGE_NODES_COLLECTION).docs.get('page-node-1')).toMatchObject({
      status: 'deleted',
      deletedByUserId: 'admin-user-4',
    });
    expect(
      db.collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION).docs.get('page-delete-chunk-1')
    ).toMatchObject({
      status: 'deleted',
    });
    await expect(
      cascadeRepo.softDeletePage({
        pageId: 'page-1',
        deletedAt: '2026-06-15T04:05:00.000Z',
        deletedByUserId: 'admin-user-4',
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

    await pageRepo.create(
      page({
        id: 'orphan-page',
        nodeId: 'missing-node',
        title: 'Orphan Page',
        slug: 'orphan-page',
        pathIds: ['root', 'category-1', 'section-1', 'missing-node'],
        pathTitles: ['Knowledge Base', 'Coarse Fishing', 'Floats', 'Orphan Page'],
        markdown: '# Orphan Page',
        normalizedMarkdown: '# Orphan Page',
        markdownContentHash: 'page-hash-orphan',
      })
    );
    await expect(
      cascadeRepo.softDeletePage({
        pageId: 'orphan-page',
        deletedAt: '2026-06-15T04:05:00.000Z',
        deletedByUserId: 'admin-user-4',
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('cascade soft-deletes subtrees and counts sections, pages, and chunks', async () => {
    const db = new FakeFirestore();
    const nodeRepo = new FirestoreKnowledgeNodeRepository(db as never);
    const pageRepo = new FirestoreKnowledgePageRepository(db as never);
    const chunkRepo = new FirestoreKnowledgeChunkRepository(db as never);
    const cascadeRepo = new FirestoreKnowledgePageCascadeRepository(db as never);
    await nodeRepo.create(categoryNode());
    await nodeRepo.create(sectionNode());
    await nodeRepo.create(pageNode());
    await pageRepo.create(page());
    await chunkRepo.replaceActiveForPage({
      pageId: 'page-1',
      chunks: [chunk({ id: 'subtree-chunk-1' })],
      deletedAt: '2026-06-15T05:00:00.000Z',
    });

    await expect(
      cascadeRepo.softDeleteSubtree({
        rootNodeId: 'section-1',
        deletedAt: '2026-06-15T05:05:00.000Z',
        deletedByUserId: 'admin-user-5',
      })
    ).resolves.toEqual({
      ok: true,
      value: {
        rootNodeId: 'section-1',
        deletedSectionCount: 1,
        deletedPageCount: 1,
        deletedChunkCount: 1,
      },
    });
    expect(db.collection(KNOWLEDGE_PAGES_COLLECTION).docs.get('page-1')).toMatchObject({
      status: 'deleted',
      accessSyncStatus: 'invalid',
    });
    expect(
      db.collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION).docs.get('subtree-chunk-1')
    ).toMatchObject({ status: 'deleted' });
    await expect(
      cascadeRepo.softDeleteSubtree({
        rootNodeId: 'missing-node',
        deletedAt: '2026-06-15T05:05:00.000Z',
        deletedByUserId: 'admin-user-5',
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('claims due access-refresh jobs and advances leased job lifecycles', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreKnowledgeAccessRefreshRepository(db as never);
    await repo.enqueueJob(accessRefreshJob({ id: 'pending-low' }));
    await repo.enqueueJob(
      accessRefreshJob({
        id: 'failed-due',
        status: 'failed',
        attempts: 1,
        maxAttempts: 3,
        priority: 5,
        lastError: {
          code: 'VALIDATION_ERROR',
          message: 'old failure',
          occurredAt: '2026-06-17T11:59:00.000Z',
        },
      })
    );
    await repo.enqueueJob(
      accessRefreshJob({
        id: 'failed-exhausted',
        status: 'failed',
        attempts: 3,
        maxAttempts: 3,
      })
    );
    await repo.enqueueJob(
      accessRefreshJob({
        id: 'future',
        nextRunAt: '2026-06-17T12:30:00.000Z',
      })
    );
    await repo.enqueueJob(
      accessRefreshJob({
        id: 'running-expired',
        status: 'running',
        leaseOwnerId: 'worker-old',
        leaseExpiresAt: '2026-06-17T11:59:00.000Z',
        priority: 10,
      })
    );
    await repo.enqueueJob(
      accessRefreshJob({
        id: 'running-active',
        status: 'running',
        leaseOwnerId: 'worker-old',
        leaseExpiresAt: '2026-06-17T12:30:00.000Z',
      })
    );
    await repo.enqueueJob(
      accessRefreshJob({
        id: 'complete-me',
        status: 'running',
        leaseOwnerId: 'worker-1',
        leaseExpiresAt: '2026-06-17T12:30:00.000Z',
      })
    );

    await expect(repo.enqueueJob(accessRefreshJob({ id: 'pending-low' }))).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    await expect(repo.getJobById('missing-job')).resolves.toEqual({ ok: true, value: null });

    const claimed = await repo.claimDueJobs({
      now: '2026-06-17T12:00:00.000Z',
      leaseOwnerId: 'worker-1',
      leaseDurationMs: 120_000,
      limit: 2,
    });
    expect(claimed.ok ? claimed.value.map((entry) => entry.id) : []).toEqual([
      'running-expired',
      'failed-due',
    ]);
    expect(
      db.collection(KNOWLEDGE_ACCESS_REFRESH_JOBS_COLLECTION).docs.get('failed-exhausted')
    ).toMatchObject({
      status: 'failed',
      leaseOwnerId: null,
    });

    await expect(
      repo.completeJob({
        jobId: 'missing-job',
        leaseOwnerId: 'worker-1',
        now: '2026-06-17T12:01:00.000Z',
        processedPageCount: 1,
        processedChunkCount: 1,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    await expect(
      repo.completeJob({
        jobId: 'complete-me',
        leaseOwnerId: 'worker-1',
        now: '2026-06-17T12:01:00.000Z',
        processedPageCount: 2,
        processedChunkCount: 4,
      })
    ).resolves.toMatchObject({
      ok: true,
      value: { status: 'succeeded', processedPageCount: 2, processedChunkCount: 4 },
    });
    await expect(
      repo.continueJob({
        jobId: 'failed-due',
        leaseOwnerId: 'worker-1',
        now: '2026-06-17T12:02:00.000Z',
        processedPageCount: 3,
        processedChunkCount: 5,
        nextRunAt: '2026-06-17T12:10:00.000Z',
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'pending',
        processedPageCount: 3,
        processedChunkCount: 5,
        nextRunAt: '2026-06-17T12:10:00.000Z',
      },
    });
    await expect(
      repo.failJob({
        jobId: 'running-expired',
        leaseOwnerId: 'worker-old',
        now: '2026-06-17T12:03:00.000Z',
        error: { code: 'INTERNAL_ERROR', message: 'stale failure' },
        nextRunAt: '2026-06-17T12:15:00.000Z',
        exhausted: false,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const failed = await repo.failJob({
      jobId: 'running-expired',
      leaseOwnerId: 'worker-1',
      now: '2026-06-17T12:03:00.000Z',
      error: {
        code: 'INTERNAL_ERROR',
        message: 'auth0|user-123 FA_INTERNAL_AUTH_TOKEN=secret failed',
      },
      nextRunAt: '2026-06-17T12:15:00.000Z',
      exhausted: true,
    });
    expect(failed).toMatchObject({
      ok: true,
      value: { status: 'failed', attempts: 1, finishedAt: '2026-06-17T12:03:00.000Z' },
    });
    expect(failed.ok ? failed.value.lastError?.message : '').not.toContain(
      'FA_INTERNAL_AUTH_TOKEN'
    );
    expect(failed.ok ? failed.value.lastError?.message : '').toContain('[redacted]');
  });

  it('retries only failed or expired running access-refresh jobs', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreKnowledgeAccessRefreshRepository(db as never);
    await repo.enqueueJob(accessRefreshJob({ id: 'failed', status: 'failed', attempts: 6 }));
    await repo.enqueueJob(
      accessRefreshJob({
        id: 'expired-running',
        status: 'running',
        attempts: 2,
        leaseOwnerId: 'worker-1',
        leaseExpiresAt: '2026-06-17T11:59:00.000Z',
      })
    );
    await repo.enqueueJob(accessRefreshJob({ id: 'pending', status: 'pending', attempts: 3 }));
    await repo.enqueueJob(
      accessRefreshJob({
        id: 'active-running',
        status: 'running',
        attempts: 4,
        leaseOwnerId: 'worker-1',
        leaseExpiresAt: '2026-06-17T12:05:00.000Z',
      })
    );
    await repo.enqueueJob(accessRefreshJob({ id: 'succeeded', status: 'succeeded' }));
    await repo.enqueueJob(accessRefreshJob({ id: 'unknown-status', status: 'paused' as never }));

    await expect(
      repo.retryJob({ jobId: 'missing-job', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    await expect(
      repo.retryJob({ jobId: 'failed', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: true, value: { status: 'pending', attempts: 0 } });
    await expect(
      repo.retryJob({ jobId: 'expired-running', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: true, value: { status: 'pending', attempts: 0 } });
    await expect(
      repo.retryJob({ jobId: 'pending', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repo.retryJob({ jobId: 'active-running', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repo.retryJob({ jobId: 'succeeded', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repo.retryJob({ jobId: 'unknown-status', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('upserts access audits and reports access-refresh admin status', async () => {
    const db = new FakeFirestore();
    const pageRepo = new FirestoreKnowledgePageRepository(db as never);
    const chunkRepo = new FirestoreKnowledgeChunkRepository(db as never);
    const repo = new FirestoreKnowledgeAccessRefreshRepository(db as never);
    await pageRepo.create(page());
    await chunkRepo.replaceActiveForPage({
      pageId: 'page-1',
      chunks: [chunk({ id: 'status-current' }), chunk({ id: 'status-stale', index: 1 })],
      deletedAt: '2026-06-17T11:00:00.000Z',
    });
    await db.collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION).doc('status-stale').update({
      accessSyncStatus: 'stale',
      accessRevision: 'category-rev-1',
    });
    await repo.enqueueJob(accessRefreshJob({ id: 'pending-job' }));
    await repo.enqueueJob(
      accessRefreshJob({
        id: 'running-expired-job',
        status: 'running',
        leaseOwnerId: 'worker-old',
        leaseExpiresAt: '2026-06-17T11:59:00.000Z',
      })
    );
    await repo.enqueueJob(
      accessRefreshJob({
        id: 'succeeded-job',
        status: 'succeeded',
        finishedAt: '2026-06-17T11:30:00.000Z',
      })
    );
    await repo.enqueueJob(
      accessRefreshJob({
        id: 'failed-job',
        status: 'failed',
        attempts: 6,
        lastError: {
          code: 'VALIDATION_ERROR',
          message: 'safe failure',
          occurredAt: '2026-06-17T11:45:00.000Z',
        },
        updatedAt: '2026-06-17T11:45:00.000Z',
      })
    );
    await expect(
      repo.upsertAudit(accessAudit({ id: 'open-critical', severity: 'critical', status: 'open' }))
    ).resolves.toMatchObject({ ok: true, value: { id: 'open-critical' } });
    await repo.upsertAudit(
      accessAudit({ id: 'open-warning', severity: 'warning', status: 'open' })
    );
    await repo.upsertAudit(
      accessAudit({
        id: 'resolved-recent',
        status: 'resolved',
        severity: 'warning',
        resolvedAt: '2026-06-17T11:30:00.000Z',
      })
    );
    await repo.upsertAudit(
      accessAudit({
        id: 'resolved-old',
        status: 'resolved',
        severity: 'warning',
        resolvedAt: '2026-06-15T11:30:00.000Z',
      })
    );

    await expect(
      repo.getAdminStatus({ now: '2026-06-17T12:00:00.000Z', recentFailuresLimit: 1 })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        jobs: { pending: 1, running: 1, succeeded: 1, failed: 1, expiredRunning: 1 },
        chunks: { active: 2, current: 1, stale: 1, failed: 0, invalid: 0, mismatch: 1 },
        audits: { openCritical: 1, openWarning: 1, resolvedLast24h: 1 },
        lastSuccessAt: '2026-06-17T11:30:00.000Z',
        recentFailures: [{ jobId: 'failed-job', lastErrorCode: 'VALIDATION_ERROR' }],
      },
    });
  });
});
