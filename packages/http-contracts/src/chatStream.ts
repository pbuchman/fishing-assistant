import type { AnswerGapCandidateSummary, AnswerGapCoverageProbe } from './answerGaps.js';

export interface ChatStreamCitation {
  sourceId: string;
  usedFor: string;
}

export interface ChatStreamPromptVersionReference {
  name: string;
  version: string;
}

export interface ChatStreamConversationMessagePromptVersions {
  answer: ChatStreamPromptVersionReference;
}

export interface ChatStreamRetrievalTrace {
  query: string;
  startedAt: string;
  completedAt: string;
  coverageProbe?: AnswerGapCoverageProbe;
  sources: {
    sourceId: string;
    label: string;
    status: 'success' | 'failed';
    itemCount: number;
    diagnostics: Record<string, unknown>;
    errorMessage?: string;
  }[];
  evidence: {
    id: string;
    sourceId: string;
    sourceType: string;
    title: string;
    quote: string;
    score: number;
    publicUrl?: string;
    metadata: Record<string, unknown>;
  }[];
}

export interface ChatStreamConversationMessage {
  id: string;
  userId: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  modelId?: string;
  confidence?: 'high' | 'medium' | 'low';
  citations: ChatStreamCitation[];
  missingInformation: string[];
  promptVersions?: ChatStreamConversationMessagePromptVersions;
  retrieval?: ChatStreamRetrievalTrace;
  streamStatus?: 'completed' | 'failed';
  errorMessage?: string;
}

export const chatStreamEventTypes = [
  'message.created',
  'retrieval.started',
  'retrieval.completed',
  'answer.started',
  'answer.delta',
  'answer.progress',
  'answer.citation',
  'answer.missing_info',
  'answer.gap_candidate',
  'answer.final',
  'done',
  'error',
] as const;

export const chatStreamProgressStatusValues = ['long_running', 'preparing_sources'] as const;

export type ChatStreamProgressStatus = (typeof chatStreamProgressStatusValues)[number];

export type ChatStreamEvent =
  | { type: 'message.created'; data: ChatStreamConversationMessage }
  | { type: 'retrieval.started'; data: { conversationId: string; query: string } }
  | {
      type: 'retrieval.completed';
      data: {
        sourceCounts: { sourceId: string; status: 'success' | 'failed'; itemCount: number }[];
        topEvidenceIds: string[];
      };
    }
  | { type: 'answer.started'; data: { conversationId: string; messageId: string } }
  | { type: 'answer.delta'; data: { text: string } }
  | { type: 'answer.progress'; data: { status: ChatStreamProgressStatus } }
  | {
      type: 'answer.citation';
      data: {
        citation: ChatStreamCitation;
        evidence?: ChatStreamRetrievalTrace['evidence'][number];
      };
    }
  | { type: 'answer.missing_info'; data: { missingInformation: string[] } }
  | { type: 'answer.gap_candidate'; data: { candidate: AnswerGapCandidateSummary } }
  | { type: 'answer.final'; data: ChatStreamConversationMessage }
  | { type: 'done'; data: { ok: true } }
  | { type: 'error'; data: { message: string } };
