import { err, ok, type Result } from '@fa/common-core';
import { userLevelValues, type Auth0IdentityClaims } from '@fa/http-contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { bootstrapAdminActorId, type FaUser, type UserChangeEvent } from '../models/user.js';
import {
  type UserHistoryPage,
  type UserListCursor,
  type UserListPage,
  type UserRepository,
  type UserRepositoryError,
} from '../repositories/userRepositories.js';
import {
  approveUser,
  patchUser,
  rejectUser,
  suspendUser,
  unsuspendUser,
} from './adminUserActions.js';
import { bootstrapUser, type IdentityConflictLogEvent } from './bootstrapUser.js';
import { completeProfile } from './completeProfile.js';
import { decodeUserListCursor, encodeUserListCursor, normalizeUserListLimit } from './cursors.js';
import { resolveAuthorization } from './resolveAuthorization.js';
import { hashSecurityLogValue } from './securityLogging.js';
import { mapUserToCurrentUserSummary } from './userMapping.js';

const now = '2026-06-17T10:00:00.000Z';
const testSignupAllowedEmailPattern =
  /^(?:person\+signup|[^@\s]+\+allowed|save-conflict)@example\.com$/u;

class FakeUserRepository implements UserRepository {
  readonly users = new Map<string, FaUser>();
  readonly events: UserChangeEvent[] = [];
  readonly auth0Reservations = new Map<string, string>();
  readonly emailReservations = new Map<string, string>();

  seed(user: FaUser): void {
    this.users.set(user.id, structuredClone(user));
    this.auth0Reservations.set(user.auth0Subject, user.id);
    this.emailReservations.set(user.normalizedEmail, user.id);
  }

  resolveByAuth0Identity(input: {
    auth0Subject: string;
    normalizedEmail: string;
  }): Promise<Result<FaUser | null, UserRepositoryError>> {
    for (const user of this.users.values()) {
      if (
        user.deletedAt === null &&
        user.auth0Subject === input.auth0Subject &&
        user.normalizedEmail === input.normalizedEmail
      ) {
        return Promise.resolve(ok(structuredClone(user)));
      }
    }
    return Promise.resolve(ok(null));
  }

  findActiveByAuth0Subject(
    auth0Subject: string
  ): Promise<Result<FaUser | null, UserRepositoryError>> {
    for (const user of this.users.values()) {
      if (user.deletedAt === null && user.auth0Subject === auth0Subject) {
        return Promise.resolve(ok(structuredClone(user)));
      }
    }
    return Promise.resolve(ok(null));
  }

  findActiveByNormalizedEmail(
    normalizedEmail: string
  ): Promise<Result<FaUser | null, UserRepositoryError>> {
    for (const user of this.users.values()) {
      if (user.deletedAt === null && user.normalizedEmail === normalizedEmail) {
        return Promise.resolve(ok(structuredClone(user)));
      }
    }
    return Promise.resolve(ok(null));
  }

  getById(userId: string): Promise<Result<FaUser | null, UserRepositoryError>> {
    const user = this.users.get(userId);
    return Promise.resolve(ok(user?.deletedAt === null ? structuredClone(user) : null));
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
      return Promise.resolve(err({ code: 'PRECONDITION_FAILED', message: 'user already exists' }));
    }
    if (input.expectedUpdatedAt !== null && existing?.updatedAt !== input.expectedUpdatedAt) {
      return Promise.resolve(err({ code: 'PRECONDITION_FAILED', message: 'stale user update' }));
    }

    const actorPrecondition = input.adminActorPrecondition;
    if (actorPrecondition !== undefined) {
      const actor = this.users.get(actorPrecondition.actorUserId);
      if (actor === undefined) {
        return Promise.resolve(
          err({
            code: 'PRECONDITION_FAILED',
            message: 'Admin actor authorization changed.',
          })
        );
      }

      if (
        actor.deletedAt !== null ||
        actor.updatedAt !== actorPrecondition.expectedUpdatedAt ||
        actor.status !== 'approved' ||
        actor.role !== 'admin'
      ) {
        return Promise.resolve(
          err({
            code: 'PRECONDITION_FAILED',
            message: 'Admin actor authorization changed.',
          })
        );
      }
    }

    const reservedSubjectOwner = this.auth0Reservations.get(input.identity.auth0Subject);
    if (reservedSubjectOwner !== undefined && reservedSubjectOwner !== input.user.id) {
      return Promise.resolve(err({ code: 'CONFLICT', message: 'subject is already reserved' }));
    }
    const reservedEmailOwner = this.emailReservations.get(input.identity.normalizedEmail);
    if (reservedEmailOwner !== undefined && reservedEmailOwner !== input.user.id) {
      return Promise.resolve(err({ code: 'CONFLICT', message: 'email is already reserved' }));
    }

    if (
      input.identity.previousNormalizedEmail !== undefined &&
      input.identity.previousNormalizedEmail !== null &&
      input.identity.previousNormalizedEmail !== input.identity.normalizedEmail &&
      this.emailReservations.get(input.identity.previousNormalizedEmail) === input.user.id
    ) {
      this.emailReservations.delete(input.identity.previousNormalizedEmail);
    }

    this.auth0Reservations.set(input.identity.auth0Subject, input.user.id);
    this.emailReservations.set(input.identity.normalizedEmail, input.user.id);
    this.users.set(input.user.id, structuredClone(input.user));
    this.events.push(...input.events.map((event) => structuredClone(event)));
    return Promise.resolve(ok(structuredClone(input.user)));
  }

  listPending(input: {
    limit: number;
    cursor: UserListCursor | null;
  }): Promise<Result<UserListPage, UserRepositoryError>> {
    void input;
    return Promise.resolve(ok({ users: [], nextCursor: null, totalCount: 0 }));
  }

  countPending(): Promise<Result<number, UserRepositoryError>> {
    return Promise.resolve(ok(0));
  }

  listUsers(): Promise<Result<UserListPage, UserRepositoryError>> {
    return Promise.resolve(ok({ users: [], nextCursor: null, totalCount: 0 }));
  }

  listHistory(input: {
    targetUserId: string;
    limit: number;
    cursor: UserListCursor | null;
  }): Promise<Result<UserHistoryPage, UserRepositoryError>> {
    void input;
    return Promise.resolve(ok({ events: [], nextCursor: null }));
  }
}

