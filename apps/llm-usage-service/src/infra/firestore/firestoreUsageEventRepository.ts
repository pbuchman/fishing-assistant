import { err, FaError, ok, type Result } from '@fa/common-core';
import { getFirestore, type Firestore, type Query } from '@fa/infra-firestore';

import {
  encodeUsageEventsCursor,
  eventMatchesAdminQuery,
  type NormalizedUsageEventsQuery,
  type UsageEventsCursorPosition,
} from '../../domain/models/adminUsage.js';
import {
  usageOperations,
  usagePromptTypes,
  usageServices,
  type ListUsageEventsQuery,
  type LlmUsageEvent,
} from '../../domain/models/usageEvent.js';
import type {
  AdminUsageEventsPage,
  CreateUsageEventResult,
  UsageEventRepository,
} from '../../domain/repositories/usageEventRepository.js';
import type { UsageAggregateRepository } from '../../domain/repositories/usageAggregateRepository.js';
import { computeAggregateId } from './aggregateKey.js';
import {
  aggregateIncrementDoc,
  aggregateToDoc,
  newAggregate,
  USAGE_AGGREGATE_COLLECTION,
} from './firestoreUsageAggregateRepository.js';
import {
  isoFromTimestamp,
  numberField,
  stringField,
  timestampFromIso,
} from './firestoreMapping.js';

const COLLECTION = 'llm_usage_events';
const RAW_EVENT_SCAN_LIMIT = 2_000;
const RAW_EVENT_PAGE_SIZE = 200;
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

function eventToDoc(event: LlmUsageEvent): Record<string, unknown> {
  return {
    ...event,
    createdAt: timestampFromIso(event.createdAt),
  };
}

