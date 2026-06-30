import { describe, expect, test, vi } from 'vitest';

import type {
  ChatCompletionRequest,
  EmbeddingRequest,
  LlmProviderCallPolicy,
  LlmProviderOperation,
} from '@fa/llm-contract';
import { FakeUsageSink } from '@fa/llm-pricing';

import {
  CURATED_CHAT_MODELS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_MINIMAX_BASE_URL,
  DEFAULT_OPENROUTER_PROVIDER_SORT,
  MINIMAX_CHAT_MODEL,
  MINIMAX_PROVIDER,
  assertValidCuratedChatModelCatalog,
  createLlmProviders,
  findCuratedChatModel,
  isCuratedChatModelId,
  packageName,
  resolveLlmProviderConfig,
  type FetchLike,
} from '@fa/llm-factory';

interface RecordedFetch extends FetchLike {
  calls: { input: string; init?: RequestInit }[];
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function sseResponse(chunks: readonly string[], init: ResponseInit = {}): Response {
  return new Response(chunks.join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    ...init,
  });
}

function fetchReturning(response: Response): RecordedFetch {
  const calls: { input: string; init?: RequestInit }[] = [];
  const fetchMock: FetchLike = (input, init) => {
    calls.push({ input, ...(init !== undefined ? { init } : {}) });
    return Promise.resolve(response);
  };

  return Object.assign(fetchMock, { calls });
}

function fetchSequence(responses: readonly Response[]): RecordedFetch {
  const calls: { input: string; init?: RequestInit }[] = [];
  const fetchMock: FetchLike = (input, init) => {
    calls.push({ input, ...(init !== undefined ? { init } : {}) });
    const response = responses[calls.length - 1] ?? responses.at(-1);
    if (response === undefined) {
      throw new Error('Expected a response fixture');
    }

    return Promise.resolve(response);
  };

  return Object.assign(fetchMock, { calls });
}

function fetchRejectingOnAbort(onCall?: () => void): RecordedFetch {
  const calls: { input: string; init?: RequestInit }[] = [];
  const fetchMock: FetchLike = (input, init) => {
    calls.push({ input, ...(init !== undefined ? { init } : {}) });

    return new Promise<Response>((_resolve, reject) => {
      const fallback = setTimeout(() => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }, 20);
      init?.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(fallback);
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        },
        { once: true }
      );
      onCall?.();
    });
  };

  return Object.assign(fetchMock, { calls });
}

function stallingBodyResponse(input: {
  signal?: AbortSignal;
  contentType: string;
  fallbackErrorMessage: string;
}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const fallback = setTimeout(() => {
        controller.error(new Error(input.fallbackErrorMessage));
      }, 25);
      const abort = () => {
        clearTimeout(fallback);
        controller.error(new DOMException('The operation was aborted.', 'AbortError'));
      };

      if (input.signal?.aborted === true) {
        abort();
      } else {
        input.signal?.addEventListener('abort', abort, { once: true });
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': input.contentType },
  });
}

function fetchReturningStallingJsonBody(input: {
  fallbackErrorMessage: string;
  onResponse?: () => void;
}): RecordedFetch {
  const calls: { input: string; init?: RequestInit }[] = [];
  const fetchMock: FetchLike = (url, init) => {
    calls.push({ input: url, ...(init !== undefined ? { init } : {}) });
    const signal = init?.signal ?? undefined;
    const response = stallingBodyResponse({
      contentType: 'application/json',
      fallbackErrorMessage: input.fallbackErrorMessage,
      ...(signal !== undefined ? { signal } : {}),
    });
    input.onResponse?.();

    return Promise.resolve(response);
  };

  return Object.assign(fetchMock, { calls });
}

function fetchReturningStallingSseBody(input: {
  fallbackErrorMessage: string;
  onResponse?: () => void;
}): RecordedFetch {
  const calls: { input: string; init?: RequestInit }[] = [];
  const fetchMock: FetchLike = (url, init) => {
    calls.push({ input: url, ...(init !== undefined ? { init } : {}) });
    const signal = init?.signal ?? undefined;
    const response = stallingBodyResponse({
      contentType: 'text/event-stream',
      fallbackErrorMessage: input.fallbackErrorMessage,
      ...(signal !== undefined ? { signal } : {}),
    });
    input.onResponse?.();

    return Promise.resolve(response);
  };

  return Object.assign(fetchMock, { calls });
}

function firstJsonRequestBody(fetchMock: RecordedFetch): unknown {
  const firstCall = fetchMock.calls[0];
  if (firstCall === undefined || typeof firstCall.init?.body !== 'string') {
    throw new Error('Expected fetch to be called with a JSON string body');
  }

  return JSON.parse(firstCall.init.body) as unknown;
}

async function collectAsyncIterable<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const item of items) {
    collected.push(item);
  }

  return collected;
}

function baseEnv(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    FA_OPENROUTER_APP_API_KEY: 'test-openrouter-key',
    FA_MINIMAX_APP_API_KEY: 'test-minimax-key',
    ...overrides,
  };
}

const testPromptVersion = '1.0.0';

function chatUsageMetadata(
  overrides: Partial<
    Pick<ChatCompletionRequest, 'owner' | 'promptType' | 'promptVersion' | 'correlation'>
  > = {}
): Pick<ChatCompletionRequest, 'owner' | 'promptType' | 'promptVersion' | 'correlation'> {
  return {
    owner: { type: 'user', id: 'test-user-1' },
    promptType: 'fishing-answer',
    promptVersion: testPromptVersion,
    ...overrides,
  };
}

function embeddingUsageMetadata(
  overrides: Partial<
    Pick<EmbeddingRequest, 'owner' | 'promptType' | 'promptVersion' | 'correlation'>
  > = {}
): Pick<EmbeddingRequest, 'owner' | 'promptType' | 'promptVersion' | 'correlation'> {
  return {
    owner: { type: 'user', id: 'test-user-1' },
    promptType: 'rag-query-embedding',
    promptVersion: testPromptVersion,
    ...overrides,
  };
}

type ProvidersUnderTest = ReturnType<typeof createLlmProviders>;

interface ProviderPolicyRequestOptions {
  signal?: AbortSignal;
  providerCallPolicy?: LlmProviderCallPolicy;
}

interface ProviderPolicyOperationCase {
  name: string;
  operation: LlmProviderOperation;
  invoke: (
    providers: ProvidersUnderTest,
    options?: ProviderPolicyRequestOptions
  ) => Promise<unknown>;
  successResponse: () => Response;
  statusResponse: (status: number) => Response;
  expectedUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

function providerPolicyRequestOptions(
  options: ProviderPolicyRequestOptions = {}
): ProviderPolicyRequestOptions {
  return {
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.providerCallPolicy !== undefined
      ? { providerCallPolicy: options.providerCallPolicy }
      : {}),
  };
}

const providerPolicyOperationCases: ProviderPolicyOperationCase[] = [
  {
    name: 'chat completion',
    operation: 'chat.completion',
    invoke: (providers, options) =>
      providers.chat.complete({
        ...chatUsageMetadata(),
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'Policy matrix completion?' }],
        ...providerPolicyRequestOptions(options),
      }),
    successResponse: () =>
      jsonResponse({
        choices: [
          {
            message: { role: 'assistant', content: 'Completion recovered.' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 3,
          total_tokens: 8,
        },
      }),
    statusResponse: (status) =>
      jsonResponse({ error: { message: `completion failed with ${String(status)}` } }, { status }),
    expectedUsage: {
      inputTokens: 5,
      outputTokens: 3,
      totalTokens: 8,
    },
  },
  {
    name: 'chat stream setup',
    operation: 'chat.stream',
    invoke: (providers, options) =>
      collectAsyncIterable(
        providers.chat.stream({
          ...chatUsageMetadata(),
          ...chatUsageMetadata(),
          messages: [{ role: 'user', content: 'Policy matrix stream?' }],
          ...providerPolicyRequestOptions(options),
        })
      ),
    successResponse: () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Stream recovered."}}]}\n\n',
        'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":6,"completion_tokens":4,"total_tokens":10}}\n\n',
        'data: [DONE]\n\n',
      ]),
    statusResponse: (status) => sseResponse([`stream failed with ${String(status)}`], { status }),
    expectedUsage: {
      inputTokens: 6,
      outputTokens: 4,
      totalTokens: 10,
    },
  },
  {
    name: 'embedding',
    operation: 'embedding',
    invoke: (providers, options) =>
      providers.embeddings.embed({
        ...embeddingUsageMetadata(),
        ...embeddingUsageMetadata(),
        input: 'policy matrix embedding',
        dimensions: 2,
        ...providerPolicyRequestOptions(options),
      }),
    successResponse: () =>
      jsonResponse({
        data: [{ index: 0, embedding: [0.25, 0.75] }],
        usage: {
          prompt_tokens: 7,
          total_tokens: 7,
        },
      }),
    statusResponse: (status) =>
      jsonResponse({ error: { message: `embedding failed with ${String(status)}` } }, { status }),
    expectedUsage: {
      inputTokens: 7,
      outputTokens: 0,
      totalTokens: 7,
    },
  },
];

