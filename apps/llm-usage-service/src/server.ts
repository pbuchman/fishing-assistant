import { createSuccessEnvelope } from '@fa/common-http';
import { createServiceApp, type HealthCheck, type ServiceServerOptions } from '@fa/http-server';

import { createDefaultServiceConfig, serviceVersion, type ServiceConfig } from './config.js';
import { registerUsageRoutes } from './routes/index.js';
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
      phase: 'usage',
    },
    serverOptions: options.serverOptions,
    registerRoutes: (app) => {
      app.get('/', () => {
        const services = getServices();

        return createSuccessEnvelope({
          service: services.serviceName,
          phase: 'usage',
        });
      });

      registerUsageRoutes(app);
    },
  });
}
