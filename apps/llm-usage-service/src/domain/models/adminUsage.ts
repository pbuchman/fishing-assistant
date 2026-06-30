import { Buffer } from 'node:buffer';

import { err, FaError, ok, type Result } from '@fa/common-core';

import type { UsageMetrics } from './dailyAggregate.js';
import {
  usageOperations,
  usagePromptTypes,
  usageServices,
  type LlmUsageEvent,
  type UsageOperation,
  type UsagePromptType,
  type UsageService,
} from './usageEvent.js';

export const usageTimeBuckets = ['day', 'hour'] as const;
export const usageGroupByValues = [
  'time.bucket',
  'owner.id',
  'request.provider',
  'request.model',
  'source.service',
  'source.component',
  'source.operation',
  'source.promptType',
] as const;
export const usageSortFields = [
  'calls',
  'estimatedCostUsd',
  'inputTokens',
  'outputTokens',
  'totalTokens',
] as const;

export type UsageTimeBucket = (typeof usageTimeBuckets)[number];
export type UsageGroupBy = (typeof usageGroupByValues)[number];
export type UsageSortField = (typeof usageSortFields)[number];

export interface UsageAggregationFilters {
  userIds?: string[];
  providers?: string[];
  models?: string[];
  services?: UsageService[];
  components?: string[];
  operations?: UsageOperation[];
  promptTypes?: UsagePromptType[];
  promptVersions?: string[];
}

export interface UsageEventFilters {
  userIds?: string[];
  providers?: string[];
  models?: string[];
  services?: UsageService[];
  components?: string[];
  operations?: UsageOperation[];
  promptTypes?: UsagePromptType[];
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

export interface NormalizedUsageAggregationQuery {
  timeRange: {
    from: string;
    to: string;
  };
  timeBucket: UsageTimeBucket;
  filters: UsageAggregationFilters;
  groupBy: UsageGroupBy[];
  sortBy: {
    field: UsageSortField;
    direction: 'asc' | 'desc';
  };
  limit: number;
}

export interface UsageEventsQuery {
  timeRange: {
    from: string;
    to: string;
  };
  filters?: UsageEventFilters;
  limit?: number;
  cursor?: string;
}

export interface NormalizedUsageEventsQuery {
  timeRange: {
    from: string;
    to: string;
  };
  filters: UsageEventFilters;
  limit: number;
  cursor?: UsageEventsCursorPosition;
}

export interface UsageDimensionsQuery {
  from?: string;
  to?: string;
  timeRange?: {
    from: string;
    to: string;
  };
  timeBucket?: UsageTimeBucket;
}

export interface NormalizedUsageDimensionsQuery {
  timeRange: {
    from: string;
    to: string;
  };
  timeBucket: UsageTimeBucket;
}

export interface UsageEventsCursorPosition {
  createdAt: string;
  id: string;
}

interface UsageEventsCursorPayload {
  query: UsageEventsCursorQueryShape;
  position: UsageEventsCursorPosition;
}

type UsageEventsCursorQueryShape = Pick<
  NormalizedUsageEventsQuery,
  'timeRange' | 'filters' | 'limit'
>;

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

export interface UsageEventsResponse {
  events: LlmUsageEvent[];
  nextCursor?: string;
}

export interface UsageDimensionsResponse {
  models: string[];
  providers: string[];
  components: string[];
  promptTypes: UsagePromptType[];
  services: UsageService[];
  operations: UsageOperation[];
}

export const zeroUsageMetrics = {
  calls: 0,
  estimatedCostUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCallCount: 0,
  errorCallCount: 0,
} satisfies UsageMetrics;

const DAY_MS = 86_400_000;
const MAX_AGGREGATE_DAY_RANGE_MS = 366 * DAY_MS;
const MAX_AGGREGATE_HOUR_RANGE_MS = 31 * DAY_MS;
const MAX_EVENT_RANGE_MS = 31 * DAY_MS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(message: string): Result<never, FaError> {
  return err(new FaError('INVALID_REQUEST', message));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoTimestamp(value: unknown, fieldName: string): Result<string, FaError> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalid(`${fieldName} must be a non-empty ISO/RFC3339 date-time timestamp`);
  }

  const trimmed = value.trim();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      trimmed
    );
  if (match === null) {
    return invalid(`${fieldName} must be an ISO/RFC3339 date-time timestamp`);
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const offsetText = match[8];
  if (offsetText === undefined) {
    return invalid(`${fieldName} must be an ISO/RFC3339 date-time timestamp`);
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return invalid(`${fieldName} must be an ISO/RFC3339 date-time timestamp`);
  }

  if (offsetText !== 'Z') {
    const offsetHour = Number(offsetText.slice(1, 3));
    const offsetMinute = Number(offsetText.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) {
      return invalid(`${fieldName} must be an ISO/RFC3339 date-time timestamp`);
    }
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return invalid(`${fieldName} must be an ISO/RFC3339 date-time timestamp`);
  }

  return ok(date.toISOString());
}