describe('llm factory package', () => {
  test('exports the package name', () => {
    expect(packageName).toBe('@fa/llm-factory');
  });

  test('exports DeepSeek V4 Flash on OpenRouter as the default chat model', () => {
    expect(DEFAULT_CHAT_MODEL).toBe('deepseek/deepseek-v4-flash');
  });

  test('exports the curated admin-selectable chat model catalog in default-first order', () => {
    expect(CURATED_CHAT_MODELS.map((model) => `${model.provider}:${model.modelId}`)).toEqual([
      'openrouter:deepseek/deepseek-v4-flash',
      'openrouter:minimax/minimax-m3',
      'minimax:MiniMax-M3',
    ]);
    expect(CURATED_CHAT_MODELS).toHaveLength(3);
    expect(CURATED_CHAT_MODELS[0]).toMatchObject({
      provider: 'openrouter',
      modelId: DEFAULT_CHAT_MODEL,
      label: 'DeepSeek V4 Flash',
      evaluationStatus: 'selected',
      contextTokens: 1_048_576,
      supportsStructuredOutputs: true,
    });
    expect(CURATED_CHAT_MODELS[0]).not.toHaveProperty('inputUsdPer1M');
    expect(CURATED_CHAT_MODELS[0]).not.toHaveProperty('outputUsdPer1M');
    expect(CURATED_CHAT_MODELS.at(-1)).toMatchObject({
      provider: MINIMAX_PROVIDER,
      modelId: MINIMAX_CHAT_MODEL,
      label: 'MiniMax M3',
      contextTokens: 1_048_576,
      supportsStructuredOutputs: true,
    });
    const evaluationStatuses = CURATED_CHAT_MODELS.map(
      (model) => model.evaluationStatus
    ) as string[];
    expect(new Set(evaluationStatuses)).toEqual(new Set(['selected']));
    expect(
      CURATED_CHAT_MODELS.every(
        (model) => model.label.trim().length > 0 && model.notes.trim().length > 0
      )
    ).toBe(true);
    const curatedModelIds = CURATED_CHAT_MODELS.map((model) => model.modelId) as string[];
    expect(curatedModelIds.includes('google/gemma-4-31b-it')).toBe(false);
    expect(curatedModelIds.includes('google/gemini-3.5-flash')).toBe(false);
  });

  test('rejects duplicate curated chat model IDs', () => {
    expect(() => {
      assertValidCuratedChatModelCatalog([CURATED_CHAT_MODELS[0], CURATED_CHAT_MODELS[0]]);
    }).toThrow('Duplicate curated chat model: openrouter/deepseek/deepseek-v4-flash');
  });

  test('validates curated chat model catalog invariants', () => {
    const validModel = CURATED_CHAT_MODELS[0];
    expect(() => {
      assertValidCuratedChatModelCatalog([]);
    }).toThrow('Curated chat model catalog must not be empty');

    expect(() => {
      assertValidCuratedChatModelCatalog([{ ...validModel, modelId: '   ' }]);
    }).toThrow('Curated chat model ID must not be empty');
    expect(() => {
      assertValidCuratedChatModelCatalog([{ ...validModel, contextTokens: 0 }]);
    }).toThrow('Curated chat model context window must be positive: deepseek/deepseek-v4-flash');

    expect(findCuratedChatModel('openrouter', DEFAULT_CHAT_MODEL)).toEqual(validModel);
    expect(findCuratedChatModel('minimax', MINIMAX_CHAT_MODEL)?.provider).toBe('minimax');
    expect(findCuratedChatModel('openrouter', 'unknown/model')).toBeUndefined();
    expect(isCuratedChatModelId('openrouter', DEFAULT_CHAT_MODEL)).toBe(true);
    expect(isCuratedChatModelId('minimax', MINIMAX_CHAT_MODEL)).toBe(true);
    expect(isCuratedChatModelId('openrouter', MINIMAX_CHAT_MODEL)).toBe(false);
  });

  test('resolves OpenRouter defaults from FA env vars', () => {
    expect(resolveLlmProviderConfig(baseEnv())).toEqual({
      chat: {
        provider: 'openrouter',
        model: DEFAULT_CHAT_MODEL,
      },
      embeddings: {
        provider: 'openrouter',
        model: DEFAULT_EMBEDDING_MODEL,
        dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
      },
      openRouter: {
        apiKey: 'test-openrouter-key',
        baseUrl: 'https://openrouter.ai/api/v1',
        providerSort: DEFAULT_OPENROUTER_PROVIDER_SORT,
      },
      minimax: {
        apiKey: 'test-minimax-key',
        baseUrl: DEFAULT_MINIMAX_BASE_URL,
      },
    });
  });

  test('ignores chat provider/model env overrides and requires provider credentials', () => {
    expect(
      resolveLlmProviderConfig(
        baseEnv({
          FA_CHAT_PROVIDER: 'openai',
          FA_CHAT_MODEL: 'custom/chat-model',
        })
      ).chat
    ).toEqual({
      provider: 'openrouter',
      model: DEFAULT_CHAT_MODEL,
    });

    expect(() =>
      resolveLlmProviderConfig(
        baseEnv({
          FA_OPENROUTER_APP_API_KEY: '',
        })
      )
    ).toThrow('FA_OPENROUTER_APP_API_KEY must be set');
    expect(() =>
      resolveLlmProviderConfig(
        baseEnv({
          FA_MINIMAX_APP_API_KEY: '',
        })
      )
    ).toThrow('FA_MINIMAX_APP_API_KEY must be set');
  });

  test('resolves custom embedding dimensions and trimmed OpenRouter base URL', () => {
    expect(
      resolveLlmProviderConfig(
        baseEnv({
          FA_CHAT_MODEL: 'custom/chat-model',
          FA_EMBEDDING_MODEL: 'custom/embedding-model',
          FA_EMBEDDING_DIMENSIONS: '1536',
          FA_OPENROUTER_BASE_URL: 'https://openrouter.test/api/v1///',
        })
      )
    ).toEqual({
      chat: {
        provider: 'openrouter',
        model: DEFAULT_CHAT_MODEL,
      },
      embeddings: {
        provider: 'openrouter',
        model: 'custom/embedding-model',
        dimensions: 1536,
      },
      openRouter: {
        apiKey: 'test-openrouter-key',
        baseUrl: 'https://openrouter.test/api/v1',
        providerSort: 'throughput',
      },
      minimax: {
        apiKey: 'test-minimax-key',
        baseUrl: DEFAULT_MINIMAX_BASE_URL,
      },
    });
  });

  test('rejects invalid embedding dimensions', () => {
    expect(() =>
      resolveLlmProviderConfig(
        baseEnv({
          FA_EMBEDDING_DIMENSIONS: '0',
        })
      )
    ).toThrow('FA_EMBEDDING_DIMENSIONS must be a positive integer');
  });

  test.each([
    { value: 'price', expected: 'price' },
    { value: 'throughput', expected: 'throughput' },
    { value: 'latency', expected: 'latency' },
  ])('resolves OpenRouter provider sort $value', ({ value, expected }) => {
    expect(
      resolveLlmProviderConfig(baseEnv({ FA_OPENROUTER_PROVIDER_SORT: value })).openRouter
        .providerSort
    ).toBe(expected);
  });

  test('rejects invalid OpenRouter routing and embedding provider env values', () => {
    expect(() =>
      resolveLlmProviderConfig(baseEnv({ FA_OPENROUTER_PROVIDER_SORT: 'random' }))
    ).toThrow('FA_OPENROUTER_PROVIDER_SORT must be price, throughput, or latency');
    expect(() => resolveLlmProviderConfig(baseEnv({ FA_EMBEDDING_PROVIDER: 'openai' }))).toThrow(
      'FA_EMBEDDING_PROVIDER must be openrouter'
    );
    expect(() => resolveLlmProviderConfig(baseEnv({ FA_EMBEDDING_DIMENSIONS: '1.5' }))).toThrow(
      'FA_EMBEDDING_DIMENSIONS must be a positive integer'
    );
  });

  test('accepts provider call policies with omitted optional fields', async () => {
    const fetchMock = fetchReturning(
      jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'Ok.' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    );
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink: new FakeUsageSink(),
      fetch: fetchMock,
      providerCallPolicy: {
        retryableStatusCodes: [503],
      },
    });

    await expect(
      providers.chat.complete({
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'Can policy omit optional fields?' }],
      })
    ).resolves.toMatchObject({ text: 'Ok.' });
  });

  test('classifies pre-aborted provider requests before fetch', async () => {
    const usageSink = new FakeUsageSink();
    const fetchMock = vi.fn<FetchLike>();
    const controller = new AbortController();
    controller.abort();
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      providers.chat.complete({
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'Already aborted?' }],
        signal: controller.signal,
      })
    ).rejects.toMatchObject({
      name: 'LlmProviderCallError',
      code: 'PROVIDER_ABORTED',
      operation: 'chat.completion',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(usageSink.events).toHaveLength(0);
  });

  test('classifies abort-like fetch failures without caller signals', async () => {
    const usageSink = new FakeUsageSink();
    const fetchMock = vi
      .fn<FetchLike>()
      .mockRejectedValue(
        new DOMException('The operation was aborted by the runtime.', 'AbortError')
      );
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      providers.embeddings.embed({
        ...embeddingUsageMetadata(),
        input: 'runtime aborted embedding',
      })
    ).rejects.toMatchObject({
      name: 'LlmProviderCallError',
      code: 'PROVIDER_ABORTED',
      operation: 'embedding',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usageSink.events).toHaveLength(0);
  });

  test.each(providerPolicyOperationCases)(
    'provider policy matrix: $name timeout is classified and records no usage',
    async (operationCase) => {
      const usageSink = new FakeUsageSink();
      const fetchMock = fetchRejectingOnAbort();
      const providers = createLlmProviders({
        env: baseEnv(),
        usageSink,
        fetch: fetchMock,
      });

      await expect(
        operationCase.invoke(providers, {
          providerCallPolicy: {
            timeoutMs: 1,
            maxRetries: 2,
            retryableStatusCodes: [429, 503],
            retryBackoffMs: () => 0,
          },
        })
      ).rejects.toMatchObject({
        name: 'LlmProviderCallError',
        code: 'PROVIDER_TIMEOUT',
        provider: 'openrouter',
        operation: operationCase.operation,
      });
      expect(fetchMock.calls).toHaveLength(1);
      expect(usageSink.events).toHaveLength(0);
    }
  );

  test.each(providerPolicyOperationCases)(
    'provider policy matrix: $name caller abort is not retried and records no usage',
    async (operationCase) => {
      const usageSink = new FakeUsageSink();
      const controller = new AbortController();
      const fetchMock = fetchRejectingOnAbort(() => {
        controller.abort();
      });
      const providers = createLlmProviders({
        env: baseEnv(),
        usageSink,
        fetch: fetchMock,
      });

      await expect(
        operationCase.invoke(providers, {
          signal: controller.signal,
          providerCallPolicy: {
            timeoutMs: 100,
            maxRetries: 2,
            retryableStatusCodes: [429, 503],
            retryBackoffMs: () => 0,
          },
        })
      ).rejects.toMatchObject({
        name: 'LlmProviderCallError',
        code: 'PROVIDER_ABORTED',
        provider: 'openrouter',
        operation: operationCase.operation,
      });
      expect(fetchMock.calls).toHaveLength(1);
      expect(usageSink.events).toHaveLength(0);
    }
  );

  test.each(providerPolicyOperationCases)(
    'provider policy matrix: $name retries retryable HTTP status and records successful usage',
    async (operationCase) => {
      const usageSink = new FakeUsageSink();
      const fetchMock = fetchSequence([
        operationCase.statusResponse(503),
        operationCase.successResponse(),
      ]);
      const providers = createLlmProviders({
        env: baseEnv(),
        usageSink,
        fetch: fetchMock,
      });

      await expect(
        operationCase.invoke(providers, {
          providerCallPolicy: {
            maxRetries: 1,
            retryableStatusCodes: [503],
            retryBackoffMs: () => 0,
          },
        })
      ).resolves.toBeDefined();
      expect(fetchMock.calls).toHaveLength(2);
      expect(usageSink.events).toHaveLength(1);
      expect(usageSink.events[0]).toMatchObject({
        request: { provider: 'openrouter' },
        source: { operation: operationCase.operation },
        usage: { ...operationCase.expectedUsage, estimated: false },
      });
    }
  );

  test.each(providerPolicyOperationCases)(
    'provider policy matrix: $name fails non-retryable HTTP status once and records no usage',
    async (operationCase) => {
      const usageSink = new FakeUsageSink();
      const fetchMock = fetchSequence([operationCase.statusResponse(400)]);
      const providers = createLlmProviders({
        env: baseEnv(),
        usageSink,
        fetch: fetchMock,
      });

      await expect(
        operationCase.invoke(providers, {
          providerCallPolicy: {
            maxRetries: 2,
            retryableStatusCodes: [429, 503],
            retryBackoffMs: () => 0,
          },
        })
      ).rejects.toMatchObject({
        name: 'LlmProviderCallError',
        code: 'PROVIDER_HTTP_ERROR',
        provider: 'openrouter',
        operation: operationCase.operation,
        statusCode: 400,
      });
      expect(fetchMock.calls).toHaveLength(1);
      expect(usageSink.events).toHaveLength(0);
    }
  );

  test('times out OpenRouter chat completion when headers arrive but the response body stalls', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const fetchMock = fetchReturningStallingJsonBody({
      fallbackErrorMessage: 'completion body read was not aborted by policy timeout',
    });
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      providers.chat.complete({
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'Will the body timeout?' }],
        providerCallPolicy: {
          timeoutMs: 1,
          maxRetries: 0,
          retryBackoffMs: () => 0,
        },
      })
    ).rejects.toMatchObject({
      name: 'LlmProviderCallError',
      code: 'PROVIDER_TIMEOUT',
      provider: 'openrouter',
      operation: 'chat.completion',
    });
    expect(fetchMock.calls).toHaveLength(1);
    expect(usageSink.events).toHaveLength(0);
  });

  test('times out OpenRouter embeddings when headers arrive but the response body stalls', async () => {
    const usageSink = new FakeUsageSink({
      service: 'knowledge-service',
      component: 'query-embedding',
    });
    const fetchMock = fetchReturningStallingJsonBody({
      fallbackErrorMessage: 'embedding body read was not aborted by policy timeout',
    });
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      providers.embeddings.embed({
        ...embeddingUsageMetadata(),
        input: 'body timeout embedding',
        dimensions: 2,
        providerCallPolicy: {
          timeoutMs: 1,
          maxRetries: 0,
          retryBackoffMs: () => 0,
        },
      })
    ).rejects.toMatchObject({
      name: 'LlmProviderCallError',
      code: 'PROVIDER_TIMEOUT',
      provider: 'openrouter',
      operation: 'embedding',
    });
    expect(fetchMock.calls).toHaveLength(1);
    expect(usageSink.events).toHaveLength(0);
  });

  test('classifies caller abort during OpenRouter chat completion body read and records no usage', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const controller = new AbortController();
    const fetchMock = fetchReturningStallingJsonBody({
      fallbackErrorMessage: 'completion body read did not receive caller abort',
      onResponse: () => {
        setTimeout(() => {
          controller.abort();
        }, 0);
      },
    });
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      providers.chat.complete({
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'Will caller abort the body?' }],
        signal: controller.signal,
        providerCallPolicy: {
          timeoutMs: 100,
          maxRetries: 1,
          retryableStatusCodes: [503],
          retryBackoffMs: () => 0,
        },
      })
    ).rejects.toMatchObject({
      name: 'LlmProviderCallError',
      code: 'PROVIDER_ABORTED',
      provider: 'openrouter',
      operation: 'chat.completion',
    });
    expect(fetchMock.calls).toHaveLength(1);
    expect(usageSink.events).toHaveLength(0);
  });

  test('classifies caller abort while OpenRouter stream body read is pending and records no usage', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const controller = new AbortController();
    const fetchMock = fetchReturningStallingSseBody({
      fallbackErrorMessage: 'stream body read did not receive caller abort',
      onResponse: () => {
        setTimeout(() => {
          controller.abort();
        }, 0);
      },
    });
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      collectAsyncIterable(
        providers.chat.stream({
          ...chatUsageMetadata(),
          messages: [{ role: 'user', content: 'Will caller abort the stream body?' }],
          signal: controller.signal,
          providerCallPolicy: {
            timeoutMs: 100,
            maxRetries: 1,
            retryableStatusCodes: [503],
            retryBackoffMs: () => 0,
          },
        })
      )
    ).rejects.toMatchObject({
      name: 'LlmProviderCallError',
      code: 'PROVIDER_ABORTED',
      provider: 'openrouter',
      operation: 'chat.stream',
    });
    expect(fetchMock.calls).toHaveLength(1);
    expect(usageSink.events).toHaveLength(0);
  });

  test('times out OpenRouter chat stream when headers arrive but the SSE body stalls', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const fetchMock = fetchReturningStallingSseBody({
      fallbackErrorMessage: 'stream body read was not aborted by policy timeout',
    });
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      collectAsyncIterable(
        providers.chat.stream({
          ...chatUsageMetadata(),
          messages: [{ role: 'user', content: 'Will the stream body timeout?' }],
          providerCallPolicy: {
            timeoutMs: 1,
            maxRetries: 0,
            retryBackoffMs: () => 0,
          },
        })
      )
    ).rejects.toMatchObject({
      name: 'LlmProviderCallError',
      code: 'PROVIDER_TIMEOUT',
      provider: 'openrouter',
      operation: 'chat.stream',
    });
    expect(fetchMock.calls).toHaveLength(1);
    expect(usageSink.events).toHaveLength(0);
  });

  test('classifies caller abort before the first OpenRouter stream body read', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const controller = new AbortController();
    const calls: { input: string; init?: RequestInit }[] = [];
    const fetchMock: FetchLike = (input, init) => {
      calls.push({ input, ...(init !== undefined ? { init } : {}) });
      controller.abort();
      return Promise.resolve(sseResponse(['data: [DONE]\n\n']));
    };
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      collectAsyncIterable(
        providers.chat.stream({
          ...chatUsageMetadata(),
          messages: [{ role: 'user', content: 'Abort before body read?' }],
          signal: controller.signal,
        })
      )
    ).rejects.toMatchObject({
      name: 'LlmProviderCallError',
      code: 'PROVIDER_ABORTED',
      operation: 'chat.stream',
    });
    expect(calls).toHaveLength(1);
    expect(usageSink.events).toHaveLength(0);
  });

  test('propagates non-abort OpenRouter stream body read errors', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('stream exploded'));
      },
    });
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      ),
    });

    await expect(
      collectAsyncIterable(
        providers.chat.stream({
          ...chatUsageMetadata(),
          messages: [{ role: 'user', content: 'Will stream body fail?' }],
          signal: new AbortController().signal,
        })
      )
    ).rejects.toThrow('stream exploded');
    expect(usageSink.events).toHaveLength(0);
  });

  test('creates an OpenRouter chat provider that records successful usage', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const fetchMock = fetchReturning(
      jsonResponse({
        id: 'chatcmpl-test',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Use corn over a light feeder mix.' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 7,
          total_tokens: 18,
          cost: 0.00042,
        },
      })
    );

    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });
    const abortController = new AbortController();

    await expect(
      providers.chat.complete({
        ...chatUsageMetadata(),
        ...chatUsageMetadata({
          correlation: { conversationId: 'conversation-1', messageId: 'message-1' },
        }),
        messages: [
          { role: 'system', content: 'Answer from evidence.' },
          { role: 'user', content: 'What bait worked?' },
        ],
        temperature: 0.2,
        maxOutputTokens: 128,
        signal: abortController.signal,
      })
    ).resolves.toMatchObject({
      provider: 'openrouter',
      model: DEFAULT_CHAT_MODEL,
      text: 'Use corn over a light feeder mix.',
      finishReason: 'stop',
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
        estimated: false,
      },
    });

    expect(fetchMock.calls).toHaveLength(1);
    expect(fetchMock.calls[0]?.input).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(fetchMock.calls[0]?.init?.method).toBe('POST');
    expect(fetchMock.calls[0]?.init?.signal).toBe(abortController.signal);
    expect(fetchMock.calls[0]?.init?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer test-openrouter-key',
        'Content-Type': 'application/json',
      })
    );
    expect(firstJsonRequestBody(fetchMock)).toEqual({
      model: DEFAULT_CHAT_MODEL,
      messages: [
        { role: 'system', content: 'Answer from evidence.' },
        { role: 'user', content: 'What bait worked?' },
      ],
      temperature: 0.2,
      max_tokens: 128,
      provider: { sort: 'throughput' },
      stream: false,
    });
    expect(firstJsonRequestBody(fetchMock)).not.toHaveProperty('response_format');
    expect(usageSink.events).toHaveLength(1);
    expect(usageSink.events[0]).toMatchObject({
      owner: { type: 'user', id: 'test-user-1' },
      source: {
        service: 'chat-service',
        component: 'rag-chat',
        operation: 'chat.completion',
        promptType: 'fishing-answer',
      },
      request: {
        provider: 'openrouter',
        model: DEFAULT_CHAT_MODEL,
        promptVersion: testPromptVersion,
      },
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18, estimated: false },
      cost: { estimatedCostUsd: 0.00042, source: 'provider-reported' },
      correlation: { conversationId: 'conversation-1', messageId: 'message-1' },
    });
  });

  test('creates a MiniMax chat provider that disables thinking and records simplified cost', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const fetchMock = fetchReturning(
      jsonResponse({
        id: 'minimax-chat-1',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'MiniMax direct answer.' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 250,
          total_tokens: 1250,
        },
      })
    );

    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      providers.chat.complete({
        ...chatUsageMetadata(),
        provider: MINIMAX_PROVIDER,
        model: MINIMAX_CHAT_MODEL,
        messages: [{ role: 'user', content: 'Use MiniMax directly.' }],
        temperature: 0.2,
        maxOutputTokens: 256,
      })
    ).resolves.toMatchObject({
      provider: MINIMAX_PROVIDER,
      model: MINIMAX_CHAT_MODEL,
      text: 'MiniMax direct answer.',
      usage: {
        inputTokens: 1000,
        outputTokens: 250,
        totalTokens: 1250,
        estimated: false,
      },
    });

    expect(fetchMock.calls).toHaveLength(1);
    expect(fetchMock.calls[0]?.input).toBe('https://api.minimax.io/v1/chat/completions');
    expect(fetchMock.calls[0]?.init?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer test-minimax-key',
        'Content-Type': 'application/json',
      })
    );
    expect(firstJsonRequestBody(fetchMock)).toEqual({
      model: MINIMAX_CHAT_MODEL,
      messages: [{ role: 'user', content: 'Use MiniMax directly.' }],
      temperature: 0.2,
      max_completion_tokens: 256,
      thinking: { type: 'disabled' },
      stream: false,
    });
    expect(usageSink.events).toHaveLength(1);
    expect(usageSink.events[0]).toMatchObject({
      request: {
        provider: MINIMAX_PROVIDER,
        model: MINIMAX_CHAT_MODEL,
        promptVersion: testPromptVersion,
      },
      usage: { inputTokens: 1000, outputTokens: 250, totalTokens: 1250, estimated: false },
      cost: { estimatedCostUsd: 0.0006, source: 'provider-estimated' },
    });
  });

  test('streams MiniMax SSE deltas with stream mode and records chat stream usage', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const fetchMock = fetchReturning(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"MiniMax "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"stream answer."},"finish_reason":"stop"}]}\n\n',
        'data: {"usage":{"prompt_tokens":1000,"completion_tokens":250,"total_tokens":1250}}\n\n',
        'data: [DONE]\n\n',
      ])
    );
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    const events = await collectAsyncIterable(
      providers.chat.stream({
        ...chatUsageMetadata({ correlation: { conversationId: 'conversation-1' } }),
        provider: MINIMAX_PROVIDER,
        model: MINIMAX_CHAT_MODEL,
        messages: [{ role: 'user', content: 'Use MiniMax streaming.' }],
        temperature: 0.2,
        maxOutputTokens: 256,
      })
    );

    expect(events.slice(0, 2)).toEqual([
      { type: 'text_delta', text: 'MiniMax ' },
      { type: 'text_delta', text: 'stream answer.' },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      response: {
        provider: MINIMAX_PROVIDER,
        model: MINIMAX_CHAT_MODEL,
        text: 'MiniMax stream answer.',
        usage: {
          inputTokens: 1000,
          outputTokens: 250,
          totalTokens: 1250,
          estimated: false,
        },
      },
    });

    expect(fetchMock.calls).toHaveLength(1);
    expect(fetchMock.calls[0]?.input).toBe('https://api.minimax.io/v1/chat/completions');
    expect(firstJsonRequestBody(fetchMock)).toEqual({
      model: MINIMAX_CHAT_MODEL,
      messages: [{ role: 'user', content: 'Use MiniMax streaming.' }],
      temperature: 0.2,
      max_completion_tokens: 256,
      thinking: { type: 'disabled' },
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(usageSink.events).toHaveLength(1);
    expect(usageSink.events[0]).toMatchObject({
      source: { operation: 'chat.stream', promptType: 'fishing-answer' },
      request: {
        provider: MINIMAX_PROVIDER,
        model: MINIMAX_CHAT_MODEL,
        promptVersion: testPromptVersion,
      },
      usage: { inputTokens: 1000, outputTokens: 250, totalTokens: 1250, estimated: false },
      cost: { estimatedCostUsd: 0.0006, source: 'provider-estimated' },
      correlation: { conversationId: 'conversation-1' },
    });
  });

  test('parses OpenRouter chat tool calls while ignoring malformed entries', async () => {
    const fetchMock = fetchReturning(
      jsonResponse({
        id: 'chatcmpl-tool-call',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: [
                { type: 'text', text: 'I will check the knowledge base.' },
                { content: [{ text: ' Then answer.' }] },
                { content: null },
              ],
              tool_calls: [
                { id: 123, type: 'function', function: { name: 'bad', arguments: '{}' } },
                { id: 'call_ignored', type: 'other', function: { name: 'bad', arguments: '{}' } },
                {
                  id: 'call_retrieve',
                  type: 'function',
                  function: {
                    name: 'retrieve_knowledge',
                    arguments: '{"query":"pellet"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 9, completion_tokens: 6, total_tokens: 15 },
      })
    );
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink: new FakeUsageSink(),
      fetch: fetchMock,
    });

    await expect(
      providers.chat.complete({
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'Find pellet guidance.' }],
        maxOutputTokens: 128,
      })
    ).resolves.toMatchObject({
      text: 'I will check the knowledge base. Then answer.',
      finishReason: 'tool_calls',
      toolCalls: [
        {
          id: 'call_retrieve',
          type: 'function',
          function: {
            name: 'retrieve_knowledge',
            arguments: '{"query":"pellet"}',
          },
        },
      ],
    });
  });

  test('retries malformed successful OpenRouter chat completion responses', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const fetchMock = fetchSequence([
      jsonResponse({ error: { message: 'upstream returned no choices' } }),
      jsonResponse({
        id: 'chatcmpl-recovered',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Recovered answer.' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 6,
          completion_tokens: 3,
          total_tokens: 9,
        },
      }),
    ]);
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      providers.chat.complete({
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'Recover?' }],
        providerCallPolicy: { maxRetries: 1, retryBackoffMs: () => 0 },
      })
    ).resolves.toMatchObject({
      text: 'Recovered answer.',
      finishReason: 'stop',
      usage: {
        totalTokens: 9,
        estimated: false,
      },
    });

    expect(fetchMock.calls).toHaveLength(2);
    expect(usageSink.events).toHaveLength(1);
  });

  test('normalizes OpenRouter assistant content arrays in chat completions', async () => {
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink: new FakeUsageSink(),
      fetch: fetchReturning(
        jsonResponse({
          choices: [
            {
              message: {
                content: [
                  { type: 'text', text: 'Use a light feeder mix. ' },
                  { type: 'text', text: 'Keep portions small.' },
                ],
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
        })
      ),
    });

    await expect(
      providers.chat.complete({
        messages: [{ role: 'user', content: 'What mix?' }],
        model: 'google/gemma-4-31b-it',
        ...chatUsageMetadata(),
      })
    ).resolves.toMatchObject({
      text: 'Use a light feeder mix. Keep portions small.',
      finishReason: 'stop',
    });
  });

  test('normalizes OpenRouter assistant content objects in chat completions', async () => {
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink: new FakeUsageSink(),
      fetch: fetchReturning(
        jsonResponse({
          choices: [
            {
              message: { content: { type: 'text', text: 'Use winter liquid sparingly.' } },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 },
        })
      ),
    });

    await expect(
      providers.chat.complete({
        messages: [{ role: 'user', content: 'How much liquid?' }],
        model: 'google/gemma-4-31b-it',
        ...chatUsageMetadata(),
      })
    ).resolves.toMatchObject({ text: 'Use winter liquid sparingly.' });
  });

  test('requires usage metadata before calling the provider', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const fetchMock = fetchReturning(jsonResponse({}));
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      providers.chat.complete({
        messages: [{ role: 'user', content: 'What bait worked?' }],
      })
    ).rejects.toThrow('owner.type must be user');

    expect(fetchMock.calls).toHaveLength(0);
    expect(usageSink.events).toHaveLength(0);
  });

  test('rejects invalid chat completion owner type before calling the provider', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const fetchMock = fetchReturning(jsonResponse({}));
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      providers.chat.complete({
        ...chatUsageMetadata({ owner: { type: 'workspace' as never, id: 'test-user-1' } }),
        messages: [{ role: 'user', content: 'What bait worked?' }],
      })
    ).rejects.toThrow('owner.type must be user');

    expect(fetchMock.calls).toHaveLength(0);
    expect(usageSink.events).toHaveLength(0);
  });

  test('rejects invalid chat stream owner type before calling the provider', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const fetchMock = fetchReturning(sseResponse([]));
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      collectAsyncIterable(
        providers.chat.stream({
          ...chatUsageMetadata({ owner: { type: 'system' as never, id: 'test-user-1' } }),
          messages: [{ role: 'user', content: 'What bait worked?' }],
        })
      )
    ).rejects.toThrow('owner.type must be user');

    expect(fetchMock.calls).toHaveLength(0);
    expect(usageSink.events).toHaveLength(0);
  });

  test('rejects invalid embedding owner type before calling the provider', async () => {
    const usageSink = new FakeUsageSink({
      service: 'knowledge-service',
      component: 'query-embedding',
    });
    const fetchMock = fetchReturning(jsonResponse({}));
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      providers.embeddings.embed({
        ...embeddingUsageMetadata({ owner: { type: 'workspace' as never, id: 'test-user-1' } }),
        input: 'float fishing',
      })
    ).rejects.toThrow('owner.type must be user');

    expect(fetchMock.calls).toHaveLength(0);
    expect(usageSink.events).toHaveLength(0);
  });

  test.each([
    'anonymous-workspace-1',
    'angler@example.com',
    '+15551234567',
    'auth0|abc123',
    'workspace-123',
  ])('rejects invalid provider usage owner id %s before calling the provider', async (ownerId) => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const fetchMock = fetchReturning(jsonResponse({}));
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      providers.chat.complete({
        ...chatUsageMetadata({ owner: { type: 'user', id: ownerId } }),
        messages: [{ role: 'user', content: 'What bait worked?' }],
      })
    ).rejects.toThrow('owner.id must be a real user id');

    expect(fetchMock.calls).toHaveLength(0);
    expect(usageSink.events).toHaveLength(0);
  });

  test('sends OpenRouter response_format for structured completion requests', async () => {
    const fetchMock = fetchReturning(
      jsonResponse({
        choices: [
          {
            message: { role: 'assistant', content: '{"answerMarkdown":"Use corn. [S1]"}' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 5,
          total_tokens: 13,
        },
      })
    );
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink: new FakeUsageSink(),
      fetch: fetchMock,
    });
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        answerMarkdown: { type: 'string' },
      },
      required: ['answerMarkdown'],
    };

    await providers.chat.complete({
      ...chatUsageMetadata(),
      messages: [{ role: 'user', content: 'Return a JSON answer.' }],
      structuredOutput: {
        type: 'json_schema',
        schemaName: 'fishing_answer',
        schema,
        strict: true,
      },
    });

    expect(firstJsonRequestBody(fetchMock)).toEqual({
      model: DEFAULT_CHAT_MODEL,
      messages: [{ role: 'user', content: 'Return a JSON answer.' }],
      stream: false,
      provider: {
        sort: 'throughput',
        require_parameters: true,
      },
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'fishing_answer',
          strict: true,
          schema,
        },
      },
    });
  });

  test('omits temperature for GPT-5.4 Mini structured requests so strict provider routing can select an endpoint', async () => {
    const fetchMock = fetchReturning(
      jsonResponse({
        choices: [
          { message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 4,
          total_tokens: 12,
        },
      })
    );
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink: new FakeUsageSink(),
      fetch: fetchMock,
    });

    await providers.chat.complete({
      ...chatUsageMetadata(),
      model: 'openai/gpt-5.4-mini',
      messages: [{ role: 'user', content: 'Return JSON.' }],
      temperature: 0.2,
      maxOutputTokens: 1600,
      tools: [
        {
          type: 'function',
          function: {
            name: 'retrieve_knowledge',
            description: 'Retrieve knowledge.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                query: { type: 'string' },
              },
              required: ['query'],
            },
          },
        },
      ],
      toolChoice: 'auto',
      structuredOutput: {
        type: 'json_object',
      },
    });

    const requestBody = firstJsonRequestBody(fetchMock) as Record<string, unknown>;
    expect(requestBody).toMatchObject({
      model: 'openai/gpt-5.4-mini',
      max_tokens: 1600,
      provider: {
        sort: 'throughput',
        require_parameters: true,
      },
      response_format: {
        type: 'json_object',
      },
      tool_choice: 'auto',
    });
    expect(requestBody['tools']).toEqual([
      {
        type: 'function',
        function: {
          name: 'retrieve_knowledge',
          description: 'Retrieve knowledge.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              query: { type: 'string' },
            },
            required: ['query'],
          },
        },
      },
    ]);
    expect(requestBody).not.toHaveProperty('temperature');
  });

  test('sends OpenRouter reasoning controls for chat completion requests', async () => {
    const fetchMock = fetchReturning(
      jsonResponse({
        choices: [{ message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    );
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink: new FakeUsageSink(),
      fetch: fetchMock,
    });

    await providers.chat.complete({
      ...chatUsageMetadata(),
      messages: [{ role: 'user', content: 'Return JSON.' }],
      maxOutputTokens: 1600,
      reasoning: {
        effort: 'minimal',
        exclude: true,
      },
    });

    expect(firstJsonRequestBody(fetchMock)).toEqual({
      model: DEFAULT_CHAT_MODEL,
      messages: [{ role: 'user', content: 'Return JSON.' }],
      max_tokens: 1600,
      provider: { sort: 'throughput' },
      stream: false,
      reasoning: {
        effort: 'minimal',
        exclude: true,
      },
    });
  });

  test('uses OpenRouter structured output defaults when schema name and strict mode are omitted', async () => {
    const fetchMock = fetchReturning(
      jsonResponse({
        choices: [{ message: { role: 'assistant', content: '{}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    );
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink: new FakeUsageSink(),
      fetch: fetchMock,
    });
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {},
    };

    await providers.chat.complete({
      ...chatUsageMetadata(),
      messages: [{ role: 'user', content: 'Return JSON.' }],
      structuredOutput: {
        type: 'json_schema',
        schema,
      },
    });

    const requestBody = firstJsonRequestBody(fetchMock) as {
      response_format?: { json_schema?: Record<string, unknown> };
    };
    expect(requestBody).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'structured_output',
          schema,
        },
      },
    });
    expect(requestBody.response_format?.json_schema).not.toHaveProperty('strict');
  });

  test('keeps a successful chat response when usage recording fails', async () => {
    const fetchMock = fetchReturning(
      jsonResponse({
        choices: [
          {
            message: { role: 'assistant', content: 'The evidence is incomplete.' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 6,
          total_tokens: 11,
        },
      })
    );
    const usageSink = new FakeUsageSink();
    const recordSpy = vi
      .spyOn(usageSink, 'record')
      .mockRejectedValue(new Error('usage service down'));
    const warnings: object[] = [];
    const logger = {
      warn: (obj: object) => {
        warnings.push(obj);
      },
    };

    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
      logger,
    });

    await expect(
      providers.chat.complete({
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'Any missing details?' }],
      })
    ).resolves.toMatchObject({
      text: 'The evidence is incomplete.',
      usage: { totalTokens: 11 },
    });
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(warnings).toHaveLength(1);
  });

  test('times out OpenRouter chat completion calls with classified provider errors and no usage', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const calls: { input: string; init?: RequestInit }[] = [];
    const fetchMock = Object.assign(
      ((input: string, init?: RequestInit) => {
        calls.push({ input, ...(init !== undefined ? { init } : {}) });

        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            },
            { once: true }
          );
          setTimeout(() => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          }, 10);
        });
      }) satisfies FetchLike,
      { calls }
    );
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      providers.chat.complete({
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'What bait worked?' }],
        providerCallPolicy: {
          timeoutMs: 1,
          maxRetries: 1,
          retryBackoffMs: () => 0,
        },
      })
    ).rejects.toMatchObject({
      name: 'LlmProviderCallError',
      code: 'PROVIDER_TIMEOUT',
      provider: 'openrouter',
      operation: 'chat.completion',
    });
    expect(fetchMock.calls).toHaveLength(1);
    expect(usageSink.events).toHaveLength(0);
  });

  test('propagates caller abort during OpenRouter chat stream setup without retry or usage', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const controller = new AbortController();
    const calls: { input: string; init?: RequestInit }[] = [];
    const fetchMock = Object.assign(
      ((input: string, init?: RequestInit) => {
        calls.push({ input, ...(init !== undefined ? { init } : {}) });

        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            },
            { once: true }
          );
          controller.abort();
        });
      }) satisfies FetchLike,
      { calls }
    );
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      collectAsyncIterable(
        providers.chat.stream({
          ...chatUsageMetadata(),
          messages: [{ role: 'user', content: 'What is known?' }],
          signal: controller.signal,
          providerCallPolicy: {
            timeoutMs: 100,
            maxRetries: 2,
            retryableStatusCodes: [429, 503],
            retryBackoffMs: () => 0,
          },
        })
      )
    ).rejects.toMatchObject({
      name: 'LlmProviderCallError',
      code: 'PROVIDER_ABORTED',
      provider: 'openrouter',
      operation: 'chat.stream',
    });
    expect(fetchMock.calls).toHaveLength(1);
    expect(usageSink.events).toHaveLength(0);
  });

  test('streams OpenRouter SSE deltas and records final stream usage', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const fetchMock = fetchReturning(
      sseResponse([
        ': OPENROUTER PROCESSING\n\n',
        'data: {"choices":[{"delta":{"content":"Partial "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"evidence only."}}]}\n\n',
        'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":4,"total_tokens":15}}\n\n',
        'data: [DONE]\n\n',
      ])
    );

    const providers = createLlmProviders({
      env: baseEnv({
        FA_OPENROUTER_BASE_URL: 'https://openrouter.test/api/v1/',
      }),
      usageSink,
      fetch: fetchMock,
      referer: 'https://dev.fishing-assistant.online',
      appTitle: 'Fishing Assistant',
    });
    const abortController = new AbortController();

    const events = await collectAsyncIterable(
      providers.chat.stream({
        ...chatUsageMetadata(),
        ...chatUsageMetadata(),
        model: 'custom/chat-model',
        messages: [{ role: 'user', content: 'What is known?' }],
        signal: abortController.signal,
      })
    );

    expect(events[0]).toEqual({ type: 'text_delta', text: 'Partial ' });
    expect(events[1]).toEqual({ type: 'text_delta', text: 'evidence only.' });
    expect(events[2]?.type).toBe('done');
    if (events[2]?.type !== 'done') {
      throw new Error('Expected final stream event');
    }
    expect(events[2].response).toMatchObject({
      model: 'custom/chat-model',
      text: 'Partial evidence only.',
      finishReason: 'stop',
      usage: {
        inputTokens: 11,
        outputTokens: 4,
        totalTokens: 15,
        estimated: false,
      },
    });

    expect(fetchMock.calls[0]?.input).toBe('https://openrouter.test/api/v1/chat/completions');
    expect(fetchMock.calls[0]?.init?.signal).toBe(abortController.signal);
    expect(fetchMock.calls[0]?.init?.headers).toEqual(
      expect.objectContaining({
        'HTTP-Referer': 'https://dev.fishing-assistant.online',
        'X-Title': 'Fishing Assistant',
      })
    );
    expect(firstJsonRequestBody(fetchMock)).toEqual({
      model: 'custom/chat-model',
      messages: [{ role: 'user', content: 'What is known?' }],
      provider: { sort: 'throughput' },
      stream: true,
    });
    expect(firstJsonRequestBody(fetchMock)).not.toHaveProperty('response_format');
    expect(usageSink.events[0]).toMatchObject({
      owner: { type: 'user', id: 'test-user-1' },
      source: { operation: 'chat.stream', promptType: 'fishing-answer' },
      request: { model: 'custom/chat-model', promptVersion: testPromptVersion },
      usage: { inputTokens: 11, outputTokens: 4, totalTokens: 15, estimated: false },
    });
  });

  test('normalizes OpenRouter assistant content arrays in streamed deltas', async () => {
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink: new FakeUsageSink(),
      fetch: fetchReturning(
        sseResponse([
          'data: {"choices":[{"delta":{"content":[{"type":"text","text":"First "},{"type":"text","text":"part."}]},"finish_reason":null}]}\n\n',
          'data: {"choices":[{"delta":{"content":{"type":"text","text":" Second part."}},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ])
      ),
    });

    const events = await collectAsyncIterable(
      providers.chat.stream({
        messages: [{ role: 'user', content: 'Stream please' }],
        model: 'google/gemma-4-31b-it',
        ...chatUsageMetadata(),
      })
    );

    expect(events.filter((event) => event.type === 'text_delta')).toEqual([
      { type: 'text_delta', text: 'First part.' },
      { type: 'text_delta', text: ' Second part.' },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'done', response: { finishReason: 'stop' } });
  });

  test('sends OpenRouter response_format for structured streaming requests', async () => {
    const fetchMock = fetchReturning(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"{}"}}]}\n\n',
        'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":1,"total_tokens":5}}\n\n',
        'data: [DONE]\n\n',
      ])
    );
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink: new FakeUsageSink(),
      fetch: fetchMock,
    });

    await collectAsyncIterable(
      providers.chat.stream({
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'Return JSON.' }],
        maxOutputTokens: 2400,
        reasoning: {
          effort: 'minimal',
          exclude: true,
        },
        structuredOutput: {
          type: 'json_object',
        },
      })
    );

    expect(firstJsonRequestBody(fetchMock)).toEqual({
      model: DEFAULT_CHAT_MODEL,
      messages: [{ role: 'user', content: 'Return JSON.' }],
      max_tokens: 2400,
      stream: true,
      provider: {
        sort: 'throughput',
        require_parameters: true,
      },
      reasoning: {
        effort: 'minimal',
        exclude: true,
      },
      response_format: {
        type: 'json_object',
      },
    });
  });

  test('retries retryable OpenRouter chat stream setup statuses within policy', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const calls: { input: string; init?: RequestInit }[] = [];
    const responses = [
      sseResponse(['service unavailable'], { status: 503 }),
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Recovered."}}]}\n\n',
        'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
        'data: [DONE]\n\n',
      ]),
    ];
    const fetchMock = Object.assign(
      ((input: string, init?: RequestInit) => {
        calls.push({ input, ...(init !== undefined ? { init } : {}) });
        const response = responses[calls.length - 1] ?? responses.at(-1);
        if (response === undefined) {
          throw new Error('Expected a retry response fixture');
        }
        return Promise.resolve(response);
      }) satisfies FetchLike,
      { calls }
    );
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    const events = await collectAsyncIterable(
      providers.chat.stream({
        ...chatUsageMetadata(),
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'Can the stream recover?' }],
        providerCallPolicy: {
          maxRetries: 1,
          retryableStatusCodes: [503],
          retryBackoffMs: () => 0,
        },
      })
    );

    expect(fetchMock.calls).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'text_delta', text: 'Recovered.' });
    expect(events[1]?.type).toBe('done');
    expect(usageSink.events).toHaveLength(1);
    expect(usageSink.events[0]).toMatchObject({
      source: { operation: 'chat.stream' },
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    });
  });

  test('streams successfully when usage is estimated and usage recording fails', async () => {
    const fetchMock = fetchReturning(
      sseResponse([
        'data: {"object":"ignored"}\n\n',
        'data: {"choices":[]}\n\n',
        'data: {"choices":[{"delta":{"content":"Estimated "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"usage."}}]}\n\n',
        'data: [DONE]\n\n',
      ])
    );
    const usageSink = new FakeUsageSink();
    const recordSpy = vi
      .spyOn(usageSink, 'record')
      .mockRejectedValue(new Error('usage service down'));
    const warnings: object[] = [];
    const logger = {
      warn: (obj: object) => {
        warnings.push(obj);
      },
    };

    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
      logger,
    });

    const events = await collectAsyncIterable(
      providers.chat.stream({
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'Any missing details?' }],
      })
    );

    expect(events[0]).toEqual({ type: 'text_delta', text: 'Estimated ' });
    expect(events[1]).toEqual({ type: 'text_delta', text: 'usage.' });
    expect(events[2]?.type).toBe('done');
    if (events[2]?.type !== 'done') {
      throw new Error('Expected final stream event');
    }
    expect(events[2].response).toMatchObject({
      text: 'Estimated usage.',
      usage: {
        inputTokens: 6,
        outputTokens: 4,
        totalTokens: 10,
        estimated: true,
      },
    });
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'chat.stream',
        tokenUsageEstimated: true,
      })
    );
    expect(warnings).toHaveLength(1);
  });

  test('rejects unsuccessful or malformed OpenRouter stream responses', async () => {
    const usageSink = new FakeUsageSink();
    const failedProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(sseResponse([], { status: 429 })),
    });
    const malformedProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(sseResponse(['data: {not-json}\n\n'])),
    });

    await expect(
      collectAsyncIterable(
        failedProviders.chat.stream({
          ...chatUsageMetadata(),
          messages: [{ role: 'user', content: 'Question?' }],
        })
      )
    ).rejects.toThrow('OpenRouter chat stream request failed with status 429');
    await expect(
      collectAsyncIterable(
        malformedProviders.chat.stream({
          ...chatUsageMetadata(),
          messages: [{ role: 'user', content: 'Question?' }],
        })
      )
    ).rejects.toThrow('OpenRouter chat stream event was not valid JSON');
    expect(usageSink.events).toHaveLength(0);
  });

  test('rejects stream responses with parser errors or missing bodies', async () => {
    const usageSink = new FakeUsageSink();
    const missingBodyProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(new Response(null, { status: 200 })),
    });
    const invalidRetryProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(sseResponse(['retry: nope\n\n'])),
    });
    const incompleteFieldProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(sseResponse(['bogus'])),
    });

    await expect(
      collectAsyncIterable(
        missingBodyProviders.chat.stream({
          ...chatUsageMetadata(),
          messages: [{ role: 'user', content: 'Question?' }],
        })
      )
    ).rejects.toThrow('OpenRouter chat stream response did not include a body');
    await expect(
      collectAsyncIterable(
        invalidRetryProviders.chat.stream({
          ...chatUsageMetadata(),
          messages: [{ role: 'user', content: 'Question?' }],
        })
      )
    ).rejects.toThrow('Invalid `retry` value: "nope"');
    await expect(
      collectAsyncIterable(
        incompleteFieldProviders.chat.stream({
          ...chatUsageMetadata(),
          messages: [{ role: 'user', content: 'Question?' }],
        })
      )
    ).rejects.toThrow('Unknown field "bogus"');
    expect(usageSink.events).toHaveLength(0);
  });

  test('records estimated completion usage diagnostics', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(
        jsonResponse({
          choices: [
            {
              message: { role: 'assistant', content: 'Ok.' },
            },
          ],
        })
      ),
    });

    await expect(
      providers.chat.complete({
        ...chatUsageMetadata(),
        ...chatUsageMetadata(),
        model: 'custom/chat-model',
        messages: [{ role: 'user', content: '   ' }],
      })
    ).resolves.toMatchObject({
      model: 'custom/chat-model',
      text: 'Ok.',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        estimated: true,
      },
    });
    expect(usageSink.events[0]).toMatchObject({
      source: { operation: 'chat.completion' },
      request: { model: 'custom/chat-model' },
      usage: { estimated: true },
    });
  });

  test('falls back to estimated chat usage when provider token totals are inconsistent', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(
        jsonResponse({
          choices: [{ message: { role: 'assistant', content: 'A compact answer.' } }],
          usage: {
            completion_tokens: 2,
            total_tokens: 999,
          },
        })
      ),
    });

    await expect(
      providers.chat.complete({
        ...chatUsageMetadata(),
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'How many tokens?' }],
      })
    ).resolves.toMatchObject({
      usage: {
        outputTokens: 2,
        estimated: true,
      },
    });
    expect(usageSink.events).toHaveLength(1);
    expect(usageSink.events[0]?.usage.totalTokens).toBe(
      Number(usageSink.events[0]?.usage.inputTokens) +
        Number(usageSink.events[0]?.usage.outputTokens)
    );
  });

  test('estimates zero chat input tokens when the caller sends no messages', async () => {
    const usageSink = new FakeUsageSink({ service: 'chat-service', component: 'rag-chat' });
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(
        jsonResponse({
          choices: [
            {
              message: { role: 'assistant', content: 'Ok.' },
            },
          ],
        })
      ),
    });

    await expect(
      providers.chat.complete({
        ...chatUsageMetadata(),
        ...chatUsageMetadata(),
        messages: [],
      })
    ).resolves.toMatchObject({
      usage: {
        inputTokens: 0,
        outputTokens: 1,
        totalTokens: 1,
        estimated: true,
      },
    });
    expect(usageSink.events[0]).toMatchObject({
      usage: { estimated: true },
    });
  });

  test('rejects unsuccessful or malformed OpenRouter chat responses', async () => {
    const usageSink = new FakeUsageSink();
    const failedProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(jsonResponse({ error: { message: 'bad gateway' } }, { status: 502 })),
    });
    const malformedProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(
        jsonResponse({ choices: [{ message: { content: [{ type: 'image' }] } }] })
      ),
    });
    const invalidJsonProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(
        new Response('{not-json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      ),
    });
    const missingChoicesProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(jsonResponse({ choices: null })),
    });
    const missingMessageProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(jsonResponse({ choices: [{ delta: { content: 'stream-only' } }] })),
    });

    await expect(
      failedProviders.chat.complete({
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'Question?' }],
      })
    ).rejects.toThrow('OpenRouter chat request failed with status 502: bad gateway');
    await expect(
      malformedProviders.chat.complete({
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'Question?' }],
      })
    ).rejects.toThrow('OpenRouter chat response assistant message content must contain text');
    await expect(
      invalidJsonProviders.chat.complete({
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'Question?' }],
      })
    ).rejects.toThrow('OpenRouter chat response was not valid JSON');
    await expect(
      missingChoicesProviders.chat.complete({
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'Question?' }],
      })
    ).rejects.toThrow('OpenRouter chat response did not include choices');
    await expect(
      missingMessageProviders.chat.complete({
        ...chatUsageMetadata(),
        messages: [{ role: 'user', content: 'Question?' }],
      })
    ).rejects.toThrow('OpenRouter chat response did not include an assistant message');
  });

  test('creates an OpenRouter embedding provider with 2048 default dimensions and usage recording', async () => {
    const usageSink = new FakeUsageSink({
      service: 'knowledge-service',
      component: 'knowledge-embedding',
    });
    const vector = Array.from({ length: DEFAULT_EMBEDDING_DIMENSIONS }, (_, index) => index / 1000);
    const fetchMock = fetchReturning(
      jsonResponse({
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding: vector }],
        model: DEFAULT_EMBEDDING_MODEL,
        usage: {
          prompt_tokens: 9,
          total_tokens: 9,
        },
      })
    );

    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      providers.embeddings.embed({
        ...embeddingUsageMetadata(),
        ...embeddingUsageMetadata({
          promptType: 'knowledge-document-sync-embedding',
          correlation: { requestId: 'document-1' },
        }),
        input: 'Groundbait and hook bait session notes',
      })
    ).resolves.toMatchObject({
      provider: 'openrouter',
      model: DEFAULT_EMBEDDING_MODEL,
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
      vectors: [vector],
      usage: {
        inputTokens: 9,
        outputTokens: 0,
        totalTokens: 9,
        estimated: false,
      },
    });

    expect(firstJsonRequestBody(fetchMock)).toEqual({
      model: DEFAULT_EMBEDDING_MODEL,
      input: 'Groundbait and hook bait session notes',
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    });
    expect(usageSink.events).toHaveLength(1);
    expect(usageSink.events[0]).toMatchObject({
      owner: { type: 'user', id: 'test-user-1' },
      source: {
        service: 'knowledge-service',
        component: 'knowledge-embedding',
        operation: 'embedding',
        promptType: 'knowledge-document-sync-embedding',
      },
      request: {
        provider: 'openrouter',
        model: DEFAULT_EMBEDDING_MODEL,
        promptVersion: testPromptVersion,
      },
      usage: {
        inputTokens: 9,
        outputTokens: 0,
        totalTokens: 9,
        estimated: false,
      },
      correlation: { requestId: 'document-1' },
    });
  });

  test('records estimated embedding usage for array input when provider omits usage', async () => {
    const usageSink = new FakeUsageSink({
      service: 'knowledge-service',
      component: 'query-embedding',
    });
    const fetchMock = fetchReturning(
      jsonResponse({
        data: [
          {
            index: 1,
            embedding: [0.3, 0.4],
          },
          {
            index: 0,
            embedding: [0.1, 0.2],
          },
        ],
      })
    );

    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
    });

    await expect(
      providers.embeddings.embed({
        ...embeddingUsageMetadata(),
        ...embeddingUsageMetadata(),
        model: 'custom/embedding-model',
        input: ['float fishing', 'winter carp'],
        dimensions: 2,
      })
    ).resolves.toMatchObject({
      model: 'custom/embedding-model',
      dimensions: 2,
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      usage: {
        inputTokens: 7,
        outputTokens: 0,
        totalTokens: 7,
        estimated: true,
      },
    });
    expect(firstJsonRequestBody(fetchMock)).toEqual({
      model: 'custom/embedding-model',
      input: ['float fishing', 'winter carp'],
      dimensions: 2,
    });
    expect(usageSink.events[0]).toMatchObject({
      owner: { type: 'user', id: 'test-user-1' },
      source: { operation: 'embedding', promptType: 'rag-query-embedding' },
      usage: { inputTokens: 7, totalTokens: 7, estimated: true },
    });
  });

  test('retries retryable OpenRouter embedding statuses within provider policy', async () => {
    const usageSink = new FakeUsageSink({
      service: 'knowledge-service',
      component: 'query-embedding',
    });
    const calls: { input: string; init?: RequestInit }[] = [];
    const responses = [
      jsonResponse({ error: { message: 'too many requests' } }, { status: 429 }),
      jsonResponse({
        data: [{ index: 0, embedding: [0.1, 0.2] }],
        usage: {
          prompt_tokens: 2,
          total_tokens: 2,
        },
      }),
    ];
    const fetchMock = Object.assign(
      ((input: string, init?: RequestInit) => {
        calls.push({ input, ...(init !== undefined ? { init } : {}) });
        const response = responses[calls.length - 1] ?? responses.at(-1);
        if (response === undefined) {
          throw new Error('Expected a retry response fixture');
        }
        return Promise.resolve(response);
      }) satisfies FetchLike,
      { calls }
    );
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
      providerCallPolicy: {
        maxRetries: 1,
        retryableStatusCodes: [429],
        retryBackoffMs: () => 0,
      },
    });

    await expect(
      providers.embeddings.embed({
        ...embeddingUsageMetadata(),
        ...embeddingUsageMetadata(),
        input: 'winter query',
        dimensions: 2,
      })
    ).resolves.toMatchObject({
      vectors: [[0.1, 0.2]],
      usage: {
        inputTokens: 2,
        outputTokens: 0,
        totalTokens: 2,
        estimated: false,
      },
    });
    expect(fetchMock.calls).toHaveLength(2);
    expect(usageSink.events).toHaveLength(1);
    expect(usageSink.events[0]).toMatchObject({
      owner: { type: 'user', id: 'test-user-1' },
      source: { operation: 'embedding', promptType: 'rag-query-embedding' },
      usage: { inputTokens: 2, outputTokens: 0, totalTokens: 2 },
    });
  });

  test('fails non-retryable OpenRouter embedding statuses once and does not record usage', async () => {
    const usageSink = new FakeUsageSink({
      service: 'knowledge-service',
      component: 'query-embedding',
    });
    const fetchMock = fetchReturning(
      jsonResponse({ error: { message: 'invalid input' } }, { status: 400 })
    );
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchMock,
      providerCallPolicy: {
        maxRetries: 2,
        retryableStatusCodes: [429, 503],
        retryBackoffMs: () => 0,
      },
    });

    await expect(
      providers.embeddings.embed({
        ...embeddingUsageMetadata(),
        input: 'query',
      })
    ).rejects.toMatchObject({
      name: 'LlmProviderCallError',
      code: 'PROVIDER_HTTP_ERROR',
      provider: 'openrouter',
      operation: 'embedding',
      statusCode: 400,
    });
    expect(fetchMock.calls).toHaveLength(1);
    expect(usageSink.events).toHaveLength(0);
  });

  test('rejects embedding response count mismatches before recording usage', async () => {
    const usageSink = new FakeUsageSink({
      service: 'knowledge-service',
      component: 'query-embedding',
    });
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(
        jsonResponse({
          data: [{ index: 0, embedding: [0.1, 0.2] }],
        })
      ),
    });

    await expect(
      providers.embeddings.embed({
        ...embeddingUsageMetadata(),
        input: ['float fishing', 'winter carp'],
        dimensions: 2,
      })
    ).rejects.toThrow('OpenRouter embedding response vector count must equal input count');
    expect(usageSink.events).toHaveLength(0);
  });

  test('rejects embedding response indexes that do not uniquely match input order', async () => {
    const usageSink = new FakeUsageSink({
      service: 'knowledge-service',
      component: 'query-embedding',
    });
    const providers = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(
        jsonResponse({
          data: [
            { index: 0, embedding: [0.1, 0.2] },
            { index: 0, embedding: [0.3, 0.4] },
          ],
        })
      ),
    });

    await expect(
      providers.embeddings.embed({
        ...embeddingUsageMetadata(),
        input: ['float fishing', 'winter carp'],
        dimensions: 2,
      })
    ).rejects.toThrow('OpenRouter embedding response indexes must uniquely match input order');
    expect(usageSink.events).toHaveLength(0);
  });

  test('rejects unsuccessful or malformed OpenRouter embedding responses', async () => {
    const usageSink = new FakeUsageSink({ service: 'knowledge-service' });
    const failedProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(jsonResponse({ error: { message: 'bad gateway' } }, { status: 503 })),
    });
    const missingDataProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(jsonResponse({ object: 'list' })),
    });
    const emptyDataProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(jsonResponse({ data: [] })),
    });
    const badVectorProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(jsonResponse({ data: [{ embedding: [0.1, 'bad'] }] })),
    });
    const missingVectorProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(jsonResponse({ data: [{ embedding: null }] })),
    });
    const nonObjectBodyProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(jsonResponse(null)),
    });
    const nonObjectEntryProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(jsonResponse({ data: [null] })),
    });
    const wrongDimensionsProviders = createLlmProviders({
      env: baseEnv(),
      usageSink,
      fetch: fetchReturning(jsonResponse({ data: [{ embedding: [0.1] }] })),
    });

    await expect(
      failedProviders.embeddings.embed({
        ...embeddingUsageMetadata(),
        input: 'query',
      })
    ).rejects.toThrow('OpenRouter embedding request failed with status 503: bad gateway');
    await expect(
      missingDataProviders.embeddings.embed({
        ...embeddingUsageMetadata(),
        input: 'query',
      })
    ).rejects.toThrow('OpenRouter embedding response did not include data');
    await expect(
      emptyDataProviders.embeddings.embed({
        ...embeddingUsageMetadata(),
        input: 'query',
      })
    ).rejects.toThrow('OpenRouter embedding response did not include any vectors');
    await expect(
      badVectorProviders.embeddings.embed({
        ...embeddingUsageMetadata(),
        input: 'query',
      })
    ).rejects.toThrow('OpenRouter embedding response vector must contain only finite numbers');
    await expect(
      missingVectorProviders.embeddings.embed({
        ...embeddingUsageMetadata(),
        input: 'query',
      })
    ).rejects.toThrow('OpenRouter embedding response item did not include an embedding vector');
    await expect(
      nonObjectBodyProviders.embeddings.embed({
        ...embeddingUsageMetadata(),
        input: 'query',
      })
    ).rejects.toThrow('OpenRouter embedding response did not include data');
    await expect(
      nonObjectEntryProviders.embeddings.embed({
        ...embeddingUsageMetadata(),
        input: 'query',
      })
    ).rejects.toThrow('OpenRouter embedding response item did not include an embedding vector');
    await expect(
      wrongDimensionsProviders.embeddings.embed({
        ...embeddingUsageMetadata(),
        input: 'query',
      })
    ).rejects.toThrow('OpenRouter embedding vector dimensions must equal 2048');
  });
});
