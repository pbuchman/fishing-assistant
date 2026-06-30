import type { ListUsageEventsQuery, LlmUsageEvent } from '../models/usageEvent.js';
import type { UsageEventRepository } from '../repositories/usageEventRepository.js';

export interface ListUsageEventsDeps {
  usageEventRepository: UsageEventRepository;
}

export async function listUsageEvents(
  deps: ListUsageEventsDeps,
  query: ListUsageEventsQuery
): Promise<LlmUsageEvent[]> {
  const result = await deps.usageEventRepository.list(query);
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}
