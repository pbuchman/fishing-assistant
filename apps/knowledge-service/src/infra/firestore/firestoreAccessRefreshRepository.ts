import { err, getErrorMessage, ok, type Result } from '@fa/common-core';
import { getFirestore, type Firestore } from '@fa/infra-firestore';

import type {
  KnowledgeAccessAudit,
  KnowledgeAccessRefreshJob,
} from '../../domain/models/knowledge.js';
import type {
  KnowledgeAccessRefreshAdminStatus,
  KnowledgeAccessRefreshRepository,
  KnowledgeRepositoryError,
} from '../../domain/repositories/knowledgeRepositories.js';
import {
  KNOWLEDGE_PAGE_CHUNKS_COLLECTION,
  KNOWLEDGE_ACCESS_AUDITS_COLLECTION,
  KNOWLEDGE_ACCESS_REFRESH_JOBS_COLLECTION,
  KNOWLEDGE_PAGES_COLLECTION,
} from './collections.js';
import { isoFromTimestamp, timestampFromIso } from './firestoreMapping.js';
import { sanitizeAccessRefreshErrorMessage } from '../../domain/usecases/accessRefresh.js';

function repositoryError(error: unknown): KnowledgeRepositoryError {
  const sanitized = sanitizeAccessRefreshErrorMessage(
    getErrorMessage(error, 'Firestore operation failed')
  );
  return {
    code: 'INTERNAL_ERROR',
    message: sanitized.length > 0 ? sanitized : 'Firestore operation failed',
  };
}

function nullableString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  throw new Error(`${key} must be a string or null`);
}

