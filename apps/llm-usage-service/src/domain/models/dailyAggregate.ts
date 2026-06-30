import { err, FaError, ok, type Result } from '@fa/common-core';

import type { UsageOperation, UsageOwner, UsageService, UsageSource } from './usageEvent.js';

export interface UsageMetrics {
  calls: number;
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCallCount: number;
  errorCallCount: number;
}

export interface LlmUsageDailyAggregate {
  id: string;
  bucket: {
    day: string;
    hour: string;
  };
  owner: UsageOwner;
  source: UsageSource;
  request: {
    provider: string;
    model: string;
    promptVersion: string;
  };
  metrics: UsageMetrics;
  firstEventAt: string;
  lastEventAt: string;
  updatedAt: string;
}

export interface ListDailyUsageQuery {
  from: string;
  to: string;
  ownerId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, fieldName: string): Result<string, FaError> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return err(new FaError('INVALID_REQUEST', `${fieldName} must be a non-empty string`));
  }

  return ok(value.trim());
}

function dateString(value: unknown, fieldName: string): Result<string, FaError> {
  const parsed = requiredString(value, fieldName);
  if (!parsed.ok) {
    return parsed;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.value) || Number.isNaN(Date.parse(parsed.value))) {
    return err(new FaError('INVALID_REQUEST', `${fieldName} must be YYYY-MM-DD`));
  }

  return ok(parsed.value);
}

export function parseDailyUsageQuery(value: unknown): Result<ListDailyUsageQuery, FaError> {
  if (!isRecord(value)) {
    return err(new FaError('INVALID_REQUEST', 'query must be an object'));
  }

  const from = dateString(value['from'], 'from');
  if (!from.ok) {
    return from;
  }

  const to = dateString(value['to'], 'to');
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

  return ok({ from: from.value, to: to.value, ownerId: ownerId.value });
}

export type AggregateUsageService = UsageService;
export type AggregateUsageOperation = UsageOperation;
