import { err, ok, type Result } from '@fa/common-core';

import type {
  KnowledgeNode,
  KnowledgePage,
  KnowledgePageChunk,
} from '../../domain/models/knowledge.js';
import {
  validateKnowledgeAccess,
  validateKnowledgeNode,
  validateKnowledgePage,
  validateKnowledgePageChunks,
  validationError,
} from '../../domain/models/knowledgeValidation.js';
import type {
  KnowledgeNodeRepository,
  KnowledgePageCascadeRepository,
  KnowledgePageChunkMatch,
  KnowledgePageChunkRepository,
  KnowledgePageRepository,
  KnowledgeRetrievalChunkCandidate,
  KnowledgeRetrievalPageMetadata,
  KnowledgeRepositoryError,
} from '../../domain/repositories/knowledgeRepositories.js';

function cloneNode(node: KnowledgeNode): KnowledgeNode {
  return {
    ...node,
    pathIds: [...node.pathIds],
    pathTitles: [...node.pathTitles],
    categoryAccess: node.categoryAccess === null ? null : { ...node.categoryAccess },
  };
}

function clonePage(page: KnowledgePage): KnowledgePage {
  return {
    ...page,
    pathIds: [...page.pathIds],
    pathTitles: [...page.pathTitles],
    hierarchy: { ...page.hierarchy },
    source: {
      ...page.source,
      importer: page.source.importer === null ? null : { ...page.source.importer },
    },
    access: {
      ...page.access,
      override: page.access.override === null ? null : { ...page.access.override },
      effective: { ...page.access.effective },
    },
    relations: {
      relatedTo: [...page.relations.relatedTo],
      linksTo: [...page.relations.linksTo],
      supersedes: [...page.relations.supersedes],
    },
    contentQualityAcknowledgements: (page.contentQualityAcknowledgements ?? []).map(
      (acknowledgement) => ({
        ...acknowledgement,
        issueFingerprints: [...acknowledgement.issueFingerprints],
      })
    ),
  };
}

function cloneRetrievalPageMetadata(page: KnowledgePage): KnowledgeRetrievalPageMetadata {
  const {
    markdown: _markdown,
    normalizedMarkdown: _normalizedMarkdown,
    contentQualityAcknowledgements: _contentQualityAcknowledgements,
    ...metadata
  } = clonePage(page);
  return metadata;
}

function clonePageChunk(chunk: KnowledgePageChunk): KnowledgePageChunk {
  const access = (chunk as { access?: KnowledgePageChunk['access'] }).access;
  const source = (chunk as { source?: KnowledgePageChunk['source'] }).source;
  return {
    ...chunk,
    path: [...chunk.path],
    headingPath: [...chunk.headingPath],
    access: access === undefined ? (undefined as never) : { ...access },
    source: source === undefined ? (undefined as never) : { ...source },
    embedding: [...chunk.embedding],
  };
}

function cloneRetrievalChunkCandidate(chunk: KnowledgePageChunk): KnowledgeRetrievalChunkCandidate {
  const access = (chunk as { access?: KnowledgePageChunk['access'] }).access;
  const source = (chunk as { source?: KnowledgePageChunk['source'] }).source;
  return {
    id: chunk.id,
    status: chunk.status,
    pageId: chunk.pageId,
    nodeId: chunk.nodeId,
    categoryId: chunk.categoryId,
    sectionId: chunk.sectionId,
    title: chunk.title,
    path: [...chunk.path],
    headingPath: [...chunk.headingPath],
    index: chunk.index,
    text: chunk.text,
    searchableText: chunk.searchableText,
    markdownContentHash: chunk.markdownContentHash,
    access: access === undefined ? (undefined as never) : { ...access },
    accessRevision: chunk.accessRevision,
    accessSyncStatus: chunk.accessSyncStatus,
    source: source === undefined ? (undefined as never) : { ...source },
    createdAt: chunk.createdAt,
    deletedAt: chunk.deletedAt,
    createdByJobId: chunk.createdByJobId,
    accessRefreshedAt: chunk.accessRefreshedAt,
    accessRefreshJobId: chunk.accessRefreshJobId,
  };
}

