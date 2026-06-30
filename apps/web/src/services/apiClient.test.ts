import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiClientError,
  apiRequest,
  apiSseRequest,
  clearApiAuthProvider,
  normalizeApiTimestamp,
  setApiAuthProvider,
} from './apiClient.js';

function jsonResponse(envelope: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(envelope),
  } as Response;
}

function invalidJsonResponse(init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.reject(new SyntaxError('Unexpected token')),
  } as unknown as Response;
}

function tokenResolver(token: string): () => Promise<string> {
  return () => Promise.resolve(token);
}

describe('apiRequest', () => {
  const fetchMock = vi.fn<typeof fetch>();

  function getLastRequestInit(): RequestInit {
    const call = fetchMock.mock.calls.at(-1);

    if (call === undefined) {
      throw new Error('Expected fetch to be called.');
    }

    return call[1] ?? {};
  }

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setApiAuthProvider({
      getAccessToken: vi.fn(tokenResolver('default-token')),
      refreshAccessToken: vi.fn(tokenResolver('default-token-refresh')),
    });
  });

  afterEach(() => {
    clearApiAuthProvider();
    vi.unstubAllGlobals();
  });

  it('returns data from a successful API envelope and requests JSON', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { status: 'ready' } }));

    await expect(apiRequest('/api/chat/health')).resolves.toEqual({ status: 'ready' });

    const init = getLastRequestInit();
    const headers = init.headers as Headers;
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('sets JSON content type for request bodies when one is not provided', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: null }));

    await apiRequest('/api/chat/messages', { body: JSON.stringify({ text: 'hello' }) });

    const init = getLastRequestInit();
    const headers = init.headers as Headers;
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('attaches an authorization bearer token to JSON requests', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { ok: true } }));
    const getAccessToken = vi.fn(tokenResolver('token-123'));
    setApiAuthProvider({
      getAccessToken,
      refreshAccessToken: vi.fn(tokenResolver('token-refresh')),
    });

    await expect(apiRequest('/api/chat/health')).resolves.toEqual({ ok: true });

    const init = getLastRequestInit();
    const headers = init.headers as Headers;
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(headers.get('Authorization')).toBe('Bearer token-123');
  });

  it('rejects product JSON requests without an auth provider before calling fetch', async () => {
    clearApiAuthProvider();

    await expect(apiRequest('/api/chat/health')).rejects.toEqual(
      new ApiClientError('Authentication is required.', 401)
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes fetch failures into friendly network errors', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(apiRequest('/api/chat/conversations')).rejects.toMatchObject({
      message: 'Connection interrupted. Check your network and try again.',
    });
  });

  it('preserves an explicit content type for request bodies', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: null }));

    await apiRequest('/api/chat/messages', {
      body: 'plain text',
      headers: { 'Content-Type': 'text/plain' },
    });

    const init = getLastRequestInit();
    const headers = init.headers as Headers;
    expect(headers.get('Content-Type')).toBe('text/plain');
  });

  it('throws the API error field from a failed envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, error: 'Internal auth failed.' }, { ok: false, status: 500 })
    );

    await expect(apiRequest('/api/chat')).rejects.toMatchObject({
      name: 'ApiClientError',
      message: 'Internal auth failed.',
      status: 500,
    });
  });

  it('retries JSON requests exactly once after a 401 with a refreshed token', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ ok: false, error: 'token expired' }, { ok: false, status: 401 })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { ok: true } }));
    const getAccessToken = vi.fn(tokenResolver('token-initial'));
    const refreshAccessToken = vi.fn(tokenResolver('token-refreshed'));
    setApiAuthProvider({ getAccessToken, refreshAccessToken });

    await expect(apiRequest('/api/chat/health')).resolves.toEqual({ ok: true });

    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      ((fetchMock.mock.calls[0]?.[1]?.headers ?? undefined) as Headers).get('Authorization')
    ).toBe('Bearer token-initial');
    expect(
      ((fetchMock.mock.calls[1]?.[1]?.headers ?? undefined) as Headers).get('Authorization')
    ).toBe('Bearer token-refreshed');
  });

  it('does not retry JSON requests with a different auth provider after account switch', async () => {
    const firstProvider = {
      getAccessToken: vi.fn(tokenResolver('token-user-a')),
      refreshAccessToken: vi.fn(tokenResolver('token-user-a-refresh')),
    };
    const secondProvider = {
      getAccessToken: vi.fn(tokenResolver('token-user-b')),
      refreshAccessToken: vi.fn(tokenResolver('token-user-b-refresh')),
    };
    setApiAuthProvider(firstProvider);
    fetchMock.mockImplementationOnce(() => {
      setApiAuthProvider(secondProvider);
      return Promise.resolve(
        jsonResponse({ ok: false, error: 'token expired' }, { ok: false, status: 401 })
      );
    });

    await expect(apiRequest('/api/chat/health')).rejects.toMatchObject({
      message: 'token expired',
      status: 401,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstProvider.refreshAccessToken).not.toHaveBeenCalled();
    expect(secondProvider.getAccessToken).not.toHaveBeenCalled();
    expect(secondProvider.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('does not retry JSON requests after a 403 response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, error: 'forbidden' }, { ok: false, status: 403 })
    );
    const refreshAccessToken = vi.fn(tokenResolver('token-refreshed'));
    setApiAuthProvider({
      getAccessToken: vi.fn(tokenResolver('token-initial')),
      refreshAccessToken,
    });

    await expect(apiRequest('/api/chat/health')).rejects.toMatchObject({
      message: 'forbidden',
      status: 403,
    });

    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws the nested API error message from current service envelopes', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { ok: false, error: { code: 'INVALID_REQUEST', message: 'message must not be empty' } },
        { ok: false, status: 400 }
      )
    );

    await expect(apiRequest('/api/chat/conversations/c1/messages/stream')).rejects.toMatchObject({
      name: 'ApiClientError',
      message: 'message must not be empty',
      status: 400,
    });
  });

  it('falls back to message and default API errors', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ ok: false, message: 'Service unavailable.' }, { ok: false, status: 503 })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: false }, { ok: false, status: 500 }));

    await expect(apiRequest('/api/knowledge')).rejects.toMatchObject({
      message: 'Service unavailable.',
      status: 503,
    });
    await expect(apiRequest('/api/knowledge')).rejects.toMatchObject({
      message: 'API request failed.',
      status: 500,
    });
  });

  it('normalizes recoverable gateway failures even when the response has an envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: null }, { ok: false, status: 502 })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { ok: false, error: 'API request failed with status 502.' },
        { ok: false, status: 502 }
      )
    );

    await expect(apiRequest('/api/llm-usage')).rejects.toMatchObject({
      message: 'Connection interrupted. Check your network and try again.',
      status: 502,
    });
    await expect(apiRequest('/api/chat/conversations')).rejects.toMatchObject({
      message: 'Connection interrupted. Check your network and try again.',
      status: 502,
    });
  });

  it('wraps invalid JSON responses in an API client error', async () => {
    fetchMock
      .mockResolvedValueOnce(invalidJsonResponse())
      .mockResolvedValueOnce(invalidJsonResponse({ ok: false, status: 502 }));

    await expect(apiRequest('/api/chat')).rejects.toMatchObject({
      message: 'API response was not valid JSON.',
      status: 200,
    });
    await expect(apiRequest('/api/chat')).rejects.toMatchObject({
      message: 'Connection interrupted. Check your network and try again.',
      status: 502,
    });
  });

  it('normalizes Firestore timestamp shapes and falls back for unknown values', () => {
    expect(normalizeApiTimestamp('2026-06-14T12:00:00.000Z')).toBe('2026-06-14T12:00:00.000Z');
    expect(normalizeApiTimestamp({ seconds: 1781438400, nanoseconds: 500_000_000 })).toBe(
      '2026-06-14T12:00:00.500Z'
    );
    expect(normalizeApiTimestamp({ nope: true })).toBe('');
    expect(normalizeApiTimestamp(null)).toBe('');
  });

  it('leaves multipart request content type unset so the browser can add the boundary', async () => {
    const formData = new FormData();
    formData.set('file', new File(['# Tench'], 'tench.md', { type: 'text/markdown' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { uploaded: true } }));

    await apiRequest('/api/knowledge/admin/pages/page-1/sync', { method: 'POST', body: formData });

    const init = getLastRequestInit();
    const headers = init.headers as Headers;
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('parses chunked server-sent events in order', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('event: token\ndata: {"text":"Use corn"}\n\nevent: missing_info\n')
        );
        controller.enqueue(
          encoder.encode('data: {"missingInformation":["water temperature"]}\n\n')
        );
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));
    const events: { event: string; data: unknown }[] = [];

    await apiSseRequest('/api/chat/conversations/c1/messages/stream', {
      body: JSON.stringify({ message: 'What bait?' }),
      onEvent: (event) => events.push(event),
    });

    expect(events).toEqual([
      { event: 'token', data: { text: 'Use corn' } },
      { event: 'missing_info', data: { missingInformation: ['water temperature'] } },
    ]);
    const init = getLastRequestInit();
    const headers = init.headers as Headers;
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('attaches an authorization bearer token to SSE setup requests', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"ok":true}\n\n'));
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));
    const getAccessToken = vi.fn(tokenResolver('token-sse'));
    setApiAuthProvider({
      getAccessToken,
      refreshAccessToken: vi.fn(tokenResolver('token-refresh')),
    });

    await apiSseRequest('/api/chat/conversations/c1/messages/stream', {
      onEvent: () => undefined,
    });

    const init = getLastRequestInit();
    const headers = init.headers as Headers;
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(headers.get('Authorization')).toBe('Bearer token-sse');
  });

  it('rejects product SSE setup requests without an auth provider before calling fetch', async () => {
    clearApiAuthProvider();

    await expect(
      apiSseRequest('/api/chat/conversations/c1/messages/stream', {
        onEvent: () => undefined,
      })
    ).rejects.toEqual(new ApiClientError('Authentication is required.', 401));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes SSE setup fetch failures into friendly network errors', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(
      apiSseRequest('/api/chat/conversations/c1/messages/stream', {
        method: 'POST',
        body: JSON.stringify({ message: 'test' }),
        onEvent: vi.fn(),
      })
    ).rejects.toMatchObject({
      message: 'Connection interrupted. Check your network and try again.',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('normalizes SSE reader failures into friendly network errors', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError('network error'));
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    await expect(
      apiSseRequest('/api/chat/conversations/c1/messages/stream', {
        method: 'POST',
        body: JSON.stringify({ message: 'test' }),
        onEvent: vi.fn(),
      })
    ).rejects.toMatchObject({
      message:
        'Connection interrupted while reading the answer. Try again when the connection is stable.',
    });
  });

  it('parses default SSE message events and ignores comment-only blocks', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(':keepalive\n\ndata: {"ok":true}\n'));
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));
    const events: { event: string; data: unknown }[] = [];

    await apiSseRequest('/api/chat/conversations/c1/messages/stream', {
      onEvent: (event) => events.push(event),
    });

    expect(events).toEqual([{ event: 'message', data: { ok: true } }]);
  });

  it('throws API client errors for failed or bodyless SSE responses', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { ok: false, error: { code: 'INVALID_REQUEST', message: 'message must not be empty' } },
          { ok: false, status: 400 }
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { ok: false, error: 'API request failed with status 502.' },
          { ok: false, status: 502 }
        )
      )
      .mockResolvedValueOnce(invalidJsonResponse({ ok: false, status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(
      apiSseRequest('/api/chat/conversations/c1/messages/stream', { onEvent: () => undefined })
    ).rejects.toMatchObject({ message: 'message must not be empty', status: 400 });
    await expect(
      apiSseRequest('/api/chat/conversations/c1/messages/stream', { onEvent: () => undefined })
    ).rejects.toMatchObject({
      message: 'Connection interrupted. Check your network and try again.',
      status: 502,
    });
    await expect(
      apiSseRequest('/api/chat/conversations/c1/messages/stream', { onEvent: () => undefined })
    ).rejects.toMatchObject({
      message: 'Connection interrupted. Check your network and try again.',
      status: 502,
    });
    await expect(
      apiSseRequest('/api/chat/conversations/c1/messages/stream', { onEvent: () => undefined })
    ).rejects.toMatchObject({ message: 'SSE response did not include a body.', status: 200 });
  });

  it('retries SSE setup exactly once after a pre-stream 401 with a refreshed token', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"ok":true}\n\n'));
        controller.close();
      },
    });
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ ok: false, error: 'expired' }, { ok: false, status: 401 })
      )
      .mockResolvedValueOnce(new Response(stream, { status: 200 }));
    const getAccessToken = vi.fn(tokenResolver('token-initial'));
    const refreshAccessToken = vi.fn(tokenResolver('token-refreshed'));
    setApiAuthProvider({ getAccessToken, refreshAccessToken });

    await apiSseRequest('/api/chat/conversations/c1/messages/stream', {
      onEvent: () => undefined,
    });

    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      ((fetchMock.mock.calls[0]?.[1]?.headers ?? undefined) as Headers).get('Authorization')
    ).toBe('Bearer token-initial');
    expect(
      ((fetchMock.mock.calls[1]?.[1]?.headers ?? undefined) as Headers).get('Authorization')
    ).toBe('Bearer token-refreshed');
  });

  it('normalizes refreshed SSE setup fetch failures into friendly network errors', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ ok: false, error: 'expired' }, { ok: false, status: 401 })
      )
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const getAccessToken = vi.fn(tokenResolver('token-initial'));
    const refreshAccessToken = vi.fn(tokenResolver('token-refreshed'));
    setApiAuthProvider({ getAccessToken, refreshAccessToken });

    await expect(
      apiSseRequest('/api/chat/conversations/c1/messages/stream', {
        onEvent: () => undefined,
      })
    ).rejects.toMatchObject({
      message: 'Connection interrupted. Check your network and try again.',
    });

    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry SSE setup with a different auth provider after account switch', async () => {
    const firstProvider = {
      getAccessToken: vi.fn(tokenResolver('token-user-a')),
      refreshAccessToken: vi.fn(tokenResolver('token-user-a-refresh')),
    };
    const secondProvider = {
      getAccessToken: vi.fn(tokenResolver('token-user-b')),
      refreshAccessToken: vi.fn(tokenResolver('token-user-b-refresh')),
    };
    setApiAuthProvider(firstProvider);
    fetchMock.mockImplementationOnce(() => {
      setApiAuthProvider(secondProvider);
      return Promise.resolve(
        jsonResponse({ ok: false, error: 'expired' }, { ok: false, status: 401 })
      );
    });

    await expect(
      apiSseRequest('/api/chat/conversations/c1/messages/stream', {
        onEvent: () => undefined,
      })
    ).rejects.toMatchObject({ message: 'expired', status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstProvider.refreshAccessToken).not.toHaveBeenCalled();
    expect(secondProvider.getAccessToken).not.toHaveBeenCalled();
    expect(secondProvider.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('does not retry SSE setup after a 403 response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, error: 'forbidden' }, { ok: false, status: 403 })
    );
    const refreshAccessToken = vi.fn(tokenResolver('token-refreshed'));
    setApiAuthProvider({
      getAccessToken: vi.fn(tokenResolver('token-initial')),
      refreshAccessToken,
    });

    await expect(
      apiSseRequest('/api/chat/conversations/c1/messages/stream', {
        onEvent: () => undefined,
      })
    ).rejects.toMatchObject({ message: 'forbidden', status: 403 });

    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
