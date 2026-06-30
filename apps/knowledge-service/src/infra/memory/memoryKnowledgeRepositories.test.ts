import { describe, expect, it } from 'vitest';

import type { AnswerGap } from '@fa/http-contracts';
import type {
  KnowledgeNode,
  KnowledgePage,
  KnowledgePageChunk,
} from '../../domain/models/knowledge.js';
import { MemoryAnswerGapRepository } from './memoryAnswerGapRepository.js';
import {
  MemoryKnowledgeNodeRepository,
  MemoryKnowledgePageChunkRepository,
  MemoryKnowledgePageRepository,
} from './memoryKnowledgeRepositories.js';

function expectObjectContaining(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

function node(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return {
    id: 'page-node-1',
    type: 'page',
    status: 'active',
    title: 'Float Fishing Basics',
    slug: 'float-fishing-basics',
    sortIndex: 0,
    parentId: 'section-1',
    categoryId: 'category-1',
    sectionId: 'section-1',
    pageId: 'page-1',
    depth: 3,
    pathIds: ['root', 'category-1', 'section-1', 'page-node-1'],
    pathTitles: ['Knowledge Base', 'Coarse Fishing', 'Floats', 'Float Fishing Basics'],
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

describe('memory knowledge repositories', () => {
  it('stores and soft-deletes knowledge nodes', async () => {
    const repo = new MemoryKnowledgeNodeRepository();
    repo.nodes.set('page-node-1', node());

    await expect(repo.listActive()).resolves.toMatchObject({
      ok: true,
      value: [expect.objectContaining({ id: 'page-node-1' })],
    });
    await expect(
      repo.softDeleteSubtree({
        rootNodeId: 'page-node-1',
        deletedAt: '2026-06-15T00:00:00.000Z',
        deletedByUserId: 'admin-user-2',
      })
    ).resolves.toMatchObject({
      ok: true,
      value: [expect.objectContaining({ status: 'deleted', deletedByUserId: 'admin-user-2' })],
    });
  });

  it('claims sync, replaces active page chunks, and refreshes access metadata', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const repo = new MemoryKnowledgePageChunkRepository(pageRepository);
    pageRepository.pages.set('page-1', page());
    repo.chunks.set('page-chunk-1', chunk());

    await expect(
      repo.claimPageSync({
        page: page({ syncStatus: 'syncing', indexingStatus: 'pending' }),
        deletedAt: '2026-06-15T00:00:00.000Z',
      })
    ).resolves.toMatchObject({
      ok: true,
      value: expectObjectContaining({ syncStatus: 'syncing' }),
    });
    expect(repo.chunks.get('page-chunk-1')).toMatchObject({ status: 'deleted' });

    await expect(
      repo.replaceActiveForPage({
        pageId: 'page-1',
        deletedAt: '2026-06-15T01:00:00.000Z',
        chunks: [chunk({ id: 'page-chunk-2', accessRevision: 'category-rev-3' })],
      })
    ).resolves.toEqual({ ok: true, value: undefined });

    await expect(
      repo.refreshAccessForPage({
        pageId: 'page-1',
        access: { gate: 'approved', requiredLevel: null },
        accessRevision: 'category-rev-4',
        accessSyncStatus: 'current',
        accessRefreshedAt: '2026-06-15T02:00:00.000Z',
        accessRefreshJobId: 'job-1',
        limit: 10,
      })
    ).resolves.toEqual({
      ok: true,
      value: { processedChunkCount: 1, hasMore: false },
    });

    expect(repo.chunks.get('page-chunk-2')).toMatchObject({
      access: { gate: 'approved', requiredLevel: null },
      accessRevision: 'category-rev-4',
      accessRefreshJobId: 'job-1',
    });
  });

  it('returns deduped retrieval page metadata maps without markdown fields', async () => {
    const repo = new MemoryKnowledgePageRepository();
    repo.pages.set('page-1', page());
    repo.pages.set(
      'page-2',
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
      'page-2',
      'page-1',
      'missing-page',
      'page-1',
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval metadata lookup to succeed');
    }
    expect([...result.value.keys()]).toEqual(['page-2', 'page-1']);
    expect(result.value.get('page-2')).toMatchObject({
      id: 'page-2',
      title: 'Ledgering Basics',
      access: {
        effective: { gate: 'level', requiredLevel: 6, accessRevision: 'category-rev-2' },
      },
    });
    const metadata = result.value.get('page-2');
    expect(metadata).toBeDefined();
    expect('markdown' in (metadata ?? {})).toBe(false);
    expect('normalizedMarkdown' in (metadata ?? {})).toBe(false);
  });

  it('lists lexical retrieval candidates without embedding fields in Firestore-compatible order', async () => {
    const repo = new MemoryKnowledgePageChunkRepository();
    repo.chunks.set(
      'chunk-b-1',
      chunk({
        id: 'chunk-b-1',
        pageId: 'page-b',
        index: 1,
      })
    );
    repo.chunks.set(
      'chunk-a-2',
      chunk({
        id: 'chunk-a-2',
        pageId: 'page-a',
        index: 2,
      })
    );
    repo.chunks.set(
      'chunk-a-0',
      chunk({
        id: 'chunk-a-0',
        pageId: 'page-a',
        index: 0,
      })
    );
    repo.chunks.set(
      'chunk-stale',
      chunk({
        id: 'chunk-stale',
        pageId: 'page-a',
        index: 1,
        accessSyncStatus: 'stale',
      })
    );

    const result = await repo.listRetrievableActiveLexicalCandidates({ limit: 2 });

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

    if (!result.ok) {
      throw new Error('Expected lexical candidates');
    }

    for (const lexicalCandidate of result.value.chunks) {
      expect('embedding' in lexicalCandidate).toBe(false);
      expect('embeddingModel' in lexicalCandidate).toBe(false);
      expect('embeddingProvider' in lexicalCandidate).toBe(false);
      expect('embeddingDimensions' in lexicalCandidate).toBe(false);
    }
  });

  it('stores, lists, and updates answer gaps with stable pagination order', async () => {
    const repo = new MemoryAnswerGapRepository();

    await expect(
      repo.create(answerGap({ id: 'answer-gap-b', createdAt: '2026-06-14T13:00:00.000Z' }))
    ).resolves.toMatchObject({ ok: true, value: { id: 'answer-gap-b' } });
    await expect(
      repo.create(answerGap({ id: 'answer-gap-a', createdAt: '2026-06-14T13:00:00.000Z' }))
    ).resolves.toMatchObject({ ok: true, value: { id: 'answer-gap-a' } });
    await expect(
      repo.create(
        answerGap({
          id: 'answer-gap-done',
          status: 'done',
          createdAt: '2026-06-14T14:00:00.000Z',
        })
      )
    ).resolves.toMatchObject({ ok: true, value: { id: 'answer-gap-done' } });

    const firstPage = await repo.list({ status: 'needs_answer', limit: 1 });
    expect(firstPage).toMatchObject({
      ok: true,
      value: {
        totalCount: 2,
        gaps: [expect.objectContaining({ id: 'answer-gap-a' })],
      },
    });
    if (!firstPage.ok || firstPage.value.nextCursor === null) {
      throw new Error('Expected first page with cursor');
    }
    expect(typeof firstPage.value.nextCursor).toBe('string');

    await expect(
      repo.list({
        status: 'needs_answer',
        limit: 5,
        cursor: {
          filter: 'needs_answer',
          createdAt: '2026-06-14T13:00:00.000Z',
          id: 'answer-gap-a',
        },
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        totalCount: 2,
        gaps: [expect.objectContaining({ id: 'answer-gap-b' })],
        nextCursor: null,
      },
    });

    await expect(
      repo.update(answerGap({ id: 'answer-gap-a', status: 'done' }))
    ).resolves.toMatchObject({ ok: true, value: { status: 'done' } });
  });
});
