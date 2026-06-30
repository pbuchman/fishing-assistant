import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthorizationResolveResponse } from '@fa/http-contracts';
import { InternalClientError } from '@fa/internal-clients';

import {
  FakePricingRepository,
  FakeUsageAggregateRepository,
  FakeUsageEventRepository,
  silentLogger,
} from '../__tests__/fakes/usageRepositories.js';
import { createPricingCache } from '../domain/services/pricingCache.js';
import { createServer } from '../server.js';
import { resetServices, setServices } from '../services.js';

function expectAnyString(): unknown {
  return expect.any(String) as unknown;
}

function expectObjectContaining(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

function configureAuthEnv(): void {
  process.env['FA_AUTH0_ISSUER'] = 'https://auth.example.com/';
  process.env['FA_AUTH0_AUDIENCE'] = 'fa-api';
  process.env['FA_AUTH0_JWKS_URI'] = 'https://auth.example.com/.well-known/jwks.json';
  process.env['FA_INTERNAL_AUTH_TOKEN'] = 'internal-token';
}

function approvedResponse(role: 'admin' | 'user' = 'admin'): AuthorizationResolveResponse {
  return {
    state: 'approved',
    user: {
      id: `approved-${role}`,
      email: `${role}@example.com`,
      firstName: 'River',
      lastName: 'Angler',
      mobileNumber: '+15550101000',
      role,
      status: 'approved',
      level: 8,
      effectiveLevel: 8,
    },
    authorization: {
      userId: `approved-${role}`,
      auth0Subject: `auth0|approved-${role}`,
      email: `${role}@example.com`,
      role,
      status: 'approved',
      effectiveLevel: 8,
    },
  };
}

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

function expectCanonicalAuthFailure(
  entries: { level: 'warn' | 'info'; message: string | undefined; payload: unknown }[],
  payload: Record<string, unknown>
): void {
  expect(entries).toContainEqual(
    expect.objectContaining({
      level: 'warn',
      message: 'Auth failure',
      payload: expectObjectContaining({
        ...payload,
        requestId: expectAnyString(),
      }),
    })
  );

  const serialized = JSON.stringify(entries);
  expect(serialized).not.toContain('auth0|');
  expect(serialized).not.toContain('@example.com');
  expect(serialized).not.toContain('Bearer ');
  expect(serialized).not.toContain('internal-token');
}

function installServices(
  options: {
    authorizationResponse?: AuthorizationResolveResponse;
    jwtOk?: boolean;
    resolverError?: Error;
  } = {}
): void {
  const pricingRepository = new FakePricingRepository();
  const usageEventRepository = new FakeUsageEventRepository();
  const usageAggregateRepository = new FakeUsageAggregateRepository();

  setServices({
    serviceName: 'llm-usage-service',
    usageEventRepository,
    usageAggregateRepository,
    pricingRepository,
    pricingCache: createPricingCache(pricingRepository),
    logger: silentLogger,
    auth0JwtVerifier: vi.fn().mockResolvedValue(
      options.jwtOk === false
        ? { ok: false, error: { code: 'UNAUTHORIZED', message: 'bad token' } }
        : {
            ok: true,
            identity: {
              subject: 'auth0|admin',
              email: 'admin@example.com',
              emailVerified: true,
            },
          }
    ),
    userServiceClient: {
      resolveAuthorization:
        options.resolverError === undefined
          ? vi.fn().mockResolvedValue(options.authorizationResponse ?? approvedResponse('admin'))
          : vi.fn().mockRejectedValue(options.resolverError),
      lookupUserIdentities: vi.fn().mockResolvedValue({ users: [] }),
    },
  });
}

describe('llm-usage-service auth prehandlers', () => {
  beforeEach(() => {
    configureAuthEnv();
  });

  afterEach(() => {
    delete process.env['FA_AUTH0_ISSUER'];
    delete process.env['FA_AUTH0_AUDIENCE'];
    delete process.env['FA_AUTH0_JWKS_URI'];
    delete process.env['FA_INTERNAL_AUTH_TOKEN'];
    resetServices();
  });

  it('logs canonical safe auth failures for missing bearer tokens on admin routes', async () => {
    const { entries, logger } = createCaptureLogger();
    installServices();
    const app = await createServer(undefined, {
      serverOptions: {
        loggerInstance: logger,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/admin/aggregates/query',
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
      },
    });

    expect(response.statusCode).toBe(401);
    expectCanonicalAuthFailure(entries, {
      event: 'auth_bearer_missing',
      routeGroup: 'usage-admin',
      method: 'POST',
      statusCode: 401,
      reason: 'missing_bearer_token',
    });
  });

  it('logs canonical safe auth failures for invalid JWTs on admin routes', async () => {
    const { entries, logger } = createCaptureLogger();
    installServices({ jwtOk: false });
    const app = await createServer(undefined, {
      serverOptions: {
        loggerInstance: logger,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/admin/aggregates/query',
      headers: { authorization: 'Bearer expired-token' },
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
      },
    });

    expect(response.statusCode).toBe(401);
    expectCanonicalAuthFailure(entries, {
      event: 'auth_jwt_invalid',
      routeGroup: 'usage-admin',
      method: 'POST',
      statusCode: 401,
      reason: 'jwt_verification_failed',
    });
  });

  it('logs canonical resolver denial events for non-approved account states', async () => {
    const { entries, logger } = createCaptureLogger();
    installServices({
      authorizationResponse: {
        state: 'pending',
        user: { ...approvedResponse('user').user, status: 'pending' },
      } as AuthorizationResolveResponse,
    });
    const app = await createServer(undefined, {
      serverOptions: {
        loggerInstance: logger,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/admin/aggregates/query',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
      },
    });

    expect(response.statusCode).toBe(403);
    expectCanonicalAuthFailure(entries, {
      event: 'auth_resolver_denied',
      routeGroup: 'usage-admin',
      method: 'POST',
      statusCode: 403,
      reason: 'account_not_approved',
      accountState: 'pending',
    });
  });

  it('logs canonical resolver denial events for resolver forbidden responses', async () => {
    const { entries, logger } = createCaptureLogger();
    installServices({
      resolverError: new InternalClientError({
        code: 'FORBIDDEN',
        message: 'Forbidden',
        service: 'user-service',
        statusCode: 403,
      }),
    });
    const app = await createServer(undefined, {
      serverOptions: {
        loggerInstance: logger,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/admin/aggregates/query',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
      },
    });

    expect(response.statusCode).toBe(403);
    expectCanonicalAuthFailure(entries, {
      event: 'auth_resolver_denied',
      routeGroup: 'usage-admin',
      method: 'POST',
      statusCode: 403,
      reason: 'resolver_forbidden',
    });
  });

  it('logs canonical resolver unavailable events on admin routes', async () => {
    const { entries, logger } = createCaptureLogger();
    installServices({
      resolverError: new Error('user-service unavailable'),
    });
    const app = await createServer(undefined, {
      serverOptions: {
        loggerInstance: logger,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/admin/aggregates/query',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
      },
    });

    expect(response.statusCode).toBe(502);
    expectCanonicalAuthFailure(entries, {
      event: 'auth_resolver_unavailable',
      routeGroup: 'usage-admin',
      method: 'POST',
      statusCode: 502,
      reason: 'resolver_unavailable',
    });
  });

  it('logs canonical admin-required failures for approved non-admin callers', async () => {
    const { entries, logger } = createCaptureLogger();
    installServices({
      authorizationResponse: approvedResponse('user'),
    });
    const app = await createServer(undefined, {
      serverOptions: {
        loggerInstance: logger,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/admin/aggregates/query',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        timeRange: {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
        },
      },
    });

    expect(response.statusCode).toBe(403);
    expectCanonicalAuthFailure(entries, {
      event: 'auth_admin_required',
      routeGroup: 'usage-admin',
      method: 'POST',
      statusCode: 403,
      reason: 'admin_role_required',
      role: 'user',
    });
  });

  it('logs canonical internal auth failures for usage ingestion', async () => {
    const { entries, logger } = createCaptureLogger();
    installServices();
    const app = await createServer(undefined, {
      serverOptions: {
        loggerInstance: logger,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/usage-events',
      payload: {
        events: [],
      },
    });

    expect(response.statusCode).toBe(401);
    expectCanonicalAuthFailure(entries, {
      event: 'auth_internal_failed',
      routeGroup: 'usage-internal',
      method: 'POST',
      statusCode: 401,
      reason: 'invalid_internal_auth',
    });
  });
});
