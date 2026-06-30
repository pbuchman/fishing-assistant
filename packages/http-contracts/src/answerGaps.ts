export const answerGapStatusValues = ['needs_answer', 'done'] as const;

export const answerGapSourceValues = [
  'no_accessible_evidence',
  'unsupported_by_retrieved_evidence',
] as const;

export const answerGapCoverageClassificationValues = [
  'no_candidate_seen',
  'accessible_candidate_seen',
  'higher_level_candidate_seen',
  'restricted_or_invalid_candidate_seen',
] as const;

export const answerGapCandidateCountBucketValues = ['0', '1', '2-5', '6+'] as const;

export const knowledgeCoverageKindValues = [
  'global_no_candidate_seen',
  'restricted_by_level',
  'restricted_or_invalid_candidate_seen',
  'unsupported_by_accessible_evidence',
  'coverage_unknown',
] as const;

export const answerGapCandidateStatusValues = [
  'pending_user_consent',
  'shared',
  'declined',
  'expired',
  'withdrawn',
] as const;

export const answerGapConsentStatusValues = [
  'system_imported',
  'user_shared',
  'user_withdrew',
] as const;

export type AnswerGapStatus = (typeof answerGapStatusValues)[number];

export type AnswerGapSource = (typeof answerGapSourceValues)[number];

export type AnswerGapCoverageClassification =
  (typeof answerGapCoverageClassificationValues)[number];

export type AnswerGapCandidateCountBucket = (typeof answerGapCandidateCountBucketValues)[number];

export type KnowledgeCoverageKind = (typeof knowledgeCoverageKindValues)[number];

export type AnswerGapCandidateStatus = (typeof answerGapCandidateStatusValues)[number];

export type AnswerGapConsentStatus = (typeof answerGapConsentStatusValues)[number];

export type AnswerGapOriginReason = AnswerGapSource;

export interface AnswerGapOrigin {
  reason: AnswerGapOriginReason;
}

export interface AnswerGapCoverageProbe {
  classification: AnswerGapCoverageClassification;
  minRequiredLevel: number | null;
  candidateCountBucket: AnswerGapCandidateCountBucket;
  probeVersion: '1.0.0';
}

export interface AnswerGapRequesterSnapshot {
  userId: string;
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role: 'user' | 'admin';
  effectiveLevel: number;
}

export interface AnswerGapContextMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnswerGapConversationSnapshot {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  contextWindow: AnswerGapContextMessage[];
}

export interface AnswerGapProcessingState {
  similarityStatus: 'not_started';
}

export interface AnswerGapConsentSnapshot {
  status: AnswerGapConsentStatus;
  sharedAt: string | null;
  withdrawnAt?: string | null;
  includeContext: boolean;
  includeContact: boolean;
  candidateId: string | null;
}

export interface AnswerGapCandidateSummary {
  id: string;
  status: AnswerGapCandidateStatus;
  coverageKind: KnowledgeCoverageKind;
  missingInformation: string[];
  expiresAt: string;
}

export interface AnswerGap {
  id: string;
  status: AnswerGapStatus;
  source: AnswerGapSource;
  origin?: AnswerGapOrigin;
  question: string;
  formulatedQuestion: string;
  missingInformation: string[];
  requester: AnswerGapRequesterSnapshot;
  conversation: AnswerGapConversationSnapshot;
  coverageProbe: AnswerGapCoverageProbe;
  coverageKind?: KnowledgeCoverageKind;
  consent?: AnswerGapConsentSnapshot;
  processing: AnswerGapProcessingState;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  doneByUserId: string | null;
}

export interface CreateAnswerGapRequest {
  source: AnswerGapSource;
  question: string;
  missingInformation: string[];
  requester: AnswerGapRequesterSnapshot;
  conversation: AnswerGapConversationSnapshot;
  coverageProbe: AnswerGapCoverageProbe;
  coverageKind: KnowledgeCoverageKind;
  consent: AnswerGapConsentSnapshot;
}

export interface CreateAnswerGapResponse {
  gap: AnswerGap;
  created: boolean;
}

export interface ListAnswerGapsResponse {
  gaps: AnswerGap[];
  nextCursor: string | null;
  totalCount: number;
}

export interface AnswerGapCursorPayload {
  filter: 'needs_answer' | 'all';
  createdAt: string;
  id: string;
}

export interface MarkAnswerGapDoneResponse {
  gap: AnswerGap;
}

export interface WithdrawAnswerGapConsentResponse {
  gap: AnswerGap;
}
