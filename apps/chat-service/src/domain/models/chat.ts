import type { AnswerGapCoverageProbe } from '@fa/http-contracts';

export type ConversationStatus = 'active' | 'deleted';
export type ConversationMessageRole = 'user' | 'assistant';
export type AnswerConfidence = 'high' | 'medium' | 'low';
export type StreamStatus = 'completed' | 'failed';

export interface Citation {
  sourceId: string;
  usedFor: string;
}

export interface PromptVersionReference {
  name: string;
  version: string;
}

export interface ConversationMessagePromptVersions {
  answer: PromptVersionReference;
}

export interface RetrievalTrace {
  query: string;
  startedAt: string;
  completedAt: string;
  coverageProbe?: AnswerGapCoverageProbe;
  sources: RetrievalTraceSource[];
  evidence: RetrievalEvidenceSummary[];
}

export interface RetrievalTracePerformance {
  totalMs: number;
  embeddingMs: number;
  vectorSearchMs: number;
  lexicalFetchMs: number;
  lexicalScoringMs: number;
  lexicalCandidatesMs: number;
  candidateMergeMs: number;
  pageLookupMs: number;
  rankingMs: number;
  expansionMs: number;
}

export interface RetrievalTraceSource {
  sourceId: string;
  label: string;
  status: 'success' | 'failed';
  itemCount: number;
  diagnostics: Record<string, unknown>;
  performance?: RetrievalTracePerformance;
  errorMessage?: string;
}

export interface RetrievalEvidenceSummary {
  id: string;
  sourceId: string;
  sourceType: string;
  title: string;
  quote: string;
  score: number;
  publicUrl?: string;
  metadata: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastMessageRole?: ConversationMessageRole;
  lastAssistantStreamStatus?: StreamStatus | null;
  messageCount: number;
  deletedAt: string | null;
}

export interface ConversationMessage {
  id: string;
  userId: string;
  conversationId: string;
  role: ConversationMessageRole;
  content: string;
  createdAt: string;
  modelId?: string;
  confidence?: AnswerConfidence;
  citations: Citation[];
  missingInformation: string[];
  promptVersions?: ConversationMessagePromptVersions;
  retrieval?: RetrievalTrace;
  streamStatus?: StreamStatus;
  errorMessage?: string;
}
