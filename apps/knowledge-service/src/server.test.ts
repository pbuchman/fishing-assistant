import { afterEach, describe, expect, it, vi } from 'vitest';

import { createServer } from './server.js';
import { resetServices, setServices } from './services.js';
import { KnowledgeAccessRefreshExecutor } from './domain/usecases/accessRefresh.js';
import {
  MemoryKnowledgeAccessRefreshRepository,
  MemoryKnowledgePageChunkRepository,
  MemoryKnowledgePageRepository,
} from './infra/memory/memoryKnowledgeRepositories.js';

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

describe('knowledge-service system routes', () => {
  afterEach(() => {
    resetServices();
  });

  it('returns health metadata', async () => {
    const app = await createServer();

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json<SystemResponse>();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        service: 'knowledge-service',
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
        service: 'knowledge-service',
        environment: 'test',
        version: '0.1.0',
        knowledgeAccess: 'healthy',
      },
    });
    expect(body.data.uptime).toEqual(expect.any(Number));
    expect(JSON.stringify(body)).not.toContain('job-');
    expect(JSON.stringify(body)).not.toContain('chunk-');
    expect(JSON.stringify(body)).not.toContain('pendingJobs');
  });

  it('registers OpenAPI and docs routes', async () => {
    const app = await createServer();

    const openApiResponse = await app.inject({ method: 'GET', url: '/openapi.json' });
    const docsResponse = await app.inject({ method: 'GET', url: '/docs' });
    const openApiBody = openApiResponse.json<OpenApiResponse>();

    expect(openApiResponse.statusCode).toBe(200);
    expect(typeof openApiBody.openapi).toBe('string');
    expect(openApiBody.info).toEqual({
      title: 'knowledge-service API',
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
        service: 'knowledge-service',
        phase: 'knowledge',
      },
    });
  });

  it('starts and stops background executors with server lifecycle', async () => {
    const accessRefreshExecutor = {
      start: vi.fn(),
      stop: vi.fn(),
    };
    setServices({ accessRefreshExecutor });
    const app = await createServer();

    await app.ready();
    await app.close();

    expect(accessRefreshExecutor.start).toHaveBeenCalledTimes(1);
    expect(accessRefreshExecutor.stop).toHaveBeenCalledTimes(1);
  });

  it('clears the real access-refresh executor interval when the server closes', async () => {
    vi.useFakeTimers();
    try {
      const accessRefreshRepository = new MemoryKnowledgeAccessRefreshRepository();
      const pageRepository = new MemoryKnowledgePageRepository();
      const pageChunkRepository = new MemoryKnowledgePageChunkRepository();
      const claimSpy = vi.spyOn(accessRefreshRepository, 'claimDueJobs');
      const executor = new KnowledgeAccessRefreshExecutor({
        accessRefreshRepository,
        pageRepository,
        pageChunkRepository,
        clock: { now: () => new Date('2026-06-17T12:00:00.000Z') },
        leaseOwnerId: 'lifecycle-worker',
        intervalMs: 1_000,
      });
      setServices({
        accessRefreshRepository,
        pageRepository,
        pageChunkRepository,
        accessRefreshExecutor: executor,
      });
      const app = await createServer();

      await app.ready();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(claimSpy).toHaveBeenCalledTimes(1);

      await app.close();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(claimSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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
