import multipart from '@fastify/multipart';
import { createSuccessEnvelope } from '@fa/common-http';
import { createServiceApp, type HealthCheck, type ServiceServerOptions } from '@fa/http-server';

import { createDefaultServiceConfig, serviceVersion, type ServiceConfig } from './config.js';
import { registerKnowledgeRoutes } from './routes/knowledgeRoutes.js';
import { getServices } from './services.js';

export interface CreateServerOptions {
  healthChecks?: readonly HealthCheck[] | undefined;
  serverOptions?: ServiceServerOptions | undefined;
}

export async function createServer(
  config: ServiceConfig = createDefaultServiceConfig(),
  options: CreateServerOptions = {}
) {
  return await createServiceApp({
    corsAllowedOrigins: config.corsAllowedOrigins,
    healthChecks: options.healthChecks,
    identity: {
      serviceName: config.serviceName,
      serviceVersion,
      environment: config.environment,
      phase: 'foundation',
    },
    statusMetadata: async () => {
      const services = getServices();
      const status = await services.accessRefreshRepository.getAdminStatus({
        now: services.clock.now().toISOString(),
        recentFailuresLimit: 1,
      });
      if (!status.ok) {
        return { knowledgeAccess: 'degraded' };
      }
      const degraded =
        status.value.jobs.failed > 0 ||
        status.value.jobs.expiredRunning > 0 ||
        status.value.chunks.stale > 0 ||
        status.value.chunks.failed > 0 ||
        status.value.chunks.invalid > 0 ||
        status.value.chunks.mismatch > 0 ||
        status.value.audits.openCritical > 0;
      return { knowledgeAccess: degraded ? 'degraded' : 'healthy' };
    },
    serverOptions: options.serverOptions,
    registerRoutes: async (app) => {
      const services = getServices();
      app.addHook('onReady', () => {
        services.accessRefreshExecutor.start();
      });
      app.addHook('onClose', (_instance, done) => {
        services.accessRefreshExecutor.stop();
        done();
      });

      await app.register(multipart, {
        limits: {
          fileSize: 1_000_000,
          files: 1,
        },
      });

      app.get('/', () => {
        const services = getServices();

        return createSuccessEnvelope({
          service: services.serviceName,
          phase: 'knowledge',
        });
      });

      registerKnowledgeRoutes(app);
    },
  });
}
