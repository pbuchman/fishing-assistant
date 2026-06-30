import { getErrorMessage, type ErrorCode } from '@fa/common-core';
import {
  answerGapCandidateCountBucketValues,
  answerGapCoverageClassificationValues,
  type AnswerGap,
  type AnswerGapCoverageProbe,
  type CreateAnswerGapRequest,
  type CreateAnswerGapResponse,
  type WithdrawAnswerGapConsentResponse,
  userLevelValues,
  userRoleValues,
  userStatusValues,
  type ApiEnvelope,
  type AuthorizationContext,
  type AuthorizationResolveRequest,
  type AuthorizationResolveResponse,
  type CurrentUserSummary,
  type InternalUserIdentityLookupRequest,
  type InternalUserIdentityLookupResponse,
  type InternalUserIdentitySummary,
  type RagAuthorizationContext,
  type UserLevel,
  type UserRole,
  type UserStatus,
} from '@fa/http-contracts';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type InternalServiceName = 'knowledge-service' | 'llm-usage-service' | 'user-service';
export type InternalClientErrorCode = ErrorCode | 'INVALID_RESPONSE' | 'ABORTED';

export interface InternalClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface InternalRequestOptions {
  signal?: AbortSignal;
}

export class InternalClientError extends Error {
  readonly code: InternalClientErrorCode;
  readonly service: InternalServiceName;
  readonly statusCode?: number;
  readonly details?: unknown;

  constructor(input: {
    code: InternalClientErrorCode;
    message: string;
    service: InternalServiceName;
    statusCode?: number;
    details?: unknown;
    cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = 'InternalClientError';
    this.code = input.code;
    this.service = input.service;
    if (input.statusCode !== undefined) {
      this.statusCode = input.statusCode;
    }
    if (input.details !== undefined) {
      this.details = input.details;
    }
  }
}

export interface KnowledgeRetrieveRequest {
  authorization: RagAuthorizationContext;
  query: string;
  usageCorrelation?: {
    conversationId?: string;
    messageId?: string;
    requestId?: string;
  };
  conversationContext: {
    latestMessages: KnowledgeConversationMessage[];
  };
  options?: {
    topK?: number;
    expandParentDocuments?: boolean;
  };
}

export interface KnowledgeConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: { sourceId: string; usedFor: string }[];
}

export interface KnowledgeRagEvidence {
  id: string;
  sourceId: string;
  sourceType: 'knowledge_page';
  title: string;
  quote: string;
  content: string;
  score: number;
  url?: string;
  date?: string;
  metadata: Record<string, unknown>;
}

export type KnowledgeRetrieveDiagnostics = Record<string, unknown> & {
  performance?: Record<string, unknown>;
};

export interface KnowledgeRetrieveResponse {
  items: KnowledgeRagEvidence[];
  coverageProbe: AnswerGapCoverageProbe;
  diagnostics: KnowledgeRetrieveDiagnostics;
}

export interface KnowledgeServiceClient {
  retrieve(
    request: KnowledgeRetrieveRequest,
    options?: InternalRequestOptions
  ): Promise<KnowledgeRetrieveResponse>;
  createAnswerGap(
    request: CreateAnswerGapRequest,
    options?: InternalRequestOptions
  ): Promise<CreateAnswerGapResponse>;
  withdrawAnswerGapConsent(
    request: { gapId: string; candidateId: string },
    options?: InternalRequestOptions
  ): Promise<WithdrawAnswerGapConsentResponse>;
}