function stringArray(value: unknown, fieldName: string): Result<string[] | undefined, FaError> {
  if (value === undefined) {
    return ok(undefined);
  }

  if (!Array.isArray(value) || value.length === 0) {
    return invalid(`${fieldName} must be a non-empty array`);
  }

  const output: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      return invalid(`${fieldName}[${String(index)}] must be a non-empty string`);
    }
    output.push(item.trim());
  }

  return ok(output);
}

function enumArray<T extends string>(
  value: unknown,
  fieldName: string,
  allowed: readonly T[]
): Result<T[] | undefined, FaError> {
  const parsed = stringArray(value, fieldName);
  if (!parsed.ok || parsed.value === undefined) {
    return parsed as Result<T[] | undefined, FaError>;
  }

  const output: T[] = [];
  for (const item of parsed.value) {
    if (!allowed.includes(item as T)) {
      return invalid(`${fieldName} contains an unsupported value`);
    }
    output.push(item as T);
  }

  return ok(output);
}

function normalizeLimit(
  value: unknown,
  defaultValue: number,
  maxValue: number
): Result<number, FaError> {
  if (value === undefined) {
    return ok(defaultValue);
  }

  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    return invalid('limit must be a positive safe integer');
  }

  return ok(Math.min(Number(value), maxValue));
}

function normalizeRange(
  value: unknown,
  maxRangeMs: number
): Result<{ from: string; to: string }, FaError> {
  if (!isRecord(value)) {
    return invalid('timeRange must be an object');
  }

  const from = isoTimestamp(value['from'], 'timeRange.from');
  if (!from.ok) {
    return from;
  }

  const to = isoTimestamp(value['to'], 'timeRange.to');
  if (!to.ok) {
    return to;
  }

  const fromMs = Date.parse(from.value);
  const toMs = Date.parse(to.value);
  if (fromMs > toMs) {
    return invalid('timeRange.from must be before or equal to timeRange.to');
  }

  if (toMs - fromMs > maxRangeMs) {
    return invalid('timeRange exceeds the maximum allowed range');
  }

  return ok({ from: from.value, to: to.value });
}

function normalizeAggregateFilters(value: unknown): Result<UsageAggregationFilters, FaError> {
  if (value === undefined) {
    return ok({});
  }
  if (!isRecord(value)) {
    return invalid('filters must be an object');
  }

  const userIds = stringArray(value['userIds'], 'filters.userIds');
  const providers = stringArray(value['providers'], 'filters.providers');
  const models = stringArray(value['models'], 'filters.models');
  const services = enumArray(value['services'], 'filters.services', usageServices);
  const components = stringArray(value['components'], 'filters.components');
  const operations = enumArray(value['operations'], 'filters.operations', usageOperations);
  const promptTypes = enumArray(value['promptTypes'], 'filters.promptTypes', usagePromptTypes);
  const promptVersions = stringArray(value['promptVersions'], 'filters.promptVersions');
  if (!userIds.ok) {
    return userIds;
  }
  if (!providers.ok) {
    return providers;
  }
  if (!models.ok) {
    return models;
  }
  if (!services.ok) {
    return services;
  }
  if (!components.ok) {
    return components;
  }
  if (!operations.ok) {
    return operations;
  }
  if (!promptTypes.ok) {
    return promptTypes;
  }
  if (!promptVersions.ok) {
    return promptVersions;
  }

  return ok({
    ...(userIds.value !== undefined ? { userIds: userIds.value } : {}),
    ...(providers.value !== undefined ? { providers: providers.value } : {}),
    ...(models.value !== undefined ? { models: models.value } : {}),
    ...(services.value !== undefined ? { services: services.value } : {}),
    ...(components.value !== undefined ? { components: components.value } : {}),
    ...(operations.value !== undefined ? { operations: operations.value } : {}),
    ...(promptTypes.value !== undefined ? { promptTypes: promptTypes.value } : {}),
    ...(promptVersions.value !== undefined ? { promptVersions: promptVersions.value } : {}),
  });
}

