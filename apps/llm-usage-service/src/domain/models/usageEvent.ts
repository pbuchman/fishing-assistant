import { err, FaError, ok, type Result } from '@fa/common-core';

export const DEFAULT_USAGE_EVENTS_LIMIT = 50;
export const MAX_USAGE_EVENTS_LIMIT = 200;

export const usageServices = ['chat-service', 'knowledge-service'] as const;
export const usageOperations = ['chat.completion', 'chat.stream', 'embedding'] as const;
export const usagePromptTypes = [
  'fishing-answer',
  'chat-assistant',
  'answer-grounding-check',
  'answer-repair',
  'rag-query-embedding',
  'knowledge-page-sync-embedding',
  'knowledge-page-reindex-embedding',
  'knowledge-full-sync-embedding',
  'knowledge-document-sync-embedding',
] as const;

export type UsageOwnerType = 'user';
export type UsageService = (typeof usageServices)[number];
export type UsageOperation = (typeof usageOperations)[number];
export type UsagePromptType = (typeof usagePromptTypes)[number];
export type UsageRejectionCode =
  | 'INVALID_USAGE_EVENT'
  | 'INVALID_EVENT_ID'
  | 'INVALID_OWNER'
  | 'INVALID_PROMPT_TYPE'
  | 'INVALID_PROMPT_VERSION'
  | 'RETIRED_USAGE_OWNER_FIELDS'
  | 'PRICING_NOT_FOUND'
  | 'DUPLICATE_EVENT'
  | 'INTERNAL_ERROR';

export interface UsageOwner {
  type: UsageOwnerType;
  id: string;
}

export interface UsageSource {
  service: UsageService;
  component: string;
  operation: UsageOperation;
  promptType: UsagePromptType;
}

export interface UsageRequest {
  provider: string;
  model: string;
  promptVersion: string;
}

export interface UsageTokenCounts {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimated: boolean;
}

export interface UsageCorrelation {
  conversationId?: string;
  messageId?: string;
  knowledgePageId?: string;
  chunkId?: string;
  requestId?: string;
}

export interface UsageError {
  code: string;
  message: string;
}

export type UsageCostSource = 'provider-reported' | 'provider-estimated';

export interface UsageCost {
  estimatedCostUsd: number;
  source?: UsageCostSource;
}

export interface UsageEventInput {
  id: string;
  owner: UsageOwner;
  source: UsageSource;
  request: UsageRequest;
  usage: UsageTokenCounts;
  cost: UsageCost;
  correlation: UsageCorrelation;
  error?: UsageError;
}

export interface LlmUsageEvent extends UsageEventInput {
  createdAt: string;
}

export interface UsageEventsResponse {
  accepted: number;
  duplicates: number;
  rejected: { index: number; id: string | null; code: UsageRejectionCode; message: string }[];
}

export interface ListUsageEventsQuery {
  from: string;
  to: string;
  ownerId: string;
  service?: UsageService;
  operation?: UsageOperation;
  limit: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function failure(code: UsageRejectionCode, message: string): Result<never, FaError> {
  return err(new FaError(code as never, message));
}

function requiredString(
  value: unknown,
  fieldName: string,
  code: UsageRejectionCode = 'INVALID_USAGE_EVENT'
): Result<string, FaError> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return failure(code, `${fieldName} must be a non-empty string`);
  }

  return ok(value.trim());
}

function optionalString(value: unknown, fieldName: string): Result<string | undefined, FaError> {
  if (value === undefined) {
    return ok(undefined);
  }

  return requiredString(value, fieldName);
}

function enumValue<T extends string>(
  value: unknown,
  fieldName: string,
  allowed: readonly T[],
  code: UsageRejectionCode = 'INVALID_USAGE_EVENT'
): Result<T, FaError> {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    return failure(code, `${fieldName} must be one of: ${allowed.join(', ')}`);
  }

  return ok(value as T);
}

function optionalEnumValue<T extends string>(
  value: unknown,
  fieldName: string,
  allowed: readonly T[]
): Result<T | undefined, FaError> {
  if (value === undefined) {
    return ok(undefined);
  }

  return enumValue(value, fieldName, allowed);
}

