import { createSuccessEnvelope } from '@fa/common-http';
import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  computeOverallHealth,
  runHealthChecks,
  type HealthCheck,
  type HealthCheckResult,
  type HealthStatus,
} from './health.js';

export interface ServiceIdentity {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  phase?: string;
}

export interface SystemRoutesOptions {
  healthChecks?: readonly HealthCheck[] | undefined;
  statusMetadata?: (() => Record<string, unknown> | Promise<Record<string, unknown>>) | undefined;
}

const coarseHealthStates = new Set(['healthy', 'degraded']);
const sensitiveStatusFieldPattern =
  /(auth0|issuer|jwks|audience|subject|email|mobile|phone|token|secret|user|role|level|source|url|path|audit|backlog|count|chunk|job|key)/iu;
const sensitiveStatusValuePattern =
  /(https?:\/\/|auth0\||Bearer\s+|@|\/[^\s]*\.json\b|jwks|token|secret)/iu;

function systemMetadata(identity: ServiceIdentity) {
  return {
    service: identity.serviceName,
    environment: identity.environment,
    uptime: process.uptime(),
  };
}

function sendJson(reply: FastifyReply, payload: unknown): FastifyReply {
  return reply.type('application/json').send(payload);
}

function healthStatusCode(status: HealthStatus): number {
  return status === 'down' ? 503 : 200;
}

function healthPayload(
  identity: ServiceIdentity,
  status: HealthStatus,
  checks: readonly HealthCheckResult[]
) {
  return {
    ...systemMetadata(identity),
    status,
    checks: checks.map((check) => ({
      name: check.name,
      status: check.status,
      latencyMs: check.latencyMs,
    })),
  };
}

function sanitizeStatusMetadata(metadata: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata).flatMap(([field, value]) => {
      if (sensitiveStatusFieldPattern.test(field) || typeof value !== 'string') {
        return [];
      }

      const trimmed = value.trim();
      if (trimmed === '' || sensitiveStatusValuePattern.test(trimmed)) {
        return [];
      }

      if (field === 'phase') {
        return [[field, trimmed]];
      }

      return coarseHealthStates.has(trimmed) ? [[field, trimmed]] : [];
    })
  );
}

export function registerSystemRoutes(
  app: FastifyInstance,
  identity: ServiceIdentity,
  options: SystemRoutesOptions = {}
): void {
  app.get('/health', async (_request, reply) => {
    if (options.healthChecks === undefined || options.healthChecks.length === 0) {
      return createSuccessEnvelope(systemMetadata(identity));
    }

    const checks = await runHealthChecks(options.healthChecks);
    const status = computeOverallHealth(checks);

    reply.status(healthStatusCode(status));
    return createSuccessEnvelope(healthPayload(identity, status, checks));
  });

  app.get('/status', async () =>
    createSuccessEnvelope({
      ...systemMetadata(identity),
      version: identity.serviceVersion,
      ...(options.statusMetadata === undefined
        ? {}
        : sanitizeStatusMetadata(await options.statusMetadata())),
    })
  );

  app.get('/openapi.json', (_request, reply) => sendJson(reply, app.swagger()));
}
