import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { err, FaError } from '@fa/common-core';
import type { AuthorizationResolveResponse } from '@fa/http-contracts';

import {
  FakePricingRepository,
  FakeUsageAggregateRepository,
  FakeUsageEventRepository,
  silentLogger,
} from '../__tests__/fakes/usageRepositories.js';
import type { LlmUsageDailyAggregate } from '../domain/models/dailyAggregate.js';
import type { LlmUsageEvent } from '../domain/models/usageEvent.js';
import { createPricingCache } from '../domain/services/pricingCache.js';
import { createServer } from '../server.js';
import { resetServices, setServices } from '../services.js';

function configureAuthEnv(): void {
  process.env['FA_AUTH0_ISSUER'] = 'https://auth.example.com/';
  process.env['FA_AUTH0_AUDIENCE'] = 'fa-api';
  process.env['FA_AUTH0_JWKS_URI'] = 'https://auth.example.com/.well-known/jwks.json';
}

function approvedResponse(role: 'admin' | 'user' = 'admin'): AuthorizationResolveResponse {
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
      level: 8,
      effectiveLevel: 8,
    },
    authorization: {
      userId: `approved-${role}`,
      auth0Subject: `auth0|approved-${role}`,
      email: `${role}@example.com`,
      role,
      status: 'approved',
      effectiveLevel: 8,
    },
  };
}

function aggregate(overrides: Partial<LlmUsageDailyAggregate> = {}): LlmUsageDailyAggregate {
  const base: LlmUsageDailyAggregate = {
    id: 'aggregate-1',
    bucket: { day: '2026-06-14', hour: '2026-06-14T12' },
    owner: { type: 'user', id: 'user-123' },
    source: {
      service: 'chat-service',
      component: 'rag-chat',
      operation: 'chat.stream',
      promptType: 'fishing-answer',
    },
    request: {
      provider: 'openrouter',
      model: 'google/gemini-3.5-flash',
      promptVersion: '1.0.0',
    },
    metrics: {
      calls: 2,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      estimatedCostUsd: 0.25,
      estimatedCallCount: 0,
      errorCallCount: 0,
    },
    firstEventAt: '2026-06-14T12:00:00.000Z',
    lastEventAt: '2026-06-14T12:00:00.000Z',
    updatedAt: '2026-06-14T12:00:00.000Z',
  };
  return { ...base, ...overrides };
}

function event(overrides: Partial<LlmUsageEvent> = {}): LlmUsageEvent {
  const base: LlmUsageEvent = {
    id: 'event-1',
    owner: { type: 'user', id: 'user-123' },
    source: {
      service: 'chat-service',
      component: 'rag-chat',
      operation: 'chat.stream',
      promptType: 'fishing-answer',
    },
    request: {
      provider: 'openrouter',
      model: 'google/gemini-3.5-flash',
      promptVersion: '1.0.0',
    },
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, estimated: false },
    cost: { estimatedCostUsd: 0.25 },
    correlation: { conversationId: 'conversation-1', messageId: 'message-1' },
    createdAt: '2026-06-14T12:00:00.000Z',
  };
  return { ...base, ...overrides };
}

function failedChatAggregate(): LlmUsageDailyAggregate {
  return aggregate({
    id: 'failed-chat-aggregate',
    metrics: {
      calls: 1,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      estimatedCallCount: 1,
      errorCallCount: 1,
    },
  });
}

function failedChatEvent(): LlmUsageEvent {
  return event({
    id: 'failed-chat-event',
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimated: true },
    cost: { estimatedCostUsd: 0 },
    error: {
      code: 'ANSWER_GENERATION_FAILED',
      message: 'Provider error details redacted.',
    },
  });
}

