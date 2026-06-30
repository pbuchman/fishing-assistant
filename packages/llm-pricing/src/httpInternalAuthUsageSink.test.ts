import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpInternalAuthUsageSink } from '@fa/llm-pricing';
import type { Logger } from '@fa/common-core';
import type { HttpInternalAuthUsageSinkConfig, UsageSinkRecordParams } from '@fa/llm-pricing';

const debug = vi.fn();
const info = vi.fn();
const warn = vi.fn();
const error = vi.fn();

const logger: Logger = {
  debug,
  info,
  warn,
  error,
};

function resetLogger(): void {
  debug.mockClear();
  info.mockClear();
  warn.mockClear();
  error.mockClear();
}

function createSink(
  overrides: Partial<
    Pick<
      HttpInternalAuthUsageSinkConfig,
      'flushIntervalMs' | 'maxBatchSize' | 'timeoutMs' | 'usageServiceUrl'
    >
  > = {}
) {
  return new HttpInternalAuthUsageSink({
    usageServiceUrl: overrides.usageServiceUrl ?? 'http://usage-service.test',
    internalAuthToken: 'internal-token',
    service: 'chat-service',
    component: 'rag-chat',
    logger,
    flushIntervalMs: overrides.flushIntervalMs ?? 60_000,
    maxBatchSize: overrides.maxBatchSize ?? 100,
    ...(overrides.timeoutMs !== undefined ? { timeoutMs: overrides.timeoutMs } : {}),
  });
}

function chatRecord(overrides: Partial<UsageSinkRecordParams> = {}): UsageSinkRecordParams {
  return {
    id: 'event-1',
    owner: { type: 'user', id: 'user-123' },
    provider: 'openrouter',
    model: 'google/gemini-3.5-flash',
    operation: 'chat.completion',
    promptType: 'fishing-answer',
    promptVersion: '1.0.0',
    inputTokens: 100,
    outputTokens: 25,
    cost: { estimatedCostUsd: 0.00025, source: 'provider-reported' },
    ...overrides,
  };
}

