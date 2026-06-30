import type { FaError, Result } from '@fa/common-core';

import type { UsageDimensionsResponse, UsageTimeBucket } from '../models/adminUsage.js';
import type { LlmUsageDailyAggregate, ListDailyUsageQuery } from '../models/dailyAggregate.js';
import type { LlmUsageEvent } from '../models/usageEvent.js';

export interface ListAdminUsageAggregatesQuery {
  timeBucket: UsageTimeBucket;
  fromBucket: string;
  toBucket: string;
}

export interface UsageAggregateRepository {
  increment(event: LlmUsageEvent): Promise<Result<void, FaError>>;
  list(query: ListDailyUsageQuery): Promise<Result<LlmUsageDailyAggregate[], FaError>>;
  listForAdmin(
    query: ListAdminUsageAggregatesQuery
  ): Promise<Result<LlmUsageDailyAggregate[], FaError>>;
  listDimensions(
    query: ListAdminUsageAggregatesQuery
  ): Promise<Result<UsageDimensionsResponse, FaError>>;
}
