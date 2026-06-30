import type { JsonSchema } from './routeSchemas.js';
import {
  auth0IdentityClaimsSchema,
  authorizationContextSchema,
  type AuthorizationContext,
  type Auth0IdentityClaims,
  type UserLevel,
  userLevelValues,
  type UserRole,
  userRoleValues,
  type UserStatus,
  userStatusValues,
} from './auth.js';

export interface CompleteProfileRequest {
  firstName: string;
  lastName: string;
  mobileNumber: string;
}

export type ApproveUserRequest =
  | { role: 'admin'; level?: never }
  | { role: 'user'; level: UserLevel };

export interface AdminPatchUserRequest {
  role?: UserRole;
  status?: 'approved' | 'rejected' | 'suspended';
  level?: UserLevel | null;
}

export type AdminUserStatusTransition = Extract<UserStatus, 'approved' | 'suspended'>;

export interface AuthorizationResolveRequest {
  auth0: Auth0IdentityClaims;
}

export interface InternalUserIdentityLookupRequest {
  userIds: string[];
}

export interface InternalUserIdentitySummary {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
  status: UserStatus;
  effectiveLevel: UserLevel;
}

export interface InternalUserIdentityLookupResponse {
  users: InternalUserIdentitySummary[];
}

export interface CurrentUserSummary {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  mobileNumber: string | null;
  role: UserRole;
  status: UserStatus;
  level: UserLevel | null;
  effectiveLevel: UserLevel;
  availableStatusTransitions?: AdminUserStatusTransition[];
}

export type UserChangeType =
  | 'status_changed'
  | 'role_changed'
  | 'level_changed'
  | 'profile_changed';

export type CurrentUserSummaryForStatus<Status extends UserStatus> = Omit<
  CurrentUserSummary,
  'status'
> & {
  status: Status;
};

export interface AdminUserListResponse {
  users: CurrentUserSummary[];
  nextCursor: string | null;
  totalCount: number;
}

export interface AdminPendingRequestsResponse {
  users: CurrentUserSummaryForStatus<'pending'>[];
  nextCursor: string | null;
}

export interface AdminPendingRequestsCountResponse {
  count: number;
}

export interface UserChangeEventResponse {
  id: string;
  targetUserId: string;
  actorUserId: string;
  type: UserChangeType;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: string;
}

export interface AdminUserMutationResponse {
  user: CurrentUserSummary;
  events: UserChangeEventResponse[];
}

export interface AdminUserHistoryResponse {
  events: UserChangeEventResponse[];
  nextCursor: string | null;
}

export type AuthorizationResolveResponse =
  | {
      state: 'approved';
      user: CurrentUserSummaryForStatus<'approved'>;
      authorization: AuthorizationContext;
    }
  | {
      state: 'profile_required';
      user: CurrentUserSummaryForStatus<'profile_required'> | null;
      requiredFields: ('firstName' | 'lastName' | 'mobileNumber')[];
    }
  | {
      state: 'pending';
      user: CurrentUserSummaryForStatus<'pending'>;
    }
  | {
      state: 'rejected';
      user: CurrentUserSummaryForStatus<'rejected'>;
    }
  | {
      state: 'suspended';
      user: CurrentUserSummaryForStatus<'suspended'>;
    };

const nonWhitespaceStringSchema = {
  type: 'string',
  minLength: 1,
  pattern: '\\S',
} as const;

const nullableStringSchema = {
  anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
} as const;

const cursorPropertySchema = { type: 'string', minLength: 1 } as const;
const adminSearchQueryPropertySchema = {
  type: 'string',
  minLength: 1,
  maxLength: 200,
  pattern: '\\S',
} as const;

const limitPropertySchema = {
  anyOf: [
    { type: 'integer', minimum: 1 },
    { type: 'string', pattern: '^[1-9][0-9]*$' },
  ],
} as const;

const levelQueryPropertySchema = {
  anyOf: [
    { type: 'integer', enum: userLevelValues },
    { type: 'string', pattern: '^(10|[1-9])$' },
  ],
} as const;