describe('HttpInternalAuthUsageSink', () => {
  beforeEach(() => {
    resetLogger();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts buffered events to the internal usage ingestion route with internal auth', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { accepted: 1, duplicates: 0, rejected: [] } }))
    );
    const sink = createSink();

    await sink.record(chatRecord());
    await sink.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    const requestInit = call?.[1];
    expect(fetchMock).toHaveBeenCalledWith(
      'http://usage-service.test/internal/usage-events',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Auth': 'internal-token',
        },
      })
    );
    expect(typeof requestInit?.body).toBe('string');
    const requestBody = typeof requestInit?.body === 'string' ? requestInit.body : '';
    expect(JSON.parse(requestBody)).toEqual({
      events: [
        expect.objectContaining({
          id: 'event-1',
          owner: { type: 'user', id: 'user-123' },
          source: {
            service: 'chat-service',
            component: 'rag-chat',
            operation: 'chat.completion',
            promptType: 'fishing-answer',
          },
          request: {
            provider: 'openrouter',
            model: 'google/gemini-3.5-flash',
            promptVersion: '1.0.0',
          },
          usage: {
            inputTokens: 100,
            outputTokens: 25,
            totalTokens: 125,
            estimated: false,
          },
          cost: {
            estimatedCostUsd: 0.00025,
            source: 'provider-reported',
          },
        }),
      ],
    });
  });

  it('does not call fetch when record input is invalid', async () => {
    const sink = createSink();

    await expect(
      sink.record({
        ...chatRecord({ operation: 'chat.stream', promptVersion: '1.0.0' }),
        inputTokens: -1,
        outputTokens: 1,
      })
    ).rejects.toThrow('inputTokens must be a non-negative safe integer');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not call fetch when flushing an empty buffer', async () => {
    const sink = createSink();

    await sink.flush();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses default flush interval and strips trailing slashes before max-batch flush', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ accepted: 1, duplicates: 0, rejected: [] }))
    );
    const sink = createSink({
      usageServiceUrl: 'http://usage-service.test///',
      maxBatchSize: 1,
    });

    await sink.record(
      chatRecord({
        id: 'event-defaults',
        inputTokens: 10,
        outputTokens: 5,
      })
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://usage-service.test/internal/usage-events',
      expect.any(Object)
    );
  });

  it('flushes immediately when the interval is zero and logs malformed JSON bodies', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('not json'));
    const sink = createSink({ flushIntervalMs: 0 });

    await sink.record(
      chatRecord({
        id: 'event-immediate',
        inputTokens: 10,
        outputTokens: 5,
      })
    );
    await sink.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'LLM Usage Service response was not valid JSON',
        batchSize: 1,
      }),
      'Usage service ingest request failed'
    );
  });

  it('logs sanitized rejected event summaries and swallows the response by default', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            accepted: 0,
            duplicates: 0,
            rejected: [
              {
                index: 0,
                id: 'event-2-angler@example.com',
                code: 'INVALID_USAGE_EVENT',
                message: 'missing pricing for sensitive prompt fragment and auth0|user-123',
              },
            ],
          },
        })
      )
    );
    const sink = createSink();

    await sink.record(
      chatRecord({
        id: 'event-2',
        model: 'missing-model',
        inputTokens: 10,
        outputTokens: 5,
      })
    );
    await sink.flush();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        rejectedCount: 1,
        rejected: [{ index: 0, code: 'INVALID_USAGE_EVENT' }],
      }),
      'Usage service rejected usage events'
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('event-2-angler@example.com');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive prompt fragment');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('auth0|user-123');
  });

  it('logs malformed top-level usage responses through the shared client', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          rejected: [
            { id: 'event-4', code: 'INVALID_REQUEST', message: 'bad input' },
            { id: 'event-ignored', code: 'INVALID_REQUEST' },
          ],
        })
      )
    );
    const sink = createSink();

    await sink.record(
      chatRecord({
        id: 'event-4',
        inputTokens: 10,
        outputTokens: 5,
      })
    );
    await sink.flush();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'LLM Usage Service response envelope was malformed',
        batchSize: 1,
      }),
      'Usage service ingest request failed'
    );
  });

  it('logs non-2xx responses without throwing by default', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('nope', { status: 503 }));
    const sink = createSink();

    await sink.record(
      chatRecord({
        id: 'event-503',
        inputTokens: 10,
        outputTokens: 5,
      })
    );
    await expect(sink.flush()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 503, batchSize: 1 }),
      'Usage service returned non-2xx status'
    );
  });

  it('logs fetch failures by default and rethrows them when requested', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('still down'));
    const sink = createSink();

    await sink.record(
      chatRecord({
        id: 'event-network',
        inputTokens: 10,
        outputTokens: 5,
      })
    );
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'network down' }),
      'Usage service ingest request failed'
    );

    await sink.record(
      chatRecord({
        id: 'event-network-rethrow',
        inputTokens: 10,
        outputTokens: 5,
      })
    );
    await expect(sink.flush({ rethrow: true })).rejects.toThrow('still down');
  });

  it('aborts usage ingestion requests after the configured timeout and logs the failure', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(
      (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        })
    );
    const sink = createSink({ timeoutMs: 50 });

    await sink.record(
      chatRecord({
        id: 'event-timeout',
        inputTokens: 10,
        outputTokens: 5,
      })
    );
    const flushPromise = sink.flush();
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'LLM Usage Service internal request was aborted',
        batchSize: 1,
      }),
      'Usage service ingest request failed'
    );
    await flushPromise;
  });

  it('throws only when explicitly flushing with rethrow', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('nope', { status: 503 }));
    const sink = createSink();

    await sink.record(
      chatRecord({
        id: 'event-3',
        inputTokens: 10,
        outputTokens: 5,
      })
    );

    await expect(sink.flush({ rethrow: true })).rejects.toThrow(
      'Usage service returned status 503'
    );
  });
});
