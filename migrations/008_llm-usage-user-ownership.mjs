export const metadata = {
  id: '008',
  name: 'llm-usage-user-ownership',
  description: 'Current-schema user-owned LLM usage event and aggregate indexes',
  createdAt: '2026-06-17',
};

export const removedIndexes = [
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'ownerId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'ownerId', order: 'ASCENDING' },
      { fieldPath: 'service', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'ownerId', order: 'ASCENDING' },
      { fieldPath: 'operation', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'ownerId', order: 'ASCENDING' },
      { fieldPath: 'service', order: 'ASCENDING' },
      { fieldPath: 'operation', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'llm_usage_daily_aggregates',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'ownerId', order: 'ASCENDING' },
      { fieldPath: 'date', order: 'ASCENDING' },
    ],
  },
];

export const indexes = [
  {
    collectionGroup: 'llm_usage_daily_aggregates',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'owner.id', order: 'ASCENDING' },
      { fieldPath: 'bucket.day', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'llm_usage_daily_aggregates',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'request.model', order: 'ASCENDING' },
      { fieldPath: 'bucket.day', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'llm_usage_daily_aggregates',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'source.promptType', order: 'ASCENDING' },
      { fieldPath: 'bucket.day', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'llm_usage_daily_aggregates',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'source.service', order: 'ASCENDING' },
      { fieldPath: 'source.operation', order: 'ASCENDING' },
      { fieldPath: 'bucket.day', order: 'ASCENDING' },
    ],
  },
];

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} value
 * @param {string} key
 * @returns {boolean}
 */
function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * @param {readonly unknown[]} documents
 * @returns {{
 *   total: number;
 *   ownerType: number;
 *   ownerId: number;
 *   workspaceId: number;
 *   nonUserOwner: number;
 *   anonymousOwner: number;
 * }}
 */
export function countRetiredUsageDocuments(documents) {
  const counts = {
    total: 0,
    ownerType: 0,
    ownerId: 0,
    workspaceId: 0,
    nonUserOwner: 0,
    anonymousOwner: 0,
  };

  for (const document of documents) {
    if (!isRecord(document)) {
      continue;
    }

    const owner = isRecord(document['owner']) ? document['owner'] : undefined;
    const hasOwnerType = hasOwn(document, 'ownerType');
    const hasOwnerId = hasOwn(document, 'ownerId');
    const hasWorkspaceId = hasOwn(document, 'workspaceId');
    const hasNonUserOwner = owner !== undefined && owner['type'] !== 'user';
    const hasAnonymousOwner = owner !== undefined && owner['id'] === 'anonymous';

    if (hasOwnerType) counts.ownerType += 1;
    if (hasOwnerId) counts.ownerId += 1;
    if (hasWorkspaceId) counts.workspaceId += 1;
    if (hasNonUserOwner) counts.nonUserOwner += 1;
    if (hasAnonymousOwner) counts.anonymousOwner += 1;

    if (hasOwnerType || hasOwnerId || hasWorkspaceId || hasNonUserOwner || hasAnonymousOwner) {
      counts.total += 1;
    }
  }

  return counts;
}

/**
 * @param {{ deployIndexes: () => Promise<void> }} context
 * @returns {Promise<void>}
 */
export async function up(context) {
  await context.deployIndexes();
}
