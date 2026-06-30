import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';

import { userLevelValues, userRoleValues, userStatusValues } from './auth.js';
import {
  adminPatchUserRequestBodySchema,
  adminPendingRequestsCountResponseSchema,
  adminPendingRequestsCountQuerystringSchema,
  adminPendingRequestsResponseSchema,
  adminPendingRequestsQuerystringSchema,
  adminUserHistoryResponseSchema,
  adminUserHistoryQuerystringSchema,
  adminUserListResponseSchema,
  adminUserMutationResponseSchema,
  adminUserParamsSchema,
  adminUsersQuerystringSchema,
  approveUserRequestBodySchema,
  authorizationResolveRequestBodySchema,
  authorizationResolveResponseSchema,
  completeProfileRequestBodySchema,
  currentUserQuerystringSchema,
  currentUserSummarySchema,
  internalUserIdentityLookupRequestBodySchema,
  internalUserIdentityLookupResponseSchema,
  rejectUserRequestBodySchema,
  suspendUserRequestBodySchema,
  unsuspendUserRequestBodySchema,
  userChangeEventResponseSchema,
  type AdminPendingRequestsCountResponse,
  type AdminPendingRequestsResponse,
  type AdminUserHistoryResponse,
  type AdminUserListResponse,
  type AdminUserMutationResponse,
  type AuthorizationResolveResponse,
  type CurrentUserSummary,
  type UserChangeEventResponse,
} from './user.js';
import type { JsonSchema } from './routeSchemas.js';

const forbiddenClientIdentityFields = [
  'userId',
  'actorUserId',
  'actorId',
  'auth0Subject',
  'role',
  'status',
  'level',
  'effectiveLevel',
  'workspaceId',
  'ownerId',
  'ownerType',
] as const;

type ValidationResult = 'accepted' | 'rejected';

async function validateWithFastify(
  schema: JsonSchema,
  payload: unknown
): Promise<ValidationResult> {
  const app = Fastify({
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
      },
    },
  });

  app.post('/validate', { schema: { body: schema } }, () => ({ ok: true }));

  const response = await app.inject({
    method: 'POST',
    url: '/validate',
    payload: payload as Record<string, unknown>,
  });

  await app.close();

  return response.statusCode === 200 ? 'accepted' : 'rejected';
}

function expectStrictObjectSchema(
  schema: Readonly<Record<string, unknown>>,
  expectedProperties: readonly string[]
): void {
  expect(schema).toMatchObject({
    type: 'object',
    additionalProperties: false,
  });
  expect(Object.keys(schema['properties'] as Record<string, unknown>).sort()).toEqual(
    [...expectedProperties].sort()
  );
}

