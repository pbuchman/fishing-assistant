import { describe, expect, it } from 'vitest';

import { FaError, type Result } from '@fa/common-core';

import { parseDailyUsageQuery } from './dailyAggregate.js';
import { parsePricingInput } from './pricing.js';
import {
  MAX_USAGE_EVENTS_LIMIT,
  parseUsageEventInput,
  parseUsageEventsQuery,
  parseUsageEventsRequest,
} from './usageEvent.js';

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    },
    cost: {
      estimatedCostUsd: 0.00002,
      source: 'provider-reported',
    },
    correlation: {
      conversationId: 'conversation-1',
      messageId: 'message-1',
      knowledgePageId: 'page-1',
      chunkId: 'chunk-1',
      requestId: 'request-1',
    },
    ...overrides,
  };
}

function expectInvalid(result: Result<unknown, FaError>, message: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('expected validation to fail');
  }

  expect(result.error.message).toContain(message);
}

function expectValid<T>(result: Result<T, FaError>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected validation to pass: ${result.error.message}`);
  }

  return result.value;
}

describe('usage event validation', () => {
  it('accepts the chat assistant prompt type used by live chat completions', () => {
    const baseEvent = event();
    const result = expectValid(
      parseUsageEventInput(
        event({
          source: {
            ...(baseEvent['source'] as Record<string, unknown>),
            promptType: 'chat-assistant',
          },
        })
      )
    );

    expect(result.source.promptType).toBe('chat-assistant');
  });

  it('parses valid user-owned usage events with prompt metadata and correlation', () => {
    const result = expectValid(
      parseUsageEventInput(
        event({
          source: {
            service: 'chat-service',
            component: 'answer-grounding-check',
            operation: 'chat.completion',
            promptType: 'answer-grounding-check',
          },
          request: {
            provider: 'openrouter',
            model: 'google/gemini-3.5-flash',
            promptVersion: '2.0.0',
          },
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimated: true },
        })
      )
    );

    expect(result).toMatchObject({
      id: 'event-1',
      owner: { type: 'user', id: 'user-123' },
      source: {
        service: 'chat-service',
        component: 'answer-grounding-check',
        operation: 'chat.completion',
        promptType: 'answer-grounding-check',
      },
      request: {
        provider: 'openrouter',
        model: 'google/gemini-3.5-flash',
        promptVersion: '2.0.0',
      },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimated: true },
      correlation: {
        conversationId: 'conversation-1',
        messageId: 'message-1',
        knowledgePageId: 'page-1',
        chunkId: 'chunk-1',
        requestId: 'request-1',
      },
    });
  });

  it('defaults missing usage estimation diagnostics to false', () => {
    const result = expectValid(parseUsageEventInput(event()));

    expect(result.usage.estimated).toBe(false);
  });

  it.each<[string, unknown, string]>([
    ['non-object event', null, 'usage event must be an object'],
    ['missing id', event({ id: '' }), 'id must be a non-empty string'],
    [
      'bad owner type',
      event({ owner: { type: 'admin', id: 'user-123' } }),
      'owner.type must be user',
    ],
    [
      'missing owner id',
      event({ owner: { type: 'user', id: '' } }),
      'owner.id must be a non-empty string',
    ],
    [
      'anonymous workspace owner id',
      event({ owner: { type: 'user', id: 'anonymous-workspace-1' } }),
      'owner.id must be a real user id',
    ],
    [
      'email-like owner id',
      event({ owner: { type: 'user', id: 'angler@example.com' } }),
      'owner.id must be a real user id',
    ],
    [
      'E.164-like owner id',
      event({ owner: { type: 'user', id: '+15551234567' } }),
      'owner.id must be a real user id',
    ],
    [
      'provider subject owner id',
      event({ owner: { type: 'user', id: 'auth0|abc123' } }),
      'owner.id must be a real user id',
    ],
    [
      'workspace-shaped owner id',
      event({ owner: { type: 'user', id: 'workspace-123' } }),
      'owner.id must be a real user id',
    ],
    [
      'bad service',
      event({ source: { ...(event()['source'] as Record<string, unknown>), service: 'web' } }),
      'source.service must be one of',
    ],
    [
      'missing component',
      event({ source: { ...(event()['source'] as Record<string, unknown>), component: ' ' } }),
      'source.component must be a non-empty string',
    ],
    [
      'missing provider',
      event({ request: { ...(event()['request'] as Record<string, unknown>), provider: '' } }),
      'request.provider must be a non-empty string',
    ],
    [
      'missing model',
      event({ request: { ...(event()['request'] as Record<string, unknown>), model: '' } }),
      'request.model must be a non-empty string',
    ],
    [
      'bad operation',
      event({ source: { ...(event()['source'] as Record<string, unknown>), operation: 'chat' } }),
      'source.operation must be one of',
    ],
    [
      'missing prompt type',
      event({
        source: { ...(event()['source'] as Record<string, unknown>), promptType: undefined },
      }),
      'source.promptType must be a non-empty string',
    ],
    [
      'bad prompt type',
      event({ source: { ...(event()['source'] as Record<string, unknown>), promptType: '' } }),
      'source.promptType must be a non-empty string',
    ],
    [
      'unknown prompt type',
      event({
        source: { ...(event()['source'] as Record<string, unknown>), promptType: 'ad-hoc' },
      }),
      'source.promptType must be one of',
    ],
    [
      'missing prompt version on prompt-backed call',
      event({
        request: { ...(event()['request'] as Record<string, unknown>), promptVersion: undefined },
      }),
      'request.promptVersion must be a non-empty string',
    ],
    [
      'bad input tokens',
      event({ usage: { ...(event()['usage'] as Record<string, unknown>), inputTokens: -1 } }),
      'usage.inputTokens must be',
    ],
    [
      'bad output tokens',
      event({ usage: { ...(event()['usage'] as Record<string, unknown>), outputTokens: 1.5 } }),
      'usage.outputTokens must be',
    ],
    [
      'bad total tokens',
      event({ usage: { ...(event()['usage'] as Record<string, unknown>), totalTokens: 99 } }),
      'totalTokens must equal',
    ],
    [
      'bad usage estimation diagnostic',
      event({ usage: { ...(event()['usage'] as Record<string, unknown>), estimated: 'yes' } }),
      'usage.estimated must be a boolean',
    ],
    ['bad correlation', event({ correlation: null }), 'correlation must be an object'],
    [
      'bad correlation field',
      event({ correlation: { requestId: '' } }),
      'correlation.requestId must be a non-empty string',
    ],
    ['retired ownerType', event({ ownerType: 'user' }), 'retired owner fields are not accepted'],
    ['retired ownerId', event({ ownerId: 'user-123' }), 'retired owner fields are not accepted'],
    [
      'retired workspaceId',
      event({ workspaceId: 'workspace-1' }),
      'retired owner fields are not accepted',
    ],
    [
      'retired correlation document id',
      event({ correlation: { documentId: 'document-1' } }),
      'retired owner fields are not accepted',
    ],
    ['missing cost source', event({ cost: { estimatedCostUsd: 99 } }), 'cost.source must be'],
    ['negative cost', event({ cost: { estimatedCostUsd: -1 } }), 'cost.estimatedCostUsd must be'],
    [
      'caller-owned createdAt',
      event({ createdAt: '2026-06-14T12:00:00.000Z' }),
      'createdAt is assigned by llm-usage-service',
    ],
  ])('rejects %s', (_name, input, message) => {
    expectInvalid(parseUsageEventInput(input), message);
  });

  it('sanitizes usage error messages before persistence', () => {
    const result = expectValid(
      parseUsageEventInput(
        event({
          error: {
            code: 'PROVIDER_HTTP_ERROR',
            message:
              'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret FA_INTERNAL_AUTH_TOKEN=secret /home/operator/.config/gcloud/key.json john@example.com +15551234567 bait prompt text',
          },
        })
      )
    );

    expect(result.error).toEqual({
      code: 'PROVIDER_HTTP_ERROR',
      message: 'Provider error details redacted.',
    });
  });

  it('validates usage event batch shape', () => {
    expectInvalid(parseUsageEventsRequest({}), 'events must be an array');
    expectInvalid(parseUsageEventsRequest({ events: [] }), 'events must not be empty');
    expectInvalid(
      parseUsageEventsRequest({ events: Array.from({ length: 101 }, () => event()) }),
      'events must contain at most 100 entries'
    );

    const result = expectValid(parseUsageEventsRequest({ events: [event()] }));
    expect(result).toHaveLength(1);
    expect((result[0] as Record<string, unknown> | undefined)?.['id']).toBe('event-1');
  });
});

describe('usage query validation', () => {
  it('parses defaults and clamps limits', () => {
    expect(
      parseUsageEventsQuery({
        from: '2026-06-14T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        ownerId: 'anonymous',
        service: 'chat-service',
        operation: 'chat.stream',
        limit: '999',
      })
    ).toEqual({
      ok: true,
      value: {
        from: '2026-06-14T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        ownerId: 'anonymous',
        service: 'chat-service',
        operation: 'chat.stream',
        limit: MAX_USAGE_EVENTS_LIMIT,
      },
    });
  });

  it.each<[string, unknown, string]>([
    ['non-object query', null, 'query must be an object'],
    ['missing from', { to: '2026-06-15T00:00:00.000Z' }, 'from must be a non-empty string'],
    [
      'bad from date',
      { from: 'bad', to: '2026-06-15T00:00:00.000Z' },
      'from must be an ISO timestamp',
    ],
    ['bad to date', { from: '2026-06-14T00:00:00.000Z', to: 'bad' }, 'to must be an ISO timestamp'],
    [
      'reversed range',
      { from: '2026-06-15T00:00:00.000Z', to: '2026-06-14T00:00:00.000Z' },
      'from must be before or equal to to',
    ],
    [
      'missing owner',
      { from: '2026-06-14T00:00:00.000Z', to: '2026-06-15T00:00:00.000Z' },
      'ownerId must be a non-empty string',
    ],
    [
      'bad service',
      {
        from: '2026-06-14T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        ownerId: 'anonymous',
        service: 'bad',
      },
      'service must be one of',
    ],
    [
      'bad operation',
      {
        from: '2026-06-14T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        ownerId: 'anonymous',
        operation: 'bad',
      },
      'operation must be one of',
    ],
    [
      'bad limit',
      {
        from: '2026-06-14T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        ownerId: 'anonymous',
        limit: 0,
      },
      'limit must be a positive safe integer',
    ],
  ])('rejects %s', (_name, input, message) => {
    expectInvalid(parseUsageEventsQuery(input), message);
  });
});

describe('daily usage query validation', () => {
  it('parses valid daily usage queries', () => {
    expect(
      parseDailyUsageQuery({ from: '2026-06-14', to: '2026-06-15', ownerId: 'anonymous' })
    ).toEqual({
      ok: true,
      value: { from: '2026-06-14', to: '2026-06-15', ownerId: 'anonymous' },
    });
  });

  it.each<[string, unknown, string]>([
    ['non-object query', null, 'query must be an object'],
    ['bad from date', { from: 'bad', to: '2026-06-15' }, 'from must be YYYY-MM-DD'],
    ['bad to date', { from: '2026-06-14', to: 'bad' }, 'to must be YYYY-MM-DD'],
    ['reversed range', { from: '2026-06-15', to: '2026-06-14' }, 'from must be before'],
    ['missing owner', { from: '2026-06-14', to: '2026-06-15' }, 'ownerId must be'],
  ])('rejects %s', (_name, input, message) => {
    expectInvalid(parseDailyUsageQuery(input), message);
  });
});

describe('pricing validation', () => {
  it('parses pricing with optional embedding rate and generated updatedAt', () => {
    const result = parsePricingInput('openrouter', 'qwen/qwen3-embedding-8b', {
      inputUsdPer1M: 0.01,
      outputUsdPer1M: 0,
      embeddingUsdPer1M: 0.01,
    });

    const pricing = expectValid(result);
    expect(pricing).toMatchObject({
      provider: 'openrouter',
      model: 'qwen/qwen3-embedding-8b',
      embeddingUsdPer1M: 0.01,
    });
    expect(typeof pricing.updatedAt).toBe('string');
  });

  it.each<[string, unknown, unknown, unknown, string]>([
    ['missing provider', '', 'model', {}, 'provider must be a non-empty string'],
    ['missing model', 'openrouter', '', {}, 'model must be a non-empty string'],
    ['bad body', 'openrouter', 'model', null, 'pricing body must be an object'],
    [
      'bad input price',
      'openrouter',
      'model',
      { inputUsdPer1M: -1, outputUsdPer1M: 0 },
      'inputUsdPer1M must be a non-negative number',
    ],
    [
      'bad output price',
      'openrouter',
      'model',
      { inputUsdPer1M: 1, outputUsdPer1M: Number.NaN },
      'outputUsdPer1M must be a non-negative number',
    ],
    [
      'bad embedding price',
      'openrouter',
      'model',
      { inputUsdPer1M: 1, outputUsdPer1M: 0, embeddingUsdPer1M: -1 },
      'embeddingUsdPer1M must be a non-negative number',
    ],
    [
      'bad updatedAt',
      'openrouter',
      'model',
      { inputUsdPer1M: 1, outputUsdPer1M: 0, updatedAt: 'bad' },
      'updatedAt must be an ISO timestamp',
    ],
  ])('rejects %s', (_name, provider, model, body, message) => {
    expectInvalid(parsePricingInput(provider, model, body), message);
  });
});