function pageChunkNeedsAccessRefresh(
  chunk: KnowledgePageChunk,
  input: {
    access: KnowledgePageChunk['access'];
    accessRevision: string;
    accessSyncStatus: KnowledgePageChunk['accessSyncStatus'];
  }
): boolean {
  const access = (chunk as { access?: KnowledgePageChunk['access'] }).access;
  return (
    (access?.gate ?? null) !== input.access.gate ||
    (access?.requiredLevel ?? null) !== input.access.requiredLevel ||
    chunk.accessRevision !== input.accessRevision ||
    chunk.accessSyncStatus !== input.accessSyncStatus
  );
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export class MemoryKnowledgeNodeRepository implements KnowledgeNodeRepository {
  readonly nodes = new Map<string, KnowledgeNode>();

  create(node: KnowledgeNode): Promise<Result<KnowledgeNode, KnowledgeRepositoryError>> {
    const validation = validateKnowledgeNode(node);
    if (!validation.ok) {
      return Promise.resolve(validation);
    }

    if (this.nodes.has(node.id)) {
      return Promise.resolve(
        err({ code: 'CONFLICT', message: `Knowledge node ${node.id} already exists` })
      );
    }

    this.nodes.set(node.id, cloneNode(node));
    return Promise.resolve(ok(cloneNode(node)));
  }

  getById(nodeId: string): Promise<Result<KnowledgeNode | null, KnowledgeRepositoryError>> {
    const node = this.nodes.get(nodeId);
    return Promise.resolve(ok(node === undefined ? null : cloneNode(node)));
  }

  listActive(): Promise<Result<KnowledgeNode[], KnowledgeRepositoryError>> {
    return Promise.resolve(
      ok(
        [...this.nodes.values()]
          .filter((node) => node.status === 'active')
          .sort(
            (left, right) =>
              left.pathIds.length - right.pathIds.length || left.sortIndex - right.sortIndex
          )
          .map(cloneNode)
      )
    );
  }

  update(node: KnowledgeNode): Promise<Result<KnowledgeNode, KnowledgeRepositoryError>> {
    const validation = validateKnowledgeNode(node);
    if (!validation.ok) {
      return Promise.resolve(validation);
    }

    const existing = this.nodes.get(node.id);
    if (existing === undefined || existing.status === 'deleted') {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: `Knowledge node ${node.id} not found` })
      );
    }

    this.nodes.set(node.id, cloneNode(node));
    return Promise.resolve(ok(cloneNode(node)));
  }

  softDeleteSubtree(input: {
    rootNodeId: string;
    deletedAt: string;
    deletedByUserId: string;
  }): Promise<Result<KnowledgeNode[], KnowledgeRepositoryError>> {
    const root = this.nodes.get(input.rootNodeId);
    if (root === undefined || root.status === 'deleted') {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: `Knowledge node ${input.rootNodeId} not found` })
      );
    }

    const deleted: KnowledgeNode[] = [];
    for (const [id, node] of this.nodes.entries()) {
      if (node.id === root.id || node.pathIds.includes(root.id)) {
        const next = {
          ...node,
          status: 'deleted' as const,
          updatedAt: input.deletedAt,
          deletedAt: input.deletedAt,
          deletedByUserId: input.deletedByUserId,
        };
        this.nodes.set(id, next);
        deleted.push(cloneNode(next));
      }
    }

    return Promise.resolve(ok(deleted));
  }
}

export class MemoryKnowledgePageRepository implements KnowledgePageRepository {
  readonly pages = new Map<string, KnowledgePage>();

