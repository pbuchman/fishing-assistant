export const knowledgeContentTypes = [
  'guide',
  'recipe',
  'species',
  'session-notes',
  'qna',
  'other',
] as const;

export type KnowledgeContentType = (typeof knowledgeContentTypes)[number];
export type KnowledgeRecordStatus = 'active' | 'deleted';
export type KnowledgeIndexingStatus = 'pending' | 'ready' | 'failed';
export type KnowledgeSyncStatus = 'synced' | 'sync_required' | 'syncing' | 'failed';

export interface KnowledgeChunkDraft {
  headingPath: string[];
  index: number;
  text: string;
  searchableText: string;
  contentType: KnowledgeContentType;
}

export type KnowledgeNodeType = 'root' | 'category' | 'section' | 'page';
export type KnowledgeAccessGate = 'public' | 'approved' | 'level' | 'excluded' | 'manual';
export type EffectiveKnowledgeAccessGate = Exclude<KnowledgeAccessGate, 'manual'>;
export type KnowledgeSourceType = 'external' | 'manual';
export type KnowledgePageSyncStatus = KnowledgeSyncStatus;
export type KnowledgeAccessSyncStatus = 'current' | 'stale' | 'refreshing' | 'failed' | 'invalid';
export type KnowledgeAccessRefreshJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export type KnowledgeContentQualityIssueType = 'adjacent_duplicate_content';
export type KnowledgeAccessRefreshJobKind =
  | 'category_access_changed'
  | 'page_access_refresh'
  | 'full_access_audit';
export type KnowledgeAccessAuditStatus = 'open' | 'resolved';
export type KnowledgeAccessAuditKind =
  | 'missing_chunk_access'
  | 'invalid_chunk_access'
  | 'stale_chunk_access_revision'
  | 'chunk_page_access_mismatch'
  | 'manual_chunk_access'
  | 'forbidden_source_url';

export interface KnowledgeAccess {
  gate: KnowledgeAccessGate;
  requiredLevel: number | null;
}

export interface EffectiveKnowledgeAccess {
  gate: EffectiveKnowledgeAccessGate;
  requiredLevel: number | null;
}

export interface KnowledgeNode {
  id: string;
  type: KnowledgeNodeType;
  status: KnowledgeRecordStatus;
  title: string;
  slug: string;
  sortIndex: number;
  parentId: string | null;
  categoryId: string | null;
  sectionId: string | null;
  pageId: string | null;
  depth: 0 | 1 | 2 | 3;
  pathIds: string[];
  pathTitles: string[];
  categoryAccess: (EffectiveKnowledgeAccess & { accessRevision: string }) | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  deletedByUserId: string | null;
}

export interface KnowledgePageAccessOverride extends KnowledgeAccess {
  source: 'importer' | 'storage';
  recordedAt: string;
  recordedByUserId: string | null;
}

export interface KnowledgeContentQualityAcknowledgement {
  issueType: KnowledgeContentQualityIssueType;
  markdownContentHash: string;
  issueFingerprints: string[];
  reason: string | null;
  acknowledgedAt: string;
  acknowledgedByUserId: string;
}

export interface KnowledgePage {
  id: string;
  nodeId: string;
  status: KnowledgeRecordStatus;
  title: string;
  slug: string;
  categoryId: string;
  sectionId: string | null;
  pathIds: string[];
  pathTitles: string[];
  hierarchy: {
    category: string;
    section?: string;
  };
  source: {
    type: KnowledgeSourceType;
    url: string | null;
    label: string | null;
    importer: {
      provider: string;
      externalId: string;
      importedAt: string;
    } | null;
  };
  access: {
    inheritedFromCategoryId: string;
    categoryAccessRevision: string;
    override: KnowledgePageAccessOverride | null;
    effective: KnowledgeAccess & { accessRevision: string };
  };
  relations: {
    relatedTo: string[];
    linksTo: string[];
    supersedes: string[];
  };
  markdown: string;
  normalizedMarkdown: string;
  markdownContentHash: string;
  contentQualityAcknowledgements?: KnowledgeContentQualityAcknowledgement[];
  indexingStatus: KnowledgeIndexingStatus;
  syncStatus: KnowledgePageSyncStatus;
  accessSyncStatus: KnowledgeAccessSyncStatus;
  indexingError: string | null;
  syncError: string | null;
  accessSyncError: string | null;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdByUserId: string;
  updatedByUserId: string;
  deletedByUserId: string | null;
}

export interface KnowledgePageChunk {
  id: string;
  status: KnowledgeRecordStatus;
  pageId: string;
  nodeId: string;
  categoryId: string;
  sectionId: string | null;
  title: string;
  path: string[];
  headingPath: string[];
  index: number;
  text: string;
  searchableText: string;
  markdownContentHash: string;
  access: EffectiveKnowledgeAccess;
  accessRevision: string;
  accessSyncStatus: KnowledgeAccessSyncStatus;
  source: {
    type: KnowledgeSourceType;
    url: string | null;
    label: string | null;
  };
  embedding: number[];
  embeddingModel: string;
  embeddingProvider: string;
  embeddingDimensions: 2048;
  createdAt: string;
  deletedAt: string | null;
  createdByJobId: string | null;
  accessRefreshedAt: string;
  accessRefreshJobId: string | null;
}

export interface KnowledgeAccessRefreshJob {
  id: string;
  status: KnowledgeAccessRefreshJobStatus;
  kind: KnowledgeAccessRefreshJobKind;
  target: {
    categoryId: string | null;
    pageId: string | null;
  };
  requestedAccessRevision: string | null;
  actorAdminUserId: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  leaseOwnerId: string | null;
  leaseExpiresAt: string | null;
  processedPageCount: number;
  processedChunkCount: number;
  lastError: {
    code: string;
    message: string;
    occurredAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface KnowledgeAccessAudit {
  id: string;
  status: KnowledgeAccessAuditStatus;
  kind: KnowledgeAccessAuditKind;
  severity: 'warning' | 'critical';
  categoryId: string | null;
  pageId: string | null;
  chunkId: string | null;
  expected: {
    gate: EffectiveKnowledgeAccessGate;
    requiredLevel: number | null;
    accessRevision: string;
    sourceUrl: string | null;
  } | null;
  actual: Record<string, unknown>;
  detectedAt: string;
  resolvedAt: string | null;
  resolutionJobId: string | null;
}
