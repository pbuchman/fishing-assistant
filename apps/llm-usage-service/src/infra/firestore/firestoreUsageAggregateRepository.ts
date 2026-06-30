import { err, FaError, ok, type Result } from '@fa/common-core';
import { FieldValue, getFirestore, type Firestore } from '@fa/infra-firestore';

import type { UsageDimensionsResponse } from '../../domain/models/adminUsage.js';
import type {
  LlmUsageDailyAggregate,
  ListDailyUsageQuery,
} from '../../domain/models/dailyAggregate.js';
import {
  usageOperations,
  usagePromptTypes,
  usageServices,
  type LlmUsageEvent,
} from '../../domain/models/usageEvent.js';
import type {
  ListAdminUsageAggregatesQuery,
  UsageAggregateRepository,
} from '../../domain/repositories/usageAggregateRepository.js';
import { computeAggregateId, eventDay, eventHour } from './aggregateKey.js';
import {
  isoFromTimestamp,
  numberField,
  stringField,
  timestampFromIso,
} from './firestoreMapping.js';

export const USAGE_AGGREGATE_COLLECTION = 'llm_usage_daily_aggregates';
const RETIRED_TOP_LEVEL_FIELDS = new Set([
  'ownerType',
  'ownerId',
  'workspaceId',
  'system',
  'anonymous',
  'service',
  'component',
  'operation',
  'promptType',
  'provider',
  'model',
  'documentId',
  'conversationId',
  'messageId',
  'knowledgePageId',
  'chunkId',
  'requestId',
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'estimatedCostUsd',
]);

function firestoreError(error: unknown): FaError {
  const candidate = error as { code?: unknown; message?: unknown };
  return new FaError(
    'INTERNAL_ERROR',
    typeof candidate.message === 'string' ? candidate.message : 'Firestore operation failed',
    typeof candidate.code === 'number' || typeof candidate.code === 'string'
      ? { code: candidate.code }
      : undefined
  );
}

function roundCost(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}

function eventMetrics(event: LlmUsageEvent): LlmUsageDailyAggregate['metrics'] {
  return {
    calls: 1,
    estimatedCostUsd: event.cost.estimatedCostUsd,
    inputTokens: event.usage.inputTokens,
    outputTokens: event.usage.outputTokens,
    totalTokens: event.usage.totalTokens,
    estimatedCallCount: event.usage.estimated ? 1 : 0,
    errorCallCount: event.error === undefined ? 0 : 1,
  };
}

export function newAggregate(event: LlmUsageEvent): LlmUsageDailyAggregate {
  return {
    id: computeAggregateId(event),
    bucket: {
      day: eventDay(event),
      hour: eventHour(event),
    },
    owner: event.owner,
    source: event.source,
    request: event.request,
    metrics: eventMetrics(event),
    firstEventAt: event.createdAt,
    lastEventAt: event.createdAt,
    updatedAt: event.createdAt,
  };
}

export function aggregateToDoc(aggregate: LlmUsageDailyAggregate): Record<string, unknown> {
  return {
    ...aggregate,
    firstEventAt: timestampFromIso(aggregate.firstEventAt),
    lastEventAt: timestampFromIso(aggregate.lastEventAt),
    updatedAt: timestampFromIso(aggregate.updatedAt),
  };
}

export function aggregateIncrementDoc(event: LlmUsageEvent): Record<string, unknown> {
  return {
    'metrics.calls': FieldValue.increment(1),
    'metrics.inputTokens': FieldValue.increment(event.usage.inputTokens),
    'metrics.outputTokens': FieldValue.increment(event.usage.outputTokens),
    'metrics.totalTokens': FieldValue.increment(event.usage.totalTokens),
    'metrics.estimatedCostUsd': FieldValue.increment(roundCost(event.cost.estimatedCostUsd)),
    'metrics.estimatedCallCount': FieldValue.increment(event.usage.estimated ? 1 : 0),
    'metrics.errorCallCount': FieldValue.increment(event.error === undefined ? 0 : 1),
    lastEventAt: timestampFromIso(event.createdAt),
    updatedAt: timestampFromIso(event.createdAt),
  };
}

