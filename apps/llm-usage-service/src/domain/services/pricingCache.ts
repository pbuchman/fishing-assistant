import type { LlmPricing } from '../models/pricing.js';
import type { PricingRepository } from '../repositories/pricingRepository.js';

export interface PricingCache {
  get(provider: string, model: string): Promise<LlmPricing | null>;
  invalidate(provider: string, model: string): void;
  invalidateAll(): void;
}

interface CacheEntry {
  pricing: LlmPricing | null;
  loadedAt: number;
}

const DEFAULT_TTL_MS = 300_000;

function cacheKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

export function createPricingCache(repo: PricingRepository, ttlMs = DEFAULT_TTL_MS): PricingCache {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<LlmPricing | null>>();

  return {
    async get(provider: string, model: string): Promise<LlmPricing | null> {
      const key = cacheKey(provider, model);
      const now = Date.now();
      const cached = cache.get(key);
      if (cached !== undefined && now - cached.loadedAt < ttlMs) {
        return cached.pricing;
      }

      const loading = inFlight.get(key);
      if (loading !== undefined) {
        return await loading;
      }

      const request = repo
        .get(provider, model)
        .then((pricing) => {
          cache.set(key, { pricing, loadedAt: Date.now() });
          inFlight.delete(key);
          return pricing;
        })
        .catch((error: unknown) => {
          inFlight.delete(key);
          throw error;
        });
      inFlight.set(key, request);

      return await request;
    },

    invalidate(provider: string, model: string): void {
      cache.delete(cacheKey(provider, model));
    },

    invalidateAll(): void {
      cache.clear();
    },
  };
}
