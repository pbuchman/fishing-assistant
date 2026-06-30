import {
  LlmProviderCallError,
  type ChatMessage,
  type ChatCompletionRequest,
  type ChatReasoningConfig,
  type ChatCompletionResponse,
  type ChatCompletionStreamEvent,
  type ChatStructuredOutput,
  type ChatToolCall,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type LlmProviderCallPolicy,
  type LlmProviderCallErrorCode,
  type LlmProviderOperation,
  type LlmProviders,
  type LlmUsage,
  type LlmUsageCorrelation,
  type LlmUsageOwner,
} from '@fa/llm-contract';
import { isInvalidUsageOwnerId, type UsageSink, type UsageSinkRecordParams } from '@fa/llm-pricing';
import { createParser, type EventSourceMessage } from 'eventsource-parser';

import {
  MINIMAX_CHAT_MODEL,
  MINIMAX_PROVIDER,
  OPENROUTER_PROVIDER,
  resolveLlmProviderConfig,
  type LlmProviderEnv,
  type MiniMaxProviderConfig,
  type OpenRouterProviderConfig,
} from './config.js';

const OPENROUTER_PROVIDER_ID = OPENROUTER_PROVIDER;
const MINIMAX_PROVIDER_ID = MINIMAX_PROVIDER;
const DEFAULT_RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504] as const;
const OPENROUTER_MODELS_WITHOUT_TEMPERATURE = new Set([
  'openai/gpt-5.4-mini',
  'openai/gpt-5.4-nano',
]);

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface UsageWarningLogger {
  warn(obj: object, message?: string): void;
}

export interface OpenRouterAdapterParams {
  config: OpenRouterProviderConfig;
  usageSink: UsageSink;
  fetch?: FetchLike;
  logger?: UsageWarningLogger;
  referer?: string;
  appTitle?: string;
  providerCallPolicy?: LlmProviderCallPolicy;
}

export interface OpenRouterChatProviderParams extends OpenRouterAdapterParams {
  model: string;
}

export interface MiniMaxChatProviderParams {
  config: MiniMaxProviderConfig;
  usageSink: UsageSink;
  fetch?: FetchLike;
  logger?: UsageWarningLogger;
  providerCallPolicy?: LlmProviderCallPolicy;
}

export interface OpenRouterEmbeddingProviderParams extends OpenRouterAdapterParams {
  model: string;
  dimensions: number;
}

export interface CreateLlmProvidersParams {
  env?: LlmProviderEnv;
  usageSink: UsageSink;
  fetch?: FetchLike;
  logger?: UsageWarningLogger;
  referer?: string;
  appTitle?: string;
  providerCallPolicy?: LlmProviderCallPolicy;
}

interface NormalizedUsage extends LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimated: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeSafeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

interface ResolvedProviderCallPolicy {
  timeoutMs?: number;
  maxRetries: number;
  retryableStatusCodes: readonly number[];
  retryBackoffMs: NonNullable<LlmProviderCallPolicy['retryBackoffMs']>;
}

interface ProviderCallSignal {
  signal?: AbortSignal;
  cleanup: () => void;
  callerAborted: () => boolean;
  timedOut: () => boolean;
}

interface OpenRouterProviderCallInput<TResponse> {
  fetchImpl: FetchLike;
  url: string;
  init: RequestInit;
  callerSignal?: AbortSignal;
  operation: LlmProviderOperation;
  requestLabel: string;
  providerCallPolicy?: LlmProviderCallPolicy;
  requestPolicy?: LlmProviderCallPolicy;
  retryableResponseError?: (error: unknown) => boolean;
  handleResponse: (response: Response) => Promise<TResponse>;
}

function defaultRetryBackoffMs(input: { attempt: number }): number {
  return Math.min(250 * 2 ** Math.max(0, input.attempt - 1), 2_000);
}

function optionalPositiveFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function resolveProviderCallPolicy(
  ...policies: (LlmProviderCallPolicy | undefined)[]
): ResolvedProviderCallPolicy {
  let timeoutMs: number | undefined;
  let maxRetries = 0;
  let retryableStatusCodes: readonly number[] = DEFAULT_RETRYABLE_STATUS_CODES;
  let retryBackoffMs: NonNullable<LlmProviderCallPolicy['retryBackoffMs']> = defaultRetryBackoffMs;

  for (const policy of policies) {
    if (policy === undefined) {
      continue;
    }

    if ('timeoutMs' in policy) {
      timeoutMs = optionalPositiveFiniteNumber(policy.timeoutMs);
    }
    maxRetries = nonNegativeSafeInteger(policy.maxRetries) ?? maxRetries;
    if (policy.retryableStatusCodes !== undefined) {
      retryableStatusCodes = policy.retryableStatusCodes;
    }
    if (policy.retryBackoffMs !== undefined) {
      retryBackoffMs = policy.retryBackoffMs;
    }
  }

  return {
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    maxRetries,
    retryableStatusCodes,
    retryBackoffMs,
  };
}

function isAbortLikeError(error: unknown): boolean {
  return isRecord(error) && (error['name'] === 'AbortError' || error['name'] === 'TimeoutError');
}

function providerCallError(input: {
  code: LlmProviderCallErrorCode;
  operation: LlmProviderOperation;
  message: string;
  statusCode?: number;
  cause?: unknown;
}): LlmProviderCallError {
  return new LlmProviderCallError({
    code: input.code,
    provider: OPENROUTER_PROVIDER_ID,
    operation: input.operation,
    message: input.message,
    ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
    ...(input.cause !== undefined ? { cause: input.cause } : {}),
  });
}

function providerAbortError(input: {
  operation: LlmProviderOperation;
  requestLabel: string;
  cause?: unknown;
}): LlmProviderCallError {
  return providerCallError({
    code: 'PROVIDER_ABORTED',
    operation: input.operation,
    message: `OpenRouter ${input.requestLabel} request was aborted`,
    ...(input.cause !== undefined ? { cause: input.cause } : {}),
  });
}

