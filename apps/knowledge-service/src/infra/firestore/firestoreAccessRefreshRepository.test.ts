import { describe, expect, it } from 'vitest';

import type { KnowledgeAccessRefreshJob } from '../../domain/models/knowledge.js';
import { FirestoreKnowledgeAccessRefreshRepository } from './firestoreAccessRefreshRepository.js';
import { timestampFromIso } from './firestoreMapping.js';

class FakeDocumentSnapshot {
  constructor(
    readonly id: string,
    private readonly value: Record<string, unknown> | undefined
  ) {}

  get exists(): boolean {
    return this.value !== undefined;
  }

  data(): Record<string, unknown> | undefined {
    return this.value;
  }
}

class FakeDocumentRef {
  constructor(
    private readonly collection: FakeCollectionRef,
    readonly id: string
  ) {}

  create(value: Record<string, unknown>): Promise<void> {
    if (this.collection.docs.has(this.id)) {
      const error = new Error('already exists') as Error & { code: number };
      error.code = 6;
      return Promise.reject(error);
    }
    this.collection.docs.set(this.id, value);
    return Promise.resolve();
  }

  set(value: Record<string, unknown>): Promise<void> {
    this.collection.docs.set(this.id, value);
    return Promise.resolve();
  }

  update(value: Record<string, unknown>): Promise<void> {
    this.collection.docs.set(this.id, {
      ...(this.collection.docs.get(this.id) ?? {}),
      ...value,
    });
    return Promise.resolve();
  }

  get(): Promise<FakeDocumentSnapshot> {
    return Promise.resolve(new FakeDocumentSnapshot(this.id, this.collection.docs.get(this.id)));
  }
}

class FakeCollectionRef {
  readonly docs = new Map<string, Record<string, unknown>>();
  readonly selectedFieldSets: string[][] = [];

  doc(id: string): FakeDocumentRef {
    return new FakeDocumentRef(this, id);
  }

  select(...fields: string[]): this {
    this.selectedFieldSets.push(fields);
    return this;
  }

  get(): Promise<{ docs: FakeDocumentSnapshot[] }> {
    return Promise.resolve({
      docs: [...this.docs.entries()].map(([id, value]) => new FakeDocumentSnapshot(id, value)),
    });
  }
}

class FakeBatch {
  readonly operations: (() => Promise<void>)[] = [];

  update(documentRef: FakeDocumentRef, value: Record<string, unknown>): void {
    this.operations.push(() => documentRef.update(value));
  }

  async commit(): Promise<void> {
    for (const operation of this.operations) {
      await operation();
    }
  }
}

class FakeTransaction {
  get(documentRef: FakeDocumentRef): Promise<FakeDocumentSnapshot> {
    return documentRef.get();
  }

  set(documentRef: FakeDocumentRef, value: Record<string, unknown>): void {
    void documentRef.set(value);
  }

  update(documentRef: FakeDocumentRef, value: Record<string, unknown>): void {
    void documentRef.update(value);
  }
}

class FakeFirestore {
  readonly collections = new Map<string, FakeCollectionRef>();
  readonly batches: FakeBatch[] = [];

  collection(name: string): FakeCollectionRef {
    const existing = this.collections.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const created = new FakeCollectionRef();
    this.collections.set(name, created);
    return created;
  }

  batch(): FakeBatch {
    const batch = new FakeBatch();
    this.batches.push(batch);
    return batch;
  }

  runTransaction<T>(updateFunction: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
    return updateFunction(new FakeTransaction());
  }
}

class RetryRaceFirestore extends FakeFirestore {
  override runTransaction<T>(updateFunction: (transaction: FakeTransaction) => Promise<T>) {
    const jobs = this.collection('fa_knowledge_access_refresh_jobs').docs;
    const existing = jobs.get('retry-race');
    if (existing?.['status'] === 'failed') {
      jobs.set('retry-race', {
        ...existing,
        status: 'running',
        leaseOwnerId: 'worker-race',
        leaseExpiresAt: timestampFromIso('2026-06-17T12:05:00.000Z'),
        updatedAt: timestampFromIso('2026-06-17T12:00:00.500Z'),
      });
    }
    return super.runTransaction(updateFunction);
  }
}

class LeakyFirestore {
  collection(): never {
    throw new Error(
      'Firestore exploded for auth0|user-123 +1 555 010 800 FA_INTERNAL_AUTH_TOKEN=secret\n    at firestore.ts:10:2'
    );
  }
}

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

