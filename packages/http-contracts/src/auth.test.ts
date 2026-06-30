import { describe, expect, it } from 'vitest';

import {
  auth0IdentityClaimsSchema,
  authorizationContextSchema,
  ragAuthorizationContextSchema,
  type AuthorizationContext,
  type Auth0IdentityClaims,
  type RagAuthorizationContext,
  type UserLevel,
  userLevelValues,
  type UserRole,
  userRoleValues,
  type UserStatus,
  userStatusValues,
} from './auth.js';

describe('auth contract primitives', () => {
  it('defines the canonical user status, role, and level values', () => {
    expect(userStatusValues).toEqual([
      'profile_required',
      'pending',
      'approved',
      'rejected',
      'suspended',
    ]);
    expect(userRoleValues).toEqual(['user', 'admin']);
    expect(userLevelValues).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const status: UserStatus = 'approved';
    const role: UserRole = 'admin';
    const level: UserLevel = 10;

    expect({ status, role, level }).toEqual({
      status: 'approved',
      role: 'admin',
      level: 10,
    });
  });

  it('defines AuthorizationContext as an approved-user-only shape', () => {
    const authorization: AuthorizationContext = {
      userId: 'user-1',
      auth0Subject: 'auth0|abc',
      email: 'person@example.com',
      role: 'user',
      status: 'approved',
      effectiveLevel: 7,
    };

    expect(Object.keys(authorization)).toEqual([
      'userId',
      'auth0Subject',
      'email',
      'role',
      'status',
      'effectiveLevel',
    ]);
    expect(authorizationContextSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['userId', 'auth0Subject', 'email', 'role', 'status', 'effectiveLevel'],
      properties: {
        status: { const: 'approved' },
        role: { type: 'string', enum: userRoleValues },
        effectiveLevel: { type: 'integer', enum: userLevelValues },
      },
    });
  });

  it('defines a RAG-safe authorization context without profile identity fields', () => {
    const authorization: RagAuthorizationContext = {
      userId: 'user-1',
      role: 'admin',
      status: 'approved',
      effectiveLevel: 10,
    };

    expect(Object.keys(authorization)).toEqual(['userId', 'role', 'status', 'effectiveLevel']);
    expect(ragAuthorizationContextSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['userId', 'role', 'status', 'effectiveLevel'],
      properties: {
        userId: { type: 'string', minLength: 1 },
        role: { type: 'string', enum: userRoleValues },
        status: { const: 'approved' },
        effectiveLevel: { type: 'integer', enum: userLevelValues },
      },
    });
    expect(ragAuthorizationContextSchema.properties).not.toHaveProperty('auth0Subject');
    expect(ragAuthorizationContextSchema.properties).not.toHaveProperty('email');
    expect(ragAuthorizationContextSchema.properties).not.toHaveProperty('workspaceId');
  });

  it('defines Auth0 identity claims without FA authorization fields', () => {
    const claims: Auth0IdentityClaims = {
      subject: 'auth0|abc',
      email: 'person@example.com',
      emailVerified: true,
      name: null,
    };

    expect(claims).toEqual({
      subject: 'auth0|abc',
      email: 'person@example.com',
      emailVerified: true,
      name: null,
    });
    expect(auth0IdentityClaimsSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['subject'],
      properties: {
        subject: { type: 'string', minLength: 1 },
        email: { type: 'string', minLength: 1 },
        emailVerified: { type: 'boolean' },
        name: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
      },
    });
    expect(auth0IdentityClaimsSchema.properties).not.toHaveProperty('userId');
    expect(auth0IdentityClaimsSchema.properties).not.toHaveProperty('role');
    expect(auth0IdentityClaimsSchema.properties).not.toHaveProperty('status');
    expect(auth0IdentityClaimsSchema.properties).not.toHaveProperty('level');
    expect(auth0IdentityClaimsSchema.properties).not.toHaveProperty('workspaceId');
    expect(auth0IdentityClaimsSchema.properties).not.toHaveProperty('ownerId');
  });
});
