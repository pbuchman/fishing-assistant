import {
  completeProfileRequestBodySchema,
  currentUserQuerystringSchema,
  type AuthorizationResolveResponse,
  type CompleteProfileRequest,
} from '@fa/http-contracts';
import type { FastifyInstance } from 'fastify';

import type { FaUser } from '../domain/models/user.js';
import { completeProfile } from '../domain/usecases/completeProfile.js';
import {
  mapUserToAuthorizationContext,
  mapUserToCurrentUserSummary,
  missingRequiredProfileFields,
} from '../domain/usecases/userMapping.js';
import { getServices } from '../services.js';
import {
  requirePublicUserAuth,
  requireResolvedAuthorization,
  userRouteErrorCode,
  userRouteErrorMessage,
} from './authPreHandlers.js';

function authorizationResponseFromUser(user: FaUser): AuthorizationResolveResponse {
  const summary = mapUserToCurrentUserSummary(user);

  if (user.status === 'approved') {
    return {
      state: 'approved',
      user: { ...summary, status: 'approved' },
      authorization: mapUserToAuthorizationContext(user),
    };
  }

  if (user.status === 'profile_required') {
    return {
      state: 'profile_required',
      user: { ...summary, status: 'profile_required' },
      requiredFields: missingRequiredProfileFields(user),
    };
  }

  if (user.status === 'pending') {
    return { state: 'pending', user: { ...summary, status: 'pending' } };
  }

  if (user.status === 'rejected') {
    return { state: 'rejected', user: { ...summary, status: 'rejected' } };
  }

  return { state: 'suspended', user: { ...summary, status: 'suspended' } };
}

export function registerUserRoutes(app: FastifyInstance): void {
  app.get('/me', {
    preValidation: requirePublicUserAuth,
    schema: { querystring: currentUserQuerystringSchema },
    handler: async (request, reply) => {
      return await reply.ok(requireResolvedAuthorization(request));
    },
  });

  app.put('/me/profile', {
    preValidation: requirePublicUserAuth,
    schema: { body: completeProfileRequestBodySchema, querystring: currentUserQuerystringSchema },
    handler: async (request, reply) => {
      const authorization = requireResolvedAuthorization(request);
      if (authorization.user === null) {
        return await reply.fail('FORBIDDEN', userRouteErrorMessage('FORBIDDEN'));
      }

      const services = getServices();
      const result = await completeProfile(
        {
          repository: services.userRepository,
          eventIdGenerator: services.generateEventId,
          bootstrapAdminEmails: services.bootstrapAdminEmails,
        },
        {
          actorUserId: authorization.user.id,
          profile: request.body as CompleteProfileRequest,
          now: services.clock.now().toISOString(),
        }
      );

      if (!result.ok) {
        return await reply.fail(
          userRouteErrorCode(result.error.code),
          userRouteErrorMessage(result.error.code)
        );
      }

      return await reply.ok(authorizationResponseFromUser(result.value));
    },
  });
}
