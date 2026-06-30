import { err, ok, type Clock, type Result } from '@fa/common-core';
import type {
  CreateAnswerGapRequest,
  CreateAnswerGapResponse,
  ListAnswerGapsResponse,
  MarkAnswerGapDoneResponse,
  WithdrawAnswerGapConsentResponse,
} from '@fa/http-contracts';

import {
  answerGapDocumentId,
  answerGapOriginFromSource,
  decodeAnswerGapCursor,
  formulateAnswerGapQuestion,
  normalizeCreateAnswerGapInput,
} from '../models/answerGap.js';
import type { AnswerGapRepository } from '../repositories/answerGapRepository.js';

export interface AnswerGapUseCaseError {
  code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'INTERNAL_ERROR';
  message: string;
}

export interface AnswerGapUseCaseDeps {
  answerGapRepository: AnswerGapRepository;
  clock?: Clock;
}

function mapRepositoryError(error: { code: string; message: string }): AnswerGapUseCaseError {
  if (error.code === 'NOT_FOUND') {
    return { code: 'NOT_FOUND', message: error.message };
  }
  if (error.code === 'VALIDATION_ERROR') {
    return { code: 'INVALID_REQUEST', message: error.message };
  }
  return { code: 'INTERNAL_ERROR', message: error.message };
}

function nowIso(deps: AnswerGapUseCaseDeps): string {
  return (deps.clock?.now() ?? new Date()).toISOString();
}

export async function createAnswerGap(
  deps: AnswerGapUseCaseDeps,
  input: CreateAnswerGapRequest
): Promise<Result<CreateAnswerGapResponse, AnswerGapUseCaseError>> {
  const normalized = normalizeCreateAnswerGapInput(input);
  if (!normalized.ok) {
    return normalized;
  }

  const id = answerGapDocumentId(normalized.value.conversation.assistantMessageId);
  const existing = await deps.answerGapRepository.getById(id);
  if (!existing.ok) {
    return err(mapRepositoryError(existing.error));
  }
  if (existing.value !== null) {
    return ok({ gap: existing.value, created: false });
  }

  const timestamp = nowIso(deps);
  const gap = {
    id,
    status: 'needs_answer' as const,
    source: normalized.value.source,
    origin: answerGapOriginFromSource(normalized.value.source),
    question: normalized.value.question,
    formulatedQuestion: formulateAnswerGapQuestion(normalized.value.question),
    missingInformation: normalized.value.missingInformation,
    requester: normalized.value.requester,
    conversation: normalized.value.conversation,
    coverageProbe: normalized.value.coverageProbe,
    coverageKind: normalized.value.coverageKind,
    consent: normalized.value.consent,
    processing: { similarityStatus: 'not_started' as const },
    createdAt: timestamp,
    updatedAt: timestamp,
    doneAt: null,
    doneByUserId: null,
  };

  const created = await deps.answerGapRepository.create(gap);
  if (created.ok) {
    return ok({ gap: created.value, created: true });
  }

  if (created.error.code === 'CONFLICT') {
    const conflicted = await deps.answerGapRepository.getById(id);
    if (conflicted.ok && conflicted.value !== null) {
      return ok({ gap: conflicted.value, created: false });
    }
  }

  return err(mapRepositoryError(created.error));
}

export async function listAnswerGaps(
  deps: Pick<AnswerGapUseCaseDeps, 'answerGapRepository'>,
  query: { status?: string; limit?: number; cursor?: string }
): Promise<Result<ListAnswerGapsResponse, AnswerGapUseCaseError>> {
  const status = query.status ?? 'needs_answer';
  const limit = query.limit ?? 50;
  if (status !== 'needs_answer' && status !== 'all') {
    return err({ code: 'INVALID_REQUEST', message: 'Answer Gap status filter is invalid' });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return err({ code: 'INVALID_REQUEST', message: 'Answer Gap limit must be between 1 and 100' });
  }

  const decodedCursor =
    query.cursor === undefined ? ok(undefined) : decodeAnswerGapCursor(query.cursor);
  if (!decodedCursor.ok) {
    return decodedCursor;
  }
  if (decodedCursor.value !== undefined && decodedCursor.value.filter !== status) {
    return err({
      code: 'INVALID_REQUEST',
      message: 'Answer Gap cursor filter does not match the requested filter',
    });
  }

  const result = await deps.answerGapRepository.list({
    status,
    limit,
    ...(decodedCursor.value === undefined ? {} : { cursor: decodedCursor.value }),
  });
  return result.ok ? ok(result.value) : err(mapRepositoryError(result.error));
}

export async function markAnswerGapDone(
  deps: AnswerGapUseCaseDeps,
  input: { gapId: string; adminUserId: string }
): Promise<Result<MarkAnswerGapDoneResponse, AnswerGapUseCaseError>> {
  if (input.gapId.trim().length === 0) {
    return err({ code: 'INVALID_REQUEST', message: 'gapId is required' });
  }
  if (input.adminUserId.trim().length === 0) {
    return err({ code: 'INVALID_REQUEST', message: 'adminUserId is required' });
  }

  const existing = await deps.answerGapRepository.getById(input.gapId);
  if (!existing.ok) {
    return err(mapRepositoryError(existing.error));
  }
  if (existing.value === null) {
    return err({ code: 'NOT_FOUND', message: `Answer Gap ${input.gapId} not found` });
  }
  if (existing.value.status === 'done') {
    return ok({ gap: existing.value });
  }

  const doneAt = nowIso(deps);
  const updated = await deps.answerGapRepository.update({
    ...existing.value,
    status: 'done',
    updatedAt: doneAt,
    doneAt,
    doneByUserId: input.adminUserId,
  });
  return updated.ok ? ok({ gap: updated.value }) : err(mapRepositoryError(updated.error));
}

export async function withdrawAnswerGapConsent(
  deps: AnswerGapUseCaseDeps,
  input: { gapId: string; candidateId: string }
): Promise<Result<WithdrawAnswerGapConsentResponse, AnswerGapUseCaseError>> {
  if (input.gapId.trim().length === 0) {
    return err({ code: 'INVALID_REQUEST', message: 'gapId is required' });
  }
  if (input.candidateId.trim().length === 0) {
    return err({ code: 'INVALID_REQUEST', message: 'candidateId is required' });
  }

  const existing = await deps.answerGapRepository.getById(input.gapId);
  if (!existing.ok) {
    return err(mapRepositoryError(existing.error));
  }
  if (existing.value === null) {
    return err({ code: 'NOT_FOUND', message: `Answer Gap ${input.gapId} not found` });
  }
  const existingConsent = existing.value.consent;
  if (existingConsent?.candidateId !== input.candidateId) {
    return err({ code: 'NOT_FOUND', message: `Answer Gap ${input.gapId} not found` });
  }
  if (existingConsent.status === 'user_withdrew') {
    return ok({ gap: existing.value });
  }

  const withdrawnAt = nowIso(deps);
  const updated = await deps.answerGapRepository.update({
    ...existing.value,
    requester: {
      userId: `anonymous-${input.candidateId}`,
      email: null,
      firstName: null,
      lastName: null,
      role: 'user',
      effectiveLevel: existing.value.requester.effectiveLevel,
    },
    conversation: {
      ...existing.value.conversation,
      contextWindow: [],
    },
    consent: {
      status: 'user_withdrew',
      sharedAt: existingConsent.sharedAt,
      withdrawnAt,
      includeContext: false,
      includeContact: false,
      candidateId: input.candidateId,
    },
    updatedAt: withdrawnAt,
  });

  return updated.ok ? ok({ gap: updated.value }) : err(mapRepositoryError(updated.error));
}
