import type { ErrorCode } from '@fa/common-core';
import {
  adminPendingRequestsCountQuerystringSchema,
  adminPendingRequestsQuerystringSchema,
  adminPatchUserRequestBodySchema,
  adminUserHistoryQuerystringSchema,
  adminUserParamsSchema,
  adminUsersQuerystringSchema,
  approveUserRequestBodySchema,
  rejectUserRequestBodySchema,
  suspendUserRequestBodySchema,
  unsuspendUserRequestBodySchema,
  type AdminPatchUserRequest,
  type ApproveUserRequest,
  type UserLevel,
  type UserRole,
  type UserStatus,
} from '@fa/http-contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';

import type { UserChangeEvent } from '../domain/models/user.js';
import type { UserListCursor, UserFilters } from '../domain/repositories/userRepositories.js';
import {
  approveUser,
  patchUser,
  rejectUser,
  suspendUser,
  unsuspendUser,
  type AdminUserMutationResult,
} from '../domain/usecases/adminUserActions.js';
import {
  decodeUserListCursor,
  encodeUserListCursor,
  normalizeUserListLimit,
} from '../domain/usecases/cursors.js';
import {
  mapUserToAdminUserSummary,
  mapUserToCurrentUserSummary,
} from '../domain/usecases/userMapping.js';
import { getServices } from '../services.js';
import {
  requireAdminUserAuth,
  requireResolvedAuthorization,
  userRouteErrorCode,
  userRouteErrorMessage,
} from './authPreHandlers.js';

interface UserParams {
  userId: string;
}

interface ListQuery {
  q?: string;
  status?: UserStatus;
  role?: UserRole;
  level?: UserLevel | string;
  limit?: number | string;
  cursor?: string;
}

function encodeCursor(cursor: UserListCursor | null): string | null {
  return cursor === null ? null : encodeUserListCursor(cursor);
}

function mapEvent(event: UserChangeEvent) {
  return {
    id: event.id,
    targetUserId: event.targetUserId,
    actorUserId: event.actorUserId,
    type: event.type,
    before: event.before,
    after: event.after,
    createdAt: event.createdAt,
  };
}

function mutationResponse(result: AdminUserMutationResult) {
  return {
    user: mapUserToCurrentUserSummary(result.user),
    events: result.events.map(mapEvent),
  };
}

function routeErrorCode(code: string): ErrorCode {
  return userRouteErrorCode(code);
}

const ADMIN_MUTATION_USER_FACING_MESSAGES = new Set(['Admins cannot modify their own access.']);

function adminMutationErrorMessage(error: { code: string; message: string }): string {
  if (ADMIN_MUTATION_USER_FACING_MESSAGES.has(error.message)) {
    return error.message;
  }

  return userRouteErrorMessage(error.code);
}

function adminActionDependencies() {
  const services = getServices();
  return {
    repository: services.userRepository,
    eventIdGenerator: services.generateEventId,
  };
}

async function parsePaging(
  reply: FastifyReply,
  query: ListQuery
): Promise<{ limit: number; cursor: UserListCursor | null } | undefined> {
  const limit = normalizeUserListLimit(query.limit);
  if (!limit.ok) {
    await reply.fail(limit.error.code, userRouteErrorMessage(limit.error.code));
    return undefined;
  }

  if (query.cursor === undefined) {
    return { limit: limit.value, cursor: null };
  }

  const cursor = decodeUserListCursor(query.cursor);
  if (!cursor.ok) {
    await reply.fail(cursor.error.code, userRouteErrorMessage(cursor.error.code));
    return undefined;
  }

  return { limit: limit.value, cursor: cursor.value };
}

function adminActorUserId(request: { faAuthorization?: { user: { id: string } | null } }): string {
  const resolved = requireResolvedAuthorization(request as never);
  if (resolved.user === null) {
    throw new Error('Admin authorization resolved without a user');
  }

  return resolved.user.id;
}

async function sendMutation(
  reply: FastifyReply,
  resultPromise: Promise<
    | { ok: true; value: AdminUserMutationResult }
    | { ok: false; error: { code: string; message: string } }
  >
) {
  const result = await resultPromise;
  if (!result.ok) {
    return await reply.fail(
      routeErrorCode(result.error.code),
      adminMutationErrorMessage(result.error)
    );
  }

  return await reply.ok(mutationResponse(result.value));
}

