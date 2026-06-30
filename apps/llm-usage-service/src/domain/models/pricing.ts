import { err, FaError, ok, type Result } from '@fa/common-core';

export interface LlmPricing {
  provider: string;
  model: string;
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  embeddingUsdPer1M?: number;
  updatedAt: string;
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

function nonNegativeNumber(value: unknown, fieldName: string): Result<number, FaError> {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return err(new FaError('INVALID_REQUEST', `${fieldName} must be a non-negative number`));
  }

  return ok(value);
}

function optionalIsoString(value: unknown, fieldName: string): Result<string | undefined, FaError> {
  if (value === undefined) {
    return ok(undefined);
  }

  const parsed = requiredString(value, fieldName);
  if (!parsed.ok) {
    return parsed;
  }

  if (Number.isNaN(Date.parse(parsed.value))) {
    return err(new FaError('INVALID_REQUEST', `${fieldName} must be an ISO timestamp`));
  }

  return ok(parsed.value);
}

export function pricingDocumentId(provider: string, model: string): string {
  return `${encodeURIComponent(provider)}__${encodeURIComponent(model)}`;
}

export function parsePricingInput(
  providerValue: unknown,
  modelValue: unknown,
  value: unknown
): Result<LlmPricing, FaError> {
  const provider = requiredString(providerValue, 'provider');
  if (!provider.ok) {
    return provider;
  }

  const model = requiredString(modelValue, 'model');
  if (!model.ok) {
    return model;
  }

  if (!isRecord(value)) {
    return err(new FaError('INVALID_REQUEST', 'pricing body must be an object'));
  }

  const inputUsdPer1M = nonNegativeNumber(value['inputUsdPer1M'], 'inputUsdPer1M');
  if (!inputUsdPer1M.ok) {
    return inputUsdPer1M;
  }

  const outputUsdPer1M = nonNegativeNumber(value['outputUsdPer1M'], 'outputUsdPer1M');
  if (!outputUsdPer1M.ok) {
    return outputUsdPer1M;
  }

  const embeddingUsdPer1M =
    value['embeddingUsdPer1M'] === undefined
      ? ok(undefined)
      : nonNegativeNumber(value['embeddingUsdPer1M'], 'embeddingUsdPer1M');
  if (!embeddingUsdPer1M.ok) {
    return embeddingUsdPer1M;
  }

  const updatedAt = optionalIsoString(value['updatedAt'], 'updatedAt');
  if (!updatedAt.ok) {
    return updatedAt;
  }

  return ok({
    provider: provider.value,
    model: model.value,
    inputUsdPer1M: inputUsdPer1M.value,
    outputUsdPer1M: outputUsdPer1M.value,
    ...(embeddingUsdPer1M.value !== undefined
      ? { embeddingUsdPer1M: embeddingUsdPer1M.value }
      : {}),
    updatedAt: updatedAt.value ?? new Date().toISOString(),
  });
}
