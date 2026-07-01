import { createSuccessEnvelope } from '@fa/common-http';
import { createServiceApp, type HealthCheck, type ServiceServerOptions } from '@fa/http-server';

import { createDefaultServiceConfig, serviceVersion, type ServiceConfig } from './config.js';
import { registerAdminSettingsRoutes } from './routes/adminSettingsRoutes.js';
import { registerChatRoutes } from './routes/chatRoutes.js';
import { getServices } from './services.js';

export interface CreateServerOptions {
  healthChecks?: readonly HealthCheck[] | undefined;
  serverOptions?: ServiceServerOptions | undefined;
}

type CreateServerConfig = Partial<Omit<ServiceConfig, 'corsAllowedOrigins'>> & {
  corsAllowedOrigins?: ServiceConfig['corsAllowedOrigins'];
};

export async function createServer(
  config: CreateServerConfig = createDefaultServiceConfig(),
  options: CreateServerOptions = {}
) {
  const serviceConfig: ServiceConfig = {
    ...createDefaultServiceConfig(),
    ...config,
  };

  return await createServiceApp({
    corsAllowedOrigins: serviceConfig.corsAllowedOrigins,
    healthChecks: options.healthChecks,
    identity: {
      serviceName: serviceConfig.serviceName,
      serviceVersion,
      environment: serviceConfig.environment,
      phase: 'chat-service',
    },
    serverOptions: options.serverOptions,
    registerRoutes: (app) => {
      app.get('/', () => {
        const services = getServices();

        return createSuccessEnvelope({
          service: services.serviceName,
          phase: 'chat-service',
        });
      });

      registerChatRoutes(app, {
        streamTimeoutMs: serviceConfig.streamTimeoutMs,
        chatTestCompletionKeepAliveMs: serviceConfig.chatTestCompletionKeepAliveMs,
      });
      registerAdminSettingsRoutes(app, {
        serviceName: serviceConfig.serviceName,
        environment: serviceConfig.environment,
        releaseSha: process.env['FA_RELEASE_SHA'] ?? null,
        streamTimeoutMs: serviceConfig.streamTimeoutMs,
        edgeProxyReadTimeoutMs: serviceConfig.environment === 'prod' ? 330_000 : null,
      });
    },
  });
}
