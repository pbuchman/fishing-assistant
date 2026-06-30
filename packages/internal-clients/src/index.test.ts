import { describe, expect, it, vi } from 'vitest';

import {
  createKnowledgeServiceClient,
  createLlmUsageServiceClient,
  type FetchLike,
  type LlmUsageEventInput,
} from '@fa/internal-clients';
import type { CreateAnswerGapRequest } from '@fa/http-contracts';

const knowledgeItem = {
  id: 'knowledge-page:public-1',
  sourceId: 'knowledge-service',
  sourceType: 'knowledge_page',
  title: 'Groundbait notes',
  quote: 'Cold water mix',
  content: 'Use a subtle cold water mix.',
  score: 0.92,
  metadata: {
    headingPath: ['Winter'],
    path: ['Feeder', 'Winter'],
  },
};

const coverageProbe = {
  classification: 'higher_level_candidate_seen',
  minRequiredLevel: 8,
  candidateCountBucket: '1',
  probeVersion: '1.0.0',
};

const answerGapRequest = {
  source: 'no_accessible_evidence',
  question: 'How should I fish the canal in February?',
  missingInformation: ['No accessible Knowledge Base evidence matched this question.'],
  requester: {
    userId: 'user-123',
    email: 'angler@example.com',
    role: 'user',
    effectiveLevel: 6,
  },
  conversation: {
    conversationId: 'conversation-1',
    userMessageId: 'user-message-1',
    assistantMessageId: 'assistant-message-1',
    contextWindow: [{ role: 'user', content: 'How should I fish the canal in February?' }],
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
    sharedAt: '2026-06-19T09:00:00.000Z',
    includeContext: true,
    includeContact: true,
    candidateId: 'answer-gap-candidate-assistant-message-1',
  },
} satisfies CreateAnswerGapRequest;

const answerGap = {
  id: 'gap-1',
  status: 'needs_answer',
  ...answerGapRequest,
  formulatedQuestion: answerGapRequest.question,
  processing: { similarityStatus: 'not_started' },
  createdAt: '2026-06-19T09:00:00.000Z',
  updatedAt: '2026-06-19T09:00:00.000Z',
  doneAt: null,
  doneByUserId: null,
};

const usageEvent: LlmUsageEventInput = {
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
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    estimated: false,
  },
  correlation: {},
};

function ragAuthorization(userId = 'user-123') {
  return {
    userId,
    role: 'user' as const,
    status: 'approved' as const,
    effectiveLevel: 6 as const,
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');

  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers,
  });
}

function requireStringBody(body: BodyInit | null | undefined): string {
  if (typeof body === 'string') {
    return body;
  }

  throw new TypeError('Expected request body to be serialized JSON');
}

