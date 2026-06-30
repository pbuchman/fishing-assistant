import type {
  AnswerGapContextMessage,
  AnswerGapCoverageProbe,
  AnswerGapRequesterSnapshot,
  AnswerGapSource,
  KnowledgeCoverageKind,
} from '@fa/http-contracts';

export type AnswerGapCandidateStatus =
  | 'pending_user_consent'
  | 'shared'
  | 'declined'
  | 'expired'
  | 'withdrawn';

export interface AnswerGapCandidateConversationSnapshot {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  contextWindow: AnswerGapContextMessage[];
}

export interface AnswerGapCandidate {
  id: string;
  status: AnswerGapCandidateStatus;
  userId: string;
  source: AnswerGapSource;
  question: string;
  missingInformation: string[];
  requester: AnswerGapRequesterSnapshot;
  conversation: AnswerGapCandidateConversationSnapshot;
  coverageProbe: AnswerGapCoverageProbe;
  coverageKind: KnowledgeCoverageKind;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  sharedAt: string | null;
  declinedAt: string | null;
  withdrawnAt: string | null;
  sharedGapId: string | null;
}
