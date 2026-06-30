import { afterEach, describe, expect, it, vi } from 'vitest';

import { err, ok, type Clock } from '@fa/common-core';
import type { CreateAnswerGapRequest } from '@fa/http-contracts';
import type { EmbeddingRequest, EmbeddingResponse, LlmEmbeddingProvider } from '@fa/llm-contract';

import type { KnowledgePage, KnowledgePageChunk } from '../models/knowledge.js';
import { encodeAnswerGapCursor } from '../models/answerGap.js';
import { MemoryAnswerGapRepository } from '../../infra/memory/memoryAnswerGapRepository.js';
import type { AnswerGapRepository } from '../repositories/answerGapRepository.js';
import {
  MemoryKnowledgePageChunkRepository,
  MemoryKnowledgePageRepository,
} from '../../infra/memory/memoryKnowledgeRepositories.js';
import type { KnowledgePageChunkMatch } from '../repositories/knowledgeRepositories.js';
import {
  embeddingResponseMismatchMessage,
  pageEmbeddingInputBuilder,
  syncDocument,
} from './syncDocument.js';
import { syncKnowledgeBase } from './syncKnowledgeBase.js';
import { retrieveKnowledge } from './retrieveKnowledge.js';
import {
  createAnswerGap,
  listAnswerGaps,
  markAnswerGapDone,
  withdrawAnswerGapConsent,
} from './answerGaps.js';

