import type { Result } from '@fa/common-core';

import type {
  KnowledgePageChunkRepository,
  KnowledgePageRepository,
  KnowledgeRepositoryError,
} from '../repositories/knowledgeRepositories.js';
import {
  syncKnowledgePage,
  type EmbeddingConfig,
  type KnowledgeSyncError,
} from './syncDocument.js';

export interface SyncKnowledgeBaseDeps {
  pageRepository: KnowledgePageRepository;
  pageChunkRepository: KnowledgePageChunkRepository;
  embeddingProvider: Parameters<typeof syncKnowledgePage>[0]['embeddingProvider'];
  embeddingConfig: EmbeddingConfig;
  clock: Parameters<typeof syncKnowledgePage>[0]['clock'];
  generateId: Parameters<typeof syncKnowledgePage>[0]['generateId'];
}

export interface SyncKnowledgePageBaseInput {
  actorAdminUserId: string;
  mode?: 'changed' | 'all';
}

export interface SyncKnowledgeBaseResult {
  synced: number;
  failed: number;
  skipped: number;
}

export async function syncKnowledgeBase(
  deps: SyncKnowledgeBaseDeps,
  input: SyncKnowledgePageBaseInput
): Promise<Result<SyncKnowledgeBaseResult, KnowledgeRepositoryError | KnowledgeSyncError>> {
  if (typeof input.actorAdminUserId !== 'string' || input.actorAdminUserId.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'actorAdminUserId is required for knowledge page sync embedding attribution',
      },
    };
  }

  const pagesResult = await deps.pageRepository.listActive();
  if (!pagesResult.ok) {
    return pagesResult;
  }

  const mode = input.mode ?? 'changed';
  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (const page of pagesResult.value) {
    if (
      mode !== 'all' &&
      page.syncStatus === 'synced' &&
      page.indexingStatus === 'ready' &&
      page.accessSyncStatus === 'current'
    ) {
      skipped += 1;
      continue;
    }

    const result = await syncKnowledgePage(deps, {
      pageId: page.id,
      actorAdminUserId: input.actorAdminUserId,
      promptType: 'knowledge-full-sync-embedding',
    });

    if (!result.ok || result.value.syncStatus === 'failed') {
      failed += 1;
      continue;
    }

    synced += 1;
  }

  return {
    ok: true,
    value: { synced, failed, skipped },
  };
}
