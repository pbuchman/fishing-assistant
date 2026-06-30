import { createSuccessEnvelope } from '@fa/common-http';
import { createServiceApp, type HealthCheck, type ServiceServerOptions } from '@fa/http-server';

import { createDefaultServiceConfig, serviceVersion, type ServiceConfig } from './config.js';
import { registerAdminUserRoutes } from './routes/adminUserRoutes.js';
import { registerInternalAuthorizationRoutes } from './routes/internalAuthorizationRoutes.js';
import { registerUserRoutes } from './routes/userRoutes.js';
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
      phase: 'user-service',
    },
    serverOptions: options.serverOptions,
    registerRoutes: (app) => {
      app.get('/', () => {
        const services = getServices();

        return createSuccessEnvelope({
          service: services.serviceName,
          phase: 'user-service',
        });
      });

      registerUserRoutes(app);
      registerAdminUserRoutes(app);
      registerInternalAuthorizationRoutes(app);
    },
  });
}