export interface LlmUsageEventInput {
  id: string;
  owner: { type: 'user'; id: string };
  source: {
    service: 'chat-service' | 'knowledge-service';
    component: string;
    operation: 'chat.completion' | 'chat.stream' | 'embedding';
    promptType: string;
  };
  request: {
    provider: string;
    model: string;
    promptVersion: string;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimated: boolean;
  };
  correlation: {
    conversationId?: string;
    messageId?: string;
    knowledgePageId?: string;
    chunkId?: string;
    requestId?: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface LlmUsageEventsResponse {
  accepted: number;
  duplicates: number;
  rejected: { index: number; id: string | null; code: string; message: string }[];
}

export interface LlmUsageServiceClient {
  ingestUsageEvents(
    events: readonly LlmUsageEventInput[],
    options?: InternalRequestOptions
  ): Promise<LlmUsageEventsResponse>;
}

export interface UserServiceClient {
  resolveAuthorization(
    request: AuthorizationResolveRequest,
    options?: InternalRequestOptions
  ): Promise<AuthorizationResolveResponse>;
  lookupUserIdentities(
    request: InternalUserIdentityLookupRequest,
    options?: InternalRequestOptions
  ): Promise<InternalUserIdentityLookupResponse>;
}

interface InternalPostInput<TResponse> {
  service: InternalServiceName;
  serviceLabel: string;
  fetchImpl: FetchLike;
  baseUrl: string;
  internalAuthToken: string;
  timeoutMs: number | undefined;
  path: string;
  body: unknown;
  options: InternalRequestOptions | undefined;
  parseData: (value: unknown) => TResponse;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/u, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isErrorEnvelope(value: unknown): value is ApiEnvelope<unknown> & { ok: false } {
  return (
    isRecord(value) &&
    value['ok'] === false &&
    isRecord(value['error']) &&
    typeof value['error']['code'] === 'string'
  );
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error['name'] === 'AbortError';
}

function composeSignal(input: { signal: AbortSignal | undefined; timeoutMs: number | undefined }): {
  signal?: AbortSignal;
  cleanup: () => void;
} {
  const timeoutMs = input.timeoutMs;
  if (timeoutMs === undefined || timeoutMs <= 0) {
    return {
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
      cleanup: () => undefined,
    };
  }

  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };
  if (input.signal !== undefined) {
    if (input.signal.aborted) {
      controller.abort();
    } else {
      input.signal.addEventListener('abort', abort, { once: true });
    }
  }

  const timer = setTimeout(abort, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);
    },
  };
}

function parseEnvelope<TResponse>(
  value: unknown,
  input: Pick<InternalPostInput<TResponse>, 'service' | 'serviceLabel' | 'parseData'> & {
    statusCode?: number;
  }
): TResponse {
  if (isErrorEnvelope(value)) {
    const message = value.error.message;
    throw new InternalClientError({
      code: value.error.code,
      message:
        typeof message === 'string'
          ? message
          : `${input.serviceLabel} ${
              input.service === 'knowledge-service' ? 'retrieval' : 'request'
            } failed`,
      service: input.service,
      ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
      details: value.error.details,
    });
  }

  if (!isRecord(value)) {
    throw new InternalClientError({
      code: 'INVALID_RESPONSE',
      message: `${input.serviceLabel} response was not an object`,
      service: input.service,
    });
  }

  if (value['ok'] !== true || !('data' in value)) {
    throw new InternalClientError({
      code: 'INVALID_RESPONSE',
      message: `${input.serviceLabel} response envelope was malformed`,
      service: input.service,
    });
  }

  return input.parseData(value['data']);
}

async function postInternal<TResponse>(input: InternalPostInput<TResponse>): Promise<TResponse> {
  const url = `${input.baseUrl}${input.path}`;
  const signal = composeSignal({
    signal: input.options?.signal,
    timeoutMs: input.timeoutMs,
  });

  try {
    const response = await input.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Auth': input.internalAuthToken,
      },
      body: JSON.stringify(input.body),
      ...(signal.signal !== undefined ? { signal: signal.signal } : {}),
    });

    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch (error) {
      if (!response.ok) {
        throw new InternalClientError({
          code: 'DOWNSTREAM_ERROR',
          message: `${input.serviceLabel} internal request failed with status ${String(
            response.status
          )}`,
          service: input.service,
          statusCode: response.status,
          cause: error,
        });
      }

      throw new InternalClientError({
        code: 'INVALID_RESPONSE',
        message: `${input.serviceLabel} response was not valid JSON`,
        service: input.service,
        cause: error,
      });
    }

    if (!response.ok && !isErrorEnvelope(body)) {
      throw new InternalClientError({
        code: 'DOWNSTREAM_ERROR',
        message: `${input.serviceLabel} internal request failed with status ${String(
          response.status
        )}`,
        service: input.service,
        statusCode: response.status,
      });
    }

    return parseEnvelope(body, {
      ...input,
      ...(response.ok ? {} : { statusCode: response.status }),
    });
  } catch (error) {
    if (error instanceof InternalClientError) {
      throw error;
    }

    if (isAbortError(error)) {
      throw new InternalClientError({
        code: 'ABORTED',
        message: `${input.serviceLabel} internal request was aborted`,
        service: input.service,
        cause: error,
      });
    }

    throw new InternalClientError({
      code: 'DOWNSTREAM_ERROR',
      message: getErrorMessage(error),
      service: input.service,
      cause: error,
    });
  } finally {
    signal.cleanup();
  }
}

