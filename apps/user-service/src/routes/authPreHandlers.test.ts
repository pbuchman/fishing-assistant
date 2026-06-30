import { err } from '@fa/common-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import {
  bearer,
  configureAuthEnv,
  makeUser,
  routeServices,
  setupJwtVerifier,
} from './routeTestHelpers.js';

function createCaptureLogger() {
  const entries: { level: 'warn' | 'info'; message: string | undefined; payload: unknown }[] = [];
  const logger = {
    level: 'info',
    child: () => logger,
    info: (payload: unknown, message?: string) => {
      entries.push({ level: 'info', message, payload });
    },
    warn: (payload: unknown, message?: string) => {
      entries.push({ level: 'warn', message, payload });
    },
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    silent: () => undefined,
  };

  return { entries, logger };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function expectCanonicalAuthFailure(
  entries: { level: 'warn' | 'info'; message: string | undefined; payload: unknown }[],
  payload: Record<string, unknown>
): void {
  const matchingEntry = entries.find((entry) => {
    if (entry.level !== 'warn' || entry.message !== 'Auth failure' || !isRecord(entry.payload)) {
      return false;
    }

    const entryPayload = entry.payload;
    return (
      Object.entries(payload).every(([key, value]) => entryPayload[key] === value) &&
      typeof entryPayload['requestId'] === 'string'
    );
  });
  expect(matchingEntry).toBeDefined();

  const serialized = JSON.stringify(entries);
  expect(serialized).not.toContain('auth0|');
  expect(serialized).not.toContain('@example.com');
  expect(serialized).not.toContain('Bearer ');
  expect(serialized).not.toContain('internal-token');
}

describe('user-service auth prehandlers', () => {
  beforeAll(async () => {
    await setupJwtVerifier();
  });

  beforeEach(() => {
    configureAuthEnv();
  });

  afterEach(() => {
    resetServices();
  });

  it('logs canonical safe auth failures for missing bearer tokens on current-user routes', async () => {
    const { entries, logger } = createCaptureLogger();
    setServices(routeServices());
    const app = await createServer(undefined, {
      serverOptions: {
        loggerInstance: logger,
      },
    });

    const response = await app.inject({ method: 'GET', url: '/me' });

    expect(response.statusCode).toBe(401);
    expectCanonicalAuthFailure(entries, {
      event: 'auth_bearer_missing',
      routeGroup: 'user-self',
      method: 'GET',
      statusCode: 401,
      reason: 'missing_bearer_token',
    });
  });

  it('logs canonical safe auth failures for invalid JWTs on current-user routes', async () => {
    const { entries, logger } = createCaptureLogger();
    const services = routeServices();
    setServices({
      ...services,
      auth0JwtVerifier: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'bad token' },
      }),
    });
    const app = await createServer(undefined, {
      serverOptions: {
        loggerInstance: logger,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: bearer('expired-token'),
    });

    expect(response.statusCode).toBe(401);
    expectCanonicalAuthFailure(entries, {
      event: 'auth_jwt_invalid',
      routeGroup: 'user-self',
      method: 'GET',
      statusCode: 401,
      reason: 'jwt_verification_failed',
    });
  });

  it('logs canonical resolver denial events for identity conflicts on current-user routes', async () => {
    const { entries, logger } = createCaptureLogger();
    const services = routeServices();
    services.userRepository.seed(makeUser());
    setServices({
      ...services,
      auth0JwtVerifier: vi.fn().mockResolvedValue({
        ok: true,
        identity: {
          subject: 'auth0|other-user',
          email: 'user@example.com',
          emailVerified: true,
        },
      }),
    });
    const app = await createServer(undefined, {
      serverOptions: {
        loggerInstance: logger,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: bearer('test-token'),
    });

    expect(response.statusCode).toBe(403);
    expectCanonicalAuthFailure(entries, {
      event: 'auth_resolver_denied',
      routeGroup: 'user-self',
      method: 'GET',
      statusCode: 403,
      reason: 'resolver_forbidden',
    });
  });

  it('logs canonical resolver unavailable events for current-user routes', async () => {
    const { entries, logger } = createCaptureLogger();
    const services = routeServices();
    services.userRepository.findActiveByAuth0Subject = vi
      .fn()
      .mockResolvedValue(err({ code: 'INTERNAL_ERROR', message: 'repository unavailable' }));
    setServices({
      ...services,
      auth0JwtVerifier: vi.fn().mockResolvedValue({
        ok: true,
        identity: {
          subject: 'auth0|user-1',
          email: 'user@example.com',
          emailVerified: true,
        },
      }),
    });
    const app = await createServer(undefined, {
      serverOptions: {
        loggerInstance: logger,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: bearer('test-token'),
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Request failed' },
    });
    expectCanonicalAuthFailure(entries, {
      event: 'auth_resolver_unavailable',
      routeGroup: 'user-self',
      method: 'GET',
      statusCode: 500,
      reason: 'resolver_unavailable',
    });
  });

  it('logs canonical admin-required failures for approved non-admin callers', async () => {
    const { entries, logger } = createCaptureLogger();
    const services = routeServices();
    services.userRepository.seed(
      makeUser({
        firstName: 'Pat',
        lastName: 'User',
        mobileNumber: '+15550101000',
        status: 'approved',
        role: 'user',
        level: 4,
        approvedAt: '2026-06-17T10:00:00.000Z',
      })
    );
    setServices({
      ...services,
      auth0JwtVerifier: vi.fn().mockResolvedValue({
        ok: true,
        identity: {
          subject: 'auth0|user-1',
          email: 'user@example.com',
          emailVerified: true,
        },
      }),
    });
    const app = await createServer(undefined, {
      serverOptions: {
        loggerInstance: logger,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: bearer('test-token'),
    });

    expect(response.statusCode).toBe(403);
    expectCanonicalAuthFailure(entries, {
      event: 'auth_admin_required',
      routeGroup: 'user-admin',
      method: 'GET',
      statusCode: 403,
      reason: 'admin_role_required',
      role: 'user',
    });
  });

  it('logs canonical internal auth failures for the internal authorization route', async () => {
    const { entries, logger } = createCaptureLogger();
    setServices(routeServices());
    const app = await createServer(undefined, {
      serverOptions: {
        loggerInstance: logger,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/authorization/resolve',
      payload: {
        auth0: { subject: 'auth0|user-1', email: 'user@example.com', emailVerified: true },
      },
    });

    expect(response.statusCode).toBe(401);
    expectCanonicalAuthFailure(entries, {
      event: 'auth_internal_failed',
      routeGroup: 'user-internal',
      method: 'POST',
      statusCode: 401,
      reason: 'invalid_internal_auth',
    });
  });
});
