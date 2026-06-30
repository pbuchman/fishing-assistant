import { err, getErrorMessage, ok, type Clock, type Result } from '@fa/common-core';
import type {
  AnswerGapCandidateSummary,
  AnswerGapContextMessage,
  AnswerGapCoverageProbe,
  AnswerGapRequesterSnapshot,
  AnswerGapSource,
  CreateAnswerGapRequest,
  KnowledgeCoverageKind,
} from '@fa/http-contracts';

import type { AnswerGapCandidate } from '../models/answerGapCandidate.js';
import type { ConversationMessage } from '../models/chat.js';
import type {
  AnswerGapCandidateRepository,
  AnswerGapCandidateRepositoryError,
} from '../repositories/answerGapCandidateRepository.js';

export interface AnswerGapCreateSink {
  create(input: CreateAnswerGapRequest, options?: { signal?: AbortSignal }): Promise<void>;
}

export interface AnswerGapConsentWithdrawalSink {
  withdrawConsent(
    input: { gapId: string; candidateId: string },
    options?: { signal?: AbortSignal }
  ): Promise<void>;
}

export interface CreatePendingAnswerGapCandidateInput {
  source: AnswerGapSource;
  question: string;
  missingInformation: string[];
  requester: AnswerGapRequesterSnapshot;
  conversation: {
    conversationId: string;
    userMessageId: string;
    assistantMessageId: string;
    contextWindow: AnswerGapContextMessage[];
  };
  coverageProbe: AnswerGapCoverageProbe;
  expiresAt?: string;
}

export interface ShareAnswerGapCandidateInput {
  candidateId: string;
  userId: string;
  requester: AnswerGapRequesterSnapshot;
  includeContext: boolean;
  includeContact: boolean;
  signal?: AbortSignal;
}

export type AnswerGapCandidateUseCaseError =
  | AnswerGapCandidateRepositoryError
  | { code: 'INVALID_REQUEST' | 'EXPIRED' | 'DOWNSTREAM_ERROR'; message: string };

export interface AnswerGapCandidateDeps {
  repository: AnswerGapCandidateRepository;
  clock: Clock;
}

export interface ShareAnswerGapCandidateDeps extends AnswerGapCandidateDeps {
  answerGapSink: AnswerGapCreateSink;
  resolveShareSnapshot(input: {
    candidate: AnswerGapCandidate;
    userId: string;
    includeContext: boolean;
  }): Promise<Result<AnswerGapShareSnapshot, AnswerGapCandidateUseCaseError>>;
}

const candidateTtlDays = 30;
const maxContextMessages = 8;
const shareableCoverageKinds = new Set<KnowledgeCoverageKind>([
  'global_no_candidate_seen',
  'unsupported_by_accessible_evidence',
]);

function plusDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function answerGapCandidateDocumentId(assistantMessageId: string): string {
  return `answer-gap-candidate-${assistantMessageId.replaceAll('/', '_')}`;
}

export function coverageKindFromProbe(input: {
  source: AnswerGapSource;
  coverageProbe: AnswerGapCoverageProbe | undefined;
}): KnowledgeCoverageKind {
  if (input.coverageProbe === undefined) {
    return 'coverage_unknown';
  }

  if (
    input.coverageProbe.classification === 'accessible_candidate_seen' &&
    input.source === 'unsupported_by_retrieved_evidence'
  ) {
    return 'unsupported_by_accessible_evidence';
  }

  switch (input.coverageProbe.classification) {
    case 'no_candidate_seen':
      return 'global_no_candidate_seen';
    case 'higher_level_candidate_seen':
      return 'restricted_by_level';
    case 'restricted_or_invalid_candidate_seen':
      return 'restricted_or_invalid_candidate_seen';
    case 'accessible_candidate_seen':
      return 'coverage_unknown';
  }
}

function isShareableCoverageKind(kind: KnowledgeCoverageKind): boolean {
  return shareableCoverageKinds.has(kind);
}

export function answerGapCandidateSummary(
  candidate: AnswerGapCandidate
): AnswerGapCandidateSummary {
  return {
    id: candidate.id,
    status: candidate.status,
    coverageKind: candidate.coverageKind,
    missingInformation: [...candidate.missingInformation],
    expiresAt: candidate.expiresAt,
  };
}

function mapRepositoryError(
  error: AnswerGapCandidateRepositoryError
): AnswerGapCandidateUseCaseError {
  return error;
}

function candidateNotFound(id: string): AnswerGapCandidateUseCaseError {
  return { code: 'NOT_FOUND', message: `Answer Gap Candidate ${id} not found` };
}

function contactRequester(
  requester: AnswerGapRequesterSnapshot,
  includeContact: boolean
): AnswerGapRequesterSnapshot {
  if (includeContact) {
    return { ...requester };
  }

  return {
    ...requester,
    email: null,
    firstName: null,
    lastName: null,
  };
}

function redactedRequester(requester: AnswerGapRequesterSnapshot): AnswerGapRequesterSnapshot {
  return {
    ...requester,
    email: null,
    firstName: null,
    lastName: null,
  };
}

