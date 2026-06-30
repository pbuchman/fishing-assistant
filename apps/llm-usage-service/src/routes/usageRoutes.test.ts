import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthorizationResolveResponse } from '@fa/http-contracts';

import { createServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import type { LlmPricing } from '../domain/models/pricing.js';
import type { LlmUsageEvent, UsageEventInput } from '../domain/models/usageEvent.js';
import { createPricingCache } from '../domain/services/pricingCache.js';
import {
  FakePricingRepository,
  FakeUsageAggregateRepository,
  FakeUsageEventRepository,
  silentLogger,
} from '../__tests__/fakes/usageRepositories.js';

const pricing: LlmPricing = {
  provider: 'openrouter',
  model: 'google/gemini-3.5-flash',
  inputUsdPer1M: 1.5,
  outputUsdPer1M: 9,
  updatedAt: '2026-06-13T00:00:00.000Z',
};

function usageInput(overrides: Partial<UsageEventInput> = {}): UsageEventInput {
  const base: UsageEventInput = {
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
    usage: { inputTokens: 1000, outputTokens: 100, totalTokens: 1100, estimated: false },
    cost: { estimatedCostUsd: 0.0024, source: 'provider-reported' },
    correlation: {},
  };
  return { ...base, ...overrides };
}

function usageEvent(overrides: Partial<LlmUsageEvent> = {}): LlmUsageEvent {
  const base: LlmUsageEvent = {
    ...usageInput(),
    id: 'usage-event-1',
    cost: { estimatedCostUsd: 0.0024 },
    createdAt: '2026-06-18T10:00:00.000Z',
  };

  return { ...base, ...overrides };
}

function failedChatUsageInput(): UsageEventInput {
  return usageInput({
    id: 'failed-chat-event',
    source: {
      service: 'chat-service',
      component: 'rag-chat',
      operation: 'chat.stream',
      promptType: 'fishing-answer',
    },
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimated: true },
    cost: { estimatedCostUsd: 0, source: 'provider-estimated' },
    correlation: {
      conversationId: 'conversation-1',
      messageId: 'failed-assistant-message-1',
    },
    error: {
      code: 'ANSWER_GENERATION_FAILED',
      message:
        'Answer generation failed. Bearer secret-token FA_INTERNAL_AUTH_TOKEN=secret prompt text',
    },
  });
}

function approvedResponse(role: 'admin' | 'user' = 'user'): AuthorizationResolveResponse {
  return {
    state: 'approved',
    user: {
      id: `approved-${role}`,
      email: `${role}@example.com`,
      firstName: 'River',
      lastName: 'Angler',
      mobileNumber: '+15550101000',
      role,
      status: 'approved',
      level: role === 'admin' ? null : 8,
      effectiveLevel: role === 'admin' ? 10 : 8,
    },
    authorization: {
      userId: `approved-${role}`,
      auth0Subject: `auth0|approved-${role}`,
      email: `${role}@example.com`,
      role,
      status: 'approved',
      effectiveLevel: role === 'admin' ? 10 : 8,
    },
  };
}

function installServices(
  options: {
    prices?: readonly LlmPricing[];
    authorizationResponse?: AuthorizationResolveResponse;
  } = {}
) {
  const pricingRepository = new FakePricingRepository(options.prices ?? [pricing]);
  const usageEventRepository = new FakeUsageEventRepository();
  const usageAggregateRepository = new FakeUsageAggregateRepository();
  const pricingCache = createPricingCache(pricingRepository);

  setServices({
    serviceName: 'llm-usage-service',
    usageEventRepository,
    usageAggregateRepository,
    pricingRepository,
    pricingCache,
    logger: silentLogger,
    auth0JwtVerifier: vi.fn().mockResolvedValue({
      ok: true,
      identity: {
        subject: 'auth0|approved-user',
        email: 'user@example.com',
        emailVerified: true,
      },
    }),
    userServiceClient: {
      resolveAuthorization: vi
        .fn()
        .mockResolvedValue(options.authorizationResponse ?? approvedResponse()),
      lookupUserIdentities: vi.fn().mockResolvedValue({ users: [] }),
    },
  });

  return { pricingRepository, usageEventRepository, usageAggregateRepository, pricingCache };
}

