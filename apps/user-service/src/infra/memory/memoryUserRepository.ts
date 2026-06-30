import { createHash } from 'node:crypto';

import { err, ok, type Result } from '@fa/common-core';

import type { FaUser, UserChangeEvent, UserIdentityReservation } from '../../domain/models/user.js';
import type {
  UserFilters,
  UserHistoryPage,
  UserListCursor,
  UserListPage,
  UserRepository,
  UserRepositoryError,
} from '../../domain/repositories/userRepositories.js';

function cloneUser(user: FaUser): FaUser {
  return structuredClone(user);
}

function cloneEvent(event: UserChangeEvent): UserChangeEvent {
  return structuredClone(event);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function reservationId(kind: UserIdentityReservation['kind'], value: string): string {
  return `${kind}:${sha256(value)}`;
}

function pageByCursor<T>(
  rows: T[],
  input: { limit: number; cursor: UserListCursor | null },
  sortValue: (row: T) => string,
  id: (row: T) => string,
  direction: 'asc' | 'desc'
): { rows: T[]; nextCursor: UserListCursor | null } {
  const afterCursor =
    input.cursor === null
      ? rows
      : rows.filter((row) => {
          const cursor = input.cursor;
          if (cursor === null) {
            return true;
          }

          const value = sortValue(row);
          if (value === cursor.sortValue) {
            return id(row) > cursor.id;
          }

          return direction === 'asc' ? value > cursor.sortValue : value < cursor.sortValue;
        });
  const page = afterCursor.slice(0, input.limit);
  const hasNext = afterCursor.length > input.limit;
  const last = page.at(-1);

  return {
    rows: page,
    nextCursor: hasNext && last !== undefined ? { sortValue: sortValue(last), id: id(last) } : null,
  };
}

function compareAsc(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

function activeUser(user: FaUser): boolean {
  return user.deletedAt === null;
}

function normalizedSearchText(value: string): string {
  return value.trim().toLocaleLowerCase('pl-PL').replace(/\s+/g, ' ');
}

function searchableUserValues(user: FaUser): string[] {
  const names = [user.firstName, user.lastName].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );
  return [
    user.id,
    user.email,
    user.normalizedEmail,
    user.mobileNumber,
    user.firstName,
    user.lastName,
    names.join(' '),
    [...names].reverse().join(' '),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function matchesSearch(user: FaUser, query: string | undefined): boolean {
  if (query === undefined || query.trim().length === 0) {
    return true;
  }

  const needle = normalizedSearchText(query);
  return searchableUserValues(user).some((value) => normalizedSearchText(value).includes(needle));
}

function matchesFilters(user: FaUser, filters: UserFilters): boolean {
  return (
    (filters.status === undefined || user.status === filters.status) &&
    (filters.role === undefined || user.role === filters.role) &&
    (filters.level === undefined || user.level === filters.level) &&
    matchesSearch(user, filters.query)
  );
}

export class MemoryUserRepository implements UserRepository {
  readonly users = new Map<string, FaUser>();
  readonly events = new Map<string, UserChangeEvent>();
  readonly identityReservations = new Map<string, UserIdentityReservation>();

  seed(user: FaUser): void {
    this.users.set(user.id, cloneUser(user));
    this.reserveIdentity(
      'auth0Subject',
      user.auth0Subject,
      user.id,
      user.createdAt,
      user.updatedAt
    );
    this.reserveIdentity(
      'normalizedEmail',
      user.normalizedEmail,
      user.id,
      user.createdAt,
      user.updatedAt
    );
  }

  resolveByAuth0Identity(input: {
    auth0Subject: string;
    normalizedEmail: string;
  }): Promise<Result<FaUser | null, UserRepositoryError>> {
    const user = [...this.users.values()].find(
      (candidate) =>
        activeUser(candidate) &&
        candidate.auth0Subject === input.auth0Subject &&
        candidate.normalizedEmail === input.normalizedEmail
    );

    return Promise.resolve(ok(user === undefined ? null : cloneUser(user)));
  }

  findActiveByAuth0Subject(
    auth0Subject: string
  ): Promise<Result<FaUser | null, UserRepositoryError>> {
    const user = [...this.users.values()].find(
      (candidate) => activeUser(candidate) && candidate.auth0Subject === auth0Subject
    );

    return Promise.resolve(ok(user === undefined ? null : cloneUser(user)));
  }

  findActiveByNormalizedEmail(
    normalizedEmail: string
  ): Promise<Result<FaUser | null, UserRepositoryError>> {
    const user = [...this.users.values()].find(
      (candidate) => activeUser(candidate) && candidate.normalizedEmail === normalizedEmail
    );

    return Promise.resolve(ok(user === undefined ? null : cloneUser(user)));
  }

  getById(userId: string): Promise<Result<FaUser | null, UserRepositoryError>> {
    const user = this.users.get(userId);
    return Promise.resolve(ok(user !== undefined && activeUser(user) ? cloneUser(user) : null));
  }

  createOrUpdateWithEvents(input: {
    user: FaUser;
    events: UserChangeEvent[];
    identity: {
      auth0Subject: string;
      normalizedEmail: string;
      previousNormalizedEmail?: string | null;
    };
    adminActorPrecondition?: {
      actorUserId: string;
      expectedUpdatedAt: string;
    };
    expectedUpdatedAt: string | null;
  }): Promise<Result<FaUser, UserRepositoryError>> {
    const existing = this.users.get(input.user.id);
    if (input.expectedUpdatedAt === null && existing !== undefined) {
      return Promise.resolve(
        err({ code: 'PRECONDITION_FAILED', message: `User ${input.user.id} already exists` })
      );
    }

    if (input.expectedUpdatedAt !== null && existing?.updatedAt !== input.expectedUpdatedAt) {
      return Promise.resolve(
        err({ code: 'PRECONDITION_FAILED', message: `User ${input.user.id} update is stale` })
      );
    }

    const actorPreconditionError = this.adminActorPreconditionError(input.adminActorPrecondition);
    if (actorPreconditionError !== null) {
      return Promise.resolve(err(actorPreconditionError));
    }

    const conflict = this.identityConflict(
      'auth0Subject',
      input.identity.auth0Subject,
      input.user.id
    );
    if (conflict !== null) {
      return Promise.resolve(err(conflict));
    }

    const emailConflict = this.identityConflict(
      'normalizedEmail',
      input.identity.normalizedEmail,
      input.user.id
    );
    if (emailConflict !== null) {
      return Promise.resolve(err(emailConflict));
    }

    const eventConflict = this.eventConflict(input.events);
    if (eventConflict !== null) {
      return Promise.resolve(err(eventConflict));
    }

    this.releasePreviousEmail(input);
    this.reserveIdentity(
      'auth0Subject',
      input.identity.auth0Subject,
      input.user.id,
      input.user.createdAt,
      input.user.updatedAt
    );
    this.reserveIdentity(
      'normalizedEmail',
      input.identity.normalizedEmail,
      input.user.id,
      input.user.createdAt,
      input.user.updatedAt
    );
    this.users.set(input.user.id, cloneUser(input.user));
    for (const event of input.events) {
      this.events.set(event.id, cloneEvent(event));
    }

    return Promise.resolve(ok(cloneUser(input.user)));
  }

  listPending(input: {
    limit: number;
    cursor: UserListCursor | null;
  }): Promise<Result<UserListPage, UserRepositoryError>> {
    const sorted = [...this.users.values()]
      .filter((user) => activeUser(user) && user.status === 'pending')
      .sort(
        (left, right) =>
          compareAsc(left.createdAt, right.createdAt) || compareAsc(left.id, right.id)
      );
    const page = pageByCursor(
      sorted,
      input,
      (user) => user.createdAt,
      (user) => user.id,
      'asc'
    );

    return Promise.resolve(
      ok({
        users: page.rows.map(cloneUser),
        nextCursor: page.nextCursor,
        totalCount: sorted.length,
      })
    );
  }

  countPending(): Promise<Result<number, UserRepositoryError>> {
    return Promise.resolve(
      ok(
        [...this.users.values()].filter((user) => activeUser(user) && user.status === 'pending')
          .length
      )
    );
  }

  listUsers(input: {
    filters: UserFilters;
    limit: number;
    cursor: UserListCursor | null;
  }): Promise<Result<UserListPage, UserRepositoryError>> {
    const sorted = [...this.users.values()]
      .filter((user) => activeUser(user) && matchesFilters(user, input.filters))
      .sort(
        (left, right) =>
          compareDesc(left.updatedAt, right.updatedAt) || compareAsc(left.id, right.id)
      );
    const page = pageByCursor(
      sorted,
      input,
      (user) => user.updatedAt,
      (user) => user.id,
      'desc'
    );

    return Promise.resolve(
      ok({
        users: page.rows.map(cloneUser),
        nextCursor: page.nextCursor,
        totalCount: sorted.length,
      })
    );
  }

  listHistory(input: {
    targetUserId: string;
    limit: number;
    cursor: UserListCursor | null;
  }): Promise<Result<UserHistoryPage, UserRepositoryError>> {
    const target = this.users.get(input.targetUserId);
    if (target === undefined || !activeUser(target)) {
      return Promise.resolve(ok({ events: [], nextCursor: null }));
    }

    const sorted = [...this.events.values()]
      .filter((event) => event.targetUserId === input.targetUserId)
      .sort(
        (left, right) =>
          compareDesc(left.createdAt, right.createdAt) || compareAsc(left.id, right.id)
      );
    const page = pageByCursor(
      sorted,
      input,
      (event) => event.createdAt,
      (event) => event.id,
      'desc'
    );

    return Promise.resolve(ok({ events: page.rows.map(cloneEvent), nextCursor: page.nextCursor }));
  }

  private identityConflict(
    kind: UserIdentityReservation['kind'],
    value: string,
    userId: string
  ): UserRepositoryError | null {
    const existing = this.identityReservations.get(reservationId(kind, value));
    if (existing !== undefined && existing.active && existing.userId !== userId) {
      return { code: 'CONFLICT', message: `${kind} is already reserved` };
    }

    return null;
  }

  private adminActorPreconditionError(
    precondition:
      | {
          actorUserId: string;
          expectedUpdatedAt: string;
        }
      | undefined
  ): UserRepositoryError | null {
    if (precondition === undefined) {
      return null;
    }

    const actor = this.users.get(precondition.actorUserId);
    if (
      actor === undefined ||
      !activeUser(actor) ||
      actor.updatedAt !== precondition.expectedUpdatedAt ||
      actor.status !== 'approved' ||
      actor.role !== 'admin'
    ) {
      return {
        code: 'PRECONDITION_FAILED',
        message: 'Admin actor authorization changed.',
      };
    }

    return null;
  }

  private eventConflict(events: UserChangeEvent[]): UserRepositoryError | null {
    const eventIds = new Set<string>();
    for (const event of events) {
      if (eventIds.has(event.id) || this.events.has(event.id)) {
        return { code: 'CONFLICT', message: `History event ${event.id} already exists` };
      }
      eventIds.add(event.id);
    }

    return null;
  }

  private reserveIdentity(
    kind: UserIdentityReservation['kind'],
    value: string,
    userId: string,
    createdAt: string,
    updatedAt: string
  ): void {
    const id = reservationId(kind, value);
    const existing = this.identityReservations.get(id);
    this.identityReservations.set(id, {
      id,
      kind,
      valueHash: sha256(value),
      userId,
      active: true,
      createdAt: existing?.createdAt ?? createdAt,
      updatedAt,
      releasedAt: null,
    });
  }

  private releasePreviousEmail(input: {
    user: FaUser;
    identity: {
      normalizedEmail: string;
      previousNormalizedEmail?: string | null;
    };
  }): void {
    const previous = input.identity.previousNormalizedEmail;
    if (
      previous === undefined ||
      previous === null ||
      previous === input.identity.normalizedEmail
    ) {
      return;
    }

    const previousId = reservationId('normalizedEmail', previous);
    const reservation = this.identityReservations.get(previousId);
    if (reservation?.userId !== input.user.id) {
      return;
    }

    this.identityReservations.set(previousId, {
      ...reservation,
      active: false,
      updatedAt: input.user.updatedAt,
      releasedAt: input.user.updatedAt,
    });
  }
}