function recordField(data: Record<string, unknown>, fieldName: string): Record<string, unknown> {
  const value = data[fieldName];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function optionalStringField(data: Record<string, unknown>, fieldName: string): string | undefined {
  const value = data[fieldName];
  if (value === undefined) {
    return undefined;
  }

  return nonEmptyStringField(value, fieldName);
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

function costSourceField(value: unknown): LlmUsageEvent['cost']['source'] {
  return value === 'provider-reported' || value === 'provider-estimated'
    ? value
    : 'provider-estimated';
}

function rejectRetiredTopLevelFields(data: Record<string, unknown>): void {
  for (const field of RETIRED_TOP_LEVEL_FIELDS) {
    if (data[field] !== undefined) {
      throw new Error(`retired top-level field ${field} is not accepted`);
    }
  }
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

function correlationFromDoc(data: Record<string, unknown>): LlmUsageEvent['correlation'] {
  if (
    data['workspaceId'] !== undefined ||
    data['documentId'] !== undefined ||
    data['ownerId'] !== undefined ||
    data['ownerType'] !== undefined
  ) {
    throw new Error('retired correlation fields are not accepted');
  }

  const output: LlmUsageEvent['correlation'] = {};
  const conversationId = optionalStringField(data, 'conversationId');
  const messageId = optionalStringField(data, 'messageId');
  const knowledgePageId = optionalStringField(data, 'knowledgePageId');
  const chunkId = optionalStringField(data, 'chunkId');
  const requestId = optionalStringField(data, 'requestId');

  if (conversationId !== undefined) {
    output.conversationId = conversationId;
  }
  if (messageId !== undefined) {
    output.messageId = messageId;
  }
  if (knowledgePageId !== undefined) {
    output.knowledgePageId = knowledgePageId;
  }
  if (chunkId !== undefined) {
    output.chunkId = chunkId;
  }
  if (requestId !== undefined) {
    output.requestId = requestId;
  }

  return output;
}

function eventFromDoc(data: Record<string, unknown>): LlmUsageEvent {
  rejectRetiredTopLevelFields(data);

  const owner = recordField(data, 'owner');
  if (owner['type'] !== 'user') {
    throw new Error('owner.type must be user');
  }
  const ownerId = nonEmptyStringField(owner['id'], 'owner.id');
  if (isInvalidOwnerId(ownerId)) {
    throw new Error('owner.id must be a real user id');
  }

  const source = recordField(data, 'source');
  const request = recordField(data, 'request');
  const usage = recordField(data, 'usage');
  const cost = recordField(data, 'cost');
  const costSource = costSourceField(cost['source']);
  const correlation = recordField(data, 'correlation');
  const error = data['error'] === undefined ? undefined : recordField(data, 'error');

  return {
    id: nonEmptyStringField(data['id'], 'id'),
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
    usage: {
      inputTokens: nonNegativeSafeIntegerField(usage['inputTokens'], 'usage.inputTokens'),
      outputTokens: nonNegativeSafeIntegerField(usage['outputTokens'], 'usage.outputTokens'),
      totalTokens: nonNegativeSafeIntegerField(usage['totalTokens'], 'usage.totalTokens'),
      estimated: usage['estimated'] === true,
    },
    cost: {
      estimatedCostUsd: nonNegativeFiniteNumberField(
        cost['estimatedCostUsd'],
        'cost.estimatedCostUsd'
      ),
      ...(costSource !== undefined ? { source: costSource } : {}),
    },
    correlation: correlationFromDoc(correlation),
    ...(error !== undefined
      ? {
          error: {
            code: nonEmptyStringField(error['code'], 'error.code'),
            message: nonEmptyStringField(error['message'], 'error.message'),
          },
        }
      : {}),
    createdAt: isoFromTimestamp(data['createdAt'], 'createdAt'),
  };
}

function validatedEventFromDoc(data: Record<string, unknown>): LlmUsageEvent {
  const event = eventFromDoc(data);
  if (event.usage.totalTokens !== event.usage.inputTokens + event.usage.outputTokens) {
    throw new Error('usage.totalTokens must equal usage.inputTokens + usage.outputTokens');
  }

  return event;
}

function cursorPositionFromDoc(
  id: string,
  data: Record<string, unknown>
): UsageEventsCursorPosition {
  return {
    id,
    createdAt: isoFromTimestamp(data['createdAt'], 'createdAt'),
  };
}

export class FirestoreUsageEventRepository implements UsageEventRepository {
  constructor(private readonly firestore?: Firestore) {}

  private get db(): Firestore {
    return this.firestore ?? getFirestore();
  }

  async create(event: LlmUsageEvent): Promise<Result<CreateUsageEventResult, FaError>> {
    try {
      await this.db.collection(COLLECTION).doc(event.id).create(eventToDoc(event));
      return ok({ status: 'created' });
    } catch (error) {
      const candidate = error as { code?: unknown };
      if (candidate.code === 6 || candidate.code === 'already-exists') {
        return ok({ status: 'duplicate' });
      }

      return err(firestoreError(error));
    }
  }

  async createWithAggregate(
    event: LlmUsageEvent,
    _aggregateRepository: UsageAggregateRepository
  ): Promise<Result<CreateUsageEventResult, FaError>> {
    try {
      const eventRef = this.db.collection(COLLECTION).doc(event.id);
      const aggregateRef = this.db
        .collection(USAGE_AGGREGATE_COLLECTION)
        .doc(computeAggregateId(event));

      const result = await this.db.runTransaction(async (transaction) => {
        const eventSnapshot = await transaction.get(eventRef);
        if (eventSnapshot.exists) {
          return { status: 'duplicate' } as const;
        }

        const aggregateSnapshot = await transaction.get(aggregateRef);
        if (aggregateSnapshot.exists) {
          transaction.update(aggregateRef, aggregateIncrementDoc(event));
        } else {
          transaction.set(aggregateRef, aggregateToDoc(newAggregate(event)));
        }

        transaction.set(eventRef, eventToDoc(event));
        return { status: 'created' } as const;
      });

      return ok(result);
    } catch (error) {
      return err(firestoreError(error));
    }
  }

  async list(query: ListUsageEventsQuery): Promise<Result<LlmUsageEvent[], FaError>> {
    try {
      const firestoreQuery: Query = this.db
        .collection(COLLECTION)
        .where('createdAt', '>=', timestampFromIso(query.from))
        .where('createdAt', '<=', timestampFromIso(query.to));

      const snapshot = await firestoreQuery
        .orderBy('createdAt', 'desc')
        .limit(RAW_EVENT_SCAN_LIMIT)
        .get();

      return ok(
        snapshot.docs
          .flatMap((doc) => {
            try {
              return [eventFromDoc(doc.data())];
            } catch {
              return [];
            }
          })
          .filter((event) => event.owner.id === query.ownerId)
          .filter((event) => query.service === undefined || event.source.service === query.service)
          .filter(
            (event) => query.operation === undefined || event.source.operation === query.operation
          )
          .slice(0, query.limit)
      );
    } catch (error) {
      return err(firestoreError(error));
    }
  }

  async listForAdmin(
    query: NormalizedUsageEventsQuery
  ): Promise<Result<AdminUsageEventsPage, FaError>> {
    try {
      const baseQuery: Query = this.db
        .collection(COLLECTION)
        .where('createdAt', '>=', timestampFromIso(query.timeRange.from))
        .where('createdAt', '<=', timestampFromIso(query.timeRange.to))
        .orderBy('createdAt', 'desc')
        .orderBy('__name__', 'desc');
      const events: LlmUsageEvent[] = [];
      let pageCursor = query.cursor;
      let scanned = 0;
      let lastScanned: UsageEventsCursorPosition | undefined;
      let hasMoreUnscanned = false;

      while (events.length < query.limit && scanned < RAW_EVENT_SCAN_LIMIT) {
        const pageSize = Math.min(RAW_EVENT_PAGE_SIZE, RAW_EVENT_SCAN_LIMIT - scanned);
        const pageQuery =
          pageCursor === undefined
            ? baseQuery
            : baseQuery.startAfter(timestampFromIso(pageCursor.createdAt), pageCursor.id);
        const snapshot = await pageQuery.limit(pageSize).get();
        if (snapshot.docs.length === 0) {
          break;
        }

        for (const [index, doc] of snapshot.docs.entries()) {
          const data = doc.data();
          scanned += 1;
          lastScanned = cursorPositionFromDoc(doc.id, data);

          try {
            const event = validatedEventFromDoc(data);
            if (eventMatchesAdminQuery(event, query)) {
              events.push(event);
            }
          } catch {
            // Malformed and retired usage docs are intentionally invisible to admin reporting.
          }

          if (events.length >= query.limit) {
            if (index < snapshot.docs.length - 1 || scanned >= RAW_EVENT_SCAN_LIMIT) {
              hasMoreUnscanned = index < snapshot.docs.length - 1;
            } else if (snapshot.docs.length === pageSize) {
              const probe = await baseQuery
                .startAfter(timestampFromIso(lastScanned.createdAt), lastScanned.id)
                .limit(1)
                .get();
              hasMoreUnscanned = probe.docs.length > 0;
            }
            break;
          }
        }

        if (events.length >= query.limit || snapshot.docs.length < pageSize) {
          break;
        }

        pageCursor = lastScanned;
      }

      if (!hasMoreUnscanned && lastScanned !== undefined && scanned >= RAW_EVENT_SCAN_LIMIT) {
        const probe = await baseQuery
          .startAfter(timestampFromIso(lastScanned.createdAt), lastScanned.id)
          .limit(1)
          .get();
        hasMoreUnscanned = probe.docs.length > 0;
      }

      return ok({
        events,
        ...(hasMoreUnscanned && lastScanned !== undefined
          ? { nextCursor: encodeUsageEventsCursor(query, lastScanned) }
          : {}),
      });
    } catch (error) {
      return err(firestoreError(error));
    }
  }

  async getById(eventId: string): Promise<Result<LlmUsageEvent | null, FaError>> {
    try {
      const snapshot = await this.db.collection(COLLECTION).doc(eventId).get();
      if (!snapshot.exists) {
        return ok(null);
      }

      try {
        return ok(validatedEventFromDoc(snapshot.data() ?? {}));
      } catch {
        return ok(null);
      }
    } catch (error) {
      return err(firestoreError(error));
    }
  }
}
