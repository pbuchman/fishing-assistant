import {
  bucketRange,
  normalizeUsageDimensionsQuery,
  normalizeUsageEventsQuery,
  type UsageDimensionsResponse,
  type UsageEventsResponse,
} from '../models/adminUsage.js';
import type { LlmUsageEvent } from '../models/usageEvent.js';
import type { UsageAggregateRepository } from '../repositories/usageAggregateRepository.js';
import type { UsageEventRepository } from '../repositories/usageEventRepository.js';

export interface QueryAdminUsageEventsDeps {
  usageEventRepository: UsageEventRepository;
}

export interface GetAdminUsageEventDeps {
  usageEventRepository: UsageEventRepository;
}

export interface ListUsageDimensionsDeps {
  usageAggregateRepository: UsageAggregateRepository;
}

export async function queryAdminUsageEvents(
  deps: QueryAdminUsageEventsDeps,
  input: unknown
): Promise<UsageEventsResponse> {
  const query = normalizeUsageEventsQuery(input);
  if (!query.ok) {
    throw query.error;
  }

  const result = await deps.usageEventRepository.listForAdmin(query.value);
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

export async function getAdminUsageEvent(
  deps: GetAdminUsageEventDeps,
  eventId: string
): Promise<LlmUsageEvent | null> {
  const result = await deps.usageEventRepository.getById(eventId);
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

export async function listUsageDimensions(
  deps: ListUsageDimensionsDeps,
  input: unknown
): Promise<UsageDimensionsResponse> {
  const query = normalizeUsageDimensionsQuery(input);
  if (!query.ok) {
    throw query.error;
  }

  const range = bucketRange(query.value);
  const result = await deps.usageAggregateRepository.listDimensions({
    timeBucket: query.value.timeBucket,
    fromBucket: range.fromBucket,
    toBucket: range.toBucket,
  });
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}
