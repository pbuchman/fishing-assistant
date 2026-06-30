import { describe, expect, it } from 'vitest';

import type { Auth0IdentityClaims } from '@fa/http-contracts';

import { type FaUser } from '../../domain/models/user.js';
import { bootstrapUser } from '../../domain/usecases/bootstrapUser.js';
import { completeProfile } from '../../domain/usecases/completeProfile.js';
import { MemoryUserRepository } from './memoryUserRepository.js';

const now = '2026-06-17T10:00:00.000Z';
const testSignupAllowedEmailPattern = /^person\+signup@example\.com$/u;

function auth0(overrides: Partial<Auth0IdentityClaims> = {}): Auth0IdentityClaims {
  return {
    subject: 'auth0|subject-1',
    email: 'person+signup@example.com',
    emailVerified: true,
    ...overrides,
  };
}

function user(overrides: Partial<FaUser> = {}): FaUser {
  return {
    id: 'user-1',
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
    createdAt: '2026-06-17T09:00:00.000Z',
    updatedAt: '2026-06-17T09:00:00.000Z',
    approvedAt: null,
    suspendedAt: null,
    deletedAt: null,
    ...overrides,
  };
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

describe('MemoryUserRepository', () => {
  it('supports use-case identity reservations, profile completion, history, and cloning', async () => {
    const repository = new MemoryUserRepository();
    let id = 0;

    const created = expectOk(
      await bootstrapUser(
        {
          repository,
          bootstrapAdminEmails: new Set(),
          selfSignupAllowedEmailPattern: testSignupAllowedEmailPattern,
          idGenerator: () => `user-${String(++id)}`,
          eventIdGenerator: () => `event-${String(++id)}`,
          securityLogHashKey: 'internal-token',
        },
        { auth0: auth0(), now }
      )
    );

    expect(created).toMatchObject({
      id: 'user-1',
      auth0Subject: 'auth0|subject-1',
      normalizedEmail: 'person+signup@example.com',
      status: 'profile_required',
    });
    expect(repository.identityReservations.get('auth0Subject:auth0|subject-1')).toBeUndefined();

    expectErrorCode(
      await bootstrapUser(
        {
          repository,
          bootstrapAdminEmails: new Set(),
          selfSignupAllowedEmailPattern: testSignupAllowedEmailPattern,
          idGenerator: () => `user-${String(++id)}`,
          eventIdGenerator: () => `event-${String(++id)}`,
          securityLogHashKey: 'internal-token',
        },
        { auth0: auth0({ subject: 'auth0|other-subject' }), now }
      ),
      'FORBIDDEN'
    );

    const pending = expectOk(
      await completeProfile(
        { repository, eventIdGenerator: () => `event-${String(++id)}` },
        {
          actorUserId: 'user-1',
          profile: {
            firstName: '  Pat  ',
            lastName: '  Angler ',
            mobileNumber: '+15550101000',
          },
          now: '2026-06-17T10:01:00.000Z',
        }
      )
    );

    pending.firstName = 'Mutated outside repository';
    await expect(repository.getById('user-1')).resolves.toMatchObject({
      ok: true,
      value: { firstName: 'Pat', status: 'pending' },
    });
    await expect(repository.countPending()).resolves.toEqual({ ok: true, value: 1 });
    await expect(repository.listPending({ limit: 10, cursor: null })).resolves.toMatchObject({
      ok: true,
      value: {
        users: [{ id: 'user-1', firstName: 'Pat', status: 'pending' }],
        nextCursor: null,
      },
    });
    await expect(
      repository.listHistory({ targetUserId: 'user-1', limit: 10, cursor: null })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        events: [
          { type: 'profile_changed', targetUserId: 'user-1' },
          { type: 'status_changed', targetUserId: 'user-1' },
          { type: 'level_changed', targetUserId: 'user-1' },
        ],
      },
    });
  });

  it('uses repository sorting, cursors, stale-write checks, and soft-delete filtering', async () => {
    const repository = new MemoryUserRepository();
    await repository.createOrUpdateWithEvents({
      user: user({ id: 'b', status: 'pending', createdAt: '2026-06-17T09:01:00.000Z' }),
      events: [],
      identity: { auth0Subject: 'auth0|b', normalizedEmail: 'b@example.com' },
      expectedUpdatedAt: null,
    });
    await repository.createOrUpdateWithEvents({
      user: user({
        id: 'a',
        auth0Subject: 'auth0|a',
        email: 'a@example.com',
        normalizedEmail: 'a@example.com',
        status: 'pending',
        createdAt: '2026-06-17T09:01:00.000Z',
        deletedAt: '2026-06-17T09:03:00.000Z',
      }),
      events: [],
      identity: { auth0Subject: 'auth0|a', normalizedEmail: 'a@example.com' },
      expectedUpdatedAt: null,
    });
    await repository.createOrUpdateWithEvents({
      user: user({
        id: 'c',
        auth0Subject: 'auth0|c',
        email: 'c@example.com',
        normalizedEmail: 'c@example.com',
        status: 'pending',
        createdAt: '2026-06-17T09:02:00.000Z',
      }),
      events: [],
      identity: { auth0Subject: 'auth0|c', normalizedEmail: 'c@example.com' },
      expectedUpdatedAt: null,
    });

    const firstPage = expectOk(await repository.listPending({ limit: 1, cursor: null }));
    expect(firstPage.users.map((listed) => listed.id)).toEqual(['b']);
    expect(firstPage.nextCursor).toEqual({ sortValue: '2026-06-17T09:01:00.000Z', id: 'b' });
    await expect(
      repository.listPending({ limit: 10, cursor: firstPage.nextCursor })
    ).resolves.toMatchObject({
      ok: true,
      value: { users: [{ id: 'c' }], nextCursor: null },
    });
    await expect(repository.countPending()).resolves.toEqual({ ok: true, value: 2 });

    await expect(
      repository.createOrUpdateWithEvents({
        user: user({ id: 'b', updatedAt: '2026-06-17T10:00:00.000Z' }),
        events: [],
        identity: { auth0Subject: 'auth0|b', normalizedEmail: 'b@example.com' },
        expectedUpdatedAt: 'stale',
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'PRECONDITION_FAILED' },
    });
  });

  it('rejects admin mutations when the admin actor precondition is stale or no longer admin', async () => {
    const repository = new MemoryUserRepository();
    const admin = user({
      id: 'admin-1',
      auth0Subject: 'auth0|admin-1',
      email: 'admin@example.com',
      normalizedEmail: 'admin@example.com',
      role: 'admin',
      level: null,
      status: 'approved',
    });
    const target = user({ id: 'target-1' });
    repository.seed(admin);
    repository.seed(target);

    await expect(
      repository.createOrUpdateWithEvents({
        user: { ...target, updatedAt: '2026-06-17T10:00:00.000Z' },
        events: [],
        identity: { auth0Subject: target.auth0Subject, normalizedEmail: target.normalizedEmail },
        adminActorPrecondition: {
          actorUserId: admin.id,
          expectedUpdatedAt: 'stale-admin',
        },
        expectedUpdatedAt: target.updatedAt,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } });

    repository.seed({ ...admin, role: 'user', level: 1, updatedAt: admin.updatedAt });
    await expect(
      repository.createOrUpdateWithEvents({
        user: { ...target, updatedAt: '2026-06-17T10:01:00.000Z' },
        events: [],
        identity: { auth0Subject: target.auth0Subject, normalizedEmail: target.normalizedEmail },
        adminActorPrecondition: {
          actorUserId: admin.id,
          expectedUpdatedAt: admin.updatedAt,
        },
        expectedUpdatedAt: target.updatedAt,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } });
  });

  it('rejects duplicate history event ids without overwriting the event or user', async () => {
    const repository = new MemoryUserRepository();
    const originalUser = user();
    const originalEvent = {
      id: 'event-duplicate',
      targetUserId: originalUser.id,
      actorUserId: originalUser.id,
      type: 'profile_changed' as const,
      before: {},
      after: { firstName: 'Original' },
      createdAt: '2026-06-17T09:05:00.000Z',
    };

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

    await expect(repository.getById(originalUser.id)).resolves.toMatchObject({
      ok: true,
      value: { firstName: null, updatedAt: originalUser.updatedAt },
    });
    await expect(
      repository.listHistory({ targetUserId: originalUser.id, limit: 10, cursor: null })
    ).resolves.toMatchObject({
      ok: true,
      value: { events: [{ id: 'event-duplicate', after: { firstName: 'Original' } }] },
    });
  });

  it('rejects identity conflicts and duplicate event ids in the same mutation', async () => {
    const repository = new MemoryUserRepository();
    const first = user({ id: 'first' });
    const conflictingSubject = user({
      id: 'second',
      auth0Subject: first.auth0Subject,
      email: 'second@example.com',
      normalizedEmail: 'second@example.com',
    });

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
        user: conflictingSubject,
        events: [],
        identity: {
          auth0Subject: conflictingSubject.auth0Subject,
          normalizedEmail: conflictingSubject.normalizedEmail,
        },
        expectedUpdatedAt: null,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repository.createOrUpdateWithEvents({
        user: user({ id: 'duplicate-event-user', auth0Subject: 'auth0|dup' }),
        events: [
          {
            id: 'event-same-input',
            targetUserId: 'duplicate-event-user',
            actorUserId: 'duplicate-event-user',
            type: 'profile_changed',
            before: {},
            after: { firstName: 'One' },
            createdAt: now,
          },
          {
            id: 'event-same-input',
            targetUserId: 'duplicate-event-user',
            actorUserId: 'duplicate-event-user',
            type: 'status_changed',
            before: { status: 'profile_required' },
            after: { status: 'pending' },
            createdAt: now,
          },
        ],
        identity: {
          auth0Subject: 'auth0|dup',
          normalizedEmail: 'duplicate-event-user@example.com',
        },
        expectedUpdatedAt: null,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });

    await expect(repository.getById('second')).resolves.toEqual({ ok: true, value: null });
    await expect(repository.getById('duplicate-event-user')).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it('paginates filtered user lists by updatedAt desc and returns empty history for inactive targets', async () => {
    const repository = new MemoryUserRepository();
    for (const seeded of [
      user({
        id: 'same-time-b',
        auth0Subject: 'auth0|same-b',
        email: 'same-b@example.com',
        normalizedEmail: 'same-b@example.com',
        status: 'approved',
        level: 4,
        updatedAt: '2026-06-17T10:00:00.000Z',
      }),
      user({
        id: 'same-time-a',
        auth0Subject: 'auth0|same-a',
        email: 'same-a@example.com',
        normalizedEmail: 'same-a@example.com',
        status: 'approved',
        level: 4,
        updatedAt: '2026-06-17T10:00:00.000Z',
      }),
      user({
        id: 'older',
        auth0Subject: 'auth0|older',
        email: 'older@example.com',
        normalizedEmail: 'older@example.com',
        firstName: 'River',
        lastName: 'Walker',
        mobileNumber: '+15550102222',
        status: 'approved',
        level: 4,
        updatedAt: '2026-06-17T09:00:00.000Z',
      }),
      user({
        id: 'wrong-level',
        auth0Subject: 'auth0|wrong-level',
        email: 'wrong-level@example.com',
        normalizedEmail: 'wrong-level@example.com',
        status: 'approved',
        level: 5,
        updatedAt: '2026-06-17T11:00:00.000Z',
      }),
      user({
        id: 'deleted',
        auth0Subject: 'auth0|deleted',
        email: 'deleted@example.com',
        normalizedEmail: 'deleted@example.com',
        status: 'approved',
        level: 4,
        deletedAt: '2026-06-17T11:30:00.000Z',
      }),
    ]) {
      repository.seed(seeded);
    }

    const firstPage = expectOk(
      await repository.listUsers({
        filters: { status: 'approved', level: 4 },
        limit: 2,
        cursor: null,
      })
    );
    expect(firstPage.users.map((listed) => listed.id)).toEqual(['same-time-a', 'same-time-b']);
    expect(firstPage.totalCount).toBe(3);
    expect(firstPage.nextCursor).toEqual({
      sortValue: '2026-06-17T10:00:00.000Z',
      id: 'same-time-b',
    });
    const firstUser = firstPage.users[0];
    expect(firstUser).toBeDefined();
    if (firstUser === undefined) {
      throw new Error('Expected at least one listed user');
    }
    firstUser.firstName = 'Mutated outside repository';

    const secondPage = expectOk(
      await repository.listUsers({
        filters: { status: 'approved', level: 4 },
        limit: 2,
        cursor: firstPage.nextCursor,
      })
    );
    expect(secondPage.users.map((listed) => listed.id)).toEqual(['older']);
    expect(secondPage.totalCount).toBe(3);
    const searchPage = expectOk(
      await repository.listUsers({
        filters: { query: 'river walker' },
        limit: 10,
        cursor: null,
      })
    );
    expect(searchPage.users.map((listed) => listed.id)).toEqual(['older']);
    await expect(repository.getById('same-time-a')).resolves.toMatchObject({
      ok: true,
      value: { firstName: null },
    });
    await expect(
      repository.listHistory({ targetUserId: 'missing', limit: 10, cursor: null })
    ).resolves.toEqual({ ok: true, value: { events: [], nextCursor: null } });
    await expect(
      repository.listHistory({ targetUserId: 'deleted', limit: 10, cursor: null })
    ).resolves.toEqual({ ok: true, value: { events: [], nextCursor: null } });
  });

  it('releases previous email reservations and paginates user history by cursor', async () => {
    const repository = new MemoryUserRepository();
    const original = user({
      id: 'email-user',
      auth0Subject: 'auth0|email-user',
      email: 'old@example.com',
      normalizedEmail: 'old@example.com',
    });

    expectOk(
      await repository.createOrUpdateWithEvents({
        user: original,
        events: [],
        identity: {
          auth0Subject: original.auth0Subject,
          normalizedEmail: original.normalizedEmail,
        },
        expectedUpdatedAt: null,
      })
    );

    const updated = {
      ...original,
      email: 'new@example.com',
      normalizedEmail: 'new@example.com',
      updatedAt: '2026-06-17T10:00:00.000Z',
    };
    expectOk(
      await repository.createOrUpdateWithEvents({
        user: updated,
        events: [
          {
            id: 'event-c',
            targetUserId: 'email-user',
            actorUserId: 'email-user',
            type: 'profile_changed',
            before: { email: 'old@example.com' },
            after: { email: 'new@example.com' },
            createdAt: '2026-06-17T10:03:00.000Z',
          },
          {
            id: 'event-b',
            targetUserId: 'email-user',
            actorUserId: 'email-user',
            type: 'status_changed',
            before: { status: 'profile_required' },
            after: { status: 'pending' },
            createdAt: '2026-06-17T10:02:00.000Z',
          },
          {
            id: 'event-a',
            targetUserId: 'email-user',
            actorUserId: 'email-user',
            type: 'level_changed',
            before: { level: null },
            after: { level: 1 },
            createdAt: '2026-06-17T10:01:00.000Z',
          },
        ],
        identity: {
          auth0Subject: updated.auth0Subject,
          normalizedEmail: updated.normalizedEmail,
          previousNormalizedEmail: original.normalizedEmail,
        },
        expectedUpdatedAt: original.updatedAt,
      })
    );

    expect([...repository.identityReservations.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'normalizedEmail',
          userId: 'email-user',
          active: false,
          releasedAt: '2026-06-17T10:00:00.000Z',
        }),
        expect.objectContaining({
          kind: 'normalizedEmail',
          userId: 'email-user',
          active: true,
          releasedAt: null,
        }),
      ])
    );

    const firstPage = expectOk(
      await repository.listHistory({ targetUserId: 'email-user', limit: 2, cursor: null })
    );
    expect(firstPage.events.map((event) => event.id)).toEqual(['event-c', 'event-b']);
    expect(firstPage.nextCursor).toEqual({
      sortValue: '2026-06-17T10:02:00.000Z',
      id: 'event-b',
    });
    const secondPage = expectOk(
      await repository.listHistory({
        targetUserId: 'email-user',
        limit: 2,
        cursor: firstPage.nextCursor,
      })
    );
    expect(secondPage.events.map((event) => event.id)).toEqual(['event-a']);
  });
});
