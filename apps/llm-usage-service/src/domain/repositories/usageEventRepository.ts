import type { FaError, Result } from '@fa/common-core';

import type { NormalizedUsageEventsQuery } from '../models/adminUsage.js';
import type { ListUsageEventsQuery, LlmUsageEvent } from '../models/usageEvent.js';
import type { UsageAggregateRepository } from './usageAggregateRepository.js';

export type CreateUsageEventResult = { status: 'created' } | { status: 'duplicate' };
export interface AdminUsageEventsPage {
  events: LlmUsageEvent[];
  nextCursor?: string;
}

export interface UsageEventRepository {
  create(event: LlmUsageEvent): Promise<Result<CreateUsageEventResult, FaError>>;
  createWithAggregate(
    event: LlmUsageEvent,
    aggregateRepository: UsageAggregateRepository
  ): Promise<Result<CreateUsageEventResult, FaError>>;
  list(query: ListUsageEventsQuery): Promise<Result<LlmUsageEvent[], FaError>>;
  listForAdmin(query: NormalizedUsageEventsQuery): Promise<Result<AdminUsageEventsPage, FaError>>;
  getById(eventId: string): Promise<Result<LlmUsageEvent | null, FaError>>;
}
