export const metadata = {
  id: '005',
  name: 'user-auth',
  description: 'User Service current-schema user and history indexes',
  createdAt: '2026-06-17',
};

export const indexes = [
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

/**
 * @param {{ deployIndexes: () => Promise<void> }} context
 * @returns {Promise<void>}
 */
export async function up(context) {
  await context.deployIndexes();
}