function installServices(
  options: {
    aggregates?: readonly LlmUsageDailyAggregate[];
    events?: readonly LlmUsageEvent[];
    authorizationResponse?: AuthorizationResolveResponse;
    jwtOk?: boolean;
  } = {}
) {
  const pricingRepository = new FakePricingRepository();
  const usageEventRepository = new FakeUsageEventRepository(options.events ?? []);
  const usageAggregateRepository = new FakeUsageAggregateRepository(options.aggregates ?? []);
  setServices({
    serviceName: 'llm-usage-service',
    usageEventRepository,
    usageAggregateRepository,
    pricingRepository,
    pricingCache: createPricingCache(pricingRepository),
    logger: silentLogger,
    auth0JwtVerifier: vi.fn().mockResolvedValue(
      options.jwtOk === false
        ? { ok: false, error: { code: 'UNAUTHORIZED', message: 'bad token' } }
        : {
            ok: true,
            identity: {
              subject: 'auth0|admin',
              email: 'admin@example.com',
              emailVerified: true,
            },
          }
    ),
    userServiceClient: {
      resolveAuthorization: vi
        .fn()
        .mockResolvedValue(options.authorizationResponse ?? approvedResponse('admin')),
      lookupUserIdentities: vi.fn().mockResolvedValue({ users: [] }),
    },
  });

  return { pricingRepository, usageEventRepository, usageAggregateRepository };
}

