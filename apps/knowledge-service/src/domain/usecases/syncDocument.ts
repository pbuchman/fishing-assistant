import { err, getErrorMessage, ok, type Clock, type Result } from '@fa/common-core';
import type { EmbeddingResponse, LlmEmbeddingProvider } from '@fa/llm-contract';

import { chunkMarkdown } from '../chunking/markdown.js';
import type { KnowledgePage, KnowledgePageChunk } from '../models/knowledge.js';
import { validateKnowledgePage } from '../models/knowledgeValidation.js';
import type {
  KnowledgePageChunkRepository,
  KnowledgePageRepository,
  KnowledgeRepositoryError,
} from '../repositories/knowledgeRepositories.js';

export type KnowledgeSyncError =
  | KnowledgeRepositoryError
  | { code: 'EMBEDDING_FAILED' | 'CHUNKING_FAILED' | 'INVALID_REQUEST'; message: string };

export interface EmbeddingConfig {
  provider: string;
  model: string;
  dimensions: number;
}

export interface SyncDocumentDeps {
  pageRepository: KnowledgePageRepository;
  pageChunkRepository: KnowledgePageChunkRepository;
  embeddingProvider: LlmEmbeddingProvider;
  embeddingConfig: EmbeddingConfig;
  clock: Clock;
  generateId: () => string;
}

export interface SyncKnowledgePageInput {
  pageId: string;
  actorAdminUserId: string;
  promptType:
    | 'knowledge-page-sync-embedding'
    | 'knowledge-page-reindex-embedding'
    | 'knowledge-full-sync-embedding';
}

const manualAccessChunkingMessage = 'Manual knowledge page access cannot produce active chunks';

export const pageEmbeddingInputBuilder = {
  version: '1.0.0',
} as const;

function failedPage(page: KnowledgePage, message: string, now: string): KnowledgePage {
  return {
    ...page,
    indexingStatus: 'failed',
    syncStatus: 'failed',
    indexingError: message,
    syncError: message,
    updatedAt: now,
  };
}

function failedPageWithInvalidAccess(
  page: KnowledgePage,
  message: string,
  now: string
): KnowledgePage {
  return {
    ...failedPage(page, message, now),
    accessSyncStatus: 'invalid',
    accessSyncError: message,
    chunkCount: 0,
  };
}

function buildPageChunks(input: {
  page: KnowledgePage;
  chunkDrafts: ReturnType<typeof chunkMarkdown>['chunks'];
  embeddings: number[][];
  provider: string;
  model: string;
  dimensions: number;
  createdAt: string;
  generateId: () => string;
}): Result<KnowledgePageChunk[], KnowledgeSyncError> {
  if (input.embeddings.length !== input.chunkDrafts.length) {
    return err({
      code: 'EMBEDDING_FAILED',
      message: 'Embedding result count did not match chunk count.',
    });
  }

  const pageAccess = input.page.access.effective;
  if (pageAccess.gate === 'manual') {
    return err({
      code: 'INVALID_REQUEST',
      message: manualAccessChunkingMessage,
    });
  }

  const chunks: KnowledgePageChunk[] = [];
  for (const chunk of input.chunkDrafts) {
    const embedding = input.embeddings[chunk.index];
    if (embedding === undefined) {
      return err({
        code: 'EMBEDDING_FAILED',
        message: 'Embedding result count did not match chunk count.',
      });
    }

    chunks.push({
      id: input.generateId(),
      status: 'active',
      pageId: input.page.id,
      nodeId: input.page.nodeId,
      categoryId: input.page.categoryId,
      sectionId: input.page.sectionId,
      title: input.page.title,
      path: [...input.page.pathTitles],
      headingPath: chunk.headingPath.length > 0 ? chunk.headingPath : [input.page.title],
      index: chunk.index,
      text: chunk.text,
      searchableText: chunk.searchableText,
      markdownContentHash: input.page.markdownContentHash,
      access: {
        gate: pageAccess.gate,
        requiredLevel: pageAccess.requiredLevel,
      },
      accessRevision: pageAccess.accessRevision,
      accessSyncStatus: 'current',
      source: {
        type: input.page.source.type,
        url: input.page.source.url,
        label: input.page.source.label,
      },
      embedding,
      embeddingModel: input.model,
      embeddingProvider: input.provider,
      embeddingDimensions: input.dimensions as 2048,
      createdAt: input.createdAt,
      deletedAt: null,
      createdByJobId: null,
      accessRefreshedAt: input.createdAt,
      accessRefreshJobId: null,
    });
  }

  return ok(chunks);
}

export function embeddingResponseMismatchMessage(
  requested: EmbeddingConfig,
  received: EmbeddingConfig
): string | null {
  if (
    requested.provider === received.provider &&
    requested.model === received.model &&
    requested.dimensions === received.dimensions
  ) {
    return null;
  }

  return `Embedding provider response mismatch: requested ${requested.provider} ${requested.model} with ${String(
    requested.dimensions
  )} dimensions, received ${received.provider} ${received.model} with ${String(
    received.dimensions
  )} dimensions.`;
}

function responseEmbeddingConfig(response: EmbeddingResponse): EmbeddingConfig {
  return {
    provider: response.provider,
    model: response.model,
    dimensions: response.dimensions,
  };
}

async function persistPageFailure(
  deps: SyncDocumentDeps,
  page: KnowledgePage,
  message: string
): Promise<Result<KnowledgePage, KnowledgeSyncError>> {
  const updated = failedPage(page, message, deps.clock.now().toISOString());
  const result = await deps.pageRepository.update(updated);
  if (!result.ok) {
    return result;
  }

  return ok(result.value);
}

