import { describe, expect, it } from 'vitest';

import type { LlmPricing } from '../../domain/models/pricing.js';
import type { LlmUsageEvent } from '../../domain/models/usageEvent.js';
import { normalizeUsageEventsQuery } from '../../domain/models/adminUsage.js';
import { computeAggregateId } from './aggregateKey.js';
import { FirestorePricingRepository } from './firestorePricingRepository.js';
import { FirestoreUsageAggregateRepository } from './firestoreUsageAggregateRepository.js';
import { FirestoreUsageEventRepository } from './firestoreUsageEventRepository.js';

type Direction = 'asc' | 'desc';
type WhereOp = '==' | '>=' | '<=';

class FakeTimestamp {
  private readonly date: Date;

  constructor(value: string) {
    this.date = new Date(value);
  }

  toDate(): Date {
    return new Date(this.date.getTime());
  }
}

class FakeDocumentSnapshot {
  constructor(
    readonly id: string,
    private readonly value: Record<string, unknown> | undefined
  ) {}

  get exists(): boolean {
    return this.value !== undefined;
  }

  data(): Record<string, unknown> | undefined {
    return this.value;
  }
}

function applyUpdateValue(existing: unknown, next: unknown): unknown {
  if (
    next !== null &&
    typeof next === 'object' &&
    next.constructor.name === 'NumericIncrementTransform' &&
    'operand' in next &&
    typeof next.operand === 'number'
  ) {
    return (typeof existing === 'number' ? existing : 0) + next.operand;
  }

  return next;
}

function fieldValue(value: Record<string, unknown>, fieldPath: string): unknown {
  return fieldPath.split('.').reduce<unknown>((current, part) => {
    if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
      return (current as Record<string, unknown>)[part];
    }

    return undefined;
  }, value);
}

function rowFieldValue(row: { id: string; value: Record<string, unknown> }, fieldPath: string) {
  return fieldPath === '__name__' ? row.id : fieldValue(row.value, fieldPath);
}

