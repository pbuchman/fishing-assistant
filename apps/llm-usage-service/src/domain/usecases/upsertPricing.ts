import type { LlmPricing } from '../models/pricing.js';
import type { PricingRepository } from '../repositories/pricingRepository.js';
import type { PricingCache } from '../services/pricingCache.js';

export interface UpsertPricingDeps {
  pricingRepository: PricingRepository;
  pricingCache: PricingCache;
}

export async function upsertPricing(
  deps: UpsertPricingDeps,
  pricing: LlmPricing
): Promise<LlmPricing> {
  await deps.pricingRepository.upsert(pricing);
  deps.pricingCache.invalidate(pricing.provider, pricing.model);
  return pricing;
}
