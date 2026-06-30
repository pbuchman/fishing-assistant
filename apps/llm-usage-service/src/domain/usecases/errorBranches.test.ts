import { describe, expect, it, vi } from 'vitest';

import { err, fixedClock, FaError, ok } from '@fa/common-core';

import {
  getAdminUsageEvent,
  listUsageDimensions,
  queryAdminUsageEvents,
} from './adminUsageEvents.js';
import { ingestUsageEvents } from './ingestUsageEvents.js';
import { listDailyUsage } from './listDailyUsage.js';
import { listUsageEvents } from './listUsageEvents.js';
import type { LlmUsageDailyAggregate } from '../models/dailyAggregate.js';
import type { LlmUsageEvent, UsageEventInput } from '../models/usageEvent.js';
import type { CreateUsageEventResult } from '../repositories/usageEventRepository.js';
import type { UsageAggregateRepository } from '../repositories/usageAggregateRepository.js';
import type { UsageEventRepository } from '../repositories/usageEventRepository.js';
import { silentLogger } from '../../__tests__/fakes/usageRepositories.js';

const input: UsageEventInput = {
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
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: false },
  cost: { estimatedCostUsd: 0.000002, source: 'provider-reported' },
  correlation: {},
};
const createdUsageEvent: CreateUsageEventResult = { status: 'created' };

const usageEventAdminMethods = {
  listForAdmin: vi.fn(() => Promise.resolve(ok({ events: [] }))),
  getById: vi.fn(() => Promise.resolve(ok(null))),
};

const usageAggregateAdminMethods = {
  listForAdmin: vi.fn(() => Promise.resolve(ok([]))),
  listDimensions: vi.fn(() =>
    Promise.resolve(
      ok({
        models: [],
        providers: [],
        components: [],
        promptTypes: [],
        services: [],
        operations: [],
      })
    )
  ),
};