async function claimPageSyncState(
  deps: SyncDocumentDeps,
  page: KnowledgePage
): Promise<Result<KnowledgePage, KnowledgeSyncError>> {
  return await deps.pageChunkRepository.claimPageSync({
    page,
    deletedAt: deps.clock.now().toISOString(),
  });
}

export async function syncKnowledgePage(
  deps: SyncDocumentDeps,
  input: SyncKnowledgePageInput
): Promise<Result<KnowledgePage, KnowledgeSyncError>> {
  if (typeof input.actorAdminUserId !== 'string' || input.actorAdminUserId.trim().length === 0) {
    return err({
      code: 'INVALID_REQUEST',
      message: 'actorAdminUserId is required for knowledge page sync embedding attribution',
    });
  }

  const pageResult = await deps.pageRepository.getById(input.pageId);
  if (!pageResult.ok) {
    return pageResult;
  }

  const page = pageResult.value;
  if (page === null || page.status === 'deleted') {
    return err({
      code: 'NOT_FOUND',
      message: `Knowledge page ${input.pageId} not found`,
    });
  }

  const pageValidation = validateKnowledgePage(page);
  if (!pageValidation.ok) {
    const failureResult = await claimPageSyncState(
      deps,
      failedPageWithInvalidAccess(
        page,
        pageValidation.error.message,
        deps.clock.now().toISOString()
      )
    );
    if (!failureResult.ok) {
      return failureResult;
    }
    return failureResult;
  }

  if (page.access.effective.gate === 'manual') {
    const failureResult = await claimPageSyncState(
      deps,
      failedPageWithInvalidAccess(page, manualAccessChunkingMessage, deps.clock.now().toISOString())
    );
    if (!failureResult.ok) {
      return failureResult;
    }
    return err({
      code: 'INVALID_REQUEST',
      message: manualAccessChunkingMessage,
    });
  }

  let chunked: ReturnType<typeof chunkMarkdown>;
  try {
    chunked = chunkMarkdown({
      markdown: page.markdown,
      title: page.title,
    });
  } catch (error) {
    return await persistPageFailure(deps, page, getErrorMessage(error));
  }

  const syncingPage: KnowledgePage = {
    ...page,
    normalizedMarkdown: chunked.normalizedMarkdown,
    indexingStatus: 'pending',
    syncStatus: 'syncing',
    indexingError: null,
    syncError: null,
    updatedAt: deps.clock.now().toISOString(),
  };
  const syncingResult = await claimPageSyncState(deps, syncingPage);
  if (!syncingResult.ok) {
    return syncingResult;
  }

  try {
    const embeddingResponse = await deps.embeddingProvider.embed({
      input: chunked.chunks.map((chunk) => chunk.searchableText),
      model: deps.embeddingConfig.model,
      dimensions: deps.embeddingConfig.dimensions,
      owner: { type: 'user', id: input.actorAdminUserId },
      promptType: input.promptType,
      promptVersion: pageEmbeddingInputBuilder.version,
      correlation: { knowledgePageId: page.id, requestId: page.id },
    });
    const mismatchMessage = embeddingResponseMismatchMessage(
      deps.embeddingConfig,
      responseEmbeddingConfig(embeddingResponse)
    );
    if (mismatchMessage !== null) {
      const failureResult = await persistPageFailure(deps, syncingResult.value, mismatchMessage);
      if (!failureResult.ok) {
        return failureResult;
      }

      return err({ code: 'EMBEDDING_FAILED', message: mismatchMessage });
    }

    const builtChunks = buildPageChunks({
      page: syncingResult.value,
      chunkDrafts: chunked.chunks,
      embeddings: embeddingResponse.vectors,
      provider: embeddingResponse.provider,
      model: embeddingResponse.model,
      dimensions: embeddingResponse.dimensions,
      createdAt: deps.clock.now().toISOString(),
      generateId: deps.generateId,
    });
    if (!builtChunks.ok) {
      if (builtChunks.error.code === 'INVALID_REQUEST') {
        return builtChunks;
      }
      return await persistPageFailure(deps, syncingResult.value, builtChunks.error.message);
    }

    const replaceResult = await deps.pageChunkRepository.replaceActiveForPage({
      pageId: page.id,
      chunks: builtChunks.value,
      deletedAt: deps.clock.now().toISOString(),
    });
    if (!replaceResult.ok) {
      await persistPageFailure(deps, syncingResult.value, replaceResult.error.message);
      return replaceResult;
    }

    const readyPage: KnowledgePage = {
      ...syncingResult.value,
      normalizedMarkdown: chunked.normalizedMarkdown,
      indexingStatus: 'ready',
      syncStatus: 'synced',
      accessSyncStatus: 'current',
      indexingError: null,
      syncError: null,
      chunkCount: builtChunks.value.length,
      updatedAt: deps.clock.now().toISOString(),
    };
    const readyResult = await deps.pageRepository.update(readyPage);
    if (!readyResult.ok) {
      await persistPageFailure(deps, syncingResult.value, readyResult.error.message);
    }

    return readyResult;
  } catch (error) {
    return await persistPageFailure(deps, syncingResult.value, getErrorMessage(error));
  }
}

export function syncDocument(
  deps: SyncDocumentDeps,
  input: SyncKnowledgePageInput
): Promise<Result<KnowledgePage, KnowledgeSyncError>> {
  return syncKnowledgePage(deps, input);
}
