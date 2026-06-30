import { afterEach, describe, expect, it, vi } from 'vitest';

import { getLogLevel } from './logger.js';

describe('logger utilities', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses silent logging in test environments', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'debug');

    expect(getLogLevel()).toBe('silent');
  });

  it.each(['debug', 'info', 'warn', 'error', 'silent'] as const)(
    'supports LOG_LEVEL=%s',
    (level) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('LOG_LEVEL', level);

      expect(getLogLevel()).toBe(level);
    }
  );

  it('falls back to info for missing or unsupported log levels', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOG_LEVEL', 'verbose');

    expect(getLogLevel()).toBe('info');

    vi.stubEnv('LOG_LEVEL', undefined);

    expect(getLogLevel()).toBe('info');
  });
});