describe('usage use case error branches', () => {
  it('rejects repository create failures and fallback event ids', async () => {
    const usageEventRepository: UsageEventRepository = {
      create: vi.fn(() => Promise.resolve(err(new FaError('INTERNAL_ERROR', 'create failed')))),
      createWithAggregate: vi.fn(() =>
        Promise.resolve(err(new FaError('INTERNAL_ERROR', 'create failed')))
      ),
      list: vi.fn(() => Promise.resolve(ok([]))),
      ...usageEventAdminMethods,
    };
    const usageAggregateRepository: UsageAggregateRepository = {
      increment: vi.fn(() => Promise.resolve(ok(undefined))),
      list: vi.fn(() => Promise.resolve(ok([]))),
      ...usageAggregateAdminMethods,
    };

    await expect(
      ingestUsageEvents(
        {
          usageEventRepository,
          usageAggregateRepository,
          clock: fixedClock(new Date('2026-06-14T00:00:00.000Z')),
          logger: silentLogger,
        },
        [input, { ...input, id: '' }]
      )
    ).resolves.toEqual({
      accepted: 0,
      duplicates: 0,
      rejected: [
        { index: 0, id: 'event-1', code: 'INTERNAL_ERROR', message: 'create failed' },
        { index: 1, id: null, code: 'INVALID_EVENT_ID', message: 'id must be a non-empty string' },
      ],
    });
  });

  it('rejects aggregate increment failures without accepting the event', async () => {
    const logger = { ...silentLogger, error: vi.fn() };
    const usageEventRepository: UsageEventRepository = {
      create: vi.fn(() => Promise.resolve(ok(createdUsageEvent))),
      createWithAggregate: vi.fn(
        async (event: LlmUsageEvent, aggregateRepository: UsageAggregateRepository) => {
          const aggregateResult = await aggregateRepository.increment(event);
          return aggregateResult.ok ? ok(createdUsageEvent) : aggregateResult;
        }
      ),
      list: vi.fn(() => Promise.resolve(ok([]))),
      ...usageEventAdminMethods,
    };
    const usageAggregateRepository: UsageAggregateRepository = {
      increment: vi.fn(() =>
        Promise.resolve(err(new FaError('INTERNAL_ERROR', 'aggregate failed')))
      ),
      list: vi.fn(() => Promise.resolve(ok([]))),
      ...usageAggregateAdminMethods,
    };

    await expect(
      ingestUsageEvents(
        {
          usageEventRepository,
          usageAggregateRepository,
          clock: fixedClock(new Date('2026-06-14T00:00:00.000Z')),
          logger,
        },
        [input]
      )
    ).resolves.toMatchObject({
      accepted: 0,
      rejected: [{ index: 0, id: 'event-1', code: 'INTERNAL_ERROR', message: 'aggregate failed' }],
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('throws repository list errors from query use cases', async () => {
    const usageEventRepository: UsageEventRepository = {
      create: vi.fn(() => Promise.resolve(ok(createdUsageEvent))),
      createWithAggregate: vi.fn(() => Promise.resolve(ok(createdUsageEvent))),
      list: vi.fn(() => Promise.resolve(err(new FaError('INTERNAL_ERROR', 'list failed')))),
      ...usageEventAdminMethods,
    };
    const usageAggregateRepository: UsageAggregateRepository = {
      increment: vi.fn(() => Promise.resolve(ok(undefined))),
      list: vi.fn(() => Promise.resolve(err(new FaError('INTERNAL_ERROR', 'daily failed')))),
      ...usageAggregateAdminMethods,
    };

    await expect(
      listUsageEvents(
        { usageEventRepository },
        {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
          ownerId: 'user-123',
          limit: 50,
        }
      )
    ).rejects.toThrow('list failed');
    await expect(
      listDailyUsage(
        { usageAggregateRepository },
        { from: '2026-06-14', to: '2026-06-15', ownerId: 'user-123' }
      )
    ).rejects.toThrow('daily failed');
  });

  it('throws admin usage event and dimension repository errors', async () => {
    const usageEventRepository: UsageEventRepository = {
      create: vi.fn(() => Promise.resolve(ok(createdUsageEvent))),
      createWithAggregate: vi.fn(() => Promise.resolve(ok(createdUsageEvent))),
      list: vi.fn(() => Promise.resolve(ok([]))),
      listForAdmin: vi.fn(() =>
        Promise.resolve(err(new FaError('INTERNAL_ERROR', 'admin event list failed')))
      ),
      getById: vi.fn(() =>
        Promise.resolve(err(new FaError('INTERNAL_ERROR', 'admin event get failed')))
      ),
    };
    const usageAggregateRepository: UsageAggregateRepository = {
      increment: vi.fn(() => Promise.resolve(ok(undefined))),
      list: vi.fn(() => Promise.resolve(ok([]))),
      listForAdmin: vi.fn(() => Promise.resolve(ok([]))),
      listDimensions: vi.fn(() =>
        Promise.resolve(err(new FaError('INTERNAL_ERROR', 'dimensions failed')))
      ),
    };

    await expect(
      queryAdminUsageEvents(
        { usageEventRepository },
        {
          timeRange: {
            from: '2026-06-14T00:00:00.000Z',
            to: '2026-06-15T00:00:00.000Z',
          },
        }
      )
    ).rejects.toThrow('admin event list failed');
    await expect(getAdminUsageEvent({ usageEventRepository }, 'event-1')).rejects.toThrow(
      'admin event get failed'
    );
    await expect(
      listUsageDimensions(
        { usageAggregateRepository },
        {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        }
      )
    ).rejects.toThrow('dimensions failed');
  });

  it('rejects invalid admin event queries before repository access', async () => {
    const usageEventRepository: UsageEventRepository = {
      create: vi.fn(() => Promise.resolve(ok(createdUsageEvent))),
      createWithAggregate: vi.fn(() => Promise.resolve(ok(createdUsageEvent))),
      list: vi.fn(() => Promise.resolve(ok([]))),
      ...usageEventAdminMethods,
    };

    await expect(
      queryAdminUsageEvents(
        { usageEventRepository },
        {
          timeRange: {
            from: '2026-06-14T00:00:00.000Z',
            to: '2026-06-15T00:00:00.000Z',
          },
          filters: { promptVersions: ['1.0.0'] },
        }
      )
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(usageEventAdminMethods.listForAdmin).not.toHaveBeenCalled();
  });
});

void ({} satisfies Partial<LlmUsageEvent>);
void ({} satisfies Partial<LlmUsageDailyAggregate>);