describe('llm-usage-service usage routes', () => {
  beforeEach(() => {
    process.env['FA_AUTH0_ISSUER'] = 'https://auth.example.com/';
    process.env['FA_AUTH0_AUDIENCE'] = 'fa-api';
    process.env['FA_AUTH0_JWKS_URI'] = 'https://auth.example.com/.well-known/jwks.json';
    process.env['FA_INTERNAL_AUTH_TOKEN'] = 'internal-token';
  });

  afterEach(() => {
    delete process.env['FA_AUTH0_ISSUER'];
    delete process.env['FA_AUTH0_AUDIENCE'];
    delete process.env['FA_AUTH0_JWKS_URI'];
    delete process.env['FA_INTERNAL_AUTH_TOKEN'];
    resetServices();
  });

  it('does not expose a personal usage events route to approved users', async () => {
    const { usageEventRepository } = installServices({
      authorizationResponse: approvedResponse('user'),
    });
    usageEventRepository.events.push(
      usageEvent({
        id: 'own-stream',
        owner: { type: 'user', id: 'approved-user' },
        source: {
          service: 'chat-service',
          component: 'rag-chat',
          operation: 'chat.stream',
          promptType: 'fishing-answer',
        },
      }),
      usageEvent({
        id: 'own-completion',
        owner: { type: 'user', id: 'approved-user' },
        source: {
          service: 'chat-service',
          component: 'rag-chat',
          operation: 'chat.completion',
          promptType: 'fishing-answer',
        },
      }),
      usageEvent({
        id: 'other-user-stream',
        owner: { type: 'user', id: 'another-user' },
        source: {
          service: 'chat-service',
          component: 'rag-chat',
          operation: 'chat.stream',
          promptType: 'fishing-answer',
        },
      })
    );
    const app = await createServer();

    const response = await app.inject({
      method: 'GET',
      url: '/me/events?from=2026-06-18T00:00:00.000Z&to=2026-06-18T23:59:59.999Z&service=chat-service&operation=chat.stream&limit=25',
      headers: { authorization: 'Bearer user-token' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('rejects unauthenticated internal usage ingestion', async () => {
    installServices();
    const app = await createServer();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/usage-events',
      payload: { events: [usageInput()] },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'Internal auth failed' },
    });
  });

  it('runs internal auth before internal usage body validation', async () => {
    installServices();
    const app = await createServer();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/usage-events',
      payload: { events: 'not-an-array' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'Internal auth failed' },
    });
  });

  it('accepts authenticated internal usage batches', async () => {
    installServices();
    const app = await createServer();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/usage-events',
      headers: { 'X-Internal-Auth': 'internal-token' },
      payload: { events: [usageInput()] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      data: { accepted: 1, duplicates: 0, rejected: [] },
    });
  });

  it('accepts no-charge failed chat events and sends sanitized errors to aggregation', async () => {
    const { usageEventRepository, usageAggregateRepository } = installServices();
    const app = await createServer();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/usage-events',
      headers: { 'X-Internal-Auth': 'internal-token' },
      payload: { events: [failedChatUsageInput()] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      data: { accepted: 1, duplicates: 0, rejected: [] },
    });
    expect(usageEventRepository.events).toEqual([
      expect.objectContaining({
        id: 'failed-chat-event',
        source: {
          service: 'chat-service',
          component: 'rag-chat',
          operation: 'chat.stream',
          promptType: 'fishing-answer',
        },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimated: true },
        cost: { estimatedCostUsd: 0, source: 'provider-estimated' },
        correlation: {
          conversationId: 'conversation-1',
          messageId: 'failed-assistant-message-1',
        },
        error: {
          code: 'ANSWER_GENERATION_FAILED',
          message: 'Provider error details redacted.',
        },
      }),
    ]);
    expect(usageAggregateRepository.increments).toEqual([
      expect.objectContaining({
        id: 'failed-chat-event',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimated: true },
        cost: { estimatedCostUsd: 0, source: 'provider-estimated' },
        error: {
          code: 'ANSWER_GENERATION_FAILED',
          message: 'Provider error details redacted.',
        },
      }),
    ]);
  });

  it('returns 400 for invalid ingestion bodies', async () => {
    installServices();
    const app = await createServer();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/usage-events',
      headers: { 'X-Internal-Auth': 'internal-token' },
      payload: { events: [] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
  });

  it('returns per-event rejections for schema-valid usage ingestion bodies that fail domain validation', async () => {
    installServices();
    const app = await createServer();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/usage-events',
      headers: { 'X-Internal-Auth': 'internal-token' },
      payload: {
        events: [
          usageInput({
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 99, estimated: false },
          }),
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      data: {
        accepted: 0,
        duplicates: 0,
        rejected: [
          {
            index: 0,
            id: 'event-1',
            code: 'INVALID_USAGE_EVENT',
            message: 'totalTokens must equal inputTokens + outputTokens',
          },
        ],
      },
    });
  });

  it('rejects authenticated usage events that omit prompt type', async () => {
    installServices();
    const app = await createServer();
    const eventWithoutPromptType = {
      ...usageInput(),
      source: { ...usageInput().source, promptType: undefined },
    };

    const response = await app.inject({
      method: 'POST',
      url: '/internal/usage-events',
      headers: { 'X-Internal-Auth': 'internal-token' },
      payload: {
        events: [eventWithoutPromptType],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      data: {
        accepted: 0,
        duplicates: 0,
        rejected: [
          {
            index: 0,
            id: 'event-1',
            code: 'INVALID_PROMPT_TYPE',
            message: 'source.promptType must be a non-empty string',
          },
        ],
      },
    });
  });

  it('accepts usage events without pricing rows', async () => {
    installServices({ prices: [] });
    const app = await createServer();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/usage-events',
      headers: { 'X-Internal-Auth': 'internal-token' },
      payload: { events: [usageInput()] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      data: {
        accepted: 1,
        duplicates: 0,
        rejected: [],
      },
    });
  });

  it.each([
    ['GET', '/usage/events?ownerId=anonymous'],
    ['GET', '/usage/daily?ownerId=anonymous'],
    ['GET', '/pricing'],
    ['PUT', '/pricing/openrouter/google%2Fgemini-3.5-flash'],
  ] as const)('closes retired public %s %s route', async (method, url) => {
    installServices();
    const app = await createServer();

    const request = {
      method,
      url,
      ...(method === 'PUT'
        ? {
            payload: {
              inputUsdPer1M: 2,
              outputUsdPer1M: 10,
              updatedAt: '2026-06-14T00:00:00.000Z',
            },
          }
        : {}),
    };
    const response = await app.inject(request);

    expect(response.statusCode).toBe(404);
  });
});
