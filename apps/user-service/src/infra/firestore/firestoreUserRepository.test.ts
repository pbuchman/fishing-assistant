import { describe, expect, it } from 'vitest';

import type { FaUser, UserChangeEvent } from '../../domain/models/user.js';
import {
  CHANGE_EVENTS_COLLECTION,
  IDENTITY_RESERVATIONS_COLLECTION,
  USERS_COLLECTION,
} from './collections.js';
import { FirestoreUserRepository } from './firestoreUserRepository.js';
import {
  eventFromDoc,
  eventToDoc,
  identityReservationId,
  reservationFromDoc,
  reservationToDoc,
  timestampFromIso,
  userFromDoc,
  userToDoc,
} from './firestoreMapping.js';

type Direction = 'asc' | 'desc';
type WhereOp = '==';

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

class FakeDocumentRef {
  constructor(
    private readonly collection: FakeCollectionRef,
    readonly id: string
  ) {}

  set(value: Record<string, unknown>): Promise<void> {
    this.collection.docs.set(this.id, value);
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

  constructor(
    private readonly collection: FakeCollectionRef,
    filters: { field: string; op: WhereOp; value: unknown }[] = [],
    orderings: { field: string; direction: Direction }[] = [],
    maxRows?: number
  ) {
    this.filters = filters;
    this.orderings = orderings;
    this.maxRows = maxRows;
  }

  where(field: string, op: WhereOp, value: unknown): FakeQuery {
    return new FakeQuery(
      this.collection,
      [...this.filters, { field, op, value }],
      this.orderings,
      this.maxRows
    );
  }

  orderBy(field: string, direction: Direction): FakeQuery {
    return new FakeQuery(
      this.collection,
      this.filters,
      [...this.orderings, { field, direction }],
      this.maxRows
    );
  }

  limit(maxRows: number): FakeQuery {
    return new FakeQuery(this.collection, this.filters, this.orderings, maxRows);
  }

  get(): Promise<{ docs: FakeDocumentSnapshot[] }> {
    const rows = [...this.collection.docs.entries()]
      .map(([id, value]) => ({ id, value }))
      .filter(({ value }) => this.filters.every((filter) => matches(value, filter)))
      .sort((left, right) => compareRows(left, right, this.orderings));
    const limited = this.maxRows === undefined ? rows : rows.slice(0, this.maxRows);

    return Promise.resolve({
      docs: limited.map((row) => new FakeDocumentSnapshot(row.id, row.value)),
    });
  }
}

class FakeCollectionRef extends FakeQuery {
  readonly docs = new Map<string, Record<string, unknown>>();

  constructor(readonly name: string) {
    super(undefined as never);
    Object.defineProperty(this, 'collection', { value: this });
  }

  doc(id: string): FakeDocumentRef {
    return new FakeDocumentRef(this, id);
  }
}

class FakeTransaction {
  readonly readIds: string[] = [];
  readonly writeIds: string[] = [];

  get(documentRef: FakeDocumentRef): Promise<FakeDocumentSnapshot> {
    this.readIds.push(documentRef.id);
    return documentRef.get();
  }

  set(documentRef: FakeDocumentRef, value: Record<string, unknown>): void {
    this.writeIds.push(documentRef.id);
    void documentRef.set(value);
  }
}

class FakeFirestore {
  readonly collections = new Map<string, FakeCollectionRef>();
  readonly transactions: FakeTransaction[] = [];

  collection(name: string): FakeCollectionRef {
    const existing = this.collections.get(name);
    if (existing !== undefined) {
      return existing;
    }

    const created = new FakeCollectionRef(name);
    this.collections.set(name, created);
    return created;
  }