function providerTimeoutError(input: {
  operation: LlmProviderOperation;
  requestLabel: string;
  timeoutMs: number | undefined;
  cause?: unknown;
}): LlmProviderCallError {
  return providerCallError({
    code: 'PROVIDER_TIMEOUT',
    operation: input.operation,
    message:
      input.timeoutMs === undefined
        ? `OpenRouter ${input.requestLabel} request timed out`
        : `OpenRouter ${input.requestLabel} request timed out after ${String(input.timeoutMs)}ms`,
    ...(input.cause !== undefined ? { cause: input.cause } : {}),
  });
}

function providerHttpError(input: {
  operation: LlmProviderOperation;
  requestLabel: string;
  statusCode: number;
  providerMessage?: string;
}): LlmProviderCallError {
  const detail =
    input.providerMessage === undefined || input.providerMessage.length === 0
      ? ''
      : `: ${input.providerMessage}`;
  return providerCallError({
    code: 'PROVIDER_HTTP_ERROR',
    operation: input.operation,
    statusCode: input.statusCode,
    message: `OpenRouter ${input.requestLabel} request failed with status ${String(
      input.statusCode
    )}${detail}`,
  });
}

function sanitizedProviderErrorMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length === 0 ? undefined : normalized.slice(0, 500);
}

function providerErrorMessageFromBody(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  const error = body['error'];
  if (isRecord(error)) {
    return sanitizedProviderErrorMessage(error['message']);
  }

  return sanitizedProviderErrorMessage(body['message']);
}

async function providerHttpErrorMessage(response: Response): Promise<string | undefined> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return undefined;
  }

  try {
    return providerErrorMessageFromBody(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function providerNetworkError(input: {
  operation: LlmProviderOperation;
  requestLabel: string;
  cause: unknown;
}): LlmProviderCallError {
  return providerCallError({
    code: 'PROVIDER_NETWORK_ERROR',
    operation: input.operation,
    message: `OpenRouter ${input.requestLabel} request failed before receiving a response`,
    cause: input.cause,
  });
}

function composeProviderCallSignal(input: {
  callerSignal: AbortSignal | undefined;
  timeoutMs: number | undefined;
}): ProviderCallSignal {
  if (input.timeoutMs === undefined) {
    return {
      ...(input.callerSignal !== undefined ? { signal: input.callerSignal } : {}),
      cleanup: () => undefined,
      callerAborted: () => input.callerSignal?.aborted === true,
      timedOut: () => false,
    };
  }

  const controller = new AbortController();
  let callerAborted = input.callerSignal?.aborted === true;
  let timedOut = false;
  const abortFromCaller = () => {
    callerAborted = true;
    controller.abort();
  };

  if (input.callerSignal !== undefined) {
    if (input.callerSignal.aborted) {
      abortFromCaller();
    } else {
      input.callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    }
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, input.timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      input.callerSignal?.removeEventListener('abort', abortFromCaller);
    },
    callerAborted: () => callerAborted || input.callerSignal?.aborted === true,
    timedOut: () => timedOut,
  };
}

function shouldRetryStatus(statusCode: number, policy: ResolvedProviderCallPolicy): boolean {
  return policy.retryableStatusCodes.includes(statusCode);
}

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function waitForRetry(input: {
  policy: ResolvedProviderCallPolicy;
  attempt: number;
  operation: LlmProviderOperation;
  requestLabel: string;
  statusCode: number;
  callerSignal: AbortSignal | undefined;
}): Promise<void> {
  if (input.callerSignal?.aborted === true) {
    throw providerAbortError({
      operation: input.operation,
      requestLabel: input.requestLabel,
    });
  }

  const configuredDelayMs = await input.policy.retryBackoffMs({
    attempt: input.attempt,
    operation: input.operation,
    statusCode: input.statusCode,
  });
  const delayMs = optionalPositiveFiniteNumber(configuredDelayMs) ?? 0;
  if (delayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      input.callerSignal?.removeEventListener('abort', abortFromCaller);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const abortFromCaller = () => {
      clearTimeout(timer);
      cleanup();
      reject(
        providerAbortError({
          operation: input.operation,
          requestLabel: input.requestLabel,
        })
      );
    };

    input.callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  });
}

async function callOpenRouterProvider<TResponse>(
  input: OpenRouterProviderCallInput<TResponse>
): Promise<TResponse> {
  const policy = resolveProviderCallPolicy(input.providerCallPolicy, input.requestPolicy);
  let attempt = 0;

  for (;;) {
    if (input.callerSignal?.aborted === true) {
      throw providerAbortError({
        operation: input.operation,
        requestLabel: input.requestLabel,
      });
    }

    const callSignal = composeProviderCallSignal({
      callerSignal: input.callerSignal,
      timeoutMs: policy.timeoutMs,
    });
    const classifyPolicyAbort = (error: unknown): LlmProviderCallError | undefined => {
      if (callSignal.callerAborted()) {
        return providerAbortError({
          operation: input.operation,
          requestLabel: input.requestLabel,
          cause: error,
        });
      }

      if (callSignal.timedOut()) {
        return providerTimeoutError({
          operation: input.operation,
          requestLabel: input.requestLabel,
          timeoutMs: policy.timeoutMs,
          cause: error,
        });
      }

      if (isAbortLikeError(error)) {
        return providerAbortError({
          operation: input.operation,
          requestLabel: input.requestLabel,
          cause: error,
        });
      }

      return undefined;
    };

    try {
      let response: Response;
      try {
        response = await input.fetchImpl(input.url, {
          ...input.init,
          ...(callSignal.signal !== undefined ? { signal: callSignal.signal } : {}),
        });
      } catch (error) {
        const policyError = classifyPolicyAbort(error);
        if (policyError !== undefined) {
          throw policyError;
        }

        throw providerNetworkError({
          operation: input.operation,
          requestLabel: input.requestLabel,
          cause: error,
        });
      }

      if (response.ok) {
        try {
          return await input.handleResponse(response);
        } catch (error) {
          const policyError = classifyPolicyAbort(error);
          if (policyError !== undefined) {
            throw policyError;
          }

          if (attempt < policy.maxRetries && input.retryableResponseError?.(error) === true) {
            callSignal.cleanup();
            attempt += 1;
            await waitForRetry({
              policy,
              attempt,
              operation: input.operation,
              requestLabel: input.requestLabel,
              statusCode: response.status,
              callerSignal: input.callerSignal,
            });
            continue;
          }

          throw error;
        }
      }

      if (attempt < policy.maxRetries && shouldRetryStatus(response.status, policy)) {
        const retryStatusCode = response.status;
        await cancelResponseBody(response);
        callSignal.cleanup();
        attempt += 1;
        await waitForRetry({
          policy,
          attempt,
          operation: input.operation,
          requestLabel: input.requestLabel,
          statusCode: retryStatusCode,
          callerSignal: input.callerSignal,
        });
        continue;
      } else {
        const providerMessage = await providerHttpErrorMessage(response);
        throw providerHttpError({
          operation: input.operation,
          requestLabel: input.requestLabel,
          statusCode: response.status,
          ...(providerMessage !== undefined ? { providerMessage } : {}),
        });
      }
    } finally {
      callSignal.cleanup();
    }
  }
}

