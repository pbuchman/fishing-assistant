import type { Result } from '@fa/common-core';

import type {
  KnowledgeAccessAudit,
  KnowledgeAccessRefreshJob,
  KnowledgeNode,
  KnowledgePage,
  KnowledgePageAccessOverride,
  KnowledgePageChunk,
} from '../models/knowledge.js';

export interface KnowledgeRepositoryError {
  code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR' | 'INTERNAL_ERROR';
  message: string;
}

export interface KnowledgePageChunkMatch extends KnowledgePageChunk {
  vectorScore: number;
}

export type KnowledgeRetrievalChunkCandidate = Omit<
  KnowledgePageChunk,
  'embedding' | 'embeddingModel' | 'embeddingProvider' | 'embeddingDimensions'
>;

export type KnowledgeRetrievalPageMetadata = Omit<
  KnowledgePage,
  'markdown' | 'normalizedMarkdown' | 'contentQualityAcknowledgements'
>;

export interface KnowledgeNodeRepository {
  create(node: KnowledgeNode): Promise<Result<KnowledgeNode, KnowledgeRepositoryError>>;
  getById(nodeId: string): Promise<Result<KnowledgeNode | null, KnowledgeRepositoryError>>;
  listActive(): Promise<Result<KnowledgeNode[], KnowledgeRepositoryError>>;
  update(node: KnowledgeNode): Promise<Result<KnowledgeNode, KnowledgeRepositoryError>>;
  softDeleteSubtree(input: {
    rootNodeId: string;
    deletedAt: string;
    deletedByUserId: string;
  }): Promise<Result<KnowledgeNode[], KnowledgeRepositoryError>>;
}

export interface KnowledgePageRepository {
  create(page: KnowledgePage): Promise<Result<KnowledgePage, KnowledgeRepositoryError>>;
  getById(pageId: string): Promise<Result<KnowledgePage | null, KnowledgeRepositoryError>>;
  getRetrievalMetadataByIds(
    pageIds: string[]
  ): Promise<Result<Map<string, KnowledgeRetrievalPageMetadata>, KnowledgeRepositoryError>>;
  listActive(): Promise<Result<KnowledgePage[], KnowledgeRepositoryError>>;
  recordEffectiveAccessOverride(input: {
    pageId: string;
    override: KnowledgePageAccessOverride;
    effectiveAccessRevision: string;
    updatedAt: string;
  }): Promise<Result<KnowledgePage, KnowledgeRepositoryError>>;
  listActiveByCategory(input: {
    categoryId: string;
  }): Promise<Result<KnowledgePage[], KnowledgeRepositoryError>>;
  listActiveBySection(input: {
    sectionId: string;
  }): Promise<Result<KnowledgePage[], KnowledgeRepositoryError>>;
  update(page: KnowledgePage): Promise<Result<KnowledgePage, KnowledgeRepositoryError>>;
  markAccessRefreshState(input: {
    pageId: string;
    expectedAccessRevision?: string;
    accessSyncStatus: KnowledgePage['accessSyncStatus'];
    accessSyncError: string | null;
    updatedAt: string;
    updatedByUserId: string;
  }): Promise<Result<void, KnowledgeRepositoryError>>;
}

