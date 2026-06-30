import { describe, expect, it } from 'vitest';

import { calculateEstimatedCost } from './costCalculation.js';
import type { LlmPricing } from '../models/pricing.js';
import type { UsageEventInput } from '../models/usageEvent.js';

const chatPricing: LlmPricing = {
  provider: 'openrouter',
  model: 'google/gemini-3.5-flash',
  inputUsdPer1M: 1.5,
  outputUsdPer1M: 9,
  updatedAt: '2026-06-13T00:00:00.000Z',
};

function usage(overrides: Partial<UsageEventInput> = {}): UsageEventInput {
  const base: UsageEventInput = {
    id: 'event-1',
    owner: { type: 'user', id: 'user-123' },
    source: {
      service: 'chat-service',
      component: 'rag-chat',
      operation: 'chat.completion',
      promptType: 'fishing-answer',
    },
    request: {
      provider: 'openrouter',
      model: 'google/gemini-3.5-flash',
      promptVersion: '1.0.0',
    },
    usage: { inputTokens: 1000, outputTokens: 100, totalTokens: 1100, estimated: false },
    cost: { estimatedCostUsd: 0.0024 },
    correlation: {},
  };
  return { ...base, ...overrides };
}

describe('calculateEstimatedCost', () => {
  it('prices chat operations from input and output token rates', () => {
    expect(calculateEstimatedCost(usage(), chatPricing)).toBe(0.0024);
  });

  it('prices embeddings with embedding rate when present', () => {
    expect(
      calculateEstimatedCost(
        usage({
          source: { ...usage().source, operation: 'embedding', promptType: 'rag-query-embedding' },
          usage: { inputTokens: 2048, outputTokens: 0, totalTokens: 2048, estimated: false },
        }),
        {
          provider: 'openrouter',
          model: 'qwen/qwen3-embedding-8b',
          inputUsdPer1M: 2,
          outputUsdPer1M: 0,
          embeddingUsdPer1M: 0.01,
          updatedAt: '2026-06-13T00:00:00.000Z',
        }
      )
    ).toBe(0.00002048);
  });

  it('prices embeddings with the input rate when no embedding rate exists', () => {
    expect(
      calculateEstimatedCost(
        usage({
          source: { ...usage().source, operation: 'embedding', promptType: 'rag-query-embedding' },
          usage: { inputTokens: 2048, outputTokens: 0, totalTokens: 2048, estimated: false },
        }),
        {
          provider: 'openrouter',
          model: 'embedding-without-dedicated-rate',
          inputUsdPer1M: 0.02,
          outputUsdPer1M: 0,
          updatedAt: '2026-06-13T00:00:00.000Z',
        }
      )
    ).toBe(0.00004096);
  });

  it('rounds calculated costs to 8 decimal places', () => {
    expect(
      calculateEstimatedCost(
        usage({ usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1, estimated: false } }),
        {
          provider: 'openrouter',
          model: 'rounding-model',
          inputUsdPer1M: 0.333333333,
          outputUsdPer1M: 0,
          updatedAt: '2026-06-13T00:00:00.000Z',
        }
      )
    ).toBe(0.00000033);
  });
});