function string(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

function number(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (typeof value !== 'number') {
    throw new Error(`${key} must be a number`);
  }
  return value;
}

function nullableObject(
  data: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const value = data[key];
  if (value === null) {
    return null;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`${key} must be an object or null`);
}

function object(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = data[key];
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`${key} must be an object`);
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pageAccessRevision(data: Record<string, unknown>): string | null {
  const access = nestedRecord(data['access']);
  const effective = access === null ? null : nestedRecord(access['effective']);
  const value = effective?.['accessRevision'];
  return typeof value === 'string' ? value : null;
}

function jobToDoc(job: KnowledgeAccessRefreshJob): Record<string, unknown> {
  return {
    ...job,
    target: { ...job.target },
    lastError: job.lastError === null ? null : { ...job.lastError },
    nextRunAt: timestampFromIso(job.nextRunAt),
    leaseExpiresAt: job.leaseExpiresAt === null ? null : timestampFromIso(job.leaseExpiresAt),
    createdAt: timestampFromIso(job.createdAt),
    updatedAt: timestampFromIso(job.updatedAt),
    startedAt: job.startedAt === null ? null : timestampFromIso(job.startedAt),
    finishedAt: job.finishedAt === null ? null : timestampFromIso(job.finishedAt),
  };
}

function jobFromDoc(id: string, data: Record<string, unknown>): KnowledgeAccessRefreshJob {
  const target = object(data, 'target');
  const lastError = nullableObject(data, 'lastError');
  return {
    id,
    status: string(data, 'status') as KnowledgeAccessRefreshJob['status'],
    kind: string(data, 'kind') as KnowledgeAccessRefreshJob['kind'],
    target: {
      categoryId: nullableString(target, 'categoryId'),
      pageId: nullableString(target, 'pageId'),
    },
    requestedAccessRevision: nullableString(data, 'requestedAccessRevision'),
    actorAdminUserId: string(data, 'actorAdminUserId'),
    priority: number(data, 'priority'),
    attempts: number(data, 'attempts'),
    maxAttempts: number(data, 'maxAttempts'),
    nextRunAt: isoFromTimestamp(data['nextRunAt'], 'nextRunAt'),
    leaseOwnerId: nullableString(data, 'leaseOwnerId'),
    leaseExpiresAt:
      data['leaseExpiresAt'] === null
        ? null
        : isoFromTimestamp(data['leaseExpiresAt'], 'leaseExpiresAt'),
    processedPageCount: number(data, 'processedPageCount'),
    processedChunkCount: number(data, 'processedChunkCount'),
    lastError:
      lastError === null
        ? null
        : {
            code: string(lastError, 'code'),
            message: sanitizeAccessRefreshErrorMessage(string(lastError, 'message')),
            occurredAt: isoFromTimestamp(lastError['occurredAt'], 'lastError.occurredAt'),
          },
    createdAt: isoFromTimestamp(data['createdAt'], 'createdAt'),
    updatedAt: isoFromTimestamp(data['updatedAt'], 'updatedAt'),
    startedAt: data['startedAt'] === null ? null : isoFromTimestamp(data['startedAt'], 'startedAt'),
    finishedAt:
      data['finishedAt'] === null ? null : isoFromTimestamp(data['finishedAt'], 'finishedAt'),
  };
}

function auditToDoc(audit: KnowledgeAccessAudit): Record<string, unknown> {
  return {
    ...audit,
    expected: audit.expected === null ? null : { ...audit.expected },
    actual: { ...audit.actual },
    detectedAt: timestampFromIso(audit.detectedAt),
    resolvedAt: audit.resolvedAt === null ? null : timestampFromIso(audit.resolvedAt),
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

function emptyChunkCounts(): KnowledgeAccessRefreshAdminStatus['chunks'] {
  return { active: 0, current: 0, stale: 0, failed: 0, invalid: 0, mismatch: 0 };
}

export class FirestoreKnowledgeAccessRefreshRepository implements KnowledgeAccessRefreshRepository {
  constructor(private readonly firestore?: Firestore) {}

  private get db(): Firestore {
    return this.firestore ?? getFirestore();
  }

  async enqueueJob(
    job: KnowledgeAccessRefreshJob
  ): Promise<Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError>> {
    try {
      await this.db
        .collection(KNOWLEDGE_ACCESS_REFRESH_JOBS_COLLECTION)
        .doc(job.id)
        .create(jobToDoc(job));
      return ok(job);
    } catch (error) {
      const candidate = error as { code?: unknown };
      if (candidate.code === 6 || candidate.code === 'already-exists') {
        return err({
          code: 'CONFLICT',
          message: `Knowledge access refresh job ${job.id} already exists`,
        });
      }
      return err(repositoryError(error));
    }
  }

  async getJobById(
    jobId: string
  ): Promise<Result<KnowledgeAccessRefreshJob | null, KnowledgeRepositoryError>> {
    try {
      const snapshot = await this.db
        .collection(KNOWLEDGE_ACCESS_REFRESH_JOBS_COLLECTION)
        .doc(jobId)
        .get();
      const data = snapshot.data() as Record<string, unknown> | undefined;
      return ok(!snapshot.exists || data === undefined ? null : jobFromDoc(snapshot.id, data));
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async claimDueJobs(input: {
    now: string;
    leaseOwnerId: string;
    leaseDurationMs: number;
    limit?: number;
  }): Promise<Result<KnowledgeAccessRefreshJob[], KnowledgeRepositoryError>> {
    try {
      const collection = this.db.collection(KNOWLEDGE_ACCESS_REFRESH_JOBS_COLLECTION);
      const snapshot = await collection.get();
      const limit = Math.max(1, Math.min(input.limit ?? 10, 10));
      const leaseExpiresAt = new Date(
        new Date(input.now).getTime() + input.leaseDurationMs
      ).toISOString();
      const jobs = snapshot.docs
        .map((doc) => jobFromDoc(doc.id, doc.data() as Record<string, unknown>))
        .filter((job) => isDue(job, input.now))
        .sort(compareJobs)
        .slice(0, Math.max(limit * 3, limit));
      const claimed = await this.db.runTransaction(async (transaction) => {
        const claimedJobs: KnowledgeAccessRefreshJob[] = [];
        for (const job of jobs) {
          if (claimedJobs.length >= limit) {
            break;
          }
          const documentRef = collection.doc(job.id);
          const currentSnapshot = await transaction.get(documentRef);
          const currentData = currentSnapshot.data() as Record<string, unknown> | undefined;
          if (!currentSnapshot.exists || currentData === undefined) {
            continue;
          }
          const current = jobFromDoc(currentSnapshot.id, currentData);
          if (!isDue(current, input.now)) {
            continue;
          }
          const next: KnowledgeAccessRefreshJob = {
            ...current,
            status: 'running',
            leaseOwnerId: input.leaseOwnerId,
            leaseExpiresAt,
            startedAt: current.startedAt ?? input.now,
            finishedAt: null,
            updatedAt: input.now,
          };
          transaction.update(documentRef, {
            status: 'running',
            leaseOwnerId: input.leaseOwnerId,
            leaseExpiresAt: timestampFromIso(leaseExpiresAt),
            startedAt:
              current.startedAt === null
                ? timestampFromIso(input.now)
                : timestampFromIso(current.startedAt),
            finishedAt: null,
            updatedAt: timestampFromIso(input.now),
          });
          claimedJobs.push(next);
        }
        return claimedJobs;
      });
      return ok(claimed);
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async completeJob(input: {
    jobId: string;
    leaseOwnerId: string;
    now: string;
    processedPageCount: number;
    processedChunkCount: number;
  }): Promise<Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError>> {
    try {
      return await this.db.runTransaction(async (transaction) => {
        const documentRef = this.db
          .collection(KNOWLEDGE_ACCESS_REFRESH_JOBS_COLLECTION)
          .doc(input.jobId);
        const snapshot = await transaction.get(documentRef);
        const data = snapshot.data() as Record<string, unknown> | undefined;
        if (!snapshot.exists || data === undefined) {
          return err({
            code: 'NOT_FOUND',
            message: `Knowledge access refresh job ${input.jobId} not found`,
          });
        }
        const existing = jobFromDoc(snapshot.id, data);
        const guarded = guardedRunningJob(existing, input.leaseOwnerId);
        if (!guarded.ok) {
          return guarded;
        }
        const next: KnowledgeAccessRefreshJob = {
          ...existing,
          status: 'succeeded',
          leaseOwnerId: null,
          leaseExpiresAt: null,
          processedPageCount: existing.processedPageCount + input.processedPageCount,
          processedChunkCount: existing.processedChunkCount + input.processedChunkCount,
          lastError: null,
          updatedAt: input.now,
          finishedAt: input.now,
        };
        transaction.set(documentRef, jobToDoc(next));
        return ok(next);
      });
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async continueJob(input: {
    jobId: string;
    leaseOwnerId: string;
    now: string;
    processedPageCount: number;
    processedChunkCount: number;
    nextRunAt?: string;
  }): Promise<Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError>> {
    try {
      return await this.db.runTransaction(async (transaction) => {
        const documentRef = this.db
          .collection(KNOWLEDGE_ACCESS_REFRESH_JOBS_COLLECTION)
          .doc(input.jobId);
        const snapshot = await transaction.get(documentRef);
        const data = snapshot.data() as Record<string, unknown> | undefined;
        if (!snapshot.exists || data === undefined) {
          return err({
            code: 'NOT_FOUND',
            message: `Knowledge access refresh job ${input.jobId} not found`,
          });
        }
        const existing = jobFromDoc(snapshot.id, data);
        const guarded = guardedRunningJob(existing, input.leaseOwnerId);
        if (!guarded.ok) {
          return guarded;
        }
        const next: KnowledgeAccessRefreshJob = {
          ...existing,
          status: 'pending',
          nextRunAt: input.nextRunAt ?? input.now,
          leaseOwnerId: null,
          leaseExpiresAt: null,
          processedPageCount: existing.processedPageCount + input.processedPageCount,
          processedChunkCount: existing.processedChunkCount + input.processedChunkCount,
          lastError: null,
          updatedAt: input.now,
          finishedAt: null,
        };
        transaction.set(documentRef, jobToDoc(next));
        return ok(next);
      });
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async failJob(input: {
    jobId: string;
    leaseOwnerId: string;
    now: string;
    error: { code: string; message: string };
    nextRunAt: string;
    exhausted: boolean;
  }): Promise<Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError>> {
    try {
      return await this.db.runTransaction(async (transaction) => {
        const documentRef = this.db
          .collection(KNOWLEDGE_ACCESS_REFRESH_JOBS_COLLECTION)
          .doc(input.jobId);
        const snapshot = await transaction.get(documentRef);
        const data = snapshot.data() as Record<string, unknown> | undefined;
        if (!snapshot.exists || data === undefined) {
          return err({
            code: 'NOT_FOUND',
            message: `Knowledge access refresh job ${input.jobId} not found`,
          });
        }
        const existing = jobFromDoc(snapshot.id, data);
        const guarded = guardedRunningJob(existing, input.leaseOwnerId);
        if (!guarded.ok) {
          return guarded;
        }
        const next: KnowledgeAccessRefreshJob = {
          ...existing,
          status: input.exhausted ? 'failed' : 'pending',
          attempts: existing.attempts + 1,
          nextRunAt: input.exhausted ? existing.nextRunAt : input.nextRunAt,
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
        transaction.set(documentRef, jobToDoc(next));
        return ok(next);
      });
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async retryJob(input: {
    jobId: string;
    now: string;
  }): Promise<Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError>> {
    try {
      return await this.db.runTransaction(async (transaction) => {
        const documentRef = this.db
          .collection(KNOWLEDGE_ACCESS_REFRESH_JOBS_COLLECTION)
          .doc(input.jobId);
        const snapshot = await transaction.get(documentRef);
        const data = snapshot.data() as Record<string, unknown> | undefined;
        if (!snapshot.exists || data === undefined) {
          return err({
            code: 'NOT_FOUND',
            message: `Knowledge access refresh job ${input.jobId} not found`,
          });
        }
        const existing = jobFromDoc(snapshot.id, data);
        const status: string = existing.status;
        if (status === 'pending') {
          return err({
            code: 'CONFLICT',
            message: 'Pending access refresh jobs are already runnable',
          });
        }
        if (status === 'succeeded') {
          return err({
            code: 'CONFLICT',
            message: 'Succeeded access refresh jobs cannot be retried',
          });
        }
        if (status !== 'failed' && status !== 'running') {
          return err({ code: 'CONFLICT', message: 'Access refresh job is not retryable' });
        }
        if (
          status === 'running' &&
          (existing.leaseExpiresAt === null || existing.leaseExpiresAt > input.now)
        ) {
          return err({
            code: 'CONFLICT',
            message: 'Running access refresh job lease has not expired',
          });
        }
        const next: KnowledgeAccessRefreshJob = {
          ...existing,
          status: 'pending',
          attempts: 0,
          nextRunAt: input.now,
          leaseOwnerId: null,
          leaseExpiresAt: null,
          lastError: null,
          updatedAt: input.now,
          finishedAt: null,
        };
        transaction.set(documentRef, jobToDoc(next));
        return ok(next);
      });
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async upsertAudit(
    audit: KnowledgeAccessAudit
  ): Promise<Result<KnowledgeAccessAudit, KnowledgeRepositoryError>> {
    try {
      await this.db
        .collection(KNOWLEDGE_ACCESS_AUDITS_COLLECTION)
        .doc(audit.id)
        .set(auditToDoc(audit));
      return ok(audit);
    } catch (error) {
      return err(repositoryError(error));
    }
  }

  async getAdminStatus(input: {
    now: string;
    recentFailuresLimit?: number;
  }): Promise<Result<KnowledgeAccessRefreshAdminStatus, KnowledgeRepositoryError>> {
    try {
      const jobsSnapshot = await this.db.collection(KNOWLEDGE_ACCESS_REFRESH_JOBS_COLLECTION).get();
      const jobs = jobsSnapshot.docs.map((doc) =>
        jobFromDoc(doc.id, doc.data() as Record<string, unknown>)
      );
      const pagesSnapshot = await this.db
        .collection(KNOWLEDGE_PAGES_COLLECTION)
        .select('status', 'access')
        .get();
      const pageRevisions = new Map<string, string>();
      for (const doc of pagesSnapshot.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (data['status'] !== 'active') {
          continue;
        }
        const accessRevision = pageAccessRevision(data);
        if (accessRevision !== null) {
          pageRevisions.set(doc.id, accessRevision);
        }
      }
      const chunksSnapshot = await this.db
        .collection(KNOWLEDGE_PAGE_CHUNKS_COLLECTION)
        .select('status', 'pageId', 'accessSyncStatus', 'accessRevision')
        .get();
      const chunks = emptyChunkCounts();
      for (const doc of chunksSnapshot.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (data['status'] !== 'active') {
          continue;
        }
        chunks.active += 1;
        if (data['accessSyncStatus'] === 'current') {
          chunks.current += 1;
        }
        if (data['accessSyncStatus'] === 'stale' || data['accessSyncStatus'] === 'refreshing') {
          chunks.stale += 1;
        }
        if (data['accessSyncStatus'] === 'failed') {
          chunks.failed += 1;
        }
        if (data['accessSyncStatus'] === 'invalid') {
          chunks.invalid += 1;
        }
        const pageId = data['pageId'];
        const expectedRevision =
          typeof pageId === 'string' ? (pageRevisions.get(pageId) ?? null) : null;
        if (
          expectedRevision !== null &&
          typeof data['accessRevision'] === 'string' &&
          data['accessRevision'] !== expectedRevision
        ) {
          chunks.mismatch += 1;
        }
      }
      const auditsSnapshot = await this.db
        .collection(KNOWLEDGE_ACCESS_AUDITS_COLLECTION)
        .select('status', 'severity', 'resolvedAt')
        .get();
      const audits = { openCritical: 0, openWarning: 0, resolvedLast24h: 0 };
      const resolvedSince = new Date(
        new Date(input.now).getTime() - 24 * 60 * 60 * 1000
      ).toISOString();
      for (const doc of auditsSnapshot.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (data['status'] === 'open' && data['severity'] === 'critical') {
          audits.openCritical += 1;
        }
        if (data['status'] === 'open' && data['severity'] === 'warning') {
          audits.openWarning += 1;
        }
        if (data['status'] === 'resolved' && data['resolvedAt'] !== null) {
          const resolvedAt = isoFromTimestamp(data['resolvedAt'], 'resolvedAt');
          if (resolvedAt >= resolvedSince) {
            audits.resolvedLast24h += 1;
          }
        }
      }
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
      return ok({
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
        audits,
        lastSuccessAt:
          jobs
            .filter((job) => job.status === 'succeeded')
            .map((job) => job.finishedAt)
            .filter((finishedAt): finishedAt is string => finishedAt !== null)
            .sort()
            .at(-1) ?? null,
        recentFailures,
      });
    } catch (error) {
      return err(repositoryError(error));
    }
  }
}
