import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { err } from '@fa/common-core';

import { encodeUserListCursor } from '../domain/usecases/cursors.js';
import { createServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import {
  adminUser,
  bearer,
  completeUser,
  configureAuthEnv,
  expectData,
  expectError,
  laterNow,
  makeUser,
  mutableClock,
  routeServices,
  setupJwtVerifier,
  signJwt,
  testNow,
} from './routeTestHelpers.js';

describe('user-service admin user routes', () => {
  beforeAll(async () => {
    await setupJwtVerifier();
  });

  beforeEach(() => {
    configureAuthEnv();
  });

  afterEach(() => {
    resetServices();
  });

  it('requires approved admin auth for pending list and count', async () => {
    const pendingServices = routeServices();
    pendingServices.userRepository.seed(makeUser({ status: 'pending' }));
    setServices(pendingServices);
    const pendingApp = await createServer();
    const pendingToken = await signJwt();

    const pendingList = await pendingApp.inject({
      method: 'GET',
      url: '/admin/pending-requests',
      headers: bearer(pendingToken),
    });
    const pendingCount = await pendingApp.inject({
      method: 'GET',
      url: '/admin/pending-requests/count',
      headers: bearer(pendingToken),
    });

    expect(pendingList.statusCode).toBe(403);
    expect(pendingCount.statusCode).toBe(403);

    resetServices();
    const adminServices = routeServices();
    adminServices.userRepository.seed(adminUser());
    adminServices.userRepository.seed(completeUser({ id: 'pending-1' }));
    setServices(adminServices);
    const adminApp = await createServer();
    const adminToken = await signJwt({
      subject: 'auth0|admin-1',
      email: 'admin@example.com',
    });

    const listResponse = await adminApp.inject({
      method: 'GET',
      url: '/admin/pending-requests',
      headers: bearer(adminToken),
    });
    const countResponse = await adminApp.inject({
      method: 'GET',
      url: '/admin/pending-requests/count',
      headers: bearer(adminToken),
    });

    expect(listResponse.statusCode).toBe(200);
    expect(expectData<{ users: unknown[] }>(listResponse).users).toHaveLength(1);
    expect(countResponse.statusCode).toBe(200);
    expect(expectData<{ count: number }>(countResponse)).toEqual({ count: 1 });
  });

  it.each([
    {
      method: 'GET' as const,
      url: '/admin/pending-requests',
    },
    {
      method: 'GET' as const,
      url: '/admin/pending-requests/count',
    },
    {
      method: 'GET' as const,
      url: '/admin/users',
    },
    {
      method: 'POST' as const,
      url: '/admin/users/target-user/approve',
      payload: { role: 'user', level: 3 },
    },
    {
      method: 'POST' as const,
      url: '/admin/users/target-user/reject',
      payload: {},
    },
    {
      method: 'POST' as const,
      url: '/admin/users/target-user/suspend',
      payload: {},
    },
    {
      method: 'POST' as const,
      url: '/admin/users/target-user/unsuspend',
      payload: {},
    },
    {
      method: 'PATCH' as const,
      url: '/admin/users/target-user',
      payload: { role: 'admin', status: 'approved', level: null },
    },
    {
      method: 'GET' as const,
      url: '/admin/users/target-user/history',
    },
  ])(
    'returns 403 for approved non-admin users on $method $url',
    async ({ method, payload, url }) => {
      const services = routeServices();
      services.userRepository.seed(
        makeUser({
          firstName: 'Pat',
          lastName: 'User',
          mobileNumber: '+15550101000',
          status: 'approved',
          level: 4,
          approvedAt: testNow,
        })
      );
      setServices(services);
      const app = await createServer();
      const token = await signJwt();

      const response = await app.inject({
        method,
        url,
        headers: bearer(token),
        ...(payload === undefined ? {} : { payload }),
      });

      expect(response.statusCode).toBe(403);
      expectError(response, 'FORBIDDEN');
    }
  );

  it('lists users and returns approve, reject, suspend, unsuspend, patch, and history contracts', async () => {
    const services = routeServices({
      eventIds: [
        'event-approve-status',
        'event-approve-role',
        'event-reject',
        'event-suspend',
        'event-unsuspend',
        'event-patch-role',
      ],
    });
    services.userRepository.seed(adminUser());
    services.userRepository.seed(completeUser({ id: 'approve-target' }));
    services.userRepository.seed(completeUser({ id: 'reject-target' }));
    services.userRepository.seed(completeUser({ id: 'suspend-target' }));
    services.userRepository.seed(
      completeUser({
        id: 'unsuspend-target',
        status: 'suspended',
        statusBeforeSuspension: 'pending',
        suspendedAt: '2026-06-16T11:00:00.000Z',
      })
    );
    services.userRepository.seed(completeUser({ id: 'patch-target' }));
    setServices(services);
    const app = await createServer();
    const adminToken = await signJwt({
      subject: 'auth0|admin-1',
      email: 'admin@example.com',
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: '/admin/users?status=pending&role=user&level=1',
      headers: bearer(adminToken),
    });
    const approveResponse = await app.inject({
      method: 'POST',
      url: '/admin/users/approve-target/approve',
      headers: bearer(adminToken),
      payload: { role: 'user', level: 3 },
    });
    const rejectResponse = await app.inject({
      method: 'POST',
      url: '/admin/users/reject-target/reject',
      headers: bearer(adminToken),
      payload: {},
    });
    const suspendResponse = await app.inject({
      method: 'POST',
      url: '/admin/users/suspend-target/suspend',
      headers: bearer(adminToken),
      payload: {},
    });
    const unsuspendResponse = await app.inject({
      method: 'POST',
      url: '/admin/users/unsuspend-target/unsuspend',
      headers: bearer(adminToken),
      payload: {},
    });
    const patchResponse = await app.inject({
      method: 'PATCH',
      url: '/admin/users/patch-target',
      headers: bearer(adminToken),
      payload: { role: 'admin', status: 'approved', level: null },
    });
    const historyResponse = await app.inject({
      method: 'GET',
      url: '/admin/users/approve-target/history',
      headers: bearer(adminToken),
    });

    expect(listResponse.statusCode).toBe(200);
    const listData = expectData<{ users: unknown[]; nextCursor: string | null }>(listResponse);
    expect(Array.isArray(listData.users)).toBe(true);
    expect(listData.nextCursor).toBeNull();
    expect(
      expectData<{ user: { status: string; level: number }; events: unknown[] }>(approveResponse)
    ).toMatchObject({ user: { status: 'approved', level: 3 } });
    expect(
      Array.isArray(
        expectData<{ user: { status: string; level: number }; events: unknown[] }>(approveResponse)
          .events
      )
    ).toBe(true);
    expect(expectData<{ user: { status: string } }>(rejectResponse).user.status).toBe('rejected');
    expect(
      expectData<{ user: { status: string; statusBeforeSuspension?: string } }>(suspendResponse)
        .user.status
    ).toBe('suspended');
    expect(expectData<{ user: { status: string } }>(unsuspendResponse).user.status).toBe('pending');
    expect(
      expectData<{ user: { role: string; status: string; level: null } }>(patchResponse).user
    ).toMatchObject({ role: 'admin', status: 'approved', level: null });
    const historyData = expectData<{
      events: { type?: unknown }[];
      nextCursor: string | null;
    }>(historyResponse);
    expect(historyData.nextCursor).toBeNull();
    expect(historyData.events.some((event) => event.type === 'status_changed')).toBe(true);
  });

  it('passes admin user search text to repository filters', async () => {
    const services = routeServices();
    services.userRepository.seed(adminUser());
    let capturedFilters: unknown = null;
    services.userRepository.listUsers = (input) => {
      capturedFilters = input.filters;
      return Promise.resolve({ ok: true, value: { users: [], nextCursor: null, totalCount: 0 } });
    };
    setServices(services);
    const app = await createServer();
    const adminToken = await signJwt({
      subject: 'auth0|admin-1',
      email: 'admin@example.com',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/admin/users?q=Tara%20Target',
      headers: bearer(adminToken),
    });

    expect(response.statusCode).toBe(200);
    expect(capturedFilters).toMatchObject({ query: 'Tara Target' });
  });

  it('returns total count and per-user status transitions for the admin users list', async () => {
    const services = routeServices();
    services.userRepository.seed(adminUser());
    services.userRepository.seed(
      completeUser({
        id: 'active-user',
        status: 'approved',
        level: 4,
        updatedAt: '2026-06-17T10:00:00.000Z',
      })
    );
    services.userRepository.seed(
      completeUser({
        id: 'suspended-user',
        status: 'suspended',
        statusBeforeSuspension: 'approved',
        level: 5,
        suspendedAt: '2026-06-17T09:00:00.000Z',
        updatedAt: '2026-06-17T09:00:00.000Z',
      })
    );
    services.userRepository.seed(
      completeUser({
        id: 'pending-user',
        status: 'pending',
        level: 3,
        updatedAt: '2026-06-17T08:00:00.000Z',
      })
    );
    setServices(services);
    const app = await createServer();
    const adminToken = await signJwt({
      subject: 'auth0|admin-1',
      email: 'admin@example.com',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/admin/users?role=user&limit=2',
      headers: bearer(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const data = expectData<{
      totalCount: number;
      users: { id: string; availableStatusTransitions: string[] }[];
      nextCursor: string | null;
    }>(response);
    expect(data).toMatchObject({
      totalCount: 3,
      users: [
        { id: 'active-user', availableStatusTransitions: ['suspended'] },
        { id: 'suspended-user', availableStatusTransitions: ['approved'] },
      ],
    });
    expect(typeof data.nextCursor).toBe('string');
  });

  it('returns 404 for unknown target users after admin auth succeeds', async () => {
    const services = routeServices();
    services.userRepository.seed(adminUser());
    setServices(services);
    const app = await createServer();
    const adminToken = await signJwt({
      subject: 'auth0|admin-1',
      email: 'admin@example.com',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/admin/users/missing-user/approve',
      headers: bearer(adminToken),
      payload: { role: 'user', level: 1 },
    });

    expect(response.statusCode).toBe(404);
    expectError(response, 'NOT_FOUND');
  });

  it('returns 403 when an admin attempts to modify their own access', async () => {
    const services = routeServices();
    services.userRepository.seed(adminUser());
    setServices(services);
    const app = await createServer();
    const adminToken = await signJwt({
      subject: 'auth0|admin-1',
      email: 'admin@example.com',
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/admin/users/admin-1',
      headers: bearer(adminToken),
      payload: { role: 'user', level: 1 },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Admins cannot modify their own access.',
      },
    });
  });

  it('returns a generic message for admin mutation repository failures', async () => {
    const services = routeServices();
    services.userRepository.seed(adminUser());
    services.userRepository.seed(completeUser({ id: 'patch-target' }));
    services.userRepository.createOrUpdateWithEvents = (input) => {
      void input;
      return Promise.resolve(
        err({
          code: 'PRECONDITION_FAILED',
          message: 'stale firestore precondition details',
        })
      );
    };
    setServices(services);
    const app = await createServer();
    const adminToken = await signJwt({
      subject: 'auth0|admin-1',
      email: 'admin@example.com',
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/admin/users/patch-target',
      headers: bearer(adminToken),
      payload: { role: 'admin', status: 'approved', level: null },
    });

    expect(response.statusCode).toBe(412);
    expectError(response, 'PRECONDITION_FAILED');
    expect(response.json()).toMatchObject({
      error: { message: 'Request precondition failed' },
    });
  });

  it('returns 404 for unknown target user history after admin auth succeeds', async () => {
    const services = routeServices();
    services.userRepository.seed(adminUser());
    setServices(services);
    const app = await createServer();
    const adminToken = await signJwt({
      subject: 'auth0|admin-1',
      email: 'admin@example.com',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/admin/users/missing-user/history',
      headers: bearer(adminToken),
    });

    expect(response.statusCode).toBe(404);
    expectError(response, 'NOT_FOUND');
  });

  it('maps admin repository failures to response envelopes', async () => {
    const services = routeServices();
    services.userRepository.seed(adminUser());
    services.userRepository.seed(completeUser({ id: 'history-target' }));
    services.userRepository.listPending = (input) => {
      void input;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'pending list failed' }));
    };
    services.userRepository.countPending = () =>
      Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'pending count failed' }));
    services.userRepository.listUsers = (input) => {
      void input;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'user list failed' }));
    };
    services.userRepository.listHistory = (input) => {
      void input;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'history failed' }));
    };
    setServices(services);
    const app = await createServer();
    const adminToken = await signJwt({
      subject: 'auth0|admin-1',
      email: 'admin@example.com',
    });

    const pendingList = await app.inject({
      method: 'GET',
      url: '/admin/pending-requests',
      headers: bearer(adminToken),
    });
    const pendingCount = await app.inject({
      method: 'GET',
      url: '/admin/pending-requests/count',
      headers: bearer(adminToken),
    });
    const history = await app.inject({
      method: 'GET',
      url: '/admin/users/history-target/history',
      headers: bearer(adminToken),
    });
    const users = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: bearer(adminToken),
    });

    expect(pendingList.statusCode).toBe(500);
    expectError(pendingList, 'INTERNAL_ERROR');
    expect(pendingList.json()).toMatchObject({
      error: { message: 'Request failed' },
    });
    expect(pendingCount.statusCode).toBe(500);
    expectError(pendingCount, 'INTERNAL_ERROR');
    expect(pendingCount.json()).toMatchObject({
      error: { message: 'Request failed' },
    });
    expect(users.statusCode).toBe(500);
    expectError(users, 'INTERNAL_ERROR');
    expect(users.json()).toMatchObject({
      error: { message: 'Request failed' },
    });
    expect(history.statusCode).toBe(500);
    expectError(history, 'INTERNAL_ERROR');
    expect(history.json()).toMatchObject({
      error: { message: 'Request failed' },
    });
  });

  it('maps admin history target lookup failures to response envelopes', async () => {
    const services = routeServices();
    services.userRepository.seed(adminUser());
    services.userRepository.getById = (userId) => {
      if (userId === 'admin-1') {
        return Promise.resolve({ ok: true, value: adminUser() });
      }
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'target lookup failed' }));
    };
    setServices(services);
    const app = await createServer();
    const adminToken = await signJwt({
      subject: 'auth0|admin-1',
      email: 'admin@example.com',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/admin/users/target/history',
      headers: bearer(adminToken),
    });

    expect(response.statusCode).toBe(500);
    expectError(response, 'INTERNAL_ERROR');
    expect(response.json()).toMatchObject({
      error: { message: 'Request failed' },
    });
  });

  it('returns 400 for invalid admin query, body, and cursor inputs', async () => {
    const services = routeServices();
    services.userRepository.seed(adminUser());
    setServices(services);
    const app = await createServer();
    const adminToken = await signJwt({
      subject: 'auth0|admin-1',
      email: 'admin@example.com',
    });

    const badQuery = await app.inject({
      method: 'GET',
      url: '/admin/users?limit=0',
      headers: bearer(adminToken),
    });
    const badBody = await app.inject({
      method: 'POST',
      url: '/admin/users/target/approve',
      headers: bearer(adminToken),
      payload: { role: 'user' },
    });
    const badCursor = await app.inject({
      method: 'GET',
      url: '/admin/users?cursor=not-a-cursor',
      headers: bearer(adminToken),
    });
    const badPendingCursor = await app.inject({
      method: 'GET',
      url: '/admin/pending-requests?cursor=not-a-cursor',
      headers: bearer(adminToken),
    });
    const badHistoryCursor = await app.inject({
      method: 'GET',
      url: '/admin/users/admin-1/history?cursor=not-a-cursor',
      headers: bearer(adminToken),
    });

    expect(badQuery.statusCode).toBe(400);
    expect(badBody.statusCode).toBe(400);
    expect(badCursor.statusCode).toBe(400);
    expect(badPendingCursor.statusCode).toBe(400);
    expect(badHistoryCursor.statusCode).toBe(400);
  });

  it('returns 412 for invalid admin state transitions', async () => {
    const services = routeServices();
    services.userRepository.seed(adminUser());
    services.userRepository.seed(completeUser({ id: 'incomplete-target', firstName: null }));
    setServices(services);
    const app = await createServer();
    const adminToken = await signJwt({
      subject: 'auth0|admin-1',
      email: 'admin@example.com',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/admin/users/incomplete-target/approve',
      headers: bearer(adminToken),
      payload: { role: 'user', level: 1 },
    });

    expect(response.statusCode).toBe(412);
    expectError(response, 'PRECONDITION_FAILED');
  });

  it('refreshes repeated suspend timestamps while preserving statusBeforeSuspension', async () => {
    const clock = mutableClock(laterNow);
    const services = routeServices({ clock, eventIds: ['event-repeat-suspend'] });
    services.userRepository.seed(adminUser());
    services.userRepository.seed(
      completeUser({
        id: 'already-suspended',
        status: 'suspended',
        statusBeforeSuspension: 'approved',
        suspendedAt: '2026-06-16T11:00:00.000Z',
        level: 5,
        approvedAt: '2026-06-16T10:00:00.000Z',
      })
    );
    setServices(services);
    const app = await createServer();
    const adminToken = await signJwt({
      subject: 'auth0|admin-1',
      email: 'admin@example.com',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/admin/users/already-suspended/suspend',
      headers: bearer(adminToken),
      payload: {},
    });
    const data = expectData<{ user: { status: string } }>(response);
    const stored = await services.userRepository.getById('already-suspended');

    expect(response.statusCode).toBe(200);
    expect(data.user.status).toBe('suspended');
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error('expected stored suspended user');
    }
    expect(stored.value).toMatchObject({
      statusBeforeSuspension: 'approved',
      suspendedAt: laterNow,
    });
  });

  it('accepts valid opaque cursors on admin list routes', async () => {
    const services = routeServices();
    services.userRepository.seed(adminUser());
    setServices(services);
    const app = await createServer();
    const adminToken = await signJwt({
      subject: 'auth0|admin-1',
      email: 'admin@example.com',
    });
    const cursor = encodeUserListCursor({ sortValue: testNow, id: 'cursor-user' });

    const response = await app.inject({
      method: 'GET',
      url: `/admin/users?cursor=${cursor}`,
      headers: bearer(adminToken),
    });

    expect(response.statusCode).toBe(200);
  });
});
