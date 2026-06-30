import { ok } from '@fa/common-core';
import { describe, expect, it, vi } from 'vitest';

import type { KnowledgePage, KnowledgePageChunk } from '../models/knowledge.js';
import {
  MemoryKnowledgeAccessRefreshRepository,
  MemoryKnowledgePageChunkRepository,
  MemoryKnowledgePageRepository,
} from '../../infra/memory/memoryKnowledgeRepositories.js';
import {
  ACCESS_REFRESH_MAX_CHUNKS_PER_BATCH,
  ACCESS_REFRESH_MAX_CLAIMED_JOBS,
  ACCESS_REFRESH_MAX_PAGES_PER_BATCH,
  KnowledgeAccessRefreshExecutor,
  computeAccessRefreshBackoffMs,
  enqueueCategoryAccessRefreshJob,
  isKnowledgePageChunkRetrievalEligible,
  recordKnowledgeRagCandidateExcluded,
  sanitizeAccessRefreshErrorMessage,
} from './accessRefresh.js';

function page(overrides: Partial<KnowledgePage> = {}): KnowledgePage {
  return {
    id: 'page-1',
    nodeId: 'page-node-1',
    status: 'active',
    title: 'Float Fishing Basics',
    slug: 'float-fishing-basics',
    categoryId: 'category-1',
    sectionId: null,
    pathIds: ['root', 'category-1', 'page-node-1'],
    pathTitles: ['Knowledge Base', 'Coarse Fishing', 'Float Fishing Basics'],
    hierarchy: { category: 'Coarse Fishing' },
    source: {
      type: 'manual',
      url: null,
      label: null,
      importer: null,
    },
    access: {
      inheritedFromCategoryId: 'category-1',
      categoryAccessRevision: 'category-rev-1',
      override: null,
      effective: {
        gate: 'approved',
        requiredLevel: null,
        accessRevision: 'category-rev-1',
      },
    },
    relations: {
      relatedTo: [],
      linksTo: [],
      supersedes: [],
    },
    markdown: '# Float Fishing Basics\n\nUse a balanced float.',
    normalizedMarkdown: '# Float Fishing Basics\n\nUse a balanced float.',
    markdownContentHash: 'hash-page-1',
    indexingStatus: 'ready',
    syncStatus: 'synced',
    accessSyncStatus: 'stale',
    indexingError: null,
    syncError: null,
    accessSyncError: null,
    chunkCount: 1,
    createdAt: '2026-06-17T12:00:00.000Z',
    updatedAt: '2026-06-17T12:00:00.000Z',
    deletedAt: null,
    createdByUserId: 'admin-1',
    updatedByUserId: 'admin-1',
    deletedByUserId: null,
    ...overrides,
  };
}

function embedding2048(seed = 0.1): number[] {
  return Array.from({ length: 2048 }, (_value, index) => seed + index / 100_000);
}

function pageChunk(overrides: Partial<KnowledgePageChunk> = {}): KnowledgePageChunk {
  return {
    id: 'page-chunk-1',
    status: 'active',
    pageId: 'page-1',
    nodeId: 'page-node-1',
    categoryId: 'category-1',
    sectionId: null,
    title: 'Float Fishing Basics',
    path: ['Knowledge Base', 'Coarse Fishing', 'Float Fishing Basics'],
    headingPath: ['Float Fishing Basics'],
    index: 0,
    text: 'Use a balanced float.',
    searchableText: 'Float Fishing Basics\n\nUse a balanced float.',
    markdownContentHash: 'hash-page-1',
    access: {
      gate: 'approved',
      requiredLevel: null,
    },
    accessRevision: 'category-rev-0',
    accessSyncStatus: 'stale',
    source: {
      type: 'manual',
      url: null,
      label: null,
    },
    embedding: embedding2048(),
    embeddingModel: 'qwen/qwen3-embedding-8b',
    embeddingProvider: 'openrouter',
    embeddingDimensions: 2048,
    createdAt: '2026-06-17T12:00:00.000Z',
    deletedAt: null,
    createdByJobId: null,
    accessRefreshedAt: '2026-06-17T12:00:00.000Z',
    accessRefreshJobId: null,
    ...overrides,
  };
}

class StaleCategoryListingPageRepository extends MemoryKnowledgePageRepository {
  constructor(private readonly stalePages: KnowledgePage[]) {
    super();
  }

  override listActiveByCategory(input: { categoryId: string }) {
    return Promise.resolve(
      ok(this.stalePages.filter((stalePage) => stalePage.categoryId === input.categoryId))
    );
  }
}

class RaceAfterPrecheckPageChunkRepository extends MemoryKnowledgePageChunkRepository {
  private hasRaced = false;

  constructor(private readonly racePageRepository: MemoryKnowledgePageRepository) {
    super(racePageRepository);
  }

  override refreshAccessForPage(
    input: Parameters<MemoryKnowledgePageChunkRepository['refreshAccessForPage']>[0]
  ) {
    if (!this.hasRaced && input.pageId === 'page-1' && input.accessSyncStatus === 'current') {
      this.hasRaced = true;
      const currentPage = this.racePageRepository.pages.get(input.pageId);
      if (currentPage !== undefined) {
        this.racePageRepository.pages.set(
          input.pageId,
          page({
            ...currentPage,
            accessSyncStatus: 'current',
            access: {
              inheritedFromCategoryId: 'category-1',
              categoryAccessRevision: 'category-rev-3',
              override: null,
              effective: {
                gate: 'level',
                requiredLevel: 8,
                accessRevision: 'category-rev-3',
              },
            },
            updatedAt: '2026-06-17T12:01:30.000Z',
          })
        );
      }

      const currentChunk = this.chunks.get('page-chunk-1');
      if (currentChunk !== undefined) {
        this.chunks.set('page-chunk-1', {
          ...currentChunk,
          access: { gate: 'level', requiredLevel: 8 },
          accessRevision: 'category-rev-3',
          accessSyncStatus: 'current',
          accessRefreshedAt: '2026-06-17T12:01:30.000Z',
          accessRefreshJobId: 'refresh-job-newer',
        });
      }
    }

    return super.refreshAccessForPage(input);
  }
}

