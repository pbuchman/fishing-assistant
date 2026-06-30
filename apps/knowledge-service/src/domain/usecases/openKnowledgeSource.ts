import { err, ok, type Result } from '@fa/common-core';
import type { RagAuthorizationContext } from '@fa/http-contracts';

import type { KnowledgeAccess, KnowledgePage, KnowledgePageChunk } from '../models/knowledge.js';
import {
  type KnowledgePageChunkRepository,
  type KnowledgePageRepository,
  type KnowledgeRepositoryError,
} from '../repositories/knowledgeRepositories.js';
import { isKnowledgePageChunkRetrievalEligible } from './accessRefresh.js';
import {
  isPublicEvidenceDigestKey,
  knowledgePageSourceRef,
  normalizeKnowledgePageSourceRef,
  publicEvidenceId,
  type KnowledgePageSourceRef,
} from './sourceRefs.js';

export interface OpenKnowledgeSourceRequest {
  authorization: RagAuthorizationContext;
  sourceRef: string;
}

export interface OpenKnowledgeSourceResponse {
  id: string;
  sourceId: string;
  title: string;
  content: string;
  updatedAt: string;
  access: {
    gate: KnowledgeAccess['gate'];
    requiredLevel: number | null;
    retrievalReady: boolean;
  };
}

export type OpenKnowledgeSourceError =
  | KnowledgeRepositoryError
  | { code: 'INVALID_REQUEST' | 'FORBIDDEN'; message: string };

export interface OpenKnowledgeSourceDeps {
  pageRepository: KnowledgePageRepository;
  pageChunkRepository: KnowledgePageChunkRepository;
}

const publicEvidenceLookupLimit = 10_000;

function isRetrievableKnowledgePageChunk(input: {
  authorization: RagAuthorizationContext;
  page: KnowledgePage;
  chunk: KnowledgePageChunk;
}): boolean {
  if (!isKnowledgePageChunkRetrievalEligible({ page: input.page, chunk: input.chunk })) {
    return false;
  }

  switch (input.chunk.access.gate) {
    case 'public':
    case 'approved':
      return true;
    case 'level':
      return input.authorization.effectiveLevel >= (input.chunk.access.requiredLevel ?? 11);
    case 'excluded':
      return false;
  }
}

function sourceResponse(page: KnowledgePage): OpenKnowledgeSourceResponse {
  return {
    id: page.id,
    sourceId: knowledgePageSourceRef(page.id),
    title: page.title,
    content: page.markdown,
    updatedAt: page.updatedAt,
    access: {
      gate: page.access.effective.gate,
      requiredLevel: page.access.effective.requiredLevel,
      retrievalReady: true,
    },
  };
}

async function openPageIfRetrievable(
  deps: OpenKnowledgeSourceDeps,
  input: {
    authorization: RagAuthorizationContext;
    page: KnowledgePage;
  }
): Promise<Result<OpenKnowledgeSourceResponse, OpenKnowledgeSourceError>> {
  const page = input.page;
  if (page.status !== 'active') {
    return err({ code: 'NOT_FOUND', message: `Knowledge page ${page.id} not found` });
  }

  const chunksResult = await deps.pageChunkRepository.listActiveForPage({ pageId: page.id });
  if (!chunksResult.ok) {
    return chunksResult;
  }

  const retrievableChunk = chunksResult.value.find((chunk) =>
    isRetrievableKnowledgePageChunk({
      authorization: input.authorization,
      page,
      chunk,
    })
  );
  if (retrievableChunk === undefined) {
    return err({
      code: 'FORBIDDEN',
      message: 'Knowledge source is not available to the current user',
    });
  }

  return ok(sourceResponse(page));
}

async function findPageByPublicEvidenceRef(
  deps: OpenKnowledgeSourceDeps,
  sourceRef: KnowledgePageSourceRef
): Promise<
  Result<{ page: KnowledgePage; chunk: KnowledgePageChunk } | null, OpenKnowledgeSourceError>
> {
  const pagesResult = await deps.pageRepository.listActive();
  if (!pagesResult.ok) {
    return pagesResult;
  }

  const pagesById = new Map(pagesResult.value.map((page) => [page.id, page]));
  const chunksResult = await deps.pageChunkRepository.listRetrievableActive({
    limit: publicEvidenceLookupLimit,
  });
  if (!chunksResult.ok) {
    return chunksResult;
  }

  for (const chunk of chunksResult.value) {
    const page = pagesById.get(chunk.pageId);
    if (page === undefined) {
      continue;
    }

    if (publicEvidenceId({ page, chunk }) === sourceRef.ref) {
      return ok({ page, chunk });
    }
  }

  return ok(null);
}

export async function openKnowledgeSource(
  deps: OpenKnowledgeSourceDeps,
  request: OpenKnowledgeSourceRequest
): Promise<Result<OpenKnowledgeSourceResponse, OpenKnowledgeSourceError>> {
  const sourceRef = normalizeKnowledgePageSourceRef(request.sourceRef);
  if (sourceRef === null) {
    return err({ code: 'INVALID_REQUEST', message: 'sourceRef must reference a knowledge page' });
  }

  const pageResult = await deps.pageRepository.getById(sourceRef.key);
  if (!pageResult.ok) {
    return pageResult;
  }

  if (pageResult.value !== null) {
    return await openPageIfRetrievable(deps, {
      authorization: request.authorization,
      page: pageResult.value,
    });
  }

  if (!isPublicEvidenceDigestKey(sourceRef.key)) {
    return err({ code: 'NOT_FOUND', message: `Knowledge page ${sourceRef.key} not found` });
  }

  const evidenceMatchResult = await findPageByPublicEvidenceRef(deps, sourceRef);
  if (!evidenceMatchResult.ok) {
    return evidenceMatchResult;
  }

  if (evidenceMatchResult.value === null) {
    return err({ code: 'NOT_FOUND', message: `Knowledge page ${sourceRef.key} not found` });
  }

  const { page, chunk } = evidenceMatchResult.value;
  if (
    !isRetrievableKnowledgePageChunk({
      authorization: request.authorization,
      page,
      chunk,
    })
  ) {
    return err({
      code: 'FORBIDDEN',
      message: 'Knowledge source is not available to the current user',
    });
  }

  return await openPageIfRetrievable(deps, {
    authorization: request.authorization,
    page,
  });
}