async function readStreamChunk(input: {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  signal?: AbortSignal;
  operation: LlmProviderOperation;
  requestLabel: string;
  timeoutMs?: number;
  timedOut?: () => boolean;
}): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (input.signal === undefined) {
    return await input.reader.read();
  }

  const abortError = (cause?: unknown) =>
    input.timedOut?.() === true
      ? providerTimeoutError({
          operation: input.operation,
          requestLabel: input.requestLabel,
          timeoutMs: input.timeoutMs,
          ...(cause !== undefined ? { cause } : {}),
        })
      : providerAbortError({
          operation: input.operation,
          requestLabel: input.requestLabel,
          ...(cause !== undefined ? { cause } : {}),
        });

  if (input.signal.aborted) {
    await input.reader.cancel().catch(() => undefined);
    throw abortError();
  }

  const signal = input.signal;
  return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      void input.reader.cancel().catch(() => undefined);
      reject(abortError());
    };

    signal.addEventListener('abort', abort, { once: true });
    void input.reader.read().then(
      (chunk) => {
        cleanup();
        resolve(chunk);
      },
      (error: unknown) => {
        cleanup();
        if (signal.aborted || isAbortLikeError(error)) {
          reject(abortError(error));
        } else {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    );
  });
}

function estimateTextTokens(value: string): number {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function estimateInputTokens(input: string | string[]): number {
  if (Array.isArray(input)) {
    return input.reduce((total, value) => total + estimateTextTokens(value), 0);
  }

  return estimateTextTokens(input);
}

function estimateChatInputTokens(request: ChatCompletionRequest): number {
  return request.messages.reduce(
    (total, message) =>
      total + estimateTextTokens(message.role) + estimateTextTokens(message.content),
    0
  );
}

function normalizeUsage(
  usage: unknown,
  fallbackInputTokens: number,
  fallbackOutputTokens: number
): NormalizedUsage {
  if (!isRecord(usage)) {
    return {
      inputTokens: fallbackInputTokens,
      outputTokens: fallbackOutputTokens,
      totalTokens: fallbackInputTokens + fallbackOutputTokens,
      estimated: true,
    };
  }

  const inputTokens = nonNegativeSafeInteger(usage['prompt_tokens']);
  const outputTokens = nonNegativeSafeInteger(usage['completion_tokens']) ?? 0;
  const totalTokens = nonNegativeSafeInteger(usage['total_tokens']);
  const resolvedInputTokens = inputTokens ?? fallbackInputTokens;
  const resolvedOutputTokens = outputTokens;
  const resolvedTotalTokens =
    totalTokens === resolvedInputTokens + resolvedOutputTokens
      ? totalTokens
      : resolvedInputTokens + resolvedOutputTokens;

  return {
    inputTokens: resolvedInputTokens,
    outputTokens: resolvedOutputTokens,
    totalTokens: resolvedTotalTokens,
    estimated:
      inputTokens === undefined ||
      (usage['completion_tokens'] !== undefined &&
        nonNegativeSafeInteger(usage['completion_tokens']) === undefined) ||
      totalTokens !== resolvedInputTokens + resolvedOutputTokens,
  };
}

function usageRecordTokens(usage: NormalizedUsage): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenUsageEstimated: boolean;
} {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    tokenUsageEstimated: usage.estimated,
  };
}

function usageCostFromOpenRouter(usage: unknown): UsageSinkRecordParams['cost'] {
  if (isRecord(usage) && typeof usage['cost'] === 'number' && Number.isFinite(usage['cost'])) {
    return {
      estimatedCostUsd: Math.max(0, usage['cost']),
      source: 'provider-reported',
    };
  }

  return { estimatedCostUsd: 0, source: 'provider-reported' };
}

function usageCostFromMiniMax(usage: NormalizedUsage): UsageSinkRecordParams['cost'] {
  const inputUsd = (usage.inputTokens / 1_000_000) * 0.3;
  const outputUsd = (usage.outputTokens / 1_000_000) * 1.2;

  return {
    estimatedCostUsd: Math.round((inputUsd + outputUsd) * 100_000_000) / 100_000_000,
    source: 'provider-estimated',
  };
}

async function readJson(response: Response, operation: string): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    throw new Error(`OpenRouter ${operation} response was not valid JSON`, { cause: error });
  }
}

function headers(config: OpenRouterProviderConfig, params: OpenRouterAdapterParams): HeadersInit {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    ...(params.referer !== undefined ? { 'HTTP-Referer': params.referer } : {}),
    ...(params.appTitle !== undefined ? { 'X-Title': params.appTitle } : {}),
  };
}

