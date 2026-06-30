import { randomUUID } from 'node:crypto';

import type {
  BuildUsageEventParams,
  UsageCorrelation,
  UsageError,
  UsageEventInput,
  UsageOperation,
  UsageOwner,
  UsageService,
  UsageCost,
} from './types.js';

const usageServices = new Set<UsageService>(['chat-service', 'knowledge-service']);
const usageOperations = new Set<UsageOperation>(['chat.completion', 'chat.stream', 'embedding']);

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function safeTokenCount(value: unknown, fieldName: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer`);
  }

  return Number(value);
}

function optionalBoolean(value: unknown, fieldName: string): boolean {
  if (value === undefined) {
    return false;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return value;
}

function nonNegativeFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative finite number`);
  }

  return value;
}

function usageCost(value: UsageCost | undefined): UsageCost {
  if (value === undefined) {
    throw new Error('cost is required');
  }

  const source = requiredString(value.source, 'cost.source');
  if (source !== 'provider-reported' && source !== 'provider-estimated') {
    throw new Error('cost.source must be provider-reported or provider-estimated');
  }

  return {
    estimatedCostUsd: nonNegativeFiniteNumber(value.estimatedCostUsd, 'cost.estimatedCostUsd'),
    source,
  };
}

function service(value: UsageService): UsageService {
  if (!usageServices.has(value)) {
    throw new Error(`service must be one of: ${[...usageServices].join(', ')}`);
  }

  return value;
}

function operation(value: UsageOperation): UsageOperation {
  if (!usageOperations.has(value)) {
    throw new Error(`operation must be one of: ${[...usageOperations].join(', ')}`);
  }

  return value;
}

export function isInvalidUsageOwnerId(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === 'anonymous' ||
    normalized === 'system' ||
    normalized.startsWith('anonymous-workspace') ||
    normalized.startsWith('workspace') ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ||
    /^\+[1-9]\d{7,14}$/.test(normalized) ||
    /^[a-z][a-z0-9_-]*\|.+$/i.test(normalized)
  );
}

function owner(value: UsageOwner | undefined): UsageOwner {
  if (value === undefined) {
    throw new Error('owner is required');
  }

  const rawType = (value as { type: string }).type;
  if (rawType !== 'user') {
    throw new Error('owner.type must be user');
  }

  const id = requiredString(value.id, 'owner.id');
  if (isInvalidUsageOwnerId(id)) {
    throw new Error('owner.id must be a real user id');
  }

  return { type: 'user', id };
}

function correlation(value: UsageCorrelation | undefined): UsageCorrelation {
  if (value === undefined) {
    return {};
  }

  return {
    ...(value.conversationId !== undefined
      ? { conversationId: requiredString(value.conversationId, 'correlation.conversationId') }
      : {}),
    ...(value.messageId !== undefined
      ? { messageId: requiredString(value.messageId, 'correlation.messageId') }
      : {}),
    ...(value.knowledgePageId !== undefined
      ? { knowledgePageId: requiredString(value.knowledgePageId, 'correlation.knowledgePageId') }
      : {}),
    ...(value.chunkId !== undefined
      ? { chunkId: requiredString(value.chunkId, 'correlation.chunkId') }
      : {}),
    ...(value.requestId !== undefined
      ? { requestId: requiredString(value.requestId, 'correlation.requestId') }
      : {}),
  };
}

function error(value: UsageError): UsageError {
  return {
    code: requiredString(value.code, 'error.code'),
    message: requiredString(value.message, 'error.message'),
  };
}

export function buildUsageEvent(params: BuildUsageEventParams): UsageEventInput {
  const id = params.id === undefined ? randomUUID() : requiredString(params.id, 'id');
  const inputTokens = safeTokenCount(params.inputTokens, 'inputTokens');
  const outputTokens = safeTokenCount(params.outputTokens ?? 0, 'outputTokens');
  const totalTokens = safeTokenCount(
    params.totalTokens ?? inputTokens + outputTokens,
    'totalTokens'
  );

  if (totalTokens !== inputTokens + outputTokens) {
    throw new Error('totalTokens must equal inputTokens + outputTokens');
  }

  return {
    id,
    owner: owner(params.owner),
    source: {
      service: service(params.service),
      component: requiredString(params.component, 'component'),
      operation: operation(params.operation),
      promptType: requiredString(params.promptType, 'promptType'),
    },
    request: {
      provider: requiredString(params.provider, 'provider'),
      model: requiredString(params.model, 'model'),
      promptVersion: requiredString(params.promptVersion, 'promptVersion'),
    },
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
      estimated: optionalBoolean(params.tokenUsageEstimated, 'tokenUsageEstimated'),
    },
    cost: usageCost(params.cost),
    correlation: correlation(params.correlation),
    ...(params.error !== undefined ? { error: error(params.error) } : {}),
  };
}
