import { describe, expect, it } from 'vitest';

import { createServer } from './server.js';

interface SystemResponse {
  ok: true;
  data: {
    checks?: {
      name: string;
      status: string;
      latencyMs: number;
    }[];
    environment: string;
    service: string;
    status?: string;
    uptime: number;
    version?: string;
  };
}

interface OpenApiResponse {
  openapi: string;
  info: {
    title: string;
    version: string;
  };
}

const forbiddenSystemDetails = [
  'https://auth.example.com/',
  'https://auth.example.com/.well-known/jwks.json',
  'auth.example.com',
  'auth0-client-id',
  'admin@example.com',
  'pendingCount',
  'pendingUsers',
  'userId',
  'email',
  'mobileNumber',
  'phoneNumber',
  'FA_INTERNAL_AUTH_TOKEN',
  'FA_INTERNAL_AUTH_TOKEN_PREVIOUS',
  'current-internal-token',
  'previous-internal-token',
  'tokenRotation',
];

function expectNoSensitiveSystemDetails(payload: unknown): void {
  const serialized = JSON.stringify(payload);

  for (const forbidden of forbiddenSystemDetails) {
    expect(serialized).not.toContain(forbidden);
  }
}

describe('user-service system routes', () => {
  it('returns coarse service metadata from the root route', async () => {
    const app = await createServer();

    const response = await app.inject({ method: 'GET', url: '/' });
    const body = response.json<{ ok: true; data: { service: string; phase: string } }>();

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        service: 'user-service',
        phase: 'user-service',
      },
    });
    expectNoSensitiveSystemDetails(body);
  });

  it('returns health metadata through the shared system route', async () => {
    const app = await createServer(undefined, {
      healthChecks: [
        {
          name: 'secrets',
          check: () => Promise.resolve({ ok: true }),
        },
      ],
    });

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json<SystemResponse>();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        service: 'user-service',
        environment: 'test',
        status: 'ok',
      },
    });
    expect(body.data.uptime).toEqual(expect.any(Number));
    expect(body.data.checks).toEqual([
      expect.objectContaining({
        name: 'secrets',
        status: 'ok',
      }),
    ]);
    expectNoSensitiveSystemDetails(body);
    expect(body.data.checks?.[0]).not.toHaveProperty('details');
  });

  it('returns status metadata with version through the shared system route', async () => {
    const app = await createServer();

    const response = await app.inject({ method: 'GET', url: '/status' });
    const body = response.json<SystemResponse>();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        service: 'user-service',
        environment: 'test',
        version: '0.1.0',
      },
    });
    expect(body.data.uptime).toEqual(expect.any(Number));
    expectNoSensitiveSystemDetails(body);
  });

  it('registers OpenAPI and docs routes through the shared system route setup', async () => {
    const app = await createServer();

    const openApiResponse = await app.inject({ method: 'GET', url: '/openapi.json' });
    const docsResponse = await app.inject({ method: 'GET', url: '/docs' });
    const openApiBody = openApiResponse.json<OpenApiResponse>();

    expect(openApiResponse.statusCode).toBe(200);
    expect(typeof openApiBody.openapi).toBe('string');
    expect(openApiBody.info).toEqual({
      title: 'user-service API',
      version: '0.1.0',
    });
    expect(docsResponse.statusCode).toBeGreaterThanOrEqual(200);
    expect(docsResponse.statusCode).toBeLessThan(400);
  });

  it('keeps system routes unauthenticated while domain routes require route auth', async () => {
    const app = await createServer();

    const healthResponse = await app.inject({ method: 'GET', url: '/health' });
    const statusResponse = await app.inject({ method: 'GET', url: '/status' });
    const openApiResponse = await app.inject({ method: 'GET', url: '/openapi.json' });
    const docsResponse = await app.inject({ method: 'GET', url: '/docs' });
    const meResponse = await app.inject({ method: 'GET', url: '/me' });
    const internalResponse = await app.inject({
      method: 'POST',
      url: '/internal/authorization/resolve',
      payload: { auth0: { subject: 'auth0|user-1' } },
    });

    expect(healthResponse.statusCode).toBe(200);
    expect(statusResponse.statusCode).toBe(200);
    expect(openApiResponse.statusCode).toBe(200);
    expect(docsResponse.statusCode).toBeGreaterThanOrEqual(200);
    expect(docsResponse.statusCode).toBeLessThan(400);
    expect(meResponse.statusCode).toBe(401);
    expect(internalResponse.statusCode).toBe(401);
  });
});
