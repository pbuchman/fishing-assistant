import type { ErrorCode } from '@fa/common-core';
import {
  llmUsageAdminAggregateQueryBodySchema,
  llmUsageAdminDimensionsQuerySchema,
  llmUsageAdminEventParamsSchema,
  llmUsageAdminEventsQueryBodySchema,
} from '@fa/http-contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  getAdminUsageEvent,
  listUsageDimensions,
  queryAdminUsageEvents,
} from '../domain/usecases/adminUsageEvents.js';
import { queryUsageAggregates } from '../domain/usecases/listUsageAggregates.js';
import { getServices } from '../services.js';
import { requireApprovedAdminAuth } from './authPreHandlers.js';

interface EventParams {
  eventId: string;
}

function routeErrorCode(code: string): ErrorCode {
  switch (code) {
    case 'INVALID_REQUEST':
    case 'NOT_FOUND':
    case 'INTERNAL_ERROR':
      return code;
    default:
      return 'INTERNAL_ERROR';
  }
}

async function sendDomainResponse<T>(reply: FastifyReply, work: Promise<T>) {
  try {
    return await reply.ok(await work);
  } catch (error) {
    const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
    const code =
      typeof candidate.code === 'string' ? routeErrorCode(candidate.code) : 'INTERNAL_ERROR';
    const message =
      typeof candidate.message === 'string' ? candidate.message : 'Usage reporting failed';
    return await reply.fail(code, message, candidate.details);
  }
}

export function registerAdminUsageRoutes(app: FastifyInstance): void {
  app.post('/admin/aggregates/query', {
    preValidation: requireApprovedAdminAuth,
    schema: { body: llmUsageAdminAggregateQueryBodySchema },
    handler: async (request, reply) =>
      await sendDomainResponse(
        reply,
        queryUsageAggregates(
          { usageAggregateRepository: getServices().usageAggregateRepository },
          request.body
        )
      ),
  });

  app.post('/admin/events/query', {
    preValidation: requireApprovedAdminAuth,
    schema: { body: llmUsageAdminEventsQueryBodySchema },
    handler: async (request, reply) =>
      await sendDomainResponse(
        reply,
        queryAdminUsageEvents(
          { usageEventRepository: getServices().usageEventRepository },
          request.body
        )
      ),
  });

  app.get('/admin/events/:eventId', {
    preValidation: requireApprovedAdminAuth,
    schema: { params: llmUsageAdminEventParamsSchema },
    handler: async (request, reply) => {
      try {
        const { eventId } = request.params as EventParams;
        const event = await getAdminUsageEvent(
          { usageEventRepository: getServices().usageEventRepository },
          eventId
        );
        if (event === null) {
          return await reply.fail('NOT_FOUND', 'Usage event was not found.');
        }

        return await reply.ok(event);
      } catch (error) {
        const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
        const code =
          typeof candidate.code === 'string' ? routeErrorCode(candidate.code) : 'INTERNAL_ERROR';
        const message =
          typeof candidate.message === 'string' ? candidate.message : 'Usage reporting failed';
        return await reply.fail(code, message, candidate.details);
      }
    },
  });

  app.get('/admin/dimensions', {
    preValidation: requireApprovedAdminAuth,
    schema: { querystring: llmUsageAdminDimensionsQuerySchema },
    handler: async (request, reply) =>
      await sendDomainResponse(
        reply,
        listUsageDimensions(
          { usageAggregateRepository: getServices().usageAggregateRepository },
          request.query
        )
      ),
  });
}
