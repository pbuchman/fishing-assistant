import type { JsonSchema } from './routeSchemas.js';

export const userStatusValues = [
  'profile_required',
  'pending',
  'approved',
  'rejected',
  'suspended',
] as const;

export const userRoleValues = ['user', 'admin'] as const;
export const userLevelValues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export type UserStatus = (typeof userStatusValues)[number];
export type UserRole = (typeof userRoleValues)[number];
export type UserLevel = (typeof userLevelValues)[number];

export interface AuthorizationContext {
  userId: string;
  auth0Subject: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role: UserRole;
  status: 'approved';
  effectiveLevel: UserLevel;
}

export interface RagAuthorizationContext {
  userId: string;
  role: UserRole;
  status: 'approved';
  effectiveLevel: UserLevel;
}

export interface Auth0IdentityClaims {
  subject: string;
  email?: string;
  emailVerified?: boolean;
  name?: string | null;
}

export const authorizationContextSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['userId', 'auth0Subject', 'email', 'role', 'status', 'effectiveLevel'],
  properties: {
    userId: { type: 'string', minLength: 1 },
    auth0Subject: { type: 'string', minLength: 1 },
    email: { type: 'string', minLength: 1 },
    firstName: {
      anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    },
    lastName: {
      anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    },
    role: { type: 'string', enum: userRoleValues },
    status: { const: 'approved' },
    effectiveLevel: { type: 'integer', enum: userLevelValues },
  },
} as const satisfies JsonSchema;

export const ragAuthorizationContextSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['userId', 'role', 'status', 'effectiveLevel'],
  properties: {
    userId: { type: 'string', minLength: 1 },
    role: { type: 'string', enum: userRoleValues },
    status: { const: 'approved' },
    effectiveLevel: { type: 'integer', enum: userLevelValues },
  },
} as const satisfies JsonSchema;

export const auth0IdentityClaimsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['subject'],
  properties: {
    subject: { type: 'string', minLength: 1 },
    email: { type: 'string', minLength: 1 },
    emailVerified: { type: 'boolean' },
    name: {
      anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    },
  },
} as const satisfies JsonSchema;
