import { extractBearerToken, readAuth0JwtConfigFromEnv } from '@fa/common-http';
import type { AuthorizationContext } from '@fa/http-contracts';
import { InternalClientError } from '@fa/internal-clients';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { getServices } from '../services.js';

declare module 'fastify' {
  interface FastifyRequest {
    faApprovedAuthorization?: AuthorizationContext;
  }
}

function hasAuthorizationHeader(headers: FastifyRequest['headers']): boolean {
  return Object.keys(headers).some((header) => header.toLowerCase() === 'authorization');
}

function logAuthFailure(
  request: FastifyRequest,
  input: {
    event: string;
    routeGroup: 'usage-admin';
    reason: string;
    statusCode: number;
    role?: AuthorizationContext['role'];
    accountState?:
      | AuthorizationContext['status']
      | 'profile_required'
      | 'pending'
      | 'rejected'
      | 'suspended';
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
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.accountState === undefined ? {} : { accountState: input.accountState }),
    },
    'Auth failure'
  );
}

async function resolveApprovedAuthorization(
  request: FastifyRequest,
  reply: FastifyReply,
  routeGroup: 'usage-admin'
): Promise<AuthorizationContext | undefined> {
  const bearerToken = extractBearerToken(request.headers);
  if (!bearerToken.ok) {
    logAuthFailure(request, {
      event: hasAuthorizationHeader(request.headers)
        ? 'auth_bearer_invalid'
        : 'auth_bearer_missing',
      routeGroup,
      reason: hasAuthorizationHeader(request.headers)
        ? 'invalid_bearer_token'
        : 'missing_bearer_token',
      statusCode: 401,
    });
    await reply.fail('UNAUTHORIZED', 'Unauthorized');
    return undefined;
  }

  const services = getServices();
  const verified = await services.auth0JwtVerifier(request.headers, readAuth0JwtConfigFromEnv());
  if (!verified.ok) {
    logAuthFailure(request, {
      event: 'auth_jwt_invalid',
      routeGroup,
      reason: 'jwt_verification_failed',
      statusCode: 401,
    });
    await reply.fail('UNAUTHORIZED', 'Unauthorized');
    return undefined;
  }

  try {
    const resolved = await services.userServiceClient.resolveAuthorization({
      auth0: verified.identity,
    });

    if (resolved.state !== 'approved') {
      logAuthFailure(request, {
        event: 'auth_resolver_denied',
        routeGroup,
        reason: 'account_not_approved',
        statusCode: 403,
        accountState: resolved.state,
      });
      await reply.fail('FORBIDDEN', 'Forbidden');
      return undefined;
    }

    request.faApprovedAuthorization = resolved.authorization;
    return resolved.authorization;
  } catch (error) {
    if (error instanceof InternalClientError && error.code === 'FORBIDDEN') {
      logAuthFailure(request, {
        event: 'auth_resolver_denied',
        routeGroup,
        reason: 'resolver_forbidden',
        statusCode: 403,
      });
      await reply.fail('FORBIDDEN', 'Forbidden');
      return undefined;
    }

    logAuthFailure(request, {
      event: 'auth_resolver_unavailable',
      routeGroup,
      reason: 'resolver_unavailable',
      statusCode: 502,
    });
    await reply.fail('DOWNSTREAM_ERROR', 'Authorization service unavailable');
    return undefined;
  }
}

export async function requireApprovedAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | undefined> {
  const resolved = await resolveApprovedAuthorization(request, reply, 'usage-admin');
  if (resolved === undefined) {
    return await reply;
  }

  if (resolved.role !== 'admin') {
    logAuthFailure(request, {
      event: 'auth_admin_required',
      routeGroup: 'usage-admin',
      reason: 'admin_role_required',
      statusCode: 403,
      role: resolved.role,
    });
    await reply.fail('FORBIDDEN', 'Forbidden');
    return await reply;
  }

  return undefined;
}
