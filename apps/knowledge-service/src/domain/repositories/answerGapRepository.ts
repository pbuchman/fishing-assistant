import type { Result } from '@fa/common-core';

import type {
  AnswerGap,
  AnswerGapCursorPayload,
  ListAnswerGapsResponse,
} from '../models/answerGap.js';
import type { KnowledgeRepositoryError } from './knowledgeRepositories.js';

export interface AnswerGapListQuery {
  status: 'needs_answer' | 'all';
  limit: number;
  cursor?: AnswerGapCursorPayload;
}

export type AnswerGapListResult = ListAnswerGapsResponse;

export interface AnswerGapRepository {
  getById(id: string): Promise<Result<AnswerGap | null, KnowledgeRepositoryError>>;
  create(gap: AnswerGap): Promise<Result<AnswerGap, KnowledgeRepositoryError>>;
  update(gap: AnswerGap): Promise<Result<AnswerGap, KnowledgeRepositoryError>>;
  list(query: AnswerGapListQuery): Promise<Result<AnswerGapListResult, KnowledgeRepositoryError>>;
}
