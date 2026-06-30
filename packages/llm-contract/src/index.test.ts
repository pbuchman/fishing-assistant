import { expect, test } from 'vitest';

import {
  type ChatCompletionRequest,
  type ChatCompletionStreamEvent,
  type ChatStructuredOutput,
  type EmbeddingRequest,
  LlmProviderCallError,
  type LlmProviderCallPolicy,
  chatMessageRoles,
  isChatMessageRole,
  packageName,
  type ChatCompletionResponse,
  type LlmChatProvider,
  type LlmEmbeddingProvider,
} from '@fa/llm-contract';

test('exports the package name', () => {
  expect(packageName).toBe('@fa/llm-contract');
});

test('defines the supported chat message roles', () => {
  expect(chatMessageRoles).toEqual(['system', 'user', 'assistant', 'tool']);
  expect(isChatMessageRole('system')).toBe(true);
  expect(isChatMessageRole('tool')).toBe(true);
});

test('defines chat and embedding provider contracts', async () => {
  const chatProvider: LlmChatProvider = {
    complete: (request) => {
      const response: ChatCompletionResponse = {
        provider: 'openrouter',
        model: request.model ?? 'google/gemini-3.5-flash',
        text: request.messages.map((message) => message.content).join('\n'),
        finishReason: 'stop',
        usage: {
          inputTokens: 3,
          outputTokens: 4,
          totalTokens: 7,
          estimated: false,
        },
      };

      return Promise.resolve(response);
    },
    stream: async function* () {
      await Promise.resolve();
      yield { type: 'text_delta', text: 'Which ' } satisfies ChatCompletionStreamEvent;
      yield {
        type: 'done',
        response: {
          provider: 'openrouter',
          model: 'google/gemini-3.5-flash',
          text: 'Which bait?',
          usage: {
            inputTokens: 3,
            outputTokens: 4,
            totalTokens: 7,
            estimated: false,
          },
        },
      } satisfies ChatCompletionStreamEvent;
    },
  };
  const embeddingProvider: LlmEmbeddingProvider = {
    embed: (request) =>
      Promise.resolve({
        provider: 'openrouter',
        model: request.model ?? 'qwen/qwen3-embedding-8b',
        dimensions: request.dimensions ?? 2048,
        vectors: [[0.1, 0.2]],
        usage: {
          inputTokens: 2,
          outputTokens: 0,
          totalTokens: 2,
          estimated: false,
        },
      }),
  };

  await expect(
    chatProvider.complete({
      model: 'google/gemini-3.5-flash',
      messages: [{ role: 'user', content: 'Which bait?' }],
    })
  ).resolves.toMatchObject({
    provider: 'openrouter',
    model: 'google/gemini-3.5-flash',
    text: 'Which bait?',
    usage: { totalTokens: 7 },
  });

  await expect(
    embeddingProvider.embed({
      input: 'feeder mix notes',
    })
  ).resolves.toMatchObject({
    provider: 'openrouter',
    model: 'qwen/qwen3-embedding-8b',
    dimensions: 2048,
    vectors: [[0.1, 0.2]],
  });

  const streamEvents: ChatCompletionStreamEvent[] = [];
  for await (const event of chatProvider.stream({
    messages: [{ role: 'user', content: 'Which bait?' }],
  })) {
    streamEvents.push(event);
  }

  expect(streamEvents[0]).toEqual({ type: 'text_delta', text: 'Which ' });
  expect(streamEvents[1]?.type).toBe('done');
  if (streamEvents[1]?.type !== 'done') {
    throw new Error('Expected final stream event');
  }
  expect(streamEvents[1].response).toMatchObject({
    text: 'Which bait?',
    usage: { totalTokens: 7 },
  });
});

test('allows chat requests to ask providers for JSON object structured output', () => {
  const structuredOutput: ChatStructuredOutput = {
    type: 'json_object',
  };
  const request: ChatCompletionRequest = {
    messages: [{ role: 'user', content: 'Return strict JSON.' }],
    structuredOutput,
  };

  expect(request.structuredOutput).toEqual({
    type: 'json_object',
  });
});