function miniMaxHeaders(config: MiniMaxProviderConfig): HeadersInit {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
}

function responseFormat(structuredOutput: ChatStructuredOutput): Record<string, unknown> {
  if (structuredOutput.type === 'json_object') {
    return { type: 'json_object' };
  }

  return {
    type: 'json_schema',
    json_schema: {
      name: structuredOutput.schemaName ?? 'structured_output',
      ...(structuredOutput.strict !== undefined ? { strict: structuredOutput.strict } : {}),
      schema: structuredOutput.schema,
    },
  };
}

function reasoningConfig(reasoning: ChatReasoningConfig): Record<string, unknown> {
  return {
    ...(reasoning.effort !== undefined ? { effort: reasoning.effort } : {}),
    ...(reasoning.maxTokens !== undefined ? { max_tokens: reasoning.maxTokens } : {}),
    ...(reasoning.exclude !== undefined ? { exclude: reasoning.exclude } : {}),
    ...(reasoning.enabled !== undefined ? { enabled: reasoning.enabled } : {}),
  };
}

function providerRoutingConfig(input: {
  sort: OpenRouterProviderConfig['providerSort'];
  requireParameters: boolean;
}): Record<string, unknown> {
  return {
    sort: input.sort,
    ...(input.requireParameters ? { require_parameters: true } : {}),
  };
}

function shouldSendTemperature(model: string): boolean {
  return !OPENROUTER_MODELS_WITHOUT_TEMPERATURE.has(model);
}

function chatMessagePayload(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: message.content,
      tool_call_id: message.toolCallId,
      ...(message.name === undefined ? {} : { name: message.name }),
    };
  }

  return {
    role: message.role,
    content: message.content,
    ...(message.toolCalls === undefined || message.toolCalls.length === 0
      ? {}
      : { tool_calls: message.toolCalls }),
  };
}

function chatRequestBody(
  config: OpenRouterProviderConfig,
  model: string,
  request: ChatCompletionRequest,
  stream: boolean
): Record<string, unknown> {
  const structuredOutput = request.structuredOutput;
  const sessionId = request.sessionId?.trim().slice(0, 128);
  return {
    model,
    messages: request.messages.map(chatMessagePayload),
    ...(request.temperature !== undefined && shouldSendTemperature(model)
      ? { temperature: request.temperature }
      : {}),
    ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}),
    ...(request.tools === undefined || request.tools.length === 0 ? {} : { tools: request.tools }),
    ...(request.toolChoice === undefined ? {} : { tool_choice: request.toolChoice }),
    stream,
    provider: providerRoutingConfig({
      sort: config.providerSort,
      requireParameters: structuredOutput !== undefined,
    }),
    ...(sessionId !== undefined && sessionId.length > 0 ? { session_id: sessionId } : {}),
    ...(request.reasoning !== undefined ? { reasoning: reasoningConfig(request.reasoning) } : {}),
    ...(structuredOutput !== undefined
      ? {
          response_format: responseFormat(structuredOutput),
        }
      : {}),
  };
}

function miniMaxChatRequestBody(
  model: string,
  request: ChatCompletionRequest,
  stream: boolean
): Record<string, unknown> {
  return {
    model,
    messages: request.messages.map(chatMessagePayload),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxOutputTokens !== undefined
      ? { max_completion_tokens: request.maxOutputTokens }
      : {}),
    ...(request.tools === undefined || request.tools.length === 0 ? {} : { tools: request.tools }),
    ...(request.toolChoice === undefined ? {} : { tool_choice: request.toolChoice }),
    thinking: { type: 'disabled' },
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  };
}

function recordParams(
  request: {
    owner: LlmUsageOwner;
    promptType: string;
    promptVersion: string;
    correlation?: LlmUsageCorrelation;
  },
  params: Omit<UsageSinkRecordParams, 'owner' | 'promptType' | 'promptVersion' | 'correlation'>
): UsageSinkRecordParams {
  return {
    ...params,
    owner: request.owner,
    promptType: request.promptType,
    promptVersion: request.promptVersion,
    ...(request.correlation !== undefined ? { correlation: request.correlation } : {}),
  };
}

function requiredUsageString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function usageMetadataForRequest(request: {
  owner?: LlmUsageOwner;
  promptType?: string;
  promptVersion?: string;
  correlation?: LlmUsageCorrelation;
}): {
  owner: LlmUsageOwner;
  promptType: string;
  promptVersion: string;
  correlation?: LlmUsageCorrelation;
} {
  const rawOwner = request.owner;
  if (rawOwner === undefined) {
    throw new Error('owner.type must be user');
  }
  if ((rawOwner as { type?: unknown }).type !== 'user') {
    throw new Error('owner.type must be user');
  }

  const ownerId = requiredUsageString(rawOwner.id, 'owner.id');
  if (isInvalidUsageOwnerId(ownerId)) {
    throw new Error('owner.id must be a real user id');
  }

  return {
    owner: { type: 'user', id: ownerId },
    promptType: requiredUsageString(request.promptType, 'promptType'),
    promptVersion: requiredUsageString(request.promptVersion, 'promptVersion'),
    ...(request.correlation !== undefined ? { correlation: request.correlation } : {}),
  };
}

async function recordUsage(
  usageSink: UsageSink,
  params: UsageSinkRecordParams,
  logger?: UsageWarningLogger
): Promise<void> {
  try {
    await usageSink.record(params);
  } catch (error) {
    logger?.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Usage sink failed'
    );
  }
}

function assistantContentText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const text = value
      .map((item) => assistantContentText(item))
      .filter((item): item is string => item !== undefined && item.length > 0)
      .join('');
    return text.length > 0 ? text : undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const text = value['text'];
  if (typeof text === 'string') {
    return text;
  }

  const content = value['content'];
  return content === value ? undefined : assistantContentText(content);
}