  runTransaction<T>(handler: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
    const transaction = new FakeTransaction();
    this.transactions.push(transaction);
    return handler(transaction);
  }
}

function compareValue(value: unknown): string | number {
  if (value !== null && typeof value === 'object' && 'toDate' in value) {
    const date = (value as { toDate: () => Date }).toDate();
    return date.getTime();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }

  return '';
}

function matches(
  row: Record<string, unknown>,
  filter: { field: string; op: WhereOp; value: unknown }
): boolean {
  return compareValue(row[filter.field]) === compareValue(filter.value);
}

function compareRows(
  left: { id: string; value: Record<string, unknown> },
  right: { id: string; value: Record<string, unknown> },
  orderings: readonly { field: string; direction: Direction }[]
): number {
  for (const ordering of orderings) {
    const leftValue =
      ordering.field === '__name__' ? left.id : compareValue(left.value[ordering.field]);
    const rightValue =
      ordering.field === '__name__' ? right.id : compareValue(right.value[ordering.field]);
    if (leftValue === rightValue) {
      continue;
    }

    const result = leftValue < rightValue ? -1 : 1;
    return ordering.direction === 'asc' ? result : -result;
  }

  return 0;
}

function user(overrides: Partial<FaUser> = {}): FaUser {
  const id = overrides.id ?? 'user-1';
  return {
    id,
    auth0Subject: `auth0|${id}`,
    email: `${id}@example.com`,
    normalizedEmail: `${id}@example.com`,
    firstName: 'Pat',
    lastName: 'Angler',
    mobileNumber: '+15550101000',
    role: 'user',
    level: 3,
    status: 'approved',
    statusBeforeSuspension: null,
    createdAt: '2026-06-17T09:00:00.000Z',
    updatedAt: '2026-06-17T09:00:00.000Z',
    approvedAt: '2026-06-17T09:00:00.000Z',
    suspendedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function event(overrides: Partial<UserChangeEvent> = {}): UserChangeEvent {
  return {
    id: 'event-1',
    targetUserId: 'user-1',
    actorUserId: 'admin-1',
    type: 'profile_changed',
    before: {},
    after: { firstName: 'Pat' },
    createdAt: '2026-06-17T09:05:00.000Z',
    ...overrides,
  };
}

function repoWithSeed(users: FaUser[] = []): {
  firestore: FakeFirestore;
  repository: FirestoreUserRepository;
} {
  const firestore = new FakeFirestore();
  for (const seeded of users) {
    firestore.collection(USERS_COLLECTION).docs.set(seeded.id, userToDoc(seeded));
  }
  return { firestore, repository: new FirestoreUserRepository(firestore as never) };
}

function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('expected ok result');
  }
  return result.value;
}

describe('Firestore user mapping', () => {
  it('maps timestamp fields for users, reservations, and change events', () => {
    const mappedUser = userFromDoc(
      'user-1',
      userToDoc(user({ deletedAt: '2026-06-17T09:30:00.000Z' }))
    );
    expect(mappedUser).toMatchObject({
      id: 'user-1',
      createdAt: '2026-06-17T09:00:00.000Z',
      deletedAt: '2026-06-17T09:30:00.000Z',
    });

    const reservation = reservationFromDoc(
      'normalizedEmail:hash',
      reservationToDoc({
        id: 'normalizedEmail:hash',
        kind: 'normalizedEmail',
        valueHash: 'hash',
        userId: 'user-1',
        active: false,
        createdAt: '2026-06-17T09:00:00.000Z',
        updatedAt: '2026-06-17T09:10:00.000Z',
        releasedAt: '2026-06-17T09:15:00.000Z',
      })
    );
    expect(reservation).toMatchObject({
      id: 'normalizedEmail:hash',
      releasedAt: '2026-06-17T09:15:00.000Z',
    });

    const mappedEvent = eventFromDoc('event-1', eventToDoc(event()));
    expect(mappedEvent.createdAt).toBe('2026-06-17T09:05:00.000Z');
    expect(timestampFromIso('2026-06-17T09:00:00.000Z').toDate().toISOString()).toBe(
      '2026-06-17T09:00:00.000Z'
    );
  });

  it('uses deterministic hashed reservation ids without raw identities', () => {
    const subjectId = identityReservationId('auth0Subject', 'auth0|raw-subject');
    const emailId = identityReservationId('normalizedEmail', 'person@example.com');

    expect(subjectId).toMatch(/^auth0Subject:[a-f0-9]{64}$/);
    expect(emailId).toMatch(/^normalizedEmail:[a-f0-9]{64}$/);
    expect(subjectId).not.toContain('raw-subject');
    expect(emailId).not.toContain('@');
  });

  it('accepts ISO strings and Dates while rejecting malformed Firestore user documents', () => {
    const mapped = userFromDoc('date-backed', {
      ...userToDoc(user({ id: 'date-backed' })),
      createdAt: new Date('2026-06-17T09:00:00.000Z'),
      updatedAt: '2026-06-17T10:00:00.000Z',
      approvedAt: null,
    });

    expect(mapped).toMatchObject({
      id: 'date-backed',
      createdAt: '2026-06-17T09:00:00.000Z',
      updatedAt: '2026-06-17T10:00:00.000Z',
      approvedAt: null,
    });
    expect(() =>
      userFromDoc('bad-nullable', {
        ...userToDoc(user()),
        firstName: 123,
      })
    ).toThrow('firstName must be a string or null');
    expect(() =>
      userFromDoc('bad-role', {
        ...userToDoc(user()),
        role: 123,
      })
    ).toThrow('role must be a string');
    expect(() =>
      userFromDoc('bad-timestamp', {
        ...userToDoc(user()),
        createdAt: { toDate: () => 'not a Date' },
      })
    ).toThrow('createdAt must be a Firestore Timestamp, Date, or ISO string');
    expect(() =>
      reservationFromDoc('reservation', {
        ...reservationToDoc({
          id: 'reservation',
          kind: 'normalizedEmail',
          valueHash: 'hash',
          userId: 'user-1',
          active: true,
          createdAt: '2026-06-17T09:00:00.000Z',
          updatedAt: '2026-06-17T09:00:00.000Z',
          releasedAt: null,
        }),
        active: 'yes',
      })
    ).toThrow('active must be a boolean');
    expect(() =>
      eventFromDoc('bad-event', {
        ...eventToDoc(event()),
        before: [],
      })
    ).toThrow('before must be an object');
  });
});

describe('FirestoreUserRepository', () => {
  it('creates or updates a user, reservations, and events in one transaction', async () => {
    const { firestore, repository } = repoWithSeed();
    const created = user();
    const result = await repository.createOrUpdateWithEvents({
      user: created,
      events: [event()],
      identity: {
        auth0Subject: created.auth0Subject,
        normalizedEmail: created.normalizedEmail,
      },
      expectedUpdatedAt: null,
    });

    expectOk(result);
    expect(firestore.transactions).toHaveLength(1);
    expect(firestore.transactions[0]?.readIds).toEqual([
      'user-1',
      identityReservationId('auth0Subject', created.auth0Subject),
      identityReservationId('normalizedEmail', created.normalizedEmail),
      'event-1',
    ]);
    expect(firestore.transactions[0]?.writeIds).toEqual(
      expect.arrayContaining([
        'user-1',
        'event-1',
        identityReservationId('auth0Subject', created.auth0Subject),
        identityReservationId('normalizedEmail', created.normalizedEmail),
      ])
    );
    expect(firestore.collection(USERS_COLLECTION).docs.get('user-1')).toMatchObject({
      auth0Subject: 'auth0|user-1',
      deletedAt: null,
    });
    expect(firestore.collection(CHANGE_EVENTS_COLLECTION).docs.get('event-1')).toMatchObject({
      targetUserId: 'user-1',
    });

    const updated = {
      ...created,
      email: 'new@example.com',
      normalizedEmail: 'new@example.com',
      updatedAt: '2026-06-17T10:00:00.000Z',
    };
    expectOk(
      await repository.createOrUpdateWithEvents({
        user: updated,
        events: [event({ id: 'event-2', createdAt: '2026-06-17T10:00:00.000Z' })],
        identity: {
          auth0Subject: updated.auth0Subject,
          normalizedEmail: updated.normalizedEmail,
          previousNormalizedEmail: created.normalizedEmail,
        },
        expectedUpdatedAt: created.updatedAt,
      })
    );

    expect(firestore.transactions).toHaveLength(2);
    expect(firestore.transactions[1]?.readIds).toEqual([
      'user-1',
      identityReservationId('auth0Subject', updated.auth0Subject),
      identityReservationId('normalizedEmail', updated.normalizedEmail),
      identityReservationId('normalizedEmail', created.normalizedEmail),
      'event-2',
    ]);
    expect(
      reservationFromDoc(
        identityReservationId('normalizedEmail', created.normalizedEmail),
        firestore
          .collection(IDENTITY_RESERVATIONS_COLLECTION)
          .docs.get(identityReservationId('normalizedEmail', created.normalizedEmail)) ?? {}
      )
    ).toMatchObject({
      active: false,
      releasedAt: '2026-06-17T10:00:00.000Z',
    });
    expect(
      reservationFromDoc(
        identityReservationId('normalizedEmail', updated.normalizedEmail),
        firestore
          .collection(IDENTITY_RESERVATIONS_COLLECTION)
          .docs.get(identityReservationId('normalizedEmail', updated.normalizedEmail)) ?? {}
      )
    ).toMatchObject({
      active: true,
      userId: 'user-1',
    });
  });

  it('looks up active users by Auth0 subject, normalized email, and direct id', async () => {
    const active = user({ id: 'active' });
    const deleted = user({
      id: 'deleted',
      auth0Subject: active.auth0Subject,
      normalizedEmail: active.normalizedEmail,
      deletedAt: '2026-06-17T11:00:00.000Z',
    });
    const { repository } = repoWithSeed([deleted, active]);

    await expect(repository.findActiveByAuth0Subject(active.auth0Subject)).resolves.toMatchObject({
      ok: true,
      value: { id: 'active' },
    });
    await expect(
      repository.findActiveByNormalizedEmail(active.normalizedEmail)
    ).resolves.toMatchObject({
      ok: true,
      value: { id: 'active' },
    });
    await expect(
      repository.resolveByAuth0Identity({
        auth0Subject: active.auth0Subject,
        normalizedEmail: active.normalizedEmail,
      })
    ).resolves.toMatchObject({ ok: true, value: { id: 'active' } });
    await expect(repository.getById('deleted')).resolves.toEqual({ ok: true, value: null });
  });

  it('returns null for missing and mismatched active user lookups', async () => {
    const active = user({ id: 'active' });
    const { repository } = repoWithSeed([active]);

    await expect(repository.findActiveByAuth0Subject('auth0|missing')).resolves.toEqual({
      ok: true,
      value: null,
    });
    await expect(repository.findActiveByNormalizedEmail('missing@example.com')).resolves.toEqual({
      ok: true,
      value: null,
    });
    await expect(
      repository.resolveByAuth0Identity({
        auth0Subject: active.auth0Subject,
        normalizedEmail: 'wrong@example.com',
      })
    ).resolves.toEqual({ ok: true, value: null });
    await expect(repository.getById('missing')).resolves.toEqual({ ok: true, value: null });
  });

  it('lists pending users with stable cursors and excludes soft-deleted page-boundary rows', async () => {
    const { repository } = repoWithSeed([
      user({
        id: 'deleted-before',
        status: 'pending',
        createdAt: '2026-06-17T08:59:00.000Z',
        deletedAt: '2026-06-17T10:00:00.000Z',
      }),
      user({ id: 'a', status: 'pending', createdAt: '2026-06-17T09:00:00.000Z' }),
      user({
        id: 'deleted-inside',
        status: 'pending',
        createdAt: '2026-06-17T09:00:00.000Z',
        deletedAt: '2026-06-17T10:00:00.000Z',
      }),
      user({ id: 'b', status: 'pending', createdAt: '2026-06-17T09:00:00.000Z' }),
      user({
        id: 'deleted-after',
        status: 'pending',
        createdAt: '2026-06-17T09:01:00.000Z',
        deletedAt: '2026-06-17T10:00:00.000Z',
      }),
      user({ id: 'c', status: 'pending', createdAt: '2026-06-17T09:02:00.000Z' }),
    ]);

    const page = expectOk(await repository.listPending({ limit: 2, cursor: null }));
    expect(page.users.map((listed) => listed.id)).toEqual(['a', 'b']);
    expect(page.nextCursor).toEqual({ sortValue: '2026-06-17T09:00:00.000Z', id: 'b' });
    const next = expectOk(await repository.listPending({ limit: 2, cursor: page.nextCursor }));
    expect(next.users.map((listed) => listed.id)).toEqual(['c']);
    await expect(repository.countPending()).resolves.toEqual({ ok: true, value: 3 });
  });

  it('lists admin users with status, role, and level filter combinations', async () => {
    const { repository } = repoWithSeed([
      user({
        id: 'approved-admin',
        role: 'admin',
        level: null,
        updatedAt: '2026-06-17T09:03:00.000Z',
      }),
      user({ id: 'approved-level-3', level: 3, updatedAt: '2026-06-17T09:02:00.000Z' }),
      user({
        id: 'pending-level-3',
        status: 'pending',
        level: 3,
        updatedAt: '2026-06-17T09:01:00.000Z',
      }),
      user({
        id: 'pending-level-5',
        status: 'pending',
        level: 5,
        updatedAt: '2026-06-17T09:00:00.000Z',
      }),
    ]);

    await expect(
      repository.listUsers({ filters: {}, limit: 10, cursor: null })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        users: [
          { id: 'approved-admin' },
          { id: 'approved-level-3' },
          { id: 'pending-level-3' },
          { id: 'pending-level-5' },
        ],
      },
    });
    await expect(
      repository.listUsers({ filters: { status: 'pending' }, limit: 10, cursor: null })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        totalCount: 2,
        users: [{ id: 'pending-level-3' }, { id: 'pending-level-5' }],
      },
    });
    await expect(
      repository.listUsers({ filters: { role: 'admin' }, limit: 10, cursor: null })
    ).resolves.toMatchObject({
      ok: true,
      value: { users: [{ id: 'approved-admin' }] },
    });
    await expect(
      repository.listUsers({ filters: { level: 3 }, limit: 10, cursor: null })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        totalCount: 2,
        users: [{ id: 'approved-level-3' }, { id: 'pending-level-3' }],
      },
    });
    await expect(
      repository.listUsers({
        filters: { status: 'pending', role: 'user' },
        limit: 10,
        cursor: null,
      })
    ).resolves.toMatchObject({
      ok: true,
      value: { users: [{ id: 'pending-level-3' }, { id: 'pending-level-5' }] },
    });
    await expect(
      repository.listUsers({
        filters: { status: 'pending', level: 3 },
        limit: 10,
        cursor: null,
      })
    ).resolves.toMatchObject({
      ok: true,
      value: { users: [{ id: 'pending-level-3' }] },
    });
    await expect(
      repository.listUsers({
        filters: { role: 'user', level: 3 },
        limit: 10,
        cursor: null,
      })
    ).resolves.toMatchObject({
      ok: true,
      value: { users: [{ id: 'approved-level-3' }, { id: 'pending-level-3' }] },
    });
    await expect(
      repository.listUsers({
        filters: { status: 'pending', role: 'user', level: 3 },
        limit: 10,
        cursor: null,
      })
    ).resolves.toMatchObject({
      ok: true,
      value: { users: [{ id: 'pending-level-3' }] },
    });
  });

  it('filters listed admin users by email, name, user id, and phone search text', async () => {
    const { repository } = repoWithSeed([
      user({
        id: 'river-user',
        email: 'river.walker@example.com',
        normalizedEmail: 'river.walker@example.com',
        firstName: 'River',
        lastName: 'Walker',
        mobileNumber: '+15550101111',
        updatedAt: '2026-06-17T09:03:00.000Z',
      }),
      user({
        id: 'lake-user',
        email: 'lake@example.com',
        normalizedEmail: 'lake@example.com',
        firstName: 'Lake',
        lastName: 'Tester',
        mobileNumber: '+15550102222',
        updatedAt: '2026-06-17T09:02:00.000Z',
      }),
    ]);

    await expect(
      repository.listUsers({ filters: { query: 'river walker' }, limit: 10, cursor: null })
    ).resolves.toMatchObject({
      ok: true,
      value: { users: [{ id: 'river-user' }] },
    });
    await expect(
      repository.listUsers({ filters: { query: 'LAKE@EXAMPLE.COM' }, limit: 10, cursor: null })
    ).resolves.toMatchObject({
      ok: true,
      value: { users: [{ id: 'lake-user' }] },
    });
    await expect(
      repository.listUsers({ filters: { query: 'river-user' }, limit: 10, cursor: null })
    ).resolves.toMatchObject({
      ok: true,
      value: { users: [{ id: 'river-user' }] },
    });
    await expect(
      repository.listUsers({ filters: { query: '+15550102222' }, limit: 10, cursor: null })
    ).resolves.toMatchObject({
      ok: true,
      value: { users: [{ id: 'lake-user' }] },
    });
  });

  it('lists user history by createdAt descending with cursors only for active users', async () => {
    const active = user({ id: 'active' });
    const deleted = user({ id: 'deleted', deletedAt: '2026-06-17T10:00:00.000Z' });
    const { firestore, repository } = repoWithSeed([active, deleted]);
    firestore
      .collection(CHANGE_EVENTS_COLLECTION)
      .docs.set(
        'event-b',
        eventToDoc(
          event({ id: 'event-b', targetUserId: 'active', createdAt: '2026-06-17T09:02:00.000Z' })
        )
      );
    firestore
      .collection(CHANGE_EVENTS_COLLECTION)
      .docs.set(
        'event-a',
        eventToDoc(
          event({ id: 'event-a', targetUserId: 'active', createdAt: '2026-06-17T09:02:00.000Z' })
        )
      );
    firestore
      .collection(CHANGE_EVENTS_COLLECTION)
      .docs.set(
        'event-c',
        eventToDoc(
          event({ id: 'event-c', targetUserId: 'active', createdAt: '2026-06-17T09:01:00.000Z' })
        )
      );
    firestore
      .collection(CHANGE_EVENTS_COLLECTION)
      .docs.set(
        'deleted-event',
        eventToDoc(event({ id: 'deleted-event', targetUserId: 'deleted' }))
      );

    const page = expectOk(
      await repository.listHistory({ targetUserId: 'active', limit: 2, cursor: null })
    );
    expect(page.events.map((listed) => listed.id)).toEqual(['event-a', 'event-b']);
    expect(page.nextCursor).toEqual({ sortValue: '2026-06-17T09:02:00.000Z', id: 'event-b' });
    const next = expectOk(
      await repository.listHistory({ targetUserId: 'active', limit: 2, cursor: page.nextCursor })
    );
    expect(next.events.map((listed) => listed.id)).toEqual(['event-c']);
    await expect(
      repository.listHistory({ targetUserId: 'deleted', limit: 10, cursor: null })
    ).resolves.toEqual({ ok: true, value: { events: [], nextCursor: null } });
  });

  it('returns conflict for reservation uniqueness and stale writes fail precondition', async () => {
    const first = user({ id: 'first' });
    const second = user({
      id: 'second',
      auth0Subject: 'auth0|second',
      email: first.email,
      normalizedEmail: first.normalizedEmail,
    });
    const { repository } = repoWithSeed();

    expectOk(
      await repository.createOrUpdateWithEvents({
        user: first,
        events: [],
        identity: { auth0Subject: first.auth0Subject, normalizedEmail: first.normalizedEmail },
        expectedUpdatedAt: null,
      })
    );
    await expect(
      repository.createOrUpdateWithEvents({
        user: second,
        events: [],
        identity: { auth0Subject: second.auth0Subject, normalizedEmail: second.normalizedEmail },
        expectedUpdatedAt: null,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repository.createOrUpdateWithEvents({
        user: { ...first, updatedAt: '2026-06-17T10:00:00.000Z' },
        events: [],
        identity: { auth0Subject: first.auth0Subject, normalizedEmail: first.normalizedEmail },
        expectedUpdatedAt: 'stale',
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } });
    await expect(
      repository.createOrUpdateWithEvents({
        user: first,
        events: [],
        identity: { auth0Subject: first.auth0Subject, normalizedEmail: first.normalizedEmail },
        expectedUpdatedAt: null,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } });
    await expect(
      repository.createOrUpdateWithEvents({
        user: user({ id: 'missing-update' }),
        events: [],
        identity: {
          auth0Subject: 'auth0|missing-update',
          normalizedEmail: 'missing-update@example.com',
        },
        expectedUpdatedAt: '2026-06-17T09:00:00.000Z',
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } });
    await expect(
      repository.createOrUpdateWithEvents({
        user: {
          ...first,
          updatedAt: '2026-06-17T10:05:00.000Z',
        },
        events: [
          event({ id: 'duplicate-in-input', targetUserId: first.id }),
          event({
            id: 'duplicate-in-input',
            targetUserId: first.id,
            type: 'status_changed',
            createdAt: '2026-06-17T10:05:00.000Z',
          }),
        ],
        identity: { auth0Subject: first.auth0Subject, normalizedEmail: first.normalizedEmail },
        expectedUpdatedAt: first.updatedAt,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('rejects admin mutations when the actor precondition is stale or no longer admin', async () => {
    const admin = user({ id: 'admin-1', role: 'admin', level: null });
    const target = user({ id: 'admin-target' });
    const { repository } = repoWithSeed([admin, target]);

    await expect(
      repository.createOrUpdateWithEvents({
        user: { ...target, updatedAt: '2026-06-17T10:06:00.000Z' },
        events: [],
        identity: {
          auth0Subject: target.auth0Subject,
          normalizedEmail: target.normalizedEmail,
        },
        adminActorPrecondition: {
          actorUserId: admin.id,
          expectedUpdatedAt: 'stale-admin',
        },
        expectedUpdatedAt: target.updatedAt,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } });

    const { repository: demotedRepository } = repoWithSeed([
      { ...admin, role: 'user', level: 1 },
      target,
    ]);
    await expect(
      demotedRepository.createOrUpdateWithEvents({
        user: { ...target, updatedAt: '2026-06-17T10:07:00.000Z' },
        events: [],
        identity: {
          auth0Subject: target.auth0Subject,
          normalizedEmail: target.normalizedEmail,
        },
        adminActorPrecondition: {
          actorUserId: admin.id,
          expectedUpdatedAt: admin.updatedAt,
        },
        expectedUpdatedAt: target.updatedAt,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } });
  });

  it('does not release previous email reservations owned by another user', async () => {
    const existing = user({ id: 'release-user' });
    const { firestore, repository } = repoWithSeed();
    expectOk(
      await repository.createOrUpdateWithEvents({
        user: existing,
        events: [],
        identity: {
          auth0Subject: existing.auth0Subject,
          normalizedEmail: existing.normalizedEmail,
        },
        expectedUpdatedAt: null,
      })
    );
    const otherReservationId = identityReservationId('normalizedEmail', 'other@example.com');
    firestore.collection(IDENTITY_RESERVATIONS_COLLECTION).docs.set(
      otherReservationId,
      reservationToDoc({
        id: otherReservationId,
        kind: 'normalizedEmail',
        valueHash: 'other-hash',
        userId: 'other-user',
        active: true,
        createdAt: '2026-06-17T08:00:00.000Z',
        updatedAt: '2026-06-17T08:00:00.000Z',
        releasedAt: null,
      })
    );

    expectOk(
      await repository.createOrUpdateWithEvents({
        user: {
          ...existing,
          email: 'new-release@example.com',
          normalizedEmail: 'new-release@example.com',
          updatedAt: '2026-06-17T10:00:00.000Z',
        },
        events: [],
        identity: {
          auth0Subject: existing.auth0Subject,
          normalizedEmail: 'new-release@example.com',
          previousNormalizedEmail: 'other@example.com',
        },
        expectedUpdatedAt: existing.updatedAt,
      })
    );

    expect(
      reservationFromDoc(
        otherReservationId,
        firestore.collection(IDENTITY_RESERVATIONS_COLLECTION).docs.get(otherReservationId) ?? {}
      )
    ).toMatchObject({
      userId: 'other-user',
      active: true,
      releasedAt: null,
    });
  });

  it('rejects duplicate history event ids without overwriting the event or user', async () => {
    const originalUser = user();
    const { firestore, repository } = repoWithSeed();
    const originalEvent = event({
      id: 'event-duplicate',
      targetUserId: originalUser.id,
      after: { firstName: 'Original' },
    });

    expectOk(
      await repository.createOrUpdateWithEvents({
        user: originalUser,
        events: [originalEvent],
        identity: {
          auth0Subject: originalUser.auth0Subject,
          normalizedEmail: originalUser.normalizedEmail,
        },
        expectedUpdatedAt: null,
      })
    );

    await expect(
      repository.createOrUpdateWithEvents({
        user: {
          ...originalUser,
          firstName: 'Overwritten',
          updatedAt: '2026-06-17T10:00:00.000Z',
        },
        events: [
          {
            ...originalEvent,
            after: { firstName: 'Overwritten' },
            createdAt: '2026-06-17T10:00:00.000Z',
          },
        ],
        identity: {
          auth0Subject: originalUser.auth0Subject,
          normalizedEmail: originalUser.normalizedEmail,
        },
        expectedUpdatedAt: originalUser.updatedAt,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });

    expect(firestore.collection(USERS_COLLECTION).docs.get(originalUser.id)).toMatchObject({
      firstName: 'Pat',
      updatedAt: timestampFromIso(originalUser.updatedAt),
    });
    expect(
      firestore.collection(CHANGE_EVENTS_COLLECTION).docs.get('event-duplicate')
    ).toMatchObject({
      after: { firstName: 'Original' },
      createdAt: timestampFromIso(originalEvent.createdAt),
    });
  });

  it('contends email-change attempts on deterministic reservation documents', async () => {
    const first = user({ id: 'first' });
    const other = user({
      id: 'other',
      auth0Subject: 'auth0|other',
      email: 'other@example.com',
      normalizedEmail: 'other@example.com',
    });
    const { repository } = repoWithSeed();
    expectOk(
      await repository.createOrUpdateWithEvents({
        user: first,
        events: [],
        identity: { auth0Subject: first.auth0Subject, normalizedEmail: first.normalizedEmail },
        expectedUpdatedAt: null,
      })
    );
    expectOk(
      await repository.createOrUpdateWithEvents({
        user: other,
        events: [],
        identity: { auth0Subject: other.auth0Subject, normalizedEmail: other.normalizedEmail },
        expectedUpdatedAt: null,
      })
    );

    await expect(
      repository.createOrUpdateWithEvents({
        user: {
          ...other,
          email: first.email,
          normalizedEmail: first.normalizedEmail,
          updatedAt: '2026-06-17T10:00:00.000Z',
        },
        events: [],
        identity: {
          auth0Subject: other.auth0Subject,
          normalizedEmail: first.normalizedEmail,
          previousNormalizedEmail: other.normalizedEmail,
        },
        expectedUpdatedAt: other.updatedAt,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });
});
