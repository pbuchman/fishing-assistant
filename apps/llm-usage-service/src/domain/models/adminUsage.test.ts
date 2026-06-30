import { describe, expect, it } from 'vitest';

import type { LlmUsageEvent } from './usageEvent.js';
import {
  encodeUsageEventsCursor,
  eventMatchesAdminQuery,
  normalizeUsageAggregationQuery,
  normalizeUsageDimensionsQuery,
  normalizeUsageEventsQuery,
  usageEventsCursorQueryShape,
} from './adminUsage.js';

const range = {
  from: '2026-06-14T00:00:00.000Z',
  to: '2026-06-15T00:00:00.000Z',
};

function expectInvalid(
  result:
    | ReturnType<typeof normalizeUsageEventsQuery>
    | ReturnType<typeof normalizeUsageAggregationQuery>
    | ReturnType<typeof normalizeUsageDimensionsQuery>,
  message: string
) {
  expect(result).toMatchObject({
    ok: false,
    error: { code: 'INVALID_REQUEST', message },
  });
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
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimated: false },
    cost: { estimatedCostUsd: 0.00006 },
    correlation: {},
    createdAt: '2026-06-14T12:00:00.000Z',
  };
  return { ...base, ...overrides };
}

describe('admin usage query normalization', () => {
  it('normalizes aggregate filters, grouping, sort, and bounded limits', () => {
    const normalized = normalizeUsageAggregationQuery({
      timeRange: {
        from: '2026-06-14T02:00:00+02:00',
        to: '2026-06-15T00:00:00.000Z',
      },
      timeBucket: 'hour',
      filters: {
        userIds: [' user-123 '],
        providers: [' openrouter '],
        models: [' google/gemini-3.5-flash '],
        services: ['chat-service'],
        components: [' rag-chat '],
        operations: ['chat.stream'],
        promptTypes: ['fishing-answer'],
        promptVersions: [' 1.0.0 '],
      },
      groupBy: ['source.component', 'request.provider'],
      sortBy: { field: 'estimatedCostUsd', direction: 'asc' },
      limit: 25,
    });

    expect(normalized).toMatchObject({
      ok: true,
      value: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
        timeBucket: 'hour',
        filters: {
          userIds: ['user-123'],
          providers: ['openrouter'],
          models: ['google/gemini-3.5-flash'],
          services: ['chat-service'],
          components: ['rag-chat'],
          operations: ['chat.stream'],
          promptTypes: ['fishing-answer'],
          promptVersions: ['1.0.0'],
        },
        groupBy: ['source.component', 'request.provider'],
        sortBy: { field: 'estimatedCostUsd', direction: 'asc' },
        limit: 25,
      },
    });
  });

  it('caps oversized positive limits in domain normalization', () => {
    expect(
      normalizeUsageAggregationQuery({
        timeRange: range,
        limit: 999,
      })
    ).toMatchObject({
      ok: true,
      value: { limit: 500 },
    });

    expect(
      normalizeUsageEventsQuery({
        timeRange: range,
        limit: 999,
      })
    ).toMatchObject({
      ok: true,
      value: { limit: 200 },
    });
  });

  it.each(['2026-06-14', 'June 14 2026', '2026-06-14 00:00:00'])(
    'rejects non-RFC3339 date-time timestamp %s',
    (timestamp) => {
      expectInvalid(
        normalizeUsageEventsQuery({
          timeRange: { from: timestamp, to: range.to },
        }),
        'timeRange.from must be an ISO/RFC3339 date-time timestamp'
      );
      expect(
        normalizeUsageAggregationQuery({ timeRange: { from: timestamp, to: range.to } })
      ).toMatchObject({
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'timeRange.from must be an ISO/RFC3339 date-time timestamp',
        },
      });
    }
  );

  it.each(['2026-02-31T00:00:00.000Z', '2026-06-14T24:00:00.000Z'])(
    'rejects rollover ISO/RFC3339 date-time timestamp %s',
    (timestamp) => {
      expectInvalid(
        normalizeUsageEventsQuery({
          timeRange: { from: timestamp, to: range.to },
        }),
        'timeRange.from must be an ISO/RFC3339 date-time timestamp'
      );
      expect(
        normalizeUsageAggregationQuery({ timeRange: { from: timestamp, to: range.to } })
      ).toMatchObject({
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'timeRange.from must be an ISO/RFC3339 date-time timestamp',
        },
      });
    }
  );

  it('rejects malformed aggregate query shapes and unsupported enum values', () => {
    expectInvalid(normalizeUsageAggregationQuery(null), 'query must be an object');
    expectInvalid(
      normalizeUsageAggregationQuery({
        timeRange: range,
        timeBucket: 'minute',
      }),
      'timeBucket must be one of: day, hour'
    );
    expectInvalid(
      normalizeUsageAggregationQuery({
        timeRange: { from: range.to, to: range.from },
      }),
      'timeRange.from must be before or equal to timeRange.to'
    );
    expectInvalid(
      normalizeUsageAggregationQuery({
        timeRange: {
          from: '2026-01-01T00:00:00.000Z',
          to: '2027-01-03T00:00:00.000Z',
        },
      }),
      'timeRange exceeds the maximum allowed range'
    );
    expectInvalid(
      normalizeUsageAggregationQuery({
        timeRange: range,
        filters: { services: ['retired-service'] },
      }),
      'filters.services contains an unsupported value'
    );
    expectInvalid(
      normalizeUsageAggregationQuery({
        timeRange: range,
        groupBy: [],
      }),
      'groupBy must be a non-empty array'
    );
    expectInvalid(
      normalizeUsageAggregationQuery({
        timeRange: range,
        sortBy: 'calls',
      }),
      'sortBy must be an object'
    );
    expectInvalid(
      normalizeUsageAggregationQuery({
        timeRange: range,
        sortBy: { field: 'latencyMs' },
      }),
      'sortBy.field contains an unsupported value'
    );
    expectInvalid(
      normalizeUsageAggregationQuery({
        timeRange: range,
        sortBy: { direction: 'sideways' },
      }),
      'sortBy.direction must be asc or desc'
    );
    expectInvalid(
      normalizeUsageAggregationQuery({
        timeRange: range,
        limit: 0,
      }),
      'limit must be a positive safe integer'
    );
  });

  it('normalizes bounded dimensions and raw event component filters', () => {
    expect(normalizeUsageDimensionsQuery({ ...range, timeBucket: 'hour' })).toMatchObject({
      ok: true,
      value: {
        timeRange: range,
        timeBucket: 'hour',
      },
    });

    expect(
      normalizeUsageEventsQuery({ timeRange: range, filters: { components: ['rag-chat'] } })
    ).toMatchObject({
      ok: true,
      value: { filters: { components: ['rag-chat'] } },
    });
  });

  it('rejects aggregate-only prompt-version filters for raw event queries', () => {
    expectInvalid(
      normalizeUsageEventsQuery({
        timeRange: range,
        filters: { promptVersions: ['1.0.0'] },
      }),
      'filters.promptVersions is not supported for raw event queries'
    );
  });

  it('normalizes raw event cursors against sorted filter shapes', () => {
    const queryShape = usageEventsCursorQueryShape({
      timeRange: range,
      filters: {
        userIds: ['user-b', 'user-a'],
        providers: ['openrouter'],
        models: ['model-b', 'model-a'],
        services: ['knowledge-service', 'chat-service'],
        operations: ['embedding', 'chat.stream'],
        promptTypes: ['rag-query-embedding', 'fishing-answer'],
      },
      limit: 2,
    });
    const cursor = encodeUsageEventsCursor(queryShape, {
      createdAt: '2026-06-14T12:00:00.000Z',
      id: 'event-cursor',
    });

    const normalized = normalizeUsageEventsQuery({
      timeRange: range,
      filters: {
        userIds: ['user-a', 'user-b'],
        providers: ['openrouter'],
        models: ['model-a', 'model-b'],
        services: ['chat-service', 'knowledge-service'],
        operations: ['chat.stream', 'embedding'],
        promptTypes: ['fishing-answer', 'rag-query-embedding'],
      },
      limit: 2,
      cursor,
    });

    expect(normalized).toMatchObject({
      ok: true,
      value: {
        filters: {
          userIds: ['user-a', 'user-b'],
          models: ['model-a', 'model-b'],
          services: ['chat-service', 'knowledge-service'],
          operations: ['chat.stream', 'embedding'],
          promptTypes: ['fishing-answer', 'rag-query-embedding'],
        },
        cursor: {
          createdAt: '2026-06-14T12:00:00.000Z',
          id: 'event-cursor',
        },
      },
    });
  });

  it('rejects malformed raw event cursors and unsupported event filters', () => {
    expectInvalid(normalizeUsageEventsQuery('not-an-object'), 'query must be an object');
    expectInvalid(
      normalizeUsageEventsQuery({
        timeRange: range,
        filters: { operations: ['retired-operation'] },
      }),
      'filters.operations contains an unsupported value'
    );
    expectInvalid(
      normalizeUsageEventsQuery({
        timeRange: range,
        limit: 0,
      }),
      'limit must be a positive safe integer'
    );
    expectInvalid(
      normalizeUsageEventsQuery({
        timeRange: range,
        cursor: Buffer.from(JSON.stringify({ nope: true }), 'utf8').toString('base64url'),
      }),
      'cursor is invalid'
    );
    expectInvalid(
      normalizeUsageEventsQuery({
        timeRange: range,
        cursor: '',
      }),
      'cursor must be a non-empty string'
    );
    expectInvalid(
      normalizeUsageEventsQuery({
        timeRange: range,
        cursor: Buffer.from(JSON.stringify({ query: {}, position: {} }), 'utf8').toString(
          'base64url'
        ),
      }),
      'cursor is invalid'
    );
    expectInvalid(
      normalizeUsageEventsQuery({
        timeRange: range,
        cursor: Buffer.from(
          JSON.stringify({
            query: { timeRange: range, filters: {}, limit: 50 },
            position: { createdAt: '2026-06-14T12:00:00.000Z', id: '   ' },
          }),
          'utf8'
        ).toString('base64url'),
      }),
      'cursor is invalid'
    );
    expectInvalid(
      normalizeUsageEventsQuery({
        timeRange: range,
        cursor: Buffer.from('not json', 'utf8').toString('base64url'),
      }),
      'cursor is invalid'
    );
    expectInvalid(
      normalizeUsageEventsQuery({
        timeRange: range,
        limit: 1,
        cursor: encodeUsageEventsCursor(
          { timeRange: range, filters: {}, limit: 2 },
          { createdAt: '2026-06-14T12:00:00.000Z', id: 'event-cursor' }
        ),
      }),
      'cursor does not match the query'
    );
  });

  it('matches admin raw events across every supported current-schema filter', () => {
    const query = normalizeUsageEventsQuery({
      timeRange: range,
      filters: {
        userIds: ['user-123'],
        providers: ['openrouter'],
        models: ['google/gemini-3.5-flash'],
        services: ['chat-service'],
        components: ['rag-chat'],
        operations: ['chat.stream'],
        promptTypes: ['fishing-answer'],
      },
    });
    if (!query.ok) {
      throw query.error;
    }

    expect(eventMatchesAdminQuery(event(), query.value)).toBe(true);
    expect(
      eventMatchesAdminQuery(
        event({ source: { ...event().source, promptType: 'answer-repair' } }),
        query.value
      )
    ).toBe(false);
  });
});
