import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearApiAuthProvider, setApiAuthProvider } from './apiClient.js';
import { getUsageDimensions, queryUsageAggregates, queryUsageEvents } from './usageApi.js';

function jsonResponse(envelope: unknown): Response {
  return new Response(JSON.stringify(envelope), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('usageApi', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setApiAuthProvider({
      getAccessToken: vi.fn(() => Promise.resolve('usage-api-token')),
      refreshAccessToken: vi.fn(() => Promise.resolve('usage-api-token-refresh')),
    });
  });

  afterEach(() => {
    clearApiAuthProvider();
    vi.unstubAllGlobals();
  });

  it('queries admin aggregates through the same-origin admin route without retired owner identity', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: {
          rows: [],
          totals: {
            calls: 0,
            estimatedCostUsd: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            estimatedCallCount: 0,
            errorCallCount: 0,
          },
          meta: {
            timeRange: {
              from: '2026-05-18T00:00:00.000Z',
              to: '2026-06-17T23:59:59.999Z',
            },
            timeBucket: 'day',
            groupBy: ['time.bucket'],
            limit: 100,
          },
        },
      })
    );

    await queryUsageAggregates({
      timeRange: {
        from: '2026-05-18T00:00:00.000Z',
        to: '2026-06-17T23:59:59.999Z',
      },
      timeBucket: 'day',
      groupBy: ['time.bucket'],
      filters: {
        userIds: ['fa-user-1'],
        models: ['openai/gpt-4.1-mini'],
        promptTypes: ['fishing-answer'],
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/llm-usage/admin/aggregates/query');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    if (typeof requestBody !== 'string') {
      throw new Error('Expected usage aggregate request body to be serialized JSON.');
    }
    const body = JSON.parse(requestBody) as Record<string, unknown>;
    expect(body).toMatchObject({
      timeBucket: 'day',
      groupBy: ['time.bucket'],
      filters: {
        userIds: ['fa-user-1'],
        models: ['openai/gpt-4.1-mini'],
        promptTypes: ['fishing-answer'],
      },
    });
    expect(JSON.stringify(body)).not.toContain('ownerId');
    expect(JSON.stringify(body)).not.toContain('anonymous');
  });

  it('queries admin raw events and dimensions through admin-only routes', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, data: { events: [], nextCursor: 'cursor-1' } })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            models: ['openai/gpt-4.1-mini'],
            providers: ['openrouter'],
            components: ['rag-chat'],
            promptTypes: ['fishing-answer'],
            services: ['chat-service'],
            operations: ['chat.stream'],
          },
        })
      );

    await queryUsageEvents({
      timeRange: {
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-06-17T23:59:59.999Z',
      },
      filters: {
        services: ['chat-service'],
        components: ['rag-chat'],
        operations: ['chat.stream'],
      },
      limit: 50,
    });
    await getUsageDimensions({
      timeRange: {
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-06-17T23:59:59.999Z',
      },
      timeBucket: 'day',
    });

    expect(fetchMock.mock.calls.map((call) => [call[0], call[1]?.method ?? 'GET'])).toEqual([
      ['/api/llm-usage/admin/events/query', 'POST'],
      [
        '/api/llm-usage/admin/dimensions?from=2026-06-01T00%3A00%3A00.000Z&to=2026-06-17T23%3A59%3A59.999Z&timeBucket=day',
        'GET',
      ],
    ]);
  });
});
