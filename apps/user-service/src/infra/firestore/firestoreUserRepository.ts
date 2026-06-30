import { err, getErrorMessage, ok, type Result } from '@fa/common-core';
import { getFirestore, type Firestore, type Query } from '@fa/infra-firestore';

import type { FaUser, UserChangeEvent, UserIdentityReservation } from '../../domain/models/user.js';
import type {
  UserFilters,
  UserHistoryPage,
  UserListCursor,
  UserListPage,
  UserRepository,
  UserRepositoryError,
} from '../../domain/repositories/userRepositories.js';
import {
  CHANGE_EVENTS_COLLECTION,
  IDENTITY_RESERVATIONS_COLLECTION,
  USERS_COLLECTION,
} from './collections.js';
import {
  eventFromDoc,
  eventToDoc,
  identityReservationId,
  identityValueHash,
  reservationFromDoc,
  reservationToDoc,
  userFromDoc,
  userToDoc,
} from './firestoreMapping.js';

class RepositoryFailure extends Error {
  constructor(readonly error: UserRepositoryError) {
    super(error.message);
  }
}

function repositoryError(error: unknown): UserRepositoryError {
  if (error instanceof RepositoryFailure) {
    return error.error;
  }

  return { code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'Firestore operation failed') };
}

function docData(snapshot: { data: () => unknown }): Record<string, unknown> {
  return snapshot.data() as Record<string, unknown>;
}