const userLevelOrNullSchema = {
  anyOf: [{ type: 'integer', enum: userLevelValues }, { type: 'null' }],
} as const;

const emptyObjectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const satisfies JsonSchema;

export const currentUserQuerystringSchema = emptyObjectSchema;

export const completeProfileRequestBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['firstName', 'lastName', 'mobileNumber'],
  properties: {
    firstName: nonWhitespaceStringSchema,
    lastName: nonWhitespaceStringSchema,
    mobileNumber: {
      type: 'string',
      pattern: '^\\+[1-9][0-9]{7,14}$',
    },
  },
} as const satisfies JsonSchema;

export const adminPendingRequestsQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: limitPropertySchema,
    cursor: cursorPropertySchema,
  },
} as const satisfies JsonSchema;

export const adminPendingRequestsCountQuerystringSchema = emptyObjectSchema;

export const adminUserParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['userId'],
  properties: {
    userId: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

const adminApproveRequestBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    role: { type: 'string', enum: userRoleValues },
    level: { type: 'integer', enum: userLevelValues },
  },
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['role'],
      properties: {
        role: { const: 'admin' },
      },
      not: { required: ['level'] },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['role', 'level'],
      properties: {
        role: { const: 'user' },
        level: { type: 'integer', enum: userLevelValues },
      },
    },
  ],
} as const satisfies JsonSchema;

export const approveUserRequestBodySchema = adminApproveRequestBodySchema;
export const rejectUserRequestBodySchema = emptyObjectSchema;
export const suspendUserRequestBodySchema = emptyObjectSchema;
export const unsuspendUserRequestBodySchema = emptyObjectSchema;

export const adminUsersQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: userStatusValues },
    role: { type: 'string', enum: userRoleValues },
    level: levelQueryPropertySchema,
    q: adminSearchQueryPropertySchema,
    limit: limitPropertySchema,
    cursor: cursorPropertySchema,
  },
} as const satisfies JsonSchema;

export const adminPatchUserRequestBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    role: { type: 'string', enum: userRoleValues },
    status: { type: 'string', enum: ['approved', 'rejected', 'suspended'] },
    level: userLevelOrNullSchema,
  },
} as const satisfies JsonSchema;

export const adminUserHistoryQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: limitPropertySchema,
    cursor: cursorPropertySchema,
  },
} as const satisfies JsonSchema;

export const authorizationResolveRequestBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['auth0'],
  properties: {
    auth0: auth0IdentityClaimsSchema,
  },
} as const satisfies JsonSchema;

export const internalUserIdentityLookupRequestBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['userIds'],
  properties: {
    userIds: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
    },
  },
} as const satisfies JsonSchema;

export const currentUserSummarySchema = {
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
  properties: {
    id: { type: 'string', minLength: 1 },
    email: { type: 'string', minLength: 1 },
    firstName: nullableStringSchema,
    lastName: nullableStringSchema,
    mobileNumber: nullableStringSchema,
    role: { type: 'string', enum: userRoleValues },
    status: { type: 'string', enum: userStatusValues },
    level: userLevelOrNullSchema,
    effectiveLevel: { type: 'integer', enum: userLevelValues },
    availableStatusTransitions: {
      type: 'array',
      items: { type: 'string', enum: ['approved', 'suspended'] },
    },
  },
} as const satisfies JsonSchema;

const approvedCurrentUserSummarySchema = {
  ...currentUserSummarySchema,
  properties: {
    ...currentUserSummarySchema.properties,
    status: { const: 'approved' },
  },
} as const satisfies JsonSchema;

const profileRequiredCurrentUserSummarySchema = {
  ...currentUserSummarySchema,
  properties: {
    ...currentUserSummarySchema.properties,
    status: { const: 'profile_required' },
  },
} as const satisfies JsonSchema;

const pendingCurrentUserSummarySchema = {
  ...currentUserSummarySchema,
  properties: {
    ...currentUserSummarySchema.properties,
    status: { const: 'pending' },
  },
} as const satisfies JsonSchema;