describe('createKnowledgeServiceClient', () => {
  it('trims trailing base URL slashes, sends internal auth, and serializes retrieval requests', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        ok: true,
        data: {
          items: [knowledgeItem],
          coverageProbe,
          diagnostics: {
            searchedChunkCount: 4,
            performance: {
              totalMs: 12,
              embeddingMs: 2,
            },
          },
        },
      })
    );
    const client = createKnowledgeServiceClient({
      baseUrl: 'http://knowledge-service.test///',
      internalAuthToken: 'internal-token',
      fetch: fetchImpl,
      timeoutMs: 500,
    });

    const result = await client.retrieve({
      authorization: ragAuthorization(),
      query: 'cold water feeder mix',
      conversationContext: {
        latestMessages: [{ role: 'user', content: 'What about winter?' }],
      },
      usageCorrelation: {
        conversationId: 'conversation-1',
        messageId: 'user-message-1',
      },
      options: { topK: 3 },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('http://knowledge-service.test/internal/retrieve');
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Auth': 'internal-token',
        },
      })
    );
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(requireStringBody(init?.body))).toEqual({
      authorization: ragAuthorization(),
      query: 'cold water feeder mix',
      conversationContext: {
        latestMessages: [{ role: 'user', content: 'What about winter?' }],
      },
      usageCorrelation: {
        conversationId: 'conversation-1',
        messageId: 'user-message-1',
      },
      options: { topK: 3 },
    });
    expect(result).toEqual({
      items: [knowledgeItem],
      coverageProbe,
      diagnostics: {
        searchedChunkCount: 4,
        performance: {
          totalMs: 12,
          embeddingMs: 2,
        },
      },
    });
  });

  it('posts answer gap capture requests and parses creation responses', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        ok: true,
        data: {
          gap: answerGap,
          created: true,
        },
      })
    );
    const client = createKnowledgeServiceClient({
      baseUrl: 'http://knowledge-service.test///',
      internalAuthToken: 'internal-token',
      fetch: fetchImpl,
      timeoutMs: 500,
    });

    const result = await client.createAnswerGap(answerGapRequest);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('http://knowledge-service.test/internal/answer-gaps');
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Auth': 'internal-token',
        },
      })
    );
    expect(JSON.parse(requireStringBody(init?.body))).toEqual(answerGapRequest);
    expect(result).toEqual({ gap: answerGap, created: true });
  });

  it('posts answer gap consent withdrawal requests and parses responses', async () => {
    const withdrawnGap = {
      ...answerGap,
      requester: {
        ...answerGap.requester,
        userId: 'anonymous-answer-gap-candidate-assistant-message-1',
        email: null,
        firstName: null,
        lastName: null,
      },
      conversation: {
        ...answerGap.conversation,
        contextWindow: [],
      },
      consent: {
        ...answerGap.consent,
        status: 'user_withdrew',
        withdrawnAt: '2026-06-19T09:30:00.000Z',
        includeContext: false,
        includeContact: false,
      },
    };
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        ok: true,
        data: {
          gap: withdrawnGap,
        },
      })
    );
    const client = createKnowledgeServiceClient({
      baseUrl: 'http://knowledge-service.test///',
      internalAuthToken: 'internal-token',
      fetch: fetchImpl,
      timeoutMs: 500,
    });

    const result = await client.withdrawAnswerGapConsent({
      gapId: 'answer-gap-assistant-message-1',
      candidateId: 'answer-gap-candidate-assistant-message-1',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(
      'http://knowledge-service.test/internal/answer-gaps/answer-gap-assistant-message-1/consent-withdrawal'
    );
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Auth': 'internal-token',
        },
      })
    );
    expect(JSON.parse(requireStringBody(init?.body))).toEqual({
      candidateId: 'answer-gap-candidate-assistant-message-1',
    });
    expect(result).toEqual({ gap: withdrawnGap });
  });

  it('throws typed errors for error envelopes', async () => {
    const client = createKnowledgeServiceClient({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: vi.fn<FetchLike>().mockResolvedValue(
        jsonResponse({
          ok: false,
          error: { code: 'INVALID_REQUEST', message: 'query must not be empty' },
        })
      ),
    });

    await expect(client.retrieve(minimalKnowledgeRequest())).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'query must not be empty',
      service: 'knowledge-service',
    });
  });

  it('preserves error envelope fields from non-2xx responses', async () => {
    const client = createKnowledgeServiceClient({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: vi.fn<FetchLike>().mockResolvedValue(
        jsonResponse(
          {
            ok: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'Internal auth failed',
              details: { reason: 'missing-header' },
            },
          },
          { status: 401 }
        )
      ),
    });

    await expect(client.retrieve(minimalKnowledgeRequest())).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Internal auth failed',
      service: 'knowledge-service',
      statusCode: 401,
      details: { reason: 'missing-header' },
    });
  });

  it('throws typed errors for non-2xx responses', async () => {
    const client = createKnowledgeServiceClient({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ ok: false }, { status: 503 })),
    });

    await expect(client.retrieve(minimalKnowledgeRequest())).rejects.toMatchObject({
      code: 'DOWNSTREAM_ERROR',
      statusCode: 503,
      message: 'Knowledge Service internal request failed with status 503',
    });
  });

  it('throws typed errors for invalid JSON and malformed success envelopes', async () => {
    const invalidJsonClient = createKnowledgeServiceClient({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: vi.fn<FetchLike>().mockResolvedValue(new Response('not json')),
    });
    const malformedClient = createKnowledgeServiceClient({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ ok: true, data: {} })),
    });

    await expect(invalidJsonClient.retrieve(minimalKnowledgeRequest())).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'Knowledge Service response was not valid JSON',
    });
    await expect(malformedClient.retrieve(minimalKnowledgeRequest())).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'Knowledge Service response did not include retrieval data',
    });
  });

  it('rejects knowledge retrieval evidence with internal citation URLs', async () => {
    const client = createKnowledgeServiceClient({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: vi.fn<FetchLike>().mockResolvedValue(
        jsonResponse({
          ok: true,
          data: {
            items: [
              {
                ...knowledgeItem,
                url: 'https://fishing-assistant.online/api/knowledge/admin/pages/page-1',
              },
            ],
            coverageProbe,
            diagnostics: { searchedChunkCount: 1 },
          },
        })
      ),
    });

    await expect(client.retrieve(minimalKnowledgeRequest())).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'Knowledge Service retrieval item 0 included a forbidden citation URL',
      service: 'knowledge-service',
    });
  });

  it('rejects malformed Knowledge Service coverage probes', async () => {
    const client = createKnowledgeServiceClient({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: vi.fn<FetchLike>().mockResolvedValue(
        jsonResponse({
          ok: true,
          data: {
            items: [knowledgeItem],
            coverageProbe: {
              classification: 'restricted-page-id',
              minRequiredLevel: 8,
              candidateCountBucket: '1',
              probeVersion: '1.0.0',
            },
            diagnostics: { searchedChunkCount: 1 },
          },
        })
      ),
    });

    await expect(client.retrieve(minimalKnowledgeRequest())).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'Knowledge Service response did not include a valid coverage probe',
      service: 'knowledge-service',
    });
  });

  it('aborts requests after the configured timeout', async () => {
    const fetchImpl = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        })
    );
    const client = createKnowledgeServiceClient({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: fetchImpl,
      timeoutMs: 1,
    });

    await expect(client.retrieve(minimalKnowledgeRequest())).rejects.toMatchObject({
      code: 'ABORTED',
      message: 'Knowledge Service internal request was aborted',
    });
  });
});

