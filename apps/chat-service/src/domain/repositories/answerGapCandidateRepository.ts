import type { Result } from '@fa/common-core';

import type { AnswerGapCandidate } from '../models/answerGapCandidate.js';

export interface AnswerGapCandidateRepositoryError {
  code: 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL_ERROR';
  message: string;
}

export interface AnswerGapCandidateRepository {
  getById(
    id: string
  ): Promise<Result<AnswerGapCandidate | null, AnswerGapCandidateRepositoryError>>;
  create(
    candidate: AnswerGapCandidate
  ): Promise<Result<AnswerGapCandidate, AnswerGapCandidateRepositoryError>>;
  update(
    candidate: AnswerGapCandidate
  ): Promise<Result<AnswerGapCandidate, AnswerGapCandidateRepositoryError>>;
}
