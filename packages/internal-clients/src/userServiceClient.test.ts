import { describe, expect, it, vi } from 'vitest';

import {
  createUserServiceClient,
  type FetchLike,
  type InternalClientError,
} from '@fa/internal-clients';
import type {
  AuthorizationContext,
  AuthorizationResolveRequest,
  AuthorizationResolveResponse,
  CurrentUserSummaryForStatus,
  InternalUserIdentityLookupResponse,
  UserStatus,
} from '@fa/http-contracts';

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');

  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers,
  });
}

function requireStringBody(body: BodyInit | null | undefined): string {
  if (typeof body === 'string') {
    return body;
  }

  throw new TypeError('Expected request body to be serialized JSON');
}

const resolveRequest = {
  auth0: {
    subject: 'auth0|user-1',
    email: 'angler@example.com',
    emailVerified: true,
    name: 'River Angler',
  },
} satisfies AuthorizationResolveRequest;

function userForStatus<Status extends UserStatus>(
  status: Status
): CurrentUserSummaryForStatus<Status> {
  return {
    id: `user-${status}`,
    email: `${status}@example.com`,
    firstName: status === 'profile_required' ? null : 'River',
    lastName: status === 'profile_required' ? null : 'Angler',
    mobileNumber: status === 'profile_required' ? null : '+15550101000',
    role: 'user',
    status,
    level: 4,
    effectiveLevel: 4,
  };
}

const approvedAuthorization: AuthorizationContext = {
  userId: 'user-approved',
  auth0Subject: 'auth0|user-1',
  email: 'approved@example.com',
  firstName: 'River',
  lastName: 'Angler',
  role: 'user',
  status: 'approved',
  effectiveLevel: 4,
};

function approvedResponse(): AuthorizationResolveResponse {
  return {
    state: 'approved',
    user: userForStatus('approved'),
    authorization: approvedAuthorization,
  };
}

