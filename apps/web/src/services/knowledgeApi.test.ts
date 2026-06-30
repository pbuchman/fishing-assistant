import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearApiAuthProvider, setApiAuthProvider } from './apiClient.js';

import {
  acknowledgeKnowledgePageContentQuality,
  createKnowledgeCategory,
  createKnowledgePage,
  createKnowledgeSection,
  deleteKnowledgeCategory,
  deleteKnowledgePage,
  deleteKnowledgeSection,
  getKnowledgePage,
  getKnowledgeSource,
  listKnowledgeTree,
  listAnswerGaps,
  markAnswerGapDone,
  reindexKnowledgePage,
  saveKnowledgePage,
  syncAdminKnowledgeBase,
  syncKnowledgePage,
  updateKnowledgeCategory,
  updateKnowledgeCategoryAccess,
  updateKnowledgeSection,
} from './knowledgeApi.js';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}

function useAuthProvider(): void {
  setApiAuthProvider({
    getAccessToken: vi.fn(() => Promise.resolve('knowledge-token')),
    refreshAccessToken: vi.fn(() => Promise.resolve('knowledge-token-refresh')),
  });
}

function requestJsonBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== 'string') {
    throw new Error('Expected request body to be a JSON string.');
  }

  return JSON.parse(body) as unknown;
}

function answerGap(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'gap-1',
    status: 'needs_answer',
    source: 'no_accessible_evidence',
    question: 'What should I change next?',
    formulatedQuestion:
      'Add or adjust Knowledge Base content so FA can answer: "What should I change next?"',
    missingInformation: ['No accessible Knowledge Base evidence matched this question.'],
    requester: {
      userId: 'user-1',
      email: 'angler@example.com',
      firstName: 'Ava',
      lastName: 'Angler',
      role: 'user',
      effectiveLevel: 4,
    },
    origin: {
      reason: 'no_accessible_evidence',
    },
    conversation: {
      conversationId: 'conversation-1',
      userMessageId: 'user-message-1',
      assistantMessageId: 'assistant-message-1',
      contextWindow: [{ role: 'user', content: 'What should I change next?' }],
    },
    coverageProbe: {
      classification: 'no_candidate_seen',
      minRequiredLevel: null,
      candidateCountBucket: '0',
      probeVersion: '1.0.0',
    },
    processing: { similarityStatus: 'not_started' },
    createdAt: { seconds: 1781438400, nanoseconds: 250_000_000 },
    updatedAt: { _seconds: 1781438460, _nanoseconds: 500_000_000 },
    doneAt: null,
    doneByUserId: null,
    ...overrides,
  };
}