function redactedCandidatePayload(candidate: AnswerGapCandidate): AnswerGapCandidate {
  return {
    ...candidate,
    question: '',
    missingInformation: [],
    requester: redactedRequester(candidate.requester),
    conversation: {
      ...candidate.conversation,
      contextWindow: [],
    },
  };
}

export interface AnswerGapShareSnapshot {
  question: string;
  contextWindow: AnswerGapContextMessage[];
}

export function answerGapShareSnapshotFromMessages(input: {
  candidate: AnswerGapCandidate;
  messages: readonly ConversationMessage[];
  includeContext: boolean;
}): Result<AnswerGapShareSnapshot, AnswerGapCandidateUseCaseError> {
  const userMessage = input.messages.find(
    (message) => message.id === input.candidate.conversation.userMessageId
  );
  if (userMessage?.role !== 'user' || userMessage.content.trim().length === 0) {
    return err({
      code: 'INVALID_REQUEST',
      message: `Answer Gap Candidate ${input.candidate.id} source question is unavailable`,
    });
  }

  if (!input.includeContext) {
    return ok({ question: userMessage.content.trim(), contextWindow: [] });
  }

  const assistantIndex = input.messages.findIndex(
    (message) => message.id === input.candidate.conversation.assistantMessageId
  );
  const contextSource =
    assistantIndex >= 0 ? input.messages.slice(0, assistantIndex) : input.messages;
  const contextWindow = contextSource
    .slice(-maxContextMessages)
    .map((message) => ({ role: message.role, content: message.content }));

  return ok({ question: userMessage.content.trim(), contextWindow });
}

function createAnswerGapRequest(input: {
  candidate: AnswerGapCandidate;
  snapshot: AnswerGapShareSnapshot;
  requester: AnswerGapRequesterSnapshot;
  now: string;
  includeContext: boolean;
  includeContact: boolean;
}): CreateAnswerGapRequest {
  return {
    source: input.candidate.source,
    question: input.snapshot.question,
    missingInformation: [...input.candidate.missingInformation],
    requester: contactRequester(input.requester, input.includeContact),
    conversation: {
      conversationId: input.candidate.conversation.conversationId,
      userMessageId: input.candidate.conversation.userMessageId,
      assistantMessageId: input.candidate.conversation.assistantMessageId,
      contextWindow: input.includeContext
        ? input.snapshot.contextWindow.map((message) => ({ ...message }))
        : [],
    },
    coverageProbe: { ...input.candidate.coverageProbe },
    coverageKind: input.candidate.coverageKind,
    consent: {
      status: 'user_shared',
      sharedAt: input.now,
      includeContext: input.includeContext,
      includeContact: input.includeContact,
      candidateId: input.candidate.id,
    },
  };
}

async function activeCandidateForUser(input: {
  repository: AnswerGapCandidateRepository;
  candidateId: string;
  userId: string;
}): Promise<Result<AnswerGapCandidate, AnswerGapCandidateUseCaseError>> {
  const existing = await input.repository.getById(input.candidateId);
  if (!existing.ok) {
    return err(mapRepositoryError(existing.error));
  }
  if (existing.value?.userId !== input.userId) {
    return err(candidateNotFound(input.candidateId));
  }
  return ok(existing.value);
}

export async function createPendingAnswerGapCandidate(
  deps: AnswerGapCandidateDeps,
  input: CreatePendingAnswerGapCandidateInput
): Promise<Result<{ candidate: AnswerGapCandidate | null }, AnswerGapCandidateUseCaseError>> {
  const missingInformation = input.missingInformation
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (missingInformation.length === 0) {
    return ok({ candidate: null });
  }

  const coverageKind = coverageKindFromProbe({
    source: input.source,
    coverageProbe: input.coverageProbe,
  });
  if (!isShareableCoverageKind(coverageKind)) {
    return ok({ candidate: null });
  }

  const now = deps.clock.now();
  const timestamp = now.toISOString();
  const id = answerGapCandidateDocumentId(input.conversation.assistantMessageId);
  const candidate: AnswerGapCandidate = {
    id,
    status: 'pending_user_consent',
    userId: input.requester.userId,
    source: input.source,
    question: '',
    missingInformation,
    requester: redactedRequester(input.requester),
    conversation: {
      ...input.conversation,
      contextWindow: [],
    },
    coverageProbe: { ...input.coverageProbe },
    coverageKind,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: input.expiresAt ?? plusDays(now, candidateTtlDays).toISOString(),
    sharedAt: null,
    declinedAt: null,
    withdrawnAt: null,
    sharedGapId: null,
  };

  const existing = await deps.repository.getById(id);
  if (!existing.ok) {
    return err(mapRepositoryError(existing.error));
  }
  if (existing.value !== null) {
    return ok({ candidate: existing.value });
  }

  const created = await deps.repository.create(candidate);
  return created.ok ? ok({ candidate: created.value }) : err(mapRepositoryError(created.error));
}

export async function shareAnswerGapCandidate(
  deps: ShareAnswerGapCandidateDeps,
  input: ShareAnswerGapCandidateInput
): Promise<
  Result<{ candidate: AnswerGapCandidate; created: boolean }, AnswerGapCandidateUseCaseError>
