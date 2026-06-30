import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('user-service startup ordering', () => {
  it('loads config before initializing services', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
    const loadConfigIndex = source.indexOf('const config = loadConfig();');
    const initServicesIndex = source.indexOf('initRuntimeServices(process.env, { logger });');

    expect(loadConfigIndex).toBeGreaterThanOrEqual(0);
    expect(initServicesIndex).toBeGreaterThanOrEqual(0);
    expect(loadConfigIndex).toBeLessThan(initServicesIndex);
  });

  it('loads .env or FA_ENV_FILE with dotenv before config is read', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
    const loadEnvCallIndex = source.indexOf('loadEnv();');
    const loadConfigIndex = source.indexOf('const config = loadConfig();');

    expect(source).toContain("import dotenv from 'dotenv';");
    expect(source).toContain("const envFile = process.env['FA_ENV_FILE'];");
    expect(source).toContain('dotenv.config({ path: envFile });');
    expect(source).toContain('dotenv.config();');
    expect(loadEnvCallIndex).toBeGreaterThanOrEqual(0);
    expect(loadEnvCallIndex).toBeLessThan(loadConfigIndex);
  });

  it('starts with a structured observability logger instead of Sentry', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain("import { createAppLogger } from '@fa/infra-observability';");
    expect(source).toContain('const logger = createAppLogger({');
    expect(source).toContain('service: config.serviceName');
    expect(source).toContain('environment: config.environment');
    expect(source).toContain("sha: process.env['FA_RELEASE_SHA']");
    expect(source).toContain('serverOptions: { loggerInstance: logger }');
    expect(source).not.toContain('initSentry');
    expect(source).not.toContain('@fa/infra-sentry');
    expect(source).not.toContain('FA_SENTRY_DSN');
    expect(source).not.toContain('serverOptions: { logger: true }');
  });

  it('names user-service in startup failure messages', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain('user-service startup failed:');
  });
});