function recordField(data: Record<string, unknown>, fieldName: string): Record<string, unknown> {
  const value = data[fieldName];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function rejectRetiredTopLevelFields(data: Record<string, unknown>): void {
  for (const field of RETIRED_TOP_LEVEL_FIELDS) {
    if (data[field] !== undefined) {
      throw new Error(`retired top-level field ${field} is not accepted`);
    }
  }
}

function nonEmptyStringField(value: unknown, fieldName: string): string {
  const parsed = stringField(value, fieldName).trim();
  if (parsed.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return parsed;
}

function enumField<T extends string>(value: unknown, fieldName: string, allowed: readonly T[]): T {
  const parsed = nonEmptyStringField(value, fieldName);
  if (!allowed.includes(parsed as T)) {
    throw new Error(`${fieldName} is invalid`);
  }

  return parsed as T;
}

function nonNegativeSafeIntegerField(value: unknown, fieldName: string): number {
  const parsed = numberField(value, fieldName);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer`);
  }

  return parsed;
}

function nonNegativeFiniteNumberField(value: unknown, fieldName: string): number {
  const parsed = numberField(value, fieldName);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative finite number`);
  }

  return parsed;
}

function isInvalidOwnerId(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === 'anonymous' ||
    normalized === 'system' ||
    normalized.startsWith('anonymous-workspace') ||
    normalized.startsWith('workspace') ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ||
    /^\+[1-9]\d{7,14}$/.test(normalized) ||
    /^[a-z][a-z0-9_-]*\|.+$/i.test(normalized)
  );
}

function aggregateFromDoc(data: Record<string, unknown>): LlmUsageDailyAggregate {
  rejectRetiredTopLevelFields(data);

  const bucket = recordField(data, 'bucket');
  const owner = recordField(data, 'owner');
  const source = recordField(data, 'source');
  const request = recordField(data, 'request');
  const metrics = recordField(data, 'metrics');
  const ownerType = nonEmptyStringField(owner['type'], 'owner.type');
  if (ownerType !== 'user') {
    throw new Error('owner.type must be user');
  }
  const ownerId = nonEmptyStringField(owner['id'], 'owner.id');
  if (isInvalidOwnerId(ownerId)) {
    throw new Error('owner.id must be a real user id');
  }
  const inputTokens = nonNegativeSafeIntegerField(metrics['inputTokens'], 'metrics.inputTokens');
  const outputTokens = nonNegativeSafeIntegerField(metrics['outputTokens'], 'metrics.outputTokens');
  const totalTokens = nonNegativeSafeIntegerField(metrics['totalTokens'], 'metrics.totalTokens');
  if (totalTokens !== inputTokens + outputTokens) {
    throw new Error('metrics.totalTokens must equal metrics.inputTokens + metrics.outputTokens');
  }
  const calls = nonNegativeSafeIntegerField(metrics['calls'], 'metrics.calls');
  const estimatedCallCount = nonNegativeSafeIntegerField(
    metrics['estimatedCallCount'],
    'metrics.estimatedCallCount'
  );
  const errorCallCount = nonNegativeSafeIntegerField(
    metrics['errorCallCount'],
    'metrics.errorCallCount'
  );
  if (estimatedCallCount > calls || errorCallCount > calls) {
    throw new Error('metric call counters must not exceed metrics.calls');
  }

  return {
    id: nonEmptyStringField(data['id'], 'id'),
    bucket: {
      day: nonEmptyStringField(bucket['day'], 'bucket.day'),
      hour: nonEmptyStringField(bucket['hour'], 'bucket.hour'),
    },
    owner: {
      type: 'user',
      id: ownerId,
    },
    source: {
      service: enumField(source['service'], 'source.service', usageServices),
      component: nonEmptyStringField(source['component'], 'source.component'),
      operation: enumField(source['operation'], 'source.operation', usageOperations),
      promptType: enumField(source['promptType'], 'source.promptType', usagePromptTypes),
    },
    request: {
      provider: nonEmptyStringField(request['provider'], 'request.provider'),
      model: nonEmptyStringField(request['model'], 'request.model'),
      promptVersion: nonEmptyStringField(request['promptVersion'], 'request.promptVersion'),
    },
    metrics: {
      calls,
      estimatedCostUsd: nonNegativeFiniteNumberField(
        metrics['estimatedCostUsd'],
        'metrics.estimatedCostUsd'
      ),
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCallCount,
      errorCallCount,
    },
    firstEventAt: isoFromTimestamp(data['firstEventAt'], 'firstEventAt'),
    lastEventAt: isoFromTimestamp(data['lastEventAt'], 'lastEventAt'),
    updatedAt: isoFromTimestamp(data['updatedAt'], 'updatedAt'),
  };
}