> {
  const candidateResult = await activeCandidateForUser({
    repository: deps.repository,
    candidateId: input.candidateId,
    userId: input.userId,
  });
  if (!candidateResult.ok) {
    return candidateResult;
  }

  const candidate = candidateResult.value;
  if (candidate.status === 'shared') {
    return ok({ candidate, created: false });
  }
  if (candidate.status !== 'pending_user_consent') {
    return err({
      code: 'INVALID_REQUEST',
      message: `Answer Gap Candidate ${candidate.id} is not pending user consent`,
    });
  }

  const now = deps.clock.now().toISOString();
  if (candidate.expiresAt <= now) {
    const expired = await deps.repository.update({
      ...redactedCandidatePayload(candidate),
      status: 'expired',
      updatedAt: now,
    });
    if (!expired.ok) {
      return err(mapRepositoryError(expired.error));
    }
    return err({
      code: 'EXPIRED',
      message: `Answer Gap Candidate ${candidate.id} has expired`,
    });
  }

  const snapshot = await deps.resolveShareSnapshot({
    candidate,
    userId: input.userId,
    includeContext: input.includeContext,
  });
  if (!snapshot.ok) {
    return snapshot;
  }

  try {
    await deps.answerGapSink.create(
      createAnswerGapRequest({
        candidate,
        snapshot: snapshot.value,
        requester: input.requester,
        now,
        includeContext: input.includeContext,
        includeContact: input.includeContact,
      }),
      {
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }
    );
  } catch (error) {
    return err({
      code: 'DOWNSTREAM_ERROR',
      message: getErrorMessage(error, 'Answer Gap sharing failed'),
    });
  }

  const shared = await deps.repository.update({
    ...redactedCandidatePayload(candidate),
    status: 'shared',
    updatedAt: now,
    sharedAt: now,
    sharedGapId: `answer-gap-${candidate.conversation.assistantMessageId.replaceAll('/', '_')}`,
  });

  return shared.ok
    ? ok({ candidate: shared.value, created: true })
    : err(mapRepositoryError(shared.error));
}

export async function declineAnswerGapCandidate(
  deps: AnswerGapCandidateDeps,
  input: { candidateId: string; userId: string }
): Promise<Result<{ candidate: AnswerGapCandidate }, AnswerGapCandidateUseCaseError>> {
  const candidateResult = await activeCandidateForUser({
    repository: deps.repository,
    candidateId: input.candidateId,
    userId: input.userId,
  });
  if (!candidateResult.ok) {
    return candidateResult;
  }

  const candidate = candidateResult.value;
  if (candidate.status === 'declined') {
    return ok({ candidate });
  }
  if (candidate.status !== 'pending_user_consent') {
    return err({
      code: 'INVALID_REQUEST',
      message: `Answer Gap Candidate ${candidate.id} is not pending user consent`,
    });
  }

  const now = deps.clock.now().toISOString();
  const declined = await deps.repository.update({
    ...redactedCandidatePayload(candidate),
    status: 'declined',
    updatedAt: now,
    declinedAt: now,
  });

  return declined.ok ? ok({ candidate: declined.value }) : err(mapRepositoryError(declined.error));
}

export async function withdrawAnswerGapCandidate(
  deps: AnswerGapCandidateDeps & { answerGapSink: AnswerGapConsentWithdrawalSink },
  input: { candidateId: string; userId: string; signal?: AbortSignal }
): Promise<Result<{ candidate: AnswerGapCandidate }, AnswerGapCandidateUseCaseError>> {
  const candidateResult = await activeCandidateForUser({
    repository: deps.repository,
    candidateId: input.candidateId,
    userId: input.userId,
  });
  if (!candidateResult.ok) {
    return candidateResult;
  }

  const candidate = candidateResult.value;
  if (candidate.status === 'withdrawn') {
    return ok({ candidate });
  }
  if (candidate.status !== 'shared') {
    return err({
      code: 'INVALID_REQUEST',
      message: `Answer Gap Candidate ${candidate.id} is not shared`,
    });
  }

  const gapId =
    candidate.sharedGapId ??
    `answer-gap-${candidate.conversation.assistantMessageId.replaceAll('/', '_')}`;
  try {
    await deps.answerGapSink.withdrawConsent(
      { gapId, candidateId: candidate.id },
      {
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }
    );
  } catch (error) {
    return err({
      code: 'DOWNSTREAM_ERROR',
      message: getErrorMessage(error, 'Answer Gap sharing withdrawal failed'),
    });
  }

  const now = deps.clock.now().toISOString();
  const withdrawn = await deps.repository.update({
    ...redactedCandidatePayload(candidate),
    status: 'withdrawn',
    updatedAt: now,
    withdrawnAt: now,
  });

  return withdrawn.ok
    ? ok({ candidate: withdrawn.value })
    : err(mapRepositoryError(withdrawn.error));
}

export const answerGapCandidateUseCaseInternals = {
  candidateSummary: answerGapCandidateSummary,
  coverageKindFromProbe,
};