class ConflictHasMorePageChunkRepository extends MemoryKnowledgePageChunkRepository {
  constructor(private readonly conflictPageRepository: MemoryKnowledgePageRepository) {
    super(conflictPageRepository);
  }

  override refreshAccessForPage(
    input: Parameters<MemoryKnowledgePageChunkRepository['refreshAccessForPage']>[0]
  ) {
    const currentPage = this.conflictPageRepository.pages.get(input.pageId);
    if (currentPage !== undefined) {
      this.conflictPageRepository.pages.set(
        input.pageId,
        page({
          ...currentPage,
          accessSyncStatus: 'stale',
          access: {
            inheritedFromCategoryId: 'category-1',
            categoryAccessRevision: 'category-rev-3',
            override: null,
            effective: {
              gate: 'level',
              requiredLevel: 8,
              accessRevision: 'category-rev-3',
            },
          },
          updatedAt: '2026-06-17T12:01:30.000Z',
        })
      );
    }

    return Promise.resolve(
      ok({ processedChunkCount: 0, hasMore: true, revisionConflict: true as const })
    );
  }
}

describe('knowledge access-refresh executor', () => {
  it('enqueues category access change jobs with actorAdminUserId', async () => {
    const accessRefreshRepository = new MemoryKnowledgeAccessRefreshRepository();

    const result = await enqueueCategoryAccessRefreshJob(
      {
        accessRefreshRepository,
        clock: { now: () => new Date('2026-06-17T12:00:00.000Z') },
        generateId: () => 'refresh-job-1',
      },
      {
        categoryId: 'category-1',
        requestedAccessRevision: 'category-rev-2',
        actorAdminUserId: 'admin-user-1',
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: 'refresh-job-1',
        status: 'pending',
        kind: 'category_access_changed',
        target: { categoryId: 'category-1', pageId: null },
        requestedAccessRevision: 'category-rev-2',
        actorAdminUserId: 'admin-user-1',
        attempts: 0,
        maxAttempts: 6,
      },
    });
    await expect(accessRefreshRepository.getJobById('refresh-job-1')).resolves.toMatchObject({
      ok: true,
      value: { actorAdminUserId: 'admin-user-1' },
    });
  });

  it('uses bounded claim/page/chunk batches when processing jobs', () => {
    expect(ACCESS_REFRESH_MAX_CLAIMED_JOBS).toBe(10);
    expect(ACCESS_REFRESH_MAX_PAGES_PER_BATCH).toBe(100);
    expect(ACCESS_REFRESH_MAX_CHUNKS_PER_BATCH).toBe(500);
  });

  it('computes capped exponential backoff with jitter', () => {
    expect(computeAccessRefreshBackoffMs({ attempts: 0, jitterMs: 0 })).toBe(30_000);
    expect(computeAccessRefreshBackoffMs({ attempts: 3, jitterMs: 10_000 })).toBe(250_000);
    expect(computeAccessRefreshBackoffMs({ attempts: 20, jitterMs: 10_000 })).toBe(900_000);
  });

  it('refreshes inherited page and active chunk access idempotently', async () => {
    const accessRefreshRepository = new MemoryKnowledgeAccessRefreshRepository();
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository();
    await pageRepository.create(
      page({
        access: {
          inheritedFromCategoryId: 'category-1',
          categoryAccessRevision: 'category-rev-2',
          override: null,
          effective: { gate: 'level', requiredLevel: 4, accessRevision: 'category-rev-2' },
        },
      })
    );
    pageChunkRepository.chunks.set('page-chunk-1', pageChunk());
    await enqueueCategoryAccessRefreshJob(
      {
        accessRefreshRepository,
        clock: { now: () => new Date('2026-06-17T12:01:00.000Z') },
        generateId: () => 'refresh-job-1',
      },
      {
        categoryId: 'category-1',
        requestedAccessRevision: 'category-rev-2',
        actorAdminUserId: 'admin-user-1',
      }
    );
    const executor = new KnowledgeAccessRefreshExecutor({
      accessRefreshRepository,
      pageRepository,
      pageChunkRepository,
      clock: { now: () => new Date('2026-06-17T12:02:00.000Z') },
      leaseOwnerId: 'worker-1',
      randomJitterMs: () => 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(executor.runOnce()).resolves.toMatchObject({
      ok: true,
      value: { claimedJobCount: 1, processedPageCount: 1, processedChunkCount: 1 },
    });
    await expect(executor.runOnce()).resolves.toMatchObject({
      ok: true,
      value: { claimedJobCount: 0, processedPageCount: 0, processedChunkCount: 0 },
    });

    await expect(pageRepository.getById('page-1')).resolves.toMatchObject({
      ok: true,
      value: {
        accessSyncStatus: 'current',
        access: {
          effective: { gate: 'level', requiredLevel: 4, accessRevision: 'category-rev-2' },
        },
      },
    });
    await expect(
      pageChunkRepository.listActiveForPage({ pageId: 'page-1' })
    ).resolves.toMatchObject({
      ok: true,
      value: [
        {
          access: { gate: 'level', requiredLevel: 4 },
          accessRevision: 'category-rev-2',
          accessSyncStatus: 'current',
          accessRefreshJobId: 'refresh-job-1',
        },
      ],
    });
  });

  it('updates old current chunks to the requested live revision before marking page current', async () => {
    const accessRefreshRepository = new MemoryKnowledgeAccessRefreshRepository();
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    await pageRepository.create(
      page({
        access: {
          inheritedFromCategoryId: 'category-1',
          categoryAccessRevision: 'category-rev-2',
          override: null,
          effective: { gate: 'level', requiredLevel: 4, accessRevision: 'category-rev-2' },
        },
      })
    );
    pageChunkRepository.chunks.set(
      'page-chunk-1',
      pageChunk({
        access: { gate: 'approved', requiredLevel: null },
        accessRevision: 'category-rev-1',
        accessSyncStatus: 'current',
        accessRefreshJobId: 'refresh-job-old-current',
      })
    );
    await enqueueCategoryAccessRefreshJob(
      {
        accessRefreshRepository,
        clock: { now: () => new Date('2026-06-17T12:01:00.000Z') },
        generateId: () => 'refresh-job-2',
      },
      {
        categoryId: 'category-1',
        requestedAccessRevision: 'category-rev-2',
        actorAdminUserId: 'admin-user-1',
      }
    );
    const executor = new KnowledgeAccessRefreshExecutor({
      accessRefreshRepository,
      pageRepository,
      pageChunkRepository,
      clock: { now: () => new Date('2026-06-17T12:02:00.000Z') },
      leaseOwnerId: 'worker-1',
      randomJitterMs: () => 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(executor.runOnce()).resolves.toMatchObject({
      ok: true,
      value: { claimedJobCount: 1, processedPageCount: 1, processedChunkCount: 1 },
    });
    await expect(pageRepository.getById('page-1')).resolves.toMatchObject({
      ok: true,
      value: {
        accessSyncStatus: 'current',
        access: { effective: { accessRevision: 'category-rev-2', requiredLevel: 4 } },
      },
    });
    expect(pageChunkRepository.chunks.get('page-chunk-1')).toMatchObject({
      access: { gate: 'level', requiredLevel: 4 },
      accessRevision: 'category-rev-2',
      accessSyncStatus: 'current',
      accessRefreshJobId: 'refresh-job-2',
    });
  });

  it('does not let an older category access job revert a newer live page revision', async () => {
    const staleSnapshot = page({
      accessSyncStatus: 'stale',
      access: {
        inheritedFromCategoryId: 'category-1',
        categoryAccessRevision: 'category-rev-2',
        override: null,
        effective: { gate: 'approved', requiredLevel: null, accessRevision: 'category-rev-2' },
      },
    });
    const pageRepository = new StaleCategoryListingPageRepository([staleSnapshot]);
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository();
    const accessRefreshRepository = new MemoryKnowledgeAccessRefreshRepository({
      pages: pageRepository,
      chunks: pageChunkRepository,
    });
    await pageRepository.create(
      page({
        accessSyncStatus: 'stale',
        updatedAt: '2026-06-17T12:00:30.000Z',
        access: {
          inheritedFromCategoryId: 'category-1',
          categoryAccessRevision: 'category-rev-3',
          override: null,
          effective: { gate: 'level', requiredLevel: 8, accessRevision: 'category-rev-3' },
        },
      })
    );
    pageChunkRepository.chunks.set(
      'page-chunk-1',
      pageChunk({
        accessRevision: 'category-rev-1',
        accessSyncStatus: 'stale',
      })
    );
    await enqueueCategoryAccessRefreshJob(
      {
        accessRefreshRepository,
        clock: { now: () => new Date('2026-06-17T12:00:00.000Z') },
        generateId: () => 'refresh-job-stale-revision',
      },
      {
        categoryId: 'category-1',
        requestedAccessRevision: 'category-rev-2',
        actorAdminUserId: 'admin-user-1',
      }
    );
    const executor = new KnowledgeAccessRefreshExecutor({
      accessRefreshRepository,
      pageRepository,
      pageChunkRepository,
      clock: { now: () => new Date('2026-06-17T12:02:00.000Z') },
      leaseOwnerId: 'worker-1',
      randomJitterMs: () => 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(executor.runOnce()).resolves.toMatchObject({
      ok: true,
      value: { claimedJobCount: 1, failedJobCount: 0 },
    });

    await expect(pageRepository.getById('page-1')).resolves.toMatchObject({
      ok: true,
      value: {
        accessSyncStatus: 'stale',
        access: {
          effective: { gate: 'level', requiredLevel: 8, accessRevision: 'category-rev-3' },
        },
      },
    });
    expect(pageChunkRepository.chunks.get('page-chunk-1')).toMatchObject({
      accessRevision: 'category-rev-1',
      accessSyncStatus: 'stale',
    });
    const staleAudits = [...accessRefreshRepository.audits.values()];
    expect(staleAudits).toHaveLength(1);
    expect(staleAudits[0]).toMatchObject({
      kind: 'stale_chunk_access_revision',
      pageId: 'page-1',
      chunkId: null,
    });
    expect(staleAudits[0]?.actual).toMatchObject({
      requestedAccessRevision: 'category-rev-2',
      currentAccessRevision: 'category-rev-3',
    });
  });

  it('does not let an older job downgrade newer chunks after the live page precheck', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new RaceAfterPrecheckPageChunkRepository(pageRepository);
    const accessRefreshRepository = new MemoryKnowledgeAccessRefreshRepository({
      pages: pageRepository,
      chunks: pageChunkRepository,
    });
    await pageRepository.create(
      page({
        accessSyncStatus: 'stale',
        access: {
          inheritedFromCategoryId: 'category-1',
          categoryAccessRevision: 'category-rev-2',
          override: null,
          effective: { gate: 'approved', requiredLevel: null, accessRevision: 'category-rev-2' },
        },
      })
    );
    pageChunkRepository.chunks.set(
      'page-chunk-1',
      pageChunk({
        accessRevision: 'category-rev-1',
        accessSyncStatus: 'stale',
      })
    );
    await enqueueCategoryAccessRefreshJob(
      {
        accessRefreshRepository,
        clock: { now: () => new Date('2026-06-17T12:00:00.000Z') },
        generateId: () => 'refresh-job-old',
      },
      {
        categoryId: 'category-1',
        requestedAccessRevision: 'category-rev-2',
        actorAdminUserId: 'admin-user-1',
      }
    );
    const executor = new KnowledgeAccessRefreshExecutor({
      accessRefreshRepository,
      pageRepository,
      pageChunkRepository,
      clock: { now: () => new Date('2026-06-17T12:02:00.000Z') },
      leaseOwnerId: 'worker-1',
      randomJitterMs: () => 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(executor.runOnce()).resolves.toMatchObject({
      ok: true,
      value: { claimedJobCount: 1, failedJobCount: 0 },
    });

    await expect(pageRepository.getById('page-1')).resolves.toMatchObject({
      ok: true,
      value: {
        accessSyncStatus: 'current',
        access: { effective: { accessRevision: 'category-rev-3', requiredLevel: 8 } },
      },
    });
    expect(pageChunkRepository.chunks.get('page-chunk-1')).toMatchObject({
      access: { gate: 'level', requiredLevel: 8 },
      accessRevision: 'category-rev-3',
      accessSyncStatus: 'current',
      accessRefreshJobId: 'refresh-job-newer',
    });
    const staleAudits = [...accessRefreshRepository.audits.values()];
    expect(staleAudits).toHaveLength(1);
    expect(staleAudits[0]).toMatchObject({
      kind: 'stale_chunk_access_revision',
      pageId: 'page-1',
    });
    expect(staleAudits[0]?.actual).toMatchObject({
      requestedAccessRevision: 'category-rev-2',
      currentAccessRevision: 'category-rev-3',
    });
  });

  it('does not continue forever when an oversized stale refresh reports revision conflict and hasMore', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new ConflictHasMorePageChunkRepository(pageRepository);
    const accessRefreshRepository = new MemoryKnowledgeAccessRefreshRepository({
      pages: pageRepository,
      chunks: pageChunkRepository,
    });
    await pageRepository.create(
      page({
        accessSyncStatus: 'stale',
        access: {
          inheritedFromCategoryId: 'category-1',
          categoryAccessRevision: 'category-rev-2',
          override: null,
          effective: { gate: 'approved', requiredLevel: null, accessRevision: 'category-rev-2' },
        },
      })
    );
    await enqueueCategoryAccessRefreshJob(
      {
        accessRefreshRepository,
        clock: { now: () => new Date('2026-06-17T12:00:00.000Z') },
        generateId: () => 'refresh-job-conflict-has-more',
      },
      {
        categoryId: 'category-1',
        requestedAccessRevision: 'category-rev-2',
        actorAdminUserId: 'admin-user-1',
      }
    );
    const executor = new KnowledgeAccessRefreshExecutor({
      accessRefreshRepository,
      pageRepository,
      pageChunkRepository,
      clock: { now: () => new Date('2026-06-17T12:02:00.000Z') },
      leaseOwnerId: 'worker-1',
      randomJitterMs: () => 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(executor.runOnce()).resolves.toMatchObject({
      ok: true,
      value: {
        claimedJobCount: 1,
        processedPageCount: 0,
        processedChunkCount: 0,
        succeededJobCount: 1,
      },
    });
    await expect(
      accessRefreshRepository.getJobById('refresh-job-conflict-has-more')
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'succeeded',
        processedPageCount: 0,
        processedChunkCount: 0,
      },
    });
    await expect(pageRepository.getById('page-1')).resolves.toMatchObject({
      ok: true,
      value: {
        accessSyncStatus: 'stale',
        access: { effective: { accessRevision: 'category-rev-3', requiredLevel: 8 } },
      },
    });
    expect([...accessRefreshRepository.audits.values()]).toEqual([
      expect.objectContaining({
        kind: 'stale_chunk_access_revision',
        pageId: 'page-1',
      }),
    ]);
  });

  it('does not let an older page access job mark a newer live page revision current', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository();
    const accessRefreshRepository = new MemoryKnowledgeAccessRefreshRepository({
      pages: pageRepository,
      chunks: pageChunkRepository,
    });
    await pageRepository.create(
      page({
        accessSyncStatus: 'stale',
        access: {
          inheritedFromCategoryId: 'category-1',
          categoryAccessRevision: 'page-rev-3',
          override: null,
          effective: { gate: 'level', requiredLevel: 6, accessRevision: 'page-rev-3' },
        },
      })
    );
    pageChunkRepository.chunks.set(
      'page-chunk-1',
      pageChunk({
        accessRevision: 'page-rev-2',
        accessSyncStatus: 'stale',
      })
    );
    await accessRefreshRepository.enqueueJob({
      id: 'refresh-job-old-page',
      status: 'pending',
      kind: 'page_access_refresh',
      target: { categoryId: null, pageId: 'page-1' },
      requestedAccessRevision: 'page-rev-2',
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
    });
    const executor = new KnowledgeAccessRefreshExecutor({
      accessRefreshRepository,
      pageRepository,
      pageChunkRepository,
      clock: { now: () => new Date('2026-06-17T12:02:00.000Z') },
      leaseOwnerId: 'worker-1',
      randomJitterMs: () => 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(executor.runOnce()).resolves.toMatchObject({
      ok: true,
      value: { claimedJobCount: 1, failedJobCount: 0 },
    });
    await expect(pageRepository.getById('page-1')).resolves.toMatchObject({
      ok: true,
      value: {
        accessSyncStatus: 'stale',
        access: { effective: { accessRevision: 'page-rev-3' } },
      },
    });
    expect(pageChunkRepository.chunks.get('page-chunk-1')).toMatchObject({
      accessRevision: 'page-rev-2',
      accessSyncStatus: 'stale',
    });
    const staleAudits = [...accessRefreshRepository.audits.values()];
    expect(staleAudits).toHaveLength(1);
    expect(staleAudits[0]).toMatchObject({
      kind: 'stale_chunk_access_revision',
      pageId: 'page-1',
    });
    expect(staleAudits[0]?.actual).toMatchObject({
      requestedAccessRevision: 'page-rev-2',
      currentAccessRevision: 'page-rev-3',
    });
  });

  it('continues oversized page chunk batches without failed attempts and does not mark the page current early', async () => {
    const accessRefreshRepository = new MemoryKnowledgeAccessRefreshRepository();
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository();
    await pageRepository.create(
      page({
        access: {
          inheritedFromCategoryId: 'category-1',
          categoryAccessRevision: 'category-rev-2',
          override: null,
          effective: { gate: 'level', requiredLevel: 4, accessRevision: 'category-rev-2' },
        },
      })
    );
    for (let index = 0; index < ACCESS_REFRESH_MAX_CHUNKS_PER_BATCH + 1; index += 1) {
      const chunkId = `page-chunk-${String(index)}`;
      pageChunkRepository.chunks.set(
        chunkId,
        pageChunk({
          id: chunkId,
          index,
          accessRevision: 'category-rev-1',
          accessSyncStatus: 'stale',
        })
      );
    }
    await accessRefreshRepository.enqueueJob({
      id: 'refresh-job-oversized',
      status: 'pending',
      kind: 'page_access_refresh',
      target: { categoryId: null, pageId: 'page-1' },
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
    });
    const executor = new KnowledgeAccessRefreshExecutor({
      accessRefreshRepository,
      pageRepository,
      pageChunkRepository,
      clock: { now: () => new Date('2026-06-17T12:01:00.000Z') },
      leaseOwnerId: 'worker-1',
      randomJitterMs: () => 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(executor.runOnce()).resolves.toMatchObject({
      ok: true,
      value: {
        claimedJobCount: 1,
        failedJobCount: 0,
        processedPageCount: 0,
        processedChunkCount: ACCESS_REFRESH_MAX_CHUNKS_PER_BATCH,
      },
    });
    await expect(pageRepository.getById('page-1')).resolves.toMatchObject({
      ok: true,
      value: { accessSyncStatus: 'stale' },
    });
    expect(pageChunkRepository.chunks.get('page-chunk-0')).toMatchObject({
      accessRevision: 'category-rev-2',
      accessSyncStatus: 'current',
    });
    const overflowChunkId = `page-chunk-${String(ACCESS_REFRESH_MAX_CHUNKS_PER_BATCH)}`;
    expect(pageChunkRepository.chunks.get(overflowChunkId)).toMatchObject({
      accessRevision: 'category-rev-1',
      accessSyncStatus: 'stale',
    });
    await expect(
      accessRefreshRepository.getJobById('refresh-job-oversized')
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'pending',
        attempts: 0,
        processedPageCount: 0,
        processedChunkCount: ACCESS_REFRESH_MAX_CHUNKS_PER_BATCH,
      },
    });

    await expect(executor.runOnce()).resolves.toMatchObject({
      ok: true,
      value: {
        claimedJobCount: 1,
        failedJobCount: 0,
        processedPageCount: 1,
        processedChunkCount: 1,
      },
    });
    await expect(pageRepository.getById('page-1')).resolves.toMatchObject({
      ok: true,
      value: { accessSyncStatus: 'current' },
    });
    await expect(
      accessRefreshRepository.getJobById('refresh-job-oversized')
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'succeeded',
        attempts: 0,
        processedPageCount: 1,
        processedChunkCount: ACCESS_REFRESH_MAX_CHUNKS_PER_BATCH + 1,
      },
    });
  });

  it('continues oversized page batches without failed attempts and accumulates processed pages', async () => {
    const accessRefreshRepository = new MemoryKnowledgeAccessRefreshRepository();
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository();
    for (let index = 0; index < ACCESS_REFRESH_MAX_PAGES_PER_BATCH + 1; index += 1) {
      await pageRepository.create(
        page({
          id: `page-${String(index)}`,
          nodeId: `page-node-${String(index)}`,
          access: {
            inheritedFromCategoryId: 'category-1',
            categoryAccessRevision: 'category-rev-2',
            override: null,
            effective: { gate: 'approved', requiredLevel: null, accessRevision: 'category-rev-2' },
          },
        })
      );
    }
    await enqueueCategoryAccessRefreshJob(
      {
        accessRefreshRepository,
        clock: { now: () => new Date('2026-06-17T12:00:00.000Z') },
        generateId: () => 'refresh-job-pages',
      },
      {
        categoryId: 'category-1',
        requestedAccessRevision: 'category-rev-2',
        actorAdminUserId: 'admin-user-1',
      }
    );
    const executor = new KnowledgeAccessRefreshExecutor({
      accessRefreshRepository,
      pageRepository,
      pageChunkRepository,
      clock: { now: () => new Date('2026-06-17T12:01:00.000Z') },
      leaseOwnerId: 'worker-1',
      randomJitterMs: () => 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(executor.runOnce()).resolves.toMatchObject({
      ok: true,
      value: {
        claimedJobCount: 1,
        failedJobCount: 0,
        processedPageCount: ACCESS_REFRESH_MAX_PAGES_PER_BATCH,
        processedChunkCount: 0,
      },
    });
    await expect(accessRefreshRepository.getJobById('refresh-job-pages')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'pending',
        attempts: 0,
        processedPageCount: ACCESS_REFRESH_MAX_PAGES_PER_BATCH,
      },
    });
    await expect(
      pageRepository.getById(`page-${String(ACCESS_REFRESH_MAX_PAGES_PER_BATCH)}`)
    ).resolves.toMatchObject({
      ok: true,
      value: { accessSyncStatus: 'stale' },
    });

    await expect(executor.runOnce()).resolves.toMatchObject({
      ok: true,
      value: {
        claimedJobCount: 1,
        failedJobCount: 0,
        processedPageCount: 1,
        processedChunkCount: 0,
      },
    });
    await expect(accessRefreshRepository.getJobById('refresh-job-pages')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'succeeded',
        attempts: 0,
        processedPageCount: ACCESS_REFRESH_MAX_PAGES_PER_BATCH + 1,
      },
    });
  });

  it('keeps manual access and forbidden source URL pages ineligible and opens audits', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository();
    const accessRefreshRepository = new MemoryKnowledgeAccessRefreshRepository({
      pages: pageRepository,
      chunks: pageChunkRepository,
    });
    pageRepository.pages.set(
      'page-1',
      page({
        source: {
          type: 'external',
          url: 'https://fishing-assistant.online/api/knowledge/admin/pages/page-1',
          label: null,
          importer: null,
        },
        access: {
          inheritedFromCategoryId: 'category-1',
          categoryAccessRevision: 'forbidden-rev-1',
          override: null,
          effective: { gate: 'approved', requiredLevel: null, accessRevision: 'forbidden-rev-1' },
        },
      })
    );
    pageChunkRepository.chunks.set('page-chunk-1', pageChunk({ accessSyncStatus: 'current' }));
    await accessRefreshRepository.enqueueJob({
      id: 'refresh-job-1',
      status: 'pending',
      kind: 'page_access_refresh',
      target: { categoryId: null, pageId: 'page-1' },
      requestedAccessRevision: 'forbidden-rev-1',
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
    });
    pageRepository.pages.set(
      'page-2',
      page({
        id: 'page-2',
        nodeId: 'page-node-2',
        access: {
          inheritedFromCategoryId: 'category-1',
          categoryAccessRevision: 'manual-rev-1',
          override: null,
          effective: { gate: 'manual', requiredLevel: null, accessRevision: 'manual-rev-1' },
        },
      })
    );
    pageChunkRepository.chunks.set(
      'page-chunk-2',
      pageChunk({
        id: 'page-chunk-2',
        pageId: 'page-2',
        nodeId: 'page-node-2',
        accessSyncStatus: 'current',
      })
    );
    await accessRefreshRepository.enqueueJob({
      id: 'refresh-job-2',
      status: 'pending',
      kind: 'page_access_refresh',
      target: { categoryId: null, pageId: 'page-2' },
      requestedAccessRevision: 'manual-rev-1',
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
    });
    const executor = new KnowledgeAccessRefreshExecutor({
      accessRefreshRepository,
      pageRepository,
      pageChunkRepository,
      clock: { now: () => new Date('2026-06-17T12:01:00.000Z') },
      leaseOwnerId: 'worker-1',
      randomJitterMs: () => 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(executor.runOnce()).resolves.toMatchObject({
      ok: true,
      value: { failedJobCount: 2 },
    });
    await expect(pageRepository.getById('page-1')).resolves.toMatchObject({
      ok: true,
      value: { accessSyncStatus: 'invalid' },
    });
    await expect(
      pageChunkRepository.listActiveForPage({ pageId: 'page-1' })
    ).resolves.toMatchObject({
      ok: true,
      value: [{ accessSyncStatus: 'invalid' }],
    });
    await expect(pageRepository.getById('page-2')).resolves.toMatchObject({
      ok: true,
      value: { accessSyncStatus: 'invalid' },
    });
    await expect(
      pageChunkRepository.listActiveForPage({ pageId: 'page-2' })
    ).resolves.toMatchObject({
      ok: true,
      value: [{ accessSyncStatus: 'invalid' }],
    });
    await expect(
      accessRefreshRepository.getAdminStatus({ now: '2026-06-17T12:01:00.000Z' })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        audits: { openCritical: 2 },
        chunks: { invalid: 2 },
      },
    });
  });

  it('full access audit opens audits for missing, invalid, stale, mismatched, manual, and forbidden chunk access', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository();
    const accessRefreshRepository = new MemoryKnowledgeAccessRefreshRepository({
      pages: pageRepository,
      chunks: pageChunkRepository,
    });
    await pageRepository.create(
      page({
        accessSyncStatus: 'current',
        access: {
          inheritedFromCategoryId: 'category-1',
          categoryAccessRevision: 'audit-rev-2',
          override: null,
          effective: { gate: 'level', requiredLevel: 3, accessRevision: 'audit-rev-2' },
        },
      })
    );
    const auditChunks = [
      pageChunk({ id: 'missing-access', index: 0, access: undefined as never }),
      pageChunk({
        id: 'invalid-status',
        index: 1,
        accessRevision: 'audit-rev-2',
        accessSyncStatus: 'invalid',
      }),
      pageChunk({
        id: 'stale-status',
        index: 2,
        accessRevision: 'audit-rev-2',
        accessSyncStatus: 'stale',
      }),
      pageChunk({
        id: 'revision-mismatch',
        index: 3,
        accessRevision: 'audit-rev-1',
        accessSyncStatus: 'current',
      }),
      pageChunk({
        id: 'manual-access',
        index: 4,
        access: { gate: 'manual', requiredLevel: null } as never,
        accessRevision: 'audit-rev-2',
        accessSyncStatus: 'current',
      }),
      pageChunk({
        id: 'forbidden-source',
        index: 5,
        accessRevision: 'audit-rev-2',
        accessSyncStatus: 'current',
        source: {
          type: 'external',
          url: 'https://fishing-assistant.online/api/knowledge/admin/pages/page-1?token=secret&email=admin@example.com',
          label: null,
        },
      }),
    ];
    for (const chunk of auditChunks) {
      pageChunkRepository.chunks.set(chunk.id, chunk);
    }
    await accessRefreshRepository.enqueueJob({
      id: 'audit-job-1',
      status: 'pending',
      kind: 'full_access_audit',
      target: { categoryId: null, pageId: null },
      requestedAccessRevision: null,
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
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const executor = new KnowledgeAccessRefreshExecutor({
      accessRefreshRepository,
      pageRepository,
      pageChunkRepository,
      clock: { now: () => new Date('2026-06-17T12:01:00.000Z') },
      leaseOwnerId: 'worker-1',
      randomJitterMs: () => 0,
      logger,
    });

    await expect(executor.runOnce()).resolves.toMatchObject({
      ok: true,
      value: { claimedJobCount: 1, succeededJobCount: 1, processedPageCount: 1 },
    });
    expect([...accessRefreshRepository.audits.values()].map((entry) => entry.kind).sort()).toEqual([
      'chunk_page_access_mismatch',
      'chunk_page_access_mismatch',
      'forbidden_source_url',
      'invalid_chunk_access',
      'manual_chunk_access',
      'missing_chunk_access',
      'stale_chunk_access_revision',
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'knowledge_access_mismatch_detected' }),
      expect.any(String)
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'knowledge_source_url_rejected' }),
      expect.any(String)
    );
    const forbiddenSourceAudit = accessRefreshRepository.audits.get(
      'audit:forbidden_source_url:page-1:forbidden-source'
    );
    expect(forbiddenSourceAudit?.actual['sourceUrlPresent']).toBe(true);
    expect(typeof forbiddenSourceAudit?.actual['sourceUrlHash']).toBe('string');
    const serializedActual = JSON.stringify(forbiddenSourceAudit?.actual);
    expect(serializedActual).not.toContain('https://fishing-assistant.online');
    expect(serializedActual).not.toContain('/api/knowledge');
    expect(serializedActual).not.toContain('token=secret');
    expect(serializedActual).not.toContain('admin@example.com');
  });

  it('continues full access audit at the chunk batch bound without failed attempts', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository();
    const accessRefreshRepository = new MemoryKnowledgeAccessRefreshRepository({
      pages: pageRepository,
      chunks: pageChunkRepository,
    });
    await pageRepository.create(
      page({
        accessSyncStatus: 'current',
        access: {
          inheritedFromCategoryId: 'category-1',
          categoryAccessRevision: 'audit-rev-2',
          override: null,
          effective: { gate: 'approved', requiredLevel: null, accessRevision: 'audit-rev-2' },
        },
      })
    );
    for (let index = 0; index < ACCESS_REFRESH_MAX_CHUNKS_PER_BATCH + 1; index += 1) {
      const chunkId = `audit-chunk-${String(index)}`;
      pageChunkRepository.chunks.set(
        chunkId,
        pageChunk({
          id: chunkId,
          index,
          access: { gate: 'approved', requiredLevel: null },
          accessRevision: 'audit-rev-2',
          accessSyncStatus: 'current',
        })
      );
    }
    await accessRefreshRepository.enqueueJob({
      id: 'audit-job-oversized',
      status: 'pending',
      kind: 'full_access_audit',
      target: { categoryId: null, pageId: null },
      requestedAccessRevision: null,
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
    });
    const executor = new KnowledgeAccessRefreshExecutor({
      accessRefreshRepository,
      pageRepository,
      pageChunkRepository,
      clock: { now: () => new Date('2026-06-17T12:01:00.000Z') },
      leaseOwnerId: 'worker-1',
      randomJitterMs: () => 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(executor.runOnce()).resolves.toMatchObject({
      ok: true,
      value: {
        claimedJobCount: 1,
        succeededJobCount: 0,
        failedJobCount: 0,
        processedPageCount: 0,
        processedChunkCount: ACCESS_REFRESH_MAX_CHUNKS_PER_BATCH,
      },
    });
    await expect(accessRefreshRepository.getJobById('audit-job-oversized')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'pending',
        attempts: 0,
        processedPageCount: 0,
        processedChunkCount: ACCESS_REFRESH_MAX_CHUNKS_PER_BATCH,
      },
    });

    await expect(executor.runOnce()).resolves.toMatchObject({
      ok: true,
      value: {
        claimedJobCount: 1,
        succeededJobCount: 1,
        failedJobCount: 0,
        processedPageCount: 1,
        processedChunkCount: 1,
      },
    });
    await expect(accessRefreshRepository.getJobById('audit-job-oversized')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'succeeded',
        attempts: 0,
        processedPageCount: 1,
        processedChunkCount: ACCESS_REFRESH_MAX_CHUNKS_PER_BATCH + 1,
      },
    });
  });

  it('records an audit instead of throwing when a historical active chunk is missing source metadata', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository();
    const accessRefreshRepository = new MemoryKnowledgeAccessRefreshRepository({
      pages: pageRepository,
      chunks: pageChunkRepository,
    });
    await pageRepository.create(
      page({
        accessSyncStatus: 'current',
        source: {
          type: 'external',
          url: 'https://example.com/fishing/float-basics',
          label: 'Example',
          importer: null,
        },
        access: {
          inheritedFromCategoryId: 'category-1',
          categoryAccessRevision: 'audit-rev-2',
          override: null,
          effective: { gate: 'approved', requiredLevel: null, accessRevision: 'audit-rev-2' },
        },
      })
    );
    pageChunkRepository.chunks.set('missing-source', {
      ...pageChunk({
        id: 'missing-source',
        accessRevision: 'audit-rev-2',
        accessSyncStatus: 'current',
      }),
      source: undefined,
    } as unknown as KnowledgePageChunk);
    pageChunkRepository.chunks.set('missing-access', {
      ...pageChunk({
        id: 'missing-access',
        index: 1,
        accessRevision: 'audit-rev-2',
        accessSyncStatus: 'current',
        source: {
          type: 'external',
          url: 'https://example.com/fishing/float-basics',
          label: 'Example',
        },
      }),
      access: undefined,
      source: undefined,
    } as unknown as KnowledgePageChunk);
    await accessRefreshRepository.enqueueJob({
      id: 'audit-job-missing-source',
      status: 'pending',
      kind: 'full_access_audit',
      target: { categoryId: null, pageId: null },
      requestedAccessRevision: null,
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
    });
    const executor = new KnowledgeAccessRefreshExecutor({
      accessRefreshRepository,
      pageRepository,
      pageChunkRepository,
      clock: { now: () => new Date('2026-06-17T12:01:00.000Z') },
      leaseOwnerId: 'worker-1',
      randomJitterMs: () => 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(executor.runOnce()).resolves.toMatchObject({
      ok: true,
      value: { claimedJobCount: 1, succeededJobCount: 1, processedPageCount: 1 },
    });
    expect(
      [...accessRefreshRepository.audits.values()]
        .filter((entry) => entry.pageId === 'page-1')
        .map((entry) => entry.kind)
        .sort()
    ).toEqual(['chunk_page_access_mismatch', 'missing_chunk_access']);
    const mismatchAudit = [...accessRefreshRepository.audits.values()].find(
      (entry) => entry.kind === 'chunk_page_access_mismatch'
    );
    expect(mismatchAudit?.actual).toMatchObject({
      sourcePresent: false,
      sourceUrlPresent: false,
    });
  });

  it('treats current-schema chunks as ineligible unless metadata is complete, current, and revision-matched', () => {
    const currentPage = page({
      accessSyncStatus: 'current',
      access: {
        inheritedFromCategoryId: 'category-1',
        categoryAccessRevision: 'category-rev-2',
        override: null,
        effective: { gate: 'approved', requiredLevel: null, accessRevision: 'category-rev-2' },
      },
    });
    const currentChunk = pageChunk({
      accessRevision: 'category-rev-2',
      accessSyncStatus: 'current',
      access: { gate: 'approved', requiredLevel: null },
    });

    expect(isKnowledgePageChunkRetrievalEligible({ page: currentPage, chunk: currentChunk })).toBe(
      true
    );
    for (const chunk of [
      pageChunk({ accessRevision: 'category-rev-1', accessSyncStatus: 'current' }),
      pageChunk({ accessRevision: 'category-rev-2', accessSyncStatus: 'stale' }),
      pageChunk({ accessRevision: 'category-rev-2', accessSyncStatus: 'failed' }),
      pageChunk({ accessRevision: 'category-rev-2', accessSyncStatus: 'invalid' }),
      pageChunk({
        accessRevision: 'category-rev-2',
        accessSyncStatus: 'current',
        access: { gate: 'manual', requiredLevel: null } as never,
      }),
    ]) {
      expect(isKnowledgePageChunkRetrievalEligible({ page: currentPage, chunk })).toBe(false);
    }
    expect(
      isKnowledgePageChunkRetrievalEligible({
        page: page({ accessSyncStatus: 'stale' }),
        chunk: currentChunk,
      })
    ).toBe(false);
    expect(isKnowledgePageChunkRetrievalEligible({ page: null, chunk: currentChunk })).toBe(false);
  });

  it('redacts operator-facing access refresh errors', () => {
    const sanitized = sanitizeAccessRefreshErrorMessage(
      [
        'Auth0 subject auth0|user-123 leaked for admin@example.com',
        'mobile +1 555 010 800 and Bearer abc.def.ghi',
        'FA_INTERNAL_AUTH_TOKEN=secret FA_OPENROUTER_APP_API_KEY=abc',
        '    at Object.run (/tmp/source.ts:10:2)',
      ].join('\n')
    );

    expect(sanitized).not.toContain('auth0|user-123');
    expect(sanitized).not.toContain('admin@example.com');
    expect(sanitized).not.toContain('+1 555 010 800');
    expect(sanitized).not.toContain('abc.def.ghi');
    expect(sanitized).not.toContain('FA_INTERNAL_AUTH_TOKEN');
    expect(sanitized).not.toContain('/tmp/source.ts');
    expect(sanitized).toContain('[redacted]');
  });

  it('emits the canonical RAG candidate exclusion event through the Task 5.4 guard hook', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    recordKnowledgeRagCandidateExcluded(logger, {
      reason: 'chunk_access_not_current',
    });

    expect(logger.warn).toHaveBeenCalledWith(
      {
        event: 'knowledge_rag_candidate_excluded',
        reason: 'chunk_access_not_current',
      },
      'Knowledge RAG candidate excluded by access guard'
    );
  });
});
