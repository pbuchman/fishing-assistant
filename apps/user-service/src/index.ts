import dotenv from 'dotenv';
import { findMissingEnv, type HealthCheck } from '@fa/http-server';
import { createAppLogger } from '@fa/infra-observability';

import { loadConfig, requiredEnv } from './config.js';
import { createServer } from './server.js';
import { initRuntimeServices } from './services.js';

function loadEnv(): void {
  const envFile = process.env['FA_ENV_FILE'];

  if (envFile) {
    dotenv.config({ path: envFile });
    return;
  }

  dotenv.config();
}

function createRequiredEnvHealthCheck(
  required: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): HealthCheck {
  return {
    name: 'secrets',
    check() {
      return Promise.resolve(
        findMissingEnv(required, env).length === 0
          ? { ok: true }
          : { ok: false, detail: 'missing required runtime configuration' }
      );
    },
  };
}

async function start(): Promise<void> {
  loadEnv();
  const config = loadConfig();
  const logger = createAppLogger({
    service: config.serviceName,
    environment: config.environment,
    sha: process.env['FA_RELEASE_SHA'],
  });
  initRuntimeServices(process.env, { logger });

  const app = await createServer(config, {
    healthChecks: [createRequiredEnvHealthCheck(requiredEnv)],
    serverOptions: { loggerInstance: logger },
  });
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    app.log.info({ signal }, 'shutting down service');
    await app.close();
  };

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });

  await app.listen({ host: config.bindHost, port: config.port });
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`user-service startup failed: ${message}\n`);
  process.exitCode = 1;
});