function setFieldValue(value: Record<string, unknown>, fieldPath: string, next: unknown): void {
  const parts = fieldPath.split('.');
  let current = value;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (child === null || typeof child !== 'object' || Array.isArray(child)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const finalPart = parts[parts.length - 1];
  if (finalPart !== undefined) {
    current[finalPart] = next;
  }
}

class FakeDocumentRef {
  constructor(
    private readonly collection: FakeCollectionRef,
    readonly id: string
  ) {}

  create(value: Record<string, unknown>): Promise<void> {
    if (this.collection.docs.has(this.id)) {
      const error = new Error('already exists') as Error & { code: number };
      error.code = 6;
      throw error;
    }

    this.collection.docs.set(this.id, value);
    return Promise.resolve();
  }

  set(value: Record<string, unknown>): Promise<void> {
    this.collection.docs.set(this.id, value);
    return Promise.resolve();
  }

  update(value: Record<string, unknown>): Promise<void> {
    const existing = this.collection.docs.get(this.id) ?? {};
    const updated = { ...existing };
    for (const [field, next] of Object.entries(value)) {
      setFieldValue(updated, field, applyUpdateValue(fieldValue(existing, field), next));
    }
    this.collection.docs.set(this.id, updated);
    return Promise.resolve();
  }

  get(): Promise<FakeDocumentSnapshot> {
    return Promise.resolve(new FakeDocumentSnapshot(this.id, this.collection.docs.get(this.id)));
  }
}

class FakeQuery {
  private readonly filters: { field: string; op: WhereOp; value: unknown }[];
  private readonly orderings: { field: string; direction: Direction }[];
  private readonly maxRows: number | undefined;
  private readonly cursorAfter: unknown[] | undefined;

  constructor(
    private readonly collection: FakeCollectionRef,
    filters: { field: string; op: WhereOp; value: unknown }[] = [],
    orderings: { field: string; direction: Direction }[] = [],
    maxRows?: number,
    cursorAfter?: unknown[]
  ) {
    this.filters = filters;
    this.orderings = orderings;
    this.maxRows = maxRows;
    this.cursorAfter = cursorAfter;
  }

  where(field: string, op: WhereOp, value: unknown): FakeQuery {
    return new FakeQuery(
      this.collection,
      [...this.filters, { field, op, value }],
      this.orderings,
      this.maxRows,
      this.cursorAfter
    );
  }

  orderBy(field: string, direction: Direction): FakeQuery {
    return new FakeQuery(
      this.collection,
      this.filters,
      [...this.orderings, { field, direction }],
      this.maxRows,
      this.cursorAfter
    );
  }

  limit(maxRows: number): FakeQuery {
    return new FakeQuery(this.collection, this.filters, this.orderings, maxRows, this.cursorAfter);
  }

  startAfter(...values: unknown[]): FakeQuery {
    return new FakeQuery(this.collection, this.filters, this.orderings, this.maxRows, values);
  }

  get(): Promise<{ docs: FakeDocumentSnapshot[] }> {
    this.collection.executedQueries.push({
      filters: this.filters,
      orderings: this.orderings,
      maxRows: this.maxRows,
    });
    const rows = [...this.collection.docs.entries()]
      .map(([id, value]) => ({ id, value }))
      .filter(({ value }) => this.filters.every((filter) => matches(value, filter)))
      .sort((left, right) => compareRows(left, right, this.orderings))
      .filter((row) => isAfterCursor(row, this.orderings, this.cursorAfter));
    const limited = this.maxRows === undefined ? rows : rows.slice(0, this.maxRows);

    return Promise.resolve({
      docs: limited.map((row) => new FakeDocumentSnapshot(row.id, row.value)),
    });
  }
}

class FakeCollectionRef extends FakeQuery {
  readonly docs = new Map<string, Record<string, unknown>>();
  readonly executedQueries: {
    filters: { field: string; op: WhereOp; value: unknown }[];
    orderings: { field: string; direction: Direction }[];
    maxRows: number | undefined;
  }[] = [];

  constructor(readonly name: string) {
    super(undefined as never);
    Object.defineProperty(this, 'collection', { value: this });
  }

  doc(id: string): FakeDocumentRef {
    if (id.includes('/')) {
      throw new Error(`Invalid document id: ${id}`);
    }

    return new FakeDocumentRef(this, id);
  }
}

class FakeFirestore {
  readonly collections = new Map<string, FakeCollectionRef>();
  transactionCount = 0;

  collection(name: string): FakeCollectionRef {
    const existing = this.collections.get(name);
    if (existing !== undefined) {
      return existing;
    }

    const created = new FakeCollectionRef(name);
    this.collections.set(name, created);
    return created;
  }

  runTransaction<T>(callback: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return callback(new FakeTransaction());
  }
}

class FakeTransaction {
  get(documentRef: FakeDocumentRef): Promise<FakeDocumentSnapshot> {
    return documentRef.get();
  }

  set(documentRef: FakeDocumentRef, value: Record<string, unknown>): void {
    void documentRef.set(value);
  }

  update(documentRef: FakeDocumentRef, value: Record<string, unknown>): void {
    void documentRef.update(value);
  }
}

class ThrowingDocumentRef {
  constructor(private readonly error: Error) {}

  create(): Promise<void> {
    return Promise.reject(this.error);
  }

  set(): Promise<void> {
    return Promise.reject(this.error);
  }

  update(): Promise<void> {
    return Promise.reject(this.error);
  }

  get(): Promise<never> {
    return Promise.reject(this.error);
  }
}

class ThrowingCollectionRef {
  constructor(private readonly error: Error) {}

  doc(): ThrowingDocumentRef {
    return new ThrowingDocumentRef(this.error);
  }

  where(): this {
    return this;
  }

  orderBy(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  startAfter(): this {
    return this;
  }

  get(): Promise<never> {
    return Promise.reject(this.error);
  }
}

class ThrowingFirestore {
  constructor(private readonly error: Error) {}

  collection(): ThrowingCollectionRef {
    return new ThrowingCollectionRef(this.error);
  }

  runTransaction(): Promise<never> {
    return Promise.reject(this.error);
  }
}

function errorWithoutMessage(): Error {
  const error = new Error('ignored');
  Object.defineProperty(error, 'message', { value: undefined });
  return error;
}

function valueForCompare(value: unknown): string | number {
  if (value instanceof FakeTimestamp) {
    return value.toDate().getTime();
  }

  if (value !== null && typeof value === 'object' && 'toDate' in value) {
    const timestampLike = value as { toDate?: () => unknown };
    if (timestampLike.toDate !== undefined) {
      const date = timestampLike.toDate();
      if (date instanceof Date) {
        return date.getTime();
      }
    }
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return value;
  }

  return '';
}

function matches(
  value: Record<string, unknown>,
  filter: { field: string; op: WhereOp; value: unknown }
): boolean {
  const left = valueForCompare(fieldValue(value, filter.field));
  const right = valueForCompare(filter.value);

  switch (filter.op) {
    case '==':
      return left === right;
    case '>=':
      return left >= right;
    case '<=':
      return left <= right;
  }
}

function compareRows(
  left: { id: string; value: Record<string, unknown> },
  right: { id: string; value: Record<string, unknown> },
  orderings: readonly { field: string; direction: Direction }[]
): number {
  for (const ordering of orderings) {
    const leftValue = valueForCompare(rowFieldValue(left, ordering.field));
    const rightValue = valueForCompare(rowFieldValue(right, ordering.field));
    if (leftValue === rightValue) {
      continue;
    }

    const result = leftValue < rightValue ? -1 : 1;
    return ordering.direction === 'asc' ? result : -result;
  }

  return 0;
}

function isAfterCursor(
  row: { id: string; value: Record<string, unknown> },
  orderings: readonly { field: string; direction: Direction }[],
  cursor: unknown[] | undefined
): boolean {
  if (cursor === undefined) {
    return true;
  }

  for (const [index, ordering] of orderings.entries()) {
    const left = valueForCompare(rowFieldValue(row, ordering.field));
    const right = valueForCompare(cursor[index]);
    if (left === right) {
      continue;
    }

    return ordering.direction === 'asc' ? left > right : left < right;
  }

  return false;
}

function usageEvent(overrides: Partial<LlmUsageEvent> = {}): LlmUsageEvent {
  const base: LlmUsageEvent = {
    id: 'event-1',
    owner: { type: 'user', id: 'user-123' },
    source: {
      service: 'chat-service',
      component: 'rag-chat',
      operation: 'chat.completion',
      promptType: 'fishing-answer',
    },
    request: {
      provider: 'openrouter',
      model: 'google/gemini-3.5-flash',
      promptVersion: '1.0.0',
    },
    usage: { inputTokens: 1000, outputTokens: 100, totalTokens: 1100, estimated: false },
    cost: { estimatedCostUsd: 0.0024 },
    createdAt: '2026-06-14T12:00:00.000Z',
    correlation: {},
  };
  return { ...base, ...overrides };
}

const pricing: LlmPricing = {
  provider: 'openrouter',
  model: 'google/gemini-3.5-flash',
  inputUsdPer1M: 1.5,
  outputUsdPer1M: 9,
  updatedAt: '2026-06-13T00:00:00.000Z',
};

describe('Firestore usage event repository', () => {
  it('creates events idempotently and reports duplicates', async () => {
    const repo = new FirestoreUsageEventRepository(new FakeFirestore() as never);

    await expect(repo.create(usageEvent())).resolves.toEqual({
      ok: true,
      value: { status: 'created' },
    });
    await expect(repo.create(usageEvent())).resolves.toEqual({
      ok: true,
      value: { status: 'duplicate' },
    });
  });

  it('creates usage events and daily aggregates in one idempotent transaction', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreUsageEventRepository(db as never);
    const aggregateRepo = new FirestoreUsageAggregateRepository(db as never);
    const first = usageEvent();
    const second = usageEvent({
      id: 'event-2',
      usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550, estimated: true },
      cost: { estimatedCostUsd: 0.0012 },
      error: { code: 'MODEL_TIMEOUT', message: 'model timed out' },
    });

    await expect(repo.createWithAggregate(first, aggregateRepo)).resolves.toEqual({
      ok: true,
      value: { status: 'created' },
    });
    await expect(repo.createWithAggregate(first, aggregateRepo)).resolves.toEqual({
      ok: true,
      value: { status: 'duplicate' },
    });
    await expect(repo.createWithAggregate(second, aggregateRepo)).resolves.toEqual({
      ok: true,
      value: { status: 'created' },
    });

    expect(db.transactionCount).toBe(3);
    expect(db.collection('llm_usage_events').docs.has('event-1')).toBe(true);
    expect(db.collection('llm_usage_events').docs.has('event-2')).toBe(true);
    expect(
      db.collection('llm_usage_daily_aggregates').docs.get(computeAggregateId(first))
    ).toMatchObject({
      metrics: {
        calls: 2,
        inputTokens: 1500,
        outputTokens: 150,
        totalTokens: 1650,
        estimatedCostUsd: 0.0036,
        estimatedCallCount: 1,
        errorCallCount: 1,
      },
    });
  });

  it('round-trips current-schema correlation and provider error details without retired fields', async () => {
    const repo = new FirestoreUsageEventRepository(new FakeFirestore() as never);
    const correlated = usageEvent({
      id: 'correlated-event',
      cost: { estimatedCostUsd: 0.0024, source: 'provider-reported' },
      correlation: {
        conversationId: 'conversation-1',
        messageId: 'message-1',
        knowledgePageId: 'page-1',
        chunkId: 'chunk-1',
        requestId: 'request-1',
      },
      error: { code: 'MODEL_TIMEOUT', message: 'model timed out' },
    });

    await repo.create(correlated);

    await expect(repo.getById('correlated-event')).resolves.toEqual({
      ok: true,
      value: correlated,
    });
    await expect(repo.getById('missing-event')).resolves.toEqual({ ok: true, value: null });
    expect(JSON.stringify(correlated)).not.toContain('workspaceId');
    expect(JSON.stringify(correlated)).not.toContain('ownerId');
  });

  it('returns Firestore errors from createWithAggregate transactions', async () => {
    const repo = new FirestoreUsageEventRepository(
      new ThrowingFirestore(Object.assign(new Error('transaction failed'), { code: 13 })) as never
    );

    await expect(
      repo.createWithAggregate(
        usageEvent(),
        new FirestoreUsageAggregateRepository(new FakeFirestore() as never)
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'transaction failed', details: { code: 13 } },
    });
  });

  it('persists and reads token usage estimation diagnostics', async () => {
    const repo = new FirestoreUsageEventRepository(new FakeFirestore() as never);

    await repo.create(usageEvent({ usage: { ...usageEvent().usage, estimated: true } }));

    await expect(
      repo.list({
        from: '2026-06-14T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        ownerId: 'user-123',
        limit: 50,
      })
    ).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          id: 'event-1',
          usage: {
            inputTokens: 1000,
            outputTokens: 100,
            totalTokens: 1100,
            estimated: true,
          },
        }),
      ],
    });
  });

  it('does not list retired flat usage events through nested current-schema queries', async () => {
    const db = new FakeFirestore();
    const retiredEvent: Record<string, unknown> = {
      id: 'retired-event',
      ownerType: 'workspace',
      ownerId: 'anonymous',
      service: 'chat-service',
      component: 'rag-chat',
      provider: 'openrouter',
      model: 'google/gemini-3.5-flash',
      operation: 'chat.completion',
      promptType: 'fishing-answer',
      inputTokens: 1000,
      outputTokens: 100,
      totalTokens: 1100,
      estimatedCostUsd: 0.0024,
      correlation: {},
    };
    await db
      .collection('llm_usage_events')
      .doc('retired-event')
      .create({
        ...retiredEvent,
        createdAt: new FakeTimestamp('2026-06-14T12:00:00.000Z'),
      });
    const repo = new FirestoreUsageEventRepository(db as never);

    await expect(
      repo.list({
        from: '2026-06-14T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        ownerId: 'user-123',
        limit: 50,
      })
    ).resolves.toEqual({
      ok: true,
      value: [],
    });
  });

  it('skips malformed nested usage events instead of coercing owner type to user', async () => {
    const db = new FakeFirestore();
    await db
      .collection('llm_usage_events')
      .doc('workspace-event')
      .create({
        ...usageEvent({ id: 'workspace-event' }),
        owner: { type: 'workspace', id: 'user-123' },
        createdAt: new FakeTimestamp('2026-06-14T12:00:00.000Z'),
      });
    const repo = new FirestoreUsageEventRepository(db as never);

    await expect(
      repo.list({
        from: '2026-06-14T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        ownerId: 'user-123',
        limit: 50,
      })
    ).resolves.toEqual({ ok: true, value: [] });
  });

  it.each([
    'anonymous',
    'system',
    'workspace-retired',
    'anonymous-workspace-1',
    'angler@example.com',
    '+15551234567',
    'auth0|abc123',
  ])('skips usage events with invalid nested user owner id %s', async (ownerId) => {
    const db = new FakeFirestore();
    await db
      .collection('llm_usage_events')
      .doc(`invalid-${ownerId}`)
      .create({
        ...usageEvent({ id: `invalid-${ownerId}` }),
        owner: { type: 'user', id: ownerId },
        createdAt: new FakeTimestamp('2026-06-14T12:00:00.000Z'),
      });
    const repo = new FirestoreUsageEventRepository(db as never);

    await expect(
      repo.list({
        from: '2026-06-14T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        ownerId,
        limit: 50,
      })
    ).resolves.toEqual({ ok: true, value: [] });
  });

  it('lists events from a bounded createdAt page and filters current-schema dimensions in memory', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreUsageEventRepository(db as never);
    await repo.create(usageEvent({ id: 'old', createdAt: '2026-06-01T00:00:00.000Z' }));
    await repo.create(
      usageEvent({
        id: 'newest',
        source: { ...usageEvent().source, operation: 'chat.stream' },
        createdAt: '2026-06-14T15:00:00.000Z',
      })
    );
    await repo.create(
      usageEvent({
        id: 'second',
        source: { ...usageEvent().source, operation: 'chat.stream' },
        createdAt: '2026-06-14T13:00:00.000Z',
      })
    );
    await repo.create(usageEvent({ id: 'other-owner', owner: { type: 'user', id: 'other' } }));

    await expect(
      repo.list({
        from: '2026-06-14T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        ownerId: 'user-123',
        service: 'chat-service',
        operation: 'chat.stream',
        limit: 2,
      })
    ).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({ id: 'newest', createdAt: '2026-06-14T15:00:00.000Z' }),
        expect.objectContaining({ id: 'second', createdAt: '2026-06-14T13:00:00.000Z' }),
      ],
    });
    expect(db.collection('llm_usage_events').executedQueries.at(-1)).toMatchObject({
      filters: [
        { field: 'createdAt', op: '>=' },
        { field: 'createdAt', op: '<=' },
      ],
      orderings: [{ field: 'createdAt', direction: 'desc' }],
    });
  });

  it('scans raw admin event pages until selective filters fill the response limit', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreUsageEventRepository(db as never);
    const baseMs = Date.parse('2026-06-14T15:00:00.000Z');
    for (let index = 0; index < 250; index += 1) {
      await repo.create(
        usageEvent({
          id: `event-${String(index).padStart(3, '0')}`,
          request: {
            ...usageEvent().request,
            model: index === 248 || index === 249 ? 'target-model' : 'other-model',
          },
          createdAt: new Date(baseMs - index * 1000).toISOString(),
        })
      );
    }

    await expect(
      repo.listForAdmin({
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
        filters: { models: ['target-model'] },
        limit: 2,
      })
    ).resolves.toEqual({
      ok: true,
      value: {
        events: [
          expect.objectContaining({ id: 'event-248' }),
          expect.objectContaining({ id: 'event-249' }),
        ],
        nextCursor: undefined,
      },
    });
    expect(db.collection('llm_usage_events').executedQueries.length).toBeGreaterThan(1);
    expect(
      db
        .collection('llm_usage_events')
        .executedQueries.every((query) => (query.maxRows ?? 0) <= 200)
    ).toBe(true);
  });

  it('returns and consumes raw admin event cursors from the last scanned raw position', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreUsageEventRepository(db as never);
    await repo.create(usageEvent({ id: 'event-c', createdAt: '2026-06-14T14:00:00.000Z' }));
    await repo.create(usageEvent({ id: 'event-b', createdAt: '2026-06-14T13:00:00.000Z' }));
    await repo.create(usageEvent({ id: 'event-a', createdAt: '2026-06-14T12:00:00.000Z' }));
    const query = {
      timeRange: {
        from: '2026-06-14T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
      },
      filters: {},
      limit: 2,
    };

    const first = await repo.listForAdmin(query);
    if (!first.ok) {
      throw first.error;
    }
    expect(first.value.events).toEqual([
      expect.objectContaining({ id: 'event-c' }),
      expect.objectContaining({ id: 'event-b' }),
    ]);
    expect(typeof first.value.nextCursor).toBe('string');

    const nextQuery = normalizeUsageEventsQuery({
      ...query,
      cursor: first.value.nextCursor,
    });
    if (!nextQuery.ok) {
      throw nextQuery.error;
    }

    await expect(repo.listForAdmin(nextQuery.value)).resolves.toEqual({
      ok: true,
      value: {
        events: [expect.objectContaining({ id: 'event-a' })],
        nextCursor: undefined,
      },
    });
  });

  it('probes for a next cursor when an admin page fills exactly at the raw page boundary', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreUsageEventRepository(db as never);
    const baseMs = Date.parse('2026-06-14T15:00:00.000Z');
    for (let index = 0; index < 201; index += 1) {
      await repo.create(
        usageEvent({
          id: `boundary-${String(index).padStart(3, '0')}`,
          createdAt: new Date(baseMs - index * 1000).toISOString(),
        })
      );
    }

    const result = await repo.listForAdmin({
      timeRange: {
        from: '2026-06-14T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
      },
      filters: {},
      limit: 200,
    });

    if (!result.ok) {
      throw result.error;
    }
    expect(result.value.events.map((event) => event.id)).toContain('boundary-199');
    expect(result.value.nextCursor).toEqual(expect.any(String));
    expect(result.value.events).toHaveLength(200);
  });

  it('returns a raw admin event cursor when the scan budget is exhausted before selective filters fill the response limit', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreUsageEventRepository(db as never);
    const baseMs = Date.parse('2026-06-14T15:00:00.000Z');
    const targetIndexes = new Set([999, 1999, 2000]);
    for (let index = 0; index <= 2000; index += 1) {
      await repo.create(
        usageEvent({
          id: `event-${String(index).padStart(4, '0')}`,
          request: {
            ...usageEvent().request,
            model: targetIndexes.has(index) ? 'target-model' : 'other-model',
          },
          createdAt: new Date(baseMs - index * 1000).toISOString(),
        })
      );
    }

    const query = {
      timeRange: {
        from: '2026-06-14T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
      },
      filters: { models: ['target-model'] },
      limit: 3,
    };
    const first = await repo.listForAdmin(query);
    if (!first.ok) {
      throw first.error;
    }

    expect(first.value.events).toEqual([
      expect.objectContaining({ id: 'event-0999' }),
      expect.objectContaining({ id: 'event-1999' }),
    ]);
    expect(typeof first.value.nextCursor).toBe('string');

    const nextQuery = normalizeUsageEventsQuery({
      ...query,
      cursor: first.value.nextCursor,
    });
    if (!nextQuery.ok) {
      throw nextQuery.error;
    }

    await expect(repo.listForAdmin(nextQuery.value)).resolves.toEqual({
      ok: true,
      value: {
        events: [expect.objectContaining({ id: 'event-2000' })],
        nextCursor: undefined,
      },
    });
  });

  it('skips invalid current-schema raw event documents for admin list and lookup', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreUsageEventRepository(db as never);
    await repo.create(usageEvent({ id: 'valid-event' }));
    const collection = db.collection('llm_usage_events');
    const validDoc = collection.docs.get('valid-event');
    if (validDoc === undefined) {
      throw new Error('Expected valid event fixture to be written');
    }
    collection.docs.set('retired-source', {
      ...validDoc,
      id: 'retired-source',
      service: 'chat-service',
    });
    collection.docs.set('invalid-service', {
      ...validDoc,
      id: 'invalid-service',
      source: { ...(validDoc['source'] as Record<string, unknown>), service: 'retired-service' },
    });
    collection.docs.set('empty-provider', {
      ...validDoc,
      id: 'empty-provider',
      request: { ...(validDoc['request'] as Record<string, unknown>), provider: '' },
    });
    collection.docs.set('retired-correlation', {
      ...validDoc,
      id: 'retired-correlation',
      correlation: { documentId: 'retired-doc' },
    });

    await expect(
      repo.listForAdmin({
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
        filters: {},
        limit: 50,
      })
    ).resolves.toEqual({
      ok: true,
      value: { events: [expect.objectContaining({ id: 'valid-event' })], nextCursor: undefined },
    });
    await expect(repo.getById('retired-source')).resolves.toEqual({ ok: true, value: null });
    await expect(repo.getById('invalid-service')).resolves.toEqual({ ok: true, value: null });
    await expect(repo.getById('empty-provider')).resolves.toEqual({ ok: true, value: null });
    await expect(repo.getById('retired-correlation')).resolves.toEqual({ ok: true, value: null });
  });

  it('returns Firestore errors from create and list operations', async () => {
    const createError = Object.assign(new Error('permission denied'), {
      code: 'permission-denied',
    });
    const createRepo = new FirestoreUsageEventRepository(
      new ThrowingFirestore(createError) as never
    );

    await expect(createRepo.create(usageEvent())).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'permission denied',
        details: { code: 'permission-denied' },
      },
    });

    const listRepo = new FirestoreUsageEventRepository(
      new ThrowingFirestore(errorWithoutMessage()) as never
    );
    await expect(
      listRepo.list({
        from: '2026-06-14T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        ownerId: 'user-123',
        limit: 50,
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Firestore operation failed' },
    });
    await expect(
      listRepo.listForAdmin({
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
        filters: {},
        limit: 50,
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Firestore operation failed' },
    });
    await expect(listRepo.getById('event-1')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Firestore operation failed' },
    });
  });
});