  create(page: KnowledgePage): Promise<Result<KnowledgePage, KnowledgeRepositoryError>> {
    const validation = validateKnowledgePage(page);
    if (!validation.ok) {
      return Promise.resolve(validation);
    }

    if (this.pages.has(page.id)) {
      return Promise.resolve(
        err({ code: 'CONFLICT', message: `Knowledge page ${page.id} already exists` })
      );
    }

    this.pages.set(page.id, clonePage(page));
    return Promise.resolve(ok(clonePage(page)));
  }

  getById(pageId: string): Promise<Result<KnowledgePage | null, KnowledgeRepositoryError>> {
    const page = this.pages.get(pageId);
    return Promise.resolve(ok(page === undefined ? null : clonePage(page)));
  }

  getRetrievalMetadataByIds(
    pageIds: string[]
  ): Promise<Result<Map<string, KnowledgeRetrievalPageMetadata>, KnowledgeRepositoryError>> {
    const metadataById = new Map<string, KnowledgeRetrievalPageMetadata>();
    const seenPageIds = new Set<string>();
    for (const pageId of pageIds) {
      if (seenPageIds.has(pageId)) {
        continue;
      }
      seenPageIds.add(pageId);
      const page = this.pages.get(pageId);
      if (page !== undefined) {
        metadataById.set(pageId, cloneRetrievalPageMetadata(page));
      }
    }
    return Promise.resolve(ok(metadataById));
  }

  listActive(): Promise<Result<KnowledgePage[], KnowledgeRepositoryError>> {
    return Promise.resolve(
      ok(
        [...this.pages.values()]
          .filter((page) => page.status === 'active')
          .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
          .map(clonePage)
      )
    );
  }

  recordEffectiveAccessOverride(input: {
    pageId: string;
    override: KnowledgePage['access']['override'];
    effectiveAccessRevision: string;
    updatedAt: string;
  }): Promise<Result<KnowledgePage, KnowledgeRepositoryError>> {
    const page = this.pages.get(input.pageId);
    if (page === undefined || page.status === 'deleted') {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: `Knowledge page ${input.pageId} not found` })
      );
    }
    if (input.override === null) {
      return Promise.resolve(validationError('Knowledge page access override is required'));
    }

    const validation = validateKnowledgeAccess(input.override, 'page override', {
      allowManual: true,
    });
    if (!validation.ok) {
      return Promise.resolve(validation);
    }

    const next: KnowledgePage = {
      ...clonePage(page),
      access: {
        ...page.access,
        override: { ...input.override },
        effective: {
          gate: input.override.gate,
          requiredLevel: input.override.requiredLevel,
          accessRevision: input.effectiveAccessRevision,
        },
      },
      accessSyncStatus: 'stale',
      updatedAt: input.updatedAt,
    };
    this.pages.set(next.id, clonePage(next));
    return Promise.resolve(ok(clonePage(next)));
  }

  listActiveByCategory(input: {
    categoryId: string;
  }): Promise<Result<KnowledgePage[], KnowledgeRepositoryError>> {
    return Promise.resolve(
      ok(
        [...this.pages.values()]
          .filter((page) => page.categoryId === input.categoryId && page.status === 'active')
          .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
          .map(clonePage)
      )
    );
  }

  listActiveBySection(input: {
    sectionId: string;
  }): Promise<Result<KnowledgePage[], KnowledgeRepositoryError>> {
    return Promise.resolve(
      ok(
        [...this.pages.values()]
          .filter((page) => page.sectionId === input.sectionId && page.status === 'active')
          .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
          .map(clonePage)
      )
    );
  }

  update(page: KnowledgePage): Promise<Result<KnowledgePage, KnowledgeRepositoryError>> {
    const validation = validateKnowledgePage(page);
    if (!validation.ok) {
      return Promise.resolve(validation);
    }

    const existing = this.pages.get(page.id);
    if (existing === undefined || existing.status === 'deleted') {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: `Knowledge page ${page.id} not found` })
      );
    }

    this.pages.set(page.id, clonePage(page));
    return Promise.resolve(ok(clonePage(page)));
  }

  markAccessRefreshState(input: {
    pageId: string;
    expectedAccessRevision?: string;
    accessSyncStatus: KnowledgePage['accessSyncStatus'];
    accessSyncError: string | null;
    updatedAt: string;
    updatedByUserId: string;
  }): Promise<Result<void, KnowledgeRepositoryError>> {
    const existing = this.pages.get(input.pageId);
    if (existing === undefined || existing.status === 'deleted') {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: `Knowledge page ${input.pageId} not found` })
      );
    }
    if (
      input.expectedAccessRevision !== undefined &&
      existing.access.effective.accessRevision !== input.expectedAccessRevision
    ) {
      return Promise.resolve(
        err({
          code: 'CONFLICT',
          message: 'Knowledge page access revision changed before refresh state update',
        })
      );
    }
    const next: KnowledgePage = {
      ...clonePage(existing),
      accessSyncStatus: input.accessSyncStatus,
      accessSyncError: input.accessSyncError,
      updatedAt: input.updatedAt,
      updatedByUserId: input.updatedByUserId,
    };
    this.pages.set(next.id, clonePage(next));
    return Promise.resolve(ok(undefined));
  }
}

