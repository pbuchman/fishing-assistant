import { describe, expect, it } from 'vitest';

import {
  defaultPort,
  loadConfig,
  requiredEnv,
  serviceName,
  serviceVersion,
  validateRequiredEnv,
} from './config.js';

const allRequiredEnv: NodeJS.ProcessEnv = {
  FA_ENVIRONMENT: 'test',
  FA_BIND_HOST: '127.0.0.1',
  FA_GCP_PROJECT_ID: 'fishing-assistant',
  FA_INTERNAL_AUTH_TOKEN: 'current-internal-token',
  FA_WEB_APP_URL: 'https://dev.fishing-assistant.online',
  FA_PUBLIC_ORIGIN: 'https://dev.fishing-assistant.online',
  FA_AUTH0_ISSUER: 'https://auth.example.com/',
  FA_AUTH0_AUDIENCE: 'https://api.fishing-assistant.online',
  FA_AUTH0_JWKS_URI: 'https://auth.example.com/.well-known/jwks.json',
  FA_AUTH0_DOMAIN: 'auth.example.com',
  FA_AUTH0_CLIENT_ID: 'auth0-client-id',
  FA_BOOTSTRAP_ADMIN_EMAILS: 'admin@example.com',
  FA_SIGNUP_ALLOWED_EMAIL_PATTERN: '^[^@\\s]+@example\\.com$',
  FA_USER_SERVICE_URL: '/api/users',
  FA_USER_SERVICE_INTERNAL_URL: 'http://127.0.0.1:3204',
};

describe('user-service config validation', () => {
  it('identifies the user-service runtime shell', () => {
    expect(serviceName).toBe('user-service');
    expect(serviceVersion).toBe('0.1.0');
    expect(defaultPort).toBe(3204);
  });

  it('requires common runtime env and auth/user-service env values', () => {
    expect(requiredEnv).toEqual([
      'FA_ENVIRONMENT',
      'FA_BIND_HOST',
      'FA_GCP_PROJECT_ID',
      'FA_INTERNAL_AUTH_TOKEN',
      'FA_WEB_APP_URL',
      'FA_PUBLIC_ORIGIN',
      'FA_AUTH0_ISSUER',
      'FA_AUTH0_AUDIENCE',
      'FA_AUTH0_JWKS_URI',
      'FA_AUTH0_DOMAIN',
      'FA_AUTH0_CLIENT_ID',
      'FA_BOOTSTRAP_ADMIN_EMAILS',
      'FA_SIGNUP_ALLOWED_EMAIL_PATTERN',
      'FA_USER_SERVICE_URL',
      'FA_USER_SERVICE_INTERNAL_URL',
    ]);
  });

  it('uses the default service port when PORT is absent', () => {
    const env = { ...allRequiredEnv };
    delete env['PORT'];

    expect(loadConfig(env).port).toBe(3204);
  });

  it('uses PORT when it is provided as a positive integer string', () => {
    expect(loadConfig({ ...allRequiredEnv, PORT: '4214' })).toMatchObject({
      port: 4214,
      bindHost: '127.0.0.1',
      environment: 'test',
    });
  });

  it('rejects invalid PORT values', () => {
    for (const port of ['0', '-1', '3.14', 'not-a-port', '']) {
      expect(() => {
        loadConfig({ ...allRequiredEnv, PORT: port });
      }).toThrow(`Invalid PORT value: ${port}`);
    }
  });

  it('derives and deduplicates CORS origins from public web env values', () => {
    expect(loadConfig(allRequiredEnv).corsAllowedOrigins).toEqual([
      'https://dev.fishing-assistant.online',
      'http://localhost:3100',
      'http://127.0.0.1:3100',
    ]);
  });

  it('includes local CORS origins only for test and dev', () => {
    expect(
      loadConfig({
        ...allRequiredEnv,
        FA_ENVIRONMENT: 'dev',
        FA_PUBLIC_ORIGIN: 'https://dev.fishing-assistant.online',
        FA_WEB_APP_URL: 'https://app.dev.fishing-assistant.online',
      }).corsAllowedOrigins
    ).toEqual([
      'https://dev.fishing-assistant.online',
      'https://app.dev.fishing-assistant.online',
      'http://localhost:3100',
      'http://127.0.0.1:3100',
    ]);

    expect(
      loadConfig({
        ...allRequiredEnv,
        FA_ENVIRONMENT: 'prod',
        FA_PUBLIC_ORIGIN: 'https://fishing-assistant.online',
        FA_WEB_APP_URL: 'https://app.fishing-assistant.online',
      }).corsAllowedOrigins
    ).toEqual(['https://fishing-assistant.online', 'https://app.fishing-assistant.online']);
  });

  it('rejects invalid CORS origin values', () => {
    expect(() => {
      loadConfig({
        ...allRequiredEnv,
        FA_PUBLIC_ORIGIN: 'https://dev.fishing-assistant.online/app',
      });
    }).toThrow('Invalid FA_PUBLIC_ORIGIN origin: https://dev.fishing-assistant.online/app');
  });

  it('rejects missing required env values', () => {
    const env = { ...allRequiredEnv };
    delete env['FA_AUTH0_JWKS_URI'];

    expect(() => {
      validateRequiredEnv(env);
    }).toThrow('Missing required environment variables: FA_AUTH0_JWKS_URI');
  });

  it('does not require the previous internal auth token', () => {
    expect(() => {
      validateRequiredEnv(allRequiredEnv);
    }).not.toThrow();

    expect(() => {
      validateRequiredEnv({
        ...allRequiredEnv,
        FA_INTERNAL_AUTH_TOKEN_PREVIOUS: '',
      });
    }).not.toThrow();
  });
});