describe('Firestore aggregate repository', () => {
  it('computes a deterministic aggregate id with all dimensions', () => {
    expect(
      computeAggregateId(
        usageEvent({
          source: { ...usageEvent().source, operation: 'chat.stream', promptType: 'answer-repair' },
        })
      )
    ).toMatch(/^2026-06-14__2026-06-14T12__user__/);
  });

  it('creates and increments daily aggregates', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreUsageAggregateRepository(db as never);

    await expect(repo.increment(usageEvent())).resolves.toEqual({ ok: true, value: undefined });
    await expect(repo.increment(usageEvent())).resolves.toEqual({ ok: true, value: undefined });
    expect(db.transactionCount).toBe(2);
    await expect(
      repo.list({ from: '2026-06-14', to: '2026-06-14', ownerId: 'user-123' })
    ).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          metrics: {
            calls: 2,
            inputTokens: 2000,
            outputTokens: 200,
            totalTokens: 2200,
            estimatedCostUsd: 0.0048,
            estimatedCallCount: 0,
            errorCallCount: 0,
          },
        }),
      ],
    });
  });

  it('stores prompt type dimensions and maps them back from aggregate rows', async () => {
    const repo = new FirestoreUsageAggregateRepository(new FakeFirestore() as never);

    await repo.increment(
      usageEvent({ source: { ...usageEvent().source, promptType: 'answer-repair' } })
    );

    await expect(
      repo.list({ from: '2026-06-14', to: '2026-06-14', ownerId: 'user-123' })
    ).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          source: {
            service: 'chat-service',
            component: 'rag-chat',
            operation: 'chat.completion',
            promptType: 'answer-repair',
          },
        }),
      ],
    });
  });

  it('skips malformed aggregate rows instead of coercing owner type to user', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreUsageAggregateRepository(db as never);
    await repo.increment(usageEvent());
    const aggregateCollection = db.collection('llm_usage_daily_aggregates');
    const [aggregateId, aggregateDoc] = [...aggregateCollection.docs.entries()][0] ?? [];
    if (aggregateId === undefined || aggregateDoc === undefined) {
      throw new Error('Expected aggregate fixture to be written');
    }
    aggregateCollection.docs.set(aggregateId, {
      ...aggregateDoc,
      owner: { type: 'workspace', id: 'user-123' },
    });

    await expect(
      repo.list({ from: '2026-06-14', to: '2026-06-14', ownerId: 'user-123' })
    ).resolves.toEqual({ ok: true, value: [] });
  });

  it.each([
    'anonymous',
    'anonymous-workspace-1',
    'angler@example.com',
    '+15551234567',
    'auth0|abc123',
  ])('skips aggregate rows with invalid nested user owner id %s', async (ownerId) => {
    const db = new FakeFirestore();
    const repo = new FirestoreUsageAggregateRepository(db as never);
    await repo.increment(usageEvent());
    const aggregateCollection = db.collection('llm_usage_daily_aggregates');
    const [aggregateId, aggregateDoc] = [...aggregateCollection.docs.entries()][0] ?? [];
    if (aggregateId === undefined || aggregateDoc === undefined) {
      throw new Error('Expected aggregate fixture to be written');
    }
    aggregateCollection.docs.set(aggregateId, {
      ...aggregateDoc,
      owner: { type: 'user', id: ownerId },
    });

    await expect(repo.list({ from: '2026-06-14', to: '2026-06-14', ownerId })).resolves.toEqual({
      ok: true,
      value: [],
    });
  });

  it('skips invalid current-schema aggregate rows for admin list and dimensions', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreUsageAggregateRepository(db as never);
    await repo.increment(usageEvent());
    const collection = db.collection('llm_usage_daily_aggregates');
    const [aggregateId, aggregateDoc] = [...collection.docs.entries()][0] ?? [];
    if (aggregateId === undefined || aggregateDoc === undefined) {
      throw new Error('Expected aggregate fixture to be written');
    }
    collection.docs.set('retired-owner', {
      ...aggregateDoc,
      id: 'retired-owner',
      ownerId: 'anonymous',
    });
    collection.docs.set('invalid-operation', {
      ...aggregateDoc,
      id: 'invalid-operation',
      source: { ...(aggregateDoc['source'] as Record<string, unknown>), operation: 'retired' },
    });
    collection.docs.set('empty-prompt-version', {
      ...aggregateDoc,
      id: 'empty-prompt-version',
      request: { ...(aggregateDoc['request'] as Record<string, unknown>), promptVersion: '' },
    });
    collection.docs.set('bad-metrics', {
      ...aggregateDoc,
      id: 'bad-metrics',
      metrics: { ...(aggregateDoc['metrics'] as Record<string, unknown>), totalTokens: 999 },
    });

    await expect(
      repo.listForAdmin({
        timeBucket: 'day',
        fromBucket: '2026-06-14',
        toBucket: '2026-06-14',
      })
    ).resolves.toEqual({
      ok: true,
      value: [expect.objectContaining({ id: aggregateId })],
    });
    await expect(
      repo.listDimensions({
        timeBucket: 'day',
        fromBucket: '2026-06-14',
        toBucket: '2026-06-14',
      })
    ).resolves.toEqual({
      ok: true,
      value: {
        models: ['google/gemini-3.5-flash'],
        providers: ['openrouter'],
        components: ['rag-chat'],
        promptTypes: ['fishing-answer'],
        services: ['chat-service'],
        operations: ['chat.completion'],
      },
    });
  });

  it('returns Firestore errors from aggregate increment and list operations', async () => {
    const incrementRepo = new FirestoreUsageAggregateRepository(
      new ThrowingFirestore(Object.assign(new Error('aggregate failed'), { code: 13 })) as never
    );
    await expect(incrementRepo.increment(usageEvent())).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'aggregate failed', details: { code: 13 } },
    });

    const listRepo = new FirestoreUsageAggregateRepository(
      new ThrowingFirestore(errorWithoutMessage()) as never
    );
    await expect(
      listRepo.list({ from: '2026-06-14', to: '2026-06-15', ownerId: 'user-123' })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Firestore operation failed' },
    });
  });
});

