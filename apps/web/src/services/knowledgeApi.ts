import { config } from '../config.js';
import { apiRequest, normalizeApiTimestamp } from './apiClient.js';
import type {
  AnswerGap,
  ListAnswerGapsResponse,
  MarkAnswerGapDoneResponse,
} from '@fa/http-contracts';

export type KnowledgeContentType =
  | 'guide'
  | 'recipe'
  | 'species'
  | 'session-notes'
  | 'qna'
  | 'other';
export type KnowledgeRecordStatus = 'active' | 'deleted';
export type KnowledgeIndexingStatus = 'pending' | 'ready' | 'failed';
export type KnowledgeSyncStatus = 'synced' | 'sync_required' | 'syncing' | 'failed';
export type KnowledgeAccessSyncStatus = 'current' | 'stale' | 'refreshing' | 'failed' | 'invalid';
export type KnowledgeNodeType = 'root' | 'category' | 'section' | 'page';
export type KnowledgeAccessGate = 'public' | 'approved' | 'level' | 'excluded' | 'manual';
export type KnowledgeAdminAccessGate = Exclude<KnowledgeAccessGate, 'manual'>;
export type KnowledgeSourceType = 'external' | 'manual';
export type KnowledgeContentQualityIssueType = 'adjacent_duplicate_content';

export interface KnowledgeBaseSyncResult {
  synced: number;
  failed: number;
  skipped: number;
}

export interface KnowledgeAccessInput {
  gate: KnowledgeAdminAccessGate;
  requiredLevel: number | null;
}

export interface KnowledgeAuthoringAccess {
  gate: KnowledgeAccessGate;
  requiredLevel: number | null;
  accessRevision: string;
  retrievalReady: boolean;
}

export interface KnowledgePageSource {
  type: KnowledgeSourceType;
  url: string | null;
  label: string | null;
  importer?: {
    provider: string;
    externalId: string;
    importedAt: string;
  } | null;
}

export interface KnowledgePageRelations {
  relatedTo: string[];
  linksTo: string[];
  supersedes: string[];
}

export interface KnowledgeContentQualityAcknowledgement {
  issueType: KnowledgeContentQualityIssueType;
  markdownContentHash: string;
  issueFingerprints: string[];
  reason: string | null;
  acknowledgedAt: string;
  acknowledgedByUserId: string;
}

export interface KnowledgeAdminTreeNode {
  id: string;
  type: KnowledgeNodeType;
  title: string;
  slug: string;
  parentId: string | null;
  categoryId: string | null;
  sectionId: string | null;
  pageId: string | null;
  depth: 0 | 1 | 2 | 3;
  sortIndex: number;
  path: string[];
  status: KnowledgeRecordStatus;
  categoryAccess: KnowledgeAccessInput | null;
  accessRevision: string | null;
  pageSummary: {
    effectiveAccess: KnowledgeAuthoringAccess;
    indexingStatus: KnowledgeIndexingStatus;
    syncStatus: KnowledgeSyncStatus;
    accessSyncStatus: KnowledgeAccessSyncStatus;
    source: KnowledgePageSource;
    chunkCount: number;
    updatedAt: string;
  } | null;
  children: KnowledgeAdminTreeNode[];
}

export interface KnowledgeAdminTreeResponse {
  root: KnowledgeAdminTreeNode;
  accessRefresh: {
    pendingJobs: number;
    runningJobs: number;
    failedJobs: number;
    staleChunkCount: number;
    mismatchCount: number;
  };
}

