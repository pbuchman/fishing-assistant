import swagger from '@fastify/swagger';
import fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { registerEnvelopePlugin } from '@fa/common-http';

import { registerSystemRoutes, type ServiceIdentity } from './systemRoutes.js';

const identity: ServiceIdentity = {
  serviceName: 'chat-service',
  serviceVersion: '0.1.0',
  environment: 'test',
};

interface SystemResponse {
  ok: true;
  data: {
    checks?: {
      name: string;
      status: string;
      latencyMs: number;
    }[];
    service: string;
    environment: string;
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

describe('system routes', () => {
  async function createSystemApp() {
    const app = fastify({ logger: false });
    registerEnvelopePlugin(app);
    await app.register(swagger, {
      openapi: {
        info: { title: 'chat-service API', version: '0.1.0' },
      },
    });
    registerSystemRoutes(app, identity);
    return await Promise.resolve(app);
  }

  it('returns Phase 1-compatible health metadata', async () => {
    const app = await createSystemApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json<SystemResponse>();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        service: 'chat-service',
        environment: 'test',
      },
    });
    expect(body.data.uptime).toEqual(expect.any(Number));
    expect(body.data).not.toHaveProperty('version');
  });

  it('returns status metadata with version', async () => {
    const app = await createSystemApp();
    const response = await app.inject({ method: 'GET', url: '/status' });
    const body = response.json<SystemResponse>();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        service: 'chat-service',
        environment: 'test',
        version: '0.1.0',
      },
    });
  });

  it('keeps /status coarse and filters sensitive metadata', async () => {
    const app = fastify({ logger: false });
    registerEnvelopePlugin(app);
    await app.register(swagger, {
      openapi: {
        info: { title: 'chat-service API', version: '0.1.0' },
      },
    });
    registerSystemRoutes(app, identity, {
      statusMetadata: () => ({
        phase: 'foundation',
        knowledgeAccess: 'degraded',
        auth0Health: 'healthy',
        auth0Issuer: 'https://tenant.example.auth0.com/',
        jwksUri: 'https://tenant.example.auth0.com/.well-known/jwks.json',
        pendingUserCount: 3,
        usageBacklog: 7,
        sourceUrl: 'https://example.com/restricted-source',
        serviceAccountKey: '/etc/fa/keys/runtime-sa-key.json',
        audit: { failures: 2 },
        token: 'secret-token',
      }),
    });

    const response = await app.inject({ method: 'GET', url: '/status' });
    const body = response.json<SystemResponse>();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        service: 'chat-service',
        environment: 'test',
        version: '0.1.0',
        phase: 'foundation',
        knowledgeAccess: 'degraded',
      },
    });
    expect(body.data).not.toHaveProperty('auth0Health');
    expect(body.data).not.toHaveProperty('auth0Issuer');
    expect(body.data).not.toHaveProperty('jwksUri');
    expect(body.data).not.toHaveProperty('pendingUserCount');
    expect(body.data).not.toHaveProperty('usageBacklog');
    expect(body.data).not.toHaveProperty('sourceUrl');
    expect(body.data).not.toHaveProperty('serviceAccountKey');
    expect(body.data).not.toHaveProperty('audit');
    expect(body.data).not.toHaveProperty('token');
  });

  it('returns OpenAPI JSON', async () => {
    const app = await createSystemApp();
    const response = await app.inject({ method: 'GET', url: '/openapi.json' });
    const body = response.json<OpenApiResponse>();

    expect(response.statusCode).toBe(200);
    expect(typeof body.openapi).toBe('string');
    expect(body.info).toEqual({
      title: 'chat-service API',
      version: '0.1.0',
    });
  });

  it('runs registered health checks and reports down checks with status 503', async () => {
    const app = fastify({ logger: false });
    registerEnvelopePlugin(app);
    await app.register(swagger, {
      openapi: {
        info: { title: 'chat-service API', version: '0.1.0' },
      },
    });
    registerSystemRoutes(app, identity, {
      healthChecks: [
        {
          name: 'secrets',
          check: () => Promise.resolve({ ok: false, detail: 'missing: FA_INTERNAL_AUTH_TOKEN' }),
        },
      ],
    });

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json<SystemResponse>();

    expect(response.statusCode).toBe(503);
    expect(body.data).toMatchObject({
      service: 'chat-service',
      environment: 'test',
      status: 'down',
      checks: [
        {
          name: 'secrets',
          status: 'down',
        },
      ],
    });
    expect(body.data.uptime).toEqual(expect.any(Number));
    expect(body.data.checks?.[0]?.latencyMs).toEqual(expect.any(Number));
    expect(JSON.stringify(body)).not.toContain('FA_INTERNAL_AUTH_TOKEN');
    expect(body.data.checks?.[0]).not.toHaveProperty('details');
  });

  it('does not leak thrown health-check errors in the public health payload', async () => {
    const app = fastify({ logger: false });
    registerEnvelopePlugin(app);
    await app.register(swagger, {
      openapi: {
        info: { title: 'chat-service API', version: '0.1.0' },
      },
    });
    registerSystemRoutes(app, identity, {
      healthChecks: [
        {
          name: 'jwks',
          check: () => {
            throw new Error(
              'jwks fetch failed for https://tenant.example.auth0.com/.well-known/jwks.json'
            );
          },
        },
      ],
    });

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json<SystemResponse>();

    expect(response.statusCode).toBe(503);
    expect(body.data.checks).toEqual([
      expect.objectContaining({
        name: 'jwks',
        status: 'down',
      }),
    ]);
    expect(body.data.checks?.[0]?.latencyMs).toEqual(expect.any(Number));
    expect(JSON.stringify(body)).not.toContain('auth0');
    expect(JSON.stringify(body)).not.toContain('https://');
    expect(JSON.stringify(body)).not.toContain('.well-known');
    expect(body.data.checks?.[0]).not.toHaveProperty('details');
  });
});