describe('Firestore pricing repository', () => {
  it('upserts, gets, and lists pricing with provider/model doc ids and ISO timestamps', async () => {
    const db = new FakeFirestore();
    const repo = new FirestorePricingRepository(db as never);

    await repo.upsert(pricing);

    expect(db.collection('llm_pricing').docs.has('openrouter__google%2Fgemini-3.5-flash')).toBe(
      true
    );
    await expect(repo.get('openrouter', 'google/gemini-3.5-flash')).resolves.toEqual(pricing);
    await expect(repo.list()).resolves.toEqual([pricing]);
  });

  it('returns null when pricing is missing and maps optional embedding rates', async () => {
    const db = new FakeFirestore();
    const repo = new FirestorePricingRepository(db as never);
    const embeddingPricing: LlmPricing = {
      provider: 'openrouter',
      model: 'qwen/qwen3-embedding-8b',
      inputUsdPer1M: 0.01,
      outputUsdPer1M: 0,
      embeddingUsdPer1M: 0.01,
      updatedAt: '2026-06-13T00:00:00.000Z',
    };

    await expect(repo.get('openrouter', 'missing')).resolves.toBeNull();
    await repo.upsert(embeddingPricing);
    await expect(repo.list()).resolves.toEqual([embeddingPricing]);
  });

  it('maps Firestore Timestamp documents to ISO route DTOs', async () => {
    const db = new FakeFirestore();
    await db
      .collection('llm_pricing')
      .doc('openrouter__google%2Fgemini-3.5-flash')
      .set({
        ...pricing,
        updatedAt: new FakeTimestamp('2026-06-13T00:00:00.000Z'),
      });
    const repo = new FirestorePricingRepository(db as never);

    await expect(repo.get('openrouter', 'google/gemini-3.5-flash')).resolves.toEqual(pricing);
  });
});