export interface KnowledgeAdminPage {
  id: string;
  nodeId: string;
  title: string;
  categoryId: string;
  sectionId: string | null;
  hierarchy: {
    category: string;
    section?: string;
  };
  path: string[];
  source: KnowledgePageSource;
  access: {
    effective: KnowledgeAuthoringAccess;
    inheritedFromCategoryId: string;
    overridePresent: boolean;
  };
  relations: KnowledgePageRelations;
  markdown: string;
  markdownContentHash: string;
  contentQualityAcknowledgements: KnowledgeContentQualityAcknowledgement[];
  indexingStatus: KnowledgeIndexingStatus;
  syncStatus: KnowledgeSyncStatus;
  accessSyncStatus: KnowledgeAccessSyncStatus;
  indexingError: string | null;
  syncError: string | null;
  accessSyncError: string | null;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface KnowledgeSource {
  id: string;
  sourceId: string;
  title: string;
  content: string;
  updatedAt: string;
  access: {
    gate: KnowledgeAccessGate;
    requiredLevel: number | null;
    retrievalReady: boolean;
  };
}

export interface CreateKnowledgeCategoryInput {
  title: string;
  access: KnowledgeAccessInput;
  sortIndex?: number;
}

export interface UpdateKnowledgeCategoryInput {
  title?: string;
  sortIndex?: number;
}

export interface CreateKnowledgeSectionInput {
  title: string;
  sortIndex?: number;
}

export interface UpdateKnowledgeSectionInput {
  title?: string;
  sortIndex?: number;
}

export interface KnowledgePageSourceInput {
  type: 'external';
  url: string;
  label?: string | null;
}

export interface KnowledgePageRelationsInput {
  relatedTo?: string[];
  linksTo?: string[];
  supersedes?: string[];
}

export interface CreateKnowledgePageInput {
  categoryId: string;
  sectionId?: string | null;
  title: string;
  source: KnowledgePageSourceInput;
  relations?: KnowledgePageRelationsInput;
  markdown: string;
  syncNow?: boolean;
  sortIndex?: number;
}

export interface SaveKnowledgePageInput {
  title?: string;
  sectionId?: string | null;
  source?: KnowledgePageSourceInput;
  relations?: KnowledgePageRelationsInput;
  markdown?: string;
  syncNow?: boolean;
  sortIndex?: number;
}

export interface AcknowledgeKnowledgePageContentQualityInput {
  issueType: KnowledgeContentQualityIssueType;
  markdownContentHash: string;
  issueFingerprints: string[];
  reason?: string | null;
}

export interface AdminKnowledgeBaseSyncResult extends KnowledgeBaseSyncResult {
  queuedAccessRefreshJobs: number;
}

export type AnswerGapStatusFilter = 'needs_answer' | 'all';

export interface ListAnswerGapsInput {
  status?: AnswerGapStatusFilter;
  limit?: number;
  cursor?: string;
}

const knowledgeBaseUrl = config.services.KNOWLEDGE_SERVICE;

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function normalizeAdminPage(page: KnowledgeAdminPage): KnowledgeAdminPage {
  const pagePayload = page as Omit<KnowledgeAdminPage, 'contentQualityAcknowledgements'> & {
    contentQualityAcknowledgements?: KnowledgeAdminPage['contentQualityAcknowledgements'];
  };
  const contentQualityAcknowledgements = Array.isArray(pagePayload.contentQualityAcknowledgements)
    ? pagePayload.contentQualityAcknowledgements
    : [];

  return {
    ...page,
    contentQualityAcknowledgements: contentQualityAcknowledgements.map((acknowledgement) => ({
      ...acknowledgement,
      acknowledgedAt: normalizeApiTimestamp(acknowledgement.acknowledgedAt),
    })),
    createdAt: normalizeApiTimestamp(page.createdAt),
    updatedAt: normalizeApiTimestamp(page.updatedAt),
    deletedAt: page.deletedAt === null ? null : normalizeApiTimestamp(page.deletedAt),
  };
}

function normalizeKnowledgeSource(source: KnowledgeSource): KnowledgeSource {
  return {
    ...source,
    updatedAt: normalizeApiTimestamp(source.updatedAt),
  };
}

function normalizeTreeNode(node: KnowledgeAdminTreeNode): KnowledgeAdminTreeNode {
  return {
    ...node,
    pageSummary:
      node.pageSummary === null
        ? null
        : {
            ...node.pageSummary,
            updatedAt: normalizeApiTimestamp(node.pageSummary.updatedAt),
          },
    children: node.children.map(normalizeTreeNode),
  };
}

function normalizeKnowledgeTree(tree: KnowledgeAdminTreeResponse): KnowledgeAdminTreeResponse {
  return {
    ...tree,
    root: normalizeTreeNode(tree.root),
  };
}

function normalizeAnswerGap(gap: AnswerGap): AnswerGap {
  return {
    ...gap,
    createdAt: normalizeApiTimestamp(gap.createdAt),
    updatedAt: normalizeApiTimestamp(gap.updatedAt),
    doneAt: gap.doneAt === null ? null : normalizeApiTimestamp(gap.doneAt),
  };
}

function normalizeAnswerGapList(response: ListAnswerGapsResponse): ListAnswerGapsResponse {
  return {
    ...response,
    gaps: response.gaps.map(normalizeAnswerGap),
  };
}

function jsonRequest(value: unknown): RequestInit {
  return { body: JSON.stringify(value) };
}

export async function listKnowledgeTree(): Promise<KnowledgeAdminTreeResponse> {
  return normalizeKnowledgeTree(
    await apiRequest<KnowledgeAdminTreeResponse>(`${knowledgeBaseUrl}/admin/tree`)
  );
}

export async function listAnswerGaps(
  input: ListAnswerGapsInput = {}
): Promise<ListAnswerGapsResponse> {
  const params = new URLSearchParams();
  params.set('status', input.status ?? 'needs_answer');
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  if (input.cursor !== undefined) {
    params.set('cursor', input.cursor);
  }

  return normalizeAnswerGapList(
    await apiRequest<ListAnswerGapsResponse>(
      `${knowledgeBaseUrl}/admin/answer-gaps?${params.toString()}`
    )
  );
}

export async function markAnswerGapDone(gapId: string): Promise<MarkAnswerGapDoneResponse> {
  const response = await apiRequest<MarkAnswerGapDoneResponse>(
    `${knowledgeBaseUrl}/admin/answer-gaps/${encodePathSegment(gapId)}/done`,
    {
      method: 'POST',
      ...jsonRequest({}),
    }
  );

  return {
    ...response,
    gap: normalizeAnswerGap(response.gap),
  };
}

export async function createKnowledgeCategory(
  input: CreateKnowledgeCategoryInput
): Promise<KnowledgeAdminTreeNode> {
  return await apiRequest<KnowledgeAdminTreeNode>(`${knowledgeBaseUrl}/admin/categories`, {
    method: 'POST',
    ...jsonRequest(input),
  });
}

export async function updateKnowledgeCategory(
  categoryId: string,
  input: UpdateKnowledgeCategoryInput
): Promise<KnowledgeAdminTreeNode> {
  return await apiRequest<KnowledgeAdminTreeNode>(
    `${knowledgeBaseUrl}/admin/categories/${encodePathSegment(categoryId)}`,
    {
      method: 'PATCH',
      ...jsonRequest(input),
    }
  );
}

export async function updateKnowledgeCategoryAccess(
  categoryId: string,
  access: KnowledgeAccessInput,
  expectedAccessRevision?: string
): Promise<{ category: KnowledgeAdminTreeNode; refreshJob: null }> {
  return await apiRequest<{ category: KnowledgeAdminTreeNode; refreshJob: null }>(
    `${knowledgeBaseUrl}/admin/categories/${encodePathSegment(categoryId)}/access`,
    {
      method: 'PATCH',
      ...jsonRequest({
        access,
        ...(expectedAccessRevision === undefined ? {} : { expectedAccessRevision }),
      }),
    }
  );
}

export async function deleteKnowledgeCategory(categoryId: string): Promise<{
  deleted: true;
  categoryId: string;
  deletedSectionCount: number;
  deletedPageCount: number;
  deletedChunkCount: number;
}> {
  return await apiRequest<{
    deleted: true;
    categoryId: string;
    deletedSectionCount: number;
    deletedPageCount: number;
    deletedChunkCount: number;
  }>(`${knowledgeBaseUrl}/admin/categories/${encodePathSegment(categoryId)}`, { method: 'DELETE' });
}

export async function createKnowledgeSection(
  categoryId: string,
  input: CreateKnowledgeSectionInput
): Promise<KnowledgeAdminTreeNode> {
  return await apiRequest<KnowledgeAdminTreeNode>(
    `${knowledgeBaseUrl}/admin/categories/${encodePathSegment(categoryId)}/sections`,
    {
      method: 'POST',
      ...jsonRequest(input),
    }
  );
}

export async function updateKnowledgeSection(
  sectionId: string,
  input: UpdateKnowledgeSectionInput
): Promise<KnowledgeAdminTreeNode> {
  return await apiRequest<KnowledgeAdminTreeNode>(
    `${knowledgeBaseUrl}/admin/sections/${encodePathSegment(sectionId)}`,
    {
      method: 'PATCH',
      ...jsonRequest(input),
    }
  );
}

export async function deleteKnowledgeSection(sectionId: string): Promise<{
  deleted: true;
  sectionId: string;
  deletedPageCount: number;
  deletedChunkCount: number;
}> {
  return await apiRequest<{
    deleted: true;
    sectionId: string;
    deletedPageCount: number;
    deletedChunkCount: number;
  }>(`${knowledgeBaseUrl}/admin/sections/${encodePathSegment(sectionId)}`, { method: 'DELETE' });
}

export async function createKnowledgePage(
  input: CreateKnowledgePageInput
): Promise<KnowledgeAdminPage> {
  return normalizeAdminPage(
    await apiRequest<KnowledgeAdminPage>(`${knowledgeBaseUrl}/admin/pages`, {
      method: 'POST',
      ...jsonRequest(input),
    })
  );
}

export async function getKnowledgePage(pageId: string): Promise<KnowledgeAdminPage> {
  return normalizeAdminPage(
    await apiRequest<KnowledgeAdminPage>(
      `${knowledgeBaseUrl}/admin/pages/${encodePathSegment(pageId)}`
    )
  );
}

export async function getKnowledgeSource(sourceRef: string): Promise<KnowledgeSource> {
  const params = new URLSearchParams();
  params.set('sourceRef', sourceRef);

  return normalizeKnowledgeSource(
    await apiRequest<KnowledgeSource>(`${knowledgeBaseUrl}/source?${params.toString()}`)
  );
}

export async function saveKnowledgePage(
  pageId: string,
  input: SaveKnowledgePageInput
): Promise<KnowledgeAdminPage> {
  return normalizeAdminPage(
    await apiRequest<KnowledgeAdminPage>(
      `${knowledgeBaseUrl}/admin/pages/${encodePathSegment(pageId)}`,
      {
        method: 'PATCH',
        ...jsonRequest(input),
      }
    )
  );
}

export async function acknowledgeKnowledgePageContentQuality(
  pageId: string,
  input: AcknowledgeKnowledgePageContentQualityInput
): Promise<{ page: KnowledgeAdminPage }> {
  const response = await apiRequest<{ page: KnowledgeAdminPage }>(
    `${knowledgeBaseUrl}/admin/pages/${encodePathSegment(pageId)}/content-quality-acknowledgements`,
    {
      method: 'POST',
      ...jsonRequest(input),
    }
  );
  return { ...response, page: normalizeAdminPage(response.page) };
}

export async function deleteKnowledgePage(pageId: string): Promise<{
  deleted: true;
  pageId: string;
  deletedChunkCount: number;
}> {
  return await apiRequest<{ deleted: true; pageId: string; deletedChunkCount: number }>(
    `${knowledgeBaseUrl}/admin/pages/${encodePathSegment(pageId)}`,
    { method: 'DELETE' }
  );
}

export async function syncKnowledgePage(
  pageId: string
): Promise<{ page: KnowledgeAdminPage; syncedChunkCount: number }> {
  const response = await apiRequest<{ page: KnowledgeAdminPage; syncedChunkCount: number }>(
    `${knowledgeBaseUrl}/admin/pages/${encodePathSegment(pageId)}/sync`,
    { method: 'POST' }
  );
  return { ...response, page: normalizeAdminPage(response.page) };
}

export async function reindexKnowledgePage(
  pageId: string
): Promise<{ page: KnowledgeAdminPage; replacedChunkCount: number }> {
  const response = await apiRequest<{ page: KnowledgeAdminPage; replacedChunkCount: number }>(
    `${knowledgeBaseUrl}/admin/pages/${encodePathSegment(pageId)}/reindex`,
    { method: 'POST' }
  );
  return { ...response, page: normalizeAdminPage(response.page) };
}

export async function syncAdminKnowledgeBase(
  input: {
    mode?: 'changed' | 'all';
  } = {}
): Promise<AdminKnowledgeBaseSyncResult> {
  return await apiRequest<AdminKnowledgeBaseSyncResult>(`${knowledgeBaseUrl}/admin/sync`, {
    method: 'POST',
    ...jsonRequest(input),
  });
}
