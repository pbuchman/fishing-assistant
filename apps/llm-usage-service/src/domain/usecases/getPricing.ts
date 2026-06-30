import type { LlmPricing } from '../models/pricing.js';
import type { PricingRepository } from '../repositories/pricingRepository.js';

export interface GetPricingDeps {
  pricingRepository: PricingRepository;
}

export async function getPricing(deps: GetPricingDeps): Promise<LlmPricing[]> {
  return await deps.pricingRepository.list();
}
