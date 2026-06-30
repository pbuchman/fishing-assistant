import { describe, expect, it } from 'vitest';

import * as webVite from '../run-web-vite.mjs';

const { createSanitizedWebEnv } = webVite;

describe('web Vite environment sanitizer', () => {
  it('detects direct and PM2 script execution as CLI entrypoints', () => {
    const modulePath = '/repo/scripts/run-web-vite.mjs';

    expect(webVite.isWebViteCliEntrypoint(modulePath, ['node', modulePath], {})).toBe(true);
    expect(
      webVite.isWebViteCliEntrypoint(modulePath, ['node', '/pm2/ProcessContainerFork.js'], {
        PM2_HOME: '/tmp/pm2',
        script: modulePath,
      })
    ).toBe(true);
    expect(
      webVite.isWebViteCliEntrypoint(modulePath, ['node', '/pm2/ProcessContainerFork.js'], {
        PM2_HOME: '/tmp/pm2',
        script: '/repo/scripts/other.mjs',
      })
    ).toBe(false);
  });

  it('keeps only browser-safe FA variables while preserving normal process env', () => {
    const sanitized = createSanitizedWebEnv({
      FA_ENVIRONMENT: 'prod',
      FA_PUBLIC_ORIGIN: 'https://fishing-assistant.online',
      FA_AUTH0_DOMAIN: 'auth.example.com',
      FA_AUTH0_CLIENT_ID: 'client-id',
      FA_AUTH0_AUDIENCE: 'https://api.fishing-assistant.online',
      FA_INTERNAL_AUTH_TOKEN: 'secret-token',
      FA_AUTH0_JWKS_URI: 'https://auth.example.com/.well-known/jwks.json',
      FA_BOOTSTRAP_ADMIN_EMAILS: 'admin@example.com',
      FA_OPENROUTER_APP_API_KEY: 'provider-secret',
      FA_MINIMAX_APP_API_KEY: 'minimax-secret',
      PATH: '/usr/bin',
      NODE_ENV: 'production',
    });

    expect(sanitized).toMatchObject({
      FA_ENVIRONMENT: 'prod',
      FA_PUBLIC_ORIGIN: 'https://fishing-assistant.online',
      FA_AUTH0_DOMAIN: 'auth.example.com',
      FA_AUTH0_CLIENT_ID: 'client-id',
      FA_AUTH0_AUDIENCE: 'https://api.fishing-assistant.online',
      PATH: '/usr/bin',
      NODE_ENV: 'production',
    });
    expect(sanitized).not.toHaveProperty('FA_INTERNAL_AUTH_TOKEN');
    expect(sanitized).not.toHaveProperty('FA_AUTH0_JWKS_URI');
    expect(sanitized).not.toHaveProperty('FA_BOOTSTRAP_ADMIN_EMAILS');
    expect(sanitized).not.toHaveProperty('FA_OPENROUTER_APP_API_KEY');
    expect(sanitized).not.toHaveProperty('FA_MINIMAX_APP_API_KEY');
  });

  it('removes backend-only FA variables from the wrapper process environment', () => {
    const env = {
      FA_ENVIRONMENT: 'dev',
      FA_PUBLIC_ORIGIN: 'https://dev.fishing-assistant.online',
      FA_INTERNAL_AUTH_TOKEN: 'secret-token',
      FA_OPENROUTER_APP_API_KEY: 'provider-secret',
      FA_MINIMAX_APP_API_KEY: 'minimax-secret',
      PATH: '/usr/bin',
    };

    expect(webVite.stripUnsafeFaEnvFromProcessEnv).toBeTypeOf('function');
    webVite.stripUnsafeFaEnvFromProcessEnv(env);

    expect(env).toEqual({
      FA_ENVIRONMENT: 'dev',
      FA_PUBLIC_ORIGIN: 'https://dev.fishing-assistant.online',
      PATH: '/usr/bin',
    });
  });
});
