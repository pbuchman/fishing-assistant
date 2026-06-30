import { createHash } from 'node:crypto';

import { err, getErrorMessage, ok, type ErrorCode, type Result } from '@fa/common-core';
import { validateInternalAuth } from '@fa/common-http';
import type { UserServiceClient } from '@fa/internal-clients';
import {
  knowledgeAdminAnswerGapDoneBodySchema,
  knowledgeAdminAnswerGapListQuerystringSchema,
  knowledgeAdminAnswerGapParamsSchema,
  knowledgeAdminCategoryParamsSchema,
  knowledgeAdminCreateCategoryBodySchema,
  knowledgeAdminCreatePageBodySchema,
  knowledgeAdminCreateSectionBodySchema,
  knowledgeAdminContentQualityAcknowledgementBodySchema,
  knowledgeAdminAccessRefreshJobParamsSchema,
  knowledgeAdminAccessRefreshRetryBodySchema,
  knowledgeAdminPageParamsSchema,
  knowledgeAdminSectionParamsSchema,
  knowledgeAdminSyncBodySchema,
  knowledgeAdminTreeQuerystringSchema,
  knowledgeAdminUpdateCategoryAccessBodySchema,
  knowledgeAdminUpdateCategoryBodySchema,
  knowledgeAdminUpdatePageBodySchema,
  knowledgeAdminUpdateSectionBodySchema,
  knowledgeInternalAnswerGapConsentWithdrawalBodySchema,
  knowledgeInternalCreateAnswerGapBodySchema,
  knowledgeMaintenanceBodySchema,
  knowledgeSourceQuerystringSchema,
  knowledgeRetrieveRequestBodySchema,
  strictEmptyObjectSchema,
  type AnswerGap,
  type CreateAnswerGapRequest,
  type InternalUserIdentitySummary,
  type ListAnswerGapsResponse,
} from '@fa/http-contracts';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  HookHandlerDoneFunction,
} from 'fastify';

import { normalizeMarkdown } from '../domain/chunking/markdown.js';
import {
  type EffectiveKnowledgeAccess,
  type EffectiveKnowledgeAccessGate,
  type KnowledgeAccess,
  type KnowledgeAccessSyncStatus,
  type KnowledgeIndexingStatus,
  type KnowledgeNode,
  type KnowledgeNodeType,
  type KnowledgePage,
  type KnowledgePageSyncStatus,
  type KnowledgeRecordStatus,
  type KnowledgeSourceType,
  type KnowledgeAccessRefreshJob,
} from '../domain/models/knowledge.js';
import {
  validateKnowledgeAccess,
  validateKnowledgePage,
} from '../domain/models/knowledgeValidation.js';
import {
  accessRefreshLogEvents,
  enqueueCategoryAccessRefreshJob,
} from '../domain/usecases/accessRefresh.js';
import {
  createAnswerGap,
  listAnswerGaps,
  markAnswerGapDone,
  withdrawAnswerGapConsent,
} from '../domain/usecases/answerGaps.js';
import {
  retrieveKnowledge,
  type Citation,
  type RetrieveRequest,
} from '../domain/usecases/retrieveKnowledge.js';
import { openKnowledgeSource } from '../domain/usecases/openKnowledgeSource.js';
import { syncDocument } from '../domain/usecases/syncDocument.js';
import { syncKnowledgeBase } from '../domain/usecases/syncKnowledgeBase.js';
import { getServices } from '../services.js';
import {
  requireApprovedAdminAuth,
  requireApprovedRequestAuthorization,
  requireApprovedUserAuth,
} from './authPreHandlers.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toHttpErrorCode(code: string): ErrorCode {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 'INVALID_REQUEST';
    case 'INVALID_REQUEST':
    case 'NOT_FOUND':
    case 'CONFLICT':
    case 'INTERNAL_ERROR':
    case 'DOWNSTREAM_ERROR':
    case 'FORBIDDEN':
      return code;
    case 'EMBEDDING_FAILED':
      return 'DOWNSTREAM_ERROR';
    case 'CHUNKING_FAILED':
      return 'UNPROCESSABLE_ENTITY';
    default:
      return 'INTERNAL_ERROR';
  }
}

function logAuthFailure(
  request: FastifyRequest,
  input: {
    event: string;
    routeGroup: 'knowledge-internal' | 'knowledge-testing';
    reason: string;
    statusCode: number;
  }
): void {
  request.log.warn(
    {
      event: input.event,
      routeGroup: input.routeGroup,
      method: request.method,
      statusCode: input.statusCode,
      reason: input.reason,
      requestId: request.id,
    },
    'Auth failure'
  );
}

async function validateInternalAuthPreValidation(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | undefined> {
  const authResult = validateInternalAuth(request.headers, process.env);
  if (!authResult.valid) {
    logAuthFailure(request, {
      event: 'auth_internal_failed',
      routeGroup: 'knowledge-internal',
      reason: 'invalid_internal_auth',
      statusCode: 401,
    });
    return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
  }

  return undefined;
}

function defaultMissingBodyToEmptyObject(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction
): void {
  if (request.body === undefined) {
    request.body = {};
  }
  done();
}

function parseCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((citation) => {
    if (
      !isRecord(citation) ||
      typeof citation['sourceId'] !== 'string' ||
      typeof citation['usedFor'] !== 'string'
    ) {
      return [];
    }

    return [{ sourceId: citation['sourceId'], usedFor: citation['usedFor'] }];
  });
}

function parseRetrieveRequest(body: unknown): RetrieveRequest | null {
  if (!isRecord(body) || typeof body['query'] !== 'string') {
    return null;
  }

  const authorization = body['authorization'];
  if (
    !isRecord(authorization) ||
    typeof authorization['userId'] !== 'string' ||
    (authorization['role'] !== 'user' && authorization['role'] !== 'admin') ||
    authorization['status'] !== 'approved' ||
    !Number.isInteger(authorization['effectiveLevel']) ||
    Number(authorization['effectiveLevel']) < 1 ||
    Number(authorization['effectiveLevel']) > 10
  ) {
    return null;
  }

  const context = body['conversationContext'];
  const latestMessages =
    isRecord(context) && Array.isArray(context['latestMessages']) ? context['latestMessages'] : [];
  const usageCorrelation = body['usageCorrelation'];
  const options = body['options'];

  return {
    authorization: {
      userId: authorization['userId'],
      role: authorization['role'],
      status: 'approved',
      effectiveLevel: authorization[
        'effectiveLevel'
      ] as RetrieveRequest['authorization']['effectiveLevel'],
    },
    query: body['query'],
    ...(isRecord(usageCorrelation)
      ? {
          usageCorrelation: {
            ...(typeof usageCorrelation['conversationId'] === 'string'
              ? { conversationId: usageCorrelation['conversationId'] }
              : {}),
            ...(typeof usageCorrelation['messageId'] === 'string'
              ? { messageId: usageCorrelation['messageId'] }
              : {}),
            ...(typeof usageCorrelation['requestId'] === 'string'
              ? { requestId: usageCorrelation['requestId'] }
              : {}),
          },
        }
      : {}),
    conversationContext: {
      latestMessages: latestMessages.flatMap((message) => {
        if (
          !isRecord(message) ||
          (message['role'] !== 'user' && message['role'] !== 'assistant') ||
          typeof message['content'] !== 'string'
        ) {
          return [];
        }

        const citations = parseCitations(message['citations']);
        return [
          {
            role: message['role'],
            content: message['content'],
            ...(citations.length > 0 ? { citations } : {}),
          },
        ];
      }),
    },
    ...(isRecord(options)
      ? {
          options: {
            topK: typeof options['topK'] === 'number' ? options['topK'] : undefined,
            expandParentDocuments:
              typeof options['expandParentDocuments'] === 'boolean'
                ? options['expandParentDocuments']
                : undefined,
          },
        }
      : {}),
  };
}

function parseCreateAnswerGapRequest(body: unknown): CreateAnswerGapRequest | null {
  if (
    !isRecord(body) ||
    typeof body['source'] !== 'string' ||
    typeof body['question'] !== 'string' ||
    !Array.isArray(body['missingInformation']) ||
    !isRecord(body['requester']) ||
    !isRecord(body['conversation']) ||
    !isRecord(body['coverageProbe']) ||
    typeof body['coverageKind'] !== 'string' ||
    !isRecord(body['consent'])
  ) {
    return null;
  }

  return body as unknown as CreateAnswerGapRequest;
}

