import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuthorizationResolveResponse, InternalUserIdentitySummary } from '@fa/http-contracts';
import type { EmbeddingRequest, EmbeddingResponse, LlmEmbeddingProvider } from '@fa/llm-contract';

import type {
  KnowledgeAccessRefreshJob,
  KnowledgeNode,
  KnowledgePage,
  KnowledgePageChunk,
} from '../domain/models/knowledge.js';
import { createServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import {
  MemoryKnowledgeAccessRefreshRepository,
  MemoryKnowledgeNodeRepository,
  MemoryKnowledgePageChunkRepository,
  MemoryKnowledgePageRepository,
} from '../infra/memory/memoryKnowledgeRepositories.js';
import { MemoryAnswerGapRepository } from '../infra/memory/memoryAnswerGapRepository.js';
import { publicEvidenceId } from '../domain/usecases/sourceRefs.js';

const approvedAuthHeaders = { authorization: 'Bearer approved-test-user' } as const;
const embeddingConfig = {
  provider: 'openrouter',
  model: 'qwen/qwen3-embedding-8b',
  dimensions: 2048,
} as const;

function expectObjectContaining(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

class FakeEmbeddingProvider implements LlmEmbeddingProvider {
  readonly requests: EmbeddingRequest[] = [];

  constructor(
    private readonly options: {
      responseProvider?: string;
      responseModel?: string;
      responseDimensions?: number;
      vectors?: number[][];
    } = {}
  ) {}

  embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    this.requests.push(request);
    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    const dimensions = this.options.responseDimensions ?? request.dimensions ?? 2048;
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

function configureAuthEnv(): void {
  process.env['NODE_ENV'] = 'test';
  process.env['FA_AUTH0_ISSUER'] = 'https://auth.example.com/';
  process.env['FA_AUTH0_AUDIENCE'] = 'https://api.fishing-assistant.online';
  process.env['FA_AUTH0_JWKS_URI'] = 'https://auth.example.com/.well-known/jwks.json';
  process.env['FA_INTERNAL_AUTH_TOKEN'] = 'internal-token';
}

function approvedResolverResponse(role: 'admin' | 'user' = 'admin'): AuthorizationResolveResponse {
  return {
    state: 'approved',
    user: {
      id: 'admin-user-1',
      email: 'admin@example.com',
      firstName: 'River',
      lastName: 'Tester',
      mobileNumber: '+15550101000',
      role,
      status: 'approved',
      level: 6,
      effectiveLevel: 6,
    },
    authorization: {
      userId: 'admin-user-1',
      auth0Subject: 'auth0|admin-user-1',
      email: 'admin@example.com',
      role,
      status: 'approved',
      effectiveLevel: 6,
    },
  };
}

function node(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return {
    id: 'page-node-1',
    type: 'page',
    status: 'active',
    title: 'Pellet Choices',
    slug: 'pellet-choices',
    sortIndex: 0,
    parentId: 'section-1',
    categoryId: 'category-1',
    sectionId: 'section-1',
    pageId: 'page-1',
    depth: 3,
    pathIds: ['root', 'category-1', 'section-1', 'page-node-1'],
    pathTitles: ['Knowledge Base', 'Method Feeder', 'Hooks', 'Pellet Choices'],
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

function page(overrides: Partial<KnowledgePage> = {}): KnowledgePage {
  return {
    id: 'page-1',
    nodeId: 'page-node-1',
    status: 'active',
    title: 'Pellet Choices',
    slug: 'pellet-choices',
    categoryId: 'category-1',
    sectionId: 'section-1',
    pathIds: ['root', 'category-1', 'section-1', 'page-node-1'],
    pathTitles: ['Knowledge Base', 'Method Feeder', 'Hooks', 'Pellet Choices'],
    hierarchy: { category: 'Method Feeder', section: 'Hooks' },
    source: {
      type: 'external',
      url: 'https://example.com/public/pellet-choices',
      label: 'Example',
      importer: null,
    },
    access: {
      inheritedFromCategoryId: 'category-1',
      categoryAccessRevision: 'category-rev-1',
      override: null,
      effective: { gate: 'approved', requiredLevel: null, accessRevision: 'category-rev-1' },
    },
    relations: { relatedTo: [], linksTo: [], supersedes: [] },
    markdown: '# Pellet Choices\n\nUse soaked pellets in cold water.',
    normalizedMarkdown: '# Pellet Choices\n\nUse soaked pellets in cold water.',
    markdownContentHash: 'hash-page-1',
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

function categoryNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return node({
    id: 'category-1',
    type: 'category',
    title: 'Method Feeder',
    slug: 'method-feeder',
    parentId: 'root',
    categoryId: 'category-1',
    sectionId: null,
    pageId: null,
    depth: 1,
    pathIds: ['root', 'category-1'],
    pathTitles: ['Knowledge Base', 'Method Feeder'],
    categoryAccess: { gate: 'approved', requiredLevel: null, accessRevision: 'category-rev-1' },
    ...overrides,
  });
}

function sectionNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return node({
    id: 'section-1',
    type: 'section',
    title: 'Hooks',
    slug: 'hooks',
    parentId: 'category-1',
    categoryId: 'category-1',
    sectionId: 'section-1',
    pageId: null,
    depth: 2,
    pathIds: ['root', 'category-1', 'section-1'],
    pathTitles: ['Knowledge Base', 'Method Feeder', 'Hooks'],
    categoryAccess: null,
    ...overrides,
  });
}

function pageChunk(overrides: Partial<KnowledgePageChunk> = {}): KnowledgePageChunk {
  return {
    id: 'page-chunk-1',
    status: 'active',
    pageId: 'page-1',
    nodeId: 'page-node-1',
    categoryId: 'category-1',
    sectionId: 'section-1',
    title: 'Pellet Choices',
    path: ['Knowledge Base', 'Method Feeder', 'Hooks', 'Pellet Choices'],
    headingPath: ['Pellet Choices'],
    index: 0,
    text: 'Use soaked pellets in cold water.',
    searchableText: 'Pellet Choices\n\nUse soaked pellets in cold water.',
    markdownContentHash: 'hash-page-1',
    access: { gate: 'approved', requiredLevel: null },
    accessRevision: 'category-rev-1',
    accessSyncStatus: 'current',
    source: {
      type: 'external',
      url: 'https://example.com/public/pellet-choices',
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

function adminRequesterIdentity(): InternalUserIdentitySummary {
  return {
    id: 'admin-user-1',
    email: 'admin@example.com',
    firstName: 'River',
    lastName: 'Tester',
    role: 'admin',
    status: 'approved',
    effectiveLevel: 6,
  };
}

function answerGapPayload(overrides: Record<string, unknown> = {}) {
  return {
    source: 'no_accessible_evidence',
    question: 'How should I fish a canal in February?',
    missingInformation: ['No accessible Knowledge Base evidence covers winter canal fishing.'],
    requester: {
      userId: 'user-1',
      email: 'user@example.com',
      firstName: 'River',
      lastName: 'Walker',
      role: 'user',
      effectiveLevel: 4,
    },
    conversation: {
      conversationId: 'conversation-1',
      userMessageId: 'user-message-1',
      assistantMessageId: 'assistant/message-1',
      contextWindow: [{ role: 'user', content: 'How should I fish a canal in February?' }],
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

function accessRefreshJob(
  overrides: Partial<KnowledgeAccessRefreshJob> = {}
): KnowledgeAccessRefreshJob {
  return {
    id: 'access-job-1',
    status: 'failed',
    kind: 'category_access_changed',
    target: { categoryId: 'category-1', pageId: null },
    requestedAccessRevision: 'category-rev-1',
    actorAdminUserId: 'admin-user-1',
    priority: 0,
    attempts: 3,
    maxAttempts: 5,
    nextRunAt: '2026-06-14T12:00:00.000Z',
    leaseOwnerId: null,
    leaseExpiresAt: null,
    processedPageCount: 0,
    processedChunkCount: 0,
    lastError: {
      code: 'VALIDATION_ERROR',
      message: 'Access refresh failed closed',
      occurredAt: '2026-06-14T11:59:00.000Z',
    },
    createdAt: '2026-06-14T11:55:00.000Z',
    updatedAt: '2026-06-14T11:59:00.000Z',
    startedAt: '2026-06-14T11:58:00.000Z',
    finishedAt: '2026-06-14T11:59:00.000Z',
    ...overrides,
  };
}

async function createAuthedHarness(
  options: {
    role?: 'admin' | 'user';
    nodes?: KnowledgeNode[];
    pages?: KnowledgePage[];
    chunks?: KnowledgePageChunk[];
    accessRefreshJobs?: KnowledgeAccessRefreshJob[];
    queryEmbeddingProvider?: LlmEmbeddingProvider;
    syncEmbeddingProvider?: LlmEmbeddingProvider;
    generateId?: () => string;
    requesterIdentities?: InternalUserIdentitySummary[];
  } = {}
) {
  const pageRepository = new MemoryKnowledgePageRepository();
  const pageChunkRepository = new MemoryKnowledgePageChunkRepository(pageRepository);
  const nodeRepository = new MemoryKnowledgeNodeRepository();
  for (const seededNode of options.nodes ?? [categoryNode(), sectionNode(), node()]) {
    nodeRepository.nodes.set(seededNode.id, seededNode);
  }
  for (const seededPage of options.pages ?? [page()]) {
    pageRepository.pages.set(seededPage.id, seededPage);
  }
  for (const seededChunk of options.chunks ?? [pageChunk()]) {
    pageChunkRepository.chunks.set(seededChunk.id, seededChunk);
  }
  const accessRefreshRepository = new MemoryKnowledgeAccessRefreshRepository({
    pages: pageRepository,
    chunks: pageChunkRepository,
  });
  const answerGapRepository = new MemoryAnswerGapRepository();
  for (const job of options.accessRefreshJobs ?? []) {
    accessRefreshRepository.jobs.set(job.id, job);
  }
  const embeddingProvider = new FakeEmbeddingProvider();
  const queryEmbeddingProvider = options.queryEmbeddingProvider ?? new FakeEmbeddingProvider();
  const syncEmbeddingProvider = options.syncEmbeddingProvider ?? new FakeEmbeddingProvider();
  let generatedId = 0;
  setServices({
    accessRefreshRepository,
    answerGapRepository,
    pageRepository,
    pageChunkRepository,
    nodeRepository,
    embeddingProvider,
    queryEmbeddingProvider,
    syncEmbeddingProvider,
    embeddingConfig,
    clock: { now: () => new Date('2026-06-14T12:00:00.000Z') },
    generateId: options.generateId ?? (() => `generated-${String(++generatedId)}`),
    auth0JwtVerifier: (headers) =>
      Promise.resolve(
        headers['authorization'] === approvedAuthHeaders.authorization
          ? {
              ok: true as const,
              identity: {
                subject: 'auth0|admin-user-1',
                email: 'admin@example.com',
                emailVerified: true,
                name: 'Route Tester',
              },
            }
          : {
              ok: false as const,
              error: { statusCode: 401, code: 'UNAUTHORIZED', message: 'Unauthorized' },
            }
      ),
    userServiceClient: {
      resolveAuthorization: () =>
        Promise.resolve(approvedResolverResponse(options.role ?? 'admin')),
      lookupUserIdentities: ({ userIds }) =>
        Promise.resolve({
          users: (options.requesterIdentities ?? [adminRequesterIdentity()]).filter((identity) =>
            userIds.includes(identity.id)
          ),
        }),
    },
  });
  return {
    app: await createServer(),
    accessRefreshRepository,
    answerGapRepository,
    nodeRepository,
    pageRepository,
    pageChunkRepository,
    embeddingProvider,
    queryEmbeddingProvider,
    syncEmbeddingProvider,
  };
}

async function createAuthedServer(role: 'admin' | 'user' = 'admin') {
  const harness = await createAuthedHarness({ role });
  return harness.app;
}

describe('knowledge-service routes', () => {
  beforeEach(() => {
    configureAuthEnv();
  });

  afterEach(() => {
    resetServices();
    delete process.env['FA_INTERNAL_AUTH_TOKEN'];
    delete process.env['FA_INTERNAL_AUTH_TOKEN_PREVIOUS'];
    delete process.env['FA_AUTH0_ISSUER'];
    delete process.env['FA_AUTH0_AUDIENCE'];
    delete process.env['FA_AUTH0_JWKS_URI'];
  });

  it('serves the admin knowledge tree for approved admins', async () => {
    const app = await createAuthedServer('admin');

    const response = await app.inject({
      method: 'GET',
      url: '/admin/tree',
      headers: approvedAuthHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: {
        root: expectObjectContaining({
          id: 'root',
          title: 'Knowledge Base',
        }),
      },
    });
  });

  it.each([
    {
      method: 'GET' as const,
      url: '/admin/answer-gaps',
    },
    {
      method: 'POST' as const,
      url: '/admin/answer-gaps/answer-gap-1/done',
      payload: {},
    },
    {
      method: 'GET' as const,
      url: '/admin/tree',
    },
    {
      method: 'GET' as const,
      url: '/admin/access-refresh/status',
    },
    {
      method: 'POST' as const,
      url: '/admin/access-refresh/jobs/access-job-1/retry',
      payload: {},
    },
    {
      method: 'POST' as const,
      url: '/admin/categories',
      payload: {
        title: 'River Pike',
        access: { gate: 'approved', requiredLevel: null },
        sortIndex: 2,
      },
    },
    {
      method: 'PATCH' as const,
      url: '/admin/categories/category-1',
      payload: { title: 'River Pike', sortIndex: 2 },
    },
    {
      method: 'PATCH' as const,
      url: '/admin/categories/category-1/access',
      payload: {
        expectedAccessRevision: 'category-rev-1',
        access: { gate: 'level', requiredLevel: 7 },
      },
    },
    {
      method: 'DELETE' as const,
      url: '/admin/categories/category-1',
      payload: {},
    },
    {
      method: 'POST' as const,
      url: '/admin/categories/category-1/sections',
      payload: { title: 'Summer Banks', sortIndex: 1 },
    },
    {
      method: 'PATCH' as const,
      url: '/admin/sections/section-1',
      payload: { title: 'Summer Banks', sortIndex: 1 },
    },
    {
      method: 'DELETE' as const,
      url: '/admin/sections/section-1',
      payload: {},
    },
    {
      method: 'POST' as const,
      url: '/admin/pages',
      payload: {
        categoryId: 'category-1',
        sectionId: 'section-1',
        title: 'Pellet Choices',
        slug: 'pellet-choices',
        markdown: '# Pellet Choices\n\nUse soaked pellets in cold water.',
        sortIndex: 0,
        source: { type: 'external', url: 'https://example.com/pellet-choices' },
      },
    },
    {
      method: 'GET' as const,
      url: '/admin/pages/page-1',
    },
    {
      method: 'PATCH' as const,
      url: '/admin/pages/page-1',
      payload: {
        title: 'Pellet Choices',
        slug: 'pellet-choices',
        markdown: '# Pellet Choices\n\nUse soaked pellets in cold water.',
        sortIndex: 0,
        source: { type: 'external', url: 'https://example.com/pellet-choices' },
      },
    },
    {
      method: 'DELETE' as const,
      url: '/admin/pages/page-1',
      payload: {},
    },
    {
      method: 'POST' as const,
      url: '/admin/pages/page-1/sync',
      payload: {},
    },
    {
      method: 'POST' as const,
      url: '/admin/pages/page-1/reindex',
      payload: {},
    },
    {
      method: 'POST' as const,
      url: '/admin/sync',
      payload: { mode: 'all' },
    },
  ])('rejects approved non-admin users for $method $url', async ({ method, payload, url }) => {
    const app = await createAuthedServer('user');

    const response = await app.inject({
      method,
      url,
      headers: approvedAuthHeaders,
      ...(payload === undefined ? {} : { payload }),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('rejects admin routes without a valid bearer token', async () => {
    const app = await createAuthedServer('admin');

    const response = await app.inject({
      method: 'GET',
      url: '/admin/tree',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
  });

  it('rejects internal retrieve without valid internal auth', async () => {
    const app = await createAuthedServer('admin');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/retrieve',
      headers: { 'x-internal-auth': 'wrong-token' },
      payload: {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'pellet choices',
        conversationContext: { latestMessages: [] },
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
  });

  it('serves internal retrieve through page-backed RAG only', async () => {
    const app = await createAuthedServer('admin');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/retrieve',
      headers: { 'x-internal-auth': 'internal-token' },
      payload: {
        authorization: {
          userId: 'user-6',
          role: 'user',
          status: 'approved',
          effectiveLevel: 6,
        },
        query: 'pellet choices',
        conversationContext: { latestMessages: [] },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: {
        items: [
          expectObjectContaining({
            metadata: expectObjectContaining({ headingPath: ['Pellet Choices'] }),
          }),
        ],
        diagnostics: expectObjectContaining({
          performance: expectObjectContaining({
            totalMs: expect.any(Number),
            embeddingMs: expect.any(Number),
            vectorSearchMs: expect.any(Number),
            lexicalFetchMs: expect.any(Number),
            lexicalScoringMs: expect.any(Number),
            lexicalCandidatesMs: expect.any(Number),
            candidateMergeMs: expect.any(Number),
            pageLookupMs: expect.any(Number),
            rankingMs: expect.any(Number),
            expansionMs: expect.any(Number),
          }),
        }),
      },
    });
  });

  it('opens a retrievable knowledge source for approved users', async () => {
    const { app } = await createAuthedHarness();

    const response = await app.inject({
      method: 'GET',
      url: '/source?sourceRef=knowledge-page:page-1',
      headers: approvedAuthHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: {
        id: 'page-1',
        sourceId: 'knowledge-page:page-1',
        title: 'Pellet Choices',
        content: '# Pellet Choices\n\nUse soaked pellets in cold water.',
        updatedAt: '2026-06-14T12:00:00.000Z',
        access: {
          gate: 'approved',
          requiredLevel: null,
          retrievalReady: true,
        },
      },
    });
  });

  it('opens a retrievable knowledge source by public evidence digest', async () => {
    const sourcePage = page();
    const sourceChunk = pageChunk();
    const sourceRef = publicEvidenceId({ page: sourcePage, chunk: sourceChunk });
    const { app } = await createAuthedHarness({
      pages: [sourcePage],
      chunks: [sourceChunk],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/source?sourceRef=${encodeURIComponent(`knowledge-service\u0000${sourceRef}`)}`,
      headers: approvedAuthHeaders,
    });

    expect(sourceRef).toMatch(/^knowledge-page:[a-f0-9]{24}$/u);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: {
        id: 'page-1',
        sourceId: 'knowledge-page:page-1',
        title: 'Pellet Choices',
        content: '# Pellet Choices\n\nUse soaked pellets in cold water.',
      },
    });
  });

  it('blocks knowledge source opens when the user cannot retrieve the page', async () => {
    const { app } = await createAuthedHarness({
      pages: [
        page({
          access: {
            inheritedFromCategoryId: 'category-1',
            categoryAccessRevision: 'category-rev-1',
            override: null,
            effective: { gate: 'level', requiredLevel: 7, accessRevision: 'category-rev-1' },
          },
        }),
      ],
      chunks: [
        pageChunk({
          access: { gate: 'level', requiredLevel: 7 },
          accessRevision: 'category-rev-1',
          accessSyncStatus: 'current',
        }),
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/source?sourceRef=knowledge-page:page-1',
      headers: approvedAuthHeaders,
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects internal answer gap create without valid internal auth', async () => {
    const app = await createAuthedServer('admin');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/answer-gaps',
      headers: { 'x-internal-auth': 'wrong-token' },
      payload: answerGapPayload(),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
  });

  it('creates answer gaps internally and treats duplicate assistant messages as idempotent', async () => {
    const app = await createAuthedServer('admin');

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/internal/answer-gaps',
      headers: { 'x-internal-auth': 'internal-token' },
      payload: answerGapPayload(),
    });
    const duplicateResponse = await app.inject({
      method: 'POST',
      url: '/internal/answer-gaps',
      headers: { 'x-internal-auth': 'internal-token' },
      payload: answerGapPayload({ question: 'Different duplicate question?' }),
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json()).toMatchObject({
      ok: true,
      data: {
        created: true,
        gap: {
          id: 'answer-gap-assistant_message-1',
          question: 'How should I fish a canal in February?',
          status: 'needs_answer',
          origin: { reason: 'no_accessible_evidence' },
          coverageKind: 'global_no_candidate_seen',
          consent: {
            status: 'user_shared',
            includeContext: true,
            includeContact: true,
          },
          requester: {
            firstName: 'River',
            lastName: 'Walker',
          },
        },
      },
    });
    expect(duplicateResponse.statusCode).toBe(200);
    expect(duplicateResponse.json()).toMatchObject({
      ok: true,
      data: {
        created: false,
        gap: {
          question: 'How should I fish a canal in February?',
        },
      },
    });

    const withdrawalResponse = await app.inject({
      method: 'POST',
      url: '/internal/answer-gaps/answer-gap-assistant_message-1/consent-withdrawal',
      headers: { 'x-internal-auth': 'internal-token' },
      payload: { candidateId: 'answer-gap-candidate-assistant_message-1' },
    });

    expect(withdrawalResponse.statusCode).toBe(200);
    expect(withdrawalResponse.json()).toMatchObject({
      ok: true,
      data: {
        gap: {
          id: 'answer-gap-assistant_message-1',
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
            includeContext: false,
            includeContact: false,
            withdrawnAt: '2026-06-14T12:00:00.000Z',
          },
        },
      },
    });
  });

  it('lists answer gaps with default needs-answer filter and all filter', async () => {
    const app = await createAuthedServer('admin');
    await app.inject({
      method: 'POST',
      url: '/internal/answer-gaps',
      headers: { 'x-internal-auth': 'internal-token' },
      payload: answerGapPayload(),
    });
    await app.inject({
      method: 'POST',
      url: '/internal/answer-gaps',
      headers: { 'x-internal-auth': 'internal-token' },
      payload: answerGapPayload({
        question: 'Already covered?',
        conversation: {
          ...answerGapPayload().conversation,
          assistantMessageId: 'assistant-message-2',
        },
      }),
    });

    const doneResponse = await app.inject({
      method: 'POST',
      url: '/admin/answer-gaps/answer-gap-assistant-message-2/done',
      headers: approvedAuthHeaders,
      payload: {},
    });
    const defaultListResponse = await app.inject({
      method: 'GET',
      url: '/admin/answer-gaps',
      headers: approvedAuthHeaders,
    });
    const allListResponse = await app.inject({
      method: 'GET',
      url: '/admin/answer-gaps?status=all',
      headers: approvedAuthHeaders,
    });

    expect(doneResponse.statusCode).toBe(200);
    expect(defaultListResponse.statusCode).toBe(200);
    expect(defaultListResponse.json()).toMatchObject({
      ok: true,
      data: {
        gaps: [expectObjectContaining({ id: 'answer-gap-assistant_message-1' })],
        nextCursor: null,
        totalCount: 1,
      },
    });
    expect(allListResponse.statusCode).toBe(200);
    expect(allListResponse.json()).toMatchObject({
      ok: true,
      data: {
        gaps: [
          expectObjectContaining({ id: 'answer-gap-assistant_message-1' }),
          expectObjectContaining({ id: 'answer-gap-assistant-message-2' }),
        ],
        totalCount: 2,
      },
    });
  });

  it('enriches historical answer gap requester identities on admin lists', async () => {
    const { app: enrichedApp } = await createAuthedHarness({
      requesterIdentities: [
        {
          id: 'historical-user',
          email: 'historical@example.com',
          firstName: 'Codex',
          lastName: 'Tester',
          role: 'user',
          status: 'approved',
          effectiveLevel: 7,
        },
      ],
    });
    const createResponse = await enrichedApp.inject({
      method: 'POST',
      url: '/internal/answer-gaps',
      headers: { 'x-internal-auth': 'internal-token' },
      payload: answerGapPayload({
        requester: {
          userId: 'historical-user',
          email: 'historical@example.com',
          role: 'user',
          effectiveLevel: 4,
        },
      }),
    });
    expect(createResponse.statusCode).toBe(200);

    const response = await enrichedApp.inject({
      method: 'GET',
      url: '/admin/answer-gaps',
      headers: approvedAuthHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: {
        gaps: [
          expectObjectContaining({
            requester: expectObjectContaining({
              userId: 'historical-user',
              email: 'historical@example.com',
              firstName: 'Codex',
              lastName: 'Tester',
              effectiveLevel: 4,
            }),
          }),
        ],
      },
    });
  });

  it('does not enrich answer gap requester identities when contact sharing was declined', async () => {
    const { app: enrichedApp } = await createAuthedHarness({
      requesterIdentities: [
        {
          id: 'contact-hidden-user',
          email: 'contact-hidden@example.test',
          firstName: 'Casey',
          lastName: 'Angler',
          role: 'user',
          status: 'approved',
          effectiveLevel: 7,
        },
      ],
    });
    const createResponse = await enrichedApp.inject({
      method: 'POST',
      url: '/internal/answer-gaps',
      headers: { 'x-internal-auth': 'internal-token' },
      payload: answerGapPayload({
        requester: {
          userId: 'contact-hidden-user',
          email: null,
          firstName: null,
          lastName: null,
          role: 'user',
          effectiveLevel: 4,
        },
        conversation: { ...answerGapPayload().conversation, contextWindow: [] },
        consent: {
          status: 'user_shared',
          sharedAt: '2026-06-14T11:59:00.000Z',
          includeContext: false,
          includeContact: false,
          candidateId: 'answer-gap-candidate-assistant_message-1',
        },
      }),
    });
    expect(createResponse.statusCode).toBe(200);

    const response = await enrichedApp.inject({
      method: 'GET',
      url: '/admin/answer-gaps',
      headers: approvedAuthHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: {
        gaps: [
          expectObjectContaining({
            requester: expectObjectContaining({
              userId: 'anonymous-answer-gap-candidate-assistant_message-1',
              email: null,
              firstName: null,
              lastName: null,
              effectiveLevel: 4,
            }),
            conversation: expectObjectContaining({ contextWindow: [] }),
            consent: expectObjectContaining({
              includeContext: false,
              includeContact: false,
            }),
          }),
        ],
      },
    });
  });

  it('rejects answer gap cursors from a different filter', async () => {
    const app = await createAuthedServer('admin');
    await app.inject({
      method: 'POST',
      url: '/internal/answer-gaps',
      headers: { 'x-internal-auth': 'internal-token' },
      payload: answerGapPayload(),
    });
    await app.inject({
      method: 'POST',
      url: '/internal/answer-gaps',
      headers: { 'x-internal-auth': 'internal-token' },
      payload: answerGapPayload({
        question: 'Second gap?',
        conversation: {
          ...answerGapPayload().conversation,
          assistantMessageId: 'assistant-message-2',
        },
      }),
    });

    const firstPage = await app.inject({
      method: 'GET',
      url: '/admin/answer-gaps?limit=1',
      headers: approvedAuthHeaders,
    });
    const cursor = firstPage.json<{ data: { nextCursor: string | null } }>().data.nextCursor;
    const mismatchResponse = await app.inject({
      method: 'GET',
      url: `/admin/answer-gaps?status=all&cursor=${encodeURIComponent(cursor ?? '')}`,
      headers: approvedAuthHeaders,
    });

    expect(cursor).toEqual(expect.any(String));
    expect(mismatchResponse.statusCode).toBe(400);
    expect(mismatchResponse.json()).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Answer Gap cursor filter does not match the requested filter',
      },
    });
  });

  it('marks answer gaps done idempotently', async () => {
    const app = await createAuthedServer('admin');
    await app.inject({
      method: 'POST',
      url: '/internal/answer-gaps',
      headers: { 'x-internal-auth': 'internal-token' },
      payload: answerGapPayload(),
    });

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/admin/answer-gaps/answer-gap-assistant_message-1/done',
      headers: approvedAuthHeaders,
      payload: {},
    });
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/admin/answer-gaps/answer-gap-assistant_message-1/done',
      headers: approvedAuthHeaders,
      payload: {},
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json()).toMatchObject({
      ok: true,
      data: {
        gap: {
          status: 'done',
          doneAt: '2026-06-14T12:00:00.000Z',
          doneByUserId: 'admin-user-1',
        },
      },
    });
    expect(secondResponse.json()).toEqual(firstResponse.json());
  });

  it('reports access-refresh status and retries failed jobs', async () => {
    const { app } = await createAuthedHarness({
      accessRefreshJobs: [accessRefreshJob()],
      chunks: [
        pageChunk({ id: 'stale-chunk-1', accessSyncStatus: 'stale' }),
        pageChunk({ id: 'mismatch-chunk-1', accessRevision: 'category-rev-old' }),
      ],
    });

    const statusResponse = await app.inject({
      method: 'GET',
      url: '/admin/access-refresh/status',
      headers: approvedAuthHeaders,
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toMatchObject({
      ok: true,
      data: {
        jobs: { pending: 0, failed: 1 },
        chunks: { active: 2, stale: 1, mismatch: 1 },
        recentFailures: [
          expectObjectContaining({
            jobId: 'access-job-1',
            lastErrorCode: 'VALIDATION_ERROR',
          }),
        ],
      },
    });

    const retryResponse = await app.inject({
      method: 'POST',
      url: '/admin/access-refresh/jobs/access-job-1/retry',
      headers: approvedAuthHeaders,
      payload: {},
    });

    expect(retryResponse.statusCode).toBe(200);
    expect(retryResponse.json()).toMatchObject({
      ok: true,
      data: {
        id: 'access-job-1',
        status: 'pending',
        attempts: 0,
        lastErrorCode: null,
      },
    });
  });

  it('creates an admin category and a section under it', async () => {
    const app = await createAuthedServer('admin');

    const createCategoryResponse = await app.inject({
      method: 'POST',
      url: '/admin/categories',
      headers: approvedAuthHeaders,
      payload: {
        title: 'River Pike',
        access: { gate: 'approved', requiredLevel: null },
        sortIndex: 2,
      },
    });

    expect(createCategoryResponse.statusCode).toBe(201);
    const categoryBody = createCategoryResponse.json<{
      ok: true;
      data: { id: string; title: string; type: string; path: string[] };
    }>();
    expect(categoryBody.data).toMatchObject({
      title: 'River Pike',
      type: 'category',
      path: ['Knowledge Base', 'River Pike'],
    });

    const createSectionResponse = await app.inject({
      method: 'POST',
      url: `/admin/categories/${categoryBody.data.id}/sections`,
      headers: approvedAuthHeaders,
      payload: {
        title: 'Summer Banks',
        sortIndex: 1,
      },
    });

    expect(createSectionResponse.statusCode).toBe(201);
    expect(createSectionResponse.json()).toMatchObject({
      ok: true,
      data: {
        type: 'section',
        title: 'Summer Banks',
        categoryId: categoryBody.data.id,
        path: ['Knowledge Base', 'River Pike', 'Summer Banks'],
      },
    });
  });

  it('updates category access, marks pages stale, deletes old chunks, and queues refresh', async () => {
    const generatedIds = ['category-revision-2', 'access-job-2'];
    const { app, accessRefreshRepository, pageChunkRepository, pageRepository } =
      await createAuthedHarness({
        generateId: () => generatedIds.shift() ?? 'unused-id',
      });

    const response = await app.inject({
      method: 'PATCH',
      url: '/admin/categories/category-1/access',
      headers: approvedAuthHeaders,
      payload: {
        expectedAccessRevision: 'category-rev-1',
        access: { gate: 'level', requiredLevel: 7 },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: {
        category: {
          id: 'category-1',
          categoryAccess: { gate: 'level', requiredLevel: 7 },
          accessRevision: 'access-category-revision-2',
        },
        refreshJob: {
          id: 'access-job-2',
          status: 'pending',
          kind: 'category_access_changed',
          requestedAccessRevision: 'access-category-revision-2',
        },
      },
    });

    const updatedPage = pageRepository.pages.get('page-1');
    expect(updatedPage).toMatchObject({
      access: {
        effective: {
          gate: 'level',
          requiredLevel: 7,
          accessRevision: 'access-category-revision-2',
        },
      },
      indexingStatus: 'pending',
      syncStatus: 'sync_required',
      accessSyncStatus: 'stale',
      chunkCount: 0,
    });
    expect(pageChunkRepository.chunks.get('page-chunk-1')).toMatchObject({
      status: 'deleted',
      deletedAt: '2026-06-14T12:00:00.000Z',
    });
    expect(accessRefreshRepository.jobs.get('access-job-2')).toMatchObject({
      target: { categoryId: 'category-1', pageId: null },
      actorAdminUserId: 'admin-user-1',
    });
  });

  it('updates section paths and deletes a category subtree', async () => {
    const { app, pageRepository } = await createAuthedHarness();

    const sectionResponse = await app.inject({
      method: 'PATCH',
      url: '/admin/sections/section-1',
      headers: approvedAuthHeaders,
      payload: { title: 'Short Rigs' },
    });

    expect(sectionResponse.statusCode).toBe(200);
    expect(sectionResponse.json()).toMatchObject({
      ok: true,
      data: {
        id: 'section-1',
        title: 'Short Rigs',
        path: ['Knowledge Base', 'Method Feeder', 'Short Rigs'],
      },
    });
    expect(pageRepository.pages.get('page-1')).toMatchObject({
      pathTitles: ['Knowledge Base', 'Method Feeder', 'Short Rigs', 'Pellet Choices'],
      syncStatus: 'sync_required',
      accessSyncStatus: 'stale',
    });

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/admin/categories/category-1',
      headers: approvedAuthHeaders,
      payload: {},
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toMatchObject({
      ok: true,
      data: {
        deleted: true,
        categoryId: 'category-1',
        deletedSectionCount: 1,
        deletedPageCount: 1,
        deletedChunkCount: 0,
      },
    });
  });

  it('creates, retrieves, and updates an admin page without workspaceId', async () => {
    const app = await createAuthedServer('admin');

    const createCategoryResponse = await app.inject({
      method: 'POST',
      url: '/admin/categories',
      headers: approvedAuthHeaders,
      payload: {
        title: 'Method Feeder',
        access: { gate: 'approved', requiredLevel: null },
      },
    });
    const categoryId = createCategoryResponse.json<{ data: { id: string } }>().data.id;

    const createSectionResponse = await app.inject({
      method: 'POST',
      url: `/admin/categories/${categoryId}/sections`,
      headers: approvedAuthHeaders,
      payload: { title: 'Hooks' },
    });
    const sectionId = createSectionResponse.json<{ data: { id: string } }>().data.id;

    const createPageResponse = await app.inject({
      method: 'POST',
      url: '/admin/pages',
      headers: approvedAuthHeaders,
      payload: {
        categoryId,
        sectionId,
        title: 'Pellet Choices',
        source: {
          type: 'external',
          url: 'https://example.com/pellets',
          label: 'Example',
        },
        markdown: '# Pellet Choices\n\nStart small.',
        syncNow: false,
      },
    });

    expect(createPageResponse.statusCode).toBe(201);
    const createdPage = createPageResponse.json<{
      ok: true;
      data: { id: string; sectionId: string | null; path: string[] };
    }>();
    expect(createdPage.data).toMatchObject({
      sectionId,
      path: ['Knowledge Base', 'Method Feeder', 'Hooks', 'Pellet Choices'],
    });

    const getPageResponse = await app.inject({
      method: 'GET',
      url: `/admin/pages/${createdPage.data.id}`,
      headers: approvedAuthHeaders,
    });

    expect(getPageResponse.statusCode).toBe(200);
    expect(getPageResponse.json()).toMatchObject({
      ok: true,
      data: {
        id: createdPage.data.id,
        title: 'Pellet Choices',
        sectionId,
      },
    });

    const updatePageResponse = await app.inject({
      method: 'PATCH',
      url: `/admin/pages/${createdPage.data.id}`,
      headers: approvedAuthHeaders,
      payload: {
        title: 'Cold Water Pellets',
        markdown: '# Cold Water Pellets\n\nGo softer.',
      },
    });

    expect(updatePageResponse.statusCode).toBe(200);
    expect(updatePageResponse.json()).toMatchObject({
      ok: true,
      data: {
        id: createdPage.data.id,
        title: 'Cold Water Pellets',
        indexingStatus: 'pending',
        syncStatus: 'sync_required',
      },
    });
    expect(JSON.stringify(updatePageResponse.json())).not.toContain('workspaceId');
  });

  it('persists duplicate content acknowledgements and clears them when markdown changes', async () => {
    const { app } = await createAuthedHarness({
      pages: [
        page({
          markdown: '# Repeated\n\nZadawaj pytania.\nZadawaj pytania.',
          normalizedMarkdown: '# Repeated\n\nZadawaj pytania.\nZadawaj pytania.',
          markdownContentHash: 'duplicate-hash-1',
        }),
      ],
    });

    const acknowledgementResponse = await app.inject({
      method: 'POST',
      url: '/admin/pages/page-1/content-quality-acknowledgements',
      headers: approvedAuthHeaders,
      payload: {
        issueType: 'adjacent_duplicate_content',
        markdownContentHash: 'duplicate-hash-1',
        issueFingerprints: ['Zadawaj pytania.\u00003\u00004'],
        reason: 'Repeated call to action is intentional.',
      },
    });

    expect(acknowledgementResponse.statusCode).toBe(200);
    expect(acknowledgementResponse.json()).toMatchObject({
      ok: true,
      data: {
        page: {
          id: 'page-1',
          contentQualityAcknowledgements: [
            {
              issueType: 'adjacent_duplicate_content',
              markdownContentHash: 'duplicate-hash-1',
              issueFingerprints: ['Zadawaj pytania.\u00003\u00004'],
              reason: 'Repeated call to action is intentional.',
              acknowledgedAt: '2026-06-14T12:00:00.000Z',
              acknowledgedByUserId: 'admin-user-1',
            },
          ],
        },
      },
    });

    const getAcknowledgedPageResponse = await app.inject({
      method: 'GET',
      url: '/admin/pages/page-1',
      headers: approvedAuthHeaders,
    });
    expect(getAcknowledgedPageResponse.json()).toMatchObject({
      data: {
        contentQualityAcknowledgements: [
          expectObjectContaining({
            issueType: 'adjacent_duplicate_content',
            markdownContentHash: 'duplicate-hash-1',
          }),
        ],
      },
    });

    const updatePageResponse = await app.inject({
      method: 'PATCH',
      url: '/admin/pages/page-1',
      headers: approvedAuthHeaders,
      payload: {
        markdown: '# Repeated\n\nZadawaj pytania.',
      },
    });

    expect(updatePageResponse.statusCode).toBe(200);
    expect(updatePageResponse.json()).toMatchObject({
      data: {
        contentQualityAcknowledgements: [],
      },
    });
  });

  it('rejects admin page creation without a source URL', async () => {
    const app = await createAuthedServer('admin');

    const response = await app.inject({
      method: 'POST',
      url: '/admin/pages',
      headers: approvedAuthHeaders,
      payload: {
        categoryId: 'category-1',
        sectionId: 'section-1',
        title: 'Missing source URL',
        source: { type: 'external', url: ' ' },
        markdown: '# Missing source URL\n\nBody.',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Source URL is required',
      },
    });
  });

  it('rejects admin page source updates without a source URL', async () => {
    const app = await createAuthedServer('admin');

    const response = await app.inject({
      method: 'PATCH',
      url: '/admin/pages/page-1',
      headers: approvedAuthHeaders,
      payload: {
        source: { type: 'external', url: ' ' },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Source URL is required',
      },
    });
  });

  it('deletes an admin page and returns not found for later page reads', async () => {
    const app = await createAuthedServer('admin');

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/admin/pages/page-1',
      headers: approvedAuthHeaders,
      payload: {},
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toMatchObject({
      ok: true,
      data: {
        deleted: true,
        pageId: 'page-1',
        deletedChunkCount: 1,
      },
    });

    const getDeletedResponse = await app.inject({
      method: 'GET',
      url: '/admin/pages/page-1',
      headers: approvedAuthHeaders,
    });

    expect(getDeletedResponse.statusCode).toBe(404);
    expect(getDeletedResponse.json()).toMatchObject({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Knowledge page page-1 not found',
      },
    });
  });

  it('returns not found for missing page maintenance routes', async () => {
    const app = await createAuthedServer('admin');

    const response = await app.inject({
      method: 'POST',
      url: '/admin/pages/missing-page/sync',
      headers: approvedAuthHeaders,
      payload: {},
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Knowledge page missing-page not found',
      },
    });
  });

  it('syncs an admin page through the route using the embedding provider', async () => {
    const app = await createAuthedServer('admin');

    const response = await app.inject({
      method: 'POST',
      url: '/admin/pages/page-1/sync',
      headers: approvedAuthHeaders,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: {
        syncedChunkCount: 1,
        page: {
          id: 'page-1',
          indexingStatus: 'ready',
          syncStatus: 'synced',
        },
      },
    });
  });

  it('reindexes a page and runs full knowledge-base sync through admin routes', async () => {
    const syncProvider = new FakeEmbeddingProvider();
    const { app } = await createAuthedHarness({ syncEmbeddingProvider: syncProvider });

    const reindexResponse = await app.inject({
      method: 'POST',
      url: '/admin/pages/page-1/reindex',
      headers: approvedAuthHeaders,
      payload: {},
    });

    expect(reindexResponse.statusCode).toBe(200);
    expect(reindexResponse.json()).toMatchObject({
      ok: true,
      data: {
        replacedChunkCount: 1,
        page: {
          id: 'page-1',
          indexingStatus: 'ready',
          syncStatus: 'synced',
          accessSyncStatus: 'current',
        },
      },
    });

    const fullSyncResponse = await app.inject({
      method: 'POST',
      url: '/admin/sync',
      headers: approvedAuthHeaders,
      payload: { mode: 'all' },
    });

    expect(fullSyncResponse.statusCode).toBe(200);
    expect(fullSyncResponse.json()).toMatchObject({
      ok: true,
      data: {
        synced: 1,
        failed: 0,
        skipped: 0,
        queuedAccessRefreshJobs: 0,
      },
    });
    expect(syncProvider.requests.map((request) => request.promptType)).toEqual([
      'knowledge-page-reindex-embedding',
      'knowledge-full-sync-embedding',
    ]);
  });

  it('persists failed sync state when route embedding metadata mismatches', async () => {
    const syncProvider = new FakeEmbeddingProvider({ responseProvider: 'openai' });
    const { app, pageRepository } = await createAuthedHarness({
      syncEmbeddingProvider: syncProvider,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/admin/pages/page-1/sync',
      headers: approvedAuthHeaders,
      payload: {},
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'DOWNSTREAM_ERROR',
      },
    });
    expect(pageRepository.pages.get('page-1')).toMatchObject({
      indexingStatus: 'failed',
      syncStatus: 'failed',
      indexingError:
        'Embedding provider response mismatch: requested openrouter qwen/qwen3-embedding-8b with 2048 dimensions, received openai qwen/qwen3-embedding-8b with 2048 dimensions.',
    });
  });

  it('rejects retired workspaceId in admin page bodies', async () => {
    const app = await createAuthedServer('admin');

    const response = await app.inject({
      method: 'POST',
      url: '/admin/pages',
      headers: approvedAuthHeaders,
      payload: {
        categoryId: 'category-1',
        title: 'Pellet Choices',
        source: {
          type: 'external',
          url: 'https://example.com/pellets',
          label: 'Example',
        },
        markdown: '# Pellet Choices\n\nStart small.',
        workspaceId: 'anonymous',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
      },
    });
  });
});
