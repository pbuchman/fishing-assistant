import { describe, expect, it } from 'vitest';

import type { KnowledgeAccessRefreshJob } from '../../domain/models/knowledge.js';
import { MemoryKnowledgeAccessRefreshRepository } from './memoryAccessRefreshRepository.js';

function job(overrides: Partial<KnowledgeAccessRefreshJob> = {}): KnowledgeAccessRefreshJob {
  return {
    id: 'job-1',
    status: 'pending',
    kind: 'category_access_changed',
    target: { categoryId: 'category-1', pageId: null },
    requestedAccessRevision: 'category-rev-2',
    actorAdminUserId: 'admin-user-1',
    priority: 0,
    attempts: 0,
    maxAttempts: 6,
    nextRunAt: '2026-06-17T12:00:00.000Z',
    leaseOwnerId: null,
    leaseExpiresAt: null,
    processedPageCount: 0,
    processedChunkCount: 0,
    lastError: null,
    createdAt: '2026-06-17T12:00:00.000Z',
    updatedAt: '2026-06-17T12:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

describe('memory knowledge access-refresh repository', () => {
  it('claims due pending, retryable failed, and expired running jobs with leases in schedule order', async () => {
    const repo = new MemoryKnowledgeAccessRefreshRepository();
    await repo.enqueueJob(job({ id: 'pending-low', nextRunAt: '2026-06-17T12:00:00.000Z' }));
    await repo.enqueueJob(
      job({ id: 'pending-high', priority: 10, nextRunAt: '2026-06-17T12:00:00.000Z' })
    );
    await repo.enqueueJob(
      job({
        id: 'failed-retryable',
        status: 'failed',
        attempts: 2,
        nextRunAt: '2026-06-17T11:59:00.000Z',
        finishedAt: '2026-06-17T11:58:00.000Z',
      })
    );
    await repo.enqueueJob(
      job({
        id: 'running-expired',
        status: 'running',
        leaseOwnerId: 'old-worker',
        leaseExpiresAt: '2026-06-17T11:59:59.000Z',
      })
    );
    await repo.enqueueJob(job({ id: 'running-active', status: 'running' }));
    await repo.enqueueJob(job({ id: 'succeeded', status: 'succeeded' }));

    const claimed = await repo.claimDueJobs({
      now: '2026-06-17T12:00:00.000Z',
      leaseOwnerId: 'worker-1',
      leaseDurationMs: 120_000,
      limit: 10,
    });

    expect(claimed).toMatchObject({
      ok: true,
      value: [
        { id: 'failed-retryable' },
        { id: 'pending-high' },
        { id: 'pending-low' },
        { id: 'running-expired' },
      ],
    });
    for (const id of ['failed-retryable', 'pending-high', 'pending-low', 'running-expired']) {
      await expect(repo.getJobById(id)).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'running',
          leaseOwnerId: 'worker-1',
          leaseExpiresAt: '2026-06-17T12:02:00.000Z',
        },
      });
    }
  });

  it('does not let a second worker claim or finish another worker lease', async () => {
    const repo = new MemoryKnowledgeAccessRefreshRepository();
    await repo.enqueueJob(job({ id: 'claim-once' }));
    await repo.enqueueJob(job({ id: 'stolen-after-expiry' }));

    await expect(
      repo.claimDueJobs({
        now: '2026-06-17T12:00:00.000Z',
        leaseOwnerId: 'worker-1',
        leaseDurationMs: 120_000,
        limit: 1,
      })
    ).resolves.toMatchObject({ ok: true, value: [{ id: 'claim-once' }] });
    await expect(
      repo.claimDueJobs({
        now: '2026-06-17T12:00:00.000Z',
        leaseOwnerId: 'worker-2',
        leaseDurationMs: 120_000,
        limit: 1,
      })
    ).resolves.toMatchObject({ ok: true, value: [{ id: 'stolen-after-expiry' }] });
    await expect(
      repo.claimDueJobs({
        now: '2026-06-17T12:00:00.000Z',
        leaseOwnerId: 'worker-3',
        leaseDurationMs: 120_000,
        limit: 1,
      })
    ).resolves.toMatchObject({ ok: true, value: [] });

    await expect(
      repo.claimDueJobs({
        now: '2026-06-17T12:03:00.000Z',
        leaseOwnerId: 'worker-4',
        leaseDurationMs: 120_000,
        limit: 1,
      })
    ).resolves.toMatchObject({ ok: true, value: [{ id: 'claim-once' }] });
    await expect(
      repo.completeJob({
        jobId: 'claim-once',
        leaseOwnerId: 'worker-1',
        now: '2026-06-17T12:03:05.000Z',
        processedPageCount: 1,
        processedChunkCount: 1,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repo.failJob({
        jobId: 'claim-once',
        leaseOwnerId: 'worker-1',
        now: '2026-06-17T12:03:05.000Z',
        error: { code: 'INTERNAL_ERROR', message: 'stale worker' },
        nextRunAt: '2026-06-17T12:04:00.000Z',
        exhausted: false,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repo.completeJob({
        jobId: 'claim-once',
        leaseOwnerId: 'worker-4',
        now: '2026-06-17T12:03:10.000Z',
        processedPageCount: 1,
        processedChunkCount: 1,
      })
    ).resolves.toMatchObject({ ok: true, value: { status: 'succeeded' } });
    await expect(
      repo.failJob({
        jobId: 'claim-once',
        leaseOwnerId: 'worker-4',
        now: '2026-06-17T12:03:15.000Z',
        error: { code: 'INTERNAL_ERROR', message: 'late failure' },
        nextRunAt: '2026-06-17T12:04:00.000Z',
        exhausted: false,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('retries only failed or expired running jobs and reports sanitized bounded status', async () => {
    const repo = new MemoryKnowledgeAccessRefreshRepository();
    await repo.enqueueJob(
      job({
        id: 'failed',
        status: 'failed',
        attempts: 6,
        lastError: {
          code: 'INTERNAL_ERROR',
          message: 'stack with token secret',
          occurredAt: '2026-06-17T11:59:00.000Z',
        },
      })
    );
    await repo.enqueueJob(
      job({
        id: 'expired',
        status: 'running',
        leaseOwnerId: 'worker-1',
        leaseExpiresAt: '2026-06-17T11:59:00.000Z',
      })
    );
    await repo.enqueueJob(
      job({
        id: 'active',
        status: 'running',
        leaseOwnerId: 'worker-1',
        leaseExpiresAt: '2026-06-17T12:05:00.000Z',
      })
    );
    await repo.enqueueJob(job({ id: 'succeeded', status: 'succeeded' }));
    await repo.enqueueJob(job({ id: 'pending-due', status: 'pending', attempts: 3 }));
    await repo.enqueueJob(
      job({
        id: 'pending-backoff',
        status: 'pending',
        attempts: 4,
        nextRunAt: '2026-06-17T12:30:00.000Z',
      })
    );
    await repo.enqueueJob(job({ id: 'corrupted', status: 'unknown' as never, attempts: 5 }));

    await expect(
      repo.retryJob({ jobId: 'failed', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: true, value: { status: 'pending', attempts: 0 } });
    await expect(
      repo.retryJob({ jobId: 'expired', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: true, value: { status: 'pending', attempts: 0 } });
    await expect(
      repo.retryJob({ jobId: 'active', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repo.retryJob({ jobId: 'succeeded', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repo.retryJob({ jobId: 'pending-due', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repo.retryJob({ jobId: 'pending-backoff', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repo.retryJob({ jobId: 'corrupted', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repo.retryJob({ jobId: 'missing', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    await expect(repo.getJobById('pending-due')).resolves.toMatchObject({
      ok: true,
      value: { attempts: 3 },
    });
    await expect(repo.getJobById('pending-backoff')).resolves.toMatchObject({
      ok: true,
      value: { attempts: 4 },
    });

    await repo.enqueueJob(
      job({
        id: 'failing',
        status: 'running',
        leaseOwnerId: 'worker-1',
        leaseExpiresAt: '2026-06-17T12:05:00.000Z',
      })
    );
    await repo.failJob({
      jobId: 'failing',
      leaseOwnerId: 'worker-1',
      now: '2026-06-17T12:01:00.000Z',
      error: { code: 'DOWNSTREAM_ERROR', message: 'bearer token leaked\n    at stack' },
      nextRunAt: '2026-06-17T12:02:00.000Z',
      exhausted: true,
    });
    const status = await repo.getAdminStatus({
      now: '2026-06-17T12:01:00.000Z',
      recentFailuresLimit: 20,
    });

    expect(status).toMatchObject({
      ok: true,
      value: {
        jobs: { failed: 1 },
        recentFailures: [{ jobId: 'failing', lastErrorCode: 'DOWNSTREAM_ERROR' }],
      },
    });
    expect(JSON.stringify(status)).not.toContain('bearer token leaked');
    expect(JSON.stringify(status)).not.toContain('stack');
  });
});
