import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { INTERNAL_AUTH_HEADER } from '@fa/http-contracts';

import { createServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import {
  adminUser,
  bearer,
  completeUser,
  configureAuthEnv,
  expectData,
  expectError,
  makeUser,
  routeServices,
  setupJwtVerifier,
} from './routeTestHelpers.js';

describe('user-service internal authorization resolver route', () => {
  beforeAll(async () => {
    await setupJwtVerifier();
  });

  beforeEach(() => {
    configureAuthEnv();
  });

  afterEach(() => {
    resetServices();
  });

  it.each([
    ['missing', {}],
    ['bad', { [INTERNAL_AUTH_HEADER]: 'bad-token' }],
  ] as const)(
    'returns 401 for %s internal auth on authorization resolve',
    async (_name, headers) => {
      setServices(routeServices());
      const app = await createServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/authorization/resolve',
        headers,
        payload: {
          auth0: { subject: 'auth0|user-1', email: 'user@example.com', emailVerified: true },
        },
      });

      expect(response.statusCode).toBe(401);
      expectError(response, 'UNAUTHORIZED');
    }
  );

  it.each([
    ['missing', {}],
    ['bad', { [INTERNAL_AUTH_HEADER]: 'bad-token' }],
  ] as const)(
    'returns 401 for %s internal auth on user identity lookup',
    async (_name, headers) => {
      setServices(routeServices());
      const app = await createServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/users/lookup',
        headers,
        payload: { userIds: ['user-1'] },
      });

      expect(response.statusCode).toBe(401);
      expectError(response, 'UNAUTHORIZED');
    }
  );

  it.each([
    ['top-level userId', { userId: 'client-user-id' }],
    ['client role', { auth0: { role: 'admin' } }],
    ['client status', { auth0: { status: 'approved' } }],
    ['client level', { auth0: { level: 10 } }],
  ] as const)(
    'rejects client-supplied %s fields through schema validation',
    async (_name, extra) => {
      setServices(routeServices());
      const app = await createServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/authorization/resolve',
        headers: { [INTERNAL_AUTH_HEADER]: 'internal-token' },
        payload: {
          auth0: { subject: 'auth0|user-1', email: 'user@example.com', emailVerified: true },
          ...extra,
        },
      });

      expect(response.statusCode).toBe(400);
      expectError(response, 'INVALID_REQUEST');
    }
  );

  it.each([
    ['role', { role: 'admin' }],
    ['status', { status: 'approved' }],
    ['level', { level: 10 }],
    ['duplicate user IDs', { userIds: ['user-1', 'user-1'] }],
  ] as const)('rejects client-supplied %s fields on user identity lookup', async (_name, extra) => {
    setServices(routeServices());
    const app = await createServer();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/users/lookup',
      headers: { [INTERNAL_AUTH_HEADER]: 'internal-token' },
      payload: {
        userIds: ['user-1'],
        ...extra,
      },
    });

    expect(response.statusCode).toBe(400);
    expectError(response, 'INVALID_REQUEST');
  });

  it('returns approved and non-approved authorization states without reading bearer tokens', async () => {
    const approvedServices = routeServices();
    approvedServices.userRepository.seed(
      adminUser({
        id: 'approved-user',
        auth0Subject: 'auth0|approved-user',
        email: 'approved@example.com',
        normalizedEmail: 'approved@example.com',
      })
    );
    setServices(approvedServices);
    const approvedApp = await createServer();

    const approvedResponse = await approvedApp.inject({
      method: 'POST',
      url: '/internal/authorization/resolve',
      headers: {
        [INTERNAL_AUTH_HEADER]: 'internal-token',
        ...bearer('not-a-real-jwt'),
      },
      payload: {
        auth0: {
          subject: 'auth0|approved-user',
          email: 'approved@example.com',
          emailVerified: true,
        },
      },
    });

    expect(approvedResponse.statusCode).toBe(200);
    expect(
      expectData<{ state: string; authorization: { role: string } }>(approvedResponse)
    ).toMatchObject({
      state: 'approved',
      authorization: { role: 'admin' },
    });

    resetServices();
    const pendingServices = routeServices();
    pendingServices.userRepository.seed(makeUser({ status: 'pending' }));
    setServices(pendingServices);
    const pendingApp = await createServer();

    const pendingResponse = await pendingApp.inject({
      method: 'POST',
      url: '/internal/authorization/resolve',
      headers: { [INTERNAL_AUTH_HEADER]: 'internal-token' },
      payload: {
        auth0: { subject: 'auth0|user-1', email: 'user@example.com', emailVerified: true },
      },
    });

    expect(pendingResponse.statusCode).toBe(200);
    expect(expectData<{ state: string }>(pendingResponse)).toMatchObject({ state: 'pending' });
  });

  it('maps identity binding failures to 403', async () => {
    setServices(routeServices());
    const app = await createServer();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/authorization/resolve',
      headers: { [INTERNAL_AUTH_HEADER]: 'internal-token' },
      payload: { auth0: { subject: 'auth0|missing-email' } },
    });

    expect(response.statusCode).toBe(403);
    expectError(response, 'FORBIDDEN');
  });

  it('looks up user identities for internal service consumers', async () => {
    const services = routeServices();
    services.userRepository.seed(
      completeUser({
        id: 'river-user',
        email: 'river@example.com',
        normalizedEmail: 'river@example.com',
        firstName: 'River',
        lastName: 'Walker',
        role: 'user',
        level: 7,
        status: 'approved',
      })
    );
    services.userRepository.seed(
      adminUser({
        id: 'admin-user',
        email: 'admin@example.com',
        normalizedEmail: 'admin@example.com',
      })
    );
    setServices(services);
    const app = await createServer();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/users/lookup',
      headers: { [INTERNAL_AUTH_HEADER]: 'internal-token' },
      payload: {
        userIds: ['river-user', 'missing-user', 'admin-user'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(expectData<{ users: unknown[] }>(response)).toEqual({
      users: [
        {
          id: 'river-user',
          email: 'river@example.com',
          firstName: 'River',
          lastName: 'Walker',
          role: 'user',
          status: 'approved',
          effectiveLevel: 7,
        },
        {
          id: 'admin-user',
          email: 'admin@example.com',
          firstName: 'Ada',
          lastName: 'Admin',
          role: 'admin',
          status: 'approved',
          effectiveLevel: 10,
        },
      ],
    });
  });
});
