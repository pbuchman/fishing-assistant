import { validateRequiredEnv as validateHttpServerRequiredEnv } from '@fa/http-server';
import { resolveLlmProviderConfig } from '@fa/llm-factory';

import type { EmbeddingConfig } from './domain/usecases/syncDocument.js';

export interface ServiceConfig {
  serviceName: string;
  port: number;
  bindHost: string;
  environment: string;
  corsAllowedOrigins: readonly string[];
  embeddingConfig: EmbeddingConfig;
}

export const serviceName = 'knowledge-service';
export const serviceVersion = '0.1.0';
export const defaultPort = 3202;

const requiredCommonEnv = [
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
] as const;

const requiredServiceUrlEnv = [
  'FA_CHAT_SERVICE_URL',
  'FA_KNOWLEDGE_SERVICE_URL',
  'FA_LLM_USAGE_SERVICE_URL',
  'FA_CHAT_SERVICE_INTERNAL_URL',
  'FA_KNOWLEDGE_SERVICE_INTERNAL_URL',
  'FA_LLM_USAGE_SERVICE_INTERNAL_URL',
  'FA_USER_SERVICE_INTERNAL_URL',
] as const;

export const requiredEnv = [...requiredCommonEnv, ...requiredServiceUrlEnv] as const;

export function validateRequiredEnv(env: NodeJS.ProcessEnv = process.env): void {
  validateHttpServerRequiredEnv(requiredEnv, env);
}

export function createDefaultServiceConfig(): ServiceConfig {
  return {
    serviceName,
    port: defaultPort,
    bindHost: '127.0.0.1',
    environment: 'test',
    corsAllowedOrigins: ['http://localhost:3100', 'http://127.0.0.1:3100'],
    embeddingConfig: {
      provider: 'openrouter',
      model: 'qwen/qwen3-embedding-8b',
      dimensions: 2048,
    },
  };
}

function parsePort(env: NodeJS.ProcessEnv): number {
  const rawPort = env['PORT'];

  if (rawPort === undefined) {
    return defaultPort;
  }

  const port = Number(rawPort);

  if (!/^[1-9]\d*$/.test(rawPort) || !Number.isSafeInteger(port)) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  return port;
}

function parseCorsOrigin(env: NodeJS.ProcessEnv, key: 'FA_PUBLIC_ORIGIN' | 'FA_WEB_APP_URL') {
  const rawValue = env[key] ?? '';
  const value = rawValue.trim();

  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== value) {
      throw new Error('origin mismatch');
    }
    return value;
  } catch {
    throw new Error(`Invalid ${key} origin: ${rawValue}`);
  }
}

function shouldAllowLocalOrigins(environment: string): boolean {
  return environment === 'dev' || environment === 'test';
}

function deriveCorsAllowedOrigins(env: NodeJS.ProcessEnv, environment: string): readonly string[] {
  const origins = [
    parseCorsOrigin(env, 'FA_PUBLIC_ORIGIN'),
    parseCorsOrigin(env, 'FA_WEB_APP_URL'),
  ];

  if (shouldAllowLocalOrigins(environment)) {
    origins.push('http://localhost:3100', 'http://127.0.0.1:3100');
  }

  return [...new Set(origins)];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  validateRequiredEnv(env);
  const validatedEnv = env as Record<'FA_BIND_HOST' | 'FA_ENVIRONMENT', string>;
  const bindHost = validatedEnv.FA_BIND_HOST;
  const environment = validatedEnv.FA_ENVIRONMENT;

  return {
    serviceName,
    port: parsePort(env),
    bindHost,
    environment,
    corsAllowedOrigins: deriveCorsAllowedOrigins(env, environment),
    embeddingConfig: resolveLlmProviderConfig(env).embeddings,
  };
}