function createDeps(bootstrapAdminEmails: string[] = []) {
  const repository = new FakeUserRepository();
  const conflictLogs: IdentityConflictLogEvent[] = [];
  let idCounter = 0;
  return {
    repository,
    bootstrapDeps: {
      repository,
      bootstrapAdminEmails: new Set(bootstrapAdminEmails),
      selfSignupAllowedEmailPattern: testSignupAllowedEmailPattern,
      idGenerator: () => `user-${String(++idCounter)}`,
      eventIdGenerator: () => `event-${String(++idCounter)}`,
      securityLogHashKey: 'internal-token',
      logIdentityConflict: (event: IdentityConflictLogEvent) => {
        conflictLogs.push(event);
      },
    },
    conflictLogs,
  };
}

function auth0(overrides: Partial<Auth0IdentityClaims> = {}): Auth0IdentityClaims {
  return {
    subject: 'auth0|subject-1',
    email: 'person@example.com',
    emailVerified: true,
    ...overrides,
  };
}

function makeUser(overrides: Partial<FaUser> = {}): FaUser {
  return {
    id: 'user-existing',
    auth0Subject: 'auth0|subject-1',
    email: 'person@example.com',
    normalizedEmail: 'person@example.com',
    firstName: null,
    lastName: null,
    mobileNumber: null,
    role: 'user',
    level: null,
    status: 'profile_required',
    statusBeforeSuspension: null,
    createdAt: '2026-06-16T09:00:00.000Z',
    updatedAt: '2026-06-16T09:00:00.000Z',
    approvedAt: null,
    suspendedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function adminActor(): FaUser {
  return makeUser({
    id: 'admin-1',
    auth0Subject: 'auth0|admin',
    email: 'admin@example.com',
    normalizedEmail: 'admin@example.com',
    firstName: 'Ada',
    lastName: 'Admin',
    mobileNumber: '+15550101000',
    role: 'admin',
    level: null,
    status: 'approved',
    approvedAt: '2026-06-16T09:00:00.000Z',
  });
}

function completePendingTarget(overrides: Partial<FaUser> = {}): FaUser {
  const id = overrides.id ?? 'target-1';
  return makeUser({
    id: 'target-1',
    auth0Subject: `auth0|${id}`,
    email: `${id}@example.com`,
    normalizedEmail: `${id}@example.com`,
    firstName: 'Tara',
    lastName: 'Target',
    mobileNumber: '+15550101000',
    status: 'pending',
    ...overrides,
  });
}

function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('expected ok result');
  }
  return result.value;
}

function expectErrorCode(
  result: { ok: true; value: unknown } | { ok: false; error: { code: string } },
  code: string
): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('expected error result');
  }
  expect(result.error.code).toBe(code);
}