describe('user-service request schemas', () => {
  it('defines strict current-user and profile schemas without client identity fields', () => {
    expectStrictObjectSchema(currentUserQuerystringSchema, []);
    expect(completeProfileRequestBodySchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['firstName', 'lastName', 'mobileNumber'],
      properties: {
        firstName: { type: 'string', minLength: 1, pattern: '\\S' },
        lastName: { type: 'string', minLength: 1, pattern: '\\S' },
        mobileNumber: {
          type: 'string',
          pattern: '^\\+[1-9][0-9]{7,14}$',
        },
      },
    });

    for (const field of forbiddenClientIdentityFields) {
      expect(completeProfileRequestBodySchema.properties).not.toHaveProperty(field);
    }
  });

  it('defines strict admin action schemas with no reason or actor fields', () => {
    expectStrictObjectSchema(adminUserParamsSchema, ['userId']);
    expect(approveUserRequestBodySchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      oneOf: [
        {
          required: ['role'],
          properties: {
            role: { const: 'admin' },
          },
          not: { required: ['level'] },
        },
        {
          required: ['role', 'level'],
          properties: {
            role: { const: 'user' },
            level: { type: 'integer', enum: userLevelValues },
          },
        },
      ],
    });

    for (const schema of [
      approveUserRequestBodySchema,
      rejectUserRequestBodySchema,
      suspendUserRequestBodySchema,
      unsuspendUserRequestBodySchema,
    ]) {
      expect(schema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
      expect(schema.properties).not.toHaveProperty('reason');
      expect(schema.properties).not.toHaveProperty('actorUserId');
      expect(schema.properties).not.toHaveProperty('actorId');
      expect(schema.properties).not.toHaveProperty('workspaceId');
      expect(schema.properties).not.toHaveProperty('ownerId');
    }
  });

  it('defines strict pending, admin-list, patch, and history schemas', () => {
    expectStrictObjectSchema(adminPendingRequestsQuerystringSchema, ['limit', 'cursor']);
    expectStrictObjectSchema(adminPendingRequestsCountQuerystringSchema, []);
    expect(adminUsersQuerystringSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', enum: userStatusValues },
        role: { type: 'string', enum: userRoleValues },
        level: {
          anyOf: [
            { type: 'integer', enum: userLevelValues },
            { type: 'string', pattern: '^(10|[1-9])$' },
          ],
        },
      },
    });
    expect(adminPatchUserRequestBodySchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        role: { type: 'string', enum: userRoleValues },
        status: { type: 'string', enum: ['approved', 'rejected', 'suspended'] },
        level: {
          anyOf: [{ type: 'integer', enum: userLevelValues }, { type: 'null' }],
        },
      },
    });
    expectStrictObjectSchema(adminUserHistoryQuerystringSchema, ['limit', 'cursor']);

    for (const field of ['actorUserId', 'actorId', 'workspaceId', 'ownerId', 'reason']) {
      expect(adminPatchUserRequestBodySchema.properties).not.toHaveProperty(field);
    }
  });

  it('defines strict internal authorization resolver schema from Auth0 claims only', () => {
    expect(authorizationResolveRequestBodySchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['auth0'],
      properties: {
        auth0: {
          type: 'object',
          additionalProperties: false,
          required: ['subject'],
        },
      },
    });

    const auth0Properties = authorizationResolveRequestBodySchema.properties.auth0
      .properties as Record<string, unknown>;
    expect(Object.keys(auth0Properties).sort()).toEqual([
      'email',
      'emailVerified',
      'name',
      'subject',
    ]);

    for (const field of forbiddenClientIdentityFields) {
      expect(authorizationResolveRequestBodySchema.properties).not.toHaveProperty(field);
      expect(auth0Properties).not.toHaveProperty(field);
    }
  });

  it('defines strict internal user identity lookup schema from user IDs only', async () => {
    expectStrictObjectSchema(internalUserIdentityLookupRequestBodySchema, ['userIds']);
    expect(internalUserIdentityLookupRequestBodySchema.properties.userIds).toMatchObject({
      type: 'array',
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
    });

    await expect(
      validateWithFastify(internalUserIdentityLookupRequestBodySchema, { userIds: ['user-1'] })
    ).resolves.toBe('accepted');
    await expect(
      validateWithFastify(internalUserIdentityLookupRequestBodySchema, { userIds: [] })
    ).resolves.toBe('rejected');
    await expect(
      validateWithFastify(internalUserIdentityLookupRequestBodySchema, {
        userIds: ['user-1', 'user-1'],
      })
    ).resolves.toBe('rejected');

    for (const field of forbiddenClientIdentityFields) {
      await expect(
        validateWithFastify(internalUserIdentityLookupRequestBodySchema, {
          userIds: ['user-1'],
          [field]: 'client-controlled',
        })
      ).resolves.toBe('rejected');
    }
  });
});

