import { err, ok, type Result } from '@fa/common-core';

import type {
  KnowledgeAccessAudit,
  KnowledgeAccessRefreshJob,
  KnowledgePage,
  KnowledgePageChunk,
} from '../../domain/models/knowledge.js';
import type {
  KnowledgeAccessRefreshAdminStatus,
  KnowledgeAccessRefreshRepository,
  KnowledgeRepositoryError,
} from '../../domain/repositories/knowledgeRepositories.js';
import type {
  MemoryKnowledgePageChunkRepository,
  MemoryKnowledgePageRepository,
} from './memoryKnowledgeRepositories.js';
import { sanitizeAccessRefreshErrorMessage } from '../../domain/usecases/accessRefresh.js';

function cloneJob(job: KnowledgeAccessRefreshJob): KnowledgeAccessRefreshJob {
  return {
    ...job,
    target: { ...job.target },
    lastError: job.lastError === null ? null : { ...job.lastError },
  };
}

function cloneAudit(audit: KnowledgeAccessAudit): KnowledgeAccessAudit {
  return {
    ...audit,
    expected: audit.expected === null ? null : { ...audit.expected },
    actual: { ...audit.actual },
  };
}

function isDue(job: KnowledgeAccessRefreshJob, now: string): boolean {
  if (job.status === 'pending') {
    return job.nextRunAt <= now;
  }
  if (job.status === 'failed') {
    return job.attempts < job.maxAttempts && job.nextRunAt <= now;
  }
  return job.status === 'running' && job.leaseExpiresAt !== null && job.leaseExpiresAt <= now;
}

