import { err, ok, type Result } from '@fa/common-core';

import type { AnswerGapCandidate } from '../../domain/models/answerGapCandidate.js';
import type {
  AnswerGapCandidateRepository,
  AnswerGapCandidateRepositoryError,
} from '../../domain/repositories/answerGapCandidateRepository.js';

function cloneAnswerGapCandidate(candidate: AnswerGapCandidate): AnswerGapCandidate {
  return {
    ...candidate,
    missingInformation: [...candidate.missingInformation],
    requester: { ...candidate.requester },
    conversation: {
      ...candidate.conversation,
      contextWindow: candidate.conversation.contextWindow.map((message) => ({ ...message })),
    },
    coverageProbe: { ...candidate.coverageProbe },
  };
}

export class MemoryAnswerGapCandidateRepository implements AnswerGapCandidateRepository {
  readonly candidates = new Map<string, AnswerGapCandidate>();

  getById(
    id: string
  ): Promise<Result<AnswerGapCandidate | null, AnswerGapCandidateRepositoryError>> {
    const candidate = this.candidates.get(id);
    return Promise.resolve(ok(candidate === undefined ? null : cloneAnswerGapCandidate(candidate)));
  }

  create(
    candidate: AnswerGapCandidate
  ): Promise<Result<AnswerGapCandidate, AnswerGapCandidateRepositoryError>> {
    if (this.candidates.has(candidate.id)) {
      return Promise.resolve(
        err({
          code: 'CONFLICT',
          message: `Answer Gap Candidate ${candidate.id} exists`,
        })
      );
    }

    this.candidates.set(candidate.id, cloneAnswerGapCandidate(candidate));
    return Promise.resolve(ok(cloneAnswerGapCandidate(candidate)));
  }

  update(
    candidate: AnswerGapCandidate
  ): Promise<Result<AnswerGapCandidate, AnswerGapCandidateRepositoryError>> {
    if (!this.candidates.has(candidate.id)) {
      return Promise.resolve(
        err({
          code: 'NOT_FOUND',
          message: `Answer Gap Candidate ${candidate.id} not found`,
        })
      );
    }

    this.candidates.set(candidate.id, cloneAnswerGapCandidate(candidate));
    return Promise.resolve(ok(cloneAnswerGapCandidate(candidate)));
  }
}
