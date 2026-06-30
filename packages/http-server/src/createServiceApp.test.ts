import { describe, expect, it } from 'vitest';

import { FaError } from '@fa/common-core';

import { createServiceApp } from './createServiceApp.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

describe('createServiceApp', () => {
  function createCaptureLogger() {
    const entries: { message: string | undefined }[] = [];
    const logger = {
      level: 'info',
      child: () => logger,
      info: (_payload: unknown, message?: string) => {
        entries.push({ message });
      },
      error: () => undefined,
      warn: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
      fatal: () => undefined,
      silent: () => undefined,
    };

    return { entries, logger };
  }

  it('registers the standard plugin stack and custom routes', async () => {
    const app = await createServiceApp({
      identity: {
        serviceName: 'knowledge-service',
        serviceVersion: '0.1.0',
        environment: 'test',
      },
      corsAllowedOrigins: ['https://dev.fishing-assistant.online'],
      registerRoutes: (serviceApp) => {
        serviceApp.get('/', (_request, reply) =>
          reply.ok({ service: 'knowledge-service', phase: 'foundation' })
        );
      },
    });

    const rootResponse = await app.inject({ method: 'GET', url: '/' });
    const docsResponse = await app.inject({ method: 'GET', url: '/docs' });
    const optionsResponse = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: { origin: 'https://dev.fishing-assistant.online' },
    });

    expect(rootResponse.json()).toEqual({
      ok: true,
      data: {
        service: 'knowledge-service',
        phase: 'foundation',
      },
    });
    expect(docsResponse.statusCode).toBeGreaterThanOrEqual(200);
    expect(docsResponse.statusCode).toBeLessThan(400);
    expect(optionsResponse.headers['access-control-allow-origin']).toBe(
      'https://dev.fishing-assistant.online'
    );
  });

  it('allows configured CORS origins without reflecting arbitrary origins', async () => {
    const app = await createServiceApp({
      identity: {
        serviceName: 'chat-service',
        serviceVersion: '0.1.0',
        environment: 'test',
      },
      corsAllowedOrigins: ['https://dev.fishing-assistant.online'],
    });

    const allowedResponse = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://dev.fishing-assistant.online',
        'access-control-request-method': 'GET',
      },
    });
    const disallowedResponse = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://attacker.example',
        'access-control-request-method': 'GET',
      },
    });

    expect(allowedResponse.statusCode).not.toBe(500);
    expect(allowedResponse.headers['access-control-allow-origin']).toBe(
      'https://dev.fishing-assistant.online'
    );
    expect(disallowedResponse.statusCode).not.toBe(500);
    expect(disallowedResponse.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('keeps requests without Origin usable for service and health calls', async () => {
    const app = await createServiceApp({
      identity: {
        serviceName: 'knowledge-service',
        serviceVersion: '0.1.0',
        environment: 'test',
      },
      corsAllowedOrigins: ['https://dev.fishing-assistant.online'],
    });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('uses caller-provided Fastify logging for quiet request logging', async () => {
    const { entries, logger } = createCaptureLogger();
    const app = await createServiceApp({
      identity: {
        serviceName: 'chat-service',
        serviceVersion: '0.1.0',
        environment: 'test',
      },
      serverOptions: {
        loggerInstance: logger,
      },
    });

    await app.inject({ method: 'GET', url: '/status' });
    await app.inject({ method: 'GET', url: '/health' });

    expect(entries.some((entry) => entry.message === 'incoming request')).toBe(true);
    expect(entries.some((entry) => entry.message === 'request completed')).toBe(true);
    expect(entries.filter((entry) => entry.message === 'incoming request')).toHaveLength(1);
  });

  it('maps thrown FaError instances to error envelopes', async () => {
    const app = await createServiceApp({
      identity: {
        serviceName: 'llm-usage-service',
        serviceVersion: '0.1.0',
        environment: 'test',
      },
      registerRoutes: (serviceApp) => {
        serviceApp.get('/boom', () => {
          throw new FaError('DOWNSTREAM_ERROR', 'Firestore failed', { collection: 'usage' });
        });
      },
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      ok: false,
      error: {
        code: 'DOWNSTREAM_ERROR',
        message: 'Firestore failed',
        details: { collection: 'usage' },
      },
    });
  });

  it('maps unknown thrown errors to internal error envelopes', async () => {
    const app = await createServiceApp({
      identity: {
        serviceName: 'llm-usage-service',
        serviceVersion: '0.1.0',
        environment: 'test',
      },
      registerRoutes: (serviceApp) => {
        serviceApp.get('/unknown', () => {
          throw new Error('raw failure');
        });
      },
    });

    const response = await app.inject({ method: 'GET', url: '/unknown' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  it('maps Fastify schema validation failures to invalid request envelopes', async () => {
    let handlerBody: unknown;
    const app = await createServiceApp({
      identity: {
        serviceName: 'chat-service',
        serviceVersion: '0.1.0',
        environment: 'test',
      },
      registerRoutes: (serviceApp) => {
        serviceApp.post(
          '/validated',
          {
            schema: {
              body: {
                type: 'object',
                additionalProperties: false,
                required: ['message'],
                properties: {
                  message: { type: 'string', minLength: 1 },
                },
              },
            },
          },
          (request, reply) => {
            handlerBody = request.body;
            return reply.ok({ accepted: true });
          }
        );
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/validated',
      headers: { 'content-type': 'application/json' },
      payload: { message: 42 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(handlerBody).toBeUndefined();

    const extraPropertyResponse = await app.inject({
      method: 'POST',
      url: '/validated',
      headers: { 'content-type': 'application/json' },
      payload: { message: 'hello', unexpected: true },
    });

    expect(extraPropertyResponse.statusCode).toBe(400);
    expect(extraPropertyResponse.json()).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(handlerBody).toBeUndefined();
  });

  it('merges caller AJV customOptions while forcing strict route inputs', async () => {
    let handlerBody: unknown;
    const app = await createServiceApp({
      identity: {
        serviceName: 'chat-service',
        serviceVersion: '0.1.0',
        environment: 'test',
      },
      serverOptions: {
        ajv: {
          customOptions: {
            allErrors: true,
            coerceTypes: true,
            removeAdditional: 'all',
            useDefaults: true,
          },
        },
      },
      registerRoutes: (serviceApp) => {
        serviceApp.post(
          '/custom-ajv',
          {
            schema: {
              body: {
                type: 'object',
                additionalProperties: false,
                required: ['count'],
                properties: {
                  count: { type: 'integer' },
                  label: { type: 'string', default: 'kept-default' },
                },
              },
            },
          },
          (request, reply) => {
            handlerBody = request.body;
            return reply.ok({ body: request.body });
          }
        );
      },
    });

    const invalidResponse = await app.inject({
      method: 'POST',
      url: '/custom-ajv',
      headers: { 'content-type': 'application/json' },
      payload: { count: '3', extra: true },
    });

    expect(invalidResponse.statusCode).toBe(400);
    const invalidBody = invalidResponse.json<unknown>();
    expect(invalidBody).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
      },
    });
    const validation =
      isRecord(invalidBody) &&
      isRecord(invalidBody['error']) &&
      isRecord(invalidBody['error']['details'])
        ? invalidBody['error']['details']['validation']
        : undefined;
    expect(Array.isArray(validation)).toBe(true);
    const validationKeywords = Array.isArray(validation)
      ? validation.flatMap((entry) =>
          isRecord(entry) && typeof entry['keyword'] === 'string' ? [entry['keyword']] : []
        )
      : [];
    expect(validationKeywords).toEqual(expect.arrayContaining(['additionalProperties', 'type']));
    expect(handlerBody).toBeUndefined();

    const validResponse = await app.inject({
      method: 'POST',
      url: '/custom-ajv',
      headers: { 'content-type': 'application/json' },
      payload: { count: 3 },
    });

    expect(validResponse.statusCode).toBe(200);
    expect(validResponse.json()).toEqual({
      ok: true,
      data: { body: { count: 3, label: 'kept-default' } },
    });
  });
});