describe('knowledgeApi', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearApiAuthProvider();
    vi.restoreAllMocks();
  });

  it('uses the current-schema admin knowledge endpoints', async () => {
    useAuthProvider();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            root: {
              id: 'root',
              type: 'root',
              title: 'Knowledge Base',
              slug: 'knowledge-base',
              parentId: null,
              categoryId: null,
              sectionId: null,
              pageId: null,
              depth: 0,
              sortIndex: 0,
              path: ['Knowledge Base'],
              status: 'active',
              categoryAccess: null,
              accessRevision: null,
              pageSummary: null,
              children: [],
            },
            accessRefresh: {
              pendingJobs: 0,
              runningJobs: 0,
              failedJobs: 0,
              staleChunkCount: 0,
              mismatchCount: 0,
            },
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            id: 'page-1',
            nodeId: 'node-1',
            title: 'Pellet Choices',
            categoryId: 'category-1',
            sectionId: 'section-1',
            hierarchy: { category: 'Method Feeder', section: 'Hooks' },
            path: ['Knowledge Base', 'Method Feeder', 'Hooks', 'Pellet Choices'],
            source: { type: 'external', url: 'https://example.com/pellets', label: 'Example' },
            access: {
              effective: {
                gate: 'approved',
                requiredLevel: null,
                accessRevision: 'category-rev-1',
                retrievalReady: true,
              },
              inheritedFromCategoryId: 'category-1',
              overridePresent: false,
            },
            relations: { relatedTo: [], linksTo: [], supersedes: [] },
            markdown: '# Pellet Choices',
            indexingStatus: 'ready',
            syncStatus: 'synced',
            accessSyncStatus: 'current',
            indexingError: null,
            syncError: null,
            accessSyncError: null,
            chunkCount: 1,
            createdAt: '2026-06-14T10:00:00.000Z',
            updatedAt: '2026-06-14T11:00:00.000Z',
            deletedAt: null,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            id: 'page-1',
            nodeId: 'node-1',
            title: 'Pellet Choices',
            categoryId: 'category-1',
            sectionId: 'section-1',
            hierarchy: { category: 'Method Feeder', section: 'Hooks' },
            path: ['Knowledge Base', 'Method Feeder', 'Hooks', 'Pellet Choices'],
            source: { type: 'external', url: 'https://example.com/pellets', label: 'Example' },
            access: {
              effective: {
                gate: 'approved',
                requiredLevel: null,
                accessRevision: 'category-rev-1',
                retrievalReady: true,
              },
              inheritedFromCategoryId: 'category-1',
              overridePresent: false,
            },
            relations: { relatedTo: [], linksTo: [], supersedes: [] },
            markdown: '# Updated',
            indexingStatus: 'ready',
            syncStatus: 'synced',
            accessSyncStatus: 'current',
            indexingError: null,
            syncError: null,
            accessSyncError: null,
            chunkCount: 1,
            createdAt: '2026-06-14T10:00:00.000Z',
            updatedAt: '2026-06-14T11:05:00.000Z',
            deletedAt: null,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, data: { page: { id: 'page-1' }, syncedChunkCount: 1 } })
      )
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, data: { page: { id: 'page-1' }, replacedChunkCount: 1 } })
      )
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, data: { synced: 1, failed: 0, skipped: 0 } })
      );
    globalThis.fetch = fetchMock;

    await listKnowledgeTree();
    await getKnowledgePage('page-1');
    await saveKnowledgePage('page-1', { markdown: '# Updated' });
    await syncKnowledgePage('page-1');
    await reindexKnowledgePage('page-1');
    await syncAdminKnowledgeBase({ mode: 'changed' });

    expect(
      fetchMock.mock.calls.map(([input, init]) => [requestUrl(input), init?.method ?? 'GET'])
    ).toEqual([
      ['/api/knowledge/admin/tree', 'GET'],
      ['/api/knowledge/admin/pages/page-1', 'GET'],
      ['/api/knowledge/admin/pages/page-1', 'PATCH'],
      ['/api/knowledge/admin/pages/page-1/sync', 'POST'],
      ['/api/knowledge/admin/pages/page-1/reindex', 'POST'],
      ['/api/knowledge/admin/sync', 'POST'],
    ]);
  });

  it('acknowledges duplicate content quality issues through the admin page endpoint', async () => {
    useAuthProvider();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: {
          page: {
            id: 'page-1',
            nodeId: 'node-1',
            title: 'Pellet Choices',
            categoryId: 'category-1',
            sectionId: 'section-1',
            hierarchy: { category: 'Method Feeder', section: 'Hooks' },
            path: ['Knowledge Base', 'Method Feeder', 'Hooks', 'Pellet Choices'],
            source: { type: 'external', url: 'https://example.com/pellets', label: 'Example' },
            access: {
              effective: {
                gate: 'approved',
                requiredLevel: null,
                accessRevision: 'category-rev-1',
                retrievalReady: true,
              },
              inheritedFromCategoryId: 'category-1',
              overridePresent: false,
            },
            relations: { relatedTo: [], linksTo: [], supersedes: [] },
            markdown: '# Pellet Choices',
            markdownContentHash: 'hash-page-1',
            contentQualityAcknowledgements: [
              {
                issueType: 'adjacent_duplicate_content',
                markdownContentHash: 'hash-page-1',
                issueFingerprints: ['Zadawaj pytania.\u00003\u00004'],
                reason: 'Intentional repetition.',
                acknowledgedAt: '2026-06-14T10:00:00.000Z',
                acknowledgedByUserId: 'admin-user-1',
              },
            ],
            indexingStatus: 'ready',
            syncStatus: 'synced',
            accessSyncStatus: 'current',
            indexingError: null,
            syncError: null,
            accessSyncError: null,
            chunkCount: 1,
            createdAt: '2026-06-14T10:00:00.000Z',
            updatedAt: '2026-06-14T11:00:00.000Z',
            deletedAt: null,
          },
        },
      })
    );
    globalThis.fetch = fetchMock;

    await expect(
      acknowledgeKnowledgePageContentQuality('page-1', {
        issueType: 'adjacent_duplicate_content',
        markdownContentHash: 'hash-page-1',
        issueFingerprints: ['Zadawaj pytania.\u00003\u00004'],
        reason: 'Intentional repetition.',
      })
    ).resolves.toMatchObject({
      page: {
        id: 'page-1',
        contentQualityAcknowledgements: [
          {
            issueType: 'adjacent_duplicate_content',
            acknowledgedAt: '2026-06-14T10:00:00.000Z',
          },
        ],
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/knowledge/admin/pages/page-1/content-quality-acknowledgements',
      expect.objectContaining({ method: 'POST' })
    );
    expect(requestJsonBody(fetchMock.mock.calls[0]?.[1])).toEqual({
      issueType: 'adjacent_duplicate_content',
      markdownContentHash: 'hash-page-1',
      issueFingerprints: ['Zadawaj pytania.\u00003\u00004'],
      reason: 'Intentional repetition.',
    });
  });

  it('calls answer gap admin endpoints with status, cursor, and mark-done bodies', async () => {
    useAuthProvider();
    const doneGap = answerGap({
      status: 'done',
      doneAt: { seconds: 1781438520, nanoseconds: 0 },
      doneByUserId: 'admin-1',
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, data: { gaps: [answerGap()], nextCursor: null, totalCount: 1 } })
      )
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, data: { gaps: [], nextCursor: 'next-cursor', totalCount: 4 } })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { gap: doneGap } }));
    globalThis.fetch = fetchMock;

    await expect(listAnswerGaps()).resolves.toMatchObject({
      gaps: [
        {
          id: 'gap-1',
          createdAt: '2026-06-14T12:00:00.250Z',
          updatedAt: '2026-06-14T12:01:00.500Z',
          doneAt: null,
        },
      ],
      nextCursor: null,
      totalCount: 1,
    });
    await expect(listAnswerGaps({ status: 'all', limit: 25, cursor: 'abc' })).resolves.toEqual({
      gaps: [],
      nextCursor: 'next-cursor',
      totalCount: 4,
    });
    await expect(markAnswerGapDone('gap-1')).resolves.toMatchObject({
      gap: {
        status: 'done',
        doneAt: '2026-06-14T12:02:00.000Z',
        doneByUserId: 'admin-1',
      },
    });

    expect(
      fetchMock.mock.calls.map(([input, init]) => [requestUrl(input), init?.method ?? 'GET'])
    ).toEqual([
      ['/api/knowledge/admin/answer-gaps?status=needs_answer', 'GET'],
      ['/api/knowledge/admin/answer-gaps?status=all&limit=25&cursor=abc', 'GET'],
      ['/api/knowledge/admin/answer-gaps/gap-1/done', 'POST'],
    ]);
    expect(requestJsonBody(fetchMock.mock.calls[2]?.[1])).toEqual({});
  });

  it('uses encoded admin category and section endpoints with JSON bodies', async () => {
    useAuthProvider();
    const treeNode = {
      id: 'category-1',
      type: 'category',
      title: 'Method Feeder',
      slug: 'method-feeder',
      parentId: 'root',
      categoryId: 'category/1',
      sectionId: null,
      pageId: null,
      depth: 1,
      sortIndex: 0,
      path: ['Knowledge Base', 'Method Feeder'],
      status: 'active',
      categoryAccess: { gate: 'approved', requiredLevel: null },
      accessRevision: 'rev-1',
      pageSummary: null,
      children: [],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: treeNode }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: treeNode }))
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, data: { category: treeNode, refreshJob: null } })
      )
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, data: { category: treeNode, refreshJob: null } })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            deleted: true,
            categoryId: 'category/1',
            deletedSectionCount: 1,
            deletedPageCount: 2,
            deletedChunkCount: 3,
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { ...treeNode, type: 'section' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { ...treeNode, type: 'section' } }))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            deleted: true,
            sectionId: 'section/1',
            deletedPageCount: 1,
            deletedChunkCount: 2,
          },
        })
      );
    globalThis.fetch = fetchMock;

    await createKnowledgeCategory({
      title: 'Method Feeder',
      access: { gate: 'approved', requiredLevel: null },
      sortIndex: 3,
    });
    await updateKnowledgeCategory('category/1', { title: 'Updated Category' });
    await updateKnowledgeCategoryAccess(
      'category/1',
      { gate: 'level', requiredLevel: 4 },
      'access-rev-1'
    );
    await updateKnowledgeCategoryAccess('category/1', { gate: 'public', requiredLevel: null });
    await deleteKnowledgeCategory('category/1');
    await createKnowledgeSection('category/1', { title: 'Hooks', sortIndex: 2 });
    await updateKnowledgeSection('section/1', { title: 'Hook lengths' });
    await deleteKnowledgeSection('section/1');

    expect(
      fetchMock.mock.calls.map(([input, init]) => [requestUrl(input), init?.method ?? 'GET'])
    ).toEqual([
      ['/api/knowledge/admin/categories', 'POST'],
      ['/api/knowledge/admin/categories/category%2F1', 'PATCH'],
      ['/api/knowledge/admin/categories/category%2F1/access', 'PATCH'],
      ['/api/knowledge/admin/categories/category%2F1/access', 'PATCH'],
      ['/api/knowledge/admin/categories/category%2F1', 'DELETE'],
      ['/api/knowledge/admin/categories/category%2F1/sections', 'POST'],
      ['/api/knowledge/admin/sections/section%2F1', 'PATCH'],
      ['/api/knowledge/admin/sections/section%2F1', 'DELETE'],
    ]);
    expect(requestJsonBody(fetchMock.mock.calls[0]?.[1])).toEqual({
      title: 'Method Feeder',
      access: { gate: 'approved', requiredLevel: null },
      sortIndex: 3,
    });
    expect(requestJsonBody(fetchMock.mock.calls[2]?.[1])).toEqual({
      access: { gate: 'level', requiredLevel: 4 },
      expectedAccessRevision: 'access-rev-1',
    });
    expect(requestJsonBody(fetchMock.mock.calls[3]?.[1])).toEqual({
      access: { gate: 'public', requiredLevel: null },
    });
    expect(requestJsonBody(fetchMock.mock.calls[5]?.[1])).toEqual({
      title: 'Hooks',
      sortIndex: 2,
    });
  });

  it('normalizes Firestore timestamp shapes in trees and page responses', async () => {
    useAuthProvider();
    const pageResponse = {
      id: 'page-1',
      nodeId: 'node-1',
      title: 'Timestamped Page',
      categoryId: 'category-1',
      sectionId: null,
      hierarchy: { category: 'Method Feeder' },
      path: ['Knowledge Base', 'Method Feeder', 'Timestamped Page'],
      source: { type: 'manual', url: null, label: null },
      access: {
        effective: {
          gate: 'approved',
          requiredLevel: null,
          accessRevision: 'category-rev-1',
          retrievalReady: true,
        },
        inheritedFromCategoryId: 'category-1',
        overridePresent: false,
      },
      relations: { relatedTo: [], linksTo: [], supersedes: [] },
      markdown: '# Timestamped Page',
      indexingStatus: 'pending',
      syncStatus: 'sync_required',
      accessSyncStatus: 'stale',
      indexingError: null,
      syncError: null,
      accessSyncError: null,
      chunkCount: 0,
      createdAt: { seconds: 1781438400, nanoseconds: 250_000_000 },
      updatedAt: { _seconds: 1781438460, _nanoseconds: 500_000_000 },
      deletedAt: { seconds: 1781438520, nanoseconds: 0 },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            root: {
              id: 'root',
              type: 'root',
              title: 'Knowledge Base',
              slug: 'knowledge-base',
              parentId: null,
              categoryId: null,
              sectionId: null,
              pageId: null,
              depth: 0,
              sortIndex: 0,
              path: ['Knowledge Base'],
              status: 'active',
              categoryAccess: null,
              accessRevision: null,
              pageSummary: {
                effectiveAccess: {
                  gate: 'approved',
                  requiredLevel: null,
                  accessRevision: 'category-rev-1',
                  retrievalReady: false,
                },
                indexingStatus: 'pending',
                syncStatus: 'sync_required',
                accessSyncStatus: 'stale',
                source: { type: 'manual', url: null, label: null },
                chunkCount: 0,
                updatedAt: { seconds: 1781438400, nanoseconds: 500_000_000 },
              },
              children: [],
            },
            accessRefresh: {
              pendingJobs: 1,
              runningJobs: 0,
              failedJobs: 0,
              staleChunkCount: 2,
              mismatchCount: 0,
            },
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: pageResponse }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: pageResponse }))
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, data: { page: pageResponse, syncedChunkCount: 1 } })
      )
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, data: { page: pageResponse, replacedChunkCount: 1 } })
      );
    globalThis.fetch = fetchMock;

    await expect(listKnowledgeTree()).resolves.toMatchObject({
      root: {
        pageSummary: {
          updatedAt: '2026-06-14T12:00:00.500Z',
        },
      },
      accessRefresh: {
        pendingJobs: 1,
        staleChunkCount: 2,
      },
    });
    await expect(
      createKnowledgePage({
        categoryId: 'category-1',
        title: 'New',
        source: { type: 'external', url: 'https://source.example/new' },
        markdown: '# New',
      })
    ).resolves.toMatchObject({
      createdAt: '2026-06-14T12:00:00.250Z',
      updatedAt: '2026-06-14T12:01:00.500Z',
      deletedAt: '2026-06-14T12:02:00.000Z',
    });
    await expect(getKnowledgePage('page-1')).resolves.toMatchObject({
      updatedAt: '2026-06-14T12:01:00.500Z',
    });
    await expect(syncKnowledgePage('page-1')).resolves.toMatchObject({
      page: {
        accessSyncStatus: 'stale',
        updatedAt: '2026-06-14T12:01:00.500Z',
      },
      syncedChunkCount: 1,
    });
    await expect(reindexKnowledgePage('page-1')).resolves.toMatchObject({
      page: {
        updatedAt: '2026-06-14T12:01:00.500Z',
      },
      replacedChunkCount: 1,
    });
  });

  it('loads read-only knowledge sources by internal source id', async () => {
    useAuthProvider();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: {
          id: 'page/1',
          sourceId: 'knowledge-page:page/1',
          title: 'Spring liquid additive quantity',
          content: 'Przykladowa tresc zrodla testowego.',
          updatedAt: { seconds: 1781438460, nanoseconds: 500_000_000 },
          access: { gate: 'approved', requiredLevel: null, retrievalReady: true },
        },
      })
    );
    globalThis.fetch = fetchMock;

    await expect(getKnowledgeSource('knowledge-page:page/1')).resolves.toEqual({
      id: 'page/1',
      sourceId: 'knowledge-page:page/1',
      title: 'Spring liquid additive quantity',
      content: 'Przykladowa tresc zrodla testowego.',
      updatedAt: '2026-06-14T12:01:00.500Z',
      access: { gate: 'approved', requiredLevel: null, retrievalReady: true },
    });

    expect(
      fetchMock.mock.calls.map(([input, init]) => [requestUrl(input), init?.method ?? 'GET'])
    ).toEqual([['/api/knowledge/source?sourceRef=knowledge-page%3Apage%2F1', 'GET']]);
  });

  it('encodes page delete paths, sends default sync mode bodies, and propagates API errors', async () => {
    useAuthProvider();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, data: { deleted: true, pageId: 'page/1', deletedChunkCount: 2 } })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: { synced: 0, failed: 0, skipped: 0, queuedAccessRefreshJobs: 0 },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { ok: false, error: { code: 'NOT_FOUND', message: 'Page not found.' } },
          { status: 404 }
        )
      );
    globalThis.fetch = fetchMock;

    await expect(deleteKnowledgePage('page/1')).resolves.toEqual({
      deleted: true,
      pageId: 'page/1',
      deletedChunkCount: 2,
    });
    await expect(syncAdminKnowledgeBase()).resolves.toEqual({
      synced: 0,
      failed: 0,
      skipped: 0,
      queuedAccessRefreshJobs: 0,
    });
    await expect(getKnowledgePage('missing page')).rejects.toMatchObject({
      message: 'Page not found.',
      status: 404,
    });

    expect(
      fetchMock.mock.calls.map(([input, init]) => [requestUrl(input), init?.method ?? 'GET'])
    ).toEqual([
      ['/api/knowledge/admin/pages/page%2F1', 'DELETE'],
      ['/api/knowledge/admin/sync', 'POST'],
      ['/api/knowledge/admin/pages/missing%20page', 'GET'],
    ]);
    expect(requestJsonBody(fetchMock.mock.calls[1]?.[1])).toEqual({});
  });
});
