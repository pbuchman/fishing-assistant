import { validateRequiredEnv as validateHttpServerRequiredEnv } from '@fa/http-server';

export interface ServiceConfig {
  serviceName: string;
  port: number;
  bindHost: string;
  environment: string;
  corsAllowedOrigins: readonly string[];
}

export const serviceName = 'user-service';
export const serviceVersion = '0.1.0';
export const defaultPort = 3204;

const requiredCommonEnv = [
  'FA_ENVIRONMENT',
  'FA_BIND_HOST',
  'FA_GCP_PROJECT_ID',
  'FA_INTERNAL_AUTH_TOKEN',
  'FA_WEB_APP_URL',
  'FA_PUBLIC_ORIGIN',
] as const;

const requiredAuthEnv = [
  'FA_AUTH0_ISSUER',
  'FA_AUTH0_AUDIENCE',
  'FA_AUTH0_JWKS_URI',
  'FA_AUTH0_DOMAIN',
  'FA_AUTH0_CLIENT_ID',
  'FA_BOOTSTRAP_ADMIN_EMAILS',
  'FA_SIGNUP_ALLOWED_EMAIL_PATTERN',
  'FA_USER_SERVICE_URL',
  'FA_USER_SERVICE_INTERNAL_URL',
] as const;

export const requiredEnv = [...requiredCommonEnv, ...requiredAuthEnv] as const;

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
  };
}
