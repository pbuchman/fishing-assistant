import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthorizationContext, AuthorizationResolveResponse } from '@fa/http-contracts';
import { InternalClientError } from '@fa/internal-clients';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { resetServices, setServices } from '../services.js';
import {
  requireApprovedAdminAuth,
  requireApprovedRequestAuthorization,
  requireApprovedUserAuth,
} from './authPreHandlers.js';

process.env['NODE_ENV'] = 'test';
process.env['FA_AUTH0_ISSUER'] = 'https://auth.example.com/';
process.env['FA_AUTH0_AUDIENCE'] = 'https://api.fishing-assistant.online';
process.env['FA_AUTH0_JWKS_URI'] = 'https://auth.example.com/.well-known/jwks.json';

function authorization(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    userId: 'auth-user-1',
    auth0Subject: 'auth0|auth-user-1',
    email: 'auth-user-1@example.com',
    role: 'user',
    status: 'approved',
    effectiveLevel: 7,
    ...overrides,
  };
}

function resolverResponse(
  state: AuthorizationResolveResponse['state'],
  auth: AuthorizationContext = authorization()
): AuthorizationResolveResponse {
  const user = {
    id: auth.userId,
    email: auth.email,
    firstName: 'Auth',
    lastName: 'Tester',
    mobileNumber: '+15550101000',
    role: auth.role,
    level: auth.effectiveLevel,
    effectiveLevel: auth.effectiveLevel,
  };

  if (state !== 'approved') {
    if (state === 'profile_required') {
      return {
        state,
        user: { ...user, status: state },
        requiredFields: ['firstName'],
      };
    }
    if (state === 'pending') {
      return { state, user: { ...user, status: state } };
    }
    if (state === 'rejected') {
      return { state, user: { ...user, status: state } };
    }

    return { state, user: { ...user, status: state } };
  }

  return {
    state: 'approved',
    user: {
      ...user,
      status: auth.status,
    },
    authorization: auth,
  };
}

function fakeRequest(headers: Record<string, string> = {}): FastifyRequest {
  return {
    headers,
    method: 'GET',
    id: 'request-1',
    log: { warn: vi.fn() },
  } as unknown as FastifyRequest;
}

function fakeReply(): FastifyReply {
  const reply = {
    fail: vi.fn(() => Promise.resolve(reply)),
  };
  return reply as unknown as FastifyReply;
}

function failMock(reply: FastifyReply): ReturnType<typeof vi.fn> {
  const typedReply = reply as unknown as { fail: ReturnType<typeof vi.fn> };
  return typedReply.fail;
}

function setAuthServices(input: {
  verifierOk?: boolean;
  resolver?: () => Promise<AuthorizationResolveResponse>;
}): void {
  setServices({
    auth0JwtVerifier: () =>
      Promise.resolve(
        input.verifierOk === false
          ? {
              ok: false as const,
              error: { statusCode: 401, code: 'UNAUTHORIZED', message: 'Unauthorized' },
            }
          : {
              ok: true as const,
              identity: {
                subject: 'auth0|auth-user-1',
                email: 'auth-user-1@example.com',
                emailVerified: true,
                name: 'Auth Tester',
              },
            }
      ),
    userServiceClient: {
      resolveAuthorization: input.resolver ?? (() => Promise.resolve(resolverResponse('approved'))),
      lookupUserIdentities: () => Promise.resolve({ users: [] }),
    },
  });
}

describe('chat auth prehandlers', () => {
  afterEach(() => {
    resetServices();
  });

  it('rejects missing and malformed bearer tokens before jwt verification', async () => {
    setAuthServices({});
    const missingReply = fakeReply();
    await requireApprovedUserAuth(fakeRequest(), missingReply);
    expect(failMock(missingReply)).toHaveBeenCalledWith('UNAUTHORIZED', 'Unauthorized');

    const malformedReply = fakeReply();
    await requireApprovedUserAuth(
      fakeRequest({ authorization: 'Basic not-a-bearer-token' }),
      malformedReply
    );
    expect(failMock(malformedReply)).toHaveBeenCalledWith('UNAUTHORIZED', 'Unauthorized');
  });

  it('rejects jwt verification failures', async () => {
    setAuthServices({ verifierOk: false });
    const reply = fakeReply();

    await requireApprovedUserAuth(fakeRequest({ authorization: 'Bearer token' }), reply);

    expect(failMock(reply)).toHaveBeenCalledWith('UNAUTHORIZED', 'Unauthorized');
  });

  it.each(['profile_required', 'pending', 'rejected', 'suspended'] as const)(
    'rejects non-approved resolver state: %s',
    async (state) => {
      setAuthServices({ resolver: () => Promise.resolve(resolverResponse(state)) });
      const reply = fakeReply();

      await requireApprovedUserAuth(fakeRequest({ authorization: 'Bearer token' }), reply);

      expect(failMock(reply)).toHaveBeenCalledWith('FORBIDDEN', 'Forbidden');
    }
  );

  it('maps resolver forbidden and unavailable errors separately', async () => {
    setAuthServices({
      resolver: () =>
        Promise.reject(
          new InternalClientError({
            code: 'FORBIDDEN',
            message: 'Forbidden',
            service: 'user-service',
            statusCode: 403,
          })
        ),
    });
    const forbiddenReply = fakeReply();
    await requireApprovedUserAuth(fakeRequest({ authorization: 'Bearer token' }), forbiddenReply);
    expect(failMock(forbiddenReply)).toHaveBeenCalledWith('FORBIDDEN', 'Forbidden');

    setAuthServices({ resolver: () => Promise.reject(new Error('offline')) });
    const unavailableReply = fakeReply();
    await requireApprovedUserAuth(fakeRequest({ authorization: 'Bearer token' }), unavailableReply);
    expect(failMock(unavailableReply)).toHaveBeenCalledWith(
      'DOWNSTREAM_ERROR',
      'Authorization service unavailable'
    );
  });

  it('allows approved users and requires admin role for admin routes', async () => {
    setAuthServices({});
    const userRequest = fakeRequest({ authorization: 'Bearer token' });
    const userReply = fakeReply();
    await expect(requireApprovedUserAuth(userRequest, userReply)).resolves.toBeUndefined();
    expect(requireApprovedRequestAuthorization(userRequest)).toMatchObject({
      userId: 'auth-user-1',
      role: 'user',
    });

    const adminDeniedReply = fakeReply();
    await requireApprovedAdminAuth(
      fakeRequest({ authorization: 'Bearer token' }),
      adminDeniedReply
    );
    expect(failMock(adminDeniedReply)).toHaveBeenCalledWith('FORBIDDEN', 'Forbidden');

    setAuthServices({
      resolver: () =>
        Promise.resolve(resolverResponse('approved', authorization({ role: 'admin' }))),
    });
    const adminReply = fakeReply();
    await expect(
      requireApprovedAdminAuth(fakeRequest({ authorization: 'Bearer token' }), adminReply)
    ).resolves.toBeUndefined();
  });

  it('throws when route handlers read authorization before the prehandler resolved it', () => {
    expect(() => requireApprovedRequestAuthorization(fakeRequest())).toThrow(
      'Route auth prehandler did not resolve approved authorization'
    );
  });
});
