import type { LlmPricing } from '../models/pricing.js';
import type { UsageEventInput } from '../models/usageEvent.js';

export function calculateEstimatedCost(input: UsageEventInput, pricing: LlmPricing): number {
  const cost =
    input.source.operation === 'embedding'
      ? (input.usage.totalTokens * (pricing.embeddingUsdPer1M ?? pricing.inputUsdPer1M)) / 1_000_000
      : (input.usage.inputTokens * pricing.inputUsdPer1M +
          input.usage.outputTokens * pricing.outputUsdPer1M) /
        1_000_000;

  return Math.round(cost * 100_000_000) / 100_000_000;
}