describe('bootstrapUser', () => {
  it('normal Auth0 first login creates a profile_required user', async () => {
    const { bootstrapDeps, repository } = createDeps();

    const user = expectOk(
      await bootstrapUser(bootstrapDeps, {
        auth0: auth0({ email: 'Person+Signup@Example.com' }),
        now,
      })
    );

    expect(user).toMatchObject({
      id: 'user-1',
      auth0Subject: 'auth0|subject-1',
      email: 'Person+Signup@Example.com',
      normalizedEmail: 'person+signup@example.com',
      role: 'user',
      level: null,
      status: 'profile_required',
      firstName: null,
      lastName: null,
      mobileNumber: null,
      approvedAt: null,
      suspendedAt: null,
      statusBeforeSuspension: null,
      deletedAt: null,
    });
    expect(repository.users.size).toBe(1);
    expect(repository.events).toEqual([]);
  });

  it('allowed unverified self-signup alias creates and keeps a profile_required user', async () => {
    const { bootstrapDeps, repository } = createDeps();

    const created = expectOk(
      await bootstrapUser(bootstrapDeps, {
        auth0: auth0({
          email: 'Signup+Allowed@Example.com',
          emailVerified: false,
        }),
        now,
      })
    );

    expect(created).toMatchObject({
      id: 'user-1',
      email: 'Signup+Allowed@Example.com',
      normalizedEmail: 'signup+allowed@example.com',
      role: 'user',
      level: null,
      status: 'profile_required',
    });
    expect(repository.users.size).toBe(1);

    const resolvedAgain = expectOk(
      await bootstrapUser(bootstrapDeps, {
        auth0: auth0({
          email: 'Signup+Allowed@Example.com',
          emailVerified: false,
        }),
        now,
      })
    );

    expect(resolvedAgain.id).toBe(created.id);
    expect(repository.users.size).toBe(1);
  });

  it('bootstrap admin verified email creates and corrects an admin candidate', async () => {
    const { bootstrapDeps, repository } = createDeps(['admin@example.com']);

    const created = expectOk(
      await bootstrapUser(bootstrapDeps, {
        auth0: auth0({ email: 'Admin@Example.com' }),
        now,
      })
    );

    expect(created).toMatchObject({
      email: 'Admin@Example.com',
      normalizedEmail: 'admin@example.com',
      role: 'admin',
      level: null,
      status: 'profile_required',
    });
    expect(repository.events.map((event) => [event.type, event.actorUserId, event.after])).toEqual([
      ['role_changed', bootstrapAdminActorId, { role: 'admin' }],
      ['level_changed', bootstrapAdminActorId, { level: null }],
    ]);

    const correction = createDeps(['admin@example.com']);
    correction.repository.seed(
      makeUser({
        id: 'retired-admin',
        email: 'admin@example.com',
        normalizedEmail: 'admin@example.com',
        role: 'user',
        level: 4,
      })
    );

    const corrected = expectOk(
      await bootstrapUser(correction.bootstrapDeps, {
        auth0: auth0({ email: 'admin@example.com' }),
        now,
      })
    );

    expect(corrected).toMatchObject({ id: 'retired-admin', role: 'admin', level: null });
    expect(
      correction.repository.events.map((event) => [event.type, event.before, event.after])
    ).toEqual([
      ['role_changed', { role: 'user' }, { role: 'admin' }],
      ['level_changed', { level: 4 }, { level: null }],
    ]);
  });

  it('unverified bootstrap email does not grant admin', async () => {
    const { bootstrapDeps, conflictLogs, repository } = createDeps(['person@example.com']);

    expectErrorCode(
      await bootstrapUser(bootstrapDeps, {
        auth0: auth0({ email: 'person@outside.test', emailVerified: false }),
        now,
      }),
      'FORBIDDEN'
    );

    expect(repository.users.size).toBe(0);
    expect(conflictLogs).toEqual([
      expect.objectContaining({
        event: 'user_identity_conflict',
        reason: 'email_unverified',
      }),
    ]);
  });

  it('unverified normal-user email is rejected before user or reservation creation', async () => {
    const { bootstrapDeps, repository } = createDeps();

    expectErrorCode(
      await bootstrapUser(bootstrapDeps, {
        auth0: auth0({ emailVerified: false }),
        now,
      }),
      'FORBIDDEN'
    );

    expect(repository.users.size).toBe(0);
    expect(repository.auth0Reservations.size).toBe(0);
    expect(repository.emailReservations.size).toBe(0);
  });

  it('verified self-signup email outside the product allowlist is rejected before creation', async () => {
    const { bootstrapDeps, conflictLogs, repository } = createDeps();

    expectErrorCode(
      await bootstrapUser(bootstrapDeps, {
        auth0: auth0({ email: 'person@outside.test', emailVerified: true }),
        now,
      }),
      'FORBIDDEN'
    );

    expect(repository.users.size).toBe(0);
    expect(repository.auth0Reservations.size).toBe(0);
    expect(repository.emailReservations.size).toBe(0);
    expect(conflictLogs[0]).toMatchObject({ reason: 'email_not_allowed_for_signup' });
  });

  it('same email with a different subject fails closed', async () => {
    const { bootstrapDeps, conflictLogs, repository } = createDeps();
    repository.seed(makeUser({ auth0Subject: 'auth0|first-subject' }));

    expectErrorCode(
      await bootstrapUser(bootstrapDeps, {
        auth0: auth0({ subject: 'auth0|second-subject' }),
        now,
      }),
      'FORBIDDEN'
    );

    expect(repository.users.size).toBe(1);
    expect(conflictLogs[0]).toMatchObject({
      reason: 'email_owned_by_other_subject',
      existingUserId: 'user-existing',
    });
    expect(conflictLogs[0]?.auth0SubjectHash).not.toContain('auth0|');
    expect(conflictLogs[0]?.normalizedEmailHash).not.toContain('@');
  });

  it('same subject with a different unverified email fails closed', async () => {
    const { bootstrapDeps, conflictLogs, repository } = createDeps();
    repository.seed(makeUser());

    expectErrorCode(
      await bootstrapUser(bootstrapDeps, {
        auth0: auth0({ email: 'new@example.com', emailVerified: false }),
        now,
      }),
      'FORBIDDEN'
    );

    expect(repository.users.get('user-existing')?.email).toBe('person@example.com');
    expect(conflictLogs[0]).toMatchObject({ reason: 'subject_email_changed_unverified' });
  });

  it('verified same-subject email change writes profile_changed with email fields', async () => {
    const { bootstrapDeps, repository } = createDeps();
    repository.seed(makeUser());

    const user = expectOk(
      await bootstrapUser(bootstrapDeps, {
        auth0: auth0({ email: 'New@Example.com', emailVerified: true }),
        now,
      })
    );

    expect(user).toMatchObject({
      email: 'New@Example.com',
      normalizedEmail: 'new@example.com',
    });
    expect(repository.emailReservations.has('person@example.com')).toBe(false);
    expect(repository.emailReservations.get('new@example.com')).toBe('user-existing');
    expect(repository.events).toEqual([
      expect.objectContaining({
        type: 'profile_changed',
        actorUserId: 'user-existing',
        before: {
          email: 'person@example.com',
          normalizedEmail: 'person@example.com',
        },
        after: {
          email: 'New@Example.com',
          normalizedEmail: 'new@example.com',
        },
      }),
    ]);
  });

  it('verified same-subject email change into bootstrap email also applies bootstrap correction', async () => {
    const { bootstrapDeps, repository } = createDeps(['admin@example.com']);
    repository.seed(
      makeUser({
        role: 'user',
        level: 4,
        status: 'profile_required',
      })
    );

    const user = expectOk(
      await bootstrapUser(bootstrapDeps, {
        auth0: auth0({ email: 'Admin@Example.com', emailVerified: true }),
        now,
      })
    );

    expect(user).toMatchObject({
      email: 'Admin@Example.com',
      normalizedEmail: 'admin@example.com',
      role: 'admin',
      level: null,
      status: 'profile_required',
    });
    expect(repository.events.map((event) => [event.type, event.actorUserId, event.after])).toEqual([
      [
        'profile_changed',
        'user-existing',
        { email: 'Admin@Example.com', normalizedEmail: 'admin@example.com' },
      ],
      ['role_changed', bootstrapAdminActorId, { role: 'admin' }],
      ['level_changed', bootstrapAdminActorId, { level: null }],
    ]);
  });

  it('verified same-subject email changes fail closed when the new email is already owned', async () => {
    const { bootstrapDeps, conflictLogs, repository } = createDeps();
    repository.seed(makeUser());
    repository.seed(
      makeUser({
        id: 'email-owner',
        auth0Subject: 'auth0|email-owner',
        email: 'owned@example.com',
        normalizedEmail: 'owned@example.com',
      })
    );

    expectErrorCode(
      await bootstrapUser(bootstrapDeps, {
        auth0: auth0({ email: 'owned@example.com', emailVerified: true }),
        now,
      }),
      'FORBIDDEN'
    );

    expect(repository.users.get('user-existing')?.normalizedEmail).toBe('person@example.com');
    expect(conflictLogs[0]).toMatchObject({
      reason: 'subject_email_changed_to_owned_email',
      existingUserId: 'email-owner',
    });
  });

  it('verified same-subject email changes map email lookup failures', async () => {
    const { bootstrapDeps, repository } = createDeps();
    repository.seed(makeUser());
    repository.findActiveByNormalizedEmail = () =>
      Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'email lookup failed' }));

    expectErrorCode(
      await bootstrapUser(bootstrapDeps, {
        auth0: auth0({ email: 'new@example.com', emailVerified: true }),
        now,
      }),
      'INTERNAL_ERROR'
    );
  });

  it('suspended bootstrap admin login stays suspended and preserves suspension fields', async () => {
    const { bootstrapDeps, repository } = createDeps(['person@example.com']);
    repository.seed(
      makeUser({
        role: 'user',
        level: 3,
        status: 'suspended',
        statusBeforeSuspension: 'approved',
        suspendedAt: '2026-06-16T11:00:00.000Z',
      })
    );

    const user = expectOk(await bootstrapUser(bootstrapDeps, { auth0: auth0(), now }));

    expect(user).toMatchObject({
      role: 'admin',
      level: null,
      status: 'suspended',
      statusBeforeSuspension: 'approved',
      suspendedAt: '2026-06-16T11:00:00.000Z',
    });
    expect(repository.events.map((event) => event.type)).toEqual(['role_changed', 'level_changed']);
  });

  it('already-correct bootstrap admin logins are read-only', async () => {
    const { bootstrapDeps, repository } = createDeps(['person@example.com']);
    repository.seed(
      makeUser({
        role: 'admin',
        level: null,
        status: 'approved',
        firstName: 'Ada',
        lastName: 'Admin',
        mobileNumber: '+15550101000',
        approvedAt: '2026-06-16T09:30:00.000Z',
      })
    );

    const user = expectOk(await bootstrapUser(bootstrapDeps, { auth0: auth0(), now }));

    expect(user).toMatchObject({
      id: 'user-existing',
      role: 'admin',
      level: null,
      status: 'approved',
      updatedAt: '2026-06-16T09:00:00.000Z',
    });
    expect(repository.events).toEqual([]);
  });

  it('rejects blank subjects and missing emails without binding an identity', async () => {
    const { bootstrapDeps, conflictLogs, repository } = createDeps();

    expectErrorCode(
      await bootstrapUser(bootstrapDeps, {
        auth0: auth0({ subject: '   ' }),
        now,
      }),
      'FORBIDDEN'
    );
    expectErrorCode(
      await bootstrapUser(bootstrapDeps, {
        auth0: { subject: 'auth0|missing-email', emailVerified: true },
        now,
      }),
      'FORBIDDEN'
    );

    expect(repository.users.size).toBe(0);
    expect(conflictLogs).toHaveLength(1);
    const [conflictLog] = conflictLogs;
    expect(conflictLog).toMatchObject({ reason: 'email_missing' });
    expect(conflictLog?.auth0SubjectHash).toEqual(expect.any(String));
    expect(conflictLog).not.toHaveProperty('normalizedEmailHash');
  });

  it('maps repository lookup and save failures without exposing raw identity details', async () => {
    const { bootstrapDeps, repository } = createDeps();
    repository.findActiveByAuth0Subject = () =>
      Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'subject lookup failed' }));

    expectErrorCode(await bootstrapUser(bootstrapDeps, { auth0: auth0(), now }), 'INTERNAL_ERROR');

    const emailLookup = createDeps();
    emailLookup.repository.findActiveByNormalizedEmail = () =>
      Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'email lookup failed' }));
    expectErrorCode(
      await bootstrapUser(emailLookup.bootstrapDeps, { auth0: auth0(), now }),
      'INTERNAL_ERROR'
    );

    const conflictOnSave = createDeps();
    conflictOnSave.repository.createOrUpdateWithEvents = () =>
      Promise.resolve(err({ code: 'CONFLICT', message: 'raw duplicate identity' }));
    const saved = await bootstrapUser(conflictOnSave.bootstrapDeps, {
      auth0: auth0({ email: 'save-conflict@example.com' }),
      now,
    });
    expect(saved).toMatchObject({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Identity cannot be safely bound.',
      },
    });
  });
});

