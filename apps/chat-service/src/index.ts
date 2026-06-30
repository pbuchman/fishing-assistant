import dotenv from 'dotenv';
import { secretsHealthCheck } from '@fa/http-server';
import { firestoreHealthCheck } from '@fa/infra-firestore';
import { createAppLogger } from '@fa/infra-observability';

import { loadConfig, requiredEnvFor } from './config.js';
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

async function start(): Promise<void> {
  loadEnv();
  const config = loadConfig();
  const logger = createAppLogger({
    service: config.serviceName,
    environment: config.environment,
    sha: process.env['FA_RELEASE_SHA'],
  });
  initRuntimeServices();

  const app = await createServer(config, {
    healthChecks: [secretsHealthCheck(requiredEnvFor(process.env)), firestoreHealthCheck()],
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
  process.stderr.write(`chat-service startup failed: ${message}\n`);
  process.exitCode = 1;
});
