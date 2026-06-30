import { config } from '../config.js';
import { apiRequest, normalizeApiTimestamp } from './apiClient.js';

export type UsageTimeBucket = 'hour' | 'day';
export type UsageService = 'chat-service' | 'knowledge-service';
export type UsageOperation = 'chat.completion' | 'chat.stream' | 'embedding';
export type UsageGroupBy =
  | 'time.bucket'
  | 'owner.id'
  | 'request.provider'
  | 'request.model'
  | 'source.service'
  | 'source.component'
  | 'source.operation'
  | 'source.promptType';
export type UsageSortField =
  | 'calls'
  | 'estimatedCostUsd'
  | 'inputTokens'
  | 'outputTokens'
  | 'totalTokens';

export interface UsageMetrics {
  calls: number;
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCallCount: number;
  errorCallCount: number;
}

export interface UsageAggregationFilters {
  userIds?: string[];
  providers?: string[];
  models?: string[];
  services?: UsageService[];
  components?: string[];
  operations?: UsageOperation[];
  promptTypes?: string[];
  promptVersions?: string[];
}

export interface UsageEventsFilters {
  userIds?: string[];
  providers?: string[];
  models?: string[];
  services?: UsageService[];
  components?: string[];
  operations?: UsageOperation[];
  promptTypes?: string[];
}

export interface UsageAggregationQuery {
  timeRange: {
    from: string;
    to: string;
  };
  timeBucket?: UsageTimeBucket;
  filters?: UsageAggregationFilters;
  groupBy?: UsageGroupBy[];
  sortBy?: {
    field: UsageSortField;
    direction: 'asc' | 'desc';
  };
  limit?: number;
}

export interface UsageEventsQuery {
  timeRange: {
    from: string;
    to: string;
  };
  filters?: UsageEventsFilters;
  limit?: number;
  cursor?: string;
}

export interface UsageAggregationRow {
  group: Partial<Record<UsageGroupBy, string>>;
  metrics: UsageMetrics;
}

export interface UsageAggregationResponse {
  rows: UsageAggregationRow[];
  totals: UsageMetrics;
  meta: {
    timeRange: {
      from: string;
      to: string;
    };
    timeBucket: UsageTimeBucket;
    groupBy: UsageGroupBy[];
    limit: number;
  };
}

export interface UsageOwner {
  type: 'user';
  id: string;
}

export interface UsageSource {
  service: UsageService;
  component: string;
  operation: UsageOperation;
  promptType: string;
}

export interface UsageRequest {
  provider: string;
  model: string;
  promptVersion?: string;
}

export interface UsageTokenCounts {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimated?: boolean;
}

export interface UsageCorrelation {
  conversationId?: string;
  messageId?: string;
  knowledgePageId?: string;
  chunkId?: string;
  requestId?: string;
}

export interface LlmUsageEvent {
  id: string;
  owner: UsageOwner;
  source: UsageSource;
  request: UsageRequest;
  usage: UsageTokenCounts;
  cost: {
    estimatedCostUsd: number;
  };
  correlation: UsageCorrelation;
  error?: {
    code: string;
    message: string;
  };
  createdAt: string;
}

export interface UsageEventsResponse {
  events: LlmUsageEvent[];
  nextCursor?: string;
}

export interface UsageDimensionsQuery {
  timeRange: {
    from: string;
    to: string;
  };
  timeBucket?: UsageTimeBucket;
}

export interface UsageDimensionsResponse {
  models: string[];
  providers: string[];
  components: string[];
  promptTypes: string[];
  services: UsageService[];
  operations: UsageOperation[];
}

const usageBaseUrl = config.services.LLM_USAGE_SERVICE;

export function recentUsageRange(now = new Date()): { from: string; to: string } {
  const to = new Date(now);
  to.setUTCHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 30);
  from.setUTCHours(0, 0, 0, 0);

  return { from: from.toISOString(), to: to.toISOString() };
}

function jsonRequest(value: unknown): RequestInit {
  return {
    method: 'POST',
    body: JSON.stringify(value),
  };
}

function normalizeUsageEvent(event: LlmUsageEvent): LlmUsageEvent {
  return {
    ...event,
    createdAt: normalizeApiTimestamp(event.createdAt),
  };
}

export async function queryUsageAggregates(
  input: UsageAggregationQuery
): Promise<UsageAggregationResponse> {
  return await apiRequest<UsageAggregationResponse>(
    `${usageBaseUrl}/admin/aggregates/query`,
    jsonRequest(input)
  );
}

export async function queryUsageEvents(input: UsageEventsQuery): Promise<UsageEventsResponse> {
  const response = await apiRequest<UsageEventsResponse>(
    `${usageBaseUrl}/admin/events/query`,
    jsonRequest(input)
  );

  return {
    ...response,
    events: response.events.map(normalizeUsageEvent),
  };
}

export async function getUsageDimensions(
  input: UsageDimensionsQuery
): Promise<UsageDimensionsResponse> {
  const params = new URLSearchParams({
    from: input.timeRange.from,
    to: input.timeRange.to,
    timeBucket: input.timeBucket ?? 'day',
  });
  return await apiRequest<UsageDimensionsResponse>(
    `${usageBaseUrl}/admin/dimensions?${params.toString()}`,
    {
      method: 'GET',
    }
  );
}