describe('createUserServiceClient', () => {
  it('posts resolver requests to the internal authorization route with internal auth', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        ok: true,
        data: approvedResponse(),
      })
    );
    const client = createUserServiceClient({
      baseUrl: 'http://user-service.test///',
      internalAuthToken: 'internal-token',
      fetch: fetchImpl,
      timeoutMs: 500,
    });

    const result = await client.resolveAuthorization(resolveRequest);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('http://user-service.test/internal/authorization/resolve');
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Auth': 'internal-token',
        },
      })
    );
    expect(JSON.parse(requireStringBody(init?.body))).toEqual({
      auth0: {
        subject: 'auth0|user-1',
        email: 'angler@example.com',
        emailVerified: true,
        name: 'River Angler',
      },
    });
    expect(result).toEqual(approvedResponse());
  });

  it('serializes only the resolver request contract fields', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        ok: true,
        data: approvedResponse(),
      })
    );
    const client = createUserServiceClient({
      baseUrl: 'http://user-service.test',
      internalAuthToken: 'internal-token',
      fetch: fetchImpl,
    });

    await client.resolveAuthorization({
      ...resolveRequest,
      userId: 'client-controlled',
      role: 'admin',
      status: 'approved',
      level: 10,
      workspaceId: 'anonymous',
      ownerId: 'owner-1',
    } as unknown as AuthorizationResolveRequest);

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(JSON.parse(requireStringBody(init?.body))).toEqual(resolveRequest);
  });

  it('posts user identity lookup requests to the internal users lookup route', async () => {
    const lookupResponse = {
      users: [
        {
          id: 'user-1',
          email: 'river@example.com',
          firstName: 'River',
          lastName: 'Walker',
          role: 'admin',
          status: 'approved',
          effectiveLevel: 7,
        },
      ],
    } satisfies InternalUserIdentityLookupResponse;
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        ok: true,
        data: lookupResponse,
      })
    );
    const client = createUserServiceClient({
      baseUrl: 'http://user-service.test///',
      internalAuthToken: 'internal-token',
      fetch: fetchImpl,
    });

    const result = await client.lookupUserIdentities({
      userIds: ['user-1', 'user-2'],
      role: 'admin',
    } as unknown as { userIds: string[] });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('http://user-service.test/internal/users/lookup');
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Auth': 'internal-token',
        },
      })
    );
    expect(JSON.parse(requireStringBody(init?.body))).toEqual({
      userIds: ['user-1', 'user-2'],
    });
    expect(result).toEqual(lookupResponse);
  });

  it('parses each valid authorization resolver state', async () => {
    const responses: AuthorizationResolveResponse[] = [
      approvedResponse(),
      {
        state: 'profile_required',
        user: userForStatus('profile_required'),
        requiredFields: ['firstName', 'lastName', 'mobileNumber'],
      },
      {
        state: 'profile_required',
        user: null,
        requiredFields: ['firstName', 'lastName', 'mobileNumber'],
      },
      {
        state: 'pending',
        user: userForStatus('pending'),
      },
      {
        state: 'rejected',
        user: userForStatus('rejected'),
      },
      {
        state: 'suspended',
        user: userForStatus('suspended'),
      },
    ];

    for (const response of responses) {
      const client = createUserServiceClient({
        baseUrl: 'http://user-service.test',
        internalAuthToken: 'internal-token',
        fetch: vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ ok: true, data: response })),
      });

      await expect(client.resolveAuthorization(resolveRequest), response.state).resolves.toEqual(
        response
      );
    }
  });

  it('rejects approved responses whose user status is not approved', async () => {
    const client = createUserServiceClient({
      baseUrl: 'http://user-service.test',
      internalAuthToken: 'internal-token',
      fetch: vi.fn<FetchLike>().mockResolvedValue(
        jsonResponse({
          ok: true,
          data: {
            ...approvedResponse(),
            user: userForStatus('pending'),
          },
        })
      ),
    });

    await expect(client.resolveAuthorization(resolveRequest)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      service: 'user-service',
    });
  });

  it('rejects non-approved responses that include authorization', async () => {
    const client = createUserServiceClient({
      baseUrl: 'http://user-service.test',
      internalAuthToken: 'internal-token',
      fetch: vi.fn<FetchLike>().mockResolvedValue(
        jsonResponse({
          ok: true,
          data: {
            state: 'pending',
            user: userForStatus('pending'),
            authorization: approvedAuthorization,
          },
        })
      ),
    });

    await expect(client.resolveAuthorization(resolveRequest)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      service: 'user-service',
    });
  });

  it('rejects unknown states and missing required fields', async () => {
    const cases: { name: string; data: unknown }[] = [
      {
        name: 'unknown state',
        data: { state: 'waiting', user: userForStatus('pending') },
      },
      {
        name: 'approved without authorization',
        data: { state: 'approved', user: userForStatus('approved') },
      },
      {
        name: 'profile_required without requiredFields',
        data: { state: 'profile_required', user: null },
      },
      {
        name: 'pending without user',
        data: { state: 'pending' },
      },
    ];

    for (const item of cases) {
      const client = createUserServiceClient({
        baseUrl: 'http://user-service.test',
        internalAuthToken: 'internal-token',
        fetch: vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ ok: true, data: item.data })),
      });

      await expect(client.resolveAuthorization(resolveRequest), item.name).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
        service: 'user-service',
      });
    }
  });

  it('rejects resolver responses with unexpected fields', async () => {
    const cases: { name: string; data: unknown }[] = [
      {
        name: 'approved branch extra field',
        data: { ...approvedResponse(), workspaceId: 'anonymous' },
      },
      {
        name: 'user summary extra field',
        data: {
          state: 'pending',
          user: { ...userForStatus('pending'), ownerId: 'owner-1' },
        },
      },
      {
        name: 'authorization extra field',
        data: {
          state: 'approved',
          user: userForStatus('approved'),
          authorization: { ...approvedAuthorization, level: 4 },
        },
      },
    ];

    for (const item of cases) {
      const client = createUserServiceClient({
        baseUrl: 'http://user-service.test',
        internalAuthToken: 'internal-token',
        fetch: vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ ok: true, data: item.data })),
      });

      await expect(client.resolveAuthorization(resolveRequest), item.name).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
        service: 'user-service',
      });
    }
  });

  it('rejects user identity lookup responses that omit admin verification fields', async () => {
    const client = createUserServiceClient({
      baseUrl: 'http://user-service.test',
      internalAuthToken: 'internal-token',
      fetch: vi.fn<FetchLike>().mockResolvedValue(
        jsonResponse({
          ok: true,
          data: {
            users: [
              {
                id: 'user-1',
                email: 'river@example.com',
                firstName: 'River',
                lastName: 'Walker',
                effectiveLevel: 7,
              },
            ],
          },
        })
      ),
    });

    await expect(client.lookupUserIdentities({ userIds: ['user-1'] })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      service: 'user-service',
    });
  });

  it('maps user-service error envelopes to typed internal client errors', async () => {
    const client = createUserServiceClient({
      baseUrl: 'http://user-service.test',
      internalAuthToken: 'internal-token',
      fetch: vi.fn<FetchLike>().mockResolvedValue(
        jsonResponse(
          {
            ok: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Identity cannot be safely bound',
              details: { reason: 'identity-conflict' },
            },
          },
          { status: 403 }
        )
      ),
    });

    await expect(client.resolveAuthorization(resolveRequest)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Identity cannot be safely bound',
      service: 'user-service',
      statusCode: 403,
      details: { reason: 'identity-conflict' },
    } satisfies Partial<InternalClientError>);
  });

  it('preserves shared abort and timeout behavior', async () => {
    const timeoutFetch = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        })
    );
    const client = createUserServiceClient({
      baseUrl: 'http://user-service.test',
      internalAuthToken: 'internal-token',
      fetch: timeoutFetch,
      timeoutMs: 1,
    });

    await expect(client.resolveAuthorization(resolveRequest)).rejects.toMatchObject({
      code: 'ABORTED',
      message: 'User Service internal request was aborted',
      service: 'user-service',
    });

    const controller = new AbortController();
    const abortFetch = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
          controller.abort();
        })
    );
    const abortClient = createUserServiceClient({
      baseUrl: 'http://user-service.test',
      internalAuthToken: 'internal-token',
      fetch: abortFetch,
    });

    await expect(
      abortClient.resolveAuthorization(resolveRequest, { signal: controller.signal })
    ).rejects.toMatchObject({
      code: 'ABORTED',
      message: 'User Service internal request was aborted',
      service: 'user-service',
    });
  });
});