function normalizeEventFilters(value: unknown): Result<UsageEventFilters, FaError> {
  if (value === undefined) {
    return ok({});
  }
  if (!isRecord(value)) {
    return invalid('filters must be an object');
  }

  if (value['promptVersions'] !== undefined) {
    return invalid('filters.promptVersions is not supported for raw event queries');
  }

  const userIds = stringArray(value['userIds'], 'filters.userIds');
  const providers = stringArray(value['providers'], 'filters.providers');
  const models = stringArray(value['models'], 'filters.models');
  const services = enumArray(value['services'], 'filters.services', usageServices);
  const components = stringArray(value['components'], 'filters.components');
  const operations = enumArray(value['operations'], 'filters.operations', usageOperations);
  const promptTypes = enumArray(value['promptTypes'], 'filters.promptTypes', usagePromptTypes);
  if (!userIds.ok) {
    return userIds;
  }
  if (!providers.ok) {
    return providers;
  }
  if (!models.ok) {
    return models;
  }
  if (!services.ok) {
    return services;
  }
  if (!components.ok) {
    return components;
  }
  if (!operations.ok) {
    return operations;
  }
  if (!promptTypes.ok) {
    return promptTypes;
  }

  return ok({
    ...(userIds.value !== undefined ? { userIds: userIds.value } : {}),
    ...(providers.value !== undefined ? { providers: providers.value } : {}),
    ...(models.value !== undefined ? { models: models.value } : {}),
    ...(services.value !== undefined ? { services: services.value } : {}),
    ...(components.value !== undefined ? { components: components.value } : {}),
    ...(operations.value !== undefined ? { operations: operations.value } : {}),
    ...(promptTypes.value !== undefined ? { promptTypes: promptTypes.value } : {}),
  });
}

function sortedValues<T extends string>(values: readonly T[]): T[] {
  return [...values].sort();
}

export function usageEventsCursorQueryShape(
  query: UsageEventsCursorQueryShape
): UsageEventsCursorQueryShape {
  const filters: UsageEventFilters = {};
  if (query.filters.userIds !== undefined) {
    filters.userIds = sortedValues(query.filters.userIds);
  }
  if (query.filters.providers !== undefined) {
    filters.providers = sortedValues(query.filters.providers);
  }
  if (query.filters.models !== undefined) {
    filters.models = sortedValues(query.filters.models);
  }
  if (query.filters.services !== undefined) {
    filters.services = sortedValues(query.filters.services);
  }
  if (query.filters.components !== undefined) {
    filters.components = sortedValues(query.filters.components);
  }
  if (query.filters.operations !== undefined) {
    filters.operations = sortedValues(query.filters.operations);
  }
  if (query.filters.promptTypes !== undefined) {
    filters.promptTypes = sortedValues(query.filters.promptTypes);
  }

  return {
    timeRange: query.timeRange,
    filters,
    limit: query.limit,
  };
}

function parseUsageEventsCursor(
  value: unknown
): Result<UsageEventsCursorPayload | undefined, FaError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalid('cursor must be a non-empty string');
  }

  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!isRecord(decoded) || !isRecord(decoded['query']) || !isRecord(decoded['position'])) {
      return invalid('cursor is invalid');
    }

    const position = decoded['position'];
    const createdAt = isoTimestamp(position['createdAt'], 'cursor.position.createdAt');
    if (!createdAt.ok) {
      return invalid('cursor is invalid');
    }
    const id = typeof position['id'] === 'string' ? position['id'].trim() : '';
    if (id.length === 0) {
      return invalid('cursor is invalid');
    }

    return ok({
      query: decoded['query'] as UsageEventsCursorQueryShape,
      position: { createdAt: createdAt.value, id },
    });
  } catch {
    return invalid('cursor is invalid');
  }
}

export function encodeUsageEventsCursor(
  query: UsageEventsCursorQueryShape,
  position: UsageEventsCursorPosition
): string {
  return Buffer.from(
    JSON.stringify({ query: usageEventsCursorQueryShape(query), position }),
    'utf8'
  ).toString('base64url');
}