function parseToolCalls(value: unknown): ChatToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): ChatToolCall[] => {
    if (!isRecord(entry) || entry['type'] !== 'function' || !isRecord(entry['function'])) {
      return [];
    }

    const id = entry['id'];
    const name = entry['function']['name'];
    const args = entry['function']['arguments'];
    if (typeof id !== 'string' || typeof name !== 'string' || typeof args !== 'string') {
      return [];
    }

    return [
      {
        id,
        type: 'function',
        function: {
          name,
          arguments: args,
        },
      },
    ];
  });
}

function choiceText(body: unknown): {
  text: string;
  finishReason?: string;
  toolCalls?: ChatToolCall[];
} {
  if (!isRecord(body) || !Array.isArray(body['choices'])) {
    const providerMessage = providerErrorMessageFromBody(body);
    throw new Error(
      providerMessage === undefined
        ? 'OpenRouter chat response did not include choices'
        : `OpenRouter chat response did not include choices: ${providerMessage}`
    );
  }

  const firstChoice = body['choices'].find(isRecord);
  if (!isRecord(firstChoice) || !isRecord(firstChoice['message'])) {
    throw new Error('OpenRouter chat response did not include an assistant message');
  }

  const message = firstChoice['message'];
  const toolCalls = parseToolCalls(message['tool_calls']);
  const text = assistantContentText(message['content']) ?? '';
  if (text.length === 0 && toolCalls.length === 0) {
    throw new Error('OpenRouter chat response assistant message content must contain text');
  }

  const finishReason = firstChoice['finish_reason'];
  return {
    text,
    ...(typeof finishReason === 'string' ? { finishReason } : {}),
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
  };
}

function isRetryableChatResponseError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('OpenRouter chat response did not include choices') ||
    error.message.includes('OpenRouter chat response did not include an assistant message') ||
    error.message.includes(
      'OpenRouter chat response assistant message content must contain text'
    ) ||
    error.message.includes('OpenRouter chat response was not valid JSON')
  );
}

function streamChoiceDelta(body: unknown): { text?: string; finishReason?: string } {
  if (!isRecord(body) || !Array.isArray(body['choices'])) {
    return {};
  }

  const firstChoice = body['choices'].find(isRecord);
  if (!isRecord(firstChoice)) {
    return {};
  }

  const delta = firstChoice['delta'];
  const content = isRecord(delta) ? delta['content'] : undefined;
  const text = assistantContentText(content);
  const finishReason = firstChoice['finish_reason'];

  return {
    ...(text !== undefined && text.length > 0 ? { text } : {}),
    ...(typeof finishReason === 'string' ? { finishReason } : {}),
  };
}

type ParsedStreamEvent = { kind: 'done' } | { kind: 'json'; value: unknown };

function parseStreamEvent(event: EventSourceMessage): ParsedStreamEvent {
  if (event.data === '[DONE]') {
    return { kind: 'done' };
  }

  try {
    return { kind: 'json', value: JSON.parse(event.data) as unknown };
  } catch (error) {
    throw new Error('OpenRouter chat stream event was not valid JSON', { cause: error });
  }
}

function numberVector(value: unknown, dimensions: number): number[] {
  if (!Array.isArray(value)) {
    throw new Error('OpenRouter embedding response item did not include an embedding vector');
  }

  const vector = (value as readonly unknown[]).map((entry) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new Error('OpenRouter embedding response vector must contain only finite numbers');
    }

    return entry;
  });

  if (vector.length !== dimensions) {
    throw new Error(`OpenRouter embedding vector dimensions must equal ${String(dimensions)}`);
  }

  return vector;
}

function embeddingInputCount(input: string | string[]): number {
  return Array.isArray(input) ? input.length : 1;
}

function embeddingVectors(body: unknown, dimensions: number, expectedCount: number): number[][] {
  if (!isRecord(body)) {
    throw new Error('OpenRouter embedding response did not include data');
  }

  const data = body['data'];
  if (!Array.isArray(data)) {
    throw new Error('OpenRouter embedding response did not include data');
  }

  if (data.length === 0) {
    throw new Error('OpenRouter embedding response did not include any vectors');
  }

  if (data.length !== expectedCount) {
    throw new Error('OpenRouter embedding response vector count must equal input count');
  }

  const indexedVectors = (data as readonly unknown[]).map((entry, fallbackIndex) => {
    if (!isRecord(entry)) {
      throw new Error('OpenRouter embedding response item did not include an embedding vector');
    }

    const index = entry['index'];
    const resolvedIndex =
      typeof index === 'number' && Number.isSafeInteger(index) ? index : fallbackIndex;

    return {
      index: resolvedIndex,
      vector: numberVector(entry['embedding'], dimensions),
    };
  });

  if (expectedCount > 1) {
    const seen = new Set<number>();
    for (const item of indexedVectors) {
      if (item.index < 0 || item.index >= expectedCount || seen.has(item.index)) {
        throw new Error('OpenRouter embedding response indexes must uniquely match input order');
      }
      seen.add(item.index);
    }

    return [...indexedVectors]
      .sort((left, right) => left.index - right.index)
      .map((item) => item.vector);
  }

  return indexedVectors.map((item) => item.vector);
}

export class OpenRouterChatProvider {
  private readonly params: OpenRouterChatProviderParams;
  private readonly fetchImpl: FetchLike;

