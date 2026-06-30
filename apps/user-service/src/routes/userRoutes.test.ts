import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { err } from '@fa/common-core';

import { createServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import {
  bearer,
  configureAuthEnv,
  expectData,
  expectError,
  makeUser,
  routeServices,
  setupJwtVerifier,
  signJwt,
} from './routeTestHelpers.js';

describe('user-service current user routes', () => {
  beforeAll(async () => {
    await setupJwtVerifier();
  });

  beforeEach(() => {
    configureAuthEnv();
  });

  afterEach(() => {
    resetServices();
  });

  it('returns 401 when /me is missing a bearer token', async () => {
    setServices(routeServices());
    const app = await createServer();

    const response = await app.inject({ method: 'GET', url: '/me' });

    expect(response.statusCode).toBe(401);
    expectError(response, 'UNAUTHORIZED');
  });

  it('returns 401 when /me receives a malformed authorization header', async () => {
    setServices(routeServices());
    const app = await createServer();

    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Token not-a-bearer-token' },
    });

    expect(response.statusCode).toBe(401);
    expectError(response, 'UNAUTHORIZED');
  });

  it.each([
    ['profile_required', null],
    ['pending', null],
    ['rejected', null],
    ['suspended', 'pending'],
    ['approved', null],
  ] as const)('returns the %s /me account state envelope', async (status, priorStatus) => {
    const services = routeServices();
    services.userRepository.seed(
      makeUser({
        status,
        statusBeforeSuspension: priorStatus,
        suspendedAt: status === 'suspended' ? '2026-06-16T11:00:00.000Z' : null,
        firstName: status === 'profile_required' ? null : 'Pat',
        lastName: status === 'profile_required' ? null : 'Angler',
        mobileNumber: status === 'profile_required' ? null : '+15550101000',
        level: status === 'approved' ? 5 : null,
        approvedAt: status === 'approved' ? '2026-06-16T11:00:00.000Z' : null,
      })
    );
    setServices(services);
    const app = await createServer();
    const token = await signJwt();

    const response = await app.inject({ method: 'GET', url: '/me', headers: bearer(token) });
    const data = expectData<{ state: string; user: { status: string } | null }>(response);

    expect(response.statusCode).toBe(200);
    expect(data.state).toBe(status);
    if (data.user !== null) {
      expect(data.user.status).toBe(status);
    }
  });

  it.each([
    ['identity conflict', { subject: 'auth0|other-user', email: 'user@example.com' }],
    ['missing email', { subject: 'auth0|missing-email', omitEmail: true }],
    [
      'unverified email',
      { subject: 'auth0|user-1', email: 'user@outside.test', emailVerified: false },
    ],
  ] as const)('returns 403 for /me %s', async (_name, claims) => {
    const services = routeServices();
    services.userRepository.seed(makeUser());
    setServices(services);
    const app = await createServer();
    const token = await signJwt(claims);

    const response = await app.inject({ method: 'GET', url: '/me', headers: bearer(token) });

    expect(response.statusCode).toBe(403);
    expectError(response, 'FORBIDDEN');
  });

  it('bootstraps an allowed unverified signup alias from /me into profile_required', async () => {
    const services = routeServices();
    setServices(services);
    const app = await createServer();
    const token = await signJwt({
      subject: 'auth0|signup-alias',
      email: 'SignupRoute+Allowed@Example.com',
      emailVerified: false,
    });

    const response = await app.inject({ method: 'GET', url: '/me', headers: bearer(token) });
    const data = expectData<{
      state: string;
      user: { email: string; status: string } | null;
    }>(response);

    expect(response.statusCode).toBe(200);
    expect(data).toMatchObject({
      state: 'profile_required',
      user: {
        email: 'SignupRoute+Allowed@Example.com',
        status: 'profile_required',
      },
    });
    const stored = await services.userRepository.findActiveByAuth0Subject('auth0|signup-alias');
    expect(stored).toMatchObject({
      ok: true,
      value: {
        normalizedEmail: 'signuproute+allowed@example.com',
        status: 'profile_required',
      },
    });
  });

  it('updates a profile_required user profile and returns the pending account state', async () => {
    const services = routeServices({ eventIds: ['event-profile', 'event-status'] });
    services.userRepository.seed(makeUser());
    setServices(services);
    const app = await createServer();
    const token = await signJwt();

    const response = await app.inject({
      method: 'PUT',
      url: '/me/profile',
      headers: bearer(token),
      payload: {
        firstName: '  Pat ',
        lastName: ' Angler ',
        mobileNumber: '+15550101000',
      },
    });
    const data = expectData<{
      state: string;
      user: { firstName: string | null; lastName: string | null; status: string };
    }>(response);

    expect(response.statusCode).toBe(200);
    expect(data).toMatchObject({
      state: 'pending',
      user: {
        firstName: 'Pat',
        lastName: 'Angler',
        status: 'pending',
      },
    });
  });

  it('updates an approved user profile and keeps the approved account state', async () => {
    const services = routeServices({ eventIds: ['event-profile'] });
    services.userRepository.seed(
      makeUser({
        firstName: 'Old',
        lastName: 'Name',
        mobileNumber: '+15550101000',
        status: 'approved',
        level: 6,
        approvedAt: '2026-06-16T11:00:00.000Z',
      })
    );
    setServices(services);
    const app = await createServer();
    const token = await signJwt();

    const response = await app.inject({
      method: 'PUT',
      url: '/me/profile',
      headers: bearer(token),
      payload: {
        firstName: 'New',
        lastName: 'Name',
        mobileNumber: '+15550101008',
      },
    });
    const data = expectData<{ state: string; authorization: { effectiveLevel: number } }>(response);

    expect(response.statusCode).toBe(200);
    expect(data).toMatchObject({ state: 'approved', authorization: { effectiveLevel: 6 } });
  });

  it('returns 400 for invalid profile payloads before mutating a profile_required user', async () => {
    const services = routeServices();
    services.userRepository.seed(makeUser());
    setServices(services);
    const app = await createServer();
    const token = await signJwt();

    const response = await app.inject({
      method: 'PUT',
      url: '/me/profile',
      headers: bearer(token),
      payload: {
        firstName: '',
        lastName: 'Angler',
        mobileNumber: '555-1234',
      },
    });

    expect(response.statusCode).toBe(400);
    expectError(response, 'INVALID_REQUEST');
    await expect(services.userRepository.getById('user-1')).resolves.toMatchObject({
      ok: true,
      value: { status: 'profile_required', firstName: null },
    });
  });

  it.each(['pending', 'rejected', 'suspended'] as const)(
    'rejects %s profile updates with 403',
    async (status) => {
      const services = routeServices();
      services.userRepository.seed(
        makeUser({
          status,
          statusBeforeSuspension: status === 'suspended' ? 'pending' : null,
          suspendedAt: status === 'suspended' ? '2026-06-16T11:00:00.000Z' : null,
        })
      );
      setServices(services);
      const app = await createServer();
      const token = await signJwt();

      const response = await app.inject({
        method: 'PUT',
        url: '/me/profile',
        headers: bearer(token),
        payload: {
          firstName: 'No',
          lastName: 'Access',
          mobileNumber: '+15550101000',
        },
      });

      expect(response.statusCode).toBe(403);
      expectError(response, 'FORBIDDEN');
    }
  );

  it('returns a coarse message when profile persistence fails internally', async () => {
    const services = routeServices({ eventIds: ['event-profile', 'event-status'] });
    services.userRepository.seed(makeUser());
    services.userRepository.createOrUpdateWithEvents = () =>
      Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'raw firestore profile failure' }));
    setServices(services);
    const app = await createServer();
    const token = await signJwt();

    const response = await app.inject({
      method: 'PUT',
      url: '/me/profile',
      headers: bearer(token),
      payload: {
        firstName: 'Pat',
        lastName: 'Angler',
        mobileNumber: '+15550101000',
      },
    });

    expect(response.statusCode).toBe(500);
    expectError(response, 'INTERNAL_ERROR');
    expect(response.json()).toMatchObject({
      error: { message: 'Request failed' },
    });
  });
});