describe('firestore knowledge access-refresh repository', () => {
  it('persists jobs and claims due jobs with batched lease updates', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreKnowledgeAccessRefreshRepository(db as never);
    await expect(repo.enqueueJob(job({ id: 'job-1' }))).resolves.toMatchObject({
      ok: true,
      value: { id: 'job-1' },
    });
    await expect(repo.enqueueJob(job({ id: 'job-2', priority: 10 }))).resolves.toMatchObject({
      ok: true,
      value: { id: 'job-2' },
    });

    const claimed = await repo.claimDueJobs({
      now: '2026-06-17T12:00:00.000Z',
      leaseOwnerId: 'worker-1',
      leaseDurationMs: 120_000,
      limit: 1,
    });

    expect(claimed).toMatchObject({ ok: true, value: [{ id: 'job-2' }] });
    expect(db.collection('fa_knowledge_access_refresh_jobs').docs.get('job-2')).toMatchObject({
      status: 'running',
      leaseOwnerId: 'worker-1',
      leaseExpiresAt: timestampFromIso('2026-06-17T12:02:00.000Z'),
    });
  });

  it('guards claims, completion, and failure with the current lease owner', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreKnowledgeAccessRefreshRepository(db as never);
    await repo.enqueueJob(job({ id: 'job-lease' }));

    await expect(
      repo.claimDueJobs({
        now: '2026-06-17T12:00:00.000Z',
        leaseOwnerId: 'worker-1',
        leaseDurationMs: 120_000,
        limit: 1,
      })
    ).resolves.toMatchObject({ ok: true, value: [{ id: 'job-lease' }] });
    await expect(
      repo.claimDueJobs({
        now: '2026-06-17T12:00:00.000Z',
        leaseOwnerId: 'worker-2',
        leaseDurationMs: 120_000,
        limit: 1,
      })
    ).resolves.toMatchObject({ ok: true, value: [] });
    await expect(
      repo.claimDueJobs({
        now: '2026-06-17T12:03:00.000Z',
        leaseOwnerId: 'worker-2',
        leaseDurationMs: 120_000,
        limit: 1,
      })
    ).resolves.toMatchObject({ ok: true, value: [{ id: 'job-lease', leaseOwnerId: 'worker-2' }] });
    await expect(
      repo.completeJob({
        jobId: 'job-lease',
        leaseOwnerId: 'worker-1',
        now: '2026-06-17T12:03:05.000Z',
        processedPageCount: 1,
        processedChunkCount: 1,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repo.failJob({
        jobId: 'job-lease',
        leaseOwnerId: 'worker-1',
        now: '2026-06-17T12:03:05.000Z',
        error: { code: 'INTERNAL_ERROR', message: 'stale failure' },
        nextRunAt: '2026-06-17T12:04:00.000Z',
        exhausted: false,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repo.completeJob({
        jobId: 'job-lease',
        leaseOwnerId: 'worker-2',
        now: '2026-06-17T12:03:10.000Z',
        processedPageCount: 1,
        processedChunkCount: 1,
      })
    ).resolves.toMatchObject({ ok: true, value: { status: 'succeeded' } });
    await expect(repo.getJobById('job-lease')).resolves.toMatchObject({
      ok: true,
      value: { status: 'succeeded', processedPageCount: 1, processedChunkCount: 1 },
    });
  });

  it('retries only failed and expired running jobs', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreKnowledgeAccessRefreshRepository(db as never);
    await repo.enqueueJob(job({ id: 'failed', status: 'failed', attempts: 6 }));
    await repo.enqueueJob(
      job({
        id: 'expired',
        status: 'running',
        attempts: 2,
        leaseOwnerId: 'worker-1',
        leaseExpiresAt: '2026-06-17T11:59:00.000Z',
      })
    );
    await repo.enqueueJob(job({ id: 'pending', status: 'pending', attempts: 3 }));
    await repo.enqueueJob(
      job({
        id: 'active',
        status: 'running',
        attempts: 4,
        leaseOwnerId: 'worker-1',
        leaseExpiresAt: '2026-06-17T12:05:00.000Z',
      })
    );
    await repo.enqueueJob(job({ id: 'succeeded', status: 'succeeded' }));
    await repo.enqueueJob(job({ id: 'corrupted', status: 'unknown' as never, attempts: 5 }));

    await expect(
      repo.retryJob({ jobId: 'failed', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: true, value: { status: 'pending', attempts: 0 } });
    await expect(
      repo.retryJob({ jobId: 'expired', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: true, value: { status: 'pending', attempts: 0 } });
    await expect(
      repo.retryJob({ jobId: 'pending', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repo.retryJob({ jobId: 'active', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repo.retryJob({ jobId: 'succeeded', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(
      repo.retryJob({ jobId: 'corrupted', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(repo.getJobById('pending')).resolves.toMatchObject({
      ok: true,
      value: { attempts: 3 },
    });
  });

  it('does not clear a running lease when a worker claims before retry writes', async () => {
    const db = new RetryRaceFirestore();
    const repo = new FirestoreKnowledgeAccessRefreshRepository(db as never);
    await repo.enqueueJob(
      job({
        id: 'retry-race',
        status: 'failed',
        attempts: 6,
        lastError: {
          code: 'VALIDATION_ERROR',
          message: 'operator-safe failure',
          occurredAt: '2026-06-17T11:59:00.000Z',
        },
      })
    );

    await expect(
      repo.retryJob({ jobId: 'retry-race', now: '2026-06-17T12:00:00.000Z' })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    await expect(repo.getJobById('retry-race')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'running',
        leaseOwnerId: 'worker-race',
        leaseExpiresAt: '2026-06-17T12:05:00.000Z',
        attempts: 6,
      },
    });
  });

  it('reports job, chunk, audit, mismatch, and recent failure admin status counts', async () => {
    const db = new FakeFirestore();
    const repo = new FirestoreKnowledgeAccessRefreshRepository(db as never);
    await repo.enqueueJob(
      job({
        id: 'failed',
        status: 'failed',
        attempts: 6,
        lastError: {
          code: 'VALIDATION_ERROR',
          message: 'redacted failure',
          occurredAt: '2026-06-17T12:00:00.000Z',
        },
        updatedAt: '2026-06-17T12:05:00.000Z',
      })
    );
    await repo.enqueueJob(
      job({
        id: 'running-expired',
        status: 'running',
        leaseExpiresAt: '2026-06-17T11:59:00.000Z',
      })
    );
    await db
      .collection('fa_knowledge_pages')
      .doc('page-1')
      .set({
        status: 'active',
        access: { effective: { accessRevision: 'rev-2' } },
      });
    await db.collection('fa_knowledge_chunks').doc('chunk-current').set({
      status: 'active',
      pageId: 'page-1',
      accessSyncStatus: 'current',
      accessRevision: 'rev-2',
    });
    await db.collection('fa_knowledge_chunks').doc('chunk-stale').set({
      status: 'active',
      pageId: 'page-1',
      accessSyncStatus: 'stale',
      accessRevision: 'rev-1',
    });
    await db.collection('fa_knowledge_chunks').doc('chunk-failed').set({
      status: 'active',
      pageId: 'page-1',
      accessSyncStatus: 'failed',
      accessRevision: 'rev-2',
    });
    await db.collection('fa_knowledge_chunks').doc('chunk-invalid').set({
      status: 'active',
      pageId: 'page-1',
      accessSyncStatus: 'invalid',
      accessRevision: 'rev-2',
    });
    await db.collection('fa_knowledge_access_audits').doc('audit-critical').set({
      status: 'open',
      severity: 'critical',
      resolvedAt: null,
    });
    await db.collection('fa_knowledge_access_audits').doc('audit-warning').set({
      status: 'open',
      severity: 'warning',
      resolvedAt: null,
    });
    await db
      .collection('fa_knowledge_access_audits')
      .doc('audit-resolved')
      .set({
        status: 'resolved',
        severity: 'warning',
        resolvedAt: timestampFromIso('2026-06-17T11:00:00.000Z'),
      });

    await expect(repo.getAdminStatus({ now: '2026-06-17T12:00:00.000Z' })).resolves.toMatchObject({
      ok: true,
      value: {
        jobs: { failed: 1, running: 1, expiredRunning: 1 },
        chunks: { active: 4, current: 1, stale: 1, failed: 1, invalid: 1, mismatch: 1 },
        audits: { openCritical: 1, openWarning: 1, resolvedLast24h: 1 },
        recentFailures: [{ jobId: 'failed', lastErrorCode: 'VALIDATION_ERROR' }],
      },
    });
    expect(db.collection('fa_knowledge_pages').selectedFieldSets).toContainEqual([
      'status',
      'access',
    ]);
    expect(db.collection('fa_knowledge_chunks').selectedFieldSets).toContainEqual([
      'status',
      'pageId',
      'accessSyncStatus',
      'accessRevision',
    ]);
    expect(db.collection('fa_knowledge_access_audits').selectedFieldSets).toContainEqual([
      'status',
      'severity',
      'resolvedAt',
    ]);
  });

  it('sanitizes raw Firestore errors before returning repository failures', async () => {
    const repo = new FirestoreKnowledgeAccessRefreshRepository(new LeakyFirestore() as never);

    const result = await repo.getAdminStatus({ now: '2026-06-17T12:00:00.000Z' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(result.error.message).not.toContain('auth0|user-123');
      expect(result.error.message).not.toContain('+1 555 010 800');
      expect(result.error.message).not.toContain('FA_INTERNAL_AUTH_TOKEN');
      expect(result.error.message).not.toContain('firestore.ts');
      expect(result.error.message).toContain('[redacted]');
    }
  });
});