describe('completeProfile and authorization resolution', () => {
  it('profile completion moves a normal user to pending', async () => {
    const { repository } = createDeps();
    repository.seed(makeUser({ id: 'normal-1' }));

    const user = expectOk(
      await completeProfile(
        { repository, eventIdGenerator: () => 'event-profile' },
        {
          actorUserId: 'normal-1',
          profile: {
            firstName: '  Pat ',
            lastName: ' Angler ',
            mobileNumber: '+15550101000',
          },
          now,
        }
      )
    );

    expect(user).toMatchObject({
      firstName: 'Pat',
      lastName: 'Angler',
      mobileNumber: '+15550101000',
      level: 1,
      status: 'pending',
    });
    expect(repository.events.map((event) => [event.type, event.actorUserId])).toEqual([
      ['profile_changed', 'normal-1'],
      ['status_changed', 'normal-1'],
      ['level_changed', bootstrapAdminActorId],
    ]);
  });

  it('defaults a completed normal user profile to pending level one', async () => {
    const deps = createDeps();
    const existing = makeUser({
      id: 'normal-pending',
      auth0Subject: 'auth0|normal-pending',
      email: 'normal@example.com',
      normalizedEmail: 'normal@example.com',
      status: 'profile_required',
      role: 'user',
      level: null,
    });
    deps.repository.seed(existing);

    const result = await completeProfile(
      { repository: deps.repository, eventIdGenerator: () => 'event-profile' },
      {
        actorUserId: existing.id,
        now,
        profile: {
          firstName: 'Normal',
          lastName: 'User',
          mobileNumber: '+15550101000',
        },
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('pending');
      expect(result.value.role).toBe('user');
      expect(result.value.level).toBe(1);
    }
  });

  it('profile completion moves a bootstrap admin to approved admin', async () => {
    const { repository } = createDeps();
    repository.seed(
      makeUser({
        id: 'admin-candidate',
        email: 'admin@example.com',
        normalizedEmail: 'admin@example.com',
        role: 'admin',
        level: null,
      })
    );

    const user = expectOk(
      await completeProfile(
        {
          repository,
          eventIdGenerator: () => 'event-profile',
          bootstrapAdminEmails: new Set(['admin@example.com']),
        },
        {
          actorUserId: 'admin-candidate',
          profile: {
            firstName: 'Ada',
            lastName: 'Admin',
            mobileNumber: '+15550101000',
          },
          now,
        }
      )
    );

    expect(user).toMatchObject({
      role: 'admin',
      level: null,
      status: 'approved',
      approvedAt: now,
    });
    expect(repository.events.map((event) => [event.type, event.actorUserId])).toEqual([
      ['profile_changed', 'admin-candidate'],
      ['status_changed', bootstrapAdminActorId],
    ]);
  });

  it('profile completion repairs a bootstrap admin candidate with a stored level', async () => {
    const { repository } = createDeps();
    repository.seed(
      makeUser({
        id: 'retired-admin-candidate',
        email: 'admin@example.com',
        normalizedEmail: 'admin@example.com',
        role: 'admin',
        level: 4,
      })
    );

    const user = expectOk(
      await completeProfile(
        {
          repository,
          eventIdGenerator: () => 'event-profile',
          bootstrapAdminEmails: new Set(['admin@example.com']),
        },
        {
          actorUserId: 'retired-admin-candidate',
          profile: {
            firstName: 'Retired',
            lastName: 'Admin',
            mobileNumber: '+15550101000',
          },
          now,
        }
      )
    );

    expect(user).toMatchObject({
      role: 'admin',
      level: null,
      status: 'approved',
      approvedAt: now,
    });
    expect(repository.events).toHaveLength(3);
    expect(repository.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'profile_changed',
          actorUserId: 'retired-admin-candidate',
        }),
        expect.objectContaining({
          type: 'status_changed',
          actorUserId: bootstrapAdminActorId,
          before: { status: 'profile_required' },
          after: { status: 'approved' },
        }),
        expect.objectContaining({
          type: 'level_changed',
          actorUserId: bootstrapAdminActorId,
          before: { level: 4 },
          after: { level: null },
        }),
      ])
    );
  });

  it('profile completion repairs a bootstrap email normal-role candidate to approved admin', async () => {
    const { repository } = createDeps();
    repository.seed(
      makeUser({
        id: 'retired-normal-bootstrap',
        email: 'admin@example.com',
        normalizedEmail: 'admin@example.com',
        role: 'user',
        level: null,
      })
    );

    const user = expectOk(
      await completeProfile(
        {
          repository,
          eventIdGenerator: () => 'event-profile',
          bootstrapAdminEmails: new Set(['admin@example.com']),
        },
        {
          actorUserId: 'retired-normal-bootstrap',
          profile: {
            firstName: 'Bootstrap',
            lastName: 'Admin',
            mobileNumber: '+15550101000',
          },
          now,
        }
      )
    );

    expect(user).toMatchObject({
      role: 'admin',
      level: null,
      status: 'approved',
      approvedAt: now,
    });
    expect(repository.events).toHaveLength(3);
    expect(repository.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'profile_changed',
          actorUserId: 'retired-normal-bootstrap',
        }),
        expect.objectContaining({
          type: 'status_changed',
          actorUserId: bootstrapAdminActorId,
          before: { status: 'profile_required' },
          after: { status: 'approved' },
        }),
        expect.objectContaining({
          type: 'role_changed',
          actorUserId: bootstrapAdminActorId,
          before: { role: 'user' },
          after: { role: 'admin' },
        }),
      ])
    );
  });

  it('profile completion for a non-bootstrap admin role assignment stays pending', async () => {
    const { repository } = createDeps();
    repository.seed(
      makeUser({
        id: 'assigned-admin',
        email: 'assigned-admin@example.com',
        normalizedEmail: 'assigned-admin@example.com',
        role: 'admin',
        level: null,
      })
    );

    const user = expectOk(
      await completeProfile(
        { repository, eventIdGenerator: () => 'event-profile' },
        {
          actorUserId: 'assigned-admin',
          profile: {
            firstName: 'Assigned',
            lastName: 'Admin',
            mobileNumber: '+15550101000',
          },
          now,
        }
      )
    );

    expect(user).toMatchObject({
      role: 'admin',
      level: null,
      status: 'pending',
      approvedAt: null,
    });
    expect(repository.events.map((event) => [event.type, event.actorUserId])).toEqual([
      ['profile_changed', 'assigned-admin'],
      ['status_changed', 'assigned-admin'],
    ]);
  });

  it.each(['pending', 'rejected', 'suspended'] as const)(
    '%s profile updates return forbidden',
    async (status) => {
      const { repository } = createDeps();
      repository.seed(
        makeUser({
          id: `${status}-user`,
          status,
          statusBeforeSuspension: status === 'suspended' ? 'pending' : null,
        })
      );

      expectErrorCode(
        await completeProfile(
          { repository, eventIdGenerator: () => 'event-profile' },
          {
            actorUserId: `${status}-user`,
            profile: {
              firstName: 'No',
              lastName: 'Access',
              mobileNumber: '+15550101000',
            },
            now,
          }
        ),
        'FORBIDDEN'
      );
    }
  );

  it('profile completion returns not found, validation, and conflict errors explicitly', async () => {
    const { repository } = createDeps();

    expectErrorCode(
      await completeProfile(
        { repository, eventIdGenerator: () => 'event-profile' },
        {
          actorUserId: 'missing-user',
          profile: {
            firstName: 'Pat',
            lastName: 'Angler',
            mobileNumber: '+15550101000',
          },
          now,
        }
      ),
      'NOT_FOUND'
    );

    repository.seed(makeUser({ id: 'profile-user' }));
    expectErrorCode(
      await completeProfile(
        { repository, eventIdGenerator: () => 'event-profile' },
        {
          actorUserId: 'profile-user',
          profile: {
            firstName: ' ',
            lastName: 'Angler',
            mobileNumber: '+15550101000',
          },
          now,
        }
      ),
      'INVALID_REQUEST'
    );
    expectErrorCode(
      await completeProfile(
        { repository, eventIdGenerator: () => 'event-profile' },
        {
          actorUserId: 'profile-user',
          profile: {
            firstName: 'Pat',
            lastName: 'Angler',
            mobileNumber: '555-1234',
          },
          now,
        }
      ),
      'INVALID_REQUEST'
    );

    repository.createOrUpdateWithEvents = () =>
      Promise.resolve(err({ code: 'CONFLICT', message: 'profile write conflict' }));
    const conflict = await completeProfile(
      { repository, eventIdGenerator: () => 'event-profile' },
      {
        actorUserId: 'profile-user',
        profile: {
          firstName: 'Pat',
          lastName: 'Angler',
          mobileNumber: '+15550101000',
        },
        now,
      }
    );
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: 'PRECONDITION_FAILED', message: 'profile write conflict' },
    });

    repository.getById = () =>
      Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'profile lookup failed' }));
    expectErrorCode(
      await completeProfile(
        { repository, eventIdGenerator: () => 'event-profile' },
        {
          actorUserId: 'profile-user',
          profile: {
            firstName: 'Pat',
            lastName: 'Angler',
            mobileNumber: '+15550101000',
          },
          now,
        }
      ),
      'INTERNAL_ERROR'
    );
  });

  it('non-approved resolver states never include AuthorizationContext', async () => {
    const { bootstrapDeps, repository } = createDeps();
    repository.seed(makeUser({ id: 'pending-user', status: 'pending' }));

    const pending = expectOk(
      await resolveAuthorization(
        { ...bootstrapDeps, eventIdGenerator: () => 'event-auth' },
        { auth0: auth0(), now }
      )
    );

    expect(pending.state).toBe('pending');
    expect('authorization' in pending).toBe(false);

    const approvedSetup = createDeps();
    approvedSetup.repository.seed(
      makeUser({
        id: 'approved-user',
        status: 'approved',
        firstName: 'Pat',
        lastName: 'Angler',
        mobileNumber: '+15550101000',
        level: 8,
        approvedAt: now,
      })
    );

    const approved = expectOk(
      await resolveAuthorization(
        { ...approvedSetup.bootstrapDeps, eventIdGenerator: () => 'event-auth' },
        { auth0: auth0(), now }
      )
    );

    expect(approved).toMatchObject({
      state: 'approved',
      authorization: {
        userId: 'approved-user',
        status: 'approved',
        effectiveLevel: 8,
      },
    });
  });

  it('mapping rejects approved normal users without a stored level', () => {
    expect(() =>
      mapUserToCurrentUserSummary(
        makeUser({
          status: 'approved',
          firstName: 'Pat',
          lastName: 'Angler',
          mobileNumber: '+15550101000',
          role: 'user',
          level: null,
        })
      )
    ).toThrow('Approved normal users require a level.');
  });
});

