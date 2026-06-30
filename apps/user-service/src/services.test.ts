import type { Logger } from '@fa/common-core';
import { describe, expect, it, vi } from 'vitest';

import { getServices, initServices, resetServices, setServices } from './services.js';

const silentLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('user-service container', () => {
  it('initializes route dependencies with safe defaults', () => {
    resetServices();

    const services = initServices({ logger: silentLogger });

    expect(services).toMatchObject({
      serviceName: 'user-service',
      logger: silentLogger,
      bootstrapAdminEmails: new Set(),
      securityLogHashKey: '',
    });
    expect(services.selfSignupAllowedEmailPattern.test('person@example.com')).toBe(false);
    expect(services.userRepository).toBeDefined();
    expect(services.clock.now()).toBeInstanceOf(Date);
    expect(typeof services.generateId()).toBe('string');
    expect(typeof services.generateEventId()).toBe('string');
    expect(typeof services.auth0JwtVerifier).toBe('function');
  });

  it('keeps test-controlled setServices and resetServices hooks', () => {
    const services = initServices({ logger: silentLogger });
    setServices({
      ...services,
      serviceName: 'test-user-service',
    });

    expect(getServices().serviceName).toBe('test-user-service');
    expect(getServices().logger).toBe(silentLogger);

    resetServices();
    expect(getServices().serviceName).toBe('user-service');
  });
});