describe('llm-usage-service admin usage routes', () => {
  beforeEach(() => {
    configureAuthEnv();
  });

  afterEach(() => {
    delete process.env['FA_AUTH0_ISSUER'];
    delete process.env['FA_AUTH0_AUDIENCE'];
    delete process.env['FA_AUTH0_JWKS_URI'];
    resetServices();
  });

  it.each([
    ['POST', '/admin/aggregates/query'],
    ['POST', '/admin/events/query'],
    ['GET', '/admin/dimensions'],
    ['GET', '/admin/events/event-1'],
  ] as const)('requires a valid bearer token for %s %s', async (method, url) => {
    installServices();
    const app = await createServer();

    const response = await app.inject(
      method === 'POST'
        ? {
            method,
            url,
            payload: {
              timeRange: {
                from: '2026-06-14T00:00:00.000Z',
                to: '2026-06-15T00:00:00.000Z',
              },
            },
          }
        : { method, url }
    );

    expect(response.statusCode).toBe(401);
  });

  it('returns 401 when bearer token verification fails', async () => {
    installServices({ jwtOk: false });
    const app = await createServer();

    const response = await app.inject({
      method: 'POST',
      url: '/admin/aggregates/query',
      headers: { authorization: 'Bearer expired-token' },
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it.each([
    {
      method: 'POST' as const,
      url: '/admin/aggregates/query',
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
      },
    },
    {
      method: 'POST' as const,
      url: '/admin/events/query',
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
      },
    },
    {
      method: 'GET' as const,
      url: '/admin/events/event-1',
    },
    {
      method: 'GET' as const,
      url: '/admin/dimensions?from=2026-06-14T00%3A00%3A00.000Z&to=2026-06-15T00%3A00%3A00.000Z&timeBucket=day',
    },
  ])('rejects approved regular users for $method $url', async ({ method, payload, url }) => {
    installServices({ authorizationResponse: approvedResponse('user') });
    const app = await createServer();

    const response = await app.inject({
      method,
      url,
      headers: { authorization: 'Bearer test-token' },
      ...(payload === undefined ? {} : { payload }),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it.each([
    { state: 'profile_required', user: null, requiredFields: ['firstName'] },
    {
      state: 'pending',
      user: { ...approvedResponse('user').user, status: 'pending' },
    },
    {
      state: 'rejected',
      user: { ...approvedResponse('user').user, status: 'rejected' },
    },
    {
      state: 'suspended',
      user: { ...approvedResponse('user').user, status: 'suspended' },
    },
    approvedResponse('user'),
  ] as AuthorizationResolveResponse[])(
    'rejects non-admin state $state',
    async (authorizationResponse) => {
      installServices({ authorizationResponse });
      const app = await createServer();

      const response = await app.inject({
        method: 'POST',
        url: '/admin/aggregates/query',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          timeRange: {
            from: '2026-06-14T00:00:00.000Z',
            to: '2026-06-15T00:00:00.000Z',
          },
        },
      });

      expect(response.statusCode).toBe(403);
    }
  );

  it('allows approved admins to query aggregate usage for all users', async () => {
    installServices({
      aggregates: [
        aggregate(),
        aggregate({ id: 'other-user', owner: { type: 'user', id: 'user-456' } }),
      ],
    });
    const app = await createServer();

    const response = await app.inject({
      method: 'POST',
      url: '/admin/aggregates/query',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
        groupBy: ['owner.id'],
      },
    });

    const body = response.json<{
      ok: true;
      data: {
        rows: { group: { 'owner.id': string }; metrics: { calls: number } }[];
        totals: { calls: number };
      };
    }>();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.rows.map((row) => ({ group: row.group, calls: row.metrics.calls }))).toEqual([
      { group: { 'owner.id': 'user-123' }, calls: 2 },
      { group: { 'owner.id': 'user-456' }, calls: 2 },
    ]);
    expect(body.data.totals.calls).toBe(4);
  });

  it('returns no-charge failed chat error totals and raw error events to approved admins', async () => {
    const failedAggregate = failedChatAggregate();
    const failedEvent = failedChatEvent();
    installServices({
      aggregates: [failedAggregate],
      events: [failedEvent],
    });
    const app = await createServer();

    const aggregateResponse = await app.inject({
      method: 'POST',
      url: '/admin/aggregates/query',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
        filters: {
          services: ['chat-service'],
          operations: ['chat.stream'],
          promptTypes: ['fishing-answer'],
        },
      },
    });
    const eventsResponse = await app.inject({
      method: 'POST',
      url: '/admin/events/query',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
        filters: {
          services: ['chat-service'],
          operations: ['chat.stream'],
          promptTypes: ['fishing-answer'],
        },
      },
    });

    expect(aggregateResponse.statusCode).toBe(200);
    expect(aggregateResponse.json()).toMatchObject({
      ok: true,
      data: {
        totals: {
          calls: 1,
          estimatedCostUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCallCount: 1,
          errorCallCount: 1,
        },
      },
    });
    expect(eventsResponse.statusCode).toBe(200);
    expect(eventsResponse.json()).toEqual({
      ok: true,
      data: {
        events: [failedEvent],
      },
    });
  });

  it('accepts oversized positive aggregate limits and caps them in the domain response', async () => {
    installServices({ aggregates: [aggregate()] });
    const app = await createServer();

    const response = await app.inject({
      method: 'POST',
      url: '/admin/aggregates/query',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
        limit: 999,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: { meta: { limit: 500 } },
    });
  });

  it('allows approved admins to drill into bounded raw events without PII fields', async () => {
    const laterEvent = event({
      id: 'event-2',
      owner: { type: 'user', id: 'user-456' },
      createdAt: '2026-06-14T13:00:00.000Z',
    });
    installServices({ events: [event({ id: 'event-1' }), laterEvent] });
    const app = await createServer();

    const response = await app.inject({
      method: 'POST',
      url: '/admin/events/query',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
        filters: { userIds: ['user-456'] },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      data: {
        events: [laterEvent],
      },
    });
    expect(JSON.stringify(response.json())).not.toContain('admin@example.com');
    expect(JSON.stringify(response.json())).not.toContain('auth0|admin');
  });

  it('allows approved admins to fetch a single raw event by id without caller identity fields', async () => {
    const visibleEvent = event({ id: 'event-visible' });
    installServices({ events: [visibleEvent] });
    const app = await createServer();

    const response = await app.inject({
      method: 'GET',
      url: '/admin/events/event-visible',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, data: visibleEvent });
    expect(JSON.stringify(response.json())).not.toContain('admin@example.com');
    expect(JSON.stringify(response.json())).not.toContain('auth0|admin');
  });

  it('accepts oversized positive raw event limits and caps them in the domain response', async () => {
    const baseMs = Date.parse('2026-06-14T15:00:00.000Z');
    installServices({
      events: Array.from({ length: 250 }, (_item, index) =>
        event({
          id: `event-${String(index).padStart(3, '0')}`,
          createdAt: new Date(baseMs - index * 1000).toISOString(),
        })
      ),
    });
    const app = await createServer();

    const response = await app.inject({
      method: 'POST',
      url: '/admin/events/query',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
        limit: 999,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ ok: true; data: { events: LlmUsageEvent[] } }>().data.events
    ).toHaveLength(200);
  });

  it('rejects a raw event cursor when the normalized query shape changes', async () => {
    installServices({
      events: [
        event({ id: 'event-2', createdAt: '2026-06-14T13:00:00.000Z' }),
        event({ id: 'event-1', createdAt: '2026-06-14T12:00:00.000Z' }),
      ],
    });
    const app = await createServer();
    const payload = {
      timeRange: {
        from: '2026-06-14T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
      },
      limit: 1,
    };

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/admin/events/query',
      headers: { authorization: 'Bearer test-token' },
      payload,
    });
    const firstBody = firstResponse.json<{ ok: true; data: { nextCursor: string } }>();

    const mismatchResponse = await app.inject({
      method: 'POST',
      url: '/admin/events/query',
      headers: { authorization: 'Bearer test-token' },
      payload: { ...payload, limit: 2, cursor: firstBody.data.nextCursor },
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstBody.data.nextCursor).toEqual(expect.any(String));
    expect(mismatchResponse.statusCode).toBe(400);
  });

  it('returns 400 envelopes for domain-level admin query validation failures', async () => {
    installServices();
    const app = await createServer();

    const aggregateResponse = await app.inject({
      method: 'POST',
      url: '/admin/aggregates/query',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        timeRange: {
          from: '2026-06-15T00:00:00.000Z',
          to: '2026-06-14T00:00:00.000Z',
        },
      },
    });
    const eventsResponse = await app.inject({
      method: 'POST',
      url: '/admin/events/query',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
        filters: { promptVersions: ['1.0.0'] },
      },
    });

    expect(aggregateResponse.statusCode).toBe(400);
    expect(aggregateResponse.json()).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(eventsResponse.statusCode).toBe(400);
    expect(eventsResponse.json()).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
  });

  it('returns 404 for missing event ids after admin authorization', async () => {
    installServices({ events: [event()] });
    const app = await createServer();

    const response = await app.inject({
      method: 'GET',
      url: '/admin/events/missing-event',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('maps admin repository failures to internal error envelopes', async () => {
    const { usageAggregateRepository, usageEventRepository } = installServices({
      events: [event({ id: 'event-1' })],
    });
    usageAggregateRepository.listForAdmin = (query) => {
      void query;
      return Promise.resolve(err(new FaError('INTERNAL_ERROR', 'aggregate query failed')));
    };
    usageEventRepository.listForAdmin = (query) => {
      void query;
      return Promise.resolve(err(new FaError('INTERNAL_ERROR', 'event query failed')));
    };
    usageEventRepository.getById = (eventId) => {
      void eventId;
      return Promise.resolve(err(new FaError('INTERNAL_ERROR', 'event lookup failed')));
    };
    usageAggregateRepository.listDimensions = () =>
      Promise.resolve(err(new FaError('INTERNAL_ERROR', 'dimensions failed')));
    const app = await createServer();

    const aggregateResponse = await app.inject({
      method: 'POST',
      url: '/admin/aggregates/query',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
      },
    });
    const eventsResponse = await app.inject({
      method: 'POST',
      url: '/admin/events/query',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
      },
    });
    const eventResponse = await app.inject({
      method: 'GET',
      url: '/admin/events/event-1',
      headers: { authorization: 'Bearer test-token' },
    });
    const dimensionsResponse = await app.inject({
      method: 'GET',
      url: '/admin/dimensions?from=2026-06-14T00%3A00%3A00.000Z&to=2026-06-15T00%3A00%3A00.000Z&timeBucket=day',
      headers: { authorization: 'Bearer test-token' },
    });

    for (const response of [aggregateResponse, eventsResponse, eventResponse, dimensionsResponse]) {
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        ok: false,
        error: { code: 'INTERNAL_ERROR' },
      });
    }
  });

  it('returns distinct usage dimensions for admin filters', async () => {
    installServices({
      aggregates: [
        aggregate(),
        aggregate({
          id: 'embedding',
          source: {
            service: 'knowledge-service',
            component: 'query-embedding',
            operation: 'embedding',
            promptType: 'rag-query-embedding',
          },
          request: {
            provider: 'openai',
            model: 'text-embedding-3-large',
            promptVersion: '2.0.0',
          },
        }),
      ],
    });
    const app = await createServer();

    const response = await app.inject({
      method: 'GET',
      url: '/admin/dimensions?from=2026-06-14T00%3A00%3A00.000Z&to=2026-06-15T00%3A00%3A00.000Z&timeBucket=day',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      data: {
        models: ['google/gemini-3.5-flash', 'text-embedding-3-large'],
        providers: ['openai', 'openrouter'],
        components: ['query-embedding', 'rag-chat'],
        promptTypes: ['fishing-answer', 'rag-query-embedding'],
        services: ['chat-service', 'knowledge-service'],
        operations: ['chat.stream', 'embedding'],
      },
    });
  });
});
