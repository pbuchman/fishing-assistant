import type { Clock, Logger } from '@fa/common-core';

import type { UsageEventsResponse } from '../models/usageEvent.js';
import { parseUsageEventInput } from '../models/usageEvent.js';
import type { UsageAggregateRepository } from '../repositories/usageAggregateRepository.js';
import type { UsageEventRepository } from '../repositories/usageEventRepository.js';

export interface IngestUsageEventsDeps {
  usageEventRepository: UsageEventRepository;
  usageAggregateRepository: UsageAggregateRepository;
  clock: Clock;
  logger: Logger;
}

function rejectionId(value: unknown): string | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const id = (value as Record<string, unknown>)['id'];
    if (typeof id === 'string' && id.trim().length > 0) {
      return id;
    }
  }

  return null;
}

export async function ingestUsageEvents(
  deps: IngestUsageEventsDeps,
  inputs: readonly unknown[]
): Promise<UsageEventsResponse> {
  let accepted = 0;
  let duplicates = 0;
  const rejected: UsageEventsResponse['rejected'] = [];

  for (const [index, rawInput] of inputs.entries()) {
    const parsed = parseUsageEventInput(rawInput);
    if (!parsed.ok) {
      rejected.push({
        index,
        id: rejectionId(rawInput),
        code: parsed.error.code as UsageEventsResponse['rejected'][number]['code'],
        message: parsed.error.message,
      });
      continue;
    }

    const event = {
      ...parsed.value,
      createdAt: deps.clock.now().toISOString(),
    };

    const createResult = await deps.usageEventRepository.createWithAggregate(
      event,
      deps.usageAggregateRepository
    );
    if (!createResult.ok) {
      rejected.push({
        index,
        id: event.id,
        code: createResult.error.code as UsageEventsResponse['rejected'][number]['code'],
        message: createResult.error.message,
      });
      continue;
    }

    if (createResult.value.status === 'duplicate') {
      duplicates += 1;
      continue;
    }

    accepted += 1;
  }

  return { accepted, duplicates, rejected };
}
