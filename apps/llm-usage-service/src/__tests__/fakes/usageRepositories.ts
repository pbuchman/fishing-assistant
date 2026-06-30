import { FaError, ok, type Logger, type Result } from '@fa/common-core';

import type {
  UsageDimensionsResponse,
  NormalizedUsageEventsQuery,
  UsageTimeBucket,
} from '../../domain/models/adminUsage.js';
import { encodeUsageEventsCursor, eventMatchesAdminQuery } from '../../domain/models/adminUsage.js';
import type {
  LlmUsageDailyAggregate,
  ListDailyUsageQuery,
} from '../../domain/models/dailyAggregate.js';
import type { LlmPricing } from '../../domain/models/pricing.js';
import type { ListUsageEventsQuery, LlmUsageEvent } from '../../domain/models/usageEvent.js';
import type { PricingRepository } from '../../domain/repositories/pricingRepository.js';
import type { UsageAggregateRepository } from '../../domain/repositories/usageAggregateRepository.js';
import type {
  AdminUsageEventsPage,
  CreateUsageEventResult,
  UsageEventRepository,
} from '../../domain/repositories/usageEventRepository.js';

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function pricingKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

export class FakePricingRepository implements PricingRepository {
  readonly pricing = new Map<string, LlmPricing>();

  constructor(seed: readonly LlmPricing[] = []) {
    for (const item of seed) {
      this.pricing.set(pricingKey(item.provider, item.model), item);
    }
  }

  get(provider: string, model: string): Promise<LlmPricing | null> {
    return Promise.resolve(this.pricing.get(pricingKey(provider, model)) ?? null);
  }

  list(): Promise<LlmPricing[]> {
    return Promise.resolve([...this.pricing.values()]);
  }

  upsert(pricing: LlmPricing): Promise<void> {
    this.pricing.set(pricingKey(pricing.provider, pricing.model), pricing);
    return Promise.resolve();
  }
}

export class FakeUsageEventRepository implements UsageEventRepository {
  readonly events: LlmUsageEvent[];
  readonly duplicateIds = new Set<string>();

  constructor(seed: readonly LlmUsageEvent[] = []) {
    this.events = [...seed];
  }

  create(event: LlmUsageEvent): Promise<Result<CreateUsageEventResult, FaError>> {
    if (
      this.duplicateIds.has(event.id) ||
      this.events.some((existing) => existing.id === event.id)
    ) {
      return Promise.resolve(ok({ status: 'duplicate' }));
    }

    this.events.push(event);
    return Promise.resolve(ok({ status: 'created' }));
  }

  async createWithAggregate(
    event: LlmUsageEvent,
    aggregateRepository: UsageAggregateRepository
  ): Promise<Result<CreateUsageEventResult, FaError>> {
    if (
      this.duplicateIds.has(event.id) ||
      this.events.some((existing) => existing.id === event.id)
    ) {
      return ok({ status: 'duplicate' });
    }

    const aggregateResult = await aggregateRepository.increment(event);
    if (!aggregateResult.ok) {
      return aggregateResult;
    }

    this.events.push(event);
    return ok({ status: 'created' });
  }

  list(query: ListUsageEventsQuery): Promise<Result<LlmUsageEvent[], FaError>> {
    const events = this.events
      .filter((event) => event.owner.id === query.ownerId)
      .filter((event) => event.createdAt >= query.from && event.createdAt <= query.to)
      .filter((event) => query.service === undefined || event.source.service === query.service)
      .filter(
        (event) => query.operation === undefined || event.source.operation === query.operation
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, query.limit);

    return Promise.resolve(ok(events));
  }

  listForAdmin(query: NormalizedUsageEventsQuery): Promise<Result<AdminUsageEventsPage, FaError>> {
    const sorted = this.events
      .filter(
        (event) => event.createdAt >= query.timeRange.from && event.createdAt <= query.timeRange.to
      )
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
      );
    const cursorIndex =
      query.cursor === undefined
        ? -1
        : sorted.findIndex(
            (event) => event.createdAt === query.cursor?.createdAt && event.id === query.cursor.id
          );
    const remaining = sorted.slice(cursorIndex + 1);
    const events = remaining
      .filter((event) => eventMatchesAdminQuery(event, query))
      .slice(0, query.limit);
    const lastEvent = events.at(-1);
    const lastSortedIndex =
      lastEvent === undefined
        ? -1
        : remaining.findIndex(
            (event) => event.createdAt === lastEvent.createdAt && event.id === lastEvent.id
          );
    const hasMore =
      events.length >= query.limit &&
      lastSortedIndex >= 0 &&
      lastSortedIndex < remaining.length - 1;

    return Promise.resolve(
      ok({
        events,
        ...(hasMore && lastEvent !== undefined
          ? {
              nextCursor: encodeUsageEventsCursor(query, {
                createdAt: lastEvent.createdAt,
                id: lastEvent.id,
              }),
            }
          : {}),
      })
    );
  }

  getById(eventId: string): Promise<Result<LlmUsageEvent | null, FaError>> {
    return Promise.resolve(ok(this.events.find((event) => event.id === eventId) ?? null));
  }
}

export class FakeUsageAggregateRepository implements UsageAggregateRepository {
  readonly aggregates: LlmUsageDailyAggregate[];
  readonly increments: LlmUsageEvent[] = [];

  constructor(seed: readonly LlmUsageDailyAggregate[] = []) {
    this.aggregates = [...seed];
  }

  increment(event: LlmUsageEvent): Promise<Result<void, FaError>> {
    this.increments.push(event);
    return Promise.resolve(ok(undefined));
  }

  list(query: ListDailyUsageQuery): Promise<Result<LlmUsageDailyAggregate[], FaError>> {
    return Promise.resolve(
      ok(
        this.aggregates
          .filter((aggregate) => aggregate.owner.id === query.ownerId)
          .filter(
            (aggregate) => aggregate.bucket.day >= query.from && aggregate.bucket.day <= query.to
          )
      )
    );
  }

  listForAdmin(query: {
    timeBucket: UsageTimeBucket;
    fromBucket: string;
    toBucket: string;
  }): Promise<Result<LlmUsageDailyAggregate[], FaError>> {
    const bucket = query.timeBucket;
    return Promise.resolve(
      ok(
        this.aggregates.filter(
          (aggregate) =>
            aggregate.bucket[bucket] >= query.fromBucket &&
            aggregate.bucket[bucket] <= query.toBucket
        )
      )
    );
  }

  listDimensions(query: {
    timeBucket: UsageTimeBucket;
    fromBucket: string;
    toBucket: string;
  }): Promise<Result<UsageDimensionsResponse, FaError>> {
    const sorted = <T extends string>(items: Iterable<T>): T[] => [...new Set(items)].sort();
    const aggregates = this.aggregates.filter(
      (aggregate) =>
        aggregate.bucket[query.timeBucket] >= query.fromBucket &&
        aggregate.bucket[query.timeBucket] <= query.toBucket
    );
    return Promise.resolve(
      ok({
        models: sorted(aggregates.map((aggregate) => aggregate.request.model)),
        providers: sorted(aggregates.map((aggregate) => aggregate.request.provider)),
        components: sorted(aggregates.map((aggregate) => aggregate.source.component)),
        promptTypes: sorted(aggregates.map((aggregate) => aggregate.source.promptType)),
        services: sorted(aggregates.map((aggregate) => aggregate.source.service)),
        operations: sorted(aggregates.map((aggregate) => aggregate.source.operation)),
      })
    );
  }
}
