import { systemClock } from '@fa/common-core';
import { validateInternalAuth } from '@fa/common-http';
import { llmUsageEventsRequestBodySchema } from '@fa/http-contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { parseUsageEventsRequest } from '../domain/models/usageEvent.js';
import { ingestUsageEvents } from '../domain/usecases/ingestUsageEvents.js';
import { getServices } from '../services.js';

function logAuthFailure(
  request: FastifyRequest,
  input: {
    event: string;
    routeGroup: 'usage-internal';
    reason: string;
    statusCode: number;
  }
): void {
  request.log.warn(
    {
      event: input.event,
      routeGroup: input.routeGroup,
      method: request.method,
      statusCode: input.statusCode,
      reason: input.reason,
      requestId: request.id,
    },
    'Auth failure'
  );
}

async function validateInternalAuthPreValidation(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | undefined> {
  const authResult = validateInternalAuth(request.headers, process.env);
  if (!authResult.valid) {
    logAuthFailure(request, {
      event: 'auth_internal_failed',
      routeGroup: 'usage-internal',
      reason: 'invalid_internal_auth',
      statusCode: 401,
    });
    return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
  }

  return undefined;
}

export function registerInternalUsageRoutes(app: FastifyInstance): void {
  app.post('/internal/usage-events', {
    preValidation: validateInternalAuthPreValidation,
    schema: { body: llmUsageEventsRequestBodySchema },
    handler: async (request, reply) => {
      const parsed = parseUsageEventsRequest(request.body);
      if (!parsed.ok) {
        return await reply.fail(parsed.error.code, parsed.error.message, parsed.error.details);
      }

      const services = getServices();
      const result = await ingestUsageEvents(
        {
          usageEventRepository: services.usageEventRepository,
          usageAggregateRepository: services.usageAggregateRepository,
          clock: systemClock,
          logger: request.log,
        },
        parsed.value
      );

      return await reply.ok(result);
    },
  });
}