const rejectedCurrentUserSummarySchema = {
  ...currentUserSummarySchema,
  properties: {
    ...currentUserSummarySchema.properties,
    status: { const: 'rejected' },
  },
} as const satisfies JsonSchema;

const suspendedCurrentUserSummarySchema = {
  ...currentUserSummarySchema,
  properties: {
    ...currentUserSummarySchema.properties,
    status: { const: 'suspended' },
  },
} as const satisfies JsonSchema;

const nullableCursorResponseSchema = {
  anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
} as const;

const arbitraryObjectSchema = {
  type: 'object',
  additionalProperties: true,
} as const;

export const userChangeTypeValues = [
  'status_changed',
  'role_changed',
  'level_changed',
  'profile_changed',
] as const;

export const userChangeEventResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'targetUserId', 'actorUserId', 'type', 'before', 'after', 'createdAt'],
  properties: {
    id: { type: 'string', minLength: 1 },
    targetUserId: { type: 'string', minLength: 1 },
    actorUserId: { type: 'string', minLength: 1 },
    type: { type: 'string', enum: userChangeTypeValues },
    before: arbitraryObjectSchema,
    after: arbitraryObjectSchema,
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const satisfies JsonSchema;

export const adminUserListResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['users', 'nextCursor', 'totalCount'],
  properties: {
    users: {
      type: 'array',
      items: currentUserSummarySchema,
    },
    nextCursor: nullableCursorResponseSchema,
    totalCount: { type: 'integer', minimum: 0 },
  },
} as const satisfies JsonSchema;

export const internalUserIdentitySummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'email', 'firstName', 'lastName', 'role', 'status', 'effectiveLevel'],
  properties: {
    id: { type: 'string', minLength: 1 },
    email: { type: 'string', minLength: 1 },
    firstName: nullableStringSchema,
    lastName: nullableStringSchema,
    role: { type: 'string', enum: userRoleValues },
    status: { type: 'string', enum: userStatusValues },
    effectiveLevel: { type: 'integer', enum: userLevelValues },
  },
} as const satisfies JsonSchema;

export const internalUserIdentityLookupResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['users'],
  properties: {
    users: {
      type: 'array',
      items: internalUserIdentitySummarySchema,
    },
  },
} as const satisfies JsonSchema;

export const adminPendingRequestsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['users', 'nextCursor'],
  properties: {
    users: {
      type: 'array',
      items: pendingCurrentUserSummarySchema,
    },
    nextCursor: nullableCursorResponseSchema,
  },
} as const satisfies JsonSchema;

export const adminPendingRequestsCountResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['count'],
  properties: {
    count: { type: 'integer', minimum: 0 },
  },
} as const satisfies JsonSchema;

export const adminUserMutationResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['user', 'events'],
  properties: {
    user: currentUserSummarySchema,
    events: {
      type: 'array',
      items: userChangeEventResponseSchema,
    },
  },
} as const satisfies JsonSchema;

export const adminUserHistoryResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['events', 'nextCursor'],
  properties: {
    events: {
      type: 'array',
      items: userChangeEventResponseSchema,
    },
    nextCursor: nullableCursorResponseSchema,
  },
} as const satisfies JsonSchema;

export const authorizationResolveResponseSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'user', 'authorization'],
      properties: {
        state: { const: 'approved' },
        user: approvedCurrentUserSummarySchema,
        authorization: authorizationContextSchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'user', 'requiredFields'],
      properties: {
        state: { const: 'profile_required' },
        user: {
          anyOf: [profileRequiredCurrentUserSummarySchema, { type: 'null' }],
        },
        requiredFields: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['firstName', 'lastName', 'mobileNumber'],
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'user'],
      properties: {
        state: { const: 'pending' },
        user: pendingCurrentUserSummarySchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'user'],
      properties: {
        state: { const: 'rejected' },
        user: rejectedCurrentUserSummarySchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'user'],
      properties: {
        state: { const: 'suspended' },
        user: suspendedCurrentUserSummarySchema,
      },
    },
  ],
} as const satisfies JsonSchema;