function parseKnowledgeData(value: unknown): KnowledgeRetrieveResponse {
  if (!isRecord(value) || !Array.isArray(value['items'])) {
    throw new InternalClientError({
      code: 'INVALID_RESPONSE',
      message: 'Knowledge Service response did not include retrieval data',
      service: 'knowledge-service',
    });
  }

  const coverageProbe = parseCoverageProbe(value['coverageProbe']);
  const items = value['items'] as KnowledgeRagEvidence[];
  for (const [index, item] of items.entries()) {
    if (isRecord(item) && typeof item.url === 'string' && isForbiddenCitationUrl(item.url)) {
      throw new InternalClientError({
        code: 'INVALID_RESPONSE',
        message: `Knowledge Service retrieval item ${String(index)} included a forbidden citation URL`,
        service: 'knowledge-service',
      });
    }
  }

  return {
    items,
    coverageProbe,
    diagnostics: isRecord(value['diagnostics']) ? value['diagnostics'] : {},
  };
}

function parseCreateAnswerGapData(value: unknown): CreateAnswerGapResponse {
  if (!isRecord(value) || !isRecord(value['gap']) || typeof value['created'] !== 'boolean') {
    throw new InternalClientError({
      code: 'INVALID_RESPONSE',
      message: 'Knowledge Service response did not include valid answer gap data',
      service: 'knowledge-service',
    });
  }

  return {
    gap: value['gap'] as unknown as AnswerGap,
    created: value['created'],
  };
}

function parseWithdrawAnswerGapConsentData(value: unknown): WithdrawAnswerGapConsentResponse {
  if (!isRecord(value) || !isRecord(value['gap'])) {
    throw new InternalClientError({
      code: 'INVALID_RESPONSE',
      message: 'Knowledge Service response did not include valid answer gap consent data',
      service: 'knowledge-service',
    });
  }

  return {
    gap: value['gap'] as unknown as AnswerGap,
  };
}

function parseCoverageProbe(value: unknown): AnswerGapCoverageProbe {
  if (!isRecord(value)) {
    throw invalidCoverageProbe();
  }
  const classification = value['classification'];
  const minRequiredLevel = value['minRequiredLevel'];
  const candidateCountBucket = value['candidateCountBucket'];
  const probeVersion = value['probeVersion'];
  if (
    typeof classification !== 'string' ||
    !(answerGapCoverageClassificationValues as readonly string[]).includes(classification) ||
    !(minRequiredLevel === null || Number.isSafeInteger(minRequiredLevel)) ||
    typeof candidateCountBucket !== 'string' ||
    !(answerGapCandidateCountBucketValues as readonly string[]).includes(candidateCountBucket) ||
    probeVersion !== '1.0.0'
  ) {
    throw invalidCoverageProbe();
  }
  return {
    classification,
    minRequiredLevel,
    candidateCountBucket,
    probeVersion,
  } as AnswerGapCoverageProbe;
}

function invalidCoverageProbe(): InternalClientError {
  return new InternalClientError({
    code: 'INVALID_RESPONSE',
    message: 'Knowledge Service response did not include a valid coverage probe',
    service: 'knowledge-service',
  });
}

function isForbiddenCitationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      return true;
    }
    if (url.hash.startsWith('#/')) {
      return true;
    }

    const pathname = url.pathname.toLowerCase();
    return (
      pathname.startsWith('/api/') ||
      pathname.startsWith('/share') ||
      pathname.includes('/admin') ||
      pathname.includes('/editor')
    );
  } catch {
    return true;
  }
}

function parseUsageData(value: unknown): LlmUsageEventsResponse {
  if (
    !isRecord(value) ||
    typeof value['accepted'] !== 'number' ||
    !Number.isFinite(value['accepted']) ||
    typeof value['duplicates'] !== 'number' ||
    !Number.isFinite(value['duplicates']) ||
    !Array.isArray(value['rejected']) ||
    !value['rejected'].every(isRejectedUsageEvent)
  ) {
    throw new InternalClientError({
      code: 'INVALID_RESPONSE',
      message: 'LLM Usage Service response did not include valid usage ingestion data',
      service: 'llm-usage-service',
    });
  }

  return {
    accepted: value['accepted'],
    duplicates: value['duplicates'],
    rejected: value['rejected'],
  };
}

function isRejectedUsageEvent(
  value: unknown
): value is { index: number; id: string | null; code: string; message: string } {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value['index']) &&
    (typeof value['id'] === 'string' || value['id'] === null) &&
    typeof value['code'] === 'string' &&
    typeof value['message'] === 'string'
  );
}

const approvedResolverKeys = ['state', 'user', 'authorization'] as const;
const profileRequiredResolverKeys = ['state', 'user', 'requiredFields'] as const;
const nonApprovedResolverKeys = ['state', 'user'] as const;
const currentUserSummaryKeys = [
  'id',
  'email',
  'firstName',
  'lastName',
  'mobileNumber',
  'role',
  'status',
  'level',
  'effectiveLevel',
] as const;
const authorizationContextKeys = [
  'userId',
  'auth0Subject',
  'email',
  'firstName',
  'lastName',
  'role',
  'status',
  'effectiveLevel',
] as const;
const userIdentityLookupKeys = ['users'] as const;
const userIdentitySummaryKeys = [
  'id',
  'email',
  'firstName',
  'lastName',
  'role',
  'status',
  'effectiveLevel',
] as const;

function parseAuthorizationResolveData(value: unknown): AuthorizationResolveResponse {
  if (!isRecord(value) || typeof value['state'] !== 'string') {
    throw invalidAuthorizationResolveResponse();
  }

  const state = value['state'];
  if (!isUserStatus(state)) {
    throw invalidAuthorizationResolveResponse();
  }

  if (state === 'approved') {
    if (!hasOnlyKeys(value, approvedResolverKeys)) {
      throw invalidAuthorizationResolveResponse();
    }

    const user = parseCurrentUserSummaryForState(value['user'], 'approved');
    const authorization = parseAuthorizationContext(value['authorization']);

    return { state, user, authorization };
  }

  if ('authorization' in value) {
    throw invalidAuthorizationResolveResponse();
  }

  if (state === 'profile_required') {
    if (!hasOnlyKeys(value, profileRequiredResolverKeys)) {
      throw invalidAuthorizationResolveResponse();
    }

    if (!('requiredFields' in value) || !isRequiredFields(value['requiredFields'])) {
      throw invalidAuthorizationResolveResponse();
    }

    const user =
      value['user'] === null
        ? null
        : parseCurrentUserSummaryForState(value['user'], 'profile_required');

    return { state, user, requiredFields: value['requiredFields'] };
  }

  if (!hasOnlyKeys(value, nonApprovedResolverKeys)) {
    throw invalidAuthorizationResolveResponse();
  }

  if (state === 'pending') {
    return { state, user: parseCurrentUserSummaryForState(value['user'], state) };
  }

  if (state === 'rejected') {
    return { state, user: parseCurrentUserSummaryForState(value['user'], state) };
  }

  return { state, user: parseCurrentUserSummaryForState(value['user'], state) };
}

function invalidAuthorizationResolveResponse(): InternalClientError {
  return new InternalClientError({
    code: 'INVALID_RESPONSE',
    message: 'User Service response did not include valid authorization resolver data',
    service: 'user-service',
  });
}

