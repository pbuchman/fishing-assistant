import type { ListDailyUsageQuery, LlmUsageDailyAggregate } from '../models/dailyAggregate.js';
import type { UsageAggregateRepository } from '../repositories/usageAggregateRepository.js';

export interface ListDailyUsageDeps {
  usageAggregateRepository: UsageAggregateRepository;
}

export async function listDailyUsage(
  deps: ListDailyUsageDeps,
  query: ListDailyUsageQuery
): Promise<LlmUsageDailyAggregate[]> {
  const result = await deps.usageAggregateRepository.list(query);
  if (!result.ok) {
    throw result.error;
  }

  return [...result.value].sort((left, right) =>
    left.bucket.day === right.bucket.day
      ? left.id.localeCompare(right.id)
      : left.bucket.day.localeCompare(right.bucket.day)
  );
}
