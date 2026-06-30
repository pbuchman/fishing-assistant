export const packageName = '@fa/llm-contract';

export const chatMessageRoles = ['system', 'user', 'assistant', 'tool'] as const;

export type ChatMessageRole = (typeof chatMessageRoles)[number];

export interface LlmUsageOwner {
  type: 'user';
  id: string;
}

export interface LlmUsageCorrelation {
  conversationId?: string;
  messageId?: string;
  knowledgePageId?: string;
  chunkId?: string;
  requestId?: string;
}

export type LlmProviderOperation = 'chat.completion' | 'chat.stream' | 'embedding';

export type LlmProviderCallErrorCode =
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_ABORTED'
  | 'PROVIDER_HTTP_ERROR'
  | 'PROVIDER_NETWORK_ERROR';

export interface LlmProviderRetryBackoffInput {
  attempt: number;
  operation: LlmProviderOperation;
  statusCode?: number;
  errorCode?: LlmProviderCallErrorCode;
}

export interface LlmProviderCallPolicy {
  timeoutMs?: number;
  maxRetries?: number;
  retryableStatusCodes?: readonly number[];
  retryBackoffMs?: (input: LlmProviderRetryBackoffInput) => number | Promise<number>;
}

export class LlmProviderCallError extends Error {
  readonly code: LlmProviderCallErrorCode;
  readonly provider: string;
  readonly operation: LlmProviderOperation;
  readonly statusCode?: number;

  constructor(input: {
    code: LlmProviderCallErrorCode;
    provider: string;
    operation: LlmProviderOperation;
    message: string;
    statusCode?: number;
    cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = 'LlmProviderCallError';
    this.code = input.code;
    this.provider = input.provider;
    this.operation = input.operation;
    if (input.statusCode !== undefined) {
      this.statusCode = input.statusCode;
    }
  }
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimated: boolean;
}

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export type ChatToolChoice = 'auto' | 'none';

export type ChatMessage =
  | {
      role: Exclude<ChatMessageRole, 'tool'>;
      content: string;
      toolCalls?: ChatToolCall[];
    }
  | {
      role: 'tool';
      content: string;
      toolCallId: string;
      name?: string;
    };

export interface LlmUsageMetadata {
  owner?: LlmUsageOwner;
  promptType?: string;
  promptVersion?: string;
  correlation?: LlmUsageCorrelation;
  sessionId?: string;
}

export type ChatStructuredOutput =
  | {
      type: 'json_object';
      schemaName?: never;
      schema?: never;
      strict?: never;
    }
  | {
      type: 'json_schema';
      schemaName?: string;
      schema: Record<string, unknown>;
      strict?: boolean;
    };

export const chatReasoningEfforts = ['xhigh', 'high', 'medium', 'low', 'minimal', 'none'] as const;

export type ChatReasoningEffort = (typeof chatReasoningEfforts)[number];

export interface ChatReasoningConfig {
  effort?: ChatReasoningEffort;
  maxTokens?: number;
  exclude?: boolean;
  enabled?: boolean;
}

export interface ChatCompletionRequest extends LlmUsageMetadata {
  provider?: string;
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  tools?: ChatTool[];
  toolChoice?: ChatToolChoice;
  structuredOutput?: ChatStructuredOutput;
  reasoning?: ChatReasoningConfig;
  signal?: AbortSignal;
  providerCallPolicy?: LlmProviderCallPolicy;
}

export interface ChatCompletionResponse {
  provider: string;
  model: string;
  text: string;
  finishReason?: string;
  toolCalls?: ChatToolCall[];
  usage: LlmUsage;
  raw?: unknown;
}

export type ChatCompletionStreamEvent =
  | {
      type: 'text_delta';
      text: string;
    }
  | {
      type: 'done';
      response: ChatCompletionResponse;
    };

export interface EmbeddingRequest extends LlmUsageMetadata {
  model?: string;
  input: string | string[];
  dimensions?: number;
  signal?: AbortSignal;
  providerCallPolicy?: LlmProviderCallPolicy;
}

export interface EmbeddingResponse {
  provider: string;
  model: string;
  dimensions: number;
  vectors: number[][];
  usage: LlmUsage;
  raw?: unknown;
}

export interface LlmChatProvider {
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  stream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamEvent>;
}

export interface LlmEmbeddingProvider {
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export interface LlmProviders {
  chat: LlmChatProvider;
  embeddings: LlmEmbeddingProvider;
}

export function isChatMessageRole(value: unknown): value is ChatMessageRole {
  return typeof value === 'string' && chatMessageRoles.includes(value as ChatMessageRole);
}