function parseUserIdentityLookupData(value: unknown): InternalUserIdentityLookupResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, userIdentityLookupKeys)) {
    throw invalidUserIdentityLookupResponse();
  }

  const users = value['users'];
  if (!Array.isArray(users)) {
    throw invalidUserIdentityLookupResponse();
  }

  return {
    users: users.map(parseUserIdentitySummary),
  };
}

function parseUserIdentitySummary(value: unknown): InternalUserIdentitySummary {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, userIdentitySummaryKeys) ||
    !isNonEmptyString(value['id']) ||
    !isNonEmptyString(value['email']) ||
    !isNullableNonEmptyString(value['firstName']) ||
    !isNullableNonEmptyString(value['lastName']) ||
    !isUserRole(value['role']) ||
    !isUserStatus(value['status']) ||
    !isUserLevel(value['effectiveLevel'])
  ) {
    throw invalidUserIdentityLookupResponse();
  }

  return {
    id: value['id'],
    email: value['email'],
    firstName: value['firstName'],
    lastName: value['lastName'],
    role: value['role'],
    status: value['status'],
    effectiveLevel: value['effectiveLevel'],
  };
}

function invalidUserIdentityLookupResponse(): InternalClientError {
  return new InternalClientError({
    code: 'INVALID_RESPONSE',
    message: 'User Service response did not include valid user identity lookup data',
    service: 'user-service',
  });
}

function parseCurrentUserSummaryForState<Status extends UserStatus>(
  value: unknown,
  state: Status
): CurrentUserSummary & { status: Status } {
  if (!isCurrentUserSummary(value) || value.status !== state) {
    throw invalidAuthorizationResolveResponse();
  }

  return value as CurrentUserSummary & { status: Status };
}

function parseAuthorizationContext(value: unknown): AuthorizationContext {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, authorizationContextKeys) ||
    !isNonEmptyString(value['userId']) ||
    !isNonEmptyString(value['auth0Subject']) ||
    !isNonEmptyString(value['email']) ||
    !isOptionalNullableNonEmptyString(value['firstName']) ||
    !isOptionalNullableNonEmptyString(value['lastName']) ||
    !isUserRole(value['role']) ||
    value['status'] !== 'approved' ||
    !isUserLevel(value['effectiveLevel'])
  ) {
    throw invalidAuthorizationResolveResponse();
  }

  return {
    userId: value['userId'],
    auth0Subject: value['auth0Subject'],
    email: value['email'],
    ...(value['firstName'] === undefined ? {} : { firstName: value['firstName'] }),
    ...(value['lastName'] === undefined ? {} : { lastName: value['lastName'] }),
    role: value['role'],
    status: 'approved',
    effectiveLevel: value['effectiveLevel'],
  };
}

function isCurrentUserSummary(value: unknown): value is CurrentUserSummary {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, currentUserSummaryKeys) &&
    isNonEmptyString(value['id']) &&
    isNonEmptyString(value['email']) &&
    isNullableNonEmptyString(value['firstName']) &&
    isNullableNonEmptyString(value['lastName']) &&
    isNullableNonEmptyString(value['mobileNumber']) &&
    isUserRole(value['role']) &&
    isUserStatus(value['status']) &&
    isUserLevelOrNull(value['level']) &&
    isUserLevel(value['effectiveLevel'])
  );
}

