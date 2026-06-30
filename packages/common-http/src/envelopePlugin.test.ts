import fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { registerEnvelopePlugin } from './envelopePlugin.js';

describe('envelope plugin', () => {
  it('adds reply.ok for success envelopes', async () => {
    const app = fastify({ logger: false });
    registerEnvelopePlugin(app);
    app.get('/ok', (_request, reply) => reply.ok({ id: 'catch-1' }));

    const response = await app.inject({ method: 'GET', url: '/ok' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      data: { id: 'catch-1' },
    });
  });

  it('allows reply.ok to override the status code', async () => {
    const app = fastify({ logger: false });
    registerEnvelopePlugin(app);
    app.post('/created', (_request, reply) => reply.ok({ created: true }, 201));

    const response = await app.inject({ method: 'POST', url: '/created' });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      ok: true,
      data: { created: true },
    });
  });

  it('adds reply.fail for error envelopes and code status mapping', async () => {
    const app = fastify({ logger: false });
    registerEnvelopePlugin(app);
    app.get('/fail', (_request, reply) =>
      reply.fail('UNPROCESSABLE_ENTITY', 'bad request', { field: 'species' })
    );

    const response = await app.inject({ method: 'GET', url: '/fail' });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      ok: false,
      error: {
        code: 'UNPROCESSABLE_ENTITY',
        message: 'bad request',
        details: { field: 'species' },
      },
    });
  });

  it('omits error details when they are not provided', async () => {
    const app = fastify({ logger: false });
    registerEnvelopePlugin(app);
    app.get('/fail', (_request, reply) => reply.fail('NOT_FOUND', 'not found'));

    const response = await app.inject({ method: 'GET', url: '/fail' });

    expect(response.json()).toEqual({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'not found',
      },
    });
  });

  it('can be registered more than once without duplicate decoration errors', () => {
    const app = fastify({ logger: false });

    expect(() => {
      registerEnvelopePlugin(app);
      registerEnvelopePlugin(app);
    }).not.toThrow();
  });
});
