import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearApiAuthProvider, setApiAuthProvider } from './apiClient.js';
import {
  createConversation,
  deleteConversation,
  listConversationMessages,
  listConversations,
  declineAnswerGapCandidate,
  shareAnswerGapCandidate,
  streamConversationMessage,
  withdrawAnswerGapCandidate,
  type ConversationMessage,
} from './chatApi.js';

function jsonResponse(envelope: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(envelope), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );
}

const promptVersions = {
  answer: { name: 'fishing-answer', version: '2.0.0' },
} satisfies NonNullable<ConversationMessage['promptVersions']>;

describe('chatApi', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setApiAuthProvider({
      getAccessToken: vi.fn(() => Promise.resolve('chat-api-token')),
      refreshAccessToken: vi.fn(() => Promise.resolve('chat-api-token-refresh')),
    });
  });

  afterEach(() => {
    clearApiAuthProvider();
    vi.unstubAllGlobals();
  });

  it('uses same-origin chat endpoints for conversation CRUD', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: [
            {
              id: 'c1',
              title: 'River rigs',
              status: 'active',
              createdAt: '2026-06-13T10:00:00.000Z',
              updatedAt: { _seconds: 1781348400, _nanoseconds: 0 },
              lastMessageAt: '2026-06-13T10:05:00.000Z',
              lastMessagePreview: 'What hook length?',
              messageCount: 2,
              deletedAt: { _seconds: 1781348460, _nanoseconds: 0 },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            id: 'c2',
            title: 'New Chat',
            status: 'active',
            createdAt: '2026-06-14T12:00:00.000Z',
            updatedAt: '2026-06-14T12:00:00.000Z',
            lastMessageAt: '2026-06-14T12:00:00.000Z',
            lastMessagePreview: '',
            messageCount: 0,
            deletedAt: null,
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { deleted: true } }));

    await expect(listConversations()).resolves.toMatchObject([
      {
        id: 'c1',
        title: 'River rigs',
        updatedAt: '2026-06-13T11:00:00.000Z',
        deletedAt: '2026-06-13T11:01:00.000Z',
      },
    ]);
    await expect(createConversation()).resolves.toMatchObject({ id: 'c2', title: 'New Chat' });
    await expect(deleteConversation('c1')).resolves.toEqual({ deleted: true });

    expect(fetchMock.mock.calls.map((call) => [call[0], call[1]?.method ?? 'GET'])).toEqual([
      ['/api/chat/conversations', 'GET'],
      ['/api/chat/conversations', 'POST'],
      ['/api/chat/conversations/c1', 'DELETE'],
    ]);
  });

  it('lists messages and normalizes citation evidence timestamps', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: [
          {
            id: 'm1',
            conversationId: 'c1',
            role: 'assistant',
            content: 'Use a short hook length.',
            createdAt: { seconds: 1781438400, nanoseconds: 0 },
            citations: [{ sourceId: 'knowledge\u0000chunk-1', usedFor: 'hook length' }],
            missingInformation: ['water temperature'],
            retrieval: {
              query: 'Hook length?',
              startedAt: '2026-06-14T11:59:00.000Z',
              completedAt: { _seconds: 1781438401, _nanoseconds: 0 },
              sources: [],
              evidence: [
                {
                  id: 'chunk-1',
                  sourceId: 'knowledge',
                  sourceType: 'knowledge_page',
                  title: 'River notes',
                  quote: 'Short hook lengths helped in clear water.',
                  score: 0.88,
                  metadata: { headingPath: ['Hooks'] },
                },
              ],
            },
            promptVersions,
            streamStatus: 'completed',
          },
        ],
      })
    );

    await expect(listConversationMessages('c1')).resolves.toMatchObject([
      {
        id: 'm1',
        createdAt: '2026-06-14T12:00:00.000Z',
        retrieval: {
          completedAt: '2026-06-14T12:00:01.000Z',
          evidence: [{ quote: 'Short hook lengths helped in clear water.' }],
        },
        promptVersions,
      },
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/chat/conversations/c1/messages');
  });

  it('streams typed chat events from the SSE endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'event: retrieval.completed\ndata: {"sourceCounts":[],"topEvidenceIds":[]}\n\n',
        'event: answer.started\ndata: {"conversationId":"c1","messageId":"a1"}\n\n',
        'event: answer.delta\ndata: {"text":"Use "}\n\n',
        'event: answer.delta\ndata: {"text":"punched bread."}\n\n',
        'event: answer.progress\ndata: {"status":"long_running"}\n\n',
        'event: answer.progress\ndata: {"status":"preparing_sources"}\n\n',
        'event: answer.citation\ndata: {"citation":{"sourceId":"knowledge-service\\u0000knowledge-page:public-1","usedFor":"bait choice"},"evidence":{"id":"knowledge-page:public-1","sourceId":"knowledge-service","sourceType":"knowledge_page","title":"Bait notes","quote":"Bread worked.","score":0.91,"metadata":{"headingPath":["Bait notes"]}}}\n\n',
        'event: answer.missing_info\ndata: {"missingInformation":["flow speed"]}\n\n',
        'event: answer.gap_candidate\ndata: {"candidate":{"id":"answer-gap-candidate-a1","status":"pending_user_consent","coverageKind":"global_no_candidate_seen","missingInformation":["flow speed"],"expiresAt":"2026-07-14T12:00:00.000Z"}}\n\n',
        `event: answer.final\ndata: ${JSON.stringify({
          id: 'a1',
          userId: 'user-1',
          conversationId: 'c1',
          role: 'assistant',
          content: 'Use punched bread.',
          createdAt: '2026-06-14T12:00:00.000Z',
          citations: [],
          missingInformation: [],
          promptVersions,
          streamStatus: 'completed',
        })}\n\n`,
        'event: done\ndata: {"ok":true}\n\n',
      ])
    );
    const events: unknown[] = [];

    await streamConversationMessage('c1', 'Best bait?', (event) => {
      events.push(event);
    });

    expect(events.slice(0, 4)).toEqual([
      { type: 'retrieval.completed', data: { sourceCounts: [], topEvidenceIds: [] } },
      { type: 'answer.started', data: { conversationId: 'c1', messageId: 'a1' } },
      { type: 'answer.delta', data: { text: 'Use ' } },
      { type: 'answer.delta', data: { text: 'punched bread.' } },
    ]);
    expect(events.slice(4, 7)).toEqual([
      { type: 'answer.progress', data: { status: 'long_running' } },
      { type: 'answer.progress', data: { status: 'preparing_sources' } },
      {
        type: 'answer.citation',
        data: {
          citation: {
            sourceId: 'knowledge-service\u0000knowledge-page:public-1',
            usedFor: 'bait choice',
          },
          evidence: {
            id: 'knowledge-page:public-1',
            sourceId: 'knowledge-service',
            sourceType: 'knowledge_page',
            title: 'Bait notes',
            quote: 'Bread worked.',
            score: 0.91,
            metadata: { headingPath: ['Bait notes'] },
          },
        },
      },
    ]);
    expect(events[7]).toEqual({
      type: 'answer.missing_info',
      data: { missingInformation: ['flow speed'] },
    });
    expect(events[8]).toEqual({
      type: 'answer.gap_candidate',
      data: {
        candidate: {
          id: 'answer-gap-candidate-a1',
          status: 'pending_user_consent',
          coverageKind: 'global_no_candidate_seen',
          missingInformation: ['flow speed'],
          expiresAt: '2026-07-14T12:00:00.000Z',
        },
      },
    });
    expect(events[9]).toMatchObject({
      type: 'answer.final',
      data: { id: 'a1', promptVersions },
    });
    expect(events[10]).toEqual({ type: 'done', data: { ok: true } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/chat/conversations/c1/messages/stream');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ message: 'Best bait?' }),
    });
  });

  it('calls answer gap candidate share, decline, and withdraw endpoints', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            created: true,
            candidate: {
              id: 'answer-gap-candidate-a1',
              status: 'shared',
              coverageKind: 'global_no_candidate_seen',
              missingInformation: ['flow speed'],
              expiresAt: '2026-07-14T12:00:00.000Z',
            },
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            candidate: {
              id: 'answer-gap-candidate-a1',
              status: 'declined',
              coverageKind: 'global_no_candidate_seen',
              missingInformation: ['flow speed'],
              expiresAt: '2026-07-14T12:00:00.000Z',
            },
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            candidate: {
              id: 'answer-gap-candidate-a1',
              status: 'withdrawn',
              coverageKind: 'global_no_candidate_seen',
              missingInformation: [],
              expiresAt: '2026-07-14T12:00:00.000Z',
            },
          },
        })
      );

    await expect(
      shareAnswerGapCandidate('answer-gap-candidate-a1', {
        includeContext: false,
        includeContact: true,
      })
    ).resolves.toMatchObject({
      created: true,
      candidate: { status: 'shared' },
    });
    await expect(declineAnswerGapCandidate('answer-gap-candidate-a1')).resolves.toMatchObject({
      candidate: { status: 'declined' },
    });
    await expect(withdrawAnswerGapCandidate('answer-gap-candidate-a1')).resolves.toMatchObject({
      candidate: { status: 'withdrawn' },
    });

    const requestMethods = fetchMock.mock.calls.map((call) => {
      const init = call[1];
      if (init === undefined) {
        throw new Error('Expected answer gap candidate request init.');
      }
      return [call[0], init.method];
    });

    expect(requestMethods).toEqual([
      ['/api/chat/answer-gap-candidates/answer-gap-candidate-a1/share', 'POST'],
      ['/api/chat/answer-gap-candidates/answer-gap-candidate-a1/decline', 'POST'],
      ['/api/chat/answer-gap-candidates/answer-gap-candidate-a1/withdraw', 'POST'],
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ includeContext: false, includeContact: true }),
    });
  });

  it('normalizes streamed final messages while passing answer deltas through unchanged', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'event: answer.started\ndata: {"conversationId":"c1","messageId":"a1"}\n\n',
        'event: answer.delta\ndata: {"text":"Pierwszy token"}\n\n',
        `event: answer.final\ndata: ${JSON.stringify({
          id: 'a1',
          userId: 'user-1',
          conversationId: 'c1',
          role: 'assistant',
          content: 'Pierwszy token',
          createdAt: '2026-06-14T12:00:00.000Z',
          citations: [],
          missingInformation: [],
          promptVersions,
          streamStatus: 'completed',
        })}\n\n`,
      ])
    );
    const events: unknown[] = [];

    await streamConversationMessage('c1', 'Best bait?', (event) => {
      events.push(event);
    });

    expect(events.slice(0, 2)).toEqual([
      { type: 'answer.started', data: { conversationId: 'c1', messageId: 'a1' } },
      { type: 'answer.delta', data: { text: 'Pierwszy token' } },
    ]);
    expect(events[2]).toMatchObject({
      type: 'answer.final',
      data: { id: 'a1', createdAt: '2026-06-14T12:00:00.000Z', promptVersions },
    });
  });

  it('passes abort signals through streaming requests', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(['event: done\ndata: {"ok":true}\n\n']));
    const abortController = new AbortController();

    await streamConversationMessage('c1', 'Best bait?', () => undefined, abortController.signal);

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      signal: abortController.signal,
    });
  });
});
