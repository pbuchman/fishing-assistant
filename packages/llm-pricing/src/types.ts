import type { Logger } from '@fa/common-core';

export type UsageService = 'chat-service' | 'knowledge-service';
export type UsageOperation = 'chat.completion' | 'chat.stream' | 'embedding';

export interface UsageOwner {
  type: 'user';
  id: string;
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
  source: UsageCostSource;
}

export interface UsageEventInput {
  id: string;
  owner: UsageOwner;
  source: {
    service: UsageService;
    component: string;
    operation: UsageOperation;
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
  cost: UsageCost;
  correlation: UsageCorrelation;
  error?: UsageError;
}

export interface BuildUsageEventParams {
  id?: string;
  owner?: UsageOwner;
  service: UsageService;
  component: string;
  provider: string;
  model: string;
  operation: UsageOperation;
  promptType?: string;
  promptVersion?: string;
  inputTokens: number;
  outputTokens?: number;
  totalTokens?: number;
  tokenUsageEstimated?: boolean;
  cost?: UsageCost;
  correlation?: UsageCorrelation;
  error?: UsageError;
}

export interface UsageSinkRecordParams {
  id?: string;
  owner?: UsageOwner;
  provider: string;
  model: string;
  operation: UsageOperation;
  promptType?: string;
  promptVersion?: string;
  inputTokens: number;
  outputTokens?: number;
  totalTokens?: number;
  tokenUsageEstimated?: boolean;
  cost: UsageCost;
  correlation?: UsageCorrelation;
  error?: UsageError;
}

export abstract class UsageSink {
  declare private readonly __usageSinkBrand: undefined;

  abstract record(params: UsageSinkRecordParams): Promise<void>;
  abstract flush(options?: FlushOptions): Promise<void>;
}

export interface FlushOptions {
  rethrow?: boolean;
}

export interface UsageSinkConfig {
  service: UsageService;
  component: string;
}

export interface HttpInternalAuthUsageSinkConfig extends UsageSinkConfig {
  usageServiceUrl: string;
  internalAuthToken: string;
  logger: Logger;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  timeoutMs?: number;
}

export interface UsageEventsResponse {
  accepted: number;
  duplicates: number;
  rejected: { index: number; id: string | null; code: string; message: string }[];
}
