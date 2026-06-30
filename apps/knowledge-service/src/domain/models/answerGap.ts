import { Buffer } from 'node:buffer';

import { err, ok, type Result } from '@fa/common-core';
import {
  answerGapCandidateCountBucketValues,
  answerGapConsentStatusValues,
  answerGapCoverageClassificationValues,
  answerGapSourceValues,
  knowledgeCoverageKindValues,
  userLevelValues,
  type AnswerGapConsentSnapshot,
  type AnswerGapContextMessage,
  type AnswerGapConversationSnapshot,
  type AnswerGapCoverageProbe,
  type AnswerGapCursorPayload,
  type AnswerGapOrigin,
  type AnswerGapRequesterSnapshot,
  type AnswerGapSource,
  type CreateAnswerGapRequest,
  type KnowledgeCoverageKind,
} from '@fa/http-contracts';

export type {
  AnswerGap,
  AnswerGapCandidateCountBucket,
  AnswerGapContextMessage,
  AnswerGapConversationSnapshot,
  AnswerGapCoverageClassification,
  AnswerGapCoverageProbe,
  AnswerGapCursorPayload,
  AnswerGapOrigin,
  AnswerGapOriginReason,
  AnswerGapProcessingState,
  AnswerGapRequesterSnapshot,
  AnswerGapSource,
  AnswerGapStatus,
  CreateAnswerGapRequest,
  CreateAnswerGapResponse,
  ListAnswerGapsResponse,
  MarkAnswerGapDoneResponse,
} from '@fa/http-contracts';

export interface AnswerGapValidationError {
  code: 'INVALID_REQUEST';
  message: string;
}

export const maxQuestionChars = 2_000;
export const maxContextMessages = 8;
export const maxContextMessageChars = 1_200;
export const maxMissingInformationItems = 8;
export const maxMissingInformationChars = 500;

const answerGapSourceSet = new Set<AnswerGapSource>(answerGapSourceValues);
const coverageClassificationSet = new Set(answerGapCoverageClassificationValues);
const candidateCountBucketSet = new Set(answerGapCandidateCountBucketValues);
const knowledgeCoverageKindSet = new Set<KnowledgeCoverageKind>(knowledgeCoverageKindValues);
const answerGapConsentStatusSet = new Set(answerGapConsentStatusValues);
const shareableCoverageKindSet = new Set<KnowledgeCoverageKind>([
  'global_no_candidate_seen',
  'unsupported_by_accessible_evidence',
]);

