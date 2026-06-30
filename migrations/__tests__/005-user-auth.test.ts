import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../005_user-auth.mjs'; // @allow-missing-js -- migration modules are .mjs

export const expectedUserAuthIndexes = [
  {
    collectionGroup: 'fa_users',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'auth0Subject', order: 'ASCENDING' },
      { fieldPath: 'deletedAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_users',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'normalizedEmail', order: 'ASCENDING' },
      { fieldPath: 'deletedAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_users',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'deletedAt', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_users',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'deletedAt', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_users',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'deletedAt', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_users',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'role', order: 'ASCENDING' },
      { fieldPath: 'deletedAt', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_users',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'level', order: 'ASCENDING' },
      { fieldPath: 'deletedAt', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_users',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'role', order: 'ASCENDING' },
      { fieldPath: 'deletedAt', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_users',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'level', order: 'ASCENDING' },
      { fieldPath: 'deletedAt', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_users',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'role', order: 'ASCENDING' },
      { fieldPath: 'level', order: 'ASCENDING' },
      { fieldPath: 'deletedAt', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_users',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'role', order: 'ASCENDING' },
      { fieldPath: 'level', order: 'ASCENDING' },
      { fieldPath: 'deletedAt', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_user_change_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'targetUserId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
];

describe('migration 005 - user auth', () => {
  it('exports metadata', () => {
    expect(metadata).toEqual({
      id: '005',
      name: 'user-auth',
      description: 'User Service current-schema user and history indexes',
      createdAt: '2026-06-17',
    });
  });

  it('defines the exact required user-service indexes', () => {
    expect(indexes).toEqual(expectedUserAuthIndexes);
  });

  it('deploys indexes through the migration context', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();
  });

  it('keeps firestore.indexes.json in sync with the migration', () => {
    const artifact = JSON.parse(readFileSync(resolve('firestore.indexes.json'), 'utf8')) as {
      indexes: unknown[];
    };

    expect(artifact.indexes).toEqual(expect.arrayContaining(expectedUserAuthIndexes));
  });

  it('registers user-service owned Firestore collections', () => {
    const registry = JSON.parse(readFileSync(resolve('firestore-collections.json'), 'utf8')) as {
      collections: Record<string, unknown>;
    };

    expect(registry.collections).toMatchObject({
      fa_users: {
        owner: 'user-service',
        description:
          'FA user profiles, Auth0 identity bindings, authorization role/status/tier, and soft-delete state.',
      },
      fa_user_identity_reservations: {
        owner: 'user-service',
        description:
          'Deterministic Auth0 subject and normalized-email reservation documents used to enforce user identity uniqueness transactionally.',
      },
      fa_user_change_events: {
        owner: 'user-service',
        description: 'Immutable user profile, status, role, and tier change history.',
      },
    });
  });
});
