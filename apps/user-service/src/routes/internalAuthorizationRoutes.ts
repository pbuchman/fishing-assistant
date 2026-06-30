import {
  authorizationResolveRequestBodySchema,
  type AuthorizationResolveRequest,
  internalUserIdentityLookupRequestBodySchema,
  type InternalUserIdentityLookupRequest,
  type InternalUserIdentitySummary,
} from '@fa/http-contracts';
import type { FastifyInstance } from 'fastify';

import type { FaUser } from '../domain/models/user.js';
import { resolveAuthorization } from '../domain/usecases/resolveAuthorization.js';
import { mapUserToCurrentUserSummary } from '../domain/usecases/userMapping.js';
import { getServices } from '../services.js';
import { requireInternalAuth, userRouteErrorCode } from './authPreHandlers.js';

function toInternalUserIdentitySummary(user: FaUser): InternalUserIdentitySummary {
  const summary = mapUserToCurrentUserSummary(user);
  return {
    id: summary.id,
    email: summary.email,
    firstName: summary.firstName,
    lastName: summary.lastName,
    role: summary.role,
    status: summary.status,
    effectiveLevel: summary.effectiveLevel,
  };
}

export function registerInternalAuthorizationRoutes(app: FastifyInstance): void {
  app.post('/internal/authorization/resolve', {
    preValidation: requireInternalAuth,
    schema: { body: authorizationResolveRequestBodySchema },
    handler: async (request, reply) => {
      const services = getServices();
      const result = await resolveAuthorization(
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
          auth0: (request.body as AuthorizationResolveRequest).auth0,
          now: services.clock.now().toISOString(),
        }
      );

      if (!result.ok) {
        return await reply.fail(userRouteErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok(result.value);
    },
  });

  app.post('/internal/users/lookup', {
    preValidation: requireInternalAuth,
    schema: { body: internalUserIdentityLookupRequestBodySchema },
    handler: async (request, reply) => {
      const services = getServices();
      const { userIds } = request.body as InternalUserIdentityLookupRequest;
      const users: InternalUserIdentitySummary[] = [];

      for (const userId of userIds) {
        const result = await services.userRepository.getById(userId);
        if (!result.ok) {
          return await reply.fail(userRouteErrorCode(result.error.code), result.error.message);
        }
        if (result.value !== null) {
          users.push(toInternalUserIdentitySummary(result.value));
        }
      }

      return await reply.ok({ users });
    },
  });
}