describe('createLlmUsageServiceClient', () => {
  it('posts usage events to the internal route with internal auth and parses success envelopes', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        ok: true,
        data: {
          accepted: 1,
          duplicates: 0,
          rejected: [],
        },
      })
    );
    const client = createLlmUsageServiceClient({
      baseUrl: 'http://usage-service.test/',
      internalAuthToken: 'internal-token',
      fetch: fetchImpl,
      timeoutMs: 500,
    });

    const result = await client.ingestUsageEvents([usageEvent]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('http://usage-service.test/internal/usage-events');
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Auth': 'internal-token',
        },
      })
    );
    expect(JSON.parse(requireStringBody(init?.body))).toEqual({ events: [usageEvent] });
    expect(result).toEqual({ accepted: 1, duplicates: 0, rejected: [] });
  });

  it('throws typed errors for usage error envelopes, invalid JSON, malformed envelopes, and non-2xx', async () => {
    const envelopeClient = createLlmUsageServiceClient({
      baseUrl: 'http://usage-service.test',
      internalAuthToken: 'internal-token',
      fetch: vi.fn<FetchLike>().mockResolvedValue(
        jsonResponse({
          ok: false,
          error: { code: 'UNAUTHORIZED', message: 'Internal auth failed' },
        })
      ),
    });
    const invalidJsonClient = createLlmUsageServiceClient({
      baseUrl: 'http://usage-service.test',
      internalAuthToken: 'internal-token',
      fetch: vi.fn<FetchLike>().mockResolvedValue(new Response('not json')),
    });
    const malformedClient = createLlmUsageServiceClient({
      baseUrl: 'http://usage-service.test',
      internalAuthToken: 'internal-token',
      fetch: vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ ok: true, data: {} })),
    });
    const non2xxClient = createLlmUsageServiceClient({
      baseUrl: 'http://usage-service.test',
      internalAuthToken: 'internal-token',
      fetch: vi.fn<FetchLike>().mockResolvedValue(new Response('nope', { status: 502 })),
    });

    await expect(envelopeClient.ingestUsageEvents([usageEvent])).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Internal auth failed',
      service: 'llm-usage-service',
    });
    await expect(invalidJsonClient.ingestUsageEvents([usageEvent])).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'LLM Usage Service response was not valid JSON',
    });
    await expect(malformedClient.ingestUsageEvents([usageEvent])).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'LLM Usage Service response did not include valid usage ingestion data',
    });
    await expect(non2xxClient.ingestUsageEvents([usageEvent])).rejects.toMatchObject({
      code: 'DOWNSTREAM_ERROR',
      statusCode: 502,
      message: 'LLM Usage Service internal request failed with status 502',
    });
  });

  it('strictly validates usage success envelope data', async () => {
    const cases: { name: string; data: unknown }[] = [
      {
        name: 'missing accepted count',
        data: { duplicates: 0, rejected: [] },
      },
      {
        name: 'non-finite duplicates count',
        data: { accepted: 1, duplicates: Number.POSITIVE_INFINITY, rejected: [] },
      },
      {
        name: 'malformed rejected entry',
        data: { accepted: 1, duplicates: 0, rejected: [{ id: 'event-1', code: 'BAD' }] },
      },
    ];

    for (const item of cases) {
      const client = createLlmUsageServiceClient({
        baseUrl: 'http://usage-service.test',
        internalAuthToken: 'internal-token',
        fetch: vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ ok: true, data: item.data })),
      });

      await expect(client.ingestUsageEvents([usageEvent]), item.name).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
        message: 'LLM Usage Service response did not include valid usage ingestion data',
        service: 'llm-usage-service',
      });
    }
  });

  it('honors caller abort signals', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
          controller.abort();
        })
    );
    const client = createLlmUsageServiceClient({
      baseUrl: 'http://usage-service.test',
      internalAuthToken: 'internal-token',
      fetch: fetchImpl,
    });

    await expect(
      client.ingestUsageEvents([usageEvent], { signal: controller.signal })
    ).rejects.toMatchObject({
      code: 'ABORTED',
      message: 'LLM Usage Service internal request was aborted',
    });
  });

  it('classifies Error-like AbortError rejections as aborted requests', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const client = createLlmUsageServiceClient({
      baseUrl: 'http://usage-service.test',
      internalAuthToken: 'internal-token',
      fetch: vi.fn<FetchLike>().mockRejectedValue(abortError),
    });

    await expect(client.ingestUsageEvents([usageEvent])).rejects.toMatchObject({
      code: 'ABORTED',
      message: 'LLM Usage Service internal request was aborted',
    });
  });
});

function minimalKnowledgeRequest() {
  return {
    authorization: ragAuthorization(),
    query: 'winter feeder',
    conversationContext: { latestMessages: [] },
    options: { topK: 2 },
  };
}
