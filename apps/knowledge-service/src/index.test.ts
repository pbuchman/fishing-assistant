import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('knowledge-service startup ordering', () => {
  it('loads config before initializing services', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
    const loadConfigIndex = source.indexOf('const config = loadConfig();');
    const initServicesIndex = source.indexOf('initRuntimeServices();');

    expect(loadConfigIndex).toBeGreaterThanOrEqual(0);
    expect(initServicesIndex).toBeGreaterThanOrEqual(0);
    expect(loadConfigIndex).toBeLessThan(initServicesIndex);
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
});
