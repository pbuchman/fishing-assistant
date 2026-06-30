import type { AnswerGapRequesterSnapshot } from './answerGaps.js';
import type { ChatStreamConversationMessage, ChatStreamEvent } from './chatStream.js';

export interface ChatTestCompletionRequest {
  conversationId?: string;
  message: string;
  requester: AnswerGapRequesterSnapshot;
}

export interface ChatTestTraceStep {
  name: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  details: Record<string, unknown>;
}

export interface ChatTestRuntimeTrace {
  startedAt: string;
  completedAt: string;
  totalMs: number;
  steps: ChatTestTraceStep[];
  events: {
    type: ChatStreamEvent['type'];
    atMs: number;
    data: ChatStreamEvent['data'];
  }[];
}

export interface ChatTestCompletionTechnicalStatus {
  ok: boolean;
  streamStatus: 'completed' | 'failed' | null;
  errorMessage?: string;
  parseOk: boolean | null;
  finalFinishReason: string | null;
}

export interface ChatTestCompletionResponse {
  conversationId: string;
  createdConversation: boolean;
  userMessage: ChatStreamConversationMessage;
  assistantMessage: ChatStreamConversationMessage;
  trace: ChatTestRuntimeTrace;
  technicalStatus: ChatTestCompletionTechnicalStatus;
}