const clock: Clock = { now: () => new Date('2026-06-14T12:00:00.000Z') };
const embeddingConfig = {
  provider: 'openrouter',
  model: 'qwen/qwen3-embedding-8b',
  dimensions: 2048,
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

function expectArrayContaining(items: readonly unknown[]): unknown {
  return expect.arrayContaining([...items]) as unknown;
}

function expectObjectContaining(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

function retrievedEvidenceText(
  items: readonly { title: string; quote: string; content: string }[]
): string {
  return items.map((item) => `${item.title}\n${item.quote}\n${item.content}`).join('\n\n');
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeEmbeddingProvider implements LlmEmbeddingProvider {
  readonly requests: EmbeddingRequest[] = [];

  constructor(
    private readonly options: {
      vectors?: number[][];
      responseProvider?: string;
      responseModel?: string;
      responseDimensions?: number;
      error?: Error;
    } = {}
  ) {}

  embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    this.requests.push(request);
    if (this.options.error !== undefined) {
      return Promise.reject(this.options.error);
    }
    const dimensions = this.options.responseDimensions ?? request.dimensions ?? 2048;
    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    return Promise.resolve({
      provider: this.options.responseProvider ?? 'openrouter',
      model: this.options.responseModel ?? request.model ?? 'qwen/qwen3-embedding-8b',
      dimensions,
      vectors:
        this.options.vectors ??
        inputs.map((_value, index) => Array.from({ length: dimensions }, () => index + 0.1)),
      usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1, estimated: false },
    });
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
    markdown: '# Markdown Heading\n\n## Swim One\n\nUse pellets.',
    normalizedMarkdown: '# Markdown Heading\n\n## Swim One\n\nUse pellets.',
    markdownContentHash: 'page-hash-1',
    indexingStatus: 'pending',
    syncStatus: 'sync_required',
    accessSyncStatus: 'stale',
    indexingError: null,
    syncError: null,
    accessSyncError: null,
    chunkCount: 0,
    createdAt: '2026-06-14T12:00:00.000Z',
    updatedAt: '2026-06-14T12:00:00.000Z',
    deletedAt: null,
    createdByUserId: 'admin-user-1',
    updatedByUserId: 'admin-user-1',
    deletedByUserId: null,
    ...overrides,
  };
}

function readyPage(overrides: Partial<KnowledgePage> = {}): KnowledgePage {
  return page({
    indexingStatus: 'ready',
    syncStatus: 'synced',
    accessSyncStatus: 'current',
    chunkCount: 1,
    ...overrides,
  });
}

function pageChunk(overrides: Partial<KnowledgePageChunk> = {}): KnowledgePageChunk {
  const chunk: KnowledgePageChunk = {
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

  return chunk;
}

function answerGapRequest(overrides: Partial<CreateAnswerGapRequest> = {}): CreateAnswerGapRequest {
  return {
    source: 'no_accessible_evidence',
    question: 'How should I fish a canal in February?',
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
      assistantMessageId: 'assistant/message-1',
      contextWindow: [
        { role: 'user', content: 'What should I prepare?' },
        { role: 'assistant', content: 'I need a bit more context.' },
      ],
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
      candidateId: 'answer-gap-candidate-assistant_message-1',
    },
    ...overrides,
  };
}

describe('knowledge page use cases', () => {
  it('syncs a page and records user-owned embedding usage', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set('page-1', page());

    const result = await syncDocument(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
        clock,
        generateId: () => 'page-chunk-1',
      },
      {
        pageId: 'page-1',
        actorAdminUserId: 'admin-user-9',
        promptType: 'knowledge-page-sync-embedding',
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: 'page-1',
        syncStatus: 'synced',
        indexingStatus: 'ready',
        chunkCount: 1,
      },
    });
    expect(embeddingProvider.requests).toEqual([
      expect.objectContaining({
        owner: { type: 'user', id: 'admin-user-9' },
        promptType: 'knowledge-page-sync-embedding',
        promptVersion: pageEmbeddingInputBuilder.version,
      }),
    ]);
    expect(pageChunkRepository.chunks.size).toBe(1);
  });

  it('rejects page sync when no trusted admin actor user id is provided', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set('page-1', page());

    await expect(
      syncDocument(
        {
          pageRepository,
          pageChunkRepository,
          embeddingProvider,
          embeddingConfig,
          clock,
          generateId: () => 'page-chunk-1',
        },
        {
          pageId: 'page-1',
          actorAdminUserId: '',
          promptType: 'knowledge-page-sync-embedding',
        }
      )
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'actorAdminUserId is required for knowledge page sync embedding attribution',
      },
    });
  });

  it('persists failed sync state when the embedding provider throws', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider({
      error: new Error('embedding service unavailable'),
    });
    pageRepository.pages.set('page-1', page());

    const result = await syncDocument(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
        clock,
        generateId: () => 'page-chunk-1',
      },
      {
        pageId: 'page-1',
        actorAdminUserId: 'admin-user-9',
        promptType: 'knowledge-page-sync-embedding',
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: 'page-1',
        indexingStatus: 'failed',
        syncStatus: 'failed',
        indexingError: 'embedding service unavailable',
        syncError: 'embedding service unavailable',
      },
    });
    expect(pageRepository.pages.get('page-1')).toMatchObject({
      indexingStatus: 'failed',
      syncStatus: 'failed',
      indexingError: 'embedding service unavailable',
      syncError: 'embedding service unavailable',
    });
  });

  it('persists failed sync state when embedding metadata mismatches', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider({ responseProvider: 'openai' });
    pageRepository.pages.set('page-1', page());

    const result = await syncDocument(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
        clock,
        generateId: () => 'page-chunk-1',
      },
      {
        pageId: 'page-1',
        actorAdminUserId: 'admin-user-9',
        promptType: 'knowledge-page-sync-embedding',
      }
    );

    const mismatch =
      'Embedding provider response mismatch: requested openrouter qwen/qwen3-embedding-8b with 2048 dimensions, received openai qwen/qwen3-embedding-8b with 2048 dimensions.';
    expect(result).toEqual({
      ok: false,
      error: { code: 'EMBEDDING_FAILED', message: mismatch },
    });
    expect(pageRepository.pages.get('page-1')).toMatchObject({
      indexingStatus: 'failed',
      syncStatus: 'failed',
      indexingError: mismatch,
      syncError: mismatch,
    });
  });

  it('skips already-current pages during changed-only full sync', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'page-1',
      page({
        indexingStatus: 'ready',
        syncStatus: 'synced',
        accessSyncStatus: 'current',
        chunkCount: 1,
      })
    );
    pageRepository.pages.set('page-2', page({ id: 'page-2', nodeId: 'page-node-2' }));

    const result = await syncKnowledgeBase(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
        clock,
        generateId: (() => {
          let id = 0;
          return () => `page-chunk-${String(++id)}`;
        })(),
      },
      { actorAdminUserId: 'admin-user-9', mode: 'changed' }
    );

    expect(result).toEqual({
      ok: true,
      value: { synced: 1, failed: 0, skipped: 1 },
    });
  });

  it('reprocesses already-current pages during all-mode full sync', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set('page-1', readyPage());

    const result = await syncKnowledgeBase(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
        clock,
        generateId: () => 'page-chunk-1',
      },
      { actorAdminUserId: 'admin-user-9', mode: 'all' }
    );

    expect(result).toEqual({
      ok: true,
      value: { synced: 1, failed: 0, skipped: 0 },
    });
    expect(embeddingProvider.requests).toEqual([
      expect.objectContaining({
        promptType: 'knowledge-full-sync-embedding',
        owner: { type: 'user', id: 'admin-user-9' },
      }),
    ]);
  });

  it('retrieves page-backed citations with public-safe page metadata', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'page-1',
      page({
        indexingStatus: 'ready',
        syncStatus: 'synced',
        accessSyncStatus: 'current',
        chunkCount: 2,
      })
    );
    pageChunkRepository.chunks.set('page-chunk-1', pageChunk());
    pageChunkRepository.chunks.set(
      'page-chunk-2',
      pageChunk({
        id: 'page-chunk-2',
        index: 1,
        text: 'Keep the rig compact.',
        searchableText: 'Float Fishing Basics\n\nKeep the rig compact.',
      })
    );

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'float fishing basics',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        items: expectArrayContaining([
          expectObjectContaining({
            metadata: expectObjectContaining({
              headingPath: ['Float Fishing Basics'],
            }),
            sourceType: 'knowledge_page',
          }),
        ]),
      },
    });
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    expect(result.value.items[0]?.id).toMatch(/^knowledge-page:[a-f0-9]{24}$/u);
    expect(result.value.items[0]?.id).not.toContain('page-chunk-1');
    expect(result.value.items[0]?.metadata).not.toHaveProperty('documentId');
    expect(result.value.items[0]?.metadata).not.toHaveProperty('chunkId');
  });

  it('embeds follow-up queries with recent conversation context', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set('page-1', readyPage());
    pageChunkRepository.chunks.set('page-chunk-1', pageChunk());

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'A jakie komponenty procesu i wsparcia sa w tym samym opisie testowym?',
        conversationContext: {
          latestMessages: [
            { role: 'user', content: 'Opowiedz o opisie testowym Fixture Mix A.' },
            {
              role: 'assistant',
              content: 'Fixture Mix A zawiera baze oraz komponenty procesu i wsparcia.',
            },
          ],
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(embeddingProvider.requests[0]?.input).toContain(
      'A jakie komponenty procesu i wsparcia sa w tym samym opisie testowym?'
    );
    expect(embeddingProvider.requests[0]?.input).toContain('Fixture Mix A');
    expect(embeddingProvider.requests[0]?.input).toContain('komponenty procesu');
  });

  it('uses Polish query terms when reranking retrieved chunks', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'page-1',
      readyPage({ title: 'Karp', slug: 'karp', pathTitles: ['Knowledge Base', 'Karp'] })
    );
    pageChunkRepository.chunks.set(
      'carp-chunk',
      pageChunk({
        id: 'carp-chunk',
        title: 'Karp',
        path: ['Knowledge Base', 'Karp'],
        headingPath: ['Karp'],
        text: 'Karp lubi pellet i kukurydzę.',
        searchableText: 'Karp\n\nKarp lubi pellet i kukurydzę.',
      })
    );
    pageRepository.pages.set(
      'page-2',
      readyPage({
        id: 'page-2',
        nodeId: 'page-node-2',
        title: 'Płoć',
        slug: 'ploc',
        pathIds: ['root', 'category-1', 'section-1', 'page-node-2'],
        pathTitles: ['Knowledge Base', 'Płoć'],
      })
    );
    pageChunkRepository.chunks.set(
      'roach-chunk',
      pageChunk({
        id: 'roach-chunk',
        pageId: 'page-2',
        nodeId: 'page-node-2',
        title: 'Płoć',
        path: ['Knowledge Base', 'Płoć'],
        headingPath: ['Płoć'],
        text: 'Płoć reaguje na drobną zanętę i naturalne aromaty.',
        searchableText: 'Płoć\n\nPłoć reaguje na drobną zanętę i naturalne aromaty.',
      })
    );

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'płoć',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    expect(result.value.items[0]?.title).toBe('Płoć');
  });

  it('retrieves roach bait chunks for inflected larger-roach feeding queries when vector search misses them', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'off-topic-page',
      readyPage({
        id: 'off-topic-page',
        nodeId: 'off-topic-node',
        title: 'SWEET ADDITIVE A',
        slug: 'sweet-additive-a',
        pathIds: ['root', 'category-1', 'section-1', 'off-topic-node'],
        pathTitles: ['Knowledge Base', 'Boosters', 'SWEET ADDITIVE A'],
      })
    );
    const offTopicChunk = pageChunk({
      id: 'off-topic-chunk',
      pageId: 'off-topic-page',
      nodeId: 'off-topic-node',
      title: 'SWEET ADDITIVE A',
      path: ['Knowledge Base', 'Boosters', 'SWEET ADDITIVE A'],
      headingPath: ['SWEET ADDITIVE A'],
      text: 'Sweet additive A gives a neutral fixture signal.',
      searchableText: 'SWEET ADDITIVE A\n\nSweet additive A gives a neutral fixture signal.',
    });
    pageChunkRepository.chunks.set('off-topic-chunk', offTopicChunk);
    pageRepository.pages.set(
      'roach-location-page',
      readyPage({
        id: 'roach-location-page',
        nodeId: 'roach-location-node',
        title: 'Example Species Location A',
        slug: 'example-species-location-a',
        pathIds: ['root', 'category-1', 'section-1', 'roach-location-node'],
        pathTitles: [
          'Knowledge Base',
          'Freshwater species specification',
          'Roach',
          'Example Species Location A',
        ],
        chunkCount: 6,
      })
    );
    const roachLocationChunks = Array.from({ length: 6 }, (_value, index) =>
      pageChunk({
        id: `roach-location-chunk-${String(index)}`,
        index,
        pageId: 'roach-location-page',
        nodeId: 'roach-location-node',
        title: 'Example Species Location A',
        path: [
          'Knowledge Base',
          'Freshwater species specification',
          'Roach',
          'Example Species Location A',
        ],
        headingPath: ['Example Species Location A', `Spot ${String(index + 1)}`],
        text: 'Where to look for species A: zone one, zone two, zone three, zone four and slow current.',
        searchableText:
          'Example Species Location A\n\nWhere to look for species A: zone one, zone two, zone three, zone four and slow current.',
      })
    );
    for (const chunk of roachLocationChunks) {
      pageChunkRepository.chunks.set(chunk.id, chunk);
    }
    pageRepository.pages.set(
      'roach-bait-page',
      readyPage({
        id: 'roach-bait-page',
        nodeId: 'roach-bait-node',
        title: 'Example Mix A',
        slug: 'delicate-groundbait-for-roach',
        pathIds: ['root', 'category-1', 'section-1', 'roach-bait-node'],
        pathTitles: ['Knowledge Base', 'Float fishing', 'Example mix fixtures', 'Example Mix A'],
        chunkCount: 2,
      })
    );
    const roachBaseChunk = pageChunk({
      id: 'roach-base-chunk',
      pageId: 'roach-bait-page',
      nodeId: 'roach-bait-node',
      title: 'Example Mix A',
      path: ['Knowledge Base', 'Float fishing', 'Example mix fixtures', 'Example Mix A'],
      headingPath: ['Example Mix A', 'Base mix'],
      text: 'Ingredient A and ingredient B build a light fixture base for species A.',
      searchableText:
        'Example Mix A\n\nIngredient A and ingredient B build a light fixture base for species A.',
    });
    const roachAromaChunk = pageChunk({
      id: 'roach-aroma-chunk',
      pageId: 'roach-bait-page',
      nodeId: 'roach-bait-node',
      title: 'Example Mix A',
      path: ['Knowledge Base', 'Float fishing', 'Example mix fixtures', 'Example Mix A'],
      headingPath: ['Example Mix A', 'Aromas and boosters'],
      index: 1,
      text: 'For species A use component C, component D and component E; feed small fixture portions regularly.',
      searchableText:
        'Example Mix A\n\nFor species A use component C, component D and component E; feed small fixture portions regularly.',
    });
    pageChunkRepository.chunks.set('roach-base-chunk', roachBaseChunk);
    pageChunkRepository.chunks.set('roach-aroma-chunk', roachAromaChunk);
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(
        ok([
          { ...offTopicChunk, vectorScore: 0.99 },
          ...roachLocationChunks.map((chunk) => ({ ...chunk, vectorScore: 0.98 })),
        ])
      );

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'I want to target species A. Where to look and how to feed?',
        conversationContext: { latestMessages: [] },
        options: { topK: 4 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    const evidenceText = retrievedEvidenceText(result.value.items);
    expect(evidenceText).toContain('Ingredient A');
    expect(evidenceText).toContain('small fixture portions regularly');
  });

  it('retrieves method feeder parameter chunks before classic feeder chunks for production parameter queries', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'classic-feeder-page',
      readyPage({
        id: 'classic-feeder-page',
        nodeId: 'classic-feeder-node',
        title: 'Synthetic Classic Fixture',
        slug: 'synthetic-classic-fixture',
        pathIds: ['root', 'category-1', 'section-1', 'classic-feeder-node'],
        pathTitles: ['Knowledge Base', 'Feeder', 'Synthetic Classic Fixture'],
        chunkCount: 12,
      })
    );
    const classicChunks = Array.from({ length: 12 }, (_value, index) =>
      pageChunk({
        id: `classic-feeder-chunk-${String(index)}`,
        index,
        pageId: 'classic-feeder-page',
        nodeId: 'classic-feeder-node',
        title: 'Synthetic Classic Fixture',
        path: ['Knowledge Base', 'Feeder', 'Synthetic Classic Fixture'],
        headingPath: [
          'Synthetic Classic Fixture',
          `BASIC SYNTHETIC CLASSIC FIXTURE ${String(index + 1)}`,
        ],
        text:
          index === 0
            ? 'Classic fixture describes line B, component A, and component C.'
            : 'Klasyczny feeder ma element zestawu, koszyczek, krętlik i przypon zależny od warunków łowiska.',
        searchableText:
          'Synthetic Classic Fixture\n\nKlasyczny feeder ma element zestawu, koszyczek, krętlik i przypon zależny od warunków łowiska.',
      })
    );
    for (const chunk of classicChunks) {
      pageChunkRepository.chunks.set(chunk.id, chunk);
    }
    pageRepository.pages.set(
      'method-feeder-page',
      readyPage({
        id: 'method-feeder-page',
        nodeId: 'method-feeder-node',
        title: 'Synthetic Method Fixture A',
        slug: 'synthetic-method-fixture-a',
        pathIds: ['root', 'category-1', 'section-1', 'method-feeder-node'],
        pathTitles: ['Knowledge Base', 'Method feeder', 'Synthetic Method Fixture A'],
        chunkCount: 5,
      })
    );
    const methodChunks = [
      pageChunk({
        id: 'method-definition-chunk',
        pageId: 'method-feeder-page',
        nodeId: 'method-feeder-node',
        title: 'Synthetic Method Fixture A',
        path: ['Knowledge Base', 'Method feeder', 'Synthetic Method Fixture A'],
        headingPath: ['Synthetic Method Fixture A', 'Czym jest method feeder'],
        text: 'Synthetic method fixture describes a neutral relationship between component A and component B.',
        searchableText:
          'Synthetic Method Fixture A\n\nSynthetic method fixture describes a neutral relationship between component A and component B.',
      }),
      pageChunk({
        id: 'method-basket-chunk',
        index: 1,
        pageId: 'method-feeder-page',
        nodeId: 'method-feeder-node',
        title: 'Synthetic Method Fixture A',
        path: ['Knowledge Base', 'Method feeder', 'Synthetic Method Fixture A'],
        headingPath: ['Synthetic Method Fixture A', 'Waga koszyka'],
        text: 'Parameter A: 20-30 units for fixture condition A.',
        searchableText:
          'Synthetic Method Fixture A\n\nParameter A: 20-30 units for fixture condition A.',
      }),
      pageChunk({
        id: 'method-main-line-chunk',
        index: 2,
        pageId: 'method-feeder-page',
        nodeId: 'method-feeder-node',
        title: 'Synthetic Method Fixture A',
        path: ['Knowledge Base', 'Method feeder', 'Synthetic Method Fixture A'],
        headingPath: ['Synthetic Method Fixture A', 'B. Linka główna'],
        text: 'Parameter B: range 25-30 units or alternate range 12-18 units.',
        searchableText:
          'Synthetic Method Fixture A\n\nParameter B: range 25-30 units or alternate range 12-18 units.',
      }),
      pageChunk({
        id: 'method-hooklength-chunk',
        index: 3,
        pageId: 'method-feeder-page',
        nodeId: 'method-feeder-node',
        title: 'Synthetic Method Fixture A',
        path: ['Knowledge Base', 'Method feeder', 'Synthetic Method Fixture A'],
        headingPath: ['Synthetic Method Fixture A', 'Przypon'],
        text: 'Parameter C: range 5-15 units for fixture condition A.',
        searchableText:
          'Synthetic Method Fixture A\n\nParameter C: range 5-15 units for fixture condition A.',
      }),
      pageChunk({
        id: 'method-bait-chunk',
        index: 4,
        pageId: 'method-feeder-page',
        nodeId: 'method-feeder-node',
        title: 'Synthetic Method Fixture A',
        path: ['Knowledge Base', 'Method feeder', 'Synthetic Method Fixture A'],
        headingPath: ['Synthetic Method Fixture A', 'Przynęty i zanęta'],
        text: 'Component D works with smaller fixture items and cohesive samples.',
        searchableText:
          'Synthetic Method Fixture A\n\nComponent D works with smaller fixture items and cohesive samples.',
      }),
    ];
    for (const chunk of methodChunks) {
      pageChunkRepository.chunks.set(chunk.id, chunk);
    }
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(
        ok([
          ...classicChunks.map((chunk) => ({ ...chunk, vectorScore: 0.99 })),
          ...methodChunks.map((chunk) => ({ ...chunk, vectorScore: 0.6 })),
        ])
      );

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query:
          'Skladam zestaw method feeder na wode stojaca. Jakie podstawowe parametry ma podac agent?',
        conversationContext: { latestMessages: [] },
        options: { topK: 8 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    const evidenceText = retrievedEvidenceText(result.value.items.slice(0, 8));
    expect(evidenceText).toContain('20-30 units');
    expect(evidenceText).toContain('25-30 units');
    expect(evidenceText).toContain('5-15 units');
    expect(evidenceText).toContain('Component D');
  });

  it('retrieves both classic feeder and method feeder evidence for explicit comparison queries', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'classic-feeder-page',
      readyPage({
        id: 'classic-feeder-page',
        nodeId: 'classic-feeder-node',
        title: 'Synthetic Classic Fixture',
        slug: 'synthetic-classic-fixture',
        pathIds: ['root', 'category-1', 'section-1', 'classic-feeder-node'],
        pathTitles: ['Knowledge Base', 'Feeder', 'Synthetic Classic Fixture'],
        chunkCount: 3,
      })
    );
    const classicChunks = [
      pageChunk({
        id: 'classic-rig-chunk',
        pageId: 'classic-feeder-page',
        nodeId: 'classic-feeder-node',
        title: 'Synthetic Classic Fixture',
        path: ['Knowledge Base', 'Feeder', 'Synthetic Classic Fixture'],
        headingPath: ['Synthetic Classic Fixture', 'Montaż zestawu'],
        text: 'Place component A on line B, then add component C, component D, and component E.',
        searchableText:
          'Synthetic Classic Fixture\n\nPlace component A on line B, then add component C, component D, and component E.',
      }),
      pageChunk({
        id: 'classic-general-chunk',
        index: 1,
        pageId: 'classic-feeder-page',
        nodeId: 'classic-feeder-node',
        title: 'Synthetic Classic Fixture',
        path: ['Knowledge Base', 'Feeder', 'Synthetic Classic Fixture'],
        headingPath: ['Synthetic Classic Fixture', 'Elementy'],
        text: 'Classic fixture uses component C, component D, and component E depending on condition A.',
        searchableText:
          'Synthetic Classic Fixture\n\nClassic fixture uses component C, component D, and component E depending on condition A.',
      }),
    ];
    for (const chunk of classicChunks) {
      pageChunkRepository.chunks.set(chunk.id, chunk);
    }
    pageRepository.pages.set(
      'method-feeder-page',
      readyPage({
        id: 'method-feeder-page',
        nodeId: 'method-feeder-node',
        title: 'Synthetic Method Fixture A',
        slug: 'synthetic-method-fixture-a',
        pathIds: ['root', 'category-1', 'section-1', 'method-feeder-node'],
        pathTitles: ['Knowledge Base', 'Method feeder', 'Synthetic Method Fixture A'],
        chunkCount: 4,
      })
    );
    const methodChunks = [
      pageChunk({
        id: 'method-definition-chunk',
        pageId: 'method-feeder-page',
        nodeId: 'method-feeder-node',
        title: 'Synthetic Method Fixture A',
        path: ['Knowledge Base', 'Method feeder', 'Synthetic Method Fixture A'],
        headingPath: ['Synthetic Method Fixture A', 'Czym jest method feeder'],
        text: 'Synthetic method fixture describes a neutral relationship between component A and component B.',
        searchableText:
          'Synthetic Method Fixture A\n\nSynthetic method fixture describes a neutral relationship between component A and component B.',
      }),
      pageChunk({
        id: 'method-basket-chunk',
        index: 1,
        pageId: 'method-feeder-page',
        nodeId: 'method-feeder-node',
        title: 'Synthetic Method Fixture A',
        path: ['Knowledge Base', 'Method feeder', 'Synthetic Method Fixture A'],
        headingPath: ['Synthetic Method Fixture A', 'Waga koszyka'],
        text: 'Parameter A: 20-30 units for fixture condition A.',
        searchableText:
          'Synthetic Method Fixture A\n\nParameter A: 20-30 units for fixture condition A.',
      }),
      pageChunk({
        id: 'method-hooklength-chunk',
        index: 2,
        pageId: 'method-feeder-page',
        nodeId: 'method-feeder-node',
        title: 'Synthetic Method Fixture A',
        path: ['Knowledge Base', 'Method feeder', 'Synthetic Method Fixture A'],
        headingPath: ['Synthetic Method Fixture A', 'Przypon'],
        text: 'Parameter C: range 5-15 units for fixture condition A.',
        searchableText:
          'Synthetic Method Fixture A\n\nParameter C: range 5-15 units for fixture condition A.',
      }),
      pageChunk({
        id: 'method-bait-chunk',
        index: 3,
        pageId: 'method-feeder-page',
        nodeId: 'method-feeder-node',
        title: 'Synthetic Method Fixture A',
        path: ['Knowledge Base', 'Method feeder', 'Synthetic Method Fixture A'],
        headingPath: ['Synthetic Method Fixture A', 'Przynęty i zanęta'],
        text: 'Component D works with smaller fixture items and cohesive samples.',
        searchableText:
          'Synthetic Method Fixture A\n\nComponent D works with smaller fixture items and cohesive samples.',
      }),
    ];
    for (const chunk of methodChunks) {
      pageChunkRepository.chunks.set(chunk.id, chunk);
    }
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(
        ok([
          ...methodChunks.map((chunk) => ({ ...chunk, vectorScore: 0.99 })),
          ...classicChunks.map((chunk) => ({ ...chunk, vectorScore: 0.1 })),
        ])
      );

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-7',
          role: 'user',
          status: 'approved',
          effectiveLevel: 7,
        },
        query:
          'Jak złożyć klasyczny zestaw feeder i czym różni się od method feeder? Odpowiedz krótko, praktycznie.',
        conversationContext: { latestMessages: [] },
        options: { topK: 4 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    expect(result.value.items.map((item) => item.quote)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Place component A'),
        expect.stringContaining('neutral relationship'),
      ])
    );
  });

  it('anchors direct sandacz habitat follow-ups to sandacz evidence instead of prior refusal context', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'sandacz-page',
      readyPage({
        id: 'sandacz-page',
        nodeId: 'sandacz-node',
        title: 'Sandacz - gdzie go szukac',
        slug: 'sandacz-gdzie-go-szukac',
        pathIds: ['root', 'category-1', 'section-1', 'sandacz-node'],
        pathTitles: ['Knowledge Base', 'Drapiezniki', 'Sandacz - gdzie go szukac'],
      })
    );
    const sandaczChunk = pageChunk({
      id: 'sandacz-chunk',
      pageId: 'sandacz-page',
      nodeId: 'sandacz-node',
      title: 'Sandacz - gdzie go szukac',
      path: ['Knowledge Base', 'Drapiezniki', 'Sandacz - gdzie go szukac'],
      headingPath: ['Sandacz', 'Gdzie go szukac'],
      text: 'Sandacza szukaj przy twardym dnie, stokach, opaskach, kamienistych blatach i przy spadach.',
      searchableText:
        'Sandacz - gdzie go szukac\n\nSandacza szukaj przy twardym dnie, stokach, opaskach, kamienistych blatach i przy spadach.',
    });
    pageChunkRepository.chunks.set('sandacz-chunk', sandaczChunk);
    pageRepository.pages.set(
      'refusal-context-page',
      readyPage({
        id: 'refusal-context-page',
        nodeId: 'refusal-context-node',
        title: 'Odmowa prawna bez danych',
        slug: 'odmowa-prawna-bez-danych',
        pathIds: ['root', 'category-1', 'section-1', 'refusal-context-node'],
        pathTitles: ['Knowledge Base', 'Regulamin', 'Odmowa prawna bez danych'],
      })
    );
    const refusalContextChunk = pageChunk({
      id: 'refusal-context-chunk',
      pageId: 'refusal-context-page',
      nodeId: 'refusal-context-node',
      title: 'Odmowa prawna bez danych',
      path: ['Knowledge Base', 'Regulamin', 'Odmowa prawna bez danych'],
      headingPath: ['Braki w danych prawnych'],
      text: 'Czy moge zabrac sandacza? Nie mam danych prawnych w bazie i nie odpowiadam o limitach.',
      searchableText:
        'Odmowa prawna bez danych\n\nCzy moge zabrac sandacza? Nie mam danych prawnych w bazie i nie odpowiadam o limitach.',
    });
    pageChunkRepository.chunks.set('refusal-context-chunk', refusalContextChunk);
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(
        ok([
          { ...refusalContextChunk, vectorScore: 0.95 },
          { ...sandaczChunk, vectorScore: 0.6 },
        ])
      );

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-1',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'Czyli z bazy powiedz tylko, gdzie szukac sandacza.',
        conversationContext: {
          latestMessages: [
            { role: 'user', content: 'Czy moge zabrac sandacza?' },
            { role: 'assistant', content: 'Nie mam danych prawnych w bazie.' },
          ],
        },
        options: { topK: 2 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    expect(result.value.items[0]?.title).toBe('Sandacz - gdzie go szukac');
  });

  it('expands named species pages for biology follow-ups after non-knowledge legal context', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();

    pageRepository.pages.set(
      'sandacz-page',
      readyPage({
        id: 'sandacz-page',
        nodeId: 'sandacz-node',
        title: 'Sandacz (Sander lucioperca)',
        slug: 'sandacz-sander-lucioperca',
        chunkCount: 3,
        pathIds: ['root', 'category-1', 'section-1', 'sandacz-node'],
        pathTitles: ['Knowledge Base', 'Drapiezniki', 'Sandacz (Sander lucioperca)'],
      })
    );
    const sandaczHabitatChunk = pageChunk({
      id: 'sandacz-habitat-chunk',
      pageId: 'sandacz-page',
      nodeId: 'sandacz-node',
      title: 'Sandacz (Sander lucioperca)',
      path: ['Knowledge Base', 'Drapiezniki', 'Sandacz (Sander lucioperca)'],
      headingPath: ['Sandacz (Sander lucioperca)', 'Naturalne środowisko'],
      index: 0,
      text: 'Sandacz wybiera głębokie, dobrze natlenione wody oraz twarde, kamieniste lub żwirowe dno.',
      searchableText:
        'Sandacz (Sander lucioperca)\n\nSandacz wybiera głębokie, dobrze natlenione wody oraz twarde, kamieniste lub żwirowe dno.',
    });
    const sandaczDietChunk = pageChunk({
      id: 'sandacz-diet-chunk',
      pageId: 'sandacz-page',
      nodeId: 'sandacz-node',
      title: 'Sandacz (Sander lucioperca)',
      path: ['Knowledge Base', 'Drapiezniki', 'Sandacz (Sander lucioperca)'],
      headingPath: ['Sandacz (Sander lucioperca)', 'Żerowanie'],
      index: 1,
      text: 'Dieta sandacza opiera się na narybku i drobnych rybach, a półmrok pomaga mu polować.',
      searchableText:
        'Sandacz (Sander lucioperca)\n\nDieta sandacza opiera się na narybku i drobnych rybach, a półmrok pomaga mu polować.',
    });
    const sandaczSpawnChunk = pageChunk({
      id: 'sandacz-spawn-chunk',
      pageId: 'sandacz-page',
      nodeId: 'sandacz-node',
      title: 'Sandacz (Sander lucioperca)',
      path: ['Knowledge Base', 'Drapiezniki', 'Sandacz (Sander lucioperca)'],
      headingPath: ['Sandacz (Sander lucioperca)', 'Cykl życia'],
      index: 2,
      text: 'Tarło sandacza przypada zwykle na maj i czerwiec, gdy samiec pilnuje ikry na twardym podłożu.',
      searchableText:
        'Sandacz (Sander lucioperca)\n\nTarło sandacza przypada zwykle na maj i czerwiec, gdy samiec pilnuje ikry na twardym podłożu.',
    });
    pageChunkRepository.chunks.set(sandaczHabitatChunk.id, sandaczHabitatChunk);
    pageChunkRepository.chunks.set(sandaczDietChunk.id, sandaczDietChunk);
    pageChunkRepository.chunks.set(sandaczSpawnChunk.id, sandaczSpawnChunk);

    pageRepository.pages.set(
      'general-biology-page',
      readyPage({
        id: 'general-biology-page',
        nodeId: 'general-biology-node',
        title: 'Biologia wody',
        slug: 'biologia-wody',
        pathIds: ['root', 'category-1', 'section-1', 'general-biology-node'],
        pathTitles: ['Knowledge Base', 'Środowisko', 'Biologia wody'],
      })
    );
    const generalBiologyChunk = pageChunk({
      id: 'general-biology-chunk',
      pageId: 'general-biology-page',
      nodeId: 'general-biology-node',
      title: 'Biologia wody',
      path: ['Knowledge Base', 'Środowisko', 'Biologia wody'],
      headingPath: ['Biologia wody'],
      text: 'Bakterie, tlen i praca dna wpływają na wszystkie ryby, ale to nie jest profil gatunku.',
      searchableText:
        'Biologia wody\n\nBakterie, tlen i praca dna wpływają na wszystkie ryby, ale to nie jest profil gatunku.',
    });
    pageChunkRepository.chunks.set(generalBiologyChunk.id, generalBiologyChunk);
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(
        ok([
          { ...generalBiologyChunk, vectorScore: 0.98 },
          { ...sandaczHabitatChunk, vectorScore: 0.62 },
        ])
      );

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-1',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'Bez regulaminu: co mówi biologia sandacza i co z tego wynika nad wodą?',
        conversationContext: {
          latestMessages: [
            { role: 'user', content: 'Czy mogę zabrać sandacza z tego łowiska?' },
            { role: 'assistant', content: 'Baza nie zawiera aktualnych danych prawnych.' },
          ],
        },
        options: { topK: 4 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    expect(result.value.diagnostics.expandedItemCount).toBeGreaterThan(0);
    const evidenceText = retrievedEvidenceText(result.value.items);
    expect(evidenceText).toContain('drobnych rybach');
    expect(evidenceText).toContain('Tarło sandacza');
  });

  it('does not boost generic method headings above stronger current-query evidence', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'spring-habitat-page',
      readyPage({
        id: 'spring-habitat-page',
        nodeId: 'spring-habitat-node',
        title: 'Stanowiska sezonowe',
        slug: 'stanowiska-sezonowe',
        pathIds: ['root', 'category-1', 'section-1', 'spring-habitat-node'],
        pathTitles: ['Knowledge Base', 'Siedliska', 'Stanowiska sezonowe'],
      })
    );
    const springHabitatChunk = pageChunk({
      id: 'spring-habitat-chunk',
      pageId: 'spring-habitat-page',
      nodeId: 'spring-habitat-node',
      title: 'Stanowiska sezonowe',
      path: ['Knowledge Base', 'Siedliska', 'Stanowiska sezonowe'],
      headingPath: ['Płytkie zatoki'],
      text: 'Wiosną ostrożne ryby stoją przy roślinności i w cieplejszych płytkich zatokach.',
      searchableText:
        'Stanowiska sezonowe\n\nWiosną ostrożne ryby stoją przy roślinności i w cieplejszych płytkich zatokach.',
    });
    pageChunkRepository.chunks.set('spring-habitat-chunk', springHabitatChunk);
    pageRepository.pages.set(
      'generic-method-page',
      readyPage({
        id: 'generic-method-page',
        nodeId: 'generic-method-node',
        title: 'Metoda',
        slug: 'metoda',
        pathIds: ['root', 'category-1', 'section-1', 'generic-method-node'],
        pathTitles: ['Knowledge Base', 'Poradniki', 'Metoda'],
      })
    );
    const genericMethodChunk = pageChunk({
      id: 'generic-method-chunk',
      pageId: 'generic-method-page',
      nodeId: 'generic-method-node',
      title: 'Metoda',
      path: ['Knowledge Base', 'Poradniki', 'Metoda'],
      headingPath: ['Jak lowic'],
      text: 'Ten rozdzial omawia format zapisu i ogolne zasady pracy z notatkami.',
      searchableText:
        'Metoda\n\nTen rozdzial omawia format zapisu i ogolne zasady pracy z notatkami.',
    });
    pageChunkRepository.chunks.set('generic-method-chunk', genericMethodChunk);
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(
        ok([
          { ...springHabitatChunk, vectorScore: 0.95 },
          { ...genericMethodChunk, vectorScore: 0.6 },
        ])
      );

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-1',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'Jak lowic metoda na ostrozne ryby przy roslinnosci wiosna?',
        conversationContext: { latestMessages: [] },
        options: { topK: 2 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    expect(result.value.items[0]?.title).toBe('Stanowiska sezonowe');
  });

  it('adds lexical candidates for inflected Polish page title queries when vector search misses them', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'page-1',
      readyPage({
        title: 'Product A',
        slug: 'product-a',
        pathTitles: ['Knowledge Base', 'Product A'],
      })
    );
    pageChunkRepository.chunks.set(
      'product-a-chunk',
      pageChunk({
        id: 'product-a-chunk',
        title: 'Product A',
        path: ['Knowledge Base', 'tested products', 'Product A'],
        headingPath: ['Product A'],
        text: 'Checking product composition, pellets and behavior in water.',
        searchableText: 'Product A\n\nChecking product composition, pellets and behavior in water.',
      })
    );
    pageRepository.pages.set(
      'page-2',
      readyPage({
        id: 'page-2',
        nodeId: 'page-node-2',
        title: 'Fixture Mix A',
        slug: 'fixture-mix-a',
        pathIds: ['root', 'category-1', 'section-1', 'page-node-2'],
        pathTitles: ['Knowledge Base', 'Method feeder', 'Sekcja testowa', 'Fixture Mix A'],
      })
    );
    pageChunkRepository.chunks.set(
      'zaneta-chunk',
      pageChunk({
        id: 'zaneta-chunk',
        pageId: 'page-2',
        nodeId: 'page-node-2',
        title: 'Fixture Mix A',
        path: ['Knowledge Base', 'Method feeder', 'Sekcja testowa', 'Fixture Mix A'],
        headingPath: ['Fixture Mix A', 'Składniki bazy'],
        text: 'Base fixture includes ingredient A, ingredient B, ingredient C, ingredient D, ingredient E and ingredient F.',
        searchableText:
          'Fixture Mix A\n\nBase fixture includes ingredient A, ingredient B, ingredient C, ingredient D, ingredient E and ingredient F.',
      })
    );
    const productAChunk = pageChunkRepository.chunks.get('product-a-chunk');
    if (productAChunk === undefined) {
      throw new Error('Expected Product A chunk fixture to exist');
    }
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(ok([{ ...productAChunk, vectorScore: 0.99 }]));

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query:
          'Kiedy i dlaczego warto użyć zanęty delikatnej w method feederze? Podaj też najważniejsze składniki bazy.',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    expect(result.value.items[0]?.title).toBe('Fixture Mix A');
    expect(result.value.items[0]?.quote).toContain('ingredient A');
  });

  it('retrieves lexical matches from projected candidates without embedding fields', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'page-1',
      readyPage({
        title: 'Fixture Mix A',
        slug: 'fixture-mix-a',
        pathTitles: ['Knowledge Base', 'Method feeder', 'Sekcja testowa', 'Fixture Mix A'],
      })
    );
    const lexicalChunk = pageChunk({
      id: 'zaneta-chunk',
      title: 'Fixture Mix A',
      path: ['Knowledge Base', 'Method feeder', 'Sekcja testowa', 'Fixture Mix A'],
      headingPath: ['Fixture Mix A', 'Składniki bazy'],
      text: 'Baza zawiera ingredient A i 150 g zmielonej kukurydzy.',
      searchableText: 'Fixture Mix A\n\nBaza zawiera ingredient A i 150 g zmielonej kukurydzy.',
    });
    pageChunkRepository.chunks.set('zaneta-chunk', lexicalChunk);
    const offTopicChunk = pageChunk({
      id: 'off-topic-chunk',
      pageId: 'page-2',
      nodeId: 'page-node-2',
      title: 'Product A',
      path: ['Knowledge Base', 'tested products', 'Product A'],
      headingPath: ['Product A'],
      text: 'Checking product composition, pellets and behavior in water.',
      searchableText: 'Product A\n\nChecking product composition, pellets and behavior in water.',
    });
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(ok([{ ...offTopicChunk, vectorScore: 0.99 }]));
    vi.spyOn(pageChunkRepository, 'listRetrievableActive').mockRejectedValue(
      new Error('retrieveKnowledge should not scan full retrieval chunks for lexical candidates')
    );
    const {
      embedding: _embedding,
      embeddingModel: _embeddingModel,
      embeddingProvider: _embeddingProvider,
      embeddingDimensions: _embeddingDimensions,
      ...projectedLexicalChunk
    } = lexicalChunk;
    vi.spyOn(pageChunkRepository, 'listRetrievableActiveLexicalCandidates').mockResolvedValue(
      ok({
        chunks: [projectedLexicalChunk],
        scannedCount: 1,
        limitHit: false,
      })
    );

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query:
          'Kiedy i dlaczego warto użyć zanęty delikatnej w method feederze? Podaj też najważniejsze składniki bazy.',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    expect(result.value.items[0]?.title).toBe('Fixture Mix A');
    expect(result.value.items[0]?.quote).toContain('ingredient A');
  });

  it('keeps intent-boosted delicate method recipe chunks in lexical candidate selection', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();

    for (let index = 0; index < 70; index += 1) {
      const pageId = `generic-method-page-${String(index)}`;
      const nodeId = `generic-method-node-${String(index)}`;
      pageRepository.pages.set(
        pageId,
        readyPage({
          id: pageId,
          nodeId,
          title: 'Zestaw Method Feeder',
          slug: `zestaw-method-feeder-${String(index)}`,
          pathIds: ['root', 'category-1', 'section-1', nodeId],
          pathTitles: ['Knowledge Base', 'Method feeder', 'Zestaw Method Feeder'],
        })
      );
      pageChunkRepository.chunks.set(
        `generic-method-chunk-${String(index)}`,
        pageChunk({
          id: `generic-method-chunk-${String(index)}`,
          pageId,
          nodeId,
          title: 'Zestaw Method Feeder',
          path: ['Knowledge Base', 'Method feeder', 'Zestaw Method Feeder'],
          headingPath: ['Zestaw Method Feeder'],
          text: 'Daj delikatna zanete method feeder okolo 22 stopnie z najwazniejszymi ilosciami: koszyk, linka i ogolna praca zanety.',
          searchableText:
            'Zestaw Method Feeder\n\nDaj delikatna zanete method feeder okolo 22 stopnie z najwazniejszymi ilosciami: koszyk, linka i ogolna praca zanety.',
        })
      );
    }

    pageRepository.pages.set(
      'zaneta-page',
      readyPage({
        id: 'zaneta-page',
        title: 'Fixture Mix A',
        slug: 'fixture-mix-a',
        pathTitles: ['Knowledge Base', 'Method feeder', 'Sekcja testowa', 'Fixture Mix A'],
        chunkCount: 4,
      })
    );
    const recipeChunks = [
      pageChunk({
        id: 'zaneta-intro',
        pageId: 'zaneta-page',
        title: 'Fixture Mix A',
        path: ['Knowledge Base', 'Method feeder', 'Sekcja testowa', 'Fixture Mix A'],
        headingPath: ['Fixture Mix A'],
        text: 'Ta zanęta spisuje się gdy woda ma temperaturę w granicach 22 stopni i ryby stają się ostrożne.',
        searchableText:
          'Fixture Mix A\n\nTa zanęta spisuje się gdy woda ma temperaturę w granicach 22 stopni i ryby stają się ostrożne.',
      }),
      pageChunk({
        id: 'zaneta-base',
        pageId: 'zaneta-page',
        index: 1,
        title: 'Fixture Mix A',
        path: ['Knowledge Base', 'Method feeder', 'Sekcja testowa', 'Fixture Mix A'],
        headingPath: ['Fixture Mix A', 'Baza strukturalna i objętościowa'],
        text: 'Base fixture includes ingredient A, ingredient B, ingredient C, ingredient D, ingredient E and ingredient F.',
        searchableText:
          'Fixture Mix A\n\nBase fixture includes ingredient A, ingredient B, ingredient C, ingredient D, ingredient E and ingredient F.',
      }),
      pageChunk({
        id: 'zaneta-ferment',
        pageId: 'zaneta-page',
        index: 2,
        title: 'Fixture Mix A',
        path: ['Knowledge Base', 'Method feeder', 'Sekcja testowa', 'Fixture Mix A'],
        headingPath: ['Fixture Mix A', 'Fermentacja i sygnał chemiczny'],
        text: 'Add processed ingredient A, Liquid Additive Bravo and starter C.',
        searchableText:
          'Fixture Mix A\n\nAdd processed ingredient A, Liquid Additive Bravo and starter C.',
      }),
      pageChunk({
        id: 'zaneta-herbs',
        pageId: 'zaneta-page',
        index: 3,
        title: 'Fixture Mix A',
        path: ['Knowledge Base', 'Method feeder', 'Sekcja testowa', 'Fixture Mix A'],
        headingPath: ['Fixture Mix A', 'Zioła - wyciszenie i naturalność'],
        text: 'Support fixture includes component D, component E and component F.',
        searchableText:
          'Fixture Mix A\n\nSupport fixture includes component D, component E and component F.',
      }),
    ];
    for (const chunk of recipeChunks) {
      pageChunkRepository.chunks.set(chunk.id, chunk);
    }
    const genericMethodChunk = pageChunkRepository.chunks.get('generic-method-chunk-0');
    if (genericMethodChunk === undefined) {
      throw new Error('Expected generic method chunk fixture');
    }
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(ok([{ ...genericMethodChunk, vectorScore: 0.99 }]));

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-7',
          role: 'user',
          status: 'approved',
          effectiveLevel: 7,
        },
        query: 'Pokaz neutralny przyklad testowy z najwazniejszymi parametrami.',
        conversationContext: { latestMessages: [] },
        options: { topK: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    const evidenceText = retrievedEvidenceText(result.value.items);
    expect(evidenceText).toContain('ingredient A');
    expect(evidenceText).toContain('Liquid Additive Bravo');
    expect(evidenceText).toContain('component D');
  });

  it('keeps both species pages for comparison queries when vector search is generic', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();

    for (let index = 0; index < 70; index += 1) {
      const pageId = `generic-species-page-${String(index)}`;
      const nodeId = `generic-species-node-${String(index)}`;
      pageRepository.pages.set(
        pageId,
        readyPage({
          id: pageId,
          nodeId,
          title: 'Ogólne łowienie ryb spokojnego żeru',
          slug: `ogolne-lowienie-${String(index)}`,
          pathIds: ['root', 'category-1', 'section-1', nodeId],
          pathTitles: ['Knowledge Base', 'Gatunki', 'Ogólne łowienie'],
        })
      );
      pageChunkRepository.chunks.set(
        `generic-species-chunk-${String(index)}`,
        pageChunk({
          id: `generic-species-chunk-${String(index)}`,
          pageId,
          nodeId,
          title: 'Ogólne łowienie ryb spokojnego żeru',
          path: ['Knowledge Base', 'Gatunki', 'Ogólne łowienie'],
          headingPath: ['Ogólne łowienie ryb spokojnego żeru'],
          text: 'Porównaj gdzie ich szukać, czym nęcić i kiedy podchodzić ostrożnie. To ogólne wskazówki bez konkretnego gatunku.',
          searchableText:
            'Ogólne łowienie ryb spokojnego żeru\n\nPorównaj gdzie ich szukać, czym nęcić i kiedy podchodzić ostrożnie. To ogólne wskazówki bez konkretnego gatunku.',
        })
      );
    }

    pageRepository.pages.set(
      'bream-page',
      readyPage({
        id: 'bream-page',
        nodeId: 'bream-node',
        title: 'Leszcz (Abramis brama)',
        slug: 'leszcz-abramis-brama',
        pathIds: ['root', 'category-1', 'section-1', 'bream-node'],
        pathTitles: ['Knowledge Base', 'Section 2', 'Cyprinids and relatives', 'Leszcz'],
      })
    );
    pageRepository.pages.set(
      'roach-page',
      readyPage({
        id: 'roach-page',
        nodeId: 'roach-node',
        title: 'Płoć (Rutilus rutilus)',
        slug: 'ploc-rutilus-rutilus',
        pathIds: ['root', 'category-1', 'section-1', 'roach-node'],
        pathTitles: ['Knowledge Base', 'Section 2', 'Cyprinids and relatives', 'Płoć'],
      })
    );
    const breamChunk = pageChunk({
      id: 'bream-chunk',
      pageId: 'bream-page',
      nodeId: 'bream-node',
      title: 'Leszcz (Abramis brama)',
      path: ['Knowledge Base', 'Section 2', 'Cyprinids and relatives', 'Leszcz'],
      headingPath: ['Leszcz (Abramis brama)'],
      text: 'Species B uses zone A, zone B, zone C and zone D. Larger samples remain cautious.',
      searchableText:
        'Leszcz (Abramis brama)\n\nSpecies B uses zone A, zone B, zone C and zone D. Larger samples remain cautious.',
    });
    const roachChunk = pageChunk({
      id: 'roach-chunk',
      pageId: 'roach-page',
      nodeId: 'roach-node',
      title: 'Płoć (Rutilus rutilus)',
      path: ['Knowledge Base', 'Section 2', 'Cyprinids and relatives', 'Płoć'],
      headingPath: ['Płoć (Rutilus rutilus)'],
      text: 'Płoć wybiera wody stojące lub wolno płynące, piaszczysto-mułowe dno i roślinność. Skuteczne jest drobne nęcenie i naturalne aromaty.',
      searchableText:
        'Płoć (Rutilus rutilus)\n\nPłoć wybiera wody stojące lub wolno płynące, piaszczysto-mułowe dno i roślinność. Skuteczne jest drobne nęcenie i naturalne aromaty.',
    });
    pageChunkRepository.chunks.set(breamChunk.id, breamChunk);
    pageChunkRepository.chunks.set(roachChunk.id, roachChunk);
    const genericSpeciesChunk = pageChunkRepository.chunks.get('generic-species-chunk-0');
    if (genericSpeciesChunk === undefined) {
      throw new Error('Expected generic species chunk fixture');
    }
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(ok([{ ...genericSpeciesChunk, vectorScore: 0.99 }]));

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-7',
          role: 'user',
          status: 'approved',
          effectiveLevel: 7,
        },
        query:
          'Porównaj leszcza i płoć: gdzie ich szukać, czym nęcić i kiedy podchodzić ostrożnie?',
        conversationContext: { latestMessages: [] },
        options: { topK: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    expect(result.value.items.map((item) => item.title)).toEqual(
      expect.arrayContaining(['Leszcz (Abramis brama)', 'Płoć (Rutilus rutilus)'])
    );
  });

  it('retrieves all named wafters recipe pages for a comparison query', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();

    pageRepository.pages.set(
      'generic-wafters-page',
      readyPage({
        id: 'generic-wafters-page',
        nodeId: 'generic-wafters-node',
        title: 'Ogólne waftersy',
        slug: 'ogolne-waftersy',
        pathIds: ['root', 'category-1', 'section-1', 'generic-wafters-node'],
        pathTitles: ['Knowledge Base', 'Method feeder', 'Przynęty', 'Ogólne waftersy'],
      })
    );
    const genericChunk = pageChunk({
      id: 'generic-wafters-chunk',
      pageId: 'generic-wafters-page',
      nodeId: 'generic-wafters-node',
      title: 'Ogólne waftersy',
      path: ['Knowledge Base', 'Method feeder', 'Przynęty', 'Ogólne waftersy'],
      headingPath: ['Ogólne waftersy'],
      text: 'Wafters musi być neutralny lub lekko aminokwasowy, ale to nie jest konkretny przepis.',
      searchableText:
        'Ogólne waftersy\n\nWafters musi być neutralny lub lekko aminokwasowy, ale to nie jest konkretny przepis.',
    });
    pageChunkRepository.chunks.set(genericChunk.id, genericChunk);

    const recipes = [
      {
        pageId: 'white-worm-page',
        nodeId: 'white-worm-node',
        title: 'Example Wafter A',
        slug: 'example-wafter-a',
        text: 'Example Wafter A: component A, forming step, heat step and dry step.',
      },
      {
        pageId: 'bloodworm-page',
        nodeId: 'bloodworm-node',
        title: 'Example Wafter B',
        slug: 'example-wafter-b',
        text: 'Example Wafter B: component B, forming step, heat step and dry step.',
      },
      {
        pageId: 'cloud-effect-page',
        nodeId: 'cloud-effect-node',
        title: 'Example Wafter C',
        slug: 'example-wafter-c',
        text: 'Example Wafter C: component C, forming step, heat step and dry step.',
      },
    ] as const;

    for (const recipe of recipes) {
      pageRepository.pages.set(
        recipe.pageId,
        readyPage({
          id: recipe.pageId,
          nodeId: recipe.nodeId,
          title: recipe.title,
          slug: recipe.slug,
          pathIds: ['root', 'category-1', 'section-1', recipe.nodeId],
          pathTitles: ['Knowledge Base', 'Method feeder', 'przepisy waftersy', recipe.title],
        })
      );
      pageChunkRepository.chunks.set(
        `${recipe.pageId}-chunk`,
        pageChunk({
          id: `${recipe.pageId}-chunk`,
          pageId: recipe.pageId,
          nodeId: recipe.nodeId,
          title: recipe.title,
          path: ['Knowledge Base', 'Method feeder', 'przepisy waftersy', recipe.title],
          headingPath: [recipe.title],
          text: recipe.text,
          searchableText: `${recipe.title}\n\n${recipe.text}`,
        })
      );
    }

    const saturatedVectorMatches: KnowledgePageChunkMatch[] = [];
    for (let index = 0; index < 160; index += 1) {
      const indexLabel = String(index);
      const recipe = index % 2 === 0 ? recipes[0] : recipes[2];
      const chunk = pageChunk({
        id: `${recipe.pageId}-saturated-${indexLabel}`,
        pageId: recipe.pageId,
        nodeId: recipe.nodeId,
        title: recipe.title,
        path: ['Knowledge Base', 'Method feeder', 'przepisy waftersy', recipe.title],
        headingPath: [recipe.title, `Fragment ${indexLabel}`],
        index: index + 1,
        text: `${recipe.text} Porównanie wafters i dobór przynęty ${indexLabel}.`,
        searchableText: `${recipe.title}\n\n${recipe.text}\n\nPorównanie wafters i dobór przynęty ${indexLabel}.`,
      });
      pageChunkRepository.chunks.set(chunk.id, chunk);
      saturatedVectorMatches.push({ ...chunk, vectorScore: 10 - index * 0.01 });
    }
    const ochotkaPreparationChunk = pageChunk({
      id: 'bloodworm-page-preparation',
      pageId: 'bloodworm-page',
      nodeId: 'bloodworm-node',
      title: 'Example Wafter B',
      path: ['Knowledge Base', 'Method feeder', 'przepisy waftersy', 'Example Wafter B'],
      headingPath: ['Example Wafter B', 'How to make?'],
      index: 1,
      text: 'Example Wafter B: dry ingredients into one container, liquids separately, then knead and form balls.',
      searchableText:
        'Example Wafter B\n\nHow to make?\n\nDry ingredients into one container, liquids separately, then knead and form balls.',
    });
    pageChunkRepository.chunks.set(ochotkaPreparationChunk.id, ochotkaPreparationChunk);
    saturatedVectorMatches.unshift({ ...ochotkaPreparationChunk, vectorScore: 11 });

    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(ok([...saturatedVectorMatches, { ...genericChunk, vectorScore: 0.99 }]));

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-7',
          role: 'user',
          status: 'approved',
          effectiveLevel: 7,
        },
        query: 'Porównaj Example Wafter A, Example Wafter B i Example Wafter C wafter.',
        conversationContext: { latestMessages: [] },
        options: { topK: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    expect(result.value.items.map((item) => item.title)).toEqual(
      expect.arrayContaining(['Example Wafter A', 'Example Wafter B', 'Example Wafter C'])
    );
    expect(
      result.value.items.some(
        (item) => item.title === 'Example Wafter B' && item.content.includes('component B')
      )
    ).toBe(true);
  });

  it('retrieves all requested named liquid additive pages for crowded comparison queries', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();

    const liquidPages = [
      {
        pageId: 'salmon-hydrolizate-page',
        nodeId: 'salmon-hydrolizate-node',
        title: 'Liquid Additive Alpha',
        slug: 'liquid-additive-a',
        text: 'Liquid additive Alpha creates a neutral path and fixture signal.',
      },
      {
        pageId: 'krill-hydrolizate-page',
        nodeId: 'krill-hydrolizate-node',
        title: 'Liquid Additive Bravo',
        slug: 'liquid-additive-b',
        text: 'Liquid additive Bravo creates a second neutral fixture signal.',
      },
      {
        pageId: 'natural-betaine-page',
        nodeId: 'natural-betaine-node',
        title: 'Liquid Additive Charlie',
        slug: 'liquid-additive-c',
        text: 'Liquid additive Charlie extends the neutral fixture signal.',
      },
      {
        pageId: 'dense-liquid-page',
        nodeId: 'dense-liquid-node',
        title: 'Liquid Additive Delta',
        slug: 'liquid-additive-d',
        text: 'Liquid additive Delta is a concentrated fixture input. Use a small range because it should stay limited.',
      },
      {
        pageId: 'ferment-power-page',
        nodeId: 'ferment-power-node',
        title: 'Liquid Additive Echo',
        slug: 'liquid-additive-e',
        text: 'Liquid additive Echo uses component A and component B, with component C and component D as a neutral fixture signal.',
      },
    ] as const;

    for (const liquidPage of liquidPages) {
      pageRepository.pages.set(
        liquidPage.pageId,
        readyPage({
          id: liquidPage.pageId,
          nodeId: liquidPage.nodeId,
          title: liquidPage.title,
          slug: liquidPage.slug,
          pathIds: ['root', 'category-1', 'section-1', liquidPage.nodeId],
          pathTitles: ['Knowledge Base', 'Method feeder', 'Płynne dodatki', liquidPage.title],
        })
      );
      pageChunkRepository.chunks.set(
        `${liquidPage.pageId}-chunk`,
        pageChunk({
          id: `${liquidPage.pageId}-chunk`,
          pageId: liquidPage.pageId,
          nodeId: liquidPage.nodeId,
          title: liquidPage.title,
          path: ['Knowledge Base', 'Method feeder', 'Płynne dodatki', liquidPage.title],
          headingPath: [liquidPage.title],
          text: liquidPage.text,
          searchableText: `${liquidPage.title}\n\n${liquidPage.text}`,
        })
      );
    }

    const saturatedVectorMatches: KnowledgePageChunkMatch[] = [];
    for (let index = 0; index < 180; index += 1) {
      const indexLabel = String(index);
      const chunk = pageChunk({
        id: `generic-liquid-saturated-${indexLabel}`,
        pageId: 'generic-liquid-page',
        nodeId: 'generic-liquid-node',
        title:
          index % 2 === 0 ? 'Hydrolizaty i płynne pokarmy' : 'Ferment fixture and neutral signal',
        path: ['Knowledge Base', 'Method feeder', 'Płynne dodatki', 'Ogólne sygnały'],
        headingPath: ['Ogólne sygnały', `Fragment ${indexLabel}`],
        index,
        text:
          index % 2 === 0
            ? `Hydrolizat, aminokwasy, białko i porównanie płynnych dodatków ${indexLabel}.`
            : `Ferment fixture, component X, neutral signal and fixture behavior ${indexLabel}.`,
        searchableText:
          index % 2 === 0
            ? `Hydrolizaty i płynne pokarmy\n\nHydrolizat, aminokwasy, białko i porównanie płynnych dodatków ${indexLabel}.`
            : `Ferment fixture and neutral signal\n\nFerment fixture, component X, neutral signal and fixture behavior ${indexLabel}.`,
      });
      pageChunkRepository.chunks.set(chunk.id, chunk);
      saturatedVectorMatches.push({ ...chunk, vectorScore: 12 - index * 0.01 });
    }

    pageRepository.pages.set(
      'generic-liquid-page',
      readyPage({
        id: 'generic-liquid-page',
        nodeId: 'generic-liquid-node',
        title: 'Ogólne płynne dodatki',
        slug: 'ogolne-plynne-dodatki',
        pathIds: ['root', 'category-1', 'section-1', 'generic-liquid-node'],
        pathTitles: ['Knowledge Base', 'Method feeder', 'Płynne dodatki', 'Ogólne płynne dodatki'],
      })
    );
    pageRepository.pages.set(
      'liquid-guidance-page',
      readyPage({
        id: 'liquid-guidance-page',
        nodeId: 'liquid-guidance-node',
        title: 'Liquid Additive Guidance',
        slug: 'plynne-dodatki-w-zanecie',
        pathIds: ['root', 'category-1', 'section-1', 'liquid-guidance-node'],
        pathTitles: [
          'Knowledge Base',
          'Method feeder',
          'Płynne dodatki',
          'Liquid Additive Guidance',
        ],
      })
    );
    pageChunkRepository.chunks.set(
      'liquid-guidance-page-chunk',
      pageChunk({
        id: 'liquid-guidance-page-chunk',
        pageId: 'liquid-guidance-page',
        nodeId: 'liquid-guidance-node',
        title: 'Liquid Additive Guidance',
        path: ['Knowledge Base', 'Method feeder', 'Płynne dodatki', 'Liquid Additive Guidance'],
        headingPath: ['Liquid Additive Guidance', 'Fixture guidance'],
        text: 'Guidance fixture uses 1-3 units of additives in total. Strong inputs increase fixture risk.',
        searchableText:
          'Liquid Additive Guidance\n\nFixture guidance\n\nGuidance fixture uses 1-3 units of additives in total. Strong inputs increase fixture risk.',
      })
    );
    pageChunkRepository.findNearestPageChunks = () => Promise.resolve(ok(saturatedVectorMatches));

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-7',
          role: 'user',
          status: 'approved',
          effectiveLevel: 7,
        },
        query:
          'Compare Liquid Additive Alpha, Liquid Additive Bravo, Liquid Additive Charlie, Liquid Additive Delta and Liquid Additive Echo. When choose which signal, dose, season, temperature and risk?',
        conversationContext: { latestMessages: [] },
        options: { topK: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    expect(result.value.items.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        'Liquid Additive Alpha',
        'Liquid Additive Bravo',
        'Liquid Additive Charlie',
        'Liquid Additive Delta',
        'Liquid Additive Echo',
        'Liquid Additive Guidance',
      ])
    );
    expect(
      result.value.items.some(
        (item) => item.title === 'Liquid Additive Guidance' && item.content.includes('1-3 units')
      )
    ).toBe(true);
  });

  it('expands sibling chunks when a named page matches the query identity', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'page-1',
      readyPage({
        title: 'Fixture Mix A',
        slug: 'fixture-mix-a',
        pathTitles: ['Knowledge Base', 'Method feeder', 'Sekcja testowa', 'Fixture Mix A'],
        chunkCount: 2,
      })
    );
    const introChunk = pageChunk({
      id: 'zaneta-intro',
      title: 'Fixture Mix A',
      path: ['Knowledge Base', 'Method feeder', 'Sekcja testowa', 'Fixture Mix A'],
      headingPath: ['Fixture Mix A'],
      text: 'Ta zanęta spisuje się gdy woda ma temperaturę w granicach 22 stopni i ryby stają się ostrożne.',
      searchableText:
        'Fixture Mix A\n\nTa zanęta spisuje się gdy woda ma temperaturę w granicach 22 stopni i ryby stają się ostrożne.',
    });
    const baseChunk = pageChunk({
      id: 'zaneta-base',
      index: 1,
      title: 'Fixture Mix A',
      path: ['Knowledge Base', 'Method feeder', 'Sekcja testowa', 'Fixture Mix A'],
      headingPath: ['Fixture Mix A', 'Baza strukturalna i objętościowa'],
      text: 'Base fixture includes ingredient A, ingredient B, ingredient C, ingredient D, ingredient E and ingredient F.',
      searchableText:
        'Fixture Mix A\n\nBase fixture includes ingredient A, ingredient B, ingredient C, ingredient D, ingredient E and ingredient F.',
    });
    pageChunkRepository.chunks.set('zaneta-intro', introChunk);
    pageChunkRepository.chunks.set('zaneta-base', baseChunk);
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(ok([{ ...introChunk, vectorScore: 0.99 }]));

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query:
          'Kiedy i dlaczego warto użyć zanęty delikatnej w method feederze? Podaj też najważniejsze składniki bazy.',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    const expandedBaseItem = result.value.items.find((item) =>
      item.content.includes('ingredient A')
    );
    expect(expandedBaseItem).toBeDefined();
    expect(expandedBaseItem?.score).toBeGreaterThan(1.5);
  });

  it('expands named pages for inflected setup questions about configuring a rig', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'page-1',
      readyPage({
        title: 'Example Float Rig A',
        slug: 'example-float-rig-a',
        pathTitles: ['Knowledge Base', 'Spławik', 'Zestawy', 'Example Float Rig A'],
        chunkCount: 6,
      })
    );
    const chunks = [
      pageChunk({
        id: 'rig-intro',
        title: 'Example Float Rig A',
        path: ['Knowledge Base', 'Spławik', 'Zestawy', 'Example Float Rig A'],
        headingPath: ['Example Float Rig A', 'Kiedy działa'],
        index: 0,
        text: 'Ten zestaw pozwala podać przynętę ponad miękką warstwą dna i zachować spokojną prezentację.',
        searchableText:
          'Example Float Rig A\n\nTen zestaw pozwala podać przynętę ponad miękką warstwą dna i zachować spokojną prezentację.',
      }),
      pageChunk({
        id: 'rig-rod',
        title: 'Example Float Rig A',
        path: ['Knowledge Base', 'Spławik', 'Zestawy', 'Example Float Rig A'],
        headingPath: ['Example Float Rig A', 'Wędka'],
        index: 1,
        text: 'Wędka powinna amortyzować krótkie odjazdy i pozwalać prowadzić zestaw bez szarpania.',
        searchableText:
          'Example Float Rig A\n\nWędka powinna amortyzować krótkie odjazdy i pozwalać prowadzić zestaw bez szarpania.',
      }),
      pageChunk({
        id: 'rig-float',
        title: 'Example Float Rig A',
        path: ['Knowledge Base', 'Spławik', 'Zestawy', 'Example Float Rig A'],
        headingPath: ['Example Float Rig A', 'Spławik'],
        index: 2,
        text: 'Spławik musi być wyważony tak, aby pokazywał delikatne podniesienia i przytopienia.',
        searchableText:
          'Example Float Rig A\n\nSpławik musi być wyważony tak, aby pokazywał delikatne podniesienia i przytopienia.',
      }),
      pageChunk({
        id: 'rig-line',
        title: 'Example Float Rig A',
        path: ['Knowledge Base', 'Spławik', 'Zestawy', 'Example Float Rig A'],
        headingPath: ['Example Float Rig A', 'Żyłka'],
        index: 3,
        text: 'Żyłka główna powinna pozwalać kontrolować zestaw bez nadmiernego oporu.',
        searchableText:
          'Example Float Rig A\n\nŻyłka główna powinna pozwalać kontrolować zestaw bez nadmiernego oporu.',
      }),
      pageChunk({
        id: 'rig-shot',
        title: 'Example Float Rig A',
        path: ['Knowledge Base', 'Spławik', 'Zestawy', 'Example Float Rig A'],
        headingPath: ['Example Float Rig A', 'Śruciny'],
        index: 4,
        text: 'Śruciny układa się stopniowo, żeby nie ściągały przynęty w dół.',
        searchableText:
          'Example Float Rig A\n\nŚruciny układa się stopniowo, żeby nie ściągały przynęty w dół.',
      }),
      pageChunk({
        id: 'rig-lengths',
        title: 'Example Float Rig A',
        path: ['Knowledge Base', 'Spławik', 'Zestawy', 'Example Float Rig A'],
        headingPath: ['Example Float Rig A', 'Długości odcinków'],
        index: 5,
        text: 'Set segment A to range 6-12 units and segment B to range 18-28 units for fixture behavior.',
        searchableText:
          'Example Float Rig A\n\nSet segment A to range 6-12 units and segment B to range 18-28 units for fixture behavior.',
      }),
    ];
    for (const chunk of chunks) {
      pageChunkRepository.chunks.set(chunk.id, chunk);
    }
    const vectorChunk = chunks[0];
    if (vectorChunk === undefined) {
      throw new Error('expected at least one chunk for vector retrieval');
    }
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(ok([{ ...vectorChunk, vectorScore: 0.99 }]));
    pageChunkRepository.listRetrievableActiveLexicalCandidates = () =>
      Promise.resolve(ok({ chunks: [], scannedCount: 0, limitHit: false }));

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'Jak ustawic Example Float Rig A dla warunku testowego B?',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    expect(result.value.diagnostics.expandedItemCount).toBe(1);
    expect(retrievedEvidenceText(result.value.items)).toContain('segment B to range 18-28 units');
  });

  it('prioritizes named species technique pages for practical fishing questions', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'generic-page',
      readyPage({
        id: 'generic-page',
        nodeId: 'generic-node',
        title: 'Generic Fish Behavior',
        slug: 'generic-fish-behavior',
        pathIds: ['root', 'category-1', 'section-1', 'generic-node'],
        pathTitles: ['Knowledge Base', 'Biologia', 'Zachowanie', 'Generic Fish Behavior'],
      })
    );
    pageRepository.pages.set(
      'species-page',
      readyPage({
        id: 'species-page',
        nodeId: 'species-node',
        title: 'Lin Fixture Technique A',
        slug: 'example-species-technique-a',
        pathIds: ['root', 'category-1', 'section-1', 'species-node'],
        pathTitles: ['Knowledge Base', 'Gatunki', 'Lin', 'Lin Fixture Technique A'],
      })
    );
    const genericChunk = pageChunk({
      id: 'generic-fear',
      pageId: 'generic-page',
      nodeId: 'generic-node',
      title: 'Generic Fish Behavior',
      path: ['Knowledge Base', 'Biologia', 'Zachowanie', 'Generic Fish Behavior'],
      headingPath: ['Generic Fish Behavior'],
      text: 'Ryby potrafią przekazywać strach i reagują na gwałtowny hałas przy brzegu.',
      searchableText:
        'Generic Fish Behavior\n\nRyby potrafią przekazywać strach i reagują na gwałtowny hałas przy brzegu.',
    });
    const speciesChunk = pageChunk({
      id: 'species-float',
      pageId: 'species-page',
      nodeId: 'species-node',
      title: 'Lin Fixture Technique A',
      path: ['Knowledge Base', 'Gatunki', 'Lin', 'Lin Fixture Technique A'],
      headingPath: ['Lin Fixture Technique A', 'Metoda spławikowa'],
      text: 'Use method A and line range 18-22 units in condition B.',
      searchableText:
        'Lin Fixture Technique A\n\nUse method A and line range 18-22 units in condition B.',
    });
    pageChunkRepository.chunks.set(genericChunk.id, genericChunk);
    pageChunkRepository.chunks.set(speciesChunk.id, speciesChunk);
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(
        ok([
          { ...genericChunk, vectorScore: 0.99 },
          { ...speciesChunk, vectorScore: 0.2 },
        ])
      );
    pageChunkRepository.listRetrievableActiveLexicalCandidates = () =>
      Promise.resolve(ok({ chunks: [], scannedCount: 0, limitHit: false }));

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query:
          'Krótka praktyczna odpowiedź: jak skutecznie łowić lina w roślinności i miękkim mule?',
        conversationContext: { latestMessages: [] },
        options: { topK: 2 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    expect(result.value.items[0]?.title).toBe('Lin Fixture Technique A');
    expect(retrievedEvidenceText(result.value.items)).toContain('18-22 units');
  });

  it('expands long named species pages when the query names the first title term', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'habitat-page',
      readyPage({
        id: 'habitat-page',
        nodeId: 'habitat-node',
        title: 'Warstwy termiczne łowiska',
        slug: 'warstwy-termiczne-lowiska',
        pathIds: ['root', 'category-1', 'section-1', 'habitat-node'],
        pathTitles: ['Knowledge Base', 'Woda', 'Mikrosiedliska', 'Warstwy termiczne łowiska'],
      })
    );
    pageRepository.pages.set(
      'amur-page',
      readyPage({
        id: 'amur-page',
        nodeId: 'amur-node',
        title: 'Amur Fixture Seasonal Profile',
        slug: 'example-species-seasonal-profile',
        pathIds: ['root', 'category-1', 'section-1', 'amur-node'],
        pathTitles: ['Knowledge Base', 'Gatunki', 'Amur', 'Amur Fixture Seasonal Profile'],
      })
    );
    const habitatChunk = pageChunk({
      id: 'habitat-warm-water',
      pageId: 'habitat-page',
      nodeId: 'habitat-node',
      title: 'Warstwy termiczne łowiska',
      path: ['Knowledge Base', 'Woda', 'Mikrosiedliska', 'Warstwy termiczne łowiska'],
      headingPath: ['Warstwy termiczne łowiska'],
      text: 'Płytka zatoka z roślinnością szybko się nagrzewa i daje rybom osłonę.',
      searchableText:
        'Warstwy termiczne łowiska\n\nPłytka zatoka z roślinnością szybko się nagrzewa i daje rybom osłonę.',
    });
    const amurChunk = pageChunk({
      id: 'amur-warm-season',
      pageId: 'amur-page',
      nodeId: 'amur-node',
      title: 'Amur Fixture Seasonal Profile',
      path: ['Knowledge Base', 'Gatunki', 'Amur', 'Amur Fixture Seasonal Profile'],
      headingPath: ['Amur Fixture Seasonal Profile'],
      text: 'Amur jest ciepłolubny, najlepiej żeruje w wodzie 20-28°C i wykorzystuje bogatą roślinność.',
      searchableText:
        'Amur Fixture Seasonal Profile\n\nAmur jest ciepłolubny, najlepiej żeruje w wodzie 20-28°C i wykorzystuje bogatą roślinność.',
    });
    pageChunkRepository.chunks.set(habitatChunk.id, habitatChunk);
    pageChunkRepository.chunks.set(amurChunk.id, amurChunk);
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(
        ok([
          { ...habitatChunk, vectorScore: 0.99 },
          { ...amurChunk, vectorScore: 0.1 },
        ])
      );
    pageChunkRepository.listRetrievableActiveLexicalCandidates = () =>
      Promise.resolve(ok({ chunks: [], scannedCount: 0, limitHit: false }));

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'Mam ciepłą zatokę z roślinnością. Czy wybrać amura i jaki plan ułożyć?',
        conversationContext: { latestMessages: [] },
        options: { topK: 1 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    expect(result.value.items[0]?.title).toBe('Amur Fixture Seasonal Profile');
    expect(retrievedEvidenceText(result.value.items)).toContain('20-28°C');
  });

  it('keeps directly named pages eligible when a contextual query has many habitat terms', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    const namedSpecies = [
      {
        id: 'amur',
        title: 'Amur Fixture Seasonal Profile',
        pathAlias: 'Amur',
        text: 'Amur jest ciepłolubny i korzysta z naturalnej bazy pokarmowej.',
      },
      {
        id: 'karp',
        title: 'Karp - miejsce, pokarm i ostrożność',
        pathAlias: 'Karp',
        text: 'Karp wymaga spokojnego podejścia i czytania presji na łowisku.',
      },
      {
        id: 'lin',
        title: 'Lin - cichy mieszkaniec roślin',
        pathAlias: 'Lin',
        text: 'Lin żeruje ostrożnie i lubi naturalne, spokojne podanie.',
      },
      {
        id: 'leszcz',
        title: 'Leszcz - spokojny deniec',
        pathAlias: 'Leszcz',
        text: 'Leszcz czyta stabilne, spokojne dno i pokarm denny.',
      },
      {
        id: 'ploc',
        title: 'Płoć Fixture Profile',
        pathAlias: 'Płoć',
        text: 'Płoć pracuje wyżej w toni i reaguje na lekki, drobny sygnał.',
      },
      {
        id: 'klen',
        title: 'Kleń Fixture Profile',
        pathAlias: 'Kleń',
        text: 'Kleń czyta nurt, cień, owady i twarde struktury, a nie karpiowy muł.',
      },
      {
        id: 'brzana',
        title: 'Brzana Fixture Profile',
        pathAlias: 'Brzana',
        text: 'Brzana trzyma się silnego nurtu, kamieni, żwiru i pokarmu niesionego przy dnie.',
      },
    ];

    for (const item of namedSpecies) {
      pageRepository.pages.set(
        `page-${item.id}`,
        readyPage({
          id: `page-${item.id}`,
          nodeId: `node-${item.id}`,
          title: item.title,
          slug: item.id,
          pathTitles: ['Knowledge Base', 'Gatunki', item.pathAlias, item.title],
          chunkCount: 1,
        })
      );
      pageChunkRepository.chunks.set(
        `chunk-${item.id}`,
        pageChunk({
          id: `chunk-${item.id}`,
          pageId: `page-${item.id}`,
          nodeId: `node-${item.id}`,
          title: item.title,
          path: ['Knowledge Base', 'Gatunki', item.pathAlias, item.title],
          headingPath: [item.title],
          text: item.text,
          searchableText: `${item.title}\n\n${item.text}`,
        })
      );
    }

    for (let index = 0; index < 64; index += 1) {
      const id = `distractor-${String(index)}`;
      pageRepository.pages.set(
        `page-${id}`,
        readyPage({
          id: `page-${id}`,
          nodeId: `node-${id}`,
          title: `Ciepła płytka zatoka ${String(index)}`,
          slug: id,
          pathTitles: ['Knowledge Base', 'Siedliska', `Ciepła płytka zatoka ${String(index)}`],
          chunkCount: 1,
        })
      );
      pageChunkRepository.chunks.set(
        `chunk-${id}`,
        pageChunk({
          id: `chunk-${id}`,
          pageId: `page-${id}`,
          nodeId: `node-${id}`,
          title: `Ciepła płytka zatoka ${String(index)}`,
          path: ['Knowledge Base', 'Siedliska', `Ciepła płytka zatoka ${String(index)}`],
          headingPath: [`Ciepła płytka zatoka ${String(index)}`],
          text: 'Ciepła płytka zatoka z roślinnością, plan, gatunek, sygnał naturalny, bentos i dno.',
          searchableText:
            'Ciepła płytka zatoka z roślinnością, plan, gatunek, sygnał naturalny, bentos i dno.',
        })
      );
    }

    const distractorChunk = pageChunkRepository.chunks.get('chunk-distractor-0');
    if (distractorChunk === undefined) {
      throw new Error('missing distractor chunk');
    }
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(ok([{ ...distractorChunk, vectorScore: 0.99 }]));

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: [
          'Bieżące pytanie: Mam ciepłą, płytką zatokę z roślinnością. Który gatunek i plan wybrać według bazy wiedzy?',
          'Wcześniejsze pytania użytkownika jako kontekst nazw, tematów, produktów, gatunków, metod, zakresów i ograniczeń:',
          'Użytkownik: Jak podejść do karpia, gdy chcę krótki plan miejsca, pokarmu i ostrożności?',
          'Użytkownik: Jak zmienia się podejście do amura, gdy woda ma ponad 20°C?',
          'Użytkownik: Czym lin różni się od karpia w wyborze miejsca i podania przynęty?',
          'Użytkownik: Jak myśleć o leszczu w spokojnych wodach?',
          'Użytkownik: Jak podejść do płoci, żeby nie zrobić z niej małego karpia?',
          'Użytkownik: Co z kleniem albo brzaną: czego nie mieszać z karpiowym schematem?',
        ].join('\n'),
        conversationContext: { latestMessages: [] },
        options: { topK: 7, expandParentDocuments: false },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    const titles = result.value.items.map((item) => item.title);
    expect(titles).toEqual(
      expectArrayContaining([
        'Amur Fixture Seasonal Profile',
        'Karp - miejsce, pokarm i ostrożność',
        'Lin - cichy mieszkaniec roślin',
        'Leszcz - spokojny deniec',
        'Płoć Fixture Profile',
        'Kleń Fixture Profile',
        'Brzana Fixture Profile',
      ])
    );
  });

  it('prioritizes current-question named pages over older contextual names', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    const species = [
      ['karp', 'Karp - spokojny deniec', 'Karp czyta muliste dno i długie, ostrożne nęcenie.'],
      ['amur', 'Amur - ciepła roślinność', 'Amur czyta ciepłą wodę i roślinność.'],
      ['lin', 'Lin - cisza i rośliny', 'Lin wymaga ciszy, mułu i roślinności.'],
      ['leszcz', 'Leszcz - stabilne dno', 'Leszcz czyta stabilne, spokojne dno.'],
      ['ploc', 'Płoć - drobny sygnał', 'Płoć pracuje drobnym, lekkim sygnałem.'],
      [
        'klen',
        'Kleń - nurt i struktury',
        'Kleń wybiera nurt, kamienie, korzenie, owady i precyzyjne podanie.',
      ],
      [
        'brzana',
        'Brzana - nurt i żwir',
        'Brzana wybiera silny nurt, kamieniste i żwirowe dno oraz naturalny pokarm przy dnie.',
      ],
    ] as const;

    for (const [id, title, text] of species) {
      pageRepository.pages.set(
        `page-${id}`,
        readyPage({
          id: `page-${id}`,
          nodeId: `node-${id}`,
          title,
          slug: id,
          pathTitles: ['Knowledge Base', 'Gatunki', title.split(' - ')[0] ?? title, title],
          chunkCount: 1,
        })
      );
      pageChunkRepository.chunks.set(
        `chunk-${id}`,
        pageChunk({
          id: `chunk-${id}`,
          pageId: `page-${id}`,
          nodeId: `node-${id}`,
          title,
          path: ['Knowledge Base', 'Gatunki', title.split(' - ')[0] ?? title, title],
          headingPath: [title],
          text,
          searchableText: `${title}\n\n${text}`,
        })
      );
    }

    const contextChunk = pageChunkRepository.chunks.get('chunk-karp');
    if (contextChunk === undefined) {
      throw new Error('missing context chunk');
    }
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(ok([{ ...contextChunk, vectorScore: 0.99 }]));

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: [
          'Bieżące pytanie: Co z kleniem albo brzaną: czego nie mieszać z karpiowym schematem?',
          'Wcześniejsze pytania użytkownika jako kontekst nazw, tematów, produktów, gatunków, metod, zakresów i ograniczeń:',
          'Użytkownik: Jak podejść do karpia, gdy chcę krótki plan miejsca, pokarmu i ostrożności?',
          'Użytkownik: Jak zmienia się podejście do amura, gdy woda ma ponad 20°C?',
          'Użytkownik: Czym lin różni się od karpia w wyborze miejsca i podania przynęty?',
          'Użytkownik: Jak myśleć o leszczu w spokojnych wodach?',
          'Użytkownik: Jak podejść do płoci, żeby nie zrobić z niej małego karpia?',
        ].join('\n'),
        conversationContext: { latestMessages: [] },
        options: { topK: 3, expandParentDocuments: false },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    const titles = result.value.items.map((item) => item.title);
    expect(titles).toEqual(
      expectArrayContaining(['Kleń - nurt i struktury', 'Brzana - nurt i żwir'])
    );
  });

  it('expands a previously mentioned page for same-recipe follow-up retrieval', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'page-1',
      readyPage({
        title: 'Fixture Mix A',
        slug: 'fixture-mix-a',
        pathTitles: ['Knowledge Base', 'Method feeder', 'Sekcja testowa', 'Fixture Mix A'],
        chunkCount: 3,
      })
    );
    const baseChunk = pageChunk({
      id: 'zaneta-base',
      title: 'Fixture Mix A',
      path: ['Knowledge Base', 'Method feeder', 'Sekcja testowa', 'Fixture Mix A'],
      headingPath: ['Fixture Mix A', 'Baza strukturalna i objętościowa'],
      text: 'Base fixture includes ingredient A, ingredient B and ingredient C.',
      searchableText:
        'Fixture Mix A\n\nBase fixture includes ingredient A, ingredient B and ingredient C.',
    });
    const fermentationChunk = pageChunk({
      id: 'zaneta-fermentation',
      index: 1,
      title: 'Fixture Mix A',
      path: ['Knowledge Base', 'Method feeder', 'Sekcja testowa', 'Fixture Mix A'],
      headingPath: ['Fixture Mix A', 'Fermentacja i sygnał chemiczny'],
      text: 'Process fixture includes processed ingredient A, Liquid Additive Bravo and starter C.',
      searchableText:
        'Fixture Mix A\n\nProcess fixture includes processed ingredient A, Liquid Additive Bravo and starter C.',
    });
    const herbsChunk = pageChunk({
      id: 'zaneta-herbs',
      index: 2,
      title: 'Fixture Mix A',
      path: ['Knowledge Base', 'Method feeder', 'Sekcja testowa', 'Fixture Mix A'],
      headingPath: ['Fixture Mix A', 'Zioła - wyciszenie i naturalność'],
      text: 'Support fixture includes component D, component E and component F.',
      searchableText:
        'Fixture Mix A\n\nSupport fixture includes component D, component E and component F.',
    });
    pageChunkRepository.chunks.set('zaneta-base', baseChunk);
    pageChunkRepository.chunks.set('zaneta-fermentation', fermentationChunk);
    pageChunkRepository.chunks.set('zaneta-herbs', herbsChunk);
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(ok([{ ...baseChunk, vectorScore: 0.99 }]));
    pageChunkRepository.listRetrievableActiveLexicalCandidates = () =>
      Promise.resolve(ok({ chunks: [], scannedCount: 0, limitHit: false }));

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'A jakie komponenty procesu i wsparcia sa w tym samym opisie testowym?',
        conversationContext: {
          latestMessages: [
            {
              role: 'assistant',
              content: 'Fixture Mix A includes ingredient A, ingredient B and ingredient C.',
            },
          ],
        },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    const evidenceText = retrievedEvidenceText(result.value.items);
    expect(evidenceText).toContain('processed ingredient A');
    expect(evidenceText).toContain('component D');
    expect(result.value.diagnostics.expandedItemCount).toBe(1);
  });

  it('expands a previously mentioned page for procedural follow-up retrieval', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'page-1',
      readyPage({
        title: 'Fermentacja ziaren',
        slug: 'fermentacja-ziaren',
        pathTitles: ['Knowledge Base', 'Karpiarstwo', 'Fermentacja ziaren'],
        chunkCount: 2,
      })
    );
    const overviewChunk = pageChunk({
      id: 'fermentation-overview',
      title: 'Fermentacja ziaren',
      path: ['Knowledge Base', 'Karpiarstwo', 'Fermentacja ziaren'],
      headingPath: ['Fermentacja ziaren', 'Co dzieje się podczas fermentacji ziaren?'],
      text: 'Fermentacja rozkłada cukry na kwasy organiczne, lekkie alkohole i aminokwasy.',
      searchableText:
        'Fermentacja ziaren\n\nFermentacja rozkłada cukry na kwasy organiczne, lekkie alkohole i aminokwasy.',
    });
    const processChunk = pageChunk({
      id: 'fermentation-process',
      index: 1,
      title: 'Fermentacja ziaren',
      path: ['Knowledge Base', 'Karpiarstwo', 'Fermentacja ziaren'],
      headingPath: ['Fermentacja ziaren', 'Jak przygotować ziarna?'],
      text: 'Prepare the sample through staged step A, step B, and daily review.',
      searchableText:
        'Fermentacja ziaren\n\nPrepare the sample through staged step A, step B, and daily review.',
    });
    pageChunkRepository.chunks.set('fermentation-overview', overviewChunk);
    pageChunkRepository.chunks.set('fermentation-process', processChunk);
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(ok([{ ...overviewChunk, vectorScore: 0.99 }]));
    pageChunkRepository.listRetrievableActiveLexicalCandidates = () =>
      Promise.resolve(ok({ chunks: [], scannedCount: 0, limitHit: false }));

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query:
          'Jak krok po kroku przygotować ziarna do fermentacji: moczenie, temperatura, czas i mieszanie?',
        conversationContext: {
          latestMessages: [
            {
              role: 'assistant',
              content:
                'Fermentacja ziaren to proces biologiczno-chemiczny. Powstają kwasy organiczne, lekkie alkohole, aminokwasy, aromat, smak, mikroorganizmy, bakterie, drożdże, enzymy i naturalny sygnał pokarmowy.',
            },
          ],
        },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected retrieval to succeed');
    }
    expect(retrievedEvidenceText(result.value.items)).toContain('staged step A');
    expect(result.value.diagnostics.expandedItemCount).toBe(1);
  });

  it('over-fetches enough vector candidates before authorization filtering', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    let requestedCandidateLimit: number | undefined;
    const findNearestPageChunks =
      pageChunkRepository.findNearestPageChunks.bind(pageChunkRepository);
    pageChunkRepository.findNearestPageChunks = (input) => {
      requestedCandidateLimit = input.limit;
      return findNearestPageChunks(input);
    };
    pageRepository.pages.set('page-1', readyPage());
    pageChunkRepository.chunks.set('page-chunk-1', pageChunk());

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'float fishing basics',
        conversationContext: { latestMessages: [] },
        options: { topK: 16 },
      }
    );

    expect(result.ok).toBe(true);
    expect(requestedCandidateLimit).toBe(120);
  });

  it('prefetches retrieval page metadata once while preserving candidate ranking order', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    const metadataCalls: string[][] = [];
    const getRetrievalMetadataByIds = pageRepository.getRetrievalMetadataByIds.bind(pageRepository);
    pageRepository.getRetrievalMetadataByIds = (pageIds) => {
      metadataCalls.push([...pageIds]);
      return getRetrievalMetadataByIds(pageIds);
    };
    pageRepository.getById = () =>
      Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'sequential page lookup used' }));
    pageRepository.pages.set('page-1', readyPage());
    pageRepository.pages.set(
      'page-2',
      readyPage({
        id: 'page-2',
        nodeId: 'page-node-2',
        title: 'Ledgering Basics',
        slug: 'ledgering-basics',
        pathIds: ['root', 'category-1', 'section-1', 'page-node-2'],
        pathTitles: ['Knowledge Base', 'Coarse Fishing', 'Floats', 'Ledgering Basics'],
      })
    );
    const firstChunk = pageChunk({
      id: 'rank-first',
      text: 'Shared neutral evidence text.',
      searchableText: 'Shared neutral evidence text.',
    });
    const missingPageChunk = pageChunk({
      id: 'rank-missing-page',
      pageId: 'missing-page',
      nodeId: 'missing-page-node',
      text: 'Shared neutral evidence text.',
      searchableText: 'Shared neutral evidence text.',
    });
    const secondChunk = pageChunk({
      id: 'rank-second',
      pageId: 'page-2',
      nodeId: 'page-node-2',
      title: 'Ledgering Basics',
      text: 'Shared neutral evidence text.',
      searchableText: 'Shared neutral evidence text.',
    });
    const firstPageDuplicateChunk = pageChunk({
      id: 'rank-first-duplicate-page',
      index: 1,
      text: 'Shared neutral evidence text.',
      searchableText: 'Shared neutral evidence text.',
    });
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(
        ok(
          [firstChunk, missingPageChunk, secondChunk, firstPageDuplicateChunk].map((chunk) => ({
            ...chunk,
            vectorScore: 0.5,
          }))
        )
      );
    pageChunkRepository.listRetrievableActiveLexicalCandidates = () =>
      Promise.resolve(ok({ chunks: [], scannedCount: 0, limitHit: false }));

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'neutral ranking',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(metadataCalls).toEqual([['page-1', 'missing-page', 'page-2']]);
    expect(result.value.items.map((item) => item.title)).toEqual([
      'Float Fishing Basics',
      'Ledgering Basics',
      'Float Fishing Basics',
    ]);
    expect(result.value.diagnostics.searchedChunkCount).toBe(3);
  });

  it('starts lexical candidate work before vector search completes', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    const events: string[] = [];
    const vectorResult =
      createDeferred<Awaited<ReturnType<typeof pageChunkRepository.findNearestPageChunks>>>();

    pageChunkRepository.findNearestPageChunks = () => {
      events.push('vector-started');
      return vectorResult.promise.then((result) => {
        events.push('vector-resolved');
        return result;
      });
    };
    pageChunkRepository.listRetrievableActiveLexicalCandidates = () => {
      events.push('lexical-started');
      return Promise.resolve(ok({ chunks: [], scannedCount: 0, limitHit: false }));
    };

    const retrieval = retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'float fishing basics',
        conversationContext: { latestMessages: [] },
      }
    );
    await Promise.resolve();
    vectorResult.resolve(ok([]));
    const result = await retrieval;

    expect(result.ok).toBe(true);
    expect(events.indexOf('lexical-started')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('lexical-started')).toBeLessThan(events.indexOf('vector-resolved'));
  });

  it('returns vector errors first when concurrent lexical candidate work also fails', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    let lexicalStarted = false;
    pageChunkRepository.findNearestPageChunks = () =>
      Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'vector failed' }));
    pageChunkRepository.listRetrievableActiveLexicalCandidates = () => {
      lexicalStarted = true;
      return Promise.reject(new Error('lexical failed'));
    };

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'float fishing basics',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(lexicalStarted).toBe(true);
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'vector failed' },
    });
  });

  it('still returns lexical candidate errors after vector search succeeds', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageChunkRepository.findNearestPageChunks = () => Promise.resolve(ok([]));
    pageChunkRepository.listRetrievableActiveLexicalCandidates = () =>
      Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'lexical failed' }));

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'float fishing basics',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'lexical failed' },
    });
  });

  it('filters retrieval results by approved authorization level', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set('page-1', readyPage());
    pageRepository.pages.set(
      'page-2',
      readyPage({
        id: 'page-2',
        nodeId: 'page-node-2',
        title: 'Advanced Pole Lines',
        slug: 'advanced-pole-lines',
        access: {
          inheritedFromCategoryId: 'category-1',
          categoryAccessRevision: 'category-rev-8',
          override: null,
          effective: { gate: 'level', requiredLevel: 8, accessRevision: 'category-rev-8' },
        },
      })
    );
    pageChunkRepository.chunks.set('level-6-chunk', pageChunk({ id: 'level-6-chunk' }));
    pageChunkRepository.chunks.set(
      'level-8-chunk',
      pageChunk({
        id: 'level-8-chunk',
        pageId: 'page-2',
        nodeId: 'page-node-2',
        title: 'Advanced Pole Lines',
        access: { gate: 'level', requiredLevel: 8 },
        accessRevision: 'category-rev-8',
      })
    );

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'float fishing pole lines',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.items.map((item) => item.title)).toEqual(['Float Fishing Basics']);
    expect(result.value.items[0]?.metadata).not.toHaveProperty('documentId');
  });

  it('returns a no-candidate coverage probe when retrieval sees no candidates', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'no matching page',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        items: [],
        coverageProbe: {
          classification: 'no_candidate_seen',
          minRequiredLevel: null,
          candidateCountBucket: '0',
          probeVersion: '1.0.0',
        },
      },
    });
  });

  it('returns an accessible coverage probe while keeping items access-filtered', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set('page-1', readyPage());
    pageChunkRepository.chunks.set('page-chunk-1', pageChunk());

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'float fishing basics',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        items: [expect.objectContaining({ title: 'Float Fishing Basics' })],
        coverageProbe: {
          classification: 'accessible_candidate_seen',
          minRequiredLevel: null,
          candidateCountBucket: '1',
          probeVersion: '1.0.0',
        },
      },
    });
  });

  it('returns a higher-level coverage probe without exposing inaccessible items', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'page-1',
      readyPage({
        access: {
          inheritedFromCategoryId: 'category-1',
          categoryAccessRevision: 'category-rev-8',
          override: null,
          effective: { gate: 'level', requiredLevel: 8, accessRevision: 'category-rev-8' },
        },
      })
    );
    pageChunkRepository.chunks.set(
      'page-chunk-1',
      pageChunk({ access: { gate: 'level', requiredLevel: 8 }, accessRevision: 'category-rev-8' })
    );

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'float fishing basics',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        items: [],
        coverageProbe: {
          classification: 'higher_level_candidate_seen',
          minRequiredLevel: 8,
          candidateCountBucket: '1',
          probeVersion: '1.0.0',
        },
      },
    });
  });

  it('returns a restricted-or-invalid coverage probe for excluded candidates', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set(
      'page-1',
      readyPage({
        access: {
          inheritedFromCategoryId: 'category-1',
          categoryAccessRevision: 'category-rev-excluded',
          override: null,
          effective: {
            gate: 'excluded',
            requiredLevel: null,
            accessRevision: 'category-rev-excluded',
          },
        },
      })
    );
    pageChunkRepository.chunks.set(
      'page-chunk-1',
      pageChunk({
        access: { gate: 'excluded', requiredLevel: null },
        accessRevision: 'category-rev-excluded',
      })
    );

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-10',
          role: 'user',
          status: 'approved',
          effectiveLevel: 10,
        },
        query: 'float fishing basics',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        items: [],
        coverageProbe: {
          classification: 'restricted_or_invalid_candidate_seen',
          minRequiredLevel: null,
          candidateCountBucket: '1',
          probeVersion: '1.0.0',
        },
      },
    });
  });

  it('excludes retrieval results with unsafe source URLs', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    const unsafeSource = {
      type: 'external' as const,
      url: 'https://127.0.0.1/admin/notes',
      label: 'Unsafe',
      importer: null,
    };
    pageRepository.pages.set('page-1', readyPage({ source: unsafeSource }));
    pageChunkRepository.chunks.set(
      'unsafe-chunk',
      pageChunk({
        id: 'unsafe-chunk',
        source: {
          type: unsafeSource.type,
          url: unsafeSource.url,
          label: unsafeSource.label,
        },
      })
    );

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-10',
          role: 'user',
          status: 'approved',
          effectiveLevel: 10,
        },
        query: 'float fishing basics',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        items: [],
        diagnostics: { searchedChunkCount: 0 },
      },
    });
  });

  it('excludes stale chunks and page/chunk access mismatches from retrieval', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set('page-1', readyPage({ chunkCount: 4 }));
    pageRepository.pages.set(
      'stale-page',
      readyPage({
        id: 'stale-page',
        nodeId: 'stale-page-node',
        accessSyncStatus: 'stale',
      })
    );
    pageChunkRepository.chunks.set('current-chunk', pageChunk({ id: 'current-chunk' }));
    pageChunkRepository.chunks.set(
      'stale-chunk',
      pageChunk({ id: 'stale-chunk', accessSyncStatus: 'stale' })
    );
    pageChunkRepository.chunks.set(
      'revision-mismatch-chunk',
      pageChunk({ id: 'revision-mismatch-chunk', accessRevision: 'category-rev-old' })
    );
    pageChunkRepository.chunks.set(
      'access-mismatch-chunk',
      pageChunk({ id: 'access-mismatch-chunk', access: { gate: 'approved', requiredLevel: null } })
    );
    pageChunkRepository.chunks.set(
      'stale-page-chunk',
      pageChunk({
        id: 'stale-page-chunk',
        pageId: 'stale-page',
        nodeId: 'stale-page-node',
      })
    );

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'float fishing basics',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.items.map((item) => item.title)).toEqual(['Float Fishing Basics']);
    expect(result.value.items[0]?.metadata).not.toHaveProperty('chunkId');
  });

  it('expands parent page chunks for summary retrieval', async () => {
    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set('page-1', readyPage({ chunkCount: 3 }));
    pageChunkRepository.chunks.set('page-chunk-1', pageChunk());
    pageChunkRepository.chunks.set(
      'page-chunk-2',
      pageChunk({
        id: 'page-chunk-2',
        index: 1,
        headingPath: ['Float Fishing Basics', 'Shotting'],
        text: 'Bulk shot above the hooklength.',
        searchableText: 'Float Fishing Basics\n\nBulk shot above the hooklength.',
      })
    );
    pageChunkRepository.chunks.set(
      'page-chunk-3',
      pageChunk({
        id: 'page-chunk-3',
        index: 2,
        headingPath: ['Float Fishing Basics', 'Presentation'],
        text: 'Hold back gently in flow.',
        searchableText: 'Float Fishing Basics\n\nHold back gently in flow.',
      })
    );

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'summary of the whole document',
        conversationContext: { latestMessages: [] },
        options: { topK: 1 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    const evidenceText = retrievedEvidenceText(result.value.items);
    expect(evidenceText).toContain('Float Fishing Basics');
    expect(evidenceText).toContain('Presentation');
    expect(evidenceText).toContain('Shotting');
    expect(result.value.diagnostics).toMatchObject({
      searchedChunkCount: 3,
      expandedItemCount: 1,
    });
  });

  it('reports embedding metadata mismatches before chunk lookup', () => {
    expect(
      embeddingResponseMismatchMessage(embeddingConfig, {
        provider: 'openai',
        model: embeddingConfig.model,
        dimensions: embeddingConfig.dimensions,
      })
    ).toBe(
      'Embedding provider response mismatch: requested openrouter qwen/qwen3-embedding-8b with 2048 dimensions, received openai qwen/qwen3-embedding-8b with 2048 dimensions.'
    );
  });

  it('reports retrieval performance timings separately from prompt-safe diagnostics', async () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(6)
      .mockReturnValueOnce(11)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(25)
      .mockReturnValueOnce(30)
      .mockReturnValueOnce(37)
      .mockReturnValueOnce(45)
      .mockReturnValueOnce(54)
      .mockReturnValueOnce(64);

    const pageRepository = new MemoryKnowledgePageRepository();
    const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
    const embeddingProvider = new FakeEmbeddingProvider();
    pageRepository.pages.set('page-1', readyPage());
    pageChunkRepository.chunks.set('page-chunk-1', pageChunk());
    const lexicalCandidateChunk = pageChunkRepository.chunks.get('page-chunk-1');
    if (lexicalCandidateChunk === undefined) {
      throw new Error('Expected lexical candidate fixture to exist');
    }
    const {
      embedding: _embedding,
      embeddingModel: _embeddingModel,
      embeddingProvider: _embeddingProvider,
      embeddingDimensions: _embeddingDimensions,
      ...projectedLexicalChunk
    } = lexicalCandidateChunk;
    vi.spyOn(pageChunkRepository, 'listRetrievableActiveLexicalCandidates').mockResolvedValue(
      ok({
        chunks: [projectedLexicalChunk],
        scannedCount: 1,
        limitHit: false,
        activeCurrentChunkCount: 1,
      })
    );

    const result = await retrieveKnowledge(
      {
        pageRepository,
        pageChunkRepository,
        embeddingProvider,
        embeddingConfig,
      },
      {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'float fishing basics',
        conversationContext: { latestMessages: [] },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.diagnostics).toMatchObject({
      embeddingModel: 'qwen/qwen3-embedding-8b',
      embeddingProvider: 'openrouter',
      embeddingDimensions: 2048,
      searchedChunkCount: 1,
      expandedItemCount: 1,
      vectorCandidateLimit: 64,
      vectorReturnedCount: 1,
      vectorReturnedEmbeddingsIncluded: true,
      lexicalScannedCount: 1,
      lexicalLimitHit: false,
      activeCurrentChunkCount: 1,
      performance: {
        totalMs: 63,
        embeddingMs: 19,
        vectorSearchMs: 5,
        lexicalFetchMs: 4,
        lexicalScoringMs: 5,
        lexicalCandidatesMs: 9,
        candidateMergeMs: 7,
        pageLookupMs: 8,
        rankingMs: 9,
        expansionMs: 10,
      },
    });
  });
});

