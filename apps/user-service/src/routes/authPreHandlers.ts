import type { ErrorCode } from '@fa/common-core';
import {
  extractBearerToken,
  readAuth0JwtConfigFromEnv,
  validateInternalAuth,
} from '@fa/common-http';
import type { AuthorizationResolveResponse } from '@fa/http-contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { resolveAuthorization } from '../domain/usecases/resolveAuthorization.js';
import { getServices } from '../services.js';

declare module 'fastify' {
  interface FastifyRequest {
    faAuthorization?: AuthorizationResolveResponse;
  }
}

function usecaseErrorCode(code: string): ErrorCode {
  switch (code) {
    case 'FORBIDDEN':
    case 'NOT_FOUND':
    case 'PRECONDITION_FAILED':
    case 'INVALID_REQUEST':
    case 'INTERNAL_ERROR':
    case 'UNAUTHORIZED':
      return code;
    default:
      return 'INTERNAL_ERROR';
  }
}

function hasAuthorizationHeader(headers: FastifyRequest['headers']): boolean {
  return Object.keys(headers).some((header) => header.toLowerCase() === 'authorization');
}

function logAuthFailure(
  request: FastifyRequest,
  input: {
    event: string;
    routeGroup: 'user-self' | 'user-admin' | 'user-internal';
    reason: string;
    statusCode: number;
    role?: 'user' | 'admin';
    accountState?: AuthorizationResolveResponse['state'];
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

async function resolvePublicAuthorization(
  request: FastifyRequest,
  reply: FastifyReply,
  routeGroup: 'user-self' | 'user-admin'
): Promise<AuthorizationResolveResponse | undefined> {
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

  const resolved = await resolveAuthorization(
    {
      repository: services.userRepository,
      bootstrapAdminEmails: services.bootstrapAdminEmails,
      selfSignupAllowedEmailPattern: services.selfSignupAllowedEmailPattern,
      idGenerator: services.generateId,
      eventIdGenerator: services.generateEventId,
      securityLogHashKey: services.securityLogHashKey,
      logIdentityConflict: services.logIdentityConflict,
    },
    {
      auth0: verified.identity,
      now: services.clock.now().toISOString(),
    }
  );

  if (!resolved.ok) {
    if (resolved.error.code === 'FORBIDDEN') {
      logAuthFailure(request, {
        event: 'auth_resolver_denied',
        routeGroup,
        reason: 'resolver_forbidden',
        statusCode: 403,
      });
    } else if (resolved.error.code === 'INTERNAL_ERROR') {
      logAuthFailure(request, {
        event: 'auth_resolver_unavailable',
        routeGroup,
        reason: 'resolver_unavailable',
        statusCode: 500,
      });
    }
    await reply.fail(
      usecaseErrorCode(resolved.error.code),
      userRouteErrorMessage(resolved.error.code)
    );
    return undefined;
  }

  request.faAuthorization = resolved.value;
  return resolved.value;
}

export async function requirePublicUserAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | undefined> {
  const resolved = await resolvePublicAuthorization(request, reply, 'user-self');
  return resolved === undefined ? await reply : undefined;
}

export async function requireAdminUserAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | undefined> {
  const resolved = await resolvePublicAuthorization(request, reply, 'user-admin');
  if (resolved === undefined) {
    return await reply;
  }

  if (resolved.state !== 'approved') {
    logAuthFailure(request, {
      event: 'auth_admin_required',
      routeGroup: 'user-admin',
      reason: 'account_not_approved',
      statusCode: 403,
      accountState: resolved.state,
    });
    return await reply.fail('FORBIDDEN', 'Admin authorization is required');
  }

  if (resolved.authorization.role !== 'admin') {
    logAuthFailure(request, {
      event: 'auth_admin_required',
      routeGroup: 'user-admin',
      reason: 'admin_role_required',
      statusCode: 403,
      role: resolved.authorization.role,
      accountState: resolved.state,
    });
    return await reply.fail('FORBIDDEN', 'Admin authorization is required');
  }

  return undefined;
}

export async function requireInternalAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | undefined> {
  const authResult = validateInternalAuth(request.headers, process.env);
  if (!authResult.valid) {
    logAuthFailure(request, {
      event: 'auth_internal_failed',
      routeGroup: 'user-internal',
      reason: 'invalid_internal_auth',
      statusCode: 401,
    });
    return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
  }

  return undefined;
}

export function requireResolvedAuthorization(
  request: FastifyRequest
): AuthorizationResolveResponse {
  if (request.faAuthorization === undefined) {
    throw new Error('Route auth prehandler did not resolve authorization');
  }

  return request.faAuthorization;
}

export function userRouteErrorCode(code: string): ErrorCode {
  return usecaseErrorCode(code);
}

export function userRouteErrorMessage(code: string): string {
  switch (usecaseErrorCode(code)) {
    case 'UNAUTHORIZED':
      return 'Unauthorized';
    case 'FORBIDDEN':
      return 'Forbidden';
    case 'NOT_FOUND':
      return 'Not found';
    case 'PRECONDITION_FAILED':
      return 'Request precondition failed';
    case 'INVALID_REQUEST':
      return 'Invalid request';
    case 'INTERNAL_ERROR':
      return 'Request failed';
  }

  return 'Request failed';
}
