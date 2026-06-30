import { err, ok, type Result } from '@fa/common-core';

import { encodeAnswerGapCursor, type AnswerGap } from '../../domain/models/answerGap.js';
import type {
  AnswerGapListQuery,
  AnswerGapRepository,
} from '../../domain/repositories/answerGapRepository.js';
import type { KnowledgeRepositoryError } from '../../domain/repositories/knowledgeRepositories.js';

function cloneAnswerGap(gap: AnswerGap): AnswerGap {
  return {
    ...gap,
    missingInformation: [...gap.missingInformation],
    requester: { ...gap.requester },
    ...(gap.origin === undefined ? {} : { origin: { ...gap.origin } }),
    ...(gap.consent === undefined ? {} : { consent: { ...gap.consent } }),
    conversation: {
      ...gap.conversation,
      contextWindow: gap.conversation.contextWindow.map((message) => ({ ...message })),
    },
    coverageProbe: { ...gap.coverageProbe },
    processing: { ...gap.processing },
  };
}

function compareAnswerGaps(left: AnswerGap, right: AnswerGap): number {
  return right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id);
}

function isAfterCursor(gap: AnswerGap, query: AnswerGapListQuery): boolean {
  if (query.cursor === undefined) {
    return true;
  }
  if (gap.createdAt < query.cursor.createdAt) {
    return true;
  }
  return gap.createdAt === query.cursor.createdAt && gap.id > query.cursor.id;
}

export class MemoryAnswerGapRepository implements AnswerGapRepository {
  readonly gaps = new Map<string, AnswerGap>();

  getById(id: string): Promise<Result<AnswerGap | null, KnowledgeRepositoryError>> {
    const gap = this.gaps.get(id);
    return Promise.resolve(ok(gap === undefined ? null : cloneAnswerGap(gap)));
  }

  create(gap: AnswerGap): Promise<Result<AnswerGap, KnowledgeRepositoryError>> {
    if (this.gaps.has(gap.id)) {
      return Promise.resolve(err({ code: 'CONFLICT', message: `Answer Gap ${gap.id} exists` }));
    }
    this.gaps.set(gap.id, cloneAnswerGap(gap));
    return Promise.resolve(ok(cloneAnswerGap(gap)));
  }

  update(gap: AnswerGap): Promise<Result<AnswerGap, KnowledgeRepositoryError>> {
    if (!this.gaps.has(gap.id)) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: `Answer Gap ${gap.id} not found` }));
    }
    this.gaps.set(gap.id, cloneAnswerGap(gap));
    return Promise.resolve(ok(cloneAnswerGap(gap)));
  }

  list(
    query: AnswerGapListQuery
  ): Promise<
    Result<
      { gaps: AnswerGap[]; nextCursor: string | null; totalCount: number },
      KnowledgeRepositoryError
    >
  > {
    const filtered = [...this.gaps.values()]
      .filter((gap) => query.status === 'all' || gap.status === 'needs_answer')
      .sort(compareAnswerGaps);
    const matching = filtered.filter((gap) => isAfterCursor(gap, query));
    const page = matching.slice(0, query.limit);
    const hasMore = matching.length > query.limit;
    const lastGap = page.at(-1);
    return Promise.resolve(
      ok({
        gaps: page.map(cloneAnswerGap),
        totalCount: filtered.length,
        nextCursor:
          hasMore && lastGap !== undefined
            ? encodeAnswerGapCursor({
                filter: query.status,
                createdAt: lastGap.createdAt,
                id: lastGap.id,
              })
            : null,
      })
    );
  }
}