function nonNegativeSafeInteger(value: unknown, fieldName: string): Result<number, FaError> {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return failure('INVALID_USAGE_EVENT', `${fieldName} must be a non-negative safe integer`);
  }

  return ok(Number(value));
}

function nonNegativeFiniteNumber(value: unknown, fieldName: string): Result<number, FaError> {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return failure('INVALID_USAGE_EVENT', `${fieldName} must be a non-negative finite number`);
  }

  return ok(value);
}

function optionalBoolean(value: unknown, fieldName: string): Result<boolean, FaError> {
  if (value === undefined) {
    return ok(false);
  }

  if (typeof value !== 'boolean') {
    return failure('INVALID_USAGE_EVENT', `${fieldName} must be a boolean`);
  }

  return ok(value);
}

function isoString(value: unknown, fieldName: string): Result<string, FaError> {
  const parsed = requiredString(value, fieldName);
  if (!parsed.ok) {
    return parsed;
  }

  if (Number.isNaN(Date.parse(parsed.value))) {
    return err(new FaError('INVALID_REQUEST', `${fieldName} must be an ISO timestamp`));
  }

  return ok(parsed.value);
}

function hasRetiredOwnerFields(value: Record<string, unknown>): boolean {
  return (
    value['ownerType'] !== undefined ||
    value['ownerId'] !== undefined ||
    value['workspaceId'] !== undefined ||
    value['system'] !== undefined ||
    value['anonymous'] !== undefined
  );
}

