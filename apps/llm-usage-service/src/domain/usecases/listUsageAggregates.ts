import type { LlmUsageDailyAggregate, UsageMetrics } from '../models/dailyAggregate.js';
import {
  bucketRange,
  normalizeUsageAggregationQuery,
  zeroUsageMetrics,
  type NormalizedUsageAggregationQuery,
  type UsageAggregationResponse,
  type UsageAggregationRow,
  type UsageGroupBy,
} from '../models/adminUsage.js';
import type { UsageAggregateRepository } from '../repositories/usageAggregateRepository.js';

export interface QueryUsageAggregatesDeps {
  usageAggregateRepository: UsageAggregateRepository;
}

function addMetrics(left: UsageMetrics, right: UsageMetrics): UsageMetrics {
  return {
    calls: left.calls + right.calls,
    estimatedCostUsd:
      Math.round((left.estimatedCostUsd + right.estimatedCostUsd) * 100_000_000) / 100_000_000,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    estimatedCallCount: left.estimatedCallCount + right.estimatedCallCount,
    errorCallCount: left.errorCallCount + right.errorCallCount,
  };
}

function includes<T extends string>(values: readonly T[] | undefined, value: T): boolean {
  return values === undefined || values.includes(value);
}

function aggregateMatches(
  aggregate: LlmUsageDailyAggregate,
  query: NormalizedUsageAggregationQuery
): boolean {
  const filters = query.filters;
  return (
    includes(filters.userIds, aggregate.owner.id) &&
    includes(filters.providers, aggregate.request.provider) &&
    includes(filters.models, aggregate.request.model) &&
    includes(filters.services, aggregate.source.service) &&
    includes(filters.components, aggregate.source.component) &&
    includes(filters.operations, aggregate.source.operation) &&
    includes(filters.promptTypes, aggregate.source.promptType) &&
    includes(filters.promptVersions, aggregate.request.promptVersion)
  );
}

function groupValue(
  aggregate: LlmUsageDailyAggregate,
  groupBy: UsageGroupBy,
  bucket: 'day' | 'hour'
): string {
  switch (groupBy) {
    case 'time.bucket':
      return bucket === 'hour' ? aggregate.bucket.hour : aggregate.bucket.day;
    case 'owner.id':
      return aggregate.owner.id;
    case 'request.provider':
      return aggregate.request.provider;
    case 'request.model':
      return aggregate.request.model;
    case 'source.service':
      return aggregate.source.service;
    case 'source.component':
      return aggregate.source.component;
    case 'source.operation':
      return aggregate.source.operation;
    case 'source.promptType':
      return aggregate.source.promptType;
  }
}

function buildGroup(
  aggregate: LlmUsageDailyAggregate,
  query: NormalizedUsageAggregationQuery
): Partial<Record<UsageGroupBy, string>> {
  return Object.fromEntries(
    query.groupBy.map((groupBy) => [groupBy, groupValue(aggregate, groupBy, query.timeBucket)])
  );
}

function groupKey(group: Partial<Record<UsageGroupBy, string>>): string {
  return JSON.stringify(Object.entries(group).sort(([left], [right]) => left.localeCompare(right)));
}

function compareRows(
  left: UsageAggregationRow,
  right: UsageAggregationRow,
  query: NormalizedUsageAggregationQuery
): number {
  const metricCompare = left.metrics[query.sortBy.field] - right.metrics[query.sortBy.field];
  if (metricCompare !== 0) {
    return query.sortBy.direction === 'asc' ? metricCompare : -metricCompare;
  }

  return groupKey(left.group).localeCompare(groupKey(right.group));
}

export async function queryUsageAggregates(
  deps: QueryUsageAggregatesDeps,
  input: unknown
): Promise<UsageAggregationResponse> {
  const query = normalizeUsageAggregationQuery(input);
  if (!query.ok) {
    throw query.error;
  }

  const range = bucketRange(query.value);
  const listed = await deps.usageAggregateRepository.listForAdmin({
    timeBucket: query.value.timeBucket,
    fromBucket: range.fromBucket,
    toBucket: range.toBucket,
  });
  if (!listed.ok) {
    throw listed.error;
  }

  const rows = new Map<string, UsageAggregationRow>();
  let totals: UsageMetrics = { ...zeroUsageMetrics };
  for (const aggregate of listed.value.filter((item) => aggregateMatches(item, query.value))) {
    totals = addMetrics(totals, aggregate.metrics);
    const group = buildGroup(aggregate, query.value);
    const key = groupKey(group);
    const existing = rows.get(key);
    rows.set(key, {
      group,
      metrics:
        existing === undefined
          ? { ...aggregate.metrics }
          : addMetrics(existing.metrics, aggregate.metrics),
    });
  }

  return {
    rows: [...rows.values()]
      .sort((left, right) => compareRows(left, right, query.value))
      .slice(0, query.value.limit),
    totals,
    meta: {
      timeRange: query.value.timeRange,
      timeBucket: query.value.timeBucket,
      groupBy: query.value.groupBy,
      limit: query.value.limit,
    },
  };
}