test('allows chat requests to ask providers for JSON schema structured output', () => {
  const structuredOutput: ChatStructuredOutput = {
    type: 'json_schema',
    schemaName: 'fishing_answer',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        answerMarkdown: { type: 'string' },
      },
      required: ['answerMarkdown'],
    },
  };
  const request: ChatCompletionRequest = {
    messages: [{ role: 'user', content: 'Return strict JSON.' }],
    structuredOutput,
  };

  expect(request.structuredOutput).toEqual({
    type: 'json_schema',
    schemaName: 'fishing_answer',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        answerMarkdown: { type: 'string' },
      },
      required: ['answerMarkdown'],
    },
  });
});

test('allows chat requests to carry provider reasoning controls', () => {
  const request: ChatCompletionRequest = {
    messages: [{ role: 'user', content: 'Return strict JSON.' }],
    reasoning: {
      effort: 'minimal',
      exclude: true,
    },
  };

  expect(request.reasoning).toEqual({
    effort: 'minimal',
    exclude: true,
  });
});

test('requires JSON schema structured output to include a schema', () => {
  const invalidRequest: ChatCompletionRequest = {
    messages: [{ role: 'user', content: 'Return strict JSON.' }],
    // @ts-expect-error json_schema structured output must include a schema.
    structuredOutput: {
      type: 'json_schema',
      schemaName: 'fishing_answer',
      strict: true,
    },
  };
  expect(invalidRequest.structuredOutput).toEqual({
    type: 'json_schema',
    schemaName: 'fishing_answer',
    strict: true,
  });
});

test('defines provider call policy and classified provider errors', () => {
  const policy: LlmProviderCallPolicy = {
    timeoutMs: 250,
    maxRetries: 2,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryBackoffMs: ({ attempt, statusCode }) => attempt + (statusCode ?? 0),
  };

  expect(policy.retryBackoffMs?.({ attempt: 1, operation: 'embedding', statusCode: 429 })).toBe(
    430
  );

  const error = new LlmProviderCallError({
    code: 'PROVIDER_TIMEOUT',
    provider: 'openrouter',
    operation: 'chat.completion',
    message: 'OpenRouter chat request timed out after 250ms',
  });

  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({
    name: 'LlmProviderCallError',
    code: 'PROVIDER_TIMEOUT',
    provider: 'openrouter',
    operation: 'chat.completion',
    message: 'OpenRouter chat request timed out after 250ms',
  });
});

test('allows provider requests to carry caller abort signals and per-call policy', () => {
  const controller = new AbortController();
  const policy: LlmProviderCallPolicy = {
    timeoutMs: 500,
    maxRetries: 1,
    retryableStatusCodes: [503],
  };
  const chatRequest: ChatCompletionRequest = {
    messages: [{ role: 'user', content: 'Return strict JSON.' }],
    signal: controller.signal,
    providerCallPolicy: policy,
  };
  const embeddingRequest: EmbeddingRequest = {
    input: 'winter feeder mix',
    signal: controller.signal,
    providerCallPolicy: policy,
  };

  expect(chatRequest.providerCallPolicy).toBe(policy);
  expect(embeddingRequest.signal).toBe(controller.signal);
  expect(embeddingRequest.providerCallPolicy?.retryableStatusCodes).toEqual([503]);
});

test('allows nested user-owned usage metadata, prompt types, and prompt versions on chat and embedding requests', () => {
  const chatRequest: ChatCompletionRequest = {
    messages: [{ role: 'user', content: 'Return strict JSON.' }],
    owner: { type: 'user', id: 'user-123' },
    promptType: 'fishing-answer',
    promptVersion: '1.2.3',
  };
  const embeddingRequest: EmbeddingRequest = {
    input: 'winter feeder mix',
    owner: { type: 'user', id: 'user-123' },
    promptType: 'rag-query-embedding',
    promptVersion: '1.2.3',
  };
  const invalidWorkspaceRequest: ChatCompletionRequest = {
    messages: [{ role: 'user', content: 'Return strict JSON.' }],
    // @ts-expect-error workspace/system owners are not application usage owners.
    owner: { type: 'workspace', id: 'workspace-1' },
    promptType: 'fishing-answer',
    promptVersion: '1.2.3',
  };

  expect(chatRequest).toMatchObject({
    owner: { type: 'user', id: 'user-123' },
    promptType: 'fishing-answer',
    promptVersion: '1.2.3',
  });
  expect(embeddingRequest).toMatchObject({
    owner: { type: 'user', id: 'user-123' },
    promptType: 'rag-query-embedding',
    promptVersion: '1.2.3',
  });
  expect(invalidWorkspaceRequest.owner).toEqual({ type: 'workspace', id: 'workspace-1' });
});