export interface KnowledgePageChunkRepository {
  getPageChunkById(input: {
    chunkId: string;
  }): Promise<Result<KnowledgePageChunk | null, KnowledgeRepositoryError>>;
  claimPageSync(input: {
    page: KnowledgePage;
    deletedAt: string;
  }): Promise<Result<KnowledgePage, KnowledgeRepositoryError>>;
  replaceActiveForPage(input: {
    pageId: string;
    chunks: KnowledgePageChunk[];
    deletedAt: string;
  }): Promise<Result<void, KnowledgeRepositoryError>>;
  softDeleteForPage(input: {
    pageId: string;
    deletedAt: string;
  }): Promise<Result<void, KnowledgeRepositoryError>>;
  listActiveForPage(input: {
    pageId: string;
  }): Promise<Result<KnowledgePageChunk[], KnowledgeRepositoryError>>;
  listRetrievableActive(input: {
    limit: number;
  }): Promise<Result<KnowledgePageChunk[], KnowledgeRepositoryError>>;
  listRetrievableActiveLexicalCandidates(input: { limit: number }): Promise<
    Result<
      {
        chunks: KnowledgeRetrievalChunkCandidate[];
        scannedCount: number;
        limitHit: boolean;
        activeCurrentChunkCount?: number;
      },
      KnowledgeRepositoryError
    >
  >;
  listRetrievableActiveForPage(input: {
    pageId: string;
  }): Promise<Result<KnowledgePageChunk[], KnowledgeRepositoryError>>;
  findNearestPageChunks(input: {
    embedding: number[];
    limit: number;
  }): Promise<Result<KnowledgePageChunkMatch[], KnowledgeRepositoryError>>;
  refreshAccessForPage(input: {
    pageId: string;
    access: KnowledgePageChunk['access'];
    accessRevision: string;
    accessSyncStatus: KnowledgePageChunk['accessSyncStatus'];
    expectedPageAccessRevision?: string;
    accessRefreshedAt: string;
    accessRefreshJobId: string;
    limit: number;
  }): Promise<
    Result<
      { processedChunkCount: number; hasMore: boolean; revisionConflict?: true },
      KnowledgeRepositoryError
    >
  >;
}

export interface KnowledgeAccessRefreshAdminStatus {
  jobs: {
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
    expiredRunning: number;
  };
  chunks: {
    active: number;
    current: number;
    stale: number;
    failed: number;
    invalid: number;
    mismatch: number;
  };
  audits: {
    openCritical: number;
    openWarning: number;
    resolvedLast24h: number;
  };
  lastSuccessAt: string | null;
  recentFailures: {
    jobId: string;
    kind: KnowledgeAccessRefreshJob['kind'];
    target: KnowledgeAccessRefreshJob['target'];
    attempts: number;
    lastErrorCode: string;
    updatedAt: string;
  }[];
}

export interface KnowledgeAccessRefreshRepository {
  enqueueJob(
    job: KnowledgeAccessRefreshJob
  ): Promise<Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError>>;
  getJobById(
    jobId: string
  ): Promise<Result<KnowledgeAccessRefreshJob | null, KnowledgeRepositoryError>>;
  claimDueJobs(input: {
    now: string;
    leaseOwnerId: string;
    leaseDurationMs: number;
    limit?: number;
  }): Promise<Result<KnowledgeAccessRefreshJob[], KnowledgeRepositoryError>>;
  completeJob(input: {
    jobId: string;
    leaseOwnerId: string;
    now: string;
    processedPageCount: number;
    processedChunkCount: number;
  }): Promise<Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError>>;
  continueJob(input: {
    jobId: string;
    leaseOwnerId: string;
    now: string;
    processedPageCount: number;
    processedChunkCount: number;
    nextRunAt?: string;
  }): Promise<Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError>>;
  failJob(input: {
    jobId: string;
    leaseOwnerId: string;
    now: string;
    error: { code: string; message: string };
    nextRunAt: string;
    exhausted: boolean;
  }): Promise<Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError>>;
  retryJob(input: {
    jobId: string;
    now: string;
  }): Promise<Result<KnowledgeAccessRefreshJob, KnowledgeRepositoryError>>;
  upsertAudit(
    audit: KnowledgeAccessAudit
  ): Promise<Result<KnowledgeAccessAudit, KnowledgeRepositoryError>>;
  getAdminStatus(input: {
    now: string;
    recentFailuresLimit?: number;
  }): Promise<Result<KnowledgeAccessRefreshAdminStatus, KnowledgeRepositoryError>>;
}

export interface KnowledgePageCascadeDeleteResult {
  pageId: string;
  nodeId: string;
  deletedChunkCount: number;
}

export interface KnowledgePageCascadeRepository {
  softDeletePage(input: {
    pageId: string;
    deletedAt: string;
    deletedByUserId: string;
  }): Promise<Result<KnowledgePageCascadeDeleteResult, KnowledgeRepositoryError>>;
  softDeleteSubtree(input: {
    rootNodeId: string;
    deletedAt: string;
    deletedByUserId: string;
  }): Promise<
    Result<
      {
        rootNodeId: string;
        deletedSectionCount: number;
        deletedPageCount: number;
        deletedChunkCount: number;
      },
      KnowledgeRepositoryError
    >
  >;
}
