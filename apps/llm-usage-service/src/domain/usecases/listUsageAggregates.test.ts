import { describe, expect, it } from 'vitest';

import { err, FaError } from '@fa/common-core';

import { FakeUsageAggregateRepository } from '../../__tests__/fakes/usageRepositories.js';
import type { LlmUsageDailyAggregate } from '../models/dailyAggregate.js';
import { queryUsageAggregates } from './listUsageAggregates.js';

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

describe('queryUsageAggregates', () => {
  it('groups aggregate metrics by day, hour, model, user, and prompt type', async () => {
    const repo = new FakeUsageAggregateRepository([
      aggregate({
        id: 'a',
        metrics: {
          calls: 2,
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          estimatedCostUsd: 0.25,
          estimatedCallCount: 1,
          errorCallCount: 0,
        },
      }),
      aggregate({
        id: 'b',
        owner: { type: 'user', id: 'user-456' },
        source: { ...aggregate().source, promptType: 'answer-repair' },
        request: { ...aggregate().request, model: 'anthropic/claude-sonnet-4' },
        metrics: {
          calls: 3,
          inputTokens: 200,
          outputTokens: 75,
          totalTokens: 275,
          estimatedCostUsd: 0.75,
          estimatedCallCount: 0,
          errorCallCount: 1,
        },
      }),
    ]);

    const response = await queryUsageAggregates(
      { usageAggregateRepository: repo },
      {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-14T23:59:59.999Z',
        },
        timeBucket: 'hour',
        groupBy: ['time.bucket', 'request.model', 'owner.id', 'source.promptType'],
      }
    );

    expect(response.rows).toEqual([
      {
        group: {
          'time.bucket': '2026-06-14T12',
          'owner.id': 'user-456',
          'request.model': 'anthropic/claude-sonnet-4',
          'source.promptType': 'answer-repair',
        },
        metrics: {
          calls: 3,
          inputTokens: 200,
          outputTokens: 75,
          totalTokens: 275,
          estimatedCostUsd: 0.75,
          estimatedCallCount: 0,
          errorCallCount: 1,
        },
      },
      {
        group: {
          'time.bucket': '2026-06-14T12',
          'owner.id': 'user-123',
          'request.model': 'google/gemini-3.5-flash',
          'source.promptType': 'fishing-answer',
        },
        metrics: {
          calls: 2,
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          estimatedCostUsd: 0.25,
          estimatedCallCount: 1,
          errorCallCount: 0,
        },
      },
    ]);
    expect(response.totals).toEqual({
      calls: 5,
      inputTokens: 300,
      outputTokens: 125,
      totalTokens: 425,
      estimatedCostUsd: 1,
      estimatedCallCount: 1,
      errorCallCount: 1,
    });
    expect(response.meta).toEqual({
      timeRange: {
        from: '2026-06-14T00:00:00.000Z',
        to: '2026-06-14T23:59:59.999Z',
      },
      timeBucket: 'hour',
      groupBy: ['time.bucket', 'request.model', 'owner.id', 'source.promptType'],
      limit: 100,
    });
  });

  it('applies combined filters across user, model, prompt type, service, and operation', async () => {
    const repo = new FakeUsageAggregateRepository([
      aggregate({ id: 'match' }),
      aggregate({ id: 'wrong-user', owner: { type: 'user', id: 'user-456' } }),
      aggregate({ id: 'wrong-model', request: { ...aggregate().request, model: 'other-model' } }),
      aggregate({
        id: 'wrong-prompt',
        source: { ...aggregate().source, promptType: 'answer-repair' },
      }),
      aggregate({
        id: 'wrong-operation',
        source: { ...aggregate().source, operation: 'chat.completion' },
      }),
    ]);

    await expect(
      queryUsageAggregates(
        { usageAggregateRepository: repo },
        {
          timeRange: {
            from: '2026-06-14T00:00:00.000Z',
            to: '2026-06-15T00:00:00.000Z',
          },
          filters: {
            userIds: ['user-123'],
            models: ['google/gemini-3.5-flash'],
            promptTypes: ['fishing-answer'],
            services: ['chat-service'],
            operations: ['chat.stream'],
          },
          groupBy: ['source.service', 'source.operation', 'source.promptType'],
        }
      )
    ).resolves.toMatchObject({
      rows: [
        {
          group: {
            'source.service': 'chat-service',
            'source.operation': 'chat.stream',
            'source.promptType': 'fishing-answer',
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
        },
      ],
      totals: {
        calls: 1,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        estimatedCostUsd: 0.00006,
        estimatedCallCount: 0,
        errorCallCount: 0,
      },
    });
  });

  it('filters provider, component, and prompt version then sorts ties by group key', async () => {
    const v2Request = { ...aggregate().request, provider: 'openrouter', promptVersion: '2.0.0' };
    const repo = new FakeUsageAggregateRepository([
      aggregate({
        id: 'component-b',
        source: { ...aggregate().source, component: 'component-b' },
        request: v2Request,
        metrics: {
          ...aggregate().metrics,
          calls: 2,
          estimatedCostUsd: 0.5,
        },
      }),
      aggregate({
        id: 'component-a',
        source: { ...aggregate().source, component: 'component-a' },
        request: v2Request,
        metrics: {
          ...aggregate().metrics,
          calls: 4,
          estimatedCostUsd: 0.5,
        },
      }),
      aggregate({
        id: 'component-c',
        source: { ...aggregate().source, component: 'component-c' },
        request: v2Request,
        metrics: {
          ...aggregate().metrics,
          calls: 1,
          estimatedCostUsd: 0.75,
        },
      }),
      aggregate({
        id: 'wrong-provider',
        source: { ...aggregate().source, component: 'component-a' },
        request: { ...v2Request, provider: 'openai' },
      }),
      aggregate({
        id: 'wrong-version',
        source: { ...aggregate().source, component: 'component-a' },
        request: { ...v2Request, promptVersion: '1.0.0' },
      }),
    ]);

    const response = await queryUsageAggregates(
      { usageAggregateRepository: repo },
      {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
        filters: {
          providers: ['openrouter'],
          components: ['component-a', 'component-b', 'component-c'],
          promptVersions: ['2.0.0'],
        },
        groupBy: ['source.component'],
        sortBy: { field: 'estimatedCostUsd', direction: 'asc' },
        limit: 2,
      }
    );

    expect(response.rows.map((row) => row.group)).toEqual([
      { 'source.component': 'component-a' },
      { 'source.component': 'component-b' },
    ]);
    expect(response.rows.map((row) => row.metrics.estimatedCostUsd)).toEqual([0.5, 0.5]);
    expect(response.totals.calls).toBe(7);
    expect(response.meta.limit).toBe(2);
  });

  it('rejects invalid aggregate query ranges and empty filter arrays', async () => {
    const repo = new FakeUsageAggregateRepository();

    await expect(
      queryUsageAggregates(
        { usageAggregateRepository: repo },
        {
          timeRange: {
            from: '2026-01-01T00:00:00.000Z',
            to: '2026-03-01T00:00:00.000Z',
          },
          timeBucket: 'hour',
        }
      )
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    await expect(
      queryUsageAggregates(
        { usageAggregateRepository: repo },
        {
          timeRange: {
            from: '2026-06-14T00:00:00.000Z',
            to: '2026-06-15T00:00:00.000Z',
          },
          filters: { models: [] },
        }
      )
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('throws repository errors from admin aggregate listing', async () => {
    const repo = new FakeUsageAggregateRepository();
    repo.listForAdmin = (query) => {
      void query;
      return Promise.resolve(err(new FaError('INTERNAL_ERROR', 'admin aggregate list failed')));
    };

    await expect(
      queryUsageAggregates(
        { usageAggregateRepository: repo },
        {
          timeRange: {
            from: '2026-06-14T00:00:00.000Z',
            to: '2026-06-15T00:00:00.000Z',
          },
        }
      )
    ).rejects.toThrow('admin aggregate list failed');
  });
});