export function normalizeUsageAggregationQuery(
  value: unknown
): Result<NormalizedUsageAggregationQuery, FaError> {
  if (!isRecord(value)) {
    return invalid('query must be an object');
  }

  const timeBucket = value['timeBucket'] === undefined ? 'day' : value['timeBucket'];
  if (!usageTimeBuckets.includes(timeBucket as UsageTimeBucket)) {
    return invalid('timeBucket must be one of: day, hour');
  }

  const timeRange = normalizeRange(
    value['timeRange'],
    timeBucket === 'hour' ? MAX_AGGREGATE_HOUR_RANGE_MS : MAX_AGGREGATE_DAY_RANGE_MS
  );
  if (!timeRange.ok) {
    return timeRange;
  }

  const filters = normalizeAggregateFilters(value['filters']);
  if (!filters.ok) {
    return filters;
  }

  const groupBy =
    value['groupBy'] === undefined
      ? ok(['time.bucket'] satisfies UsageGroupBy[])
      : enumArray(value['groupBy'], 'groupBy', usageGroupByValues);
  if (!groupBy.ok || groupBy.value === undefined) {
    return groupBy.ok ? invalid('groupBy must be a non-empty array') : groupBy;
  }

  const sortBy = value['sortBy'];
  if (sortBy !== undefined && !isRecord(sortBy)) {
    return invalid('sortBy must be an object');
  }
  const sortField = sortBy?.['field'] ?? 'calls';
  if (!usageSortFields.includes(sortField as UsageSortField)) {
    return invalid('sortBy.field contains an unsupported value');
  }
  const sortDirection = sortBy?.['direction'] ?? 'desc';
  if (sortDirection !== 'asc' && sortDirection !== 'desc') {
    return invalid('sortBy.direction must be asc or desc');
  }

  const limit = normalizeLimit(value['limit'], 100, 500);
  if (!limit.ok) {
    return limit;
  }

  return ok({
    timeRange: timeRange.value,
    timeBucket: timeBucket as UsageTimeBucket,
    filters: filters.value,
    groupBy: groupBy.value,
    sortBy: { field: sortField as UsageSortField, direction: sortDirection },
    limit: limit.value,
  });
}

export function normalizeUsageEventsQuery(
  value: unknown
): Result<NormalizedUsageEventsQuery, FaError> {
  if (!isRecord(value)) {
    return invalid('query must be an object');
  }

  const timeRange = normalizeRange(value['timeRange'], MAX_EVENT_RANGE_MS);
  if (!timeRange.ok) {
    return timeRange;
  }

  const filters = normalizeEventFilters(value['filters']);
  if (!filters.ok) {
    return filters;
  }

  const limit = normalizeLimit(value['limit'], 50, 200);
  if (!limit.ok) {
    return limit;
  }

  const cursor = parseUsageEventsCursor(value['cursor']);
  if (!cursor.ok) {
    return cursor;
  }

  const queryShape = usageEventsCursorQueryShape({
    timeRange: timeRange.value,
    filters: filters.value,
    limit: limit.value,
  });
  if (
    cursor.value !== undefined &&
    JSON.stringify(cursor.value.query) !== JSON.stringify(queryShape)
  ) {
    return invalid('cursor does not match the query');
  }

  return ok({
    ...queryShape,
    ...(cursor.value !== undefined ? { cursor: cursor.value.position } : {}),
  });
}

export function normalizeUsageDimensionsQuery(
  value: unknown
): Result<NormalizedUsageDimensionsQuery, FaError> {
  if (!isRecord(value)) {
    return invalid('query must be an object');
  }

  const timeBucket = value['timeBucket'] === undefined ? 'day' : value['timeBucket'];
  if (!usageTimeBuckets.includes(timeBucket as UsageTimeBucket)) {
    return invalid('timeBucket must be one of: day, hour');
  }

  const timeRangeInput = isRecord(value['timeRange'])
    ? value['timeRange']
    : {
        from: value['from'],
        to: value['to'],
      };
  const timeRange = normalizeRange(
    timeRangeInput,
    timeBucket === 'hour' ? MAX_AGGREGATE_HOUR_RANGE_MS : MAX_AGGREGATE_DAY_RANGE_MS
  );
  if (!timeRange.ok) {
    return timeRange;
  }

  return ok({
    timeRange: timeRange.value,
    timeBucket: timeBucket as UsageTimeBucket,
  });
}

export function dayBucket(iso: string): string {
  return iso.slice(0, 10);
}

export function hourBucket(iso: string): string {
  return iso.slice(0, 13);
}

export function bucketRange(
  query: Pick<NormalizedUsageAggregationQuery, 'timeRange' | 'timeBucket'>
): { fromBucket: string; toBucket: string } {
  return {
    fromBucket:
      query.timeBucket === 'hour'
        ? hourBucket(query.timeRange.from)
        : dayBucket(query.timeRange.from),
    toBucket:
      query.timeBucket === 'hour' ? hourBucket(query.timeRange.to) : dayBucket(query.timeRange.to),
  };
}

function includes<T extends string>(values: readonly T[] | undefined, value: T): boolean {
  return values === undefined || values.includes(value);
}

export function eventMatchesAdminQuery(
  event: LlmUsageEvent,
  query: NormalizedUsageEventsQuery
): boolean {
  const filters = query.filters;
  return (
    includes(filters.userIds, event.owner.id) &&
    includes(filters.providers, event.request.provider) &&
    includes(filters.models, event.request.model) &&
    includes(filters.services, event.source.service) &&
    includes(filters.components, event.source.component) &&
    includes(filters.operations, event.source.operation) &&
    includes(filters.promptTypes, event.source.promptType)
  );
}
