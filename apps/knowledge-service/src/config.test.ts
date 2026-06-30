import { describe, expect, it } from 'vitest';

import { defaultPort, loadConfig, requiredEnv, validateRequiredEnv } from './config.js';

const allRequiredEnv: NodeJS.ProcessEnv = {
  FA_ENVIRONMENT: 'test',
  FA_BIND_HOST: '127.0.0.1',
  FA_GCP_PROJECT_ID: 'fishing-assistant',
  FA_INTERNAL_AUTH_TOKEN: 'test-token',
  FA_AUTH0_ISSUER: 'https://auth.example.com/',
  FA_AUTH0_AUDIENCE: 'fa-api',
  FA_AUTH0_JWKS_URI: 'https://auth.example.com/.well-known/jwks.json',
  FA_WEB_APP_URL: 'https://dev.fishing-assistant.online',
  FA_PUBLIC_ORIGIN: 'https://dev.fishing-assistant.online',
  FA_OPENROUTER_APP_API_KEY: 'openrouter-key',
  FA_MINIMAX_APP_API_KEY: 'minimax-key',
  FA_CHAT_SERVICE_URL: '/api/chat',
  FA_KNOWLEDGE_SERVICE_URL: '/api/knowledge',
  FA_LLM_USAGE_SERVICE_URL: '/api/llm-usage',
  FA_CHAT_SERVICE_INTERNAL_URL: 'http://127.0.0.1:3201',
  FA_KNOWLEDGE_SERVICE_INTERNAL_URL: 'http://127.0.0.1:3202',
  FA_LLM_USAGE_SERVICE_INTERNAL_URL: 'http://127.0.0.1:3203',
  FA_USER_SERVICE_INTERNAL_URL: 'http://127.0.0.1:3204',
};

describe('knowledge-service config validation', () => {
  it('requires common env and the full common service URL map', () => {
    expect(requiredEnv).toEqual([
      'FA_ENVIRONMENT',
      'FA_BIND_HOST',
      'FA_GCP_PROJECT_ID',
      'FA_INTERNAL_AUTH_TOKEN',
      'FA_AUTH0_ISSUER',
      'FA_AUTH0_AUDIENCE',
      'FA_AUTH0_JWKS_URI',
      'FA_WEB_APP_URL',
      'FA_PUBLIC_ORIGIN',
      'FA_OPENROUTER_APP_API_KEY',
      'FA_MINIMAX_APP_API_KEY',
      'FA_CHAT_SERVICE_URL',
      'FA_KNOWLEDGE_SERVICE_URL',
      'FA_LLM_USAGE_SERVICE_URL',
      'FA_CHAT_SERVICE_INTERNAL_URL',
      'FA_KNOWLEDGE_SERVICE_INTERNAL_URL',
      'FA_LLM_USAGE_SERVICE_INTERNAL_URL',
      'FA_USER_SERVICE_INTERNAL_URL',
    ]);
  });

  it('derives CORS allowed origins from the public web env', () => {
    expect(
      loadConfig({
        ...allRequiredEnv,
        FA_ENVIRONMENT: 'prod',
        FA_PUBLIC_ORIGIN: 'https://fishing-assistant.online',
        FA_WEB_APP_URL: 'https://app.fishing-assistant.online',
      }).corsAllowedOrigins
    ).toEqual(['https://fishing-assistant.online', 'https://app.fishing-assistant.online']);
  });

  it('deduplicates configured CORS origins and adds local origins in test', () => {
    expect(loadConfig(allRequiredEnv).corsAllowedOrigins).toEqual([
      'https://dev.fishing-assistant.online',
      'http://localhost:3100',
      'http://127.0.0.1:3100',
    ]);
  });

  it('rejects empty CORS origin env values', () => {
    expect(() => {
      validateRequiredEnv({ ...allRequiredEnv, FA_PUBLIC_ORIGIN: '' });
    }).toThrow('Missing required environment variables: FA_PUBLIC_ORIGIN');
  });

  it('rejects invalid CORS origin values', () => {
    expect(() => {
      loadConfig({
        ...allRequiredEnv,
        FA_WEB_APP_URL: 'https://dev.fishing-assistant.online/app',
      });
    }).toThrow('Invalid FA_WEB_APP_URL origin: https://dev.fishing-assistant.online/app');
  });

  it('rejects a missing cross-service URL env var', () => {
    const env = { ...allRequiredEnv };
    delete env['FA_CHAT_SERVICE_INTERNAL_URL'];

    expect(() => {
      validateRequiredEnv(env);
    }).toThrow('Missing required environment variables: FA_CHAT_SERVICE_INTERNAL_URL');
  });

  it('uses the default service port when PORT is absent', () => {
    const env = { ...allRequiredEnv };
    delete env['PORT'];

    expect(loadConfig(env).port).toBe(defaultPort);
  });

  it('uses default embedding provider config when embedding env overrides are absent', () => {
    expect(loadConfig(allRequiredEnv).embeddingConfig).toEqual({
      provider: 'openrouter',
      model: 'qwen/qwen3-embedding-8b',
      dimensions: 2048,
    });
  });

  it('uses validated embedding provider config from env overrides', () => {
    expect(
      loadConfig({
        ...allRequiredEnv,
        FA_EMBEDDING_PROVIDER: 'openrouter',
        FA_EMBEDDING_MODEL: 'custom/fa-embedding',
        FA_EMBEDDING_DIMENSIONS: '1024',
      }).embeddingConfig
    ).toEqual({
      provider: 'openrouter',
      model: 'custom/fa-embedding',
      dimensions: 1024,
    });
  });

  it('rejects invalid embedding dimensions', () => {
    expect(() => {
      loadConfig({ ...allRequiredEnv, FA_EMBEDDING_DIMENSIONS: '0' });
    }).toThrow('FA_EMBEDDING_DIMENSIONS must be a positive integer');
  });

  it('uses PORT when it is provided', () => {
    expect(loadConfig({ ...allRequiredEnv, PORT: '4212' }).port).toBe(4212);
  });

  it('rejects invalid PORT values', () => {
    expect(() => {
      loadConfig({ ...allRequiredEnv, PORT: 'not-a-port' });
    }).toThrow('Invalid PORT value: not-a-port');
  });
});