export class FirestoreUsageAggregateRepository implements UsageAggregateRepository {
  constructor(private readonly firestore?: Firestore) {}

  private get db(): Firestore {
    return this.firestore ?? getFirestore();
  }

  async increment(event: LlmUsageEvent): Promise<Result<void, FaError>> {
    try {
      const aggregateId = computeAggregateId(event);
      const docRef = this.db.collection(USAGE_AGGREGATE_COLLECTION).doc(aggregateId);
      await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        if (snapshot.exists) {
          transaction.update(docRef, aggregateIncrementDoc(event));
          return;
        }

        transaction.set(docRef, aggregateToDoc(newAggregate(event)));
      });

      return ok(undefined);
    } catch (error) {
      return err(firestoreError(error));
    }
  }

  async list(query: ListDailyUsageQuery): Promise<Result<LlmUsageDailyAggregate[], FaError>> {
    try {
      const snapshot = await this.db
        .collection(USAGE_AGGREGATE_COLLECTION)
        .where('owner.id', '==', query.ownerId)
        .where('bucket.day', '>=', query.from)
        .where('bucket.day', '<=', query.to)
        .orderBy('bucket.day', 'asc')
        .get();

      return ok(
        snapshot.docs.flatMap((doc) => {
          try {
            return [aggregateFromDoc(doc.data())];
          } catch {
            return [];
          }
        })
      );
    } catch (error) {
      return err(firestoreError(error));
    }
  }

  async listForAdmin(
    query: ListAdminUsageAggregatesQuery
  ): Promise<Result<LlmUsageDailyAggregate[], FaError>> {
    try {
      const bucketField = query.timeBucket === 'hour' ? 'bucket.hour' : 'bucket.day';
      const snapshot = await this.db
        .collection(USAGE_AGGREGATE_COLLECTION)
        .where(bucketField, '>=', query.fromBucket)
        .where(bucketField, '<=', query.toBucket)
        .orderBy(bucketField, 'asc')
        .get();

      return ok(
        snapshot.docs.flatMap((doc) => {
          try {
            return [aggregateFromDoc(doc.data())];
          } catch {
            return [];
          }
        })
      );
    } catch (error) {
      return err(firestoreError(error));
    }
  }

  async listDimensions(
    query: ListAdminUsageAggregatesQuery
  ): Promise<Result<UsageDimensionsResponse, FaError>> {
    try {
      const bucketField = query.timeBucket === 'hour' ? 'bucket.hour' : 'bucket.day';
      const snapshot = await this.db
        .collection(USAGE_AGGREGATE_COLLECTION)
        .where(bucketField, '>=', query.fromBucket)
        .where(bucketField, '<=', query.toBucket)
        .orderBy(bucketField, 'asc')
        .get();
      const aggregates = snapshot.docs.flatMap((doc) => {
        try {
          return [aggregateFromDoc(doc.data())];
        } catch {
          return [];
        }
      });
      const sorted = <T extends string>(items: Iterable<T>): T[] => [...new Set(items)].sort();

      return ok({
        models: sorted(aggregates.map((aggregate) => aggregate.request.model)),
        providers: sorted(aggregates.map((aggregate) => aggregate.request.provider)),
        components: sorted(aggregates.map((aggregate) => aggregate.source.component)),
        promptTypes: sorted(aggregates.map((aggregate) => aggregate.source.promptType)),
        services: sorted(aggregates.map((aggregate) => aggregate.source.service)),
        operations: sorted(aggregates.map((aggregate) => aggregate.source.operation)),
      });
    } catch (error) {
      return err(firestoreError(error));
    }
  }
}