function isRequiredFields(value: unknown): value is ('firstName' | 'lastName' | 'mobileNumber')[] {
  return (
    Array.isArray(value) &&
    value.every((item) => item === 'firstName' || item === 'lastName' || item === 'mobileNumber')
  );
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isOptionalNullableNonEmptyString(value: unknown): value is string | null | undefined {
  return value === undefined || isNullableNonEmptyString(value);
}

function isUserStatus(value: unknown): value is UserStatus {
  return typeof value === 'string' && (userStatusValues as readonly string[]).includes(value);
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (userRoleValues as readonly string[]).includes(value);
}

function isUserLevel(value: unknown): value is UserLevel {
  return typeof value === 'number' && (userLevelValues as readonly number[]).includes(value);
}

function isUserLevelOrNull(value: unknown): value is UserLevel | null {
  return value === null || isUserLevel(value);
}

function serializeAuthorizationResolveRequest(
  request: AuthorizationResolveRequest
): AuthorizationResolveRequest {
  return {
    auth0: {
      subject: request.auth0.subject,
      ...(request.auth0.email !== undefined ? { email: request.auth0.email } : {}),
      ...(request.auth0.emailVerified !== undefined
        ? { emailVerified: request.auth0.emailVerified }
        : {}),
      ...(request.auth0.name !== undefined ? { name: request.auth0.name } : {}),
    },
  };
}

function serializeUserIdentityLookupRequest(
  request: InternalUserIdentityLookupRequest
): InternalUserIdentityLookupRequest {
  return {
    userIds: request.userIds,
  };
}

export function createKnowledgeServiceClient(config: InternalClientConfig): KnowledgeServiceClient {
  const baseUrl = trimTrailingSlashes(config.baseUrl);
  const fetchImpl = config.fetch ?? fetch;

  return {
    retrieve(request, options) {
      return postInternal({
        service: 'knowledge-service',
        serviceLabel: 'Knowledge Service',
        fetchImpl,
        baseUrl,
        internalAuthToken: config.internalAuthToken,
        timeoutMs: config.timeoutMs,
        path: '/internal/retrieve',
        body: request,
        options,
        parseData: parseKnowledgeData,
      });
    },
    createAnswerGap(request, options) {
      return postInternal({
        service: 'knowledge-service',
        serviceLabel: 'Knowledge Service',
        fetchImpl,
        baseUrl,
        internalAuthToken: config.internalAuthToken,
        timeoutMs: config.timeoutMs,
        path: '/internal/answer-gaps',
        body: request,
        options,
        parseData: parseCreateAnswerGapData,
      });
    },
    withdrawAnswerGapConsent(request, options) {
      return postInternal({
        service: 'knowledge-service',
        serviceLabel: 'Knowledge Service',
        fetchImpl,
        baseUrl,
        internalAuthToken: config.internalAuthToken,
        timeoutMs: config.timeoutMs,
        path: `/internal/answer-gaps/${encodeURIComponent(request.gapId)}/consent-withdrawal`,
        body: { candidateId: request.candidateId },
        options,
        parseData: parseWithdrawAnswerGapConsentData,
      });
    },
  };
}

export function createLlmUsageServiceClient(config: InternalClientConfig): LlmUsageServiceClient {
  const baseUrl = trimTrailingSlashes(config.baseUrl);
  const fetchImpl = config.fetch ?? fetch;

  return {
    ingestUsageEvents(events, options) {
      return postInternal({
        service: 'llm-usage-service',
        serviceLabel: 'LLM Usage Service',
        fetchImpl,
        baseUrl,
        internalAuthToken: config.internalAuthToken,
        timeoutMs: config.timeoutMs,
        path: '/internal/usage-events',
        body: { events },
        options,
        parseData: parseUsageData,
      });
    },
  };
}

export function createUserServiceClient(config: InternalClientConfig): UserServiceClient {
  const baseUrl = trimTrailingSlashes(config.baseUrl);
  const fetchImpl = config.fetch ?? fetch;

  return {
    resolveAuthorization(request, options) {
      return postInternal({
        service: 'user-service',
        serviceLabel: 'User Service',
        fetchImpl,
        baseUrl,
        internalAuthToken: config.internalAuthToken,
        timeoutMs: config.timeoutMs,
        path: '/internal/authorization/resolve',
        body: serializeAuthorizationResolveRequest(request),
        options,
        parseData: parseAuthorizationResolveData,
      });
    },
    lookupUserIdentities(request, options) {
      return postInternal({
        service: 'user-service',
        serviceLabel: 'User Service',
        fetchImpl,
        baseUrl,
        internalAuthToken: config.internalAuthToken,
        timeoutMs: config.timeoutMs,
        path: '/internal/users/lookup',
        body: serializeUserIdentityLookupRequest(request),
        options,
        parseData: parseUserIdentityLookupData,
      });
    },
  };
}
