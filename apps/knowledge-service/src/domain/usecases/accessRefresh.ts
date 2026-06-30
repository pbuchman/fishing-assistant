import { createHash } from 'node:crypto';

import { err, getErrorMessage, ok, type Clock, type Result } from '@fa/common-core';

import type {
  EffectiveKnowledgeAccess,
  KnowledgeAccessAudit,
  KnowledgeAccessRefreshJob,
  KnowledgePage,
  KnowledgePageChunk,
} from '../models/knowledge.js';
import {
  validateKnowledgeAccess,
  validateKnowledgeSourceUrl,
} from '../models/knowledgeValidation.js';
import type {
  KnowledgeAccessRefreshRepository,
  KnowledgePageChunkRepository,
  KnowledgePageRepository,
  KnowledgeRepositoryError,
} from '../repositories/knowledgeRepositories.js';

export const ACCESS_REFRESH_MAX_CLAIMED_JOBS = 10;
export const ACCESS_REFRESH_MAX_PAGES_PER_BATCH = 100;
export const ACCESS_REFRESH_MAX_CHUNKS_PER_BATCH = 500;
export const ACCESS_REFRESH_MAX_ATTEMPTS = 6;
export const ACCESS_REFRESH_LEASE_DURATION_MS = 120_000;
export const ACCESS_REFRESH_DEFAULT_INTERVAL_MS = 30_000;

export const accessRefreshLogEvents = {
  jobClaimed: 'knowledge_access_refresh_job_claimed',
  jobSucceeded: 'knowledge_access_refresh_job_succeeded',
  jobFailed: 'knowledge_access_refresh_job_failed',
  chunkMarkedStale: 'knowledge_access_chunk_marked_stale',
  mismatchDetected: 'knowledge_access_mismatch_detected',
  sourceUrlRejected: 'knowledge_source_url_rejected',
  ragCandidateExcluded: 'knowledge_rag_candidate_excluded',
} as const;

interface LoggerLike {
  info(metadata: Record<string, unknown>, message: string): void;
  warn(metadata: Record<string, unknown>, message: string): void;
  error(metadata: Record<string, unknown>, message: string): void;
}

export interface KnowledgeAccessRefreshTickResult {
  claimedJobCount: number;
  succeededJobCount: number;
  failedJobCount: number;
  processedPageCount: number;
  processedChunkCount: number;
}

export interface KnowledgeAccessRefreshExecutorOptions {
  accessRefreshRepository: KnowledgeAccessRefreshRepository;
  pageRepository: KnowledgePageRepository;
  pageChunkRepository: KnowledgePageChunkRepository;
  clock: Clock;
  leaseOwnerId: string;
  randomJitterMs?: () => number;
  intervalMs?: number;
  logger?: LoggerLike;
}

