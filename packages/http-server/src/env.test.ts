import { describe, expect, it } from 'vitest';

import { findMissingEnv, validateRequiredEnv } from './env.js';

describe('env validation', () => {
  it('passes when no required env values are missing', () => {
    const env = { FA_ENVIRONMENT: 'test', FA_BIND_HOST: '127.0.0.1' };

    expect(findMissingEnv(['FA_ENVIRONMENT', 'FA_BIND_HOST'], env)).toEqual([]);
    expect(() => {
      validateRequiredEnv(['FA_ENVIRONMENT', 'FA_BIND_HOST'], env);
    }).not.toThrow();
  });

  it('reports missing env names in a stable error message', () => {
    const env = { FA_ENVIRONMENT: 'test' };

    expect(findMissingEnv(['FA_ENVIRONMENT', 'FA_BIND_HOST', 'FA_GCP_PROJECT_ID'], env)).toEqual([
      'FA_BIND_HOST',
      'FA_GCP_PROJECT_ID',
    ]);
    expect(() => {
      validateRequiredEnv(['FA_ENVIRONMENT', 'FA_BIND_HOST', 'FA_GCP_PROJECT_ID'], env);
    }).toThrow('Missing required environment variables: FA_BIND_HOST, FA_GCP_PROJECT_ID');
  });

  it('treats empty strings as missing', () => {
    expect(findMissingEnv(['FA_INTERNAL_AUTH_TOKEN'], { FA_INTERNAL_AUTH_TOKEN: '' })).toEqual([
      'FA_INTERNAL_AUTH_TOKEN',
    ]);
  });
});
