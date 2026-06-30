import { extractBearerToken, readAuth0JwtConfigFromEnv } from '@fa/common-http';
import { InternalClientError } from '@fa/internal-clients';
import type { AuthorizationContext } from '@fa/http-contracts';
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
    routeGroup: 'chat' | 'chat-admin';
    reason: string;
    statusCode: number;
    accountState?:
      | AuthorizationContext['status']
      | 'profile_required'
      | 'pending'
      | 'rejected'
      | 'suspended';
    role?: AuthorizationContext['role'];
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
      ...(input.accountState === undefined ? {} : { accountState: input.accountState }),
      ...(input.role === undefined ? {} : { role: input.role }),
    },
    'Auth failure'
  );
}

async function failAuthorizationService(reply: FastifyReply): Promise<FastifyReply> {
  return await reply.fail('DOWNSTREAM_ERROR', 'Authorization service unavailable');
}

async function resolveApprovedAuthorization(
  request: FastifyRequest,
  reply: FastifyReply,
  routeGroup: 'chat' | 'chat-admin'
): Promise<AuthorizationContext | undefined> {
  const services = getServices();
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
    await failAuthorizationService(reply);
    return undefined;
  }
}

export async function requireApprovedUserAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | undefined> {
  const resolved = await resolveApprovedAuthorization(request, reply, 'chat');
  return resolved === undefined ? await reply : undefined;
}

export async function requireApprovedAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | undefined> {
  const resolved = await resolveApprovedAuthorization(request, reply, 'chat-admin');
  if (resolved === undefined) {
    return await reply;
  }

  if (resolved.role !== 'admin') {
    logAuthFailure(request, {
      event: 'auth_admin_required',
      routeGroup: 'chat-admin',
      reason: 'admin_role_required',
      statusCode: 403,
      role: resolved.role,
    });
    await reply.fail('FORBIDDEN', 'Forbidden');
    return await reply;
  }

  return undefined;
}

export function requireApprovedRequestAuthorization(request: FastifyRequest): AuthorizationContext {
  if (request.faApprovedAuthorization === undefined) {
    throw new Error('Route auth prehandler did not resolve approved authorization');
  }

  return request.faApprovedAuthorization;
}