function isInvalidOwnerId(value: string): boolean {
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

function parseOwner(value: unknown): Result<UsageOwner, FaError> {
  if (!isRecord(value)) {
    return failure('INVALID_OWNER', 'owner must be an object');
  }

  if (value['type'] !== 'user') {
    return failure('INVALID_OWNER', 'owner.type must be user');
  }

  const id = requiredString(value['id'], 'owner.id', 'INVALID_OWNER');
  if (!id.ok) {
    return id;
  }

  if (isInvalidOwnerId(id.value)) {
    return failure('INVALID_OWNER', 'owner.id must be a real user id');
  }

  return ok({ type: 'user', id: id.value });
}

function parseSource(value: unknown): Result<UsageSource, FaError> {
  if (!isRecord(value)) {
    return failure('INVALID_USAGE_EVENT', 'source must be an object');
  }

  const service = enumValue(value['service'], 'source.service', usageServices);
  if (!service.ok) {
    return service;
  }

  const component = requiredString(value['component'], 'source.component');
  if (!component.ok) {
    return component;
  }

  const operation = enumValue(value['operation'], 'source.operation', usageOperations);
  if (!operation.ok) {
    return operation;
  }

  const promptTypeString = requiredString(
    value['promptType'],
    'source.promptType',
    'INVALID_PROMPT_TYPE'
  );
  if (!promptTypeString.ok) {
    return promptTypeString;
  }

  const promptType = enumValue(
    promptTypeString.value,
    'source.promptType',
    usagePromptTypes,
    'INVALID_PROMPT_TYPE'
  );
  if (!promptType.ok) {
    return promptType;
  }

  return ok({
    service: service.value,
    component: component.value,
    operation: operation.value,
    promptType: promptType.value,
  });
}

function parseRequest(value: unknown): Result<UsageRequest, FaError> {
  if (!isRecord(value)) {
    return failure('INVALID_USAGE_EVENT', 'request must be an object');
  }

  const provider = requiredString(value['provider'], 'request.provider');
  if (!provider.ok) {
    return provider;
  }

  const model = requiredString(value['model'], 'request.model');
  if (!model.ok) {
    return model;
  }

  const promptVersion = requiredString(
    value['promptVersion'],
    'request.promptVersion',
    'INVALID_PROMPT_VERSION'
  );
  if (!promptVersion.ok) {
    return promptVersion;
  }

  return ok({ provider: provider.value, model: model.value, promptVersion: promptVersion.value });
}

function parseUsage(value: unknown): Result<UsageTokenCounts, FaError> {
  if (!isRecord(value)) {
    return failure('INVALID_USAGE_EVENT', 'usage must be an object');
  }

  const inputTokens = nonNegativeSafeInteger(value['inputTokens'], 'usage.inputTokens');
  if (!inputTokens.ok) {
    return inputTokens;
  }

  const outputTokens = nonNegativeSafeInteger(value['outputTokens'], 'usage.outputTokens');
  if (!outputTokens.ok) {
    return outputTokens;
  }

  const totalTokens = nonNegativeSafeInteger(value['totalTokens'], 'usage.totalTokens');
  if (!totalTokens.ok) {
    return totalTokens;
  }

  if (totalTokens.value !== inputTokens.value + outputTokens.value) {
    return failure('INVALID_USAGE_EVENT', 'totalTokens must equal inputTokens + outputTokens');
  }

  const estimated = optionalBoolean(value['estimated'], 'usage.estimated');
  if (!estimated.ok) {
    return estimated;
  }

  return ok({
    inputTokens: inputTokens.value,
    outputTokens: outputTokens.value,
    totalTokens: totalTokens.value,
    estimated: estimated.value,
  });
}

function parseCost(value: unknown): Result<UsageCost, FaError> {
  if (!isRecord(value)) {
    return failure('INVALID_USAGE_EVENT', 'cost must be an object');
  }

  const estimatedCostUsd = nonNegativeFiniteNumber(
    value['estimatedCostUsd'],
    'cost.estimatedCostUsd'
  );
  if (!estimatedCostUsd.ok) {
    return estimatedCostUsd;
  }

  const source = enumValue(value['source'], 'cost.source', [
    'provider-reported',
    'provider-estimated',
  ] as const);
  if (!source.ok) {
    return source;
  }

  return ok({ estimatedCostUsd: estimatedCostUsd.value, source: source.value });
}

function parseCorrelation(value: unknown): Result<UsageCorrelation, FaError> {
  if (value === undefined) {
    return ok({});
  }

  if (!isRecord(value)) {
    return failure('INVALID_USAGE_EVENT', 'correlation must be an object');
  }

  if (
    value['workspaceId'] !== undefined ||
    value['documentId'] !== undefined ||
    value['ownerId'] !== undefined ||
    value['ownerType'] !== undefined
  ) {
    return failure('RETIRED_USAGE_OWNER_FIELDS', 'retired owner fields are not accepted');
  }

  const conversationId = optionalString(value['conversationId'], 'correlation.conversationId');
  if (!conversationId.ok) {
    return conversationId;
  }

  const messageId = optionalString(value['messageId'], 'correlation.messageId');
  if (!messageId.ok) {
    return messageId;
  }

  const knowledgePageId = optionalString(value['knowledgePageId'], 'correlation.knowledgePageId');
  if (!knowledgePageId.ok) {
    return knowledgePageId;
  }

  const chunkId = optionalString(value['chunkId'], 'correlation.chunkId');
  if (!chunkId.ok) {
    return chunkId;
  }

  const requestId = optionalString(value['requestId'], 'correlation.requestId');
  if (!requestId.ok) {
    return requestId;
  }

  return ok({
    ...(conversationId.value !== undefined ? { conversationId: conversationId.value } : {}),
    ...(messageId.value !== undefined ? { messageId: messageId.value } : {}),
    ...(knowledgePageId.value !== undefined ? { knowledgePageId: knowledgePageId.value } : {}),
    ...(chunkId.value !== undefined ? { chunkId: chunkId.value } : {}),
    ...(requestId.value !== undefined ? { requestId: requestId.value } : {}),
  });
}

function parseError(value: unknown): Result<UsageError | undefined, FaError> {
  if (value === undefined) {
    return ok(undefined);
  }

  if (!isRecord(value)) {
    return failure('INVALID_USAGE_EVENT', 'error must be an object');
  }

  const code = requiredString(value['code'], 'error.code');
  if (!code.ok) {
    return code;
  }

  const message = requiredString(value['message'], 'error.message');
  if (!message.ok) {
    return message;
  }

  return ok({ code: code.value, message: 'Provider error details redacted.' });
}

export function parseUsageEventInput(value: unknown): Result<UsageEventInput, FaError> {
  if (!isRecord(value)) {
    return failure('INVALID_USAGE_EVENT', 'usage event must be an object');
  }

  const id = requiredString(value['id'], 'id', 'INVALID_EVENT_ID');
  if (!id.ok) {
    return id;
  }

  if (hasRetiredOwnerFields(value)) {
    return failure('RETIRED_USAGE_OWNER_FIELDS', 'retired owner fields are not accepted');
  }

  if (value['createdAt'] !== undefined) {
    return failure('INVALID_USAGE_EVENT', 'createdAt is assigned by llm-usage-service');
  }

  const owner = parseOwner(value['owner']);
  if (!owner.ok) {
    return owner;
  }

  const source = parseSource(value['source']);
  if (!source.ok) {
    return source;
  }

  const request = parseRequest(value['request']);
  if (!request.ok) {
    return request;
  }

  const usage = parseUsage(value['usage']);
  if (!usage.ok) {
    return usage;
  }

  const cost = parseCost(value['cost']);
  if (!cost.ok) {
    return cost;
  }

  const correlation = parseCorrelation(value['correlation']);
  if (!correlation.ok) {
    return correlation;
  }

  const errorValue = parseError(value['error']);
  if (!errorValue.ok) {
    return errorValue;
  }

  return ok({
    id: id.value,
    owner: owner.value,
    source: source.value,
    request: request.value,
    usage: usage.value,
    cost: cost.value,
    correlation: correlation.value,
    ...(errorValue.value !== undefined ? { error: errorValue.value } : {}),
  });
}

export function parseUsageEventsRequest(value: unknown): Result<unknown[], FaError> {
  if (!isRecord(value) || !Array.isArray(value['events'])) {
    return err(new FaError('INVALID_REQUEST', 'events must be an array'));
  }

  if (value['events'].length === 0) {
    return err(new FaError('INVALID_REQUEST', 'events must not be empty'));
  }

  if (value['events'].length > 100) {
    return err(new FaError('INVALID_REQUEST', 'events must contain at most 100 entries'));
  }

  return ok(value['events']);
}

function limit(value: unknown): Result<number, FaError> {
  if (value === undefined) {
    return ok(DEFAULT_USAGE_EVENTS_LIMIT);
  }

  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || Number(numeric) <= 0) {
    return err(new FaError('INVALID_REQUEST', 'limit must be a positive safe integer'));
  }

  return ok(Math.min(Number(numeric), MAX_USAGE_EVENTS_LIMIT));
}