function compareJobs(left: KnowledgeAccessRefreshJob, right: KnowledgeAccessRefreshJob): number {
  return (
    left.nextRunAt.localeCompare(right.nextRunAt) ||
    right.priority - left.priority ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function guardedRunningJob(
  job: KnowledgeAccessRefreshJob,
  leaseOwnerId: string
): Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError> {
  if (job.status !== 'running' || job.leaseOwnerId !== leaseOwnerId) {
    return err({
      code: 'CONFLICT',
      message: 'Access refresh job lease is no longer owned by this worker',
    });
  }

  return ok(job);
}

function countChunks(
  chunks: Iterable<KnowledgePageChunk>,
  pages: ReadonlyMap<string, KnowledgePage> | undefined
): KnowledgeAccessRefreshAdminStatus['chunks'] {
  const counts = { active: 0, current: 0, stale: 0, failed: 0, invalid: 0, mismatch: 0 };
  for (const chunk of chunks) {
    if (chunk.status !== 'active') {
      continue;
    }
    counts.active += 1;
    if (chunk.accessSyncStatus === 'current') {
      counts.current += 1;
    }
    if (chunk.accessSyncStatus === 'stale' || chunk.accessSyncStatus === 'refreshing') {
      counts.stale += 1;
    }
    if (chunk.accessSyncStatus === 'failed') {
      counts.failed += 1;
    }
    if (chunk.accessSyncStatus === 'invalid') {
      counts.invalid += 1;
    }
    const page = pages?.get(chunk.pageId);
    if (page !== undefined && chunk.accessRevision !== page.access.effective.accessRevision) {
      counts.mismatch += 1;
    }
  }
  return counts;
}

export class MemoryKnowledgeAccessRefreshRepository implements KnowledgeAccessRefreshRepository {
  readonly jobs = new Map<string, KnowledgeAccessRefreshJob>();
  readonly audits = new Map<string, KnowledgeAccessAudit>();

  constructor(
    private readonly repositories: {
      pages?: MemoryKnowledgePageRepository;
      chunks?: MemoryKnowledgePageChunkRepository;
    } = {}
  ) {}

  enqueueJob(
    job: KnowledgeAccessRefreshJob
  ): Promise<Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError>> {
    if (this.jobs.has(job.id)) {
      return Promise.resolve(
        err({ code: 'CONFLICT', message: `Knowledge access refresh job ${job.id} already exists` })
      );
    }
    this.jobs.set(job.id, cloneJob(job));
    return Promise.resolve(ok(cloneJob(job)));
  }

  getJobById(
    jobId: string
  ): Promise<Result<KnowledgeAccessRefreshJob | null, KnowledgeRepositoryError>> {
    const job = this.jobs.get(jobId);
    return Promise.resolve(ok(job === undefined ? null : cloneJob(job)));
  }

  claimDueJobs(input: {
    now: string;
    leaseOwnerId: string;
    leaseDurationMs: number;
    limit?: number;
  }): Promise<Result<KnowledgeAccessRefreshJob[], KnowledgeRepositoryError>> {
    const limit = Math.max(1, Math.min(input.limit ?? 10, 10));
    const leaseExpiresAt = new Date(
      new Date(input.now).getTime() + input.leaseDurationMs
    ).toISOString();
    const claimed = [...this.jobs.values()]
      .filter((job) => isDue(job, input.now))
      .sort(compareJobs)
      .slice(0, limit);

    for (const job of claimed) {
      const next: KnowledgeAccessRefreshJob = {
        ...job,
        status: 'running',
        leaseOwnerId: input.leaseOwnerId,
        leaseExpiresAt,
        startedAt: job.startedAt ?? input.now,
        finishedAt: null,
        updatedAt: input.now,
      };
      this.jobs.set(job.id, cloneJob(next));
    }

    return Promise.resolve(ok(claimed.map((job) => cloneJob(this.jobs.get(job.id) ?? job))));
  }

  completeJob(input: {
    jobId: string;
    leaseOwnerId: string;
    now: string;
    processedPageCount: number;
    processedChunkCount: number;
  }): Promise<Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError>> {
    const job = this.jobs.get(input.jobId);
    if (job === undefined) {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: `Knowledge access refresh job ${input.jobId} not found` })
      );
    }
    const guarded = guardedRunningJob(job, input.leaseOwnerId);
    if (!guarded.ok) {
      return Promise.resolve(guarded);
    }
    const next: KnowledgeAccessRefreshJob = {
      ...job,
      status: 'succeeded',
      leaseOwnerId: null,
      leaseExpiresAt: null,
      processedPageCount: job.processedPageCount + input.processedPageCount,
      processedChunkCount: job.processedChunkCount + input.processedChunkCount,
      lastError: null,
      updatedAt: input.now,
      finishedAt: input.now,
    };
    this.jobs.set(job.id, cloneJob(next));
    return Promise.resolve(ok(cloneJob(next)));
  }

  continueJob(input: {
    jobId: string;
    leaseOwnerId: string;
    now: string;
    processedPageCount: number;
    processedChunkCount: number;
    nextRunAt?: string;
  }): Promise<Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError>> {
    const job = this.jobs.get(input.jobId);
    if (job === undefined) {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: `Knowledge access refresh job ${input.jobId} not found` })
      );
    }
    const guarded = guardedRunningJob(job, input.leaseOwnerId);
    if (!guarded.ok) {
      return Promise.resolve(guarded);
    }
    const next: KnowledgeAccessRefreshJob = {
      ...job,
      status: 'pending',
      nextRunAt: input.nextRunAt ?? input.now,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      processedPageCount: job.processedPageCount + input.processedPageCount,
      processedChunkCount: job.processedChunkCount + input.processedChunkCount,
      lastError: null,
      updatedAt: input.now,
      finishedAt: null,
    };
    this.jobs.set(job.id, cloneJob(next));
    return Promise.resolve(ok(cloneJob(next)));
  }

  failJob(input: {
    jobId: string;
    leaseOwnerId: string;
    now: string;
    error: { code: string; message: string };
    nextRunAt: string;
    exhausted: boolean;
  }): Promise<Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError>> {
    const job = this.jobs.get(input.jobId);
    if (job === undefined) {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: `Knowledge access refresh job ${input.jobId} not found` })
      );
    }
    const guarded = guardedRunningJob(job, input.leaseOwnerId);
    if (!guarded.ok) {
      return Promise.resolve(guarded);
    }
    const nextAttempts = job.attempts + 1;
    const next: KnowledgeAccessRefreshJob = {
      ...job,
      status: input.exhausted ? 'failed' : 'pending',
      attempts: nextAttempts,
      nextRunAt: input.exhausted ? job.nextRunAt : input.nextRunAt,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      lastError: {
        code: input.error.code,
        message: sanitizeAccessRefreshErrorMessage(input.error.message),
        occurredAt: input.now,
      },
      updatedAt: input.now,
      finishedAt: input.exhausted ? input.now : null,
    };
    this.jobs.set(job.id, cloneJob(next));
    return Promise.resolve(ok(cloneJob(next)));
  }

  retryJob(input: {
    jobId: string;
    now: string;
  }): Promise<Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError>> {
    const job = this.jobs.get(input.jobId);
    if (job === undefined) {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: `Knowledge access refresh job ${input.jobId} not found` })
      );
    }
    const status: string = job.status;
    if (status === 'succeeded') {
      return Promise.resolve(
        err({ code: 'CONFLICT', message: 'Succeeded access refresh jobs cannot be retried' })
      );
    }
    if (status === 'pending') {
      return Promise.resolve(
        err({ code: 'CONFLICT', message: 'Pending access refresh jobs are already runnable' })
      );
    }
    if (status !== 'failed' && status !== 'running') {
      return Promise.resolve(
        err({ code: 'CONFLICT', message: 'Access refresh job is not retryable' })
      );
    }
    if (status === 'running' && (job.leaseExpiresAt === null || job.leaseExpiresAt > input.now)) {
      return Promise.resolve(
        err({ code: 'CONFLICT', message: 'Running access refresh job lease has not expired' })
      );
    }

    const next: KnowledgeAccessRefreshJob = {
      ...job,
      status: 'pending',
      attempts: 0,
      nextRunAt: input.now,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      lastError: null,
      updatedAt: input.now,
      finishedAt: null,
    };
    this.jobs.set(job.id, cloneJob(next));
    return Promise.resolve(ok(cloneJob(next)));
  }

  upsertAudit(
    audit: KnowledgeAccessAudit
  ): Promise<Result<KnowledgeAccessAudit, KnowledgeRepositoryError>> {
    this.audits.set(audit.id, cloneAudit(audit));
    return Promise.resolve(ok(cloneAudit(audit)));
  }

  getAdminStatus(input: {
    now: string;
    recentFailuresLimit?: number;
  }): Promise<Result<KnowledgeAccessRefreshAdminStatus, KnowledgeRepositoryError>> {
    const jobs = [...this.jobs.values()];
    const openAudits = [...this.audits.values()].filter((audit) => audit.status === 'open');
    const resolvedSince = new Date(
      new Date(input.now).getTime() - 24 * 60 * 60 * 1000
    ).toISOString();
    const pageMap = this.repositories.pages?.pages;
    const chunks = countChunks(this.repositories.chunks?.chunks.values() ?? [], pageMap);
    const recentFailures = jobs
      .filter((job) => job.status === 'failed' && job.lastError !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, input.recentFailuresLimit ?? 20)
      .map((job) => ({
        jobId: job.id,
        kind: job.kind,
        target: { ...job.target },
        attempts: job.attempts,
        lastErrorCode: job.lastError?.code ?? 'UNKNOWN',
        updatedAt: job.updatedAt,
      }));

    return Promise.resolve(
      ok({
        jobs: {
          pending: jobs.filter((job) => job.status === 'pending').length,
          running: jobs.filter((job) => job.status === 'running').length,
          succeeded: jobs.filter((job) => job.status === 'succeeded').length,
          failed: jobs.filter((job) => job.status === 'failed').length,
          expiredRunning: jobs.filter(
            (job) =>
              job.status === 'running' &&
              job.leaseExpiresAt !== null &&
              job.leaseExpiresAt <= input.now
          ).length,
        },
        chunks,
        audits: {
          openCritical: openAudits.filter((audit) => audit.severity === 'critical').length,
          openWarning: openAudits.filter((audit) => audit.severity === 'warning').length,
          resolvedLast24h: [...this.audits.values()].filter(
            (audit) =>
              audit.status === 'resolved' &&
              audit.resolvedAt !== null &&
              audit.resolvedAt >= resolvedSince
          ).length,
        },
        lastSuccessAt:
          jobs
            .filter((job) => job.status === 'succeeded')
            .map((job) => job.finishedAt)
            .filter((finishedAt): finishedAt is string => finishedAt !== null)
            .sort()
            .at(-1) ?? null,
        recentFailures,
      })
    );
  }
}
