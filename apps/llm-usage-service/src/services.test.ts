import { describe, expect, it } from 'vitest';

import { getServices, initServices, resetServices, setServices } from './services.js';
import {
  FakePricingRepository,
  FakeUsageAggregateRepository,
  FakeUsageEventRepository,
  silentLogger,
} from './__tests__/fakes/usageRepositories.js';
import { createPricingCache } from './domain/services/pricingCache.js';

describe('llm-usage-service container', () => {
  it('initializes repositories and pricing cache for runtime services', () => {
    resetServices();

    const services = initServices();

    expect(services.serviceName).toBe('llm-usage-service');
    expect(services.usageEventRepository).toBeDefined();
    expect(services.usageAggregateRepository).toBeDefined();
    expect(services.pricingRepository).toBeDefined();
    expect(services.pricingCache).toBeDefined();
  });

  it('keeps test-controlled setServices and resetServices hooks', () => {
    const pricingRepository = new FakePricingRepository();
    const usageEventRepository = new FakeUsageEventRepository();
    const usageAggregateRepository = new FakeUsageAggregateRepository();

    setServices({
      serviceName: 'test-usage-service',
      usageEventRepository,
      usageAggregateRepository,
      pricingRepository,
      pricingCache: createPricingCache(pricingRepository),
      logger: silentLogger,
    });

    expect(getServices().serviceName).toBe('test-usage-service');

    resetServices();
    expect(getServices().serviceName).toBe('llm-usage-service');
  });
});