export function parseUsageEventsQuery(value: unknown): Result<ListUsageEventsQuery, FaError> {
  if (!isRecord(value)) {
    return err(new FaError('INVALID_REQUEST', 'query must be an object'));
  }

  const from = isoString(value['from'], 'from');
  if (!from.ok) {
    return from;
  }

  const to = isoString(value['to'], 'to');
  if (!to.ok) {
    return to;
  }

  if (from.value > to.value) {
    return err(new FaError('INVALID_REQUEST', 'from must be before or equal to to'));
  }

  const ownerId = requiredString(value['ownerId'], 'ownerId');
  if (!ownerId.ok) {
    return ownerId;
  }

  const service = optionalEnumValue(value['service'], 'service', usageServices);
  if (!service.ok) {
    return service;
  }

  const operation = optionalEnumValue(value['operation'], 'operation', usageOperations);
  if (!operation.ok) {
    return operation;
  }

  const resolvedLimit = limit(value['limit']);
  if (!resolvedLimit.ok) {
    return resolvedLimit;
  }

  return ok({
    from: from.value,
    to: to.value,
    ownerId: ownerId.value,
    ...(service.value !== undefined ? { service: service.value } : {}),
    ...(operation.value !== undefined ? { operation: operation.value } : {}),
    limit: resolvedLimit.value,
  });
}