describe('user-service response contracts', () => {
  const approvedUser = {
    id: 'user-1',
    email: 'person@example.com',
    firstName: 'Pat',
    lastName: 'Angler',
    mobileNumber: '+15550101000',
    role: 'user',
    status: 'approved',
    level: 4,
    effectiveLevel: 4,
  } satisfies CurrentUserSummary;

  const approvedAuthorization = {
    userId: 'user-1',
    auth0Subject: 'auth0|abc',
    email: 'person@example.com',
    role: 'user',
    status: 'approved',
    effectiveLevel: 4,
  } as const;

  it('defines the current user summary shape', () => {
    expect(approvedUser).toMatchObject({
      id: 'user-1',
      role: 'user',
      status: 'approved',
      level: 4,
      effectiveLevel: 4,
    });
    expect(currentUserSummarySchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'email',
        'firstName',
        'lastName',
        'mobileNumber',
        'role',
        'status',
        'level',
        'effectiveLevel',
      ],
    });
  });

  it('keeps authorization only on approved resolver responses', () => {
    const approved = {
      state: 'approved',
      user: approvedUser,
      authorization: approvedAuthorization,
    } satisfies AuthorizationResolveResponse;
    const pending = {
      state: 'pending',
      user: { ...approved.user, status: 'pending' },
    } satisfies AuthorizationResolveResponse;

    expect(approved.authorization.status).toBe('approved');
    expect('authorization' in pending).toBe(false);
    expect(authorizationResolveResponseSchema).toMatchObject({
      oneOf: [
        {
          additionalProperties: false,
          required: ['state', 'user', 'authorization'],
          properties: {
            state: { const: 'approved' },
          },
        },
        {
          additionalProperties: false,
          required: ['state', 'user', 'requiredFields'],
          properties: {
            state: { const: 'profile_required' },
          },
        },
        {
          additionalProperties: false,
          required: ['state', 'user'],
          properties: {
            state: { const: 'pending' },
          },
        },
        {
          additionalProperties: false,
          required: ['state', 'user'],
          properties: {
            state: { const: 'rejected' },
          },
        },
        {
          additionalProperties: false,
          required: ['state', 'user'],
          properties: {
            state: { const: 'suspended' },
          },
        },
      ],
    });

    const nonApprovedVariants = authorizationResolveResponseSchema.oneOf.slice(1);
    for (const variant of nonApprovedVariants) {
      expect(variant.properties).not.toHaveProperty('authorization');
    }
  });

  it('rejects resolver responses where approved state carries non-approved user status', async () => {
    await expect(
      validateWithFastify(authorizationResolveResponseSchema, {
        state: 'approved',
        user: { ...approvedUser, status: 'pending' },
        authorization: approvedAuthorization,
      })
    ).resolves.toBe('rejected');
  });

  it('rejects authorization fields on non-approved resolver responses', async () => {
    for (const state of ['pending', 'rejected', 'suspended'] as const) {
      await expect(
        validateWithFastify(authorizationResolveResponseSchema, {
          state,
          user: { ...approvedUser, status: state },
          authorization: approvedAuthorization,
        })
      ).resolves.toBe('rejected');
    }

    await expect(
      validateWithFastify(authorizationResolveResponseSchema, {
        state: 'profile_required',
        user: { ...approvedUser, status: 'profile_required' },
        requiredFields: ['firstName'],
        authorization: approvedAuthorization,
      })
    ).resolves.toBe('rejected');
  });

  it('rejects pending, rejected, and suspended resolver responses with mismatched user status', async () => {
    for (const state of ['pending', 'rejected', 'suspended'] as const) {
      await expect(
        validateWithFastify(authorizationResolveResponseSchema, {
          state,
          user: approvedUser,
        })
      ).resolves.toBe('rejected');
    }
  });

  it('requires a present profile_required resolver user to have profile_required status', async () => {
    await expect(
      validateWithFastify(authorizationResolveResponseSchema, {
        state: 'profile_required',
        user: { ...approvedUser, status: 'pending' },
        requiredFields: ['firstName', 'lastName', 'mobileNumber'],
      })
    ).resolves.toBe('rejected');

    await expect(
      validateWithFastify(authorizationResolveResponseSchema, {
        state: 'profile_required',
        user: null,
        requiredFields: ['firstName', 'lastName', 'mobileNumber'],
      })
    ).resolves.toBe('accepted');
  });

  it('defines internal user identity lookup responses with role and status for internal verification', async () => {
    expectStrictObjectSchema(internalUserIdentityLookupResponseSchema, ['users']);

    await expect(
      validateWithFastify(internalUserIdentityLookupResponseSchema, {
        users: [
          {
            id: 'user-1',
            email: 'river@example.com',
            firstName: 'River',
            lastName: 'Walker',
            role: 'admin',
            status: 'approved',
            effectiveLevel: 7,
          },
        ],
      })
    ).resolves.toBe('accepted');
    await expect(
      validateWithFastify(internalUserIdentityLookupResponseSchema, {
        users: [
          {
            id: 'user-1',
            email: 'river@example.com',
            firstName: 'River',
            lastName: 'Walker',
            effectiveLevel: 7,
          },
        ],
      })
    ).resolves.toBe('rejected');
  });
});

describe('user-service runtime schema validation', () => {
  it('rejects forbidden identity, ownership, and reason fields', async () => {
    await expect(
      validateWithFastify(completeProfileRequestBodySchema, {
        firstName: 'Pat',
        lastName: 'Angler',
        mobileNumber: '+15550101000',
        userId: 'user-1',
      })
    ).resolves.toBe('rejected');

    await expect(
      validateWithFastify(authorizationResolveRequestBodySchema, {
        auth0: {
          subject: 'auth0|abc',
          email: 'person@example.com',
          role: 'admin',
        },
      })
    ).resolves.toBe('rejected');

    await expect(
      validateWithFastify(rejectUserRequestBodySchema, {
        reason: 'no reason fields in this contract',
      })
    ).resolves.toBe('rejected');

    await expect(
      validateWithFastify(suspendUserRequestBodySchema, {
        ownerId: 'user-1',
      })
    ).resolves.toBe('rejected');
  });

  it('validates approve role and level combinations at runtime', async () => {
    await expect(
      validateWithFastify(approveUserRequestBodySchema, { role: 'admin' })
    ).resolves.toBe('accepted');
    await expect(
      validateWithFastify(approveUserRequestBodySchema, { role: 'user', level: 1 })
    ).resolves.toBe('accepted');
    await expect(
      validateWithFastify(approveUserRequestBodySchema, { role: 'user', level: 10 })
    ).resolves.toBe('accepted');

    await expect(
      validateWithFastify(approveUserRequestBodySchema, { role: 'admin', level: 10 })
    ).resolves.toBe('rejected');
    await expect(validateWithFastify(approveUserRequestBodySchema, { role: 'user' })).resolves.toBe(
      'rejected'
    );
    await expect(
      validateWithFastify(approveUserRequestBodySchema, { role: 'user', level: 11 })
    ).resolves.toBe('rejected');
  });

  it('validates the unsuspend request body as an empty strict admin action', async () => {
    await expect(validateWithFastify(unsuspendUserRequestBodySchema, {})).resolves.toBe('accepted');
    await expect(
      validateWithFastify(unsuspendUserRequestBodySchema, {
        reason: 'not accepted',
      })
    ).resolves.toBe('rejected');
    await expect(
      validateWithFastify(unsuspendUserRequestBodySchema, {
        actorUserId: 'admin-1',
      })
    ).resolves.toBe('rejected');
  });
});