  constructor(params: OpenRouterChatProviderParams) {
    this.params = params;
    this.fetchImpl = params.fetch ?? fetch;
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const model = request.model ?? this.params.model;
    const usageMetadata = usageMetadataForRequest(request);
    const providerResponse = await callOpenRouterProvider({
      fetchImpl: this.fetchImpl,
      url: `${this.params.config.baseUrl}/chat/completions`,
      init: {
        method: 'POST',
        headers: headers(this.params.config, this.params),
        body: JSON.stringify(chatRequestBody(this.params.config, model, request, false)),
      },
      operation: 'chat.completion',
      requestLabel: 'chat',
      ...(request.signal !== undefined ? { callerSignal: request.signal } : {}),
      ...(this.params.providerCallPolicy !== undefined
        ? { providerCallPolicy: this.params.providerCallPolicy }
        : {}),
      ...(request.providerCallPolicy !== undefined
        ? { requestPolicy: request.providerCallPolicy }
        : {}),
      retryableResponseError: isRetryableChatResponseError,
      handleResponse: async (response) => {
        const body = await readJson(response, 'chat');
        const { text, finishReason, toolCalls } = choiceText(body);
        const rawUsage = body && isRecord(body) ? body['usage'] : undefined;
        const usage = normalizeUsage(
          rawUsage,
          estimateChatInputTokens(request),
          estimateTextTokens(text)
        );

        return {
          body,
          text,
          finishReason,
          ...(toolCalls === undefined ? {} : { toolCalls }),
          usage,
          cost: usageCostFromOpenRouter(rawUsage),
        };
      },
    });

    await recordUsage(
      this.params.usageSink,
      recordParams(usageMetadata, {
        provider: OPENROUTER_PROVIDER_ID,
        model,
        operation: 'chat.completion',
        ...usageRecordTokens(providerResponse.usage),
        cost: providerResponse.cost,
      }),
      this.params.logger
    );

    return {
      provider: OPENROUTER_PROVIDER_ID,
      model,
      text: providerResponse.text,
      ...(providerResponse.finishReason !== undefined
        ? { finishReason: providerResponse.finishReason }
        : {}),
      ...(providerResponse.toolCalls === undefined
        ? {}
        : { toolCalls: providerResponse.toolCalls }),
      usage: providerResponse.usage,
      raw: providerResponse.body,
    };
  }