describe('adminUserActions', () => {
  let repository: FakeUserRepository;

  beforeEach(() => {
    repository = new FakeUserRepository();
    repository.seed(adminActor());
  });

  it('approves normal users with levels 1 through 10', async () => {
    for (const level of userLevelValues) {
      repository.seed(completePendingTarget({ id: `target-${String(level)}`, level: null }));

      const result = expectOk(
        await approveUser(
          { repository, eventIdGenerator: () => `event-approve-${String(level)}` },
          {
            actorUserId: 'admin-1',
            targetUserId: `target-${String(level)}`,
            role: 'user',
            level,
            now,
          }
        )
      );

      expect(result.user).toMatchObject({
        status: 'approved',
        role: 'user',
        level,
        approvedAt: now,
      });
    }
  });

  it('approves admins with stored level null and effective level 10', async () => {
    repository.seed(completePendingTarget({ id: 'target-admin', level: 5 }));

    const result = expectOk(
      await approveUser(
        { repository, eventIdGenerator: () => 'event-approve-admin' },
        { actorUserId: 'admin-1', targetUserId: 'target-admin', role: 'admin', now }
      )
    );

    expect(result.user).toMatchObject({ role: 'admin', level: null, status: 'approved' });
    expect(mapUserToCurrentUserSummary(result.user)).toMatchObject({
      role: 'admin',
      level: null,
      effectiveLevel: 10,
    });
  });

  it('requires an approved admin actor before mutating target users', async () => {
    repository.seed(completePendingTarget({ id: 'target-no-admin' }));

    expectErrorCode(
      await approveUser(
        { repository, eventIdGenerator: () => 'event-approve' },
        {
          actorUserId: 'missing-admin',
          targetUserId: 'target-no-admin',
          role: 'user',
          level: 1,
          now,
        }
      ),
      'FORBIDDEN'
    );

    repository.seed(
      completePendingTarget({
        id: 'non-admin-actor',
        status: 'approved',
        level: 2,
        approvedAt: now,
      })
    );
    expectErrorCode(
      await rejectUser(
        { repository, eventIdGenerator: () => 'event-reject' },
        { actorUserId: 'non-admin-actor', targetUserId: 'target-no-admin', now }
      ),
      'FORBIDDEN'
    );
  });

  it('rejects admin self approval', async () => {
    const deps = createDeps();
    const admin = adminActor();
    deps.repository.seed(admin);

    const result = await approveUser(
      { repository: deps.repository, eventIdGenerator: () => 'event-self' },
      { actorUserId: admin.id, targetUserId: admin.id, now, role: 'user', level: 1 }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Admins cannot modify their own access.',
      });
    }
  });

  it('rejects admin self patch', async () => {
    const deps = createDeps();
    const admin = adminActor();
    deps.repository.seed(admin);

    const result = await patchUser(
      { repository: deps.repository, eventIdGenerator: () => 'event-self-patch' },
      {
        actorUserId: admin.id,
        targetUserId: admin.id,
        now,
        patch: { role: 'user', level: 1 },
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Admins cannot modify their own access.',
      });
    }
  });

  it('rejects admin self rejection', async () => {
    const deps = createDeps();
    const admin = adminActor();
    deps.repository.seed(admin);

    const result = await rejectUser(
      { repository: deps.repository, eventIdGenerator: () => 'event-self-reject' },
      { actorUserId: admin.id, targetUserId: admin.id, now }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Admins cannot modify their own access.',
      });
    }
  });

  it('rejects admin self suspension', async () => {
    const deps = createDeps();
    const admin = adminActor();
    deps.repository.seed(admin);

    const result = await suspendUser(
      { repository: deps.repository, eventIdGenerator: () => 'event-self-suspend' },
      { actorUserId: admin.id, targetUserId: admin.id, now }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Admins cannot modify their own access.',
      });
    }
  });

  it('rejects admin self unsuspension', async () => {
    const deps = createDeps();
    const admin = adminActor();
    deps.repository.seed({
      ...admin,
      status: 'suspended',
      statusBeforeSuspension: 'approved',
    });

    const result = await unsuspendUser(
      { repository: deps.repository, eventIdGenerator: () => 'event-self-unsuspend' },
      { actorUserId: admin.id, targetUserId: admin.id, now }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Admins cannot modify their own access.',
      });
    }
  });

  it('fails admin mutations when the actor authorization changes before commit', async () => {
    repository.seed(completePendingTarget({ id: 'target-actor-race' }));
    const originalCreateOrUpdate = repository.createOrUpdateWithEvents.bind(repository);
    repository.createOrUpdateWithEvents = (input) => {
      repository.users.set('admin-1', {
        ...adminActor(),
        role: 'user',
        level: 1,
        updatedAt: '2026-06-17T09:59:59.000Z',
      });
      return originalCreateOrUpdate(input);
    };

    const result = await approveUser(
      { repository, eventIdGenerator: () => 'event-actor-race' },
      {
        actorUserId: 'admin-1',
        targetUserId: 'target-actor-race',
        role: 'user',
        level: 1,
        now,
      }
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'PRECONDITION_FAILED',
        message: 'Admin actor authorization changed.',
      },
    });
    expect(expectOk(await repository.getById('target-actor-race'))).toMatchObject({
      status: 'pending',
    });
  });

  it('rejects approval requests with invalid role and level combinations', async () => {
    repository.seed(completePendingTarget({ id: 'missing-level' }));
    repository.seed(completePendingTarget({ id: 'admin-with-level' }));

    expectErrorCode(
      await approveUser(
        { repository, eventIdGenerator: () => 'event-approve-user' },
        { actorUserId: 'admin-1', targetUserId: 'missing-level', role: 'user', now }
      ),
      'PRECONDITION_FAILED'
    );
    expectErrorCode(
      await approveUser(
        { repository, eventIdGenerator: () => 'event-approve-admin' },
        { actorUserId: 'admin-1', targetUserId: 'admin-with-level', role: 'admin', level: 4, now }
      ),
      'PRECONDITION_FAILED'
    );
  });

  it('approve or patch to approved rejects incomplete required profile fields', async () => {
    repository.seed(completePendingTarget({ id: 'incomplete', firstName: null }));

    expectErrorCode(
      await approveUser(
        { repository, eventIdGenerator: () => 'event-approve' },
        { actorUserId: 'admin-1', targetUserId: 'incomplete', role: 'user', level: 1, now }
      ),
      'PRECONDITION_FAILED'
    );
    expectErrorCode(
      await patchUser(
        { repository, eventIdGenerator: () => 'event-patch' },
        {
          actorUserId: 'admin-1',
          targetUserId: 'incomplete',
          patch: { status: 'approved', level: 1 },
          now,
        }
      ),
      'PRECONDITION_FAILED'
    );
  });

  it('approve and reject suspended users return PRECONDITION_FAILED', async () => {
    repository.seed(
      completePendingTarget({
        id: 'suspended-target',
        status: 'suspended',
        statusBeforeSuspension: 'pending',
        suspendedAt: now,
      })
    );

    expectErrorCode(
      await approveUser(
        { repository, eventIdGenerator: () => 'event-approve' },
        { actorUserId: 'admin-1', targetUserId: 'suspended-target', role: 'user', level: 1, now }
      ),
      'PRECONDITION_FAILED'
    );
    expectErrorCode(
      await rejectUser(
        { repository, eventIdGenerator: () => 'event-reject' },
        { actorUserId: 'admin-1', targetUserId: 'suspended-target', now }
      ),
      'PRECONDITION_FAILED'
    );
  });

  it('rejects, suspends from every status, unsuspends restore, and patches users', async () => {
    repository.seed(completePendingTarget({ id: 'reject-target' }));

    const rejected = expectOk(
      await rejectUser(
        { repository, eventIdGenerator: () => 'event-reject' },
        { actorUserId: 'admin-1', targetUserId: 'reject-target', now }
      )
    );
    expect(rejected.user.status).toBe('rejected');
    expect(rejected.events).toEqual([
      expect.objectContaining({
        type: 'status_changed',
        before: { status: 'pending' },
        after: { status: 'rejected' },
      }),
    ]);

    for (const status of [
      'profile_required',
      'pending',
      'approved',
      'rejected',
      'suspended',
    ] as const) {
      repository.seed(
        completePendingTarget({
          id: `suspend-${status}`,
          status,
          statusBeforeSuspension: status === 'suspended' ? 'pending' : null,
          suspendedAt: status === 'suspended' ? '2026-06-16T11:00:00.000Z' : null,
          approvedAt: status === 'approved' ? '2026-06-16T11:00:00.000Z' : null,
        })
      );

      const suspended = expectOk(
        await suspendUser(
          { repository, eventIdGenerator: () => `event-suspend-${status}` },
          { actorUserId: 'admin-1', targetUserId: `suspend-${status}`, now }
        )
      );

      expect(suspended.user).toMatchObject({
        status: 'suspended',
        statusBeforeSuspension: status === 'suspended' ? 'pending' : status,
        suspendedAt: now,
      });
    }

    const restored = expectOk(
      await unsuspendUser(
        { repository, eventIdGenerator: () => 'event-unsuspend' },
        { actorUserId: 'admin-1', targetUserId: 'suspend-pending', now }
      )
    );
    expect(restored.user).toMatchObject({
      status: 'pending',
      statusBeforeSuspension: null,
      suspendedAt: null,
    });

    repository.seed(completePendingTarget({ id: 'patch-target' }));
    const patched = expectOk(
      await patchUser(
        { repository, eventIdGenerator: () => 'event-patch' },
        {
          actorUserId: 'admin-1',
          targetUserId: 'patch-target',
          patch: { role: 'admin', status: 'approved', level: null },
          now,
        }
      )
    );
    expect(patched.user).toMatchObject({
      role: 'admin',
      level: null,
      status: 'approved',
    });
    expect(patched.events.map((event) => event.type)).toEqual(['status_changed', 'role_changed']);
  });

  it('repeated suspend refreshes suspendedAt and updatedAt while preserving statusBeforeSuspension', async () => {
    repository.seed(
      completePendingTarget({
        id: 'repeat-suspended',
        status: 'suspended',
        statusBeforeSuspension: 'approved',
        suspendedAt: '2026-06-16T11:00:00.000Z',
        updatedAt: '2026-06-16T11:00:00.000Z',
        approvedAt: '2026-06-16T10:00:00.000Z',
        level: 4,
      })
    );

    const result = expectOk(
      await suspendUser(
        { repository, eventIdGenerator: () => 'event-repeat-suspend' },
        { actorUserId: 'admin-1', targetUserId: 'repeat-suspended', now }
      )
    );

    expect(result.user).toMatchObject({
      status: 'suspended',
      statusBeforeSuspension: 'approved',
      suspendedAt: now,
      updatedAt: now,
    });
    expect(result.events).toEqual([]);
  });

  it('patch cannot bypass explicit unsuspend for suspended users', async () => {
    repository.seed(
      completePendingTarget({
        id: 'suspended-patch',
        status: 'suspended',
        statusBeforeSuspension: 'pending',
        suspendedAt: now,
      })
    );

    expectErrorCode(
      await patchUser(
        { repository, eventIdGenerator: () => 'event-patch' },
        {
          actorUserId: 'admin-1',
          targetUserId: 'suspended-patch',
          patch: { status: 'approved', role: 'user', level: 2 },
          now,
        }
      ),
      'PRECONDITION_FAILED'
    );

    const roleOnly = expectOk(
      await patchUser(
        { repository, eventIdGenerator: () => 'event-patch-role' },
        {
          actorUserId: 'admin-1',
          targetUserId: 'suspended-patch',
          patch: { role: 'admin' },
          now,
        }
      )
    );
    expect(roleOnly.user).toMatchObject({ status: 'suspended', role: 'admin', level: null });
  });

  it('unsuspend rejects users that have no restorable previous status', async () => {
    repository.seed(completePendingTarget({ id: 'not-suspended' }));
    repository.seed(
      completePendingTarget({
        id: 'suspended-without-prior',
        status: 'suspended',
        statusBeforeSuspension: null,
        suspendedAt: now,
      })
    );

    expectErrorCode(
      await unsuspendUser(
        { repository, eventIdGenerator: () => 'event-unsuspend-pending' },
        { actorUserId: 'admin-1', targetUserId: 'not-suspended', now }
      ),
      'PRECONDITION_FAILED'
    );
    expectErrorCode(
      await unsuspendUser(
        { repository, eventIdGenerator: () => 'event-unsuspend-null' },
        { actorUserId: 'admin-1', targetUserId: 'suspended-without-prior', now }
      ),
      'PRECONDITION_FAILED'
    );
  });

  it('patch rejects explicit admin levels before applying any mutation', async () => {
    repository.seed(completePendingTarget({ id: 'patch-admin-level' }));

    expectErrorCode(
      await patchUser(
        { repository, eventIdGenerator: () => 'event-patch-admin-level' },
        {
          actorUserId: 'admin-1',
          targetUserId: 'patch-admin-level',
          patch: { role: 'admin', level: 5 },
          now,
        }
      ),
      'PRECONDITION_FAILED'
    );
  });

  it('maps admin mutation repository save conflicts to precondition failures', async () => {
    repository.seed(completePendingTarget({ id: 'conflict-target' }));
    repository.createOrUpdateWithEvents = () =>
      Promise.resolve(err({ code: 'CONFLICT', message: 'admin save conflict' }));

    const result = await approveUser(
      { repository, eventIdGenerator: () => 'event-conflict' },
      {
        actorUserId: 'admin-1',
        targetUserId: 'conflict-target',
        role: 'user',
        level: 1,
        now,
      }
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'PRECONDITION_FAILED', message: 'admin save conflict' },
    });
  });

  it('patch rejects suspended approved admin to normal user without a restored approved level', async () => {
    repository.seed(
      completePendingTarget({
        id: 'suspended-approved-admin',
        role: 'admin',
        level: null,
        status: 'suspended',
        statusBeforeSuspension: 'approved',
        suspendedAt: now,
      })
    );

    expectErrorCode(
      await patchUser(
        { repository, eventIdGenerator: () => 'event-patch-role' },
        {
          actorUserId: 'admin-1',
          targetUserId: 'suspended-approved-admin',
          patch: { role: 'user' },
          now,
        }
      ),
      'PRECONDITION_FAILED'
    );
  });

  it('patch rejects approved admin users with a non-null stored level', async () => {
    repository.seed(
      completePendingTarget({
        id: 'approved-admin-with-level',
        role: 'admin',
        level: 4,
        status: 'approved',
        approvedAt: now,
      })
    );

    expectErrorCode(
      await patchUser(
        { repository, eventIdGenerator: () => 'event-patch-invalid-admin' },
        {
          actorUserId: 'admin-1',
          targetUserId: 'approved-admin-with-level',
          patch: { status: 'approved' },
          now,
        }
      ),
      'PRECONDITION_FAILED'
    );
  });

  it('unsuspend rejects restoring approved admin users with a non-null stored level', async () => {
    repository.seed(
      completePendingTarget({
        id: 'suspended-approved-admin-with-level',
        role: 'admin',
        level: 4,
        status: 'suspended',
        statusBeforeSuspension: 'approved',
        approvedAt: now,
        suspendedAt: now,
      })
    );

    expectErrorCode(
      await unsuspendUser(
        { repository, eventIdGenerator: () => 'event-unsuspend-invalid-admin' },
        { actorUserId: 'admin-1', targetUserId: 'suspended-approved-admin-with-level', now }
      ),
      'PRECONDITION_FAILED'
    );
  });

  it('unsuspend rejects restoring approved normal user with no level', async () => {
    repository.seed(
      completePendingTarget({
        id: 'suspended-approved-user',
        role: 'user',
        level: null,
        status: 'suspended',
        statusBeforeSuspension: 'approved',
        suspendedAt: now,
      })
    );

    expectErrorCode(
      await unsuspendUser(
        { repository, eventIdGenerator: () => 'event-unsuspend-invalid' },
        { actorUserId: 'admin-1', targetUserId: 'suspended-approved-user', now }
      ),
      'PRECONDITION_FAILED'
    );
  });
});

