import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { FaError } from '@fa/common-core';
import {
  createErrorEnvelope,
  registerEnvelopePlugin,
  registerQuietRequestLogging,
} from '@fa/common-http';
import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import type { HealthCheck } from './health.js';
import { registerSystemRoutes, type ServiceIdentity } from './systemRoutes.js';

export type ServiceServerOptions = FastifyServerOptions;

export interface CreateServiceAppOptions {
  identity: ServiceIdentity;
  corsAllowedOrigins?: readonly string[] | undefined;
  healthChecks?: readonly HealthCheck[] | undefined;
  statusMetadata?: (() => Record<string, unknown> | Promise<Record<string, unknown>>) | undefined;
  registerRoutes?: (app: FastifyInstance) => void | Promise<void>;
  serverOptions?: ServiceServerOptions | undefined;
}

function createCorsOriginCallback(allowedOrigins: readonly string[] = []) {
  const allowedOriginSet = new Set(allowedOrigins);

  return (
    origin: string | undefined,
    callback: (error: Error | null, origin: string | boolean) => void
  ): void => {
    if (origin === undefined || origin === '') {
      callback(null, false);
      return;
    }

    callback(null, allowedOriginSet.has(origin) ? origin : false);
  };
}

function isFastifyValidationError(
  error: unknown
): error is Error & { validation?: unknown; code?: string } {
  return (
    error instanceof Error &&
    ('validation' in error || ('code' in error && error.code === 'FST_ERR_VALIDATION'))
  );
}

function createAjvOptions(
  ajvOptions: ServiceServerOptions['ajv'] | undefined
): ServiceServerOptions['ajv'] {
  const baseOptions =
    ajvOptions !== undefined && typeof ajvOptions === 'object' ? { ...ajvOptions } : {};
  const customOptions = 'customOptions' in baseOptions ? { ...baseOptions.customOptions } : {};

  return {
    ...baseOptions,
    customOptions: {
      ...customOptions,
      coerceTypes: false,
      removeAdditional: false,
    },
  } as ServiceServerOptions['ajv'];
}

export async function createServiceApp(options: CreateServiceAppOptions): Promise<FastifyInstance> {
  const serverOptions: ServiceServerOptions = {
    ...options.serverOptions,
    ajv: createAjvOptions(options.serverOptions?.ajv),
    disableRequestLogging: true,
  };
  const app = fastify(serverOptions);

  registerQuietRequestLogging(app);
  registerEnvelopePlugin(app);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof FaError) {
      return reply
        .status(error.httpStatus)
        .send(createErrorEnvelope(error.code, error.message, error.details));
    }

    if (isFastifyValidationError(error)) {
      return reply.status(400).send(
        createErrorEnvelope('INVALID_REQUEST', error.message, {
          validation: error.validation,
        })
      );
    }

    app.log.error({ error }, 'Unhandled request error');
    return reply.status(500).send(createErrorEnvelope('INTERNAL_ERROR', 'Internal server error'));
  });

  await app.register(cors, {
    origin: createCorsOriginCallback(options.corsAllowedOrigins),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: `${options.identity.serviceName} API`,
        version: options.identity.serviceVersion,
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  registerSystemRoutes(app, options.identity, {
    healthChecks: options.healthChecks,
    statusMetadata: options.statusMetadata,
  });

  await options.registerRoutes?.(app);

  return await Promise.resolve(app);
}