export class MemoryKnowledgePageChunkRepository implements KnowledgePageChunkRepository {
  readonly chunks = new Map<string, KnowledgePageChunk>();

  constructor(private readonly pageRepository?: MemoryKnowledgePageRepository) {}

  getPageChunkById(input: {
    chunkId: string;
  }): Promise<Result<KnowledgePageChunk | null, KnowledgeRepositoryError>> {
    const chunk = this.chunks.get(input.chunkId);
    return Promise.resolve(ok(chunk === undefined ? null : clonePageChunk(chunk)));
  }

  claimPageSync(input: {
    page: KnowledgePage;
    deletedAt: string;
  }): Promise<Result<KnowledgePage, KnowledgeRepositoryError>> {
    if (this.pageRepository === undefined) {
      return Promise.resolve(
        err({
          code: 'INTERNAL_ERROR',
          message: 'Knowledge page repository is required for page sync claim',
        })
      );
    }

    const existing = this.pageRepository.pages.get(input.page.id);
    if (existing === undefined || existing.status === 'deleted') {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: `Knowledge page ${input.page.id} not found` })
      );
    }

    for (const [id, chunk] of this.chunks.entries()) {
      if (chunk.pageId === input.page.id && chunk.status === 'active') {
        this.chunks.set(id, { ...chunk, status: 'deleted', deletedAt: input.deletedAt });
      }
    }

    const next = clonePage(input.page);
    this.pageRepository.pages.set(next.id, clonePage(next));
    return Promise.resolve(ok(next));
  }

  replaceActiveForPage(input: {
    pageId: string;
    chunks: KnowledgePageChunk[];
    deletedAt: string;
  }): Promise<Result<void, KnowledgeRepositoryError>> {
    const validation = validateKnowledgePageChunks(input);
    if (!validation.ok) {
      return Promise.resolve(validation);
    }

    for (const [id, chunk] of this.chunks.entries()) {
      if (chunk.pageId === input.pageId && chunk.status === 'active') {
        this.chunks.set(id, { ...chunk, status: 'deleted', deletedAt: input.deletedAt });
      }
    }

    for (const chunk of input.chunks) {
      this.chunks.set(chunk.id, clonePageChunk(chunk));
    }

    return Promise.resolve(ok(undefined));
  }

  softDeleteForPage(input: {
    pageId: string;
    deletedAt: string;
  }): Promise<Result<void, KnowledgeRepositoryError>> {
    for (const [id, chunk] of this.chunks.entries()) {
      if (chunk.pageId === input.pageId && chunk.status === 'active') {
        this.chunks.set(id, { ...chunk, status: 'deleted', deletedAt: input.deletedAt });
      }
    }

    return Promise.resolve(ok(undefined));
  }

  listActiveForPage(input: {
    pageId: string;
  }): Promise<Result<KnowledgePageChunk[], KnowledgeRepositoryError>> {
    return Promise.resolve(
      ok(
        [...this.chunks.values()]
          .filter((chunk) => chunk.pageId === input.pageId && chunk.status === 'active')
          .sort((left, right) => left.index - right.index)
          .map(clonePageChunk)
      )
    );
  }

  listRetrievableActiveForPage(input: {
    pageId: string;
  }): Promise<Result<KnowledgePageChunk[], KnowledgeRepositoryError>> {
    return this.listActiveForPage(input);
  }

  listRetrievableActive(input: {
    limit: number;
  }): Promise<Result<KnowledgePageChunk[], KnowledgeRepositoryError>> {
    return Promise.resolve(
      ok(
        [...this.chunks.values()]
          .filter((chunk) => chunk.status === 'active' && chunk.accessSyncStatus === 'current')
          .sort(
            (left, right) =>
              left.path.join('\u0000').localeCompare(right.path.join('\u0000')) ||
              left.index - right.index
          )
          .slice(0, input.limit)
          .map(clonePageChunk)
      )
    );
  }

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
  > {
    const candidates = [...this.chunks.values()]
      .filter((chunk) => chunk.status === 'active' && chunk.accessSyncStatus === 'current')
      .sort((left, right) => left.pageId.localeCompare(right.pageId) || left.index - right.index);
    const scanned = candidates.slice(0, input.limit + 1);

    return Promise.resolve(
      ok({
        chunks: scanned.slice(0, input.limit).map(cloneRetrievalChunkCandidate),
        scannedCount: scanned.length,
        limitHit: candidates.length > input.limit,
      })
    );
  }

  findNearestPageChunks(input: {
    embedding: number[];
    limit: number;
  }): Promise<Result<KnowledgePageChunkMatch[], KnowledgeRepositoryError>> {
    return Promise.resolve(
      ok(
        [...this.chunks.values()]
          .filter((chunk) => chunk.status === 'active')
          .map((chunk) => ({
            ...clonePageChunk(chunk),
            vectorScore: cosineSimilarity(input.embedding, chunk.embedding),
          }))
          .sort((left, right) => right.vectorScore - left.vectorScore)
          .slice(0, input.limit)
      )
    );
  }

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
  > {
    if (input.expectedPageAccessRevision !== undefined && this.pageRepository !== undefined) {
      const page = this.pageRepository.pages.get(input.pageId);
      if (
        page?.status !== 'active' ||
        page.access.effective.accessRevision !== input.expectedPageAccessRevision
      ) {
        return Promise.resolve(
          ok({ processedChunkCount: 0, hasMore: false, revisionConflict: true })
        );
      }
    }

    const chunksToRefresh = [...this.chunks.values()]
      .filter(
        (chunk) =>
          chunk.pageId === input.pageId &&
          chunk.status === 'active' &&
          pageChunkNeedsAccessRefresh(chunk, input)
      )
      .sort((left, right) => left.index - right.index);
    const selected = chunksToRefresh.slice(0, input.limit);

    for (const chunk of selected) {
      this.chunks.set(chunk.id, {
        ...clonePageChunk(chunk),
        access: { ...input.access },
        accessRevision: input.accessRevision,
        accessSyncStatus: input.accessSyncStatus,
        accessRefreshedAt: input.accessRefreshedAt,
        accessRefreshJobId: input.accessRefreshJobId,
      });
    }

    return Promise.resolve(
      ok({
        processedChunkCount: selected.length,
        hasMore: chunksToRefresh.length > selected.length,
      })
    );
  }
}