describe('cursor and security helpers', () => {
  it('encodes and decodes opaque cursor payloads', () => {
    const cursor = { sortValue: '2026-06-17T10:00:00.000Z', id: 'user-1' };

    expect(expectOk(decodeUserListCursor(encodeUserListCursor(cursor)))).toEqual(cursor);
    expect(expectOk(normalizeUserListLimit(undefined))).toBe(50);
    expect(expectOk(normalizeUserListLimit('250'))).toBe(200);
  });

  it.each([
    ['malformed base64url', '@@@not-base64@@@'],
    ['non-object payload', Buffer.from('"not-object"', 'utf8').toString('base64url')],
    ['missing fields', Buffer.from(JSON.stringify({ id: 'user-1' }), 'utf8').toString('base64url')],
    [
      'non-ISO sortValue',
      Buffer.from(JSON.stringify({ sortValue: 'yesterday', id: 'user-1' }), 'utf8').toString(
        'base64url'
      ),
    ],
  ])('rejects %s cursors', (_name, encoded) => {
    const decoded = decodeUserListCursor(encoded);

    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('hashes identity conflict values with keyed HMAC-SHA256', () => {
    expect(hashSecurityLogValue('internal-token', 'person@example.com')).toBe(
      '0d30268367ce8bfebdf66b06c51a8bdc6cf4acf6cab30dd444203759a4efa474'
    );
  });
});