function invalid(message: string): Result<never, AnswerGapValidationError> {
  return err({ code: 'INVALID_REQUEST', message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clipText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

function nonEmptyString(
  value: unknown,
  fieldName: string
): Result<string, AnswerGapValidationError> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalid(`${fieldName} is required`);
  }
  return ok(value);
}

function optionalName(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function validateRequester(
  requester: unknown
): Result<AnswerGapRequesterSnapshot, AnswerGapValidationError> {
  if (!isRecord(requester)) {
    return invalid('requester must be an object');
  }
  const role = requester['role'];
  const effectiveLevel = requester['effectiveLevel'];
  const userId = nonEmptyString(requester['userId'], 'requester.userId');
  if (!userId.ok) {
    return userId;
  }
  const emailValue = requester['email'];
  if (emailValue !== null && (typeof emailValue !== 'string' || emailValue.trim().length === 0)) {
    return invalid('requester.email is required');
  }
  if (role !== 'user' && role !== 'admin') {
    return invalid('requester.role must be user or admin');
  }
  if (typeof effectiveLevel !== 'number' || !Number.isInteger(effectiveLevel)) {
    return invalid('requester.effectiveLevel must be an integer');
  }
  if (!(userLevelValues as readonly number[]).includes(effectiveLevel)) {
    return invalid('requester.effectiveLevel must be a valid user level');
  }
  return ok({
    userId: userId.value.trim(),
    email: emailValue === null ? null : emailValue.trim(),
    firstName: optionalName(requester['firstName']),
    lastName: optionalName(requester['lastName']),
    role,
    effectiveLevel,
  });
}

function validateCoverageKind(
  coverageKind: unknown
): Result<KnowledgeCoverageKind, AnswerGapValidationError> {
  if (
    typeof coverageKind !== 'string' ||
    !knowledgeCoverageKindSet.has(coverageKind as KnowledgeCoverageKind)
  ) {
    return invalid('coverageKind is invalid');
  }

  if (!shareableCoverageKindSet.has(coverageKind as KnowledgeCoverageKind)) {
    return invalid('coverageKind is not shareable');
  }

  return ok(coverageKind as KnowledgeCoverageKind);
}

function validateConsent(
  consent: unknown
): Result<AnswerGapConsentSnapshot, AnswerGapValidationError> {
  if (!isRecord(consent)) {
    return invalid('consent must be an object');
  }

  const status = consent['status'];
  if (
    typeof status !== 'string' ||
    !answerGapConsentStatusSet.has(status as AnswerGapConsentSnapshot['status']) ||
    status !== 'user_shared'
  ) {
    return invalid('consent.status must be user_shared');
  }
  if (typeof consent['sharedAt'] !== 'string' || consent['sharedAt'].trim().length === 0) {
    return invalid('consent.sharedAt is required');
  }
  if (typeof consent['includeContext'] !== 'boolean') {
    return invalid('consent.includeContext must be a boolean');
  }
  if (typeof consent['includeContact'] !== 'boolean') {
    return invalid('consent.includeContact must be a boolean');
  }
  if (typeof consent['candidateId'] !== 'string' || consent['candidateId'].trim().length === 0) {
    return invalid('consent.candidateId is required');
  }

  return ok({
    status: 'user_shared',
    sharedAt: consent['sharedAt'].trim(),
    withdrawnAt: null,
    includeContext: consent['includeContext'],
    includeContact: consent['includeContact'],
    candidateId: consent['candidateId'].trim(),
  });
}

function redactRequester(
  requester: AnswerGapRequesterSnapshot,
  consent: AnswerGapConsentSnapshot
): AnswerGapRequesterSnapshot {
  if (consent.includeContact) {
    return requester;
  }

  return {
    userId:
      consent.candidateId === null
        ? 'anonymous-answer-gap-requester'
        : `anonymous-${consent.candidateId}`,
    email: null,
    firstName: null,
    lastName: null,
    role: 'user',
    effectiveLevel: requester.effectiveLevel,
  };
}

function redactConversation(
  conversation: AnswerGapConversationSnapshot,
  consent: AnswerGapConsentSnapshot
): AnswerGapConversationSnapshot {
  return {
    ...conversation,
    contextWindow: consent.includeContext ? conversation.contextWindow : [],
  };
}

export function answerGapOriginFromSource(source: AnswerGapSource): AnswerGapOrigin {
  return { reason: source };
}

function validateCoverageProbe(
  coverageProbe: unknown
): Result<AnswerGapCoverageProbe, AnswerGapValidationError> {
  if (!isRecord(coverageProbe)) {
    return invalid('coverageProbe must be an object');
  }
  const classification = coverageProbe['classification'];
  const minRequiredLevel = coverageProbe['minRequiredLevel'];
  const candidateCountBucket = coverageProbe['candidateCountBucket'];
  const probeVersion = coverageProbe['probeVersion'];
  if (
    typeof classification !== 'string' ||
    !coverageClassificationSet.has(classification as AnswerGapCoverageProbe['classification'])
  ) {
    return invalid('coverageProbe.classification is invalid');
  }
  if (
    minRequiredLevel !== null &&
    (typeof minRequiredLevel !== 'number' || !Number.isInteger(minRequiredLevel))
  ) {
    return invalid('coverageProbe.minRequiredLevel must be an integer or null');
  }
  if (
    typeof candidateCountBucket !== 'string' ||
    !candidateCountBucketSet.has(
      candidateCountBucket as AnswerGapCoverageProbe['candidateCountBucket']
    )
  ) {
    return invalid('coverageProbe.candidateCountBucket is invalid');
  }
  if (probeVersion !== '1.0.0') {
    return invalid('coverageProbe.probeVersion is invalid');
  }
  return ok({
    classification: classification as AnswerGapCoverageProbe['classification'],
    minRequiredLevel,
    candidateCountBucket: candidateCountBucket as AnswerGapCoverageProbe['candidateCountBucket'],
    probeVersion,
  });
}

function normalizeContextMessage(
  message: unknown,
  index: number
): Result<AnswerGapContextMessage, AnswerGapValidationError> {
  if (!isRecord(message)) {
    return invalid(`conversation.contextWindow[${String(index)}] must be an object`);
  }
  const role = message['role'];
  const content = message['content'];
  if (role !== 'user' && role !== 'assistant') {
    return invalid(`conversation.contextWindow[${String(index)}].role is invalid`);
  }
  if (typeof content !== 'string') {
    return invalid(`conversation.contextWindow[${String(index)}].content must be a string`);
  }
  return ok({
    role,
    content: clipText(content, maxContextMessageChars),
  });
}

function validateConversation(
  conversation: CreateAnswerGapRequest['conversation']
): Result<AnswerGapConversationSnapshot, AnswerGapValidationError> {
  const conversationId = nonEmptyString(conversation.conversationId, 'conversation.conversationId');
  if (!conversationId.ok) {
    return conversationId;
  }
  const userMessageId = nonEmptyString(conversation.userMessageId, 'conversation.userMessageId');
  if (!userMessageId.ok) {
    return userMessageId;
  }
  const assistantMessageId = nonEmptyString(
    conversation.assistantMessageId,
    'conversation.assistantMessageId'
  );
  if (!assistantMessageId.ok) {
    return assistantMessageId;
  }
  if (!Array.isArray(conversation.contextWindow)) {
    return invalid('conversation.contextWindow must be an array');
  }

  const contextWindow: AnswerGapContextMessage[] = [];
  const selectedMessages = conversation.contextWindow.slice(-maxContextMessages);
  for (let index = 0; index < selectedMessages.length; index += 1) {
    const message = selectedMessages[index];
    if (message === undefined) {
      continue;
    }
    const normalized = normalizeContextMessage(message, index);
    if (!normalized.ok) {
      return normalized;
    }
    contextWindow.push(normalized.value);
  }

  return ok({
    conversationId: conversationId.value.trim(),
    userMessageId: userMessageId.value.trim(),
    assistantMessageId: assistantMessageId.value.trim(),
    contextWindow,
  });
}

export function answerGapDocumentId(assistantMessageId: string): string {
  return `answer-gap-${assistantMessageId.replaceAll('/', '_')}`;
}

export function formulateAnswerGapQuestion(question: string): string {
  return `Add or adjust Knowledge Base content so FA can answer: "${question.trim()}"`;
}

export function normalizeCreateAnswerGapInput(
  input: CreateAnswerGapRequest
): Result<CreateAnswerGapRequest, AnswerGapValidationError> {
  if (!answerGapSourceSet.has(input.source)) {
    return invalid('source is invalid');
  }
  const question = nonEmptyString(input.question, 'question');
  if (!question.ok) {
    return question;
  }
  if (!Array.isArray(input.missingInformation)) {
    return invalid('missingInformation must be an array');
  }

  const requester = validateRequester(input.requester);
  if (!requester.ok) {
    return requester;
  }
  const conversation = validateConversation(input.conversation);
  if (!conversation.ok) {
    return conversation;
  }
  const coverageProbe = validateCoverageProbe(input.coverageProbe);
  if (!coverageProbe.ok) {
    return coverageProbe;
  }
  const coverageKind = validateCoverageKind(input.coverageKind);
  if (!coverageKind.ok) {
    return coverageKind;
  }
  const consent = validateConsent(input.consent);
  if (!consent.ok) {
    return consent;
  }

  const missingInformation = input.missingInformation
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, maxMissingInformationItems)
    .map((item) => clipText(item, maxMissingInformationChars));

  return ok({
    source: input.source,
    question: clipText(question.value, maxQuestionChars),
    missingInformation,
    requester: redactRequester(requester.value, consent.value),
    conversation: redactConversation(conversation.value, consent.value),
    coverageProbe: coverageProbe.value,
    coverageKind: coverageKind.value,
    consent: consent.value,
  });
}

export function encodeAnswerGapCursor(payload: AnswerGapCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeAnswerGapCursor(
  cursor: string
): Result<AnswerGapCursorPayload, AnswerGapValidationError> {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return invalid('Answer Gap cursor is invalid');
    }
    const value = parsed as Partial<AnswerGapCursorPayload>;
    if (value.filter !== 'needs_answer' && value.filter !== 'all') {
      return invalid('Answer Gap cursor is invalid');
    }
    if (typeof value.createdAt !== 'string' || typeof value.id !== 'string') {
      return invalid('Answer Gap cursor is invalid');
    }
    return ok({ filter: value.filter, createdAt: value.createdAt, id: value.id });
  } catch (_error) {
    return invalid('Answer Gap cursor is invalid');
  }
}