describe('answer gap use cases', () => {
  it('rejects invalid answer gap input and invalid admin operations', async () => {
    const repository = new MemoryAnswerGapRepository();
    const invalidRequests: { input: CreateAnswerGapRequest; message: string }[] = [
      {
        input: answerGapRequest({ question: '   ' }),
        message: 'question is required',
      },
      {
        input: answerGapRequest({ missingInformation: 'nope' as never }),
        message: 'missingInformation must be an array',
      },
      {
        input: answerGapRequest({ requester: null as never }),
        message: 'requester must be an object',
      },
      {
        input: answerGapRequest({ requester: { ...answerGapRequest().requester, userId: ' ' } }),
        message: 'requester.userId is required',
      },
      {
        input: answerGapRequest({
          requester: { ...answerGapRequest().requester, email: ' ' },
        }),
        message: 'requester.email is required',
      },
      {
        input: answerGapRequest({
          requester: { ...answerGapRequest().requester, role: 'owner' as never },
        }),
        message: 'requester.role must be user or admin',
      },
      {
        input: answerGapRequest({
          requester: { ...answerGapRequest().requester, effectiveLevel: 4.5 },
        }),
        message: 'requester.effectiveLevel must be an integer',
      },
      {
        input: answerGapRequest({
          requester: { ...answerGapRequest().requester, effectiveLevel: 0 },
        }),
        message: 'requester.effectiveLevel must be a valid user level',
      },
      {
        input: answerGapRequest({ coverageProbe: null as never }),
        message: 'coverageProbe must be an object',
      },
      {
        input: answerGapRequest({
          coverageProbe: { ...answerGapRequest().coverageProbe, classification: 'secret' as never },
        }),
        message: 'coverageProbe.classification is invalid',
      },
      {
        input: answerGapRequest({
          coverageProbe: { ...answerGapRequest().coverageProbe, minRequiredLevel: '8' as never },
        }),
        message: 'coverageProbe.minRequiredLevel must be an integer or null',
      },
      {
        input: answerGapRequest({
          coverageProbe: {
            ...answerGapRequest().coverageProbe,
            candidateCountBucket: '9' as never,
          },
        }),
        message: 'coverageProbe.candidateCountBucket is invalid',
      },
      {
        input: answerGapRequest({
          coverageProbe: { ...answerGapRequest().coverageProbe, probeVersion: '2.0.0' as never },
        }),
        message: 'coverageProbe.probeVersion is invalid',
      },
      {
        input: answerGapRequest({ coverageKind: 'restricted_by_level' }),
        message: 'coverageKind is not shareable',
      },
      {
        input: answerGapRequest({ consent: null as never }),
        message: 'consent must be an object',
      },
      {
        input: answerGapRequest({
          consent: { ...answerGapRequest().consent, status: 'system_imported' },
        }),
        message: 'consent.status must be user_shared',
      },
      {
        input: answerGapRequest({
          consent: { ...answerGapRequest().consent, includeContext: 'yes' as never },
        }),
        message: 'consent.includeContext must be a boolean',
      },
      {
        input: answerGapRequest({
          conversation: { ...answerGapRequest().conversation, conversationId: ' ' },
        }),
        message: 'conversation.conversationId is required',
      },
      {
        input: answerGapRequest({
          conversation: { ...answerGapRequest().conversation, contextWindow: null as never },
        }),
        message: 'conversation.contextWindow must be an array',
      },
      {
        input: answerGapRequest({
          conversation: { ...answerGapRequest().conversation, contextWindow: [null as never] },
        }),
        message: 'conversation.contextWindow[0] must be an object',
      },
      {
        input: answerGapRequest({
          conversation: {
            ...answerGapRequest().conversation,
            contextWindow: [{ role: 'system' as never, content: 'bad role' }],
          },
        }),
        message: 'conversation.contextWindow[0].role is invalid',
      },
      {
        input: answerGapRequest({
          conversation: {
            ...answerGapRequest().conversation,
            contextWindow: [{ role: 'user', content: 42 as never }],
          },
        }),
        message: 'conversation.contextWindow[0].content must be a string',
      },
    ];

    for (const item of invalidRequests) {
      await expect(
        createAnswerGap({ answerGapRepository: repository, clock }, item.input),
        item.message
      ).resolves.toEqual({
        ok: false,
        error: { code: 'INVALID_REQUEST', message: item.message },
      });
    }

    await expect(
      listAnswerGaps({ answerGapRepository: repository }, { status: 'done' })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Answer Gap status filter is invalid' },
    });
    await expect(
      listAnswerGaps({ answerGapRepository: repository }, { limit: 0 })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Answer Gap limit must be between 1 and 100' },
    });
    await expect(
      listAnswerGaps({ answerGapRepository: repository }, { cursor: 'not-json' })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Answer Gap cursor is invalid' },
    });
    await expect(
      markAnswerGapDone(
        { answerGapRepository: repository, clock },
        { gapId: ' ', adminUserId: 'admin-1' }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'gapId is required' },
    });
    await expect(
      markAnswerGapDone(
        { answerGapRepository: repository, clock },
        { gapId: 'gap-1', adminUserId: ' ' }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'adminUserId is required' },
    });
    await expect(
      markAnswerGapDone(
        { answerGapRepository: repository, clock },
        { gapId: 'missing-gap', adminUserId: 'admin-1' }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Answer Gap missing-gap not found' },
    });
  });

  it('maps answer gap repository failures to use-case errors', async () => {
    const repository = {
      getById: () => Promise.resolve(err({ code: 'VALIDATION_ERROR', message: 'bad gap id' })),
      create: () => Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'create failed' })),
      update: () => Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'update failed' })),
      list: () => Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'list failed' })),
    } satisfies AnswerGapRepository;

    await expect(
      createAnswerGap({ answerGapRepository: repository, clock }, answerGapRequest())
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'bad gap id' },
    });
    await expect(listAnswerGaps({ answerGapRepository: repository }, {})).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'list failed' },
    });
    await expect(
      markAnswerGapDone(
        { answerGapRepository: repository, clock },
        { gapId: 'gap-1', adminUserId: 'admin-1' }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'bad gap id' },
    });
  });

  it('clips stored question, context, and missing information text', async () => {
    const repository = new MemoryAnswerGapRepository();
    const longQuestion = `  ${'Q'.repeat(2_100)}  `;
    const longContext = Array.from({ length: 10 }, (_value, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `${String(index)}:${'C'.repeat(1_300)}`,
    }));
    const longMissingInformation = Array.from(
      { length: 10 },
      (_value, index) => `${String(index)}:${'M'.repeat(600)}`
    );

    const result = await createAnswerGap(
      { answerGapRepository: repository, clock },
      answerGapRequest({
        question: longQuestion,
        missingInformation: longMissingInformation,
        conversation: {
          ...answerGapRequest().conversation,
          contextWindow: longContext,
        },
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.gap.question).toHaveLength(2_000);
    expect(result.value.gap.question.startsWith('Q')).toBe(true);
    expect(result.value.gap.conversation.contextWindow).toHaveLength(8);
    expect(result.value.gap.conversation.contextWindow[0]?.content).toHaveLength(1_200);
    expect(result.value.gap.missingInformation).toHaveLength(8);
    expect(result.value.gap.missingInformation[0]).toHaveLength(500);
  });

  it('stores explicit consent and redacts contact/context when consent excludes them', async () => {
    const repository = new MemoryAnswerGapRepository();

    const result = await createAnswerGap(
      { answerGapRepository: repository, clock },
      answerGapRequest({
        requester: {
          userId: 'user-1',
          email: 'user@example.com',
          firstName: 'River',
          lastName: 'Walker',
          role: 'user',
          effectiveLevel: 4,
        },
        conversation: {
          ...answerGapRequest().conversation,
          contextWindow: [{ role: 'user', content: 'My sensitive fishing context.' }],
        },
        consent: {
          status: 'user_shared',
          sharedAt: '2026-06-14T11:59:00.000Z',
          includeContext: false,
          includeContact: false,
          candidateId: 'answer-gap-candidate-assistant_message-1',
        },
      })
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        gap: {
          requester: {
            userId: 'anonymous-answer-gap-candidate-assistant_message-1',
            email: null,
            firstName: null,
            lastName: null,
            effectiveLevel: 4,
          },
          conversation: { contextWindow: [] },
          coverageKind: 'global_no_candidate_seen',
          consent: {
            status: 'user_shared',
            includeContext: false,
            includeContact: false,
            candidateId: 'answer-gap-candidate-assistant_message-1',
          },
        },
      },
    });
  });

  it('withdraws shared answer gap consent by redacting requester contact and context', async () => {
    const repository = new MemoryAnswerGapRepository();
    const created = await createAnswerGap(
      { answerGapRepository: repository, clock },
      answerGapRequest()
    );
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    const result = await withdrawAnswerGapConsent(
      { answerGapRepository: repository, clock },
      {
        gapId: created.value.gap.id,
        candidateId: 'answer-gap-candidate-assistant_message-1',
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        gap: {
          requester: {
            userId: 'anonymous-answer-gap-candidate-assistant_message-1',
            email: null,
            firstName: null,
            lastName: null,
            effectiveLevel: 4,
          },
          conversation: { contextWindow: [] },
          consent: {
            status: 'user_withdrew',
            withdrawnAt: '2026-06-14T12:00:00.000Z',
            includeContext: false,
            includeContact: false,
          },
          updatedAt: '2026-06-14T12:00:00.000Z',
        },
      },
    });
  });

  it('treats repeated answer gap consent withdrawal as idempotent', async () => {
    const repository = new MemoryAnswerGapRepository();
    let now = '2026-06-14T12:00:00.000Z';
    const mutableClock: Clock = { now: () => new Date(now) };
    const created = await createAnswerGap(
      { answerGapRepository: repository, clock: mutableClock },
      answerGapRequest()
    );
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    const first = await withdrawAnswerGapConsent(
      { answerGapRepository: repository, clock: mutableClock },
      {
        gapId: created.value.gap.id,
        candidateId: 'answer-gap-candidate-assistant_message-1',
      }
    );
    now = '2026-06-14T12:05:00.000Z';
    const second = await withdrawAnswerGapConsent(
      { answerGapRepository: repository, clock: mutableClock },
      {
        gapId: created.value.gap.id,
        candidateId: 'answer-gap-candidate-assistant_message-1',
      }
    );

    expect(first).toMatchObject({
      ok: true,
      value: {
        gap: {
          consent: { withdrawnAt: '2026-06-14T12:00:00.000Z' },
          updatedAt: '2026-06-14T12:00:00.000Z',
        },
      },
    });
    expect(second).toMatchObject({
      ok: true,
      value: {
        gap: {
          consent: { withdrawnAt: '2026-06-14T12:00:00.000Z' },
          updatedAt: '2026-06-14T12:00:00.000Z',
        },
      },
    });
  });

  it('formulates the admin question deterministically without calling an LLM', async () => {
    const repository = new MemoryAnswerGapRepository();

    const result = await createAnswerGap(
      { answerGapRepository: repository, clock },
      answerGapRequest({ question: '  What rig should I use?  ' })
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        created: true,
        gap: {
          formulatedQuestion:
            'Add or adjust Knowledge Base content so FA can answer: "What rig should I use?"',
        },
      },
    });
  });

  it('is idempotent by assistant message id', async () => {
    const repository = new MemoryAnswerGapRepository();
    const first = await createAnswerGap(
      { answerGapRepository: repository, clock },
      answerGapRequest({ question: 'First question?' })
    );
    const duplicate = await createAnswerGap(
      { answerGapRepository: repository, clock },
      answerGapRequest({ question: 'Second question?', missingInformation: ['Different gap'] })
    );

    expect(first).toMatchObject({ ok: true, value: { created: true } });
    expect(duplicate).toMatchObject({
      ok: true,
      value: {
        created: false,
        gap: {
          question: 'First question?',
          missingInformation: [
            'No accessible Knowledge Base evidence covers winter canal fishing.',
          ],
        },
      },
    });
  });

  it('lists needs-answer gaps by default', async () => {
    const repository = new MemoryAnswerGapRepository();
    await createAnswerGap(
      { answerGapRepository: repository, clock },
      answerGapRequest({
        conversation: { ...answerGapRequest().conversation, assistantMessageId: 'assistant-1' },
      })
    );
    const done = await createAnswerGap(
      { answerGapRepository: repository, clock },
      answerGapRequest({
        question: 'Already answered?',
        conversation: { ...answerGapRequest().conversation, assistantMessageId: 'assistant-2' },
      })
    );
    if (!done.ok) {
      throw new Error(done.error.message);
    }
    await markAnswerGapDone(
      { answerGapRepository: repository, clock },
      { gapId: done.value.gap.id, adminUserId: 'admin-1' }
    );

    const listed = await listAnswerGaps({ answerGapRepository: repository }, {});

    expect(listed).toMatchObject({
      ok: true,
      value: {
        gaps: [expect.objectContaining({ question: 'How should I fish a canal in February?' })],
        nextCursor: null,
        totalCount: 1,
      },
    });
  });

  it('rejects cursors created for a different list filter', async () => {
    const repository = new MemoryAnswerGapRepository();
    const cursor = encodeAnswerGapCursor({
      filter: 'needs_answer',
      createdAt: '2026-06-14T12:00:00.000Z',
      id: 'answer-gap-assistant-1',
    });

    const result = await listAnswerGaps(
      { answerGapRepository: repository },
      { status: 'all', cursor }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Answer Gap cursor filter does not match the requested filter',
      },
    });
  });

  it('marks gaps done idempotently', async () => {
    let now = '2026-06-14T12:00:00.000Z';
    const mutableClock: Clock = { now: () => new Date(now) };
    const repository = new MemoryAnswerGapRepository();
    const created = await createAnswerGap(
      { answerGapRepository: repository, clock: mutableClock },
      answerGapRequest()
    );
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    now = '2026-06-15T12:00:00.000Z';
    const first = await markAnswerGapDone(
      { answerGapRepository: repository, clock: mutableClock },
      { gapId: created.value.gap.id, adminUserId: 'admin-1' }
    );
    now = '2026-06-16T12:00:00.000Z';
    const second = await markAnswerGapDone(
      { answerGapRepository: repository, clock: mutableClock },
      { gapId: created.value.gap.id, adminUserId: 'admin-2' }
    );

    expect(first).toMatchObject({
      ok: true,
      value: {
        gap: { status: 'done', doneAt: '2026-06-15T12:00:00.000Z', doneByUserId: 'admin-1' },
      },
    });
    expect(second).toEqual(first);
  });
});