export function registerAdminUserRoutes(app: FastifyInstance): void {
  app.get('/admin/pending-requests', {
    preValidation: requireAdminUserAuth,
    schema: { querystring: adminPendingRequestsQuerystringSchema },
    handler: async (request, reply) => {
      const paging = await parsePaging(reply, request.query as ListQuery);
      if (paging === undefined) {
        return await reply;
      }

      const result = await getServices().userRepository.listPending(paging);
      if (!result.ok) {
        return await reply.fail(
          routeErrorCode(result.error.code),
          userRouteErrorMessage(result.error.code)
        );
      }

      return await reply.ok({
        users: result.value.users.map((user) => ({
          ...mapUserToCurrentUserSummary(user),
          status: 'pending' as const,
        })),
        nextCursor: encodeCursor(result.value.nextCursor),
      });
    },
  });

  app.get('/admin/pending-requests/count', {
    preValidation: requireAdminUserAuth,
    schema: { querystring: adminPendingRequestsCountQuerystringSchema },
    handler: async (_request, reply) => {
      const result = await getServices().userRepository.countPending();
      if (!result.ok) {
        return await reply.fail(
          routeErrorCode(result.error.code),
          userRouteErrorMessage(result.error.code)
        );
      }

      return await reply.ok({ count: result.value });
    },
  });

  app.get('/admin/users', {
    preValidation: requireAdminUserAuth,
    schema: { querystring: adminUsersQuerystringSchema },
    handler: async (request, reply) => {
      const query = request.query as ListQuery;
      const paging = await parsePaging(reply, query);
      if (paging === undefined) {
        return await reply;
      }

      const filters: UserFilters = {
        ...(query.q === undefined || query.q.trim().length === 0 ? {} : { query: query.q.trim() }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.role === undefined ? {} : { role: query.role }),
        ...(query.level === undefined ? {} : { level: Number(query.level) as UserLevel }),
      };
      const result = await getServices().userRepository.listUsers({ ...paging, filters });
      if (!result.ok) {
        return await reply.fail(
          routeErrorCode(result.error.code),
          userRouteErrorMessage(result.error.code)
        );
      }

      const actorUserId = adminActorUserId(request);
      return await reply.ok({
        users: result.value.users.map((user) => mapUserToAdminUserSummary({ actorUserId, user })),
        nextCursor: encodeCursor(result.value.nextCursor),
        totalCount: result.value.totalCount,
      });
    },
  });

  app.post('/admin/users/:userId/approve', {
    preValidation: requireAdminUserAuth,
    schema: { params: adminUserParamsSchema, body: approveUserRequestBodySchema },
    handler: async (request, reply) => {
      const { userId } = request.params as UserParams;
      const body = request.body as ApproveUserRequest;
      return await sendMutation(
        reply,
        approveUser(adminActionDependencies(), {
          actorUserId: adminActorUserId(request),
          targetUserId: userId,
          role: body.role,
          ...(body.role === 'user' ? { level: body.level } : {}),
          now: getServices().clock.now().toISOString(),
        })
      );
    },
  });

  app.post('/admin/users/:userId/reject', {
    preValidation: requireAdminUserAuth,
    schema: { params: adminUserParamsSchema, body: rejectUserRequestBodySchema },
    handler: async (request, reply) => {
      const { userId } = request.params as UserParams;
      return await sendMutation(
        reply,
        rejectUser(adminActionDependencies(), {
          actorUserId: adminActorUserId(request),
          targetUserId: userId,
          now: getServices().clock.now().toISOString(),
        })
      );
    },
  });

  app.post('/admin/users/:userId/suspend', {
    preValidation: requireAdminUserAuth,
    schema: { params: adminUserParamsSchema, body: suspendUserRequestBodySchema },
    handler: async (request, reply) => {
      const { userId } = request.params as UserParams;
      return await sendMutation(
        reply,
        suspendUser(adminActionDependencies(), {
          actorUserId: adminActorUserId(request),
          targetUserId: userId,
          now: getServices().clock.now().toISOString(),
        })
      );
    },
  });

  app.post('/admin/users/:userId/unsuspend', {
    preValidation: requireAdminUserAuth,
    schema: { params: adminUserParamsSchema, body: unsuspendUserRequestBodySchema },
    handler: async (request, reply) => {
      const { userId } = request.params as UserParams;
      return await sendMutation(
        reply,
        unsuspendUser(adminActionDependencies(), {
          actorUserId: adminActorUserId(request),
          targetUserId: userId,
          now: getServices().clock.now().toISOString(),
        })
      );
    },
  });

  app.patch('/admin/users/:userId', {
    preValidation: requireAdminUserAuth,
    schema: { params: adminUserParamsSchema, body: adminPatchUserRequestBodySchema },
    handler: async (request, reply) => {
      const { userId } = request.params as UserParams;
      return await sendMutation(
        reply,
        patchUser(adminActionDependencies(), {
          actorUserId: adminActorUserId(request),
          targetUserId: userId,
          patch: request.body as AdminPatchUserRequest,
          now: getServices().clock.now().toISOString(),
        })
      );
    },
  });

  app.get('/admin/users/:userId/history', {
    preValidation: requireAdminUserAuth,
    schema: { params: adminUserParamsSchema, querystring: adminUserHistoryQuerystringSchema },
    handler: async (request, reply) => {
      const { userId } = request.params as UserParams;
      const services = getServices();
      const target = await services.userRepository.getById(userId);
      if (!target.ok) {
        return await reply.fail(
          routeErrorCode(target.error.code),
          userRouteErrorMessage(target.error.code)
        );
      }
      if (target.value === null) {
        return await reply.fail('NOT_FOUND', userRouteErrorMessage('NOT_FOUND'));
      }

      const paging = await parsePaging(reply, request.query as ListQuery);
      if (paging === undefined) {
        return await reply;
      }

      const result = await services.userRepository.listHistory({ targetUserId: userId, ...paging });
      if (!result.ok) {
        return await reply.fail(
          routeErrorCode(result.error.code),
          userRouteErrorMessage(result.error.code)
        );
      }

      return await reply.ok({
        events: result.value.events.map(mapEvent),
        nextCursor: encodeCursor(result.value.nextCursor),
      });
    },
  });
}
