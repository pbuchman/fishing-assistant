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

describe('llm-usage-service system routes', () => {
  it('returns health metadata', async () => {
    const app = await createServer();

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json<SystemResponse>();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        service: 'llm-usage-service',
        environment: 'test',
      },
    });
    expect(body.data.uptime).toEqual(expect.any(Number));
  });

  it('returns status metadata with version', async () => {
    const app = await createServer();

    const response = await app.inject({ method: 'GET', url: '/status' });
    const body = response.json<SystemResponse>();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        service: 'llm-usage-service',
        environment: 'test',
        version: '0.1.0',
      },
    });
    expect(body.data.uptime).toEqual(expect.any(Number));
  });

  it('registers OpenAPI and docs routes', async () => {
    const app = await createServer();

    const openApiResponse = await app.inject({ method: 'GET', url: '/openapi.json' });
    const docsResponse = await app.inject({ method: 'GET', url: '/docs' });
    const openApiBody = openApiResponse.json<OpenApiResponse>();

    expect(openApiResponse.statusCode).toBe(200);
    expect(typeof openApiBody.openapi).toBe('string');
    expect(openApiBody.info).toEqual({
      title: 'llm-usage-service API',
      version: '0.1.0',
    });
    expect(docsResponse.statusCode).toBeGreaterThanOrEqual(200);
    expect(docsResponse.statusCode).toBeLessThan(400);
  });

  it('returns service metadata from the root route', async () => {
    const app = await createServer();

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      data: {
        service: 'llm-usage-service',
        phase: 'usage',
      },
    });
  });

  it('forwards registered health checks to the shared system route', async () => {
    const app = await createServer(undefined, {
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
    expect(body.data.status).toBe('down');
    expect(body.data.checks).toEqual([
      expect.objectContaining({
        name: 'secrets',
        status: 'down',
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain('FA_INTERNAL_AUTH_TOKEN');
    expect(body.data.checks?.[0]).not.toHaveProperty('details');
  });
});