export { MemoryKnowledgeAccessRefreshRepository } from './memoryAccessRefreshRepository.js';

export class MemoryKnowledgePageCascadeRepository implements KnowledgePageCascadeRepository {
  constructor(
    private readonly repositories: {
      nodes: MemoryKnowledgeNodeRepository;
      pages: MemoryKnowledgePageRepository;
      chunks: MemoryKnowledgePageChunkRepository;
    }
  ) {}

  softDeletePage(input: {
    pageId: string;
    deletedAt: string;
    deletedByUserId: string;
  }): Promise<
    Result<{ pageId: string; nodeId: string; deletedChunkCount: number }, KnowledgeRepositoryError>
  > {
    const page = this.repositories.pages.pages.get(input.pageId);
    if (page === undefined || page.status === 'deleted') {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: `Knowledge page ${input.pageId} not found` })
      );
    }

    const node = this.repositories.nodes.nodes.get(page.nodeId);
    if (node === undefined || node.status === 'deleted' || node.pageId !== page.id) {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: `Knowledge node ${page.nodeId} not found` })
      );
    }

    const activeChunks = [...this.repositories.chunks.chunks.values()].filter(
      (chunk) => chunk.pageId === page.id && chunk.status === 'active'
    );

    this.repositories.pages.pages.set(page.id, {
      ...clonePage(page),
      status: 'deleted',
      updatedAt: input.deletedAt,
      deletedAt: input.deletedAt,
      deletedByUserId: input.deletedByUserId,
      accessSyncStatus: 'invalid',
    });
    this.repositories.nodes.nodes.set(node.id, {
      ...cloneNode(node),
      status: 'deleted',
      updatedAt: input.deletedAt,
      deletedAt: input.deletedAt,
      deletedByUserId: input.deletedByUserId,
    });
    for (const chunk of activeChunks) {
      this.repositories.chunks.chunks.set(chunk.id, {
        ...clonePageChunk(chunk),
        status: 'deleted',
        deletedAt: input.deletedAt,
      });
    }

    return Promise.resolve(
      ok({
        pageId: page.id,
        nodeId: node.id,
        deletedChunkCount: activeChunks.length,
      })
    );
  }

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
  > {
    const root = this.repositories.nodes.nodes.get(input.rootNodeId);
    if (root === undefined || root.status === 'deleted') {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: `Knowledge node ${input.rootNodeId} not found` })
      );
    }

    const nodesToDelete = [...this.repositories.nodes.nodes.values()].filter(
      (node) => node.status === 'active' && (node.id === root.id || node.pathIds.includes(root.id))
    );
    const pageIds = new Set(
      nodesToDelete.flatMap((node) =>
        node.type === 'page' && node.pageId !== null ? [node.pageId] : []
      )
    );
    let deletedChunkCount = 0;

    for (const [pageId, page] of this.repositories.pages.pages.entries()) {
      if (!pageIds.has(pageId) || page.status !== 'active') {
        continue;
      }

      this.repositories.pages.pages.set(pageId, {
        ...clonePage(page),
        status: 'deleted',
        updatedAt: input.deletedAt,
        deletedAt: input.deletedAt,
        deletedByUserId: input.deletedByUserId,
        accessSyncStatus: 'invalid',
      });
    }

    for (const [chunkId, chunk] of this.repositories.chunks.chunks.entries()) {
      if (pageIds.has(chunk.pageId) && chunk.status === 'active') {
        this.repositories.chunks.chunks.set(chunkId, {
          ...clonePageChunk(chunk),
          status: 'deleted',
          deletedAt: input.deletedAt,
        });
        deletedChunkCount += 1;
      }
    }

    for (const node of nodesToDelete) {
      this.repositories.nodes.nodes.set(node.id, {
        ...cloneNode(node),
        status: 'deleted',
        updatedAt: input.deletedAt,
        deletedAt: input.deletedAt,
        deletedByUserId: input.deletedByUserId,
      });
    }

    return Promise.resolve(
      ok({
        rootNodeId: input.rootNodeId,
        deletedSectionCount: nodesToDelete.filter((node) => node.type === 'section').length,
        deletedPageCount: pageIds.size,
        deletedChunkCount,
      })
    );
  }
}