function compareAsc(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareDesc(left: string, right: string): number {
  return right.localeCompare(left);
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
  const last = page.at(-1);

  return {
    rows: page,
    nextCursor:
      afterCursor.length > input.limit && last !== undefined
        ? { sortValue: sortValue(last), id: id(last) }
        : null,
  };
}

function matchesFilters(user: FaUser, filters: UserFilters): boolean {
  return (
    (filters.status === undefined || user.status === filters.status) &&
    (filters.role === undefined || user.role === filters.role) &&
    (filters.level === undefined || user.level === filters.level) &&
    matchesSearch(user, filters.query)
  );
}

function fail(error: UserRepositoryError): never {
  throw new RepositoryFailure(error);
}

export class FirestoreUserRepository implements UserRepository {
  constructor(private readonly firestore?: Firestore) {}

  private get db(): Firestore {
    return this.firestore ?? getFirestore();
  }

  async resolveByAuth0Identity(input: {
    auth0Subject: string;
    normalizedEmail: string;
  }): Promise<Result<FaUser | null, UserRepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(USERS_COLLECTION)
        .where('auth0Subject', '==', input.auth0Subject)
        .where('deletedAt', '==', null)
        .get();
      const user =
        snapshot.docs
          .map((doc) => userFromDoc(doc.id, docData(doc)))
          .find((candidate) => candidate.normalizedEmail === input.normalizedEmail) ?? null;

      return ok(user);
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async findActiveByAuth0Subject(
    auth0Subject: string
  ): Promise<Result<FaUser | null, UserRepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(USERS_COLLECTION)
        .where('auth0Subject', '==', auth0Subject)
        .where('deletedAt', '==', null)
        .limit(1)
        .get();
      const doc = snapshot.docs[0];

      return ok(doc === undefined ? null : userFromDoc(doc.id, docData(doc)));
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async findActiveByNormalizedEmail(
    normalizedEmail: string
  ): Promise<Result<FaUser | null, UserRepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(USERS_COLLECTION)
        .where('normalizedEmail', '==', normalizedEmail)
        .where('deletedAt', '==', null)
        .limit(1)
        .get();
      const doc = snapshot.docs[0];

      return ok(doc === undefined ? null : userFromDoc(doc.id, docData(doc)));
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async getById(userId: string): Promise<Result<FaUser | null, UserRepositoryError>> {
    try {
      const snapshot = await this.db.collection(USERS_COLLECTION).doc(userId).get();
      if (!snapshot.exists) {
        return ok(null);
      }

      const user = userFromDoc(snapshot.id, docData(snapshot));
      return ok(user.deletedAt === null ? user : null);
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async createOrUpdateWithEvents(input: {
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
    try {
      await this.db.runTransaction(async (transaction) => {
        const users = this.db.collection(USERS_COLLECTION);
        const reservations = this.db.collection(IDENTITY_RESERVATIONS_COLLECTION);
        const events = this.db.collection(CHANGE_EVENTS_COLLECTION);
        const userRef = users.doc(input.user.id);
        const actorRef =
          input.adminActorPrecondition === undefined
            ? null
            : users.doc(input.adminActorPrecondition.actorUserId);
        const eventRefs = input.events.map((event) => events.doc(event.id));
        const subjectRef = reservations.doc(
          identityReservationId('auth0Subject', input.identity.auth0Subject)
        );
        const emailRef = reservations.doc(
          identityReservationId('normalizedEmail', input.identity.normalizedEmail)
        );
        const previousEmail =
          input.identity.previousNormalizedEmail !== undefined &&
          input.identity.previousNormalizedEmail !== null &&
          input.identity.previousNormalizedEmail !== input.identity.normalizedEmail
            ? input.identity.previousNormalizedEmail
            : null;
        const previousEmailRef =
          previousEmail === null
            ? null
            : reservations.doc(identityReservationId('normalizedEmail', previousEmail));

        const userSnapshot = await transaction.get(userRef);
        const actorSnapshot =
          actorRef === null
            ? null
            : actorRef.id === userRef.id
              ? userSnapshot
              : await transaction.get(actorRef);
        const subjectSnapshot = await transaction.get(subjectRef);
        const emailSnapshot = await transaction.get(emailRef);
        const previousEmailSnapshot =
          previousEmailRef === null ? null : await transaction.get(previousEmailRef);
        const eventSnapshots = await Promise.all(
          eventRefs.map((eventRef) => transaction.get(eventRef))
        );

        this.verifyUserPrecondition(input, userSnapshot);
        this.verifyAdminActorPrecondition(input.adminActorPrecondition, actorSnapshot);
        this.verifyReservation('auth0Subject', subjectSnapshot, input.user.id);
        this.verifyReservation('normalizedEmail', emailSnapshot, input.user.id);
        this.verifyEventPreconditions(input.events, eventSnapshots);

        if (previousEmailSnapshot !== null && previousEmailRef !== null) {
          const releasedPreviousEmail = this.releasedPreviousEmailReservation(
            previousEmailSnapshot,
            input.user
          );
          if (releasedPreviousEmail !== null) {
            transaction.set(previousEmailRef, releasedPreviousEmail);
          }
        }

        transaction.set(userRef, userToDoc(input.user));
        transaction.set(
          subjectRef,
          reservationToDoc(
            this.nextReservation(
              'auth0Subject',
              input.identity.auth0Subject,
              subjectSnapshot,
              input.user
            )
          )
        );
        transaction.set(
          emailRef,
          reservationToDoc(
            this.nextReservation(
              'normalizedEmail',
              input.identity.normalizedEmail,
              emailSnapshot,
              input.user
            )
          )
        );
        for (const [index, event] of input.events.entries()) {
          const eventRef = eventRefs[index];
          if (eventRef === undefined) {
            throw new Error(`Missing user change event reference at index ${String(index)}.`);
          }
          transaction.set(eventRef, eventToDoc(event));
        }
      });

      return ok(input.user);
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async listPending(input: {
    limit: number;
    cursor: UserListCursor | null;
  }): Promise<Result<UserListPage, UserRepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(USERS_COLLECTION)
        .where('status', '==', 'pending')
        .where('deletedAt', '==', null)
        .orderBy('createdAt', 'asc')
        .orderBy('__name__', 'asc')
        .get();
      const sorted = snapshot.docs
        .map((doc) => userFromDoc(doc.id, docData(doc)))
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

      return ok({ users: page.rows, nextCursor: page.nextCursor, totalCount: sorted.length });
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async countPending(): Promise<Result<number, UserRepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(USERS_COLLECTION)
        .where('status', '==', 'pending')
        .where('deletedAt', '==', null)
        .get();

      return ok(snapshot.docs.length);
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async listUsers(input: {
    filters: UserFilters;
    limit: number;
    cursor: UserListCursor | null;
  }): Promise<Result<UserListPage, UserRepositoryError>> {
    try {
      let query: Query = this.db.collection(USERS_COLLECTION).where('deletedAt', '==', null);
      if (input.filters.status !== undefined) {
        query = query.where('status', '==', input.filters.status);
      }
      if (input.filters.role !== undefined) {
        query = query.where('role', '==', input.filters.role);
      }
      if (input.filters.level !== undefined) {
        query = query.where('level', '==', input.filters.level);
      }

      const snapshot = await query.orderBy('updatedAt', 'desc').orderBy('__name__', 'asc').get();
      const sorted = snapshot.docs
        .map((doc) => userFromDoc(doc.id, docData(doc)))
        .filter((user) => matchesFilters(user, input.filters))
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

      return ok({ users: page.rows, nextCursor: page.nextCursor, totalCount: sorted.length });
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async listHistory(input: {
    targetUserId: string;
    limit: number;
    cursor: UserListCursor | null;
  }): Promise<Result<UserHistoryPage, UserRepositoryError>> {
    try {
      const target = await this.getById(input.targetUserId);
      if (!target.ok) {
        return target;
      }
      if (target.value === null) {
        return ok({ events: [], nextCursor: null });
      }

      const snapshot = await this.db
        .collection(CHANGE_EVENTS_COLLECTION)
        .where('targetUserId', '==', input.targetUserId)
        .orderBy('createdAt', 'desc')
        .orderBy('__name__', 'asc')
        .get();
      const sorted = snapshot.docs
        .map((doc) => eventFromDoc(doc.id, docData(doc)))
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

      return ok({ events: page.rows, nextCursor: page.nextCursor });
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  private verifyEventPreconditions(
    events: UserChangeEvent[],
    snapshots: { exists: boolean; id: string }[]
  ): void {
    const eventIds = new Set<string>();
    for (const event of events) {
      if (eventIds.has(event.id)) {
        fail({ code: 'CONFLICT', message: `History event ${event.id} already exists` });
      }
      eventIds.add(event.id);
    }

    for (const snapshot of snapshots) {
      if (snapshot.exists) {
        fail({ code: 'CONFLICT', message: `History event ${snapshot.id} already exists` });
      }
    }
  }

  private verifyUserPrecondition(
    input: {
      expectedUpdatedAt: string | null;
      user: FaUser;
    },
    snapshot: { exists: boolean; id: string; data: () => unknown }
  ): void {
    if (input.expectedUpdatedAt === null) {
      if (snapshot.exists) {
        fail({ code: 'PRECONDITION_FAILED', message: `User ${input.user.id} already exists` });
      }
      return;
    }

    if (!snapshot.exists) {
      fail({ code: 'PRECONDITION_FAILED', message: `User ${input.user.id} update is stale` });
    }

    const stored = userFromDoc(snapshot.id, docData(snapshot));
    if (stored.updatedAt !== input.expectedUpdatedAt) {
      fail({ code: 'PRECONDITION_FAILED', message: `User ${input.user.id} update is stale` });
    }
  }

  private verifyAdminActorPrecondition(
    precondition:
      | {
          actorUserId: string;
          expectedUpdatedAt: string;
        }
      | undefined,
    snapshot: { exists: boolean; id: string; data: () => unknown } | null
  ): void {
    if (precondition === undefined) {
      return;
    }

    if (snapshot?.exists !== true) {
      fail({
        code: 'PRECONDITION_FAILED',
        message: 'Admin actor authorization changed.',
      });
    }

    const actor = userFromDoc(snapshot.id, docData(snapshot));
    if (
      actor.deletedAt !== null ||
      actor.updatedAt !== precondition.expectedUpdatedAt ||
      actor.status !== 'approved' ||
      actor.role !== 'admin'
    ) {
      fail({
        code: 'PRECONDITION_FAILED',
        message: 'Admin actor authorization changed.',
      });
    }
  }

  private verifyReservation(
    kind: UserIdentityReservation['kind'],
    snapshot: { exists: boolean; id: string; data: () => unknown },
    userId: string
  ): void {
    if (!snapshot.exists) {
      return;
    }

    const reservation = reservationFromDoc(snapshot.id, docData(snapshot));
    if (reservation.active && reservation.userId !== userId) {
      fail({ code: 'CONFLICT', message: `${kind} is already reserved` });
    }
  }

  private nextReservation(
    kind: UserIdentityReservation['kind'],
    value: string,
    snapshot: { exists: boolean; id: string; data: () => unknown },
    user: FaUser
  ): UserIdentityReservation {
    const existing = snapshot.exists ? reservationFromDoc(snapshot.id, docData(snapshot)) : null;
    return {
      id: identityReservationId(kind, value),
      kind,
      valueHash: identityValueHash(value),
      userId: user.id,
      active: true,
      createdAt: existing?.createdAt ?? user.createdAt,
      updatedAt: user.updatedAt,
      releasedAt: null,
    };
  }

  private releasedPreviousEmailReservation(
    snapshot: { exists: boolean; id: string; data: () => unknown },
    user: FaUser
  ): Record<string, unknown> | null {
    if (!snapshot.exists) {
      return null;
    }

    const reservation = reservationFromDoc(snapshot.id, docData(snapshot));
    if (reservation.userId !== user.id) {
      return null;
    }

    return reservationToDoc({
      ...reservation,
      active: false,
      updatedAt: user.updatedAt,
      releasedAt: user.updatedAt,
    });
  }
}