function parseAnswerGapConsentWithdrawalBody(body: unknown): { candidateId: string } | null {
  if (
    !isRecord(body) ||
    typeof body['candidateId'] !== 'string' ||
    body['candidateId'].length === 0
  ) {
    return null;
  }

  return { candidateId: body['candidateId'] };
}

function parseAnswerGapListQuery(
  query: unknown
): { status?: 'needs_answer' | 'all'; limit?: number; cursor?: string } | null {
  if (!isRecord(query)) {
    return {};
  }

  const status = query['status'];
  if (status !== undefined && status !== 'needs_answer' && status !== 'all') {
    return null;
  }

  const limitValue = query['limit'];
  const parsedLimit =
    typeof limitValue === 'number'
      ? limitValue
      : typeof limitValue === 'string' && limitValue.trim().length > 0
        ? Number(limitValue)
        : undefined;
  if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
    return null;
  }

  const cursor = query['cursor'];
  if (cursor !== undefined && typeof cursor !== 'string') {
    return null;
  }

  return {
    ...(status === undefined ? {} : { status }),
    ...(parsedLimit === undefined ? {} : { limit: parsedLimit }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function parseAnswerGapParams(params: unknown): AdminAnswerGapParams | null {
  if (!isRecord(params) || typeof params['gapId'] !== 'string' || params['gapId'].length === 0) {
    return null;
  }
  return { gapId: params['gapId'] };
}

function answerGapNeedsRequesterIdentity(gap: AnswerGap): boolean {
  if (gap.consent !== undefined && !gap.consent.includeContact) {
    return false;
  }

  return (
    gap.requester.firstName === undefined ||
    gap.requester.firstName === null ||
    gap.requester.lastName === undefined ||
    gap.requester.lastName === null
  );
}

async function enrichAnswerGapRequesterIdentities(input: {
  response: ListAnswerGapsResponse;
  userServiceClient: UserServiceClient;
  request: FastifyRequest;
}): Promise<ListAnswerGapsResponse> {
  const userIds = [
    ...new Set(
      input.response.gaps
        .filter(answerGapNeedsRequesterIdentity)
        .map((gap) => gap.requester.userId)
        .filter((userId) => userId.length > 0)
    ),
  ];
  if (userIds.length === 0) {
    return input.response;
  }

  try {
    const lookup = await input.userServiceClient.lookupUserIdentities({ userIds });
    const identityById = new Map(
      lookup.users.map((identity): [string, InternalUserIdentitySummary] => [identity.id, identity])
    );
    return {
      ...input.response,
      gaps: input.response.gaps.map((gap) => {
        if (!answerGapNeedsRequesterIdentity(gap)) {
          return gap;
        }

        const identity = identityById.get(gap.requester.userId);
        if (identity === undefined) {
          return gap;
        }

        return {
          ...gap,
          requester: {
            ...gap.requester,
            email:
              gap.requester.email !== null && gap.requester.email.length > 0
                ? gap.requester.email
                : identity.email,
            firstName: gap.requester.firstName ?? identity.firstName,
            lastName: gap.requester.lastName ?? identity.lastName,
          },
        };
      }),
    };
  } catch (error) {
    input.request.log.warn(
      {
        event: 'answer_gap_requester_identity_lookup_failed',
        error: getErrorMessage(error),
        requestId: input.request.id,
      },
      'Answer gap requester identity lookup failed'
    );
    return input.response;
  }
}

interface AdminCategoryParams {
  categoryId: string;
}

interface AdminSectionParams {
  sectionId: string;
}

interface AdminPageParams {
  pageId: string;
}

interface AdminAccessRefreshJobParams {
  jobId: string;
}

interface AdminAnswerGapParams {
  gapId: string;
}

interface OpenKnowledgeSourceQuery {
  sourceRef: string;
}

interface KnowledgeAccessInput {
  gate: EffectiveKnowledgeAccessGate;
  requiredLevel: number | null;
}

interface AdminSourceInput {
  type: KnowledgeSourceType;
  url?: string | null;
  label?: string | null;
}

interface AdminRelationsInput {
  relatedTo?: string[];
  linksTo?: string[];
  supersedes?: string[];
}

interface CreateCategoryBody {
  title: string;
  access: KnowledgeAccessInput;
  sortIndex?: number;
}

interface UpdateCategoryBody {
  title?: string;
  sortIndex?: number;
}

interface UpdateCategoryAccessBody {
  access: KnowledgeAccessInput;
  expectedAccessRevision?: string;
}

interface CreateSectionBody {
  title: string;
  sortIndex?: number;
}

interface UpdateSectionBody {
  title?: string;
  sortIndex?: number;
}

interface CreatePageBody {
  categoryId: string;
  sectionId?: string | null;
  title: string;
  source: AdminSourceInput;
  relations?: AdminRelationsInput;
  markdown: string;
  syncNow?: boolean;
  sortIndex?: number;
}

interface UpdatePageBody {
  title?: string;
  sectionId?: string | null;
  source?: AdminSourceInput;
  relations?: AdminRelationsInput;
  markdown?: string;
  syncNow?: boolean;
  sortIndex?: number;
}

interface ContentQualityAcknowledgementBody {
  issueType: 'adjacent_duplicate_content';
  markdownContentHash: string;
  issueFingerprints: string[];
  reason?: string | null;
}

interface AdminTreeNodeResponse {
  id: string;
  type: KnowledgeNodeType;
  title: string;
  slug: string;
  parentId: string | null;
  categoryId: string | null;
  sectionId: string | null;
  pageId: string | null;
  depth: KnowledgeNode['depth'];
  sortIndex: number;
  path: string[];
  status: KnowledgeRecordStatus;
  categoryAccess: KnowledgeAccessInput | null;
  accessRevision: string | null;
  pageSummary: {
    effectiveAccess: ReturnType<typeof toAuthoringAccessResponse>;
    indexingStatus: KnowledgeIndexingStatus;
    syncStatus: KnowledgePageSyncStatus;
    accessSyncStatus: KnowledgeAccessSyncStatus;
    source: {
      type: KnowledgeSourceType;
      url: string | null;
      label: string | null;
      importer: KnowledgePage['source']['importer'];
    };
    chunkCount: number;
    updatedAt: string;
  } | null;
  children: AdminTreeNodeResponse[];
}

interface RouteKnowledgeError {
  code: string;
  message: string;
}

function trimmedTitle(value: string): string {
  return value.trim();
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'untitled';
}

function markdownContentHash(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex');
}

function accessRevision(value: string): string {
  return `access-${value}`;
}

function accessInput(value: KnowledgeAccessInput): EffectiveKnowledgeAccess {
  return {
    gate: value.gate,
    requiredLevel: value.gate === 'level' ? value.requiredLevel : null,
  };
}

function validateEffectiveAccessInput(
  value: KnowledgeAccessInput,
  label: string
): Result<EffectiveKnowledgeAccess, RouteKnowledgeError> {
  const validation = validateKnowledgeAccess(value, label, { allowManual: false });
  if (!validation.ok) {
    return validation;
  }
  return ok(accessInput(value));
}

function sourceInput(value: AdminSourceInput): KnowledgePage['source'] {
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  if (value.type !== 'external' || url.length === 0) {
    throw new Error('Source URL is required');
  }

  return {
    type: 'external',
    url,
    label:
      typeof value.label === 'string' && value.label.trim().length > 0
        ? value.label.trim()
        : 'Source',
    importer: null,
  };
}

function relationArray(value: string[] | undefined): string[] {
  return Array.isArray(value) ? value.filter((entry) => entry.trim().length > 0) : [];
}

function relationsInput(value: AdminRelationsInput | undefined): KnowledgePage['relations'] {
  return {
    relatedTo: relationArray(value?.relatedTo),
    linksTo: relationArray(value?.linksTo),
    supersedes: relationArray(value?.supersedes),
  };
}

function preserveImporterForUnchangedSource(
  existing: KnowledgePage['source'],
  next: KnowledgePage['source']
): KnowledgePage['source'] {
  if (
    existing.importer !== null &&
    existing.type === next.type &&
    existing.url === next.url &&
    existing.label === next.label
  ) {
    return { ...next, importer: existing.importer };
  }

  return next;
}

function toAuthoringAccessResponse(access: KnowledgeAccess & { accessRevision: string }): {
  gate: KnowledgeAccess['gate'];
  requiredLevel: number | null;
  accessRevision: string;
  retrievalReady: boolean;
} {
  return {
    gate: access.gate,
    requiredLevel: access.requiredLevel,
    accessRevision: access.accessRevision,
    retrievalReady: access.gate !== 'manual',
  };
}

function toPageResponse(page: KnowledgePage): Record<string, unknown> {
  return {
    id: page.id,
    nodeId: page.nodeId,
    title: page.title,
    categoryId: page.categoryId,
    sectionId: page.sectionId,
    hierarchy: page.hierarchy,
    path: page.pathTitles,
    source: {
      type: page.source.type,
      url: page.source.url,
      label: page.source.label,
      importer: page.source.importer,
    },
    access: {
      effective: toAuthoringAccessResponse(page.access.effective),
      inheritedFromCategoryId: page.access.inheritedFromCategoryId,
      overridePresent: page.access.override !== null,
    },
    relations: page.relations,
    markdown: page.markdown,
    markdownContentHash: page.markdownContentHash,
    contentQualityAcknowledgements: page.contentQualityAcknowledgements ?? [],
    indexingStatus: page.indexingStatus,
    syncStatus: page.syncStatus,
    accessSyncStatus: page.accessSyncStatus,
    indexingError: page.indexingError,
    syncError: page.syncError,
    accessSyncError: page.accessSyncError,
    chunkCount: page.chunkCount,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    deletedAt: page.deletedAt,
  };
}

function toAccessRefreshJobResponse(job: KnowledgeAccessRefreshJob): Record<string, unknown> {
  return {
    id: job.id,
    status: job.status,
    kind: job.kind,
    target: job.target,
    requestedAccessRevision: job.requestedAccessRevision,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    nextRunAt: job.nextRunAt,
    lastErrorCode: job.lastError?.code ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function toTreeNodeResponse(
  node: KnowledgeNode,
  children: AdminTreeNodeResponse[],
  page: KnowledgePage | undefined
): AdminTreeNodeResponse {
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    slug: node.slug,
    parentId: node.parentId,
    categoryId: node.categoryId,
    sectionId: node.sectionId,
    pageId: node.pageId,
    depth: node.depth,
    sortIndex: node.sortIndex,
    path: node.pathTitles,
    status: node.status,
    categoryAccess:
      node.categoryAccess === null
        ? null
        : {
            gate: node.categoryAccess.gate,
            requiredLevel: node.categoryAccess.requiredLevel,
          },
    accessRevision: node.categoryAccess?.accessRevision ?? null,
    pageSummary:
      page === undefined
        ? null
        : {
            effectiveAccess: toAuthoringAccessResponse(page.access.effective),
            indexingStatus: page.indexingStatus,
            syncStatus: page.syncStatus,
            accessSyncStatus: page.accessSyncStatus,
            source: {
              type: page.source.type,
              url: page.source.url,
              label: page.source.label,
              importer: page.source.importer,
            },
            chunkCount: page.chunkCount,
            updatedAt: page.updatedAt,
          },
    children,
  };
}

function buildTree(
  nodes: KnowledgeNode[],
  pageById: ReadonlyMap<string, KnowledgePage>
): AdminTreeNodeResponse {
  const byParent = new Map<string | null, KnowledgeNode[]>();
  for (const node of nodes) {
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort(
      (left, right) => left.sortIndex - right.sortIndex || left.title.localeCompare(right.title)
    );
  }

  const visit = (node: KnowledgeNode): AdminTreeNodeResponse => {
    const children = (byParent.get(node.id) ?? []).map(visit);
    return toTreeNodeResponse(
      node,
      children,
      node.pageId === null ? undefined : pageById.get(node.pageId)
    );
  };

  const root = nodes.find((node) => node.id === 'root');
  if (root === undefined) {
    throw new Error('Knowledge root was not initialized');
  }
  return visit(root);
}

function rootNode(now: string): KnowledgeNode {
  return {
    id: 'root',
    type: 'root',
    status: 'active',
    title: 'Knowledge Base',
    slug: 'knowledge-base',
    sortIndex: 0,
    parentId: null,
    categoryId: null,
    sectionId: null,
    pageId: null,
    depth: 0,
    pathIds: ['root'],
    pathTitles: ['Knowledge Base'],
    categoryAccess: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdByUserId: null,
    updatedByUserId: null,
    deletedByUserId: null,
  };
}

async function ensureKnowledgeRoot(): Promise<Result<KnowledgeNode, RouteKnowledgeError>> {
  const services = getServices();
  const existing = await services.nodeRepository.getById('root');
  if (!existing.ok) {
    return existing;
  }
  if (existing.value !== null && existing.value.status === 'active') {
    return ok(existing.value);
  }

  const now = services.clock.now().toISOString();
  const created = await services.nodeRepository.create(rootNode(now));
  if (!created.ok && created.error.code === 'CONFLICT') {
    const afterConflict = await services.nodeRepository.getById('root');
    if (
      afterConflict.ok &&
      afterConflict.value !== null &&
      afterConflict.value.status === 'active'
    ) {
      return ok(afterConflict.value);
    }
  }
  return created;
}

function notFound(message: string): Result<never, RouteKnowledgeError> {
  return err({ code: 'NOT_FOUND', message });
}

async function activeNode(
  nodeId: string,
  expectedType: KnowledgeNodeType
): Promise<Result<KnowledgeNode, RouteKnowledgeError>> {
  const services = getServices();
  const nodeResult = await services.nodeRepository.getById(nodeId);
  if (!nodeResult.ok) {
    return nodeResult;
  }
  if (
    nodeResult.value === null ||
    nodeResult.value.status === 'deleted' ||
    nodeResult.value.type !== expectedType
  ) {
    return notFound(`Knowledge ${expectedType} ${nodeId} not found`);
  }
  return ok(nodeResult.value);
}

function markPageRequiresResync(
  page: KnowledgePage,
  now: string,
  actorUserId: string
): KnowledgePage {
  return {
    ...page,
    indexingStatus: 'pending',
    syncStatus: 'sync_required',
    accessSyncStatus: 'stale',
    indexingError: null,
    syncError: null,
    accessSyncError: null,
    chunkCount: 0,
    updatedAt: now,
    updatedByUserId: actorUserId,
  };
}

async function invalidateActivePageChunks(
  pageIds: readonly string[],
  deletedAt: string,
  logger?: Pick<FastifyRequest['log'], 'warn'>
): Promise<Result<void, RouteKnowledgeError>> {
  const services = getServices();
  for (const pageId of pageIds) {
    const deleted = await services.pageChunkRepository.softDeleteForPage({ pageId, deletedAt });
    if (!deleted.ok) {
      return deleted;
    }
  }
  if (pageIds.length > 0) {
    logger?.warn(
      { event: accessRefreshLogEvents.chunkMarkedStale, pageCount: pageIds.length },
      'Knowledge access chunks marked stale'
    );
  }

  return ok(undefined);
}

async function cascadeCategoryDescendantPaths(input: {
  category: KnowledgeNode;
  now: string;
  actorUserId: string;
  logger?: Pick<FastifyRequest['log'], 'warn'>;
}): Promise<Result<void, RouteKnowledgeError>> {
  const services = getServices();
  const nodes = await services.nodeRepository.listActive();
  if (!nodes.ok) {
    return nodes;
  }

  const pages = await services.pageRepository.listActiveByCategory({
    categoryId: input.category.id,
  });
  if (!pages.ok) {
    return pages;
  }

  const chunkInvalidation = await invalidateActivePageChunks(
    pages.value.map((page) => page.id),
    input.now,
    input.logger
  );
  if (!chunkInvalidation.ok) {
    return chunkInvalidation;
  }

  for (const node of nodes.value) {
    if (node.id === input.category.id || node.categoryId !== input.category.id) {
      continue;
    }

    const updated = await services.nodeRepository.update({
      ...node,
      pathTitles: node.pathTitles.map((title, index) =>
        index === 1 ? input.category.title : title
      ),
      updatedAt: input.now,
      updatedByUserId: input.actorUserId,
    });
    if (!updated.ok) {
      return updated;
    }
  }

  for (const page of pages.value) {
    const nextPage = markPageRequiresResync(
      {
        ...page,
        hierarchy:
          page.hierarchy.section === undefined
            ? { category: input.category.title }
            : { category: input.category.title, section: page.hierarchy.section },
        pathTitles: page.pathTitles.map((title, index) =>
          index === 1 ? input.category.title : title
        ),
      },
      input.now,
      input.actorUserId
    );
    const updated = await services.pageRepository.update(nextPage);
    if (!updated.ok) {
      return updated;
    }
  }

  return ok(undefined);
}

async function cascadeSectionDescendantPaths(input: {
  section: KnowledgeNode;
  now: string;
  actorUserId: string;
  logger?: Pick<FastifyRequest['log'], 'warn'>;
}): Promise<Result<void, RouteKnowledgeError>> {
  const services = getServices();
  const nodes = await services.nodeRepository.listActive();
  if (!nodes.ok) {
    return nodes;
  }

  const pages = await services.pageRepository.listActiveBySection({ sectionId: input.section.id });
  if (!pages.ok) {
    return pages;
  }

  const chunkInvalidation = await invalidateActivePageChunks(
    pages.value.map((page) => page.id),
    input.now,
    input.logger
  );
  if (!chunkInvalidation.ok) {
    return chunkInvalidation;
  }

  for (const node of nodes.value) {
    if (node.id === input.section.id || node.sectionId !== input.section.id) {
      continue;
    }

    const updated = await services.nodeRepository.update({
      ...node,
      pathTitles: node.pathTitles.map((title, index) =>
        index === 2 ? input.section.title : title
      ),
      updatedAt: input.now,
      updatedByUserId: input.actorUserId,
    });
    if (!updated.ok) {
      return updated;
    }
  }

  for (const page of pages.value) {
    const nextPage = markPageRequiresResync(
      {
        ...page,
        hierarchy: { category: page.hierarchy.category, section: input.section.title },
        pathTitles: page.pathTitles.map((title, index) =>
          index === 2 ? input.section.title : title
        ),
      },
      input.now,
      input.actorUserId
    );
    const updated = await services.pageRepository.update(nextPage);
    if (!updated.ok) {
      return updated;
    }
  }

  return ok(undefined);
}

async function softDeleteNodeAfterFailedPageCreate(input: {
  node: KnowledgeNode;
  deletedAt: string;
  actorUserId: string;
}): Promise<Result<void, RouteKnowledgeError>> {
  const services = getServices();
  const cleanup = await services.nodeRepository.update({
    ...input.node,
    status: 'deleted',
    updatedAt: input.deletedAt,
    deletedAt: input.deletedAt,
    updatedByUserId: input.actorUserId,
    deletedByUserId: input.actorUserId,
  });
  if (!cleanup.ok) {
    return cleanup;
  }

  return ok(undefined);
}

function withOptional<T extends Record<string, unknown>>(
  target: T,
  condition: boolean,
  patch: Record<string, unknown>
): T {
  return condition ? { ...target, ...patch } : target;
}

function createCategoryNode(input: {
  id: string;
  title: string;
  access: EffectiveKnowledgeAccess;
  sortIndex: number;
  accessRevision: string;
  actorUserId: string;
  now: string;
}): KnowledgeNode {
  return {
    id: input.id,
    type: 'category',
    status: 'active',
    title: input.title,
    slug: slugify(input.title),
    sortIndex: input.sortIndex,
    parentId: 'root',
    categoryId: input.id,
    sectionId: null,
    pageId: null,
    depth: 1,
    pathIds: ['root', input.id],
    pathTitles: ['Knowledge Base', input.title],
    categoryAccess: { ...input.access, accessRevision: input.accessRevision },
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
    createdByUserId: input.actorUserId,
    updatedByUserId: input.actorUserId,
    deletedByUserId: null,
  };
}

function createSectionNode(input: {
  id: string;
  category: KnowledgeNode;
  title: string;
  sortIndex: number;
  actorUserId: string;
  now: string;
}): KnowledgeNode {
  return {
    id: input.id,
    type: 'section',
    status: 'active',
    title: input.title,
    slug: slugify(input.title),
    sortIndex: input.sortIndex,
    parentId: input.category.id,
    categoryId: input.category.id,
    sectionId: input.id,
    pageId: null,
    depth: 2,
    pathIds: ['root', input.category.id, input.id],
    pathTitles: ['Knowledge Base', input.category.title, input.title],
    categoryAccess: null,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
    createdByUserId: input.actorUserId,
    updatedByUserId: input.actorUserId,
    deletedByUserId: null,
  };
}

function createPageRecords(input: {
  pageId: string;
  nodeId: string;
  category: KnowledgeNode;
  section: KnowledgeNode | null;
  title: string;
  source: AdminSourceInput;
  relations: AdminRelationsInput | undefined;
  markdown: string;
  sortIndex: number;
  actorUserId: string;
  now: string;
}): Result<{ node: KnowledgeNode; page: KnowledgePage }, RouteKnowledgeError> {
  const categoryAccess = input.category.categoryAccess;
  if (categoryAccess === null) {
    return err({ code: 'VALIDATION_ERROR', message: 'Category access is required' });
  }
  const normalizedMarkdown = normalizeMarkdown(input.markdown);
  if (normalizedMarkdown.length === 0) {
    return err({ code: 'INVALID_REQUEST', message: 'markdown must not be empty' });
  }
  let source: KnowledgePage['source'];
  try {
    source = sourceInput(input.source);
  } catch (error) {
    return err({ code: 'INVALID_REQUEST', message: getErrorMessage(error) });
  }

  const pathIds =
    input.section === null
      ? ['root', input.category.id, input.nodeId]
      : ['root', input.category.id, input.section.id, input.nodeId];
  const pathTitles =
    input.section === null
      ? ['Knowledge Base', input.category.title, input.title]
      : ['Knowledge Base', input.category.title, input.section.title, input.title];
  const node: KnowledgeNode = {
    id: input.nodeId,
    type: 'page',
    status: 'active',
    title: input.title,
    slug: slugify(input.title),
    sortIndex: input.sortIndex,
    parentId: input.section === null ? input.category.id : input.section.id,
    categoryId: input.category.id,
    sectionId: input.section?.id ?? null,
    pageId: input.pageId,
    depth: input.section === null ? 2 : 3,
    pathIds,
    pathTitles,
    categoryAccess: null,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
    createdByUserId: input.actorUserId,
    updatedByUserId: input.actorUserId,
    deletedByUserId: null,
  };
  const page: KnowledgePage = {
    id: input.pageId,
    nodeId: input.nodeId,
    status: 'active',
    title: input.title,
    slug: slugify(input.title),
    categoryId: input.category.id,
    sectionId: input.section?.id ?? null,
    pathIds,
    pathTitles,
    hierarchy: withOptional({ category: input.category.title }, input.section !== null, {
      section: input.section?.title,
    }),
    source,
    access: {
      inheritedFromCategoryId: input.category.id,
      categoryAccessRevision: categoryAccess.accessRevision,
      override: null,
      effective: {
        gate: categoryAccess.gate,
        requiredLevel: categoryAccess.requiredLevel,
        accessRevision: categoryAccess.accessRevision,
      },
    },
    relations: relationsInput(input.relations),
    markdown: input.markdown,
    normalizedMarkdown,
    markdownContentHash: markdownContentHash(normalizedMarkdown),
    contentQualityAcknowledgements: [],
    indexingStatus: 'pending',
    syncStatus: 'sync_required',
    accessSyncStatus: 'current',
    indexingError: null,
    syncError: null,
    accessSyncError: null,
    chunkCount: 0,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
    createdByUserId: input.actorUserId,
    updatedByUserId: input.actorUserId,
    deletedByUserId: null,
  };

  const validation = validateKnowledgePage(page);
  if (!validation.ok) {
    return validation;
  }

  return ok({ node, page });
}

export function registerKnowledgeRoutes(app: FastifyInstance): void {
  app.post('/internal/answer-gaps', {
    preValidation: validateInternalAuthPreValidation,
    schema: {
      body: knowledgeInternalCreateAnswerGapBodySchema,
      querystring: strictEmptyObjectSchema,
    },
    handler: async (request, reply) => {
      const parsed = parseCreateAnswerGapRequest(request.body);
      if (parsed === null) {
        return await reply.fail('INVALID_REQUEST', 'Invalid answer gap request');
      }

      const services = getServices();
      const result = await createAnswerGap(
        { answerGapRepository: services.answerGapRepository, clock: services.clock },
        parsed
      );
      if (!result.ok) {
        return await reply.fail(toHttpErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok(result.value);
    },
  });

  app.post('/internal/answer-gaps/:gapId/consent-withdrawal', {
    preValidation: validateInternalAuthPreValidation,
    schema: {
      params: knowledgeAdminAnswerGapParamsSchema,
      body: knowledgeInternalAnswerGapConsentWithdrawalBodySchema,
      querystring: strictEmptyObjectSchema,
    },
    handler: async (request, reply) => {
      const params = parseAnswerGapParams(request.params);
      const parsed = parseAnswerGapConsentWithdrawalBody(request.body);
      if (params === null || parsed === null) {
        return await reply.fail('INVALID_REQUEST', 'Invalid answer gap consent withdrawal request');
      }

      const services = getServices();
      const result = await withdrawAnswerGapConsent(
        { answerGapRepository: services.answerGapRepository, clock: services.clock },
        { gapId: params.gapId, candidateId: parsed.candidateId }
      );
      if (!result.ok) {
        return await reply.fail(toHttpErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok(result.value);
    },
  });

  app.get('/admin/answer-gaps', {
    preValidation: requireApprovedAdminAuth,
    schema: {
      querystring: knowledgeAdminAnswerGapListQuerystringSchema,
    },
    handler: async (request, reply) => {
      const parsed = parseAnswerGapListQuery(request.query);
      if (parsed === null) {
        return await reply.fail('INVALID_REQUEST', 'Invalid answer gap list query');
      }

      const services = getServices();
      const result = await listAnswerGaps(
        { answerGapRepository: services.answerGapRepository },
        parsed
      );
      if (!result.ok) {
        return await reply.fail(toHttpErrorCode(result.error.code), result.error.message);
      }

      const response = await enrichAnswerGapRequesterIdentities({
        response: result.value,
        userServiceClient: services.userServiceClient,
        request,
      });

      return await reply.ok(response);
    },
  });

  app.post('/admin/answer-gaps/:gapId/done', {
    preValidation: requireApprovedAdminAuth,
    preHandler: defaultMissingBodyToEmptyObject,
    schema: {
      params: knowledgeAdminAnswerGapParamsSchema,
      body: knowledgeAdminAnswerGapDoneBodySchema,
      querystring: strictEmptyObjectSchema,
    },
    handler: async (request, reply) => {
      const params = parseAnswerGapParams(request.params);
      if (params === null) {
        return await reply.fail('INVALID_REQUEST', 'Invalid answer gap params');
      }

      const services = getServices();
      const authorization = requireApprovedRequestAuthorization(request);
      const result = await markAnswerGapDone(
        { answerGapRepository: services.answerGapRepository, clock: services.clock },
        { gapId: params.gapId, adminUserId: authorization.userId }
      );
      if (!result.ok) {
        return await reply.fail(toHttpErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok(result.value);
    },
  });

  app.get('/admin/tree', {
    preValidation: requireApprovedAdminAuth,
    schema: { querystring: knowledgeAdminTreeQuerystringSchema },
    handler: async (_request, reply) => {
      const rootResult = await ensureKnowledgeRoot();
      if (!rootResult.ok) {
        return await reply.fail(toHttpErrorCode(rootResult.error.code), rootResult.error.message);
      }

      const services = getServices();
      const nodesResult = await services.nodeRepository.listActive();
      if (!nodesResult.ok) {
        return await reply.fail(toHttpErrorCode(nodesResult.error.code), nodesResult.error.message);
      }
      const pagesResult = await services.pageRepository.listActive();
      if (!pagesResult.ok) {
        return await reply.fail(toHttpErrorCode(pagesResult.error.code), pagesResult.error.message);
      }
      const statusResult = await services.accessRefreshRepository.getAdminStatus({
        now: services.clock.now().toISOString(),
        recentFailuresLimit: 1,
      });
      if (!statusResult.ok) {
        return await reply.fail(
          toHttpErrorCode(statusResult.error.code),
          statusResult.error.message
        );
      }

      return await reply.ok({
        root: buildTree(
          nodesResult.value,
          new Map(pagesResult.value.map((page) => [page.id, page]))
        ),
        accessRefresh: {
          pendingJobs: statusResult.value.jobs.pending,
          runningJobs: statusResult.value.jobs.running,
          failedJobs: statusResult.value.jobs.failed,
          staleChunkCount: statusResult.value.chunks.stale,
          mismatchCount: statusResult.value.chunks.mismatch,
        },
      });
    },
  });

  app.get('/admin/access-refresh/status', {
    preValidation: requireApprovedAdminAuth,
    schema: { querystring: knowledgeAdminTreeQuerystringSchema },
    handler: async (_request, reply) => {
      const services = getServices();
      const result = await services.accessRefreshRepository.getAdminStatus({
        now: services.clock.now().toISOString(),
        recentFailuresLimit: 20,
      });
      if (!result.ok) {
        return await reply.fail(toHttpErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok(result.value);
    },
  });

  app.post('/admin/access-refresh/jobs/:jobId/retry', {
    preValidation: [requireApprovedAdminAuth, defaultMissingBodyToEmptyObject],
    schema: {
      body: knowledgeAdminAccessRefreshRetryBodySchema,
      params: knowledgeAdminAccessRefreshJobParamsSchema,
      querystring: knowledgeAdminTreeQuerystringSchema,
    },
    handler: async (request, reply) => {
      const { jobId } = request.params as AdminAccessRefreshJobParams;
      const services = getServices();
      const result = await services.accessRefreshRepository.retryJob({
        jobId,
        now: services.clock.now().toISOString(),
      });
      if (!result.ok) {
        return await reply.fail(toHttpErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok(toAccessRefreshJobResponse(result.value));
    },
  });

  app.post('/admin/categories', {
    preValidation: requireApprovedAdminAuth,
    schema: { body: knowledgeAdminCreateCategoryBodySchema },
    handler: async (request, reply) => {
      const rootResult = await ensureKnowledgeRoot();
      if (!rootResult.ok) {
        return await reply.fail(toHttpErrorCode(rootResult.error.code), rootResult.error.message);
      }

      const body = request.body as CreateCategoryBody;
      const accessResult = validateEffectiveAccessInput(body.access, 'category');
      if (!accessResult.ok) {
        return await reply.fail(
          toHttpErrorCode(accessResult.error.code),
          accessResult.error.message
        );
      }

      const services = getServices();
      const authorization = requireApprovedRequestAuthorization(request);
      const now = services.clock.now().toISOString();
      const categoryId = services.generateId();
      const node = createCategoryNode({
        id: categoryId,
        title: trimmedTitle(body.title),
        access: accessResult.value,
        sortIndex: body.sortIndex ?? 0,
        accessRevision: accessRevision(services.generateId()),
        actorUserId: authorization.userId,
        now,
      });
      const created = await services.nodeRepository.create(node);
      if (!created.ok) {
        return await reply.fail(toHttpErrorCode(created.error.code), created.error.message);
      }

      return await reply.ok(toTreeNodeResponse(created.value, [], undefined), 201);
    },
  });

  app.patch('/admin/categories/:categoryId', {
    preValidation: requireApprovedAdminAuth,
    schema: {
      body: knowledgeAdminUpdateCategoryBodySchema,
      params: knowledgeAdminCategoryParamsSchema,
    },
    handler: async (request, reply) => {
      const { categoryId } = request.params as AdminCategoryParams;
      const existingResult = await activeNode(categoryId, 'category');
      if (!existingResult.ok) {
        return await reply.fail(
          toHttpErrorCode(existingResult.error.code),
          existingResult.error.message
        );
      }

      const services = getServices();
      const authorization = requireApprovedRequestAuthorization(request);
      const body = request.body as UpdateCategoryBody;
      const title =
        body.title === undefined ? existingResult.value.title : trimmedTitle(body.title);
      const now = services.clock.now().toISOString();
      const next: KnowledgeNode = {
        ...existingResult.value,
        title,
        slug: slugify(title),
        sortIndex: body.sortIndex ?? existingResult.value.sortIndex,
        pathTitles: ['Knowledge Base', title],
        updatedAt: now,
        updatedByUserId: authorization.userId,
      };
      const updated = await services.nodeRepository.update(next);
      if (!updated.ok) {
        return await reply.fail(toHttpErrorCode(updated.error.code), updated.error.message);
      }

      if (title !== existingResult.value.title) {
        const cascaded = await cascadeCategoryDescendantPaths({
          category: updated.value,
          now,
          actorUserId: authorization.userId,
          logger: request.log,
        });
        if (!cascaded.ok) {
          return await reply.fail(toHttpErrorCode(cascaded.error.code), cascaded.error.message);
        }
      }

      return await reply.ok(toTreeNodeResponse(updated.value, [], undefined));
    },
  });

  app.patch('/admin/categories/:categoryId/access', {
    preValidation: requireApprovedAdminAuth,
    schema: {
      body: knowledgeAdminUpdateCategoryAccessBodySchema,
      params: knowledgeAdminCategoryParamsSchema,
      querystring: knowledgeAdminTreeQuerystringSchema,
    },
    handler: async (request, reply) => {
      const { categoryId } = request.params as AdminCategoryParams;
      const existingResult = await activeNode(categoryId, 'category');
      if (!existingResult.ok) {
        return await reply.fail(
          toHttpErrorCode(existingResult.error.code),
          existingResult.error.message
        );
      }

      const body = request.body as UpdateCategoryAccessBody;
      const accessResult = validateEffectiveAccessInput(body.access, 'category');
      if (!accessResult.ok) {
        return await reply.fail(
          toHttpErrorCode(accessResult.error.code),
          accessResult.error.message
        );
      }
      const currentAccessRevision = existingResult.value.categoryAccess?.accessRevision ?? null;
      if (
        body.expectedAccessRevision !== undefined &&
        body.expectedAccessRevision !== currentAccessRevision
      ) {
        return await reply.fail('CONFLICT', 'Category access revision does not match');
      }

      const services = getServices();
      const authorization = requireApprovedRequestAuthorization(request);
      const now = services.clock.now().toISOString();
      const pages = await services.pageRepository.listActiveByCategory({ categoryId });
      if (!pages.ok) {
        return await reply.fail(toHttpErrorCode(pages.error.code), pages.error.message);
      }
      const chunkInvalidation = await invalidateActivePageChunks(
        pages.value.map((page) => page.id),
        now,
        request.log
      );
      if (!chunkInvalidation.ok) {
        return await reply.fail(
          toHttpErrorCode(chunkInvalidation.error.code),
          chunkInvalidation.error.message
        );
      }

      const nextRevision = accessRevision(services.generateId());
      const nextCategory: KnowledgeNode = {
        ...existingResult.value,
        categoryAccess: { ...accessResult.value, accessRevision: nextRevision },
        updatedAt: now,
        updatedByUserId: authorization.userId,
      };
      const updatedCategory = await services.nodeRepository.update(nextCategory);
      if (!updatedCategory.ok) {
        return await reply.fail(
          toHttpErrorCode(updatedCategory.error.code),
          updatedCategory.error.message
        );
      }

      for (const page of pages.value) {
        const nextAccess =
          page.access.override === null
            ? {
                ...page.access,
                categoryAccessRevision: nextRevision,
                effective: { ...accessResult.value, accessRevision: nextRevision },
              }
            : {
                ...page.access,
                categoryAccessRevision: nextRevision,
              };
        const pageUpdate = await services.pageRepository.update(
          markPageRequiresResync(
            {
              ...page,
              access: nextAccess,
            },
            now,
            authorization.userId
          )
        );
        if (!pageUpdate.ok) {
          return await reply.fail(toHttpErrorCode(pageUpdate.error.code), pageUpdate.error.message);
        }
      }

      const refreshJob = await enqueueCategoryAccessRefreshJob(
        {
          accessRefreshRepository: services.accessRefreshRepository,
          clock: services.clock,
          generateId: services.generateId,
        },
        {
          categoryId,
          requestedAccessRevision: nextRevision,
          actorAdminUserId: authorization.userId,
        }
      );
      if (!refreshJob.ok) {
        return await reply.fail(toHttpErrorCode(refreshJob.error.code), refreshJob.error.message);
      }

      return await reply.ok({
        category: toTreeNodeResponse(updatedCategory.value, [], undefined),
        refreshJob: toAccessRefreshJobResponse(refreshJob.value),
      });
    },
  });

  app.delete('/admin/categories/:categoryId', {
    preValidation: [requireApprovedAdminAuth, defaultMissingBodyToEmptyObject],
    schema: {
      body: knowledgeMaintenanceBodySchema,
      params: knowledgeAdminCategoryParamsSchema,
    },
    handler: async (request, reply) => {
      const { categoryId } = request.params as AdminCategoryParams;
      const existingResult = await activeNode(categoryId, 'category');
      if (!existingResult.ok) {
        return await reply.fail(
          toHttpErrorCode(existingResult.error.code),
          existingResult.error.message
        );
      }

      const services = getServices();
      const authorization = requireApprovedRequestAuthorization(request);
      const deleted = await services.pageCascadeRepository.softDeleteSubtree({
        rootNodeId: categoryId,
        deletedAt: services.clock.now().toISOString(),
        deletedByUserId: authorization.userId,
      });
      if (!deleted.ok) {
        return await reply.fail(toHttpErrorCode(deleted.error.code), deleted.error.message);
      }

      return await reply.ok({
        deleted: true,
        categoryId,
        deletedSectionCount: deleted.value.deletedSectionCount,
        deletedPageCount: deleted.value.deletedPageCount,
        deletedChunkCount: deleted.value.deletedChunkCount,
      });
    },
  });

  app.post('/admin/categories/:categoryId/sections', {
    preValidation: requireApprovedAdminAuth,
    schema: {
      body: knowledgeAdminCreateSectionBodySchema,
      params: knowledgeAdminCategoryParamsSchema,
    },
    handler: async (request, reply) => {
      const { categoryId } = request.params as AdminCategoryParams;
      const categoryResult = await activeNode(categoryId, 'category');
      if (!categoryResult.ok) {
        return await reply.fail(
          toHttpErrorCode(categoryResult.error.code),
          categoryResult.error.message
        );
      }

      const services = getServices();
      const authorization = requireApprovedRequestAuthorization(request);
      const body = request.body as CreateSectionBody;
      const now = services.clock.now().toISOString();
      const node = createSectionNode({
        id: services.generateId(),
        category: categoryResult.value,
        title: trimmedTitle(body.title),
        sortIndex: body.sortIndex ?? 0,
        actorUserId: authorization.userId,
        now,
      });
      const created = await services.nodeRepository.create(node);
      if (!created.ok) {
        return await reply.fail(toHttpErrorCode(created.error.code), created.error.message);
      }

      return await reply.ok(toTreeNodeResponse(created.value, [], undefined), 201);
    },
  });

  app.patch('/admin/sections/:sectionId', {
    preValidation: requireApprovedAdminAuth,
    schema: {
      body: knowledgeAdminUpdateSectionBodySchema,
      params: knowledgeAdminSectionParamsSchema,
    },
    handler: async (request, reply) => {
      const { sectionId } = request.params as AdminSectionParams;
      const sectionResult = await activeNode(sectionId, 'section');
      if (!sectionResult.ok) {
        return await reply.fail(
          toHttpErrorCode(sectionResult.error.code),
          sectionResult.error.message
        );
      }

      const services = getServices();
      const authorization = requireApprovedRequestAuthorization(request);
      const body = request.body as UpdateSectionBody;
      const title = body.title === undefined ? sectionResult.value.title : trimmedTitle(body.title);
      const now = services.clock.now().toISOString();
      const next: KnowledgeNode = {
        ...sectionResult.value,
        title,
        slug: slugify(title),
        sortIndex: body.sortIndex ?? sectionResult.value.sortIndex,
        pathTitles: ['Knowledge Base', sectionResult.value.pathTitles[1] ?? '', title],
        updatedAt: now,
        updatedByUserId: authorization.userId,
      };
      const updated = await services.nodeRepository.update(next);
      if (!updated.ok) {
        return await reply.fail(toHttpErrorCode(updated.error.code), updated.error.message);
      }

      if (title !== sectionResult.value.title) {
        const cascaded = await cascadeSectionDescendantPaths({
          section: updated.value,
          now,
          actorUserId: authorization.userId,
          logger: request.log,
        });
        if (!cascaded.ok) {
          return await reply.fail(toHttpErrorCode(cascaded.error.code), cascaded.error.message);
        }
      }

      return await reply.ok(toTreeNodeResponse(updated.value, [], undefined));
    },
  });

  app.delete('/admin/sections/:sectionId', {
    preValidation: [requireApprovedAdminAuth, defaultMissingBodyToEmptyObject],
    schema: {
      body: knowledgeMaintenanceBodySchema,
      params: knowledgeAdminSectionParamsSchema,
    },
    handler: async (request, reply) => {
      const { sectionId } = request.params as AdminSectionParams;
      const sectionResult = await activeNode(sectionId, 'section');
      if (!sectionResult.ok) {
        return await reply.fail(
          toHttpErrorCode(sectionResult.error.code),
          sectionResult.error.message
        );
      }

      const services = getServices();
      const authorization = requireApprovedRequestAuthorization(request);
      const deleted = await services.pageCascadeRepository.softDeleteSubtree({
        rootNodeId: sectionId,
        deletedAt: services.clock.now().toISOString(),
        deletedByUserId: authorization.userId,
      });
      if (!deleted.ok) {
        return await reply.fail(toHttpErrorCode(deleted.error.code), deleted.error.message);
      }

      return await reply.ok({
        deleted: true,
        sectionId,
        deletedPageCount: deleted.value.deletedPageCount,
        deletedChunkCount: deleted.value.deletedChunkCount,
      });
    },
  });

  app.post('/admin/pages', {
    preValidation: requireApprovedAdminAuth,
    schema: { body: knowledgeAdminCreatePageBodySchema },
    handler: async (request, reply) => {
      const body = request.body as CreatePageBody;
      const categoryResult = await activeNode(body.categoryId, 'category');
      if (!categoryResult.ok) {
        return await reply.fail(
          toHttpErrorCode(categoryResult.error.code),
          categoryResult.error.message
        );
      }

      let section: KnowledgeNode | null = null;
      if (body.sectionId !== undefined && body.sectionId !== null) {
        const sectionResult = await activeNode(body.sectionId, 'section');
        if (!sectionResult.ok) {
          return await reply.fail(
            toHttpErrorCode(sectionResult.error.code),
            sectionResult.error.message
          );
        }
        if (sectionResult.value.categoryId !== body.categoryId) {
          return await reply.fail('INVALID_REQUEST', 'Section must belong to the target category');
        }
        section = sectionResult.value;
      }

      const services = getServices();
      const authorization = requireApprovedRequestAuthorization(request);
      const now = services.clock.now().toISOString();
      const pageId = services.generateId();
      const nodeId = services.generateId();
      const records = createPageRecords({
        pageId,
        nodeId,
        category: categoryResult.value,
        section,
        title: trimmedTitle(body.title),
        source: body.source,
        relations: body.relations,
        markdown: body.markdown,
        sortIndex: body.sortIndex ?? 0,
        actorUserId: authorization.userId,
        now,
      });
      if (!records.ok) {
        return await reply.fail(toHttpErrorCode(records.error.code), records.error.message);
      }

      const createdNode = await services.nodeRepository.create(records.value.node);
      if (!createdNode.ok) {
        return await reply.fail(toHttpErrorCode(createdNode.error.code), createdNode.error.message);
      }
      const createdPage = await services.pageRepository.create(records.value.page);
      if (!createdPage.ok) {
        const cleanup = await softDeleteNodeAfterFailedPageCreate({
          node: createdNode.value,
          deletedAt: now,
          actorUserId: authorization.userId,
        });
        if (!cleanup.ok) {
          return await reply.fail(toHttpErrorCode(cleanup.error.code), cleanup.error.message);
        }
        return await reply.fail(toHttpErrorCode(createdPage.error.code), createdPage.error.message);
      }

      return await reply.ok(toPageResponse(createdPage.value), 201);
    },
  });

  app.get('/admin/pages/:pageId', {
    preValidation: requireApprovedAdminAuth,
    schema: { params: knowledgeAdminPageParamsSchema },
    handler: async (request, reply) => {
      const { pageId } = request.params as AdminPageParams;
      const services = getServices();
      const pageResult = await services.pageRepository.getById(pageId);
      if (!pageResult.ok) {
        return await reply.fail(toHttpErrorCode(pageResult.error.code), pageResult.error.message);
      }
      if (pageResult.value === null || pageResult.value.status === 'deleted') {
        return await reply.fail('NOT_FOUND', `Knowledge page ${pageId} not found`);
      }

      return await reply.ok(toPageResponse(pageResult.value));
    },
  });

  app.patch('/admin/pages/:pageId', {
    preValidation: requireApprovedAdminAuth,
    schema: {
      body: knowledgeAdminUpdatePageBodySchema,
      params: knowledgeAdminPageParamsSchema,
    },
    handler: async (request, reply) => {
      const { pageId } = request.params as AdminPageParams;
      const services = getServices();
      const pageResult = await services.pageRepository.getById(pageId);
      if (!pageResult.ok) {
        return await reply.fail(toHttpErrorCode(pageResult.error.code), pageResult.error.message);
      }
      if (pageResult.value === null || pageResult.value.status === 'deleted') {
        return await reply.fail('NOT_FOUND', `Knowledge page ${pageId} not found`);
      }

      const body = request.body as UpdatePageBody;
      const categoryResult = await activeNode(pageResult.value.categoryId, 'category');
      if (!categoryResult.ok) {
        return await reply.fail(
          toHttpErrorCode(categoryResult.error.code),
          categoryResult.error.message
        );
      }

      let section: KnowledgeNode | null = null;
      const nextSectionId =
        body.sectionId === undefined ? pageResult.value.sectionId : body.sectionId;
      if (nextSectionId !== null) {
        const sectionResult = await activeNode(nextSectionId, 'section');
        if (!sectionResult.ok) {
          return await reply.fail(
            toHttpErrorCode(sectionResult.error.code),
            sectionResult.error.message
          );
        }
        if (sectionResult.value.categoryId !== pageResult.value.categoryId) {
          return await reply.fail('INVALID_REQUEST', 'Section must belong to the page category');
        }
        section = sectionResult.value;
      }

      const nodeResult = await services.nodeRepository.getById(pageResult.value.nodeId);
      if (!nodeResult.ok) {
        return await reply.fail(toHttpErrorCode(nodeResult.error.code), nodeResult.error.message);
      }
      if (nodeResult.value === null || nodeResult.value.status === 'deleted') {
        return await reply.fail(
          'NOT_FOUND',
          `Knowledge page node ${pageResult.value.nodeId} not found`
        );
      }

      const authorization = requireApprovedRequestAuthorization(request);
      const now = services.clock.now().toISOString();
      const title = body.title === undefined ? pageResult.value.title : trimmedTitle(body.title);
      const markdown = body.markdown ?? pageResult.value.markdown;
      const normalizedMarkdown = normalizeMarkdown(markdown);
      if (normalizedMarkdown.length === 0) {
        return await reply.fail('INVALID_REQUEST', 'markdown must not be empty');
      }
      const nextMarkdownContentHash = markdownContentHash(normalizedMarkdown);
      const markdownChanged = nextMarkdownContentHash !== pageResult.value.markdownContentHash;
      let source: KnowledgePage['source'];
      if (body.source === undefined) {
        source = pageResult.value.source;
      } else {
        try {
          source = preserveImporterForUnchangedSource(
            pageResult.value.source,
            sourceInput(body.source)
          );
        } catch (error) {
          return await reply.fail('INVALID_REQUEST', getErrorMessage(error));
        }
      }
      const pathIds =
        section === null
          ? ['root', categoryResult.value.id, nodeResult.value.id]
          : ['root', categoryResult.value.id, section.id, nodeResult.value.id];
      const pathTitles =
        section === null
          ? ['Knowledge Base', categoryResult.value.title, title]
          : ['Knowledge Base', categoryResult.value.title, section.title, title];
      const updatedNode: KnowledgeNode = {
        ...nodeResult.value,
        title,
        slug: slugify(title),
        sortIndex: body.sortIndex ?? nodeResult.value.sortIndex,
        parentId: section === null ? categoryResult.value.id : section.id,
        sectionId: section?.id ?? null,
        depth: section === null ? 2 : 3,
        pathIds,
        pathTitles,
        updatedAt: now,
        updatedByUserId: authorization.userId,
      };
      const updatedPage: KnowledgePage = markPageRequiresResync(
        {
          ...pageResult.value,
          title,
          slug: slugify(title),
          sectionId: section?.id ?? null,
          pathIds,
          pathTitles,
          hierarchy:
            section === null
              ? { category: categoryResult.value.title }
              : { category: categoryResult.value.title, section: section.title },
          source,
          relations:
            body.relations === undefined
              ? pageResult.value.relations
              : relationsInput(body.relations),
          markdown,
          normalizedMarkdown,
          markdownContentHash: nextMarkdownContentHash,
          contentQualityAcknowledgements: markdownChanged
            ? []
            : (pageResult.value.contentQualityAcknowledgements ?? []),
        },
        now,
        authorization.userId
      );

      const pageValidation = validateKnowledgePage(updatedPage);
      if (!pageValidation.ok) {
        return await reply.fail(
          toHttpErrorCode(pageValidation.error.code),
          pageValidation.error.message
        );
      }

      const chunkInvalidation = await invalidateActivePageChunks([pageId], now, request.log);
      if (!chunkInvalidation.ok) {
        return await reply.fail(
          toHttpErrorCode(chunkInvalidation.error.code),
          chunkInvalidation.error.message
        );
      }

      const nodeUpdate = await services.nodeRepository.update(updatedNode);
      if (!nodeUpdate.ok) {
        return await reply.fail(toHttpErrorCode(nodeUpdate.error.code), nodeUpdate.error.message);
      }
      const pageUpdate = await services.pageRepository.update(updatedPage);
      if (!pageUpdate.ok) {
        return await reply.fail(toHttpErrorCode(pageUpdate.error.code), pageUpdate.error.message);
      }

      return await reply.ok(toPageResponse(pageUpdate.value));
    },
  });

  app.post('/admin/pages/:pageId/content-quality-acknowledgements', {
    preValidation: requireApprovedAdminAuth,
    schema: {
      body: knowledgeAdminContentQualityAcknowledgementBodySchema,
      params: knowledgeAdminPageParamsSchema,
    },
    handler: async (request, reply) => {
      const { pageId } = request.params as AdminPageParams;
      const body = request.body as ContentQualityAcknowledgementBody;
      const services = getServices();
      const authorization = requireApprovedRequestAuthorization(request);
      const pageResult = await services.pageRepository.getById(pageId);
      if (!pageResult.ok) {
        return await reply.fail(toHttpErrorCode(pageResult.error.code), pageResult.error.message);
      }
      if (pageResult.value === null || pageResult.value.status === 'deleted') {
        return await reply.fail('NOT_FOUND', `Knowledge page ${pageId} not found`);
      }
      if (body.markdownContentHash !== pageResult.value.markdownContentHash) {
        return await reply.fail(
          'CONFLICT',
          'Knowledge page content changed before acknowledgement'
        );
      }

      const now = services.clock.now().toISOString();
      const issueFingerprints = [...new Set(body.issueFingerprints)];
      const reason =
        typeof body.reason === 'string' && body.reason.trim().length > 0
          ? body.reason.trim()
          : null;
      const updatedPage: KnowledgePage = {
        ...pageResult.value,
        contentQualityAcknowledgements: [
          {
            issueType: body.issueType,
            markdownContentHash: body.markdownContentHash,
            issueFingerprints,
            reason,
            acknowledgedAt: now,
            acknowledgedByUserId: authorization.userId,
          },
        ],
        updatedAt: now,
        updatedByUserId: authorization.userId,
      };

      const validation = validateKnowledgePage(updatedPage);
      if (!validation.ok) {
        return await reply.fail(toHttpErrorCode(validation.error.code), validation.error.message);
      }

      const pageUpdate = await services.pageRepository.update(updatedPage);
      if (!pageUpdate.ok) {
        return await reply.fail(toHttpErrorCode(pageUpdate.error.code), pageUpdate.error.message);
      }

      return await reply.ok({ page: toPageResponse(pageUpdate.value) });
    },
  });

  app.delete('/admin/pages/:pageId', {
    preValidation: [requireApprovedAdminAuth, defaultMissingBodyToEmptyObject],
    schema: {
      body: knowledgeMaintenanceBodySchema,
      params: knowledgeAdminPageParamsSchema,
    },
    handler: async (request, reply) => {
      const { pageId } = request.params as AdminPageParams;
      const services = getServices();
      const authorization = requireApprovedRequestAuthorization(request);
      const deleted = await services.pageCascadeRepository.softDeletePage({
        pageId,
        deletedAt: services.clock.now().toISOString(),
        deletedByUserId: authorization.userId,
      });
      if (!deleted.ok) {
        return await reply.fail(toHttpErrorCode(deleted.error.code), deleted.error.message);
      }

      return await reply.ok({
        deleted: true,
        pageId,
        deletedChunkCount: deleted.value.deletedChunkCount,
      });
    },
  });

  app.post('/admin/pages/:pageId/sync', {
    preValidation: [requireApprovedAdminAuth, defaultMissingBodyToEmptyObject],
    schema: {
      body: knowledgeMaintenanceBodySchema,
      params: knowledgeAdminPageParamsSchema,
    },
    handler: async (request, reply) => {
      const { pageId } = request.params as AdminPageParams;
      const services = getServices();
      const authorization = requireApprovedRequestAuthorization(request);
      const result = await syncDocument(
        {
          pageRepository: services.pageRepository,
          pageChunkRepository: services.pageChunkRepository,
          embeddingProvider: services.syncEmbeddingProvider,
          embeddingConfig: services.embeddingConfig,
          clock: services.clock,
          generateId: services.generateId,
        },
        {
          pageId,
          actorAdminUserId: authorization.userId,
          promptType: 'knowledge-page-sync-embedding',
        }
      );

      if (!result.ok) {
        return await reply.fail(toHttpErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok({
        page: toPageResponse(result.value),
        syncedChunkCount: result.value.chunkCount,
      });
    },
  });

  app.post('/admin/pages/:pageId/reindex', {
    preValidation: [requireApprovedAdminAuth, defaultMissingBodyToEmptyObject],
    schema: {
      body: knowledgeMaintenanceBodySchema,
      params: knowledgeAdminPageParamsSchema,
    },
    handler: async (request, reply) => {
      const { pageId } = request.params as AdminPageParams;
      const services = getServices();
      const authorization = requireApprovedRequestAuthorization(request);
      const result = await syncDocument(
        {
          pageRepository: services.pageRepository,
          pageChunkRepository: services.pageChunkRepository,
          embeddingProvider: services.syncEmbeddingProvider,
          embeddingConfig: services.embeddingConfig,
          clock: services.clock,
          generateId: services.generateId,
        },
        {
          pageId,
          actorAdminUserId: authorization.userId,
          promptType: 'knowledge-page-reindex-embedding',
        }
      );

      if (!result.ok) {
        return await reply.fail(toHttpErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok({
        page: toPageResponse(result.value),
        replacedChunkCount: result.value.chunkCount,
      });
    },
  });

  app.post('/admin/sync', {
    preValidation: [requireApprovedAdminAuth, defaultMissingBodyToEmptyObject],
    schema: { body: knowledgeAdminSyncBodySchema },
    handler: async (request, reply) => {
      const authorization = requireApprovedRequestAuthorization(request);
      const services = getServices();
      const body = request.body as { mode?: 'changed' | 'all' };
      const result = await syncKnowledgeBase(
        {
          pageRepository: services.pageRepository,
          pageChunkRepository: services.pageChunkRepository,
          embeddingProvider: services.syncEmbeddingProvider,
          embeddingConfig: services.embeddingConfig,
          clock: services.clock,
          generateId: services.generateId,
        },
        {
          actorAdminUserId: authorization.userId,
          ...(body.mode === undefined ? {} : { mode: body.mode }),
        }
      );

      if (!result.ok) {
        return await reply.fail(toHttpErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok({
        synced: result.value.synced,
        failed: result.value.failed,
        skipped: result.value.skipped,
        queuedAccessRefreshJobs: 0,
      });
    },
  });

  app.post('/internal/retrieve', {
    preValidation: validateInternalAuthPreValidation,
    schema: { body: knowledgeRetrieveRequestBodySchema },
    handler: async (request, reply) => {
      const parsed = parseRetrieveRequest(request.body);
      if (parsed === null) {
        return await reply.fail('INVALID_REQUEST', 'Invalid retrieve request');
      }

      const services = getServices();
      const result = await retrieveKnowledge(
        {
          pageRepository: services.pageRepository,
          pageChunkRepository: services.pageChunkRepository,
          embeddingProvider: services.queryEmbeddingProvider,
          embeddingConfig: services.embeddingConfig,
        },
        parsed
      );

      if (!result.ok) {
        return await reply.fail(toHttpErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok(result.value);
    },
  });

  app.get('/source', {
    preValidation: requireApprovedUserAuth,
    schema: { querystring: knowledgeSourceQuerystringSchema },
    handler: async (request, reply) => {
      const authorization = requireApprovedRequestAuthorization(request);
      const query = request.query as OpenKnowledgeSourceQuery;
      const services = getServices();
      const result = await openKnowledgeSource(
        {
          pageRepository: services.pageRepository,
          pageChunkRepository: services.pageChunkRepository,
        },
        {
          authorization: {
            userId: authorization.userId,
            role: authorization.role,
            status: authorization.status,
            effectiveLevel: authorization.effectiveLevel,
          },
          sourceRef: query.sourceRef,
        }
      );

      if (!result.ok) {
        return await reply.fail(toHttpErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok(result.value);
    },
  });
}

export const knowledgeRouteInternals = {
  parseRetrieveRequest,
  toHttpErrorCode,
};
