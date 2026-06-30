import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearApiAuthProvider, setApiAuthProvider } from './apiClient.js';
import {
  approveUser,
  completeMyProfile,
  getCurrentUser,
  getPendingRequestsCount,
  listPendingRequests,
  listUserHistory,
  listUsers,
  patchUser,
  rejectUser,
  suspendUser,
  unsuspendUser,
} from './userApi.js';

function jsonResponse(data: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tokenResolver(token: string): () => Promise<string> {
  return () => Promise.resolve(token);
}

function parseJsonRequestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') {
    throw new Error('Expected request body to be a JSON string.');
  }

  return JSON.parse(body) as unknown;
}

describe('userApi', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setApiAuthProvider({
      getAccessToken: vi.fn(tokenResolver('user-api-token')),
      refreshAccessToken: vi.fn(tokenResolver('user-api-token-refresh')),
    });
  });

  afterEach(() => {
    clearApiAuthProvider();
    vi.unstubAllGlobals();
  });

  it('requests the current user from the same-origin me endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        state: 'pending',
        user: {
          id: 'user-1',
          email: 'angler@example.com',
          firstName: 'River',
          lastName: 'Walker',
          mobileNumber: '+15550101000',
          role: 'user',
          status: 'pending',
          level: 1,
          effectiveLevel: 1,
        },
      })
    );

    await expect(getCurrentUser()).resolves.toMatchObject({
      state: 'pending',
      user: { id: 'user-1', status: 'pending' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/users/me');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });
  });

  it('submits only profile fields to the complete-profile endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        state: 'approved',
        user: {
          id: 'user-1',
          email: 'angler@example.com',
          firstName: 'River',
          lastName: 'Walker',
          mobileNumber: '+15550101000',
          role: 'user',
          status: 'approved',
          level: 1,
          effectiveLevel: 1,
        },
        authorization: {
          userId: 'user-1',
          auth0Subject: 'auth0|user-1',
          email: 'angler@example.com',
          role: 'user',
          status: 'approved',
          effectiveLevel: 1,
        },
      })
    );

    await expect(
      completeMyProfile({
        firstName: 'River',
        lastName: 'Walker',
        mobileNumber: '+15550101000',
      })
    ).resolves.toMatchObject({
      state: 'approved',
      user: { id: 'user-1', status: 'approved' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/users/me/profile');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT' });
    expect(parseJsonRequestBody(fetchMock.mock.calls[0]?.[1]?.body)).toEqual({
      firstName: 'River',
      lastName: 'Walker',
      mobileNumber: '+15550101000',
    });
  });

  it('lists pending requests and omits undefined query params', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        users: [],
        nextCursor: null,
      })
    );

    await expect(listPendingRequests({ limit: 25 })).resolves.toMatchObject({
      users: [],
      nextCursor: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/users/admin/pending-requests?limit=25');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });
  });

  it('requests the pending requests count from the count endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        count: 3,
      })
    );

    await expect(getPendingRequestsCount()).resolves.toMatchObject({ count: 3 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/users/admin/pending-requests/count');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });
  });

  it('approves a normal user with role and level only', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        user: {
          id: 'user-2',
          role: 'user',
          status: 'approved',
          level: 4,
          effectiveLevel: 4,
        },
        events: [],
      })
    );

    await expect(approveUser('user-2', { role: 'user', level: 4 })).resolves.toMatchObject({
      user: {
        id: 'user-2',
        role: 'user',
        level: 4,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/users/admin/users/user-2/approve');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(parseJsonRequestBody(fetchMock.mock.calls[0]?.[1]?.body)).toEqual({
      role: 'user',
      level: 4,
    });
  });

  it('approves an admin without sending level', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        user: {
          id: 'user-3',
          role: 'admin',
          status: 'approved',
          level: null,
          effectiveLevel: 10,
        },
        events: [],
      })
    );

    await expect(approveUser('user-3', { role: 'admin' })).resolves.toMatchObject({
      user: {
        id: 'user-3',
        role: 'admin',
        level: null,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(parseJsonRequestBody(fetchMock.mock.calls[0]?.[1]?.body)).toEqual({
      role: 'admin',
    });
  });

  it.each([
    ['reject', rejectUser, '/api/users/admin/users/user-4/reject'],
    ['suspend', suspendUser, '/api/users/admin/users/user-4/suspend'],
    ['unsuspend', unsuspendUser, '/api/users/admin/users/user-4/unsuspend'],
  ] as const)('sends an empty object body for %s mutations', async (_label, requestFn, url) => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        user: {
          id: 'user-4',
          role: 'user',
          status: 'approved',
          level: 1,
          effectiveLevel: 1,
        },
        events: [],
      })
    );

    await expect(requestFn('user-4')).resolves.toMatchObject({
      user: { id: 'user-4' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(url);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(parseJsonRequestBody(fetchMock.mock.calls[0]?.[1]?.body)).toEqual({});
  });

  it('lists users with only defined filters', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        users: [],
        nextCursor: 'cursor-2',
        totalCount: 12,
      })
    );

    await expect(
      listUsers({
        query: 'River Walker',
        status: 'approved',
        role: 'user',
        level: 4,
        limit: 50,
      })
    ).resolves.toMatchObject({
      users: [],
      nextCursor: 'cursor-2',
      totalCount: 12,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/users/admin/users?q=River+Walker&status=approved&role=user&level=4&limit=50'
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });
  });

  it('patches a normal user level without requester identity fields', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        user: {
          id: 'user-5',
          role: 'user',
          status: 'approved',
          level: 6,
          effectiveLevel: 6,
        },
        events: [],
      })
    );

    await expect(patchUser('user-5', { level: 6 })).resolves.toMatchObject({
      user: {
        id: 'user-5',
        level: 6,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/users/admin/users/user-5');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PATCH' });
    expect(parseJsonRequestBody(fetchMock.mock.calls[0]?.[1]?.body)).toEqual({ level: 6 });
  });

  it('lists user history with paging params', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        events: [],
        nextCursor: null,
      })
    );

    await expect(
      listUserHistory('user-6', { limit: 10, cursor: 'cursor-1' })
    ).resolves.toMatchObject({
      events: [],
      nextCursor: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/users/admin/users/user-6/history?limit=10&cursor=cursor-1'
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });
  });
});