  async *stream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamEvent> {
    const model = request.model ?? this.params.model;
    const usageMetadata = usageMetadataForRequest(request);
    const response = await callOpenRouterProvider({
      fetchImpl: this.fetchImpl,
      url: `${this.params.config.baseUrl}/chat/completions`,
      init: {
        method: 'POST',
        headers: headers(this.params.config, this.params),
        body: JSON.stringify(chatRequestBody(this.params.config, model, request, true)),
      },
      operation: 'chat.stream',
      requestLabel: 'chat stream',
      ...(request.signal !== undefined ? { callerSignal: request.signal } : {}),
      ...(this.params.providerCallPolicy !== undefined
        ? { providerCallPolicy: this.params.providerCallPolicy }
        : {}),
      ...(request.providerCallPolicy !== undefined
        ? { requestPolicy: request.providerCallPolicy }
        : {}),
      handleResponse: (providerResponse) => Promise.resolve(providerResponse),
    });

    if (response.body === null) {
      throw new Error('OpenRouter chat stream response did not include a body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let finishReason: string | undefined;
    let usagePayload: unknown;
    const rawChunks: unknown[] = [];
    let parserError: Error | undefined;
    let parsedEvents: EventSourceMessage[] = [];
    const parser = createParser({
      onEvent: (event) => {
        parsedEvents.push(event);
      },
      onError: (error) => {
        parserError = error;
      },
    });

    const handleParsedEvents = function* (): Iterable<ChatCompletionStreamEvent> {
      for (const event of parsedEvents) {
        const parsedEvent = parseStreamEvent(event);
        if (parsedEvent.kind === 'done') {
          continue;
        }
        const payload = parsedEvent.value;

        rawChunks.push(payload);
        const delta = streamChoiceDelta(payload);
        if (delta.finishReason !== undefined) {
          finishReason = delta.finishReason;
        }

        if (isRecord(payload) && payload['usage'] !== undefined) {
          usagePayload = payload['usage'];
        }

        if (delta.text !== undefined) {
          text += delta.text;
          yield { type: 'text_delta', text: delta.text };
        }
      }

      parsedEvents = [];
    };

    const streamPolicy = resolveProviderCallPolicy(
      this.params.providerCallPolicy,
      request.providerCallPolicy
    );
    const streamReadSignal = composeProviderCallSignal({
      callerSignal: request.signal,
      timeoutMs: streamPolicy.timeoutMs,
    });

    try {
      for (;;) {
        const chunk = await readStreamChunk({
          reader,
          ...(streamReadSignal.signal !== undefined ? { signal: streamReadSignal.signal } : {}),
          operation: 'chat.stream',
          requestLabel: 'chat stream',
          ...(streamPolicy.timeoutMs !== undefined ? { timeoutMs: streamPolicy.timeoutMs } : {}),
          timedOut: streamReadSignal.timedOut,
        });
        if (chunk.done) {
          break;
        }

        parser.feed(decoder.decode(chunk.value, { stream: true }));
        if (parserError !== undefined) {
          throw parserError;
        }

        yield* handleParsedEvents();
      }
    } finally {
      if (streamReadSignal.signal?.aborted === true || request.signal?.aborted === true) {
        await reader.cancel().catch(() => undefined);
      }
      streamReadSignal.cleanup();
    }

    parser.feed(decoder.decode());
    parser.reset({ consume: true });
    if (parserError !== undefined) {
      throw parserError;
    }

    yield* handleParsedEvents();

    const usage = normalizeUsage(
      usagePayload,
      estimateChatInputTokens(request),
      estimateTextTokens(text)
    );
    const cost = usageCostFromOpenRouter(usagePayload);

    await recordUsage(
      this.params.usageSink,
      recordParams(usageMetadata, {
        provider: OPENROUTER_PROVIDER_ID,
        model,
        operation: 'chat.stream',
        ...usageRecordTokens(usage),
        cost,
      }),
      this.params.logger
    );

    yield {
      type: 'done',
      response: {
        provider: OPENROUTER_PROVIDER_ID,
        model,
        text,
        ...(finishReason !== undefined ? { finishReason } : {}),
        usage,
        raw: rawChunks,
      },
    };
  }
}

export class MiniMaxChatProvider {
  private readonly params: MiniMaxChatProviderParams;
  private readonly fetchImpl: FetchLike;

  constructor(params: MiniMaxChatProviderParams) {
    this.params = params;
    this.fetchImpl = params.fetch ?? fetch;
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const model = request.model ?? MINIMAX_CHAT_MODEL;
    const usageMetadata = usageMetadataForRequest(request);
    const providerResponse = await callOpenRouterProvider({
      fetchImpl: this.fetchImpl,
      url: `${this.params.config.baseUrl}/chat/completions`,
      init: {
        method: 'POST',
        headers: miniMaxHeaders(this.params.config),
        body: JSON.stringify(miniMaxChatRequestBody(model, request, false)),
      },
      operation: 'chat.completion',
      requestLabel: 'chat',
      ...(request.signal !== undefined ? { callerSignal: request.signal } : {}),
      ...(this.params.providerCallPolicy !== undefined
        ? { providerCallPolicy: this.params.providerCallPolicy }
        : {}),
      ...(request.providerCallPolicy !== undefined
        ? { requestPolicy: request.providerCallPolicy }
        : {}),
      retryableResponseError: isRetryableChatResponseError,
      handleResponse: async (response) => {
        const body = await readJson(response, 'chat');
        const { text, finishReason, toolCalls } = choiceText(body);
        const rawUsage = body && isRecord(body) ? body['usage'] : undefined;
        const usage = normalizeUsage(
          rawUsage,
          estimateChatInputTokens(request),
          estimateTextTokens(text)
        );

        return {
          body,
          text,
          finishReason,
          ...(toolCalls === undefined ? {} : { toolCalls }),
          usage,
          cost: usageCostFromMiniMax(usage),
        };
      },
    });

    await recordUsage(
      this.params.usageSink,
      recordParams(usageMetadata, {
        provider: MINIMAX_PROVIDER_ID,
        model,
        operation: 'chat.completion',
        ...usageRecordTokens(providerResponse.usage),
        cost: providerResponse.cost,
      }),
      this.params.logger
    );

    return {
      provider: MINIMAX_PROVIDER_ID,
      model,
      text: providerResponse.text,
      ...(providerResponse.finishReason !== undefined
        ? { finishReason: providerResponse.finishReason }
        : {}),
      ...(providerResponse.toolCalls === undefined
        ? {}
        : { toolCalls: providerResponse.toolCalls }),
      usage: providerResponse.usage,
      raw: providerResponse.body,
    };
  }

  async *stream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamEvent> {
    const model = request.model ?? MINIMAX_CHAT_MODEL;
    const usageMetadata = usageMetadataForRequest(request);
    const response = await callOpenRouterProvider({
      fetchImpl: this.fetchImpl,
      url: `${this.params.config.baseUrl}/chat/completions`,
      init: {
        method: 'POST',
        headers: miniMaxHeaders(this.params.config),
        body: JSON.stringify(miniMaxChatRequestBody(model, request, true)),
      },
      operation: 'chat.stream',
      requestLabel: 'chat stream',
      ...(request.signal !== undefined ? { callerSignal: request.signal } : {}),
      ...(this.params.providerCallPolicy !== undefined
        ? { providerCallPolicy: this.params.providerCallPolicy }
        : {}),
      ...(request.providerCallPolicy !== undefined
        ? { requestPolicy: request.providerCallPolicy }
        : {}),
      handleResponse: (providerResponse) => Promise.resolve(providerResponse),
    });

    if (response.body === null) {
      throw new Error('OpenRouter chat stream response did not include a body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let finishReason: string | undefined;
    let usagePayload: unknown;
    const rawChunks: unknown[] = [];
    let parserError: Error | undefined;
    let parsedEvents: EventSourceMessage[] = [];
    const parser = createParser({
      onEvent: (event) => {
        parsedEvents.push(event);
      },
      onError: (error) => {
        parserError = error;
      },
    });

    const handleParsedEvents = function* (): Iterable<ChatCompletionStreamEvent> {
      for (const event of parsedEvents) {
        const parsedEvent = parseStreamEvent(event);
        if (parsedEvent.kind === 'done') {
          continue;
        }
        const payload = parsedEvent.value;

        rawChunks.push(payload);
        const delta = streamChoiceDelta(payload);
        if (delta.finishReason !== undefined) {
          finishReason = delta.finishReason;
        }

        if (isRecord(payload) && payload['usage'] !== undefined) {
          usagePayload = payload['usage'];
        }

        if (delta.text !== undefined) {
          text += delta.text;
          yield { type: 'text_delta', text: delta.text };
        }
      }

      parsedEvents = [];
    };

    const streamPolicy = resolveProviderCallPolicy(
      this.params.providerCallPolicy,
      request.providerCallPolicy
    );
    const streamReadSignal = composeProviderCallSignal({
      callerSignal: request.signal,
      timeoutMs: streamPolicy.timeoutMs,
    });

    try {
      for (;;) {
        const chunk = await readStreamChunk({
          reader,
          ...(streamReadSignal.signal !== undefined ? { signal: streamReadSignal.signal } : {}),
          operation: 'chat.stream',
          requestLabel: 'chat stream',
          ...(streamPolicy.timeoutMs !== undefined ? { timeoutMs: streamPolicy.timeoutMs } : {}),
          timedOut: streamReadSignal.timedOut,
        });
        if (chunk.done) {
          break;
        }

        parser.feed(decoder.decode(chunk.value, { stream: true }));
        if (parserError !== undefined) {
          throw parserError;
        }

        yield* handleParsedEvents();
      }
    } finally {
      if (streamReadSignal.signal?.aborted === true || request.signal?.aborted === true) {
        await reader.cancel().catch(() => undefined);
      }
      streamReadSignal.cleanup();
    }

    parser.feed(decoder.decode());
    parser.reset({ consume: true });
    if (parserError !== undefined) {
      throw parserError;
    }

    yield* handleParsedEvents();

    const usage = normalizeUsage(
      usagePayload,
      estimateChatInputTokens(request),
      estimateTextTokens(text)
    );
    const cost = usageCostFromMiniMax(usage);

    await recordUsage(
      this.params.usageSink,
      recordParams(usageMetadata, {
        provider: MINIMAX_PROVIDER_ID,
        model,
        operation: 'chat.stream',
        ...usageRecordTokens(usage),
        cost,
      }),
      this.params.logger
    );

    yield {
      type: 'done',
      response: {
        provider: MINIMAX_PROVIDER_ID,
        model,
        text,
        ...(finishReason !== undefined ? { finishReason } : {}),
        usage,
        raw: rawChunks,
      },
    };
  }
}

class ProviderSwitchingChatProvider {
  constructor(
    private readonly openRouter: OpenRouterChatProvider,
    private readonly minimax: MiniMaxChatProvider
  ) {}

  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return this.providerFor(request).complete(request);
  }

  stream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamEvent> {
    return this.providerFor(request).stream(request);
  }

  private providerFor(
    request: ChatCompletionRequest
  ): OpenRouterChatProvider | MiniMaxChatProvider {
    return request.provider === MINIMAX_PROVIDER_ID ? this.minimax : this.openRouter;
  }
}

export class OpenRouterEmbeddingProvider {
  private readonly params: OpenRouterEmbeddingProviderParams;
  private readonly fetchImpl: FetchLike;

  constructor(params: OpenRouterEmbeddingProviderParams) {
    this.params = params;
    this.fetchImpl = params.fetch ?? fetch;
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const model = request.model ?? this.params.model;
    const dimensions = request.dimensions ?? this.params.dimensions;
    const usageMetadata = usageMetadataForRequest(request);
    const providerResponse = await callOpenRouterProvider({
      fetchImpl: this.fetchImpl,
      url: `${this.params.config.baseUrl}/embeddings`,
      init: {
        method: 'POST',
        headers: headers(this.params.config, this.params),
        body: JSON.stringify({
          model,
          input: request.input,
          dimensions,
        }),
      },
      operation: 'embedding',
      requestLabel: 'embedding',
      ...(request.signal !== undefined ? { callerSignal: request.signal } : {}),
      ...(this.params.providerCallPolicy !== undefined
        ? { providerCallPolicy: this.params.providerCallPolicy }
        : {}),
      ...(request.providerCallPolicy !== undefined
        ? { requestPolicy: request.providerCallPolicy }
        : {}),
      handleResponse: async (response) => {
        const body = await readJson(response, 'embedding');
        const vectors = embeddingVectors(body, dimensions, embeddingInputCount(request.input));
        const rawUsage = body && isRecord(body) ? body['usage'] : undefined;
        const usage = normalizeUsage(rawUsage, estimateInputTokens(request.input), 0);

        return {
          body,
          vectors,
          usage,
          cost: usageCostFromOpenRouter(rawUsage),
        };
      },
    });

    await recordUsage(
      this.params.usageSink,
      recordParams(usageMetadata, {
        provider: OPENROUTER_PROVIDER_ID,
        model,
        operation: 'embedding',
        ...usageRecordTokens({
          ...providerResponse.usage,
          outputTokens: 0,
          totalTokens: providerResponse.usage.inputTokens,
        }),
        cost: providerResponse.cost,
      }),
      this.params.logger
    );

    return {
      provider: OPENROUTER_PROVIDER_ID,
      model,
      dimensions,
      vectors: providerResponse.vectors,
      usage: {
        ...providerResponse.usage,
        outputTokens: 0,
        totalTokens: providerResponse.usage.inputTokens,
      },
      raw: providerResponse.body,
    };
  }
}

export function createOpenRouterChatProvider(
  params: OpenRouterChatProviderParams
): OpenRouterChatProvider {
  return new OpenRouterChatProvider(params);
}

export function createMiniMaxChatProvider(params: MiniMaxChatProviderParams): MiniMaxChatProvider {
  return new MiniMaxChatProvider(params);
}

export function createOpenRouterEmbeddingProvider(
  params: OpenRouterEmbeddingProviderParams
): OpenRouterEmbeddingProvider {
  return new OpenRouterEmbeddingProvider(params);
}

export function createLlmProviders(params: CreateLlmProvidersParams): LlmProviders {
  const config = resolveLlmProviderConfig(params.env);
  const openRouterChat = createOpenRouterChatProvider({
    config: config.openRouter,
    model: config.chat.model,
    usageSink: params.usageSink,
    ...(params.fetch !== undefined ? { fetch: params.fetch } : {}),
    ...(params.logger !== undefined ? { logger: params.logger } : {}),
    ...(params.referer !== undefined ? { referer: params.referer } : {}),
    ...(params.appTitle !== undefined ? { appTitle: params.appTitle } : {}),
    ...(params.providerCallPolicy !== undefined
      ? { providerCallPolicy: params.providerCallPolicy }
      : {}),
  });
  const miniMaxChat = createMiniMaxChatProvider({
    config: config.minimax,
    usageSink: params.usageSink,
    ...(params.fetch !== undefined ? { fetch: params.fetch } : {}),
    ...(params.logger !== undefined ? { logger: params.logger } : {}),
    ...(params.providerCallPolicy !== undefined
      ? { providerCallPolicy: params.providerCallPolicy }
      : {}),
  });

  return {
    chat: new ProviderSwitchingChatProvider(openRouterChat, miniMaxChat),
    embeddings: createOpenRouterEmbeddingProvider({
      config: config.openRouter,
      model: config.embeddings.model,
      dimensions: config.embeddings.dimensions,
      usageSink: params.usageSink,
      ...(params.fetch !== undefined ? { fetch: params.fetch } : {}),
      ...(params.logger !== undefined ? { logger: params.logger } : {}),
      ...(params.referer !== undefined ? { referer: params.referer } : {}),
      ...(params.appTitle !== undefined ? { appTitle: params.appTitle } : {}),
      ...(params.providerCallPolicy !== undefined
        ? { providerCallPolicy: params.providerCallPolicy }
        : {}),
    }),
  };
}