describe('user-service admin response contracts', () => {
  const pendingUser = {
    id: 'user-2',
    email: 'pending@example.com',
    firstName: 'Pen',
    lastName: 'Ding',
    mobileNumber: '+15550101000',
    role: 'user',
    status: 'pending',
    level: null,
    effectiveLevel: 1,
  } satisfies CurrentUserSummary;

  const approvedUser = {
    ...pendingUser,
    id: 'user-3',
    email: 'approved@example.com',
    status: 'approved',
    level: 7,
    effectiveLevel: 7,
    availableStatusTransitions: ['suspended'],
  } satisfies CurrentUserSummary;

  const changeEvent = {
    id: 'event-1',
    targetUserId: 'user-3',
    actorUserId: 'admin-1',
    type: 'status_changed',
    before: { status: 'pending' },
    after: { status: 'approved' },
    createdAt: '2026-06-17T10:00:00.000Z',
  } satisfies UserChangeEventResponse;

  it('defines strict admin list and pending response schemas', async () => {
    const listResponse = {
      users: [approvedUser],
      nextCursor: 'opaque-cursor',
      totalCount: 12,
    } satisfies AdminUserListResponse;
    const pendingResponse = {
      users: [pendingUser],
      nextCursor: null,
    } satisfies AdminPendingRequestsResponse;
    const countResponse = { count: 2 } satisfies AdminPendingRequestsCountResponse;

    expect(adminUserListResponseSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['users', 'nextCursor', 'totalCount'],
      properties: {
        totalCount: { type: 'integer', minimum: 0 },
      },
    });
    expect(adminPendingRequestsResponseSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['users', 'nextCursor'],
    });
    expect(adminPendingRequestsCountResponseSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['count'],
      properties: {
        count: { type: 'integer', minimum: 0 },
      },
    });

    await expect(validateWithFastify(adminUserListResponseSchema, listResponse)).resolves.toBe(
      'accepted'
    );
    await expect(
      validateWithFastify(adminPendingRequestsResponseSchema, pendingResponse)
    ).resolves.toBe('accepted');
    await expect(
      validateWithFastify(adminPendingRequestsCountResponseSchema, countResponse)
    ).resolves.toBe('accepted');
    await expect(
      validateWithFastify(adminPendingRequestsResponseSchema, {
        users: [approvedUser],
        nextCursor: null,
      })
    ).resolves.toBe('rejected');
  });

  it('defines strict mutation and history response schemas with immutable events', async () => {
    const mutationResponse = {
      user: approvedUser,
      events: [changeEvent],
    } satisfies AdminUserMutationResponse;
    const historyResponse = {
      events: [changeEvent],
      nextCursor: null,
    } satisfies AdminUserHistoryResponse;

    expect(userChangeEventResponseSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['id', 'targetUserId', 'actorUserId', 'type', 'before', 'after', 'createdAt'],
    });
    expect(adminUserMutationResponseSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['user', 'events'],
    });
    expect(adminUserHistoryResponseSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['events', 'nextCursor'],
    });

    await expect(
      validateWithFastify(adminUserMutationResponseSchema, mutationResponse)
    ).resolves.toBe('accepted');
    await expect(
      validateWithFastify(adminUserHistoryResponseSchema, historyResponse)
    ).resolves.toBe('accepted');
    await expect(
      validateWithFastify(adminUserMutationResponseSchema, {
        ...mutationResponse,
        reason: 'not accepted',
      })
    ).resolves.toBe('rejected');
  });
});