export function sanitizeAccessRefreshErrorMessage(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, '[redacted]')
    .replace(/\bauth0\|[A-Za-z0-9._~:/=-]+\b/g, '[redacted]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted]')
    .replace(
      /\b[A-Z0-9_]*(?:TOKEN|SECRET|API[_-]?KEY|AUTHORIZATION)[A-Z0-9_]*\s*=\s*\S+/gi,
      '[redacted]'
    )
    .replace(/\b(?:token|secret|authorization|api[_-]?key)\b[^\n]*/gi, '[redacted]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[redacted]')
    .split('\n')
    .filter((line) => !/\bat\b\s+\S+/.test(line) && !/\bstack\b/i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export function recordKnowledgeRagCandidateExcluded(
  logger: Pick<LoggerLike, 'warn'>,
  input: { reason: string }
): void {
  logger.warn(
    { event: accessRefreshLogEvents.ragCandidateExcluded, reason: input.reason },
    'Knowledge RAG candidate excluded by access guard'
  );
}

export function computeAccessRefreshBackoffMs(input: {
  attempts: number;
  jitterMs: number;
}): number {
  return Math.min(15 * 60 * 1000, 2 ** input.attempts * 30_000 + input.jitterMs);
}

export function isKnowledgePageChunkRetrievalEligible(input: {
  page: KnowledgePage | null;
  chunk: KnowledgePageChunk;
}): boolean {
  const { page, chunk } = input;
  if (page?.status !== 'active') {
    return false;
  }
  if (
    page.syncStatus !== 'synced' ||
    page.indexingStatus !== 'ready' ||
    page.accessSyncStatus !== 'current' ||
    page.access.effective.gate === 'manual'
  ) {
    return false;
  }
  const chunkAccess = (chunk as { access?: KnowledgePageChunk['access'] }).access;
  if (chunk.status !== 'active' || chunkAccess === undefined) {
    return false;
  }
  const chunkGate: string = chunkAccess.gate;
  if (
    chunkGate === 'manual' ||
    chunk.accessSyncStatus !== 'current' ||
    chunk.accessRevision !== page.access.effective.accessRevision
  ) {
    return false;
  }
  if (chunk.source.url !== null && !validateKnowledgeSourceUrl(chunk.source, 'chunk source').ok) {
    return false;
  }
  if (page.source.url !== null && !validateKnowledgeSourceUrl(page.source, 'page source').ok) {
    return false;
  }
  if (
    chunk.pageId !== page.id ||
    chunk.nodeId !== page.nodeId ||
    chunk.categoryId !== page.categoryId ||
    chunk.sectionId !== page.sectionId
  ) {
    return false;
  }
  if (
    chunkAccess.gate !== page.access.effective.gate ||
    chunkAccess.requiredLevel !== page.access.effective.requiredLevel
  ) {
    return false;
  }
  if (
    chunk.source.type !== page.source.type ||
    chunk.source.url !== page.source.url ||
    chunk.source.label !== page.source.label
  ) {
    return false;
  }
  return true;
}

export async function enqueueCategoryAccessRefreshJob(
  deps: {
    accessRefreshRepository: KnowledgeAccessRefreshRepository;
    clock: Clock;
    generateId: () => string;
  },
  input: {
    categoryId: string;
    requestedAccessRevision: string;
    actorAdminUserId: string;
    priority?: number;
  }
): Promise<Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError>> {
  const now = deps.clock.now().toISOString();
  return await deps.accessRefreshRepository.enqueueJob({
    id: deps.generateId(),
    status: 'pending',
    kind: 'category_access_changed',
    target: { categoryId: input.categoryId, pageId: null },
    requestedAccessRevision: input.requestedAccessRevision,
    actorAdminUserId: input.actorAdminUserId,
    priority: input.priority ?? 0,
    attempts: 0,
    maxAttempts: ACCESS_REFRESH_MAX_ATTEMPTS,
    nextRunAt: now,
    leaseOwnerId: null,
    leaseExpiresAt: null,
    processedPageCount: 0,
    processedChunkCount: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
  });
}

function emptyTickResult(): KnowledgeAccessRefreshTickResult {
  return {
    claimedJobCount: 0,
    succeededJobCount: 0,
    failedJobCount: 0,
    processedPageCount: 0,
    processedChunkCount: 0,
  };
}

function accessForPage(page: KnowledgePage): EffectiveKnowledgeAccess | null {
  if (page.access.effective.gate === 'manual') {
    return null;
  }
  return {
    gate: page.access.effective.gate,
    requiredLevel: page.access.effective.requiredLevel,
  };
}

function sourceUrlAuditActual(sourceUrl: string | null): Record<string, unknown> {
  if (sourceUrl === null) {
    return { sourceUrlPresent: false };
  }

  return {
    sourceUrlPresent: true,
    sourceUrlHash: createHash('sha256').update(sourceUrl).digest('hex'),
    sourceUrlCategory: sourceUrlCategory(sourceUrl),
  };
}

function sourceUrlCategory(sourceUrl: string): string {
  try {
    const parsed = new URL(sourceUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:') {
      return 'non_https';
    }
    if (hostname === 'fishing-assistant.online' || hostname === 'dev.fishing-assistant.online') {
      return 'app_origin';
    }
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname === '169.254.169.254' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('127.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    ) {
      return 'internal_or_private';
    }
    return 'external_https';
  } catch {
    return 'invalid_url';
  }
}

function audit(input: {
  kind: KnowledgeAccessAudit['kind'];
  page: KnowledgePage;
  chunkId?: string | null | undefined;
  detectedAt: string;
  actual: Record<string, unknown>;
}): KnowledgeAccessAudit {
  return {
    id: `audit:${input.kind}:${input.page.id}:${input.chunkId ?? 'page'}`,
    status: 'open',
    kind: input.kind,
    severity: 'critical',
    categoryId: input.page.categoryId,
    pageId: input.page.id,
    chunkId: input.chunkId ?? null,
    expected:
      input.page.access.effective.gate === 'manual'
        ? null
        : {
            gate: input.page.access.effective.gate,
            requiredLevel: input.page.access.effective.requiredLevel,
            accessRevision: input.page.access.effective.accessRevision,
            sourceUrl: input.page.source.url,
          },
    actual: input.actual,
    detectedAt: input.detectedAt,
    resolvedAt: null,
    resolutionJobId: null,
  };
}

async function upsertAccessAudit(input: {
  deps: KnowledgeAccessRefreshExecutorOptions;
  kind: KnowledgeAccessAudit['kind'];
  page: KnowledgePage;
  chunkId?: string | null | undefined;
  detectedAt: string;
  actual: Record<string, unknown>;
}): Promise<Result<void, KnowledgeRepositoryError>> {
  const upserted = await input.deps.accessRefreshRepository.upsertAudit(
    audit({
      kind: input.kind,
      page: input.page,
      chunkId: input.chunkId,
      detectedAt: input.detectedAt,
      actual: input.actual,
    })
  );
  if (!upserted.ok) {
    return upserted;
  }

  if (input.kind === 'chunk_page_access_mismatch') {
    input.deps.logger?.warn(
      { event: accessRefreshLogEvents.mismatchDetected, auditKind: input.kind },
      'Knowledge access mismatch detected'
    );
  }
  if (input.kind === 'forbidden_source_url') {
    input.deps.logger?.warn(
      { event: accessRefreshLogEvents.sourceUrlRejected, auditKind: input.kind },
      'Knowledge source URL rejected'
    );
  }

  return ok(undefined);
}

async function openAccessAuditsForPage(input: {
  page: KnowledgePage;
  deps: KnowledgeAccessRefreshExecutorOptions;
  now: string;
  chunkOffset?: number;
  remainingChunkLimit?: number;
}): Promise<
  Result<
    { processedChunkCount: number; completedPage: boolean; hasMoreChunks: boolean },
    KnowledgeRepositoryError
  >
> {
  const chunkOffset = Math.max(0, input.chunkOffset ?? 0);
  const chunkLimit = Math.max(0, input.remainingChunkLimit ?? Number.MAX_SAFE_INTEGER);

  if (chunkOffset === 0) {
    const pageSourceValidation = validateKnowledgeSourceUrl(input.page.source, 'page source');
    if (!pageSourceValidation.ok) {
      const audited = await upsertAccessAudit({
        deps: input.deps,
        kind: 'forbidden_source_url',
        page: input.page,
        detectedAt: input.now,
        actual: { scope: 'page', ...sourceUrlAuditActual(input.page.source.url) },
      });
      if (!audited.ok) {
        return audited;
      }
    }
  }

  const chunks = await input.deps.pageChunkRepository.listActiveForPage({ pageId: input.page.id });
  if (!chunks.ok) {
    return chunks;
  }
  const selectedChunks = chunks.value.slice(chunkOffset, chunkOffset + chunkLimit);

  for (const chunk of selectedChunks) {
    const chunkAccess = (chunk as { access?: KnowledgePageChunk['access'] }).access;
    const chunkSource = (chunk as { source?: KnowledgePageChunk['source'] }).source;
    const chunkSourceUrl = chunkSource?.url ?? null;
    const actual = {
      accessPresent: chunkAccess !== undefined,
      sourcePresent: chunkSource !== undefined,
      accessGate: chunkAccess?.gate ?? null,
      accessRevision: chunk.accessRevision,
      accessSyncStatus: chunk.accessSyncStatus,
      ...sourceUrlAuditActual(chunkSourceUrl),
    };

    if (chunkAccess === undefined) {
      const audited = await upsertAccessAudit({
        deps: input.deps,
        kind: 'missing_chunk_access',
        page: input.page,
        chunkId: chunk.id,
        detectedAt: input.now,
        actual,
      });
      if (!audited.ok) {
        return audited;
      }
      continue;
    }

    if ((chunkAccess as { gate: string }).gate === 'manual') {
      const audited = await upsertAccessAudit({
        deps: input.deps,
        kind: 'manual_chunk_access',
        page: input.page,
        chunkId: chunk.id,
        detectedAt: input.now,
        actual,
      });
      if (!audited.ok) {
        return audited;
      }
      continue;
    }

    const accessValidation = validateKnowledgeAccess(chunkAccess, 'chunk', { allowManual: false });
    if (
      !accessValidation.ok ||
      chunk.accessSyncStatus === 'failed' ||
      chunk.accessSyncStatus === 'invalid'
    ) {
      const audited = await upsertAccessAudit({
        deps: input.deps,
        kind: 'invalid_chunk_access',
        page: input.page,
        chunkId: chunk.id,
        detectedAt: input.now,
        actual,
      });
      if (!audited.ok) {
        return audited;
      }
      continue;
    }

    if (chunk.accessSyncStatus === 'stale' || chunk.accessSyncStatus === 'refreshing') {
      const audited = await upsertAccessAudit({
        deps: input.deps,
        kind: 'stale_chunk_access_revision',
        page: input.page,
        chunkId: chunk.id,
        detectedAt: input.now,
        actual,
      });
      if (!audited.ok) {
        return audited;
      }
      continue;
    }

    const chunkAccessMismatch =
      chunkSource === undefined ||
      chunkAccess.gate !== input.page.access.effective.gate ||
      chunkAccess.requiredLevel !== input.page.access.effective.requiredLevel ||
      chunk.accessRevision !== input.page.access.effective.accessRevision ||
      chunkSourceUrl !== input.page.source.url;
    if (chunkAccessMismatch) {
      const audited = await upsertAccessAudit({
        deps: input.deps,
        kind: 'chunk_page_access_mismatch',
        page: input.page,
        chunkId: chunk.id,
        detectedAt: input.now,
        actual,
      });
      if (!audited.ok) {
        return audited;
      }
    }

    if (
      chunkSource?.url !== null &&
      chunkSource !== undefined &&
      !validateKnowledgeSourceUrl(chunkSource, 'chunk source').ok
    ) {
      const audited = await upsertAccessAudit({
        deps: input.deps,
        kind: 'forbidden_source_url',
        page: input.page,
        chunkId: chunk.id,
        detectedAt: input.now,
        actual,
      });
      if (!audited.ok) {
        return audited;
      }
    }
  }

  const nextOffset = chunkOffset + selectedChunks.length;
  return ok({
    processedChunkCount: selectedChunks.length,
    completedPage: nextOffset >= chunks.value.length,
    hasMoreChunks: nextOffset < chunks.value.length,
  });
}

function pageEffectiveAccessMatches(left: KnowledgePage, right: KnowledgePage): boolean {
  return (
    left.access.effective.gate === right.access.effective.gate &&
    left.access.effective.requiredLevel === right.access.effective.requiredLevel &&
    left.access.effective.accessRevision === right.access.effective.accessRevision
  );
}

async function getCurrentPageForRefresh(input: {
  page: KnowledgePage;
  deps: KnowledgeAccessRefreshExecutorOptions;
  job: KnowledgeAccessRefreshJob;
  now: string;
}): Promise<Result<KnowledgePage | null, KnowledgeRepositoryError>> {
  const current = await input.deps.pageRepository.getById(input.page.id);
  if (!current.ok) {
    return current;
  }
  const currentPage = current.value;
  if (currentPage?.status !== 'active') {
    return ok(null);
  }

  const requestedRevision = input.job.requestedAccessRevision;
  const revisionMatchesJob =
    requestedRevision === null || currentPage.access.effective.accessRevision === requestedRevision;
  if (!revisionMatchesJob || !pageEffectiveAccessMatches(currentPage, input.page)) {
    const audited = await upsertAccessAudit({
      deps: input.deps,
      kind: 'stale_chunk_access_revision',
      page: currentPage,
      detectedAt: input.now,
      actual: {
        scope: 'page',
        requestedAccessRevision: requestedRevision,
        snapshotAccessRevision: input.page.access.effective.accessRevision,
        currentAccessRevision: currentPage.access.effective.accessRevision,
        accessGateChanged: currentPage.access.effective.gate !== input.page.access.effective.gate,
        requiredLevelChanged:
          currentPage.access.effective.requiredLevel !== input.page.access.effective.requiredLevel,
      },
    });
    if (!audited.ok) {
      return audited;
    }
    return ok(null);
  }

  return ok(currentPage);
}

async function markPageInvalid(input: {
  page: KnowledgePage;
  pageRepository: KnowledgePageRepository;
  pageChunkRepository: KnowledgePageChunkRepository;
  job: KnowledgeAccessRefreshJob;
  now: string;
}): Promise<Result<{ processedChunkCount: number }, KnowledgeRepositoryError>> {
  const activeChunks = await input.pageChunkRepository.listActiveForPage({ pageId: input.page.id });
  if (!activeChunks.ok) {
    return activeChunks;
  }
  const fallbackAccess = activeChunks.value[0]?.access ?? { gate: 'excluded', requiredLevel: null };
  const updatedPage = await input.pageRepository.markAccessRefreshState({
    pageId: input.page.id,
    expectedAccessRevision: input.page.access.effective.accessRevision,
    accessSyncStatus: 'invalid',
    accessSyncError: 'Access refresh failed closed',
    updatedAt: input.now,
    updatedByUserId: input.job.actorAdminUserId,
  });
  if (!updatedPage.ok) {
    return updatedPage;
  }
  const refreshed = await input.pageChunkRepository.refreshAccessForPage({
    pageId: input.page.id,
    access: fallbackAccess,
    accessRevision: input.page.access.effective.accessRevision,
    accessSyncStatus: 'invalid',
    expectedPageAccessRevision: input.page.access.effective.accessRevision,
    accessRefreshedAt: input.now,
    accessRefreshJobId: input.job.id,
    limit: ACCESS_REFRESH_MAX_CHUNKS_PER_BATCH,
  });
  if (!refreshed.ok) {
    return refreshed;
  }
  return ok({ processedChunkCount: refreshed.value.processedChunkCount });
}

async function refreshPage(input: {
  page: KnowledgePage;
  deps: KnowledgeAccessRefreshExecutorOptions;
  job: KnowledgeAccessRefreshJob;
  now: string;
  remainingChunkLimit: number;
}): Promise<
  Result<
    { processedPageCount: number; processedChunkCount: number; hasMoreChunks: boolean },
    KnowledgeRepositoryError
  >
> {
  const currentPage = await getCurrentPageForRefresh(input);
  if (!currentPage.ok) {
    return currentPage;
  }
  if (currentPage.value === null) {
    return ok({ processedPageCount: 1, processedChunkCount: 0, hasMoreChunks: false });
  }
  const page = currentPage.value;

  const sourceValidation = validateKnowledgeSourceUrl(page.source, 'page source');
  if (!sourceValidation.ok) {
    const audited = await upsertAccessAudit({
      deps: input.deps,
      kind: 'forbidden_source_url',
      page,
      detectedAt: input.now,
      actual: { scope: 'page', ...sourceUrlAuditActual(page.source.url) },
    });
    if (!audited.ok) {
      return audited;
    }
    const invalid = await markPageInvalid({
      page,
      pageRepository: input.deps.pageRepository,
      pageChunkRepository: input.deps.pageChunkRepository,
      job: input.job,
      now: input.now,
    });
    if (!invalid.ok) {
      return invalid;
    }
    return err({ code: 'VALIDATION_ERROR', message: 'Forbidden source URL' });
  }

  const access = accessForPage(page);
  if (access === null) {
    const audited = await upsertAccessAudit({
      deps: input.deps,
      kind: 'manual_chunk_access',
      page,
      detectedAt: input.now,
      actual: { gate: 'manual' },
    });
    if (!audited.ok) {
      return audited;
    }
    const invalid = await markPageInvalid({
      page,
      pageRepository: input.deps.pageRepository,
      pageChunkRepository: input.deps.pageChunkRepository,
      job: input.job,
      now: input.now,
    });
    if (!invalid.ok) {
      return invalid;
    }
    return err({ code: 'VALIDATION_ERROR', message: 'Manual access cannot be refreshed' });
  }

  const refreshedChunks = await input.deps.pageChunkRepository.refreshAccessForPage({
    pageId: page.id,
    access,
    accessRevision: page.access.effective.accessRevision,
    accessSyncStatus: 'current',
    expectedPageAccessRevision: page.access.effective.accessRevision,
    accessRefreshedAt: input.now,
    accessRefreshJobId: input.job.id,
    limit: input.remainingChunkLimit,
  });
  if (!refreshedChunks.ok) {
    return refreshedChunks;
  }
  if (refreshedChunks.value.revisionConflict) {
    const currentAfterConflict = await getCurrentPageForRefresh({
      ...input,
      page,
    });
    if (!currentAfterConflict.ok) {
      return currentAfterConflict;
    }
    return ok({
      processedPageCount: 0,
      processedChunkCount: refreshedChunks.value.processedChunkCount,
      hasMoreChunks: false,
    });
  }

  if (refreshedChunks.value.hasMore) {
    return ok({
      processedPageCount: 0,
      processedChunkCount: refreshedChunks.value.processedChunkCount,
      hasMoreChunks: true,
    });
  }

  const currentBeforePageUpdate = await getCurrentPageForRefresh({
    ...input,
    page,
  });
  if (!currentBeforePageUpdate.ok) {
    return currentBeforePageUpdate;
  }
  if (currentBeforePageUpdate.value === null) {
    return ok({
      processedPageCount: 0,
      processedChunkCount: refreshedChunks.value.processedChunkCount,
      hasMoreChunks: false,
    });
  }

  const updatedPage = await input.deps.pageRepository.markAccessRefreshState({
    pageId: page.id,
    expectedAccessRevision: page.access.effective.accessRevision,
    accessSyncStatus: 'current',
    accessSyncError: null,
    updatedAt: input.now,
    updatedByUserId: input.job.actorAdminUserId,
  });
  if (!updatedPage.ok) {
    if (updatedPage.error.code === 'CONFLICT') {
      const currentAfterConflict = await getCurrentPageForRefresh({
        ...input,
        page,
      });
      if (!currentAfterConflict.ok) {
        return currentAfterConflict;
      }
      return ok({
        processedPageCount: 0,
        processedChunkCount: refreshedChunks.value.processedChunkCount,
        hasMoreChunks: false,
      });
    }
    return updatedPage;
  }
  return ok({
    processedPageCount: 1,
    processedChunkCount: refreshedChunks.value.processedChunkCount,
    hasMoreChunks: false,
  });
}

interface ProcessJobSuccess {
  outcome: 'succeeded' | 'continued';
  processedPageCount: number;
  processedChunkCount: number;
}

export class KnowledgeAccessRefreshExecutor {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: KnowledgeAccessRefreshExecutorOptions) {}

  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.options.intervalMs ?? ACCESS_REFRESH_DEFAULT_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<Result<KnowledgeAccessRefreshTickResult, KnowledgeRepositoryError>> {
    const now = this.options.clock.now().toISOString();
    const claimed = await this.options.accessRefreshRepository.claimDueJobs({
      now,
      leaseOwnerId: this.options.leaseOwnerId,
      leaseDurationMs: ACCESS_REFRESH_LEASE_DURATION_MS,
      limit: ACCESS_REFRESH_MAX_CLAIMED_JOBS,
    });
    if (!claimed.ok) {
      return claimed;
    }
    const totals = emptyTickResult();
    totals.claimedJobCount = claimed.value.length;

    for (const job of claimed.value) {
      this.options.logger?.info(
        { event: accessRefreshLogEvents.jobClaimed, jobKind: job.kind, status: job.status },
        'Knowledge access refresh job claimed'
      );
      const processed = await this.processJob(job, now);
      if (processed.ok) {
        totals.processedPageCount += processed.value.processedPageCount;
        totals.processedChunkCount += processed.value.processedChunkCount;
        if (processed.value.outcome === 'succeeded') {
          totals.succeededJobCount += 1;
          this.options.logger?.info(
            { event: accessRefreshLogEvents.jobSucceeded, jobKind: job.kind, status: 'succeeded' },
            'Knowledge access refresh job succeeded'
          );
        }
        continue;
      }

      totals.failedJobCount += 1;
      this.options.logger?.warn(
        {
          event: accessRefreshLogEvents.jobFailed,
          jobKind: job.kind,
          status: 'failed',
          errorCode: processed.error.code,
          reason: sanitizeAccessRefreshErrorMessage(processed.error.message),
        },
        'Knowledge access refresh job failed'
      );
      const nextAttempts = job.attempts + 1;
      const jitterMs = this.options.randomJitterMs?.() ?? Math.floor(Math.random() * 10_001);
      const nextRunAt = new Date(
        new Date(now).getTime() +
          computeAccessRefreshBackoffMs({ attempts: job.attempts, jitterMs })
      ).toISOString();
      await this.options.accessRefreshRepository.failJob({
        jobId: job.id,
        leaseOwnerId: this.options.leaseOwnerId,
        now,
        error: { code: processed.error.code, message: processed.error.message },
        nextRunAt,
        exhausted: nextAttempts >= job.maxAttempts,
      });
    }

    return ok(totals);
  }

  private async processJob(
    job: KnowledgeAccessRefreshJob,
    now: string
  ): Promise<Result<ProcessJobSuccess, KnowledgeRepositoryError>> {
    let pages: KnowledgePage[] = [];
    let hasMorePages = false;
    let fullAuditFirstPageChunkOffset = 0;
    const jobKind: string = job.kind;
    if (jobKind === 'category_access_changed') {
      if (job.target.categoryId === null || job.requestedAccessRevision === null) {
        return err({
          code: 'VALIDATION_ERROR',
          message: 'Category access refresh job target is invalid',
        });
      }
      const listed = await this.options.pageRepository.listActiveByCategory({
        categoryId: job.target.categoryId,
      });
      if (!listed.ok) {
        return listed;
      }
      const eligiblePages = listed.value.filter(
        (page) =>
          page.access.override === null &&
          page.access.effective.accessRevision === job.requestedAccessRevision &&
          page.accessSyncStatus !== 'current'
      );
      pages = eligiblePages.slice(0, ACCESS_REFRESH_MAX_PAGES_PER_BATCH);
      hasMorePages = eligiblePages.length > pages.length;
    } else if (jobKind === 'page_access_refresh') {
      if (job.target.pageId === null) {
        return err({
          code: 'VALIDATION_ERROR',
          message: 'Page access refresh job target is invalid',
        });
      }
      const page = await this.options.pageRepository.getById(job.target.pageId);
      if (!page.ok) {
        return page;
      }
      pages = page.value?.status === 'active' ? [page.value] : [];
    } else if (jobKind === 'full_access_audit') {
      const listed = await this.options.pageRepository.listActive();
      if (!listed.ok) {
        return listed;
      }
      const completedPages = listed.value.slice(0, job.processedPageCount);
      let completedPageChunkCount = 0;
      for (const completedPage of completedPages) {
        const completedChunks = await this.options.pageChunkRepository.listActiveForPage({
          pageId: completedPage.id,
        });
        if (!completedChunks.ok) {
          return completedChunks;
        }
        completedPageChunkCount += completedChunks.value.length;
      }
      fullAuditFirstPageChunkOffset = Math.max(
        0,
        job.processedChunkCount - completedPageChunkCount
      );
      pages = listed.value.slice(
        job.processedPageCount,
        job.processedPageCount + ACCESS_REFRESH_MAX_PAGES_PER_BATCH
      );
      hasMorePages = listed.value.length > job.processedPageCount + pages.length;
    } else {
      return err({ code: 'VALIDATION_ERROR', message: 'Access refresh job kind is invalid' });
    }

    let processedPageCount = 0;
    let processedChunkCount = 0;
    for (const page of pages) {
      if (job.kind === 'full_access_audit') {
        const remainingChunkLimit = ACCESS_REFRESH_MAX_CHUNKS_PER_BATCH - processedChunkCount;
        if (remainingChunkLimit <= 0) {
          const continued = await this.options.accessRefreshRepository.continueJob({
            jobId: job.id,
            leaseOwnerId: this.options.leaseOwnerId,
            now,
            processedPageCount,
            processedChunkCount,
          });
          if (!continued.ok) {
            return continued;
          }
          return ok({ outcome: 'continued', processedPageCount, processedChunkCount });
        }
        const audited = await openAccessAuditsForPage({
          page,
          deps: this.options,
          now,
          chunkOffset: processedPageCount === 0 ? fullAuditFirstPageChunkOffset : 0,
          remainingChunkLimit,
        });
        if (!audited.ok) {
          return audited;
        }
        processedChunkCount += audited.value.processedChunkCount;
        if (audited.value.completedPage) {
          processedPageCount += 1;
        }
        if (
          audited.value.hasMoreChunks ||
          processedChunkCount >= ACCESS_REFRESH_MAX_CHUNKS_PER_BATCH
        ) {
          const continued = await this.options.accessRefreshRepository.continueJob({
            jobId: job.id,
            leaseOwnerId: this.options.leaseOwnerId,
            now,
            processedPageCount,
            processedChunkCount,
          });
          if (!continued.ok) {
            return continued;
          }
          return ok({ outcome: 'continued', processedPageCount, processedChunkCount });
        }
        continue;
      }

      const remainingChunkLimit = ACCESS_REFRESH_MAX_CHUNKS_PER_BATCH - processedChunkCount;
      if (remainingChunkLimit <= 0) {
        const continued = await this.options.accessRefreshRepository.continueJob({
          jobId: job.id,
          leaseOwnerId: this.options.leaseOwnerId,
          now,
          processedPageCount,
          processedChunkCount,
        });
        if (!continued.ok) {
          return continued;
        }
        return ok({ outcome: 'continued', processedPageCount, processedChunkCount });
      }
      const refreshed = await refreshPage({
        page,
        deps: this.options,
        job,
        now,
        remainingChunkLimit,
      });
      if (!refreshed.ok) {
        return refreshed;
      }
      processedPageCount += refreshed.value.processedPageCount;
      processedChunkCount += refreshed.value.processedChunkCount;
      if (refreshed.value.hasMoreChunks) {
        const continued = await this.options.accessRefreshRepository.continueJob({
          jobId: job.id,
          leaseOwnerId: this.options.leaseOwnerId,
          now,
          processedPageCount,
          processedChunkCount,
        });
        if (!continued.ok) {
          return continued;
        }
        return ok({ outcome: 'continued', processedPageCount, processedChunkCount });
      }
    }

    if (hasMorePages) {
      const continued = await this.options.accessRefreshRepository.continueJob({
        jobId: job.id,
        leaseOwnerId: this.options.leaseOwnerId,
        now,
        processedPageCount,
        processedChunkCount,
      });
      if (!continued.ok) {
        return continued;
      }
      return ok({ outcome: 'continued', processedPageCount, processedChunkCount });
    }

    const completed = await this.options.accessRefreshRepository.completeJob({
      jobId: job.id,
      leaseOwnerId: this.options.leaseOwnerId,
      now,
      processedPageCount,
      processedChunkCount,
    });
    if (!completed.ok) {
      return completed;
    }
    return ok({ outcome: 'succeeded', processedPageCount, processedChunkCount });
  }
}

export function accessRefreshError(error: unknown): { code: string; message: string } {
  return {
    code: 'INTERNAL_ERROR',
    message: sanitizeAccessRefreshErrorMessage(getErrorMessage(error, 'Access refresh failed')),
  };
}
