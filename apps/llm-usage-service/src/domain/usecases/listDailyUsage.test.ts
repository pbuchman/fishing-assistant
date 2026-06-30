import { describe, expect, it } from 'vitest';

import { listDailyUsage } from './listDailyUsage.js';
import type { LlmUsageDailyAggregate } from '../models/dailyAggregate.js';
import { FakeUsageAggregateRepository } from '../../__tests__/fakes/usageRepositories.js';

function aggregate(overrides: Partial<LlmUsageDailyAggregate>): LlmUsageDailyAggregate {
  const base: LlmUsageDailyAggregate = {
    id: 'aggregate-1',
    bucket: { day: '2026-06-14', hour: '2026-06-14T12' },
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
    metrics: {
      calls: 1,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      estimatedCostUsd: 0.00006,
      estimatedCallCount: 0,
      errorCallCount: 0,
    },
    firstEventAt: '2026-06-14T12:00:00.000Z',
    lastEventAt: '2026-06-14T12:00:00.000Z',
    updatedAt: '2026-06-14T12:00:00.000Z',
  };
  return { ...base, ...overrides };
}

describe('listDailyUsage', () => {
  it('returns owner aggregates ordered by date ascending', async () => {
    const repo = new FakeUsageAggregateRepository([
      aggregate({ id: 'day-2', bucket: { day: '2026-06-15', hour: '2026-06-15T12' } }),
      aggregate({
        id: 'other-owner',
        owner: { type: 'user', id: 'other' },
        bucket: { day: '2026-06-14', hour: '2026-06-14T12' },
      }),
      aggregate({ id: 'day-1', bucket: { day: '2026-06-14', hour: '2026-06-14T12' } }),
    ]);

    await expect(
      listDailyUsage(
        { usageAggregateRepository: repo },
        { from: '2026-06-14', to: '2026-06-15', ownerId: 'user-123' }
      )
    ).resolves.toEqual([
      expect.objectContaining({ id: 'day-1' }),
      expect.objectContaining({ id: 'day-2' }),
    ]);
  });

  it('orders same-day aggregates by id for deterministic responses', async () => {
    const repo = new FakeUsageAggregateRepository([
      aggregate({ id: 'same-day-b', bucket: { day: '2026-06-14', hour: '2026-06-14T12' } }),
      aggregate({ id: 'same-day-a', bucket: { day: '2026-06-14', hour: '2026-06-14T12' } }),
    ]);

    await expect(
      listDailyUsage(
        { usageAggregateRepository: repo },
        { from: '2026-06-14', to: '2026-06-14', ownerId: 'user-123' }
      )
    ).resolves.toEqual([
      expect.objectContaining({ id: 'same-day-a' }),
      expect.objectContaining({ id: 'same-day-b' }),
    ]);
  });
});
