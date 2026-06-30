import type { LlmPricing } from '../models/pricing.js';

export interface PricingRepository {
  get(provider: string, model: string): Promise<LlmPricing | null>;
  list(): Promise<LlmPricing[]>;
  upsert(pricing: LlmPricing): Promise<void>;
}
