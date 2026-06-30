import { describe, expect, it, vi } from 'vitest';

import { createPricingCache } from './pricingCache.js';
import type { LlmPricing } from '../models/pricing.js';
import type { PricingRepository } from '../repositories/pricingRepository.js';
import { getPricing } from '../usecases/getPricing.js';
import { upsertPricing } from '../usecases/upsertPricing.js';

const initialPricing: LlmPricing = {
  provider: 'openrouter',
  model: 'google/gemini-3.5-flash',
  inputUsdPer1M: 1.5,
  outputUsdPer1M: 9,
  updatedAt: '2026-06-13T00:00:00.000Z',
};

describe('createPricingCache', () => {
  it('returns cached pricing until the model is invalidated', async () => {
    const get = vi.fn(() => Promise.resolve(initialPricing));
    const repo: PricingRepository = {
      get,
      list: vi.fn(() => Promise.resolve([initialPricing])),
      upsert: vi.fn(() => Promise.resolve()),
    };
    const cache = createPricingCache(repo, 300_000);

    await expect(cache.get('openrouter', 'google/gemini-3.5-flash')).resolves.toBe(initialPricing);
    await expect(cache.get('openrouter', 'google/gemini-3.5-flash')).resolves.toBe(initialPricing);
    expect(get).toHaveBeenCalledTimes(1);

    cache.invalidate('openrouter', 'google/gemini-3.5-flash');
    await cache.get('openrouter', 'google/gemini-3.5-flash');

    expect(get).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent loads for the same provider/model key', async () => {
    let resolvePricing: ((pricing: LlmPricing | null) => void) | undefined;
    const get = vi.fn(
      () =>
        new Promise<LlmPricing | null>((resolve) => {
          resolvePricing = resolve;
        })
    );
    const repo: PricingRepository = {
      get,
      list: vi.fn(() => Promise.resolve([initialPricing])),
      upsert: vi.fn(() => Promise.resolve()),
    };
    const cache = createPricingCache(repo, 300_000);

    const first = cache.get('openrouter', 'google/gemini-3.5-flash');
    const second = cache.get('openrouter', 'google/gemini-3.5-flash');
    resolvePricing?.(initialPricing);

    await expect(Promise.all([first, second])).resolves.toEqual([initialPricing, initialPricing]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('clears in-flight loads after rejection and supports invalidating all entries', async () => {
    const get = vi
      .fn<PricingRepository['get']>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(initialPricing);
    const repo: PricingRepository = {
      get,
      list: vi.fn(() => Promise.resolve([initialPricing])),
      upsert: vi.fn(() => Promise.resolve()),
    };
    const cache = createPricingCache(repo, 300_000);

    await expect(cache.get('openrouter', 'google/gemini-3.5-flash')).rejects.toThrow('boom');
    await expect(cache.get('openrouter', 'google/gemini-3.5-flash')).resolves.toBe(initialPricing);
    cache.invalidateAll();
    await cache.get('openrouter', 'google/gemini-3.5-flash');

    expect(get).toHaveBeenCalledTimes(3);
  });

  it('lists pricing and invalidates the cached provider/model after admin upsert', async () => {
    const updatedPricing: LlmPricing = {
      ...initialPricing,
      inputUsdPer1M: 2,
      updatedAt: '2026-06-14T00:00:00.000Z',
    };
    const get = vi
      .fn<PricingRepository['get']>()
      .mockResolvedValueOnce(initialPricing)
      .mockResolvedValue(updatedPricing);
    const upsert = vi.fn(() => Promise.resolve());
    const repo: PricingRepository = {
      get,
      list: vi.fn(() => Promise.resolve([initialPricing])),
      upsert,
    };
    const cache = createPricingCache(repo, 300_000);

    await expect(cache.get('openrouter', 'google/gemini-3.5-flash')).resolves.toBe(initialPricing);
    await expect(getPricing({ pricingRepository: repo })).resolves.toEqual([initialPricing]);
    await expect(
      upsertPricing({ pricingRepository: repo, pricingCache: cache }, updatedPricing)
    ).resolves.toBe(updatedPricing);
    await expect(cache.get('openrouter', 'google/gemini-3.5-flash')).resolves.toBe(updatedPricing);

    expect(upsert).toHaveBeenCalledWith(updatedPricing);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
