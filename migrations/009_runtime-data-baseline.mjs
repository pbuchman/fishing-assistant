import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pricingSeed } from './002_seed-llm-pricing.mjs';

/**
 * @typedef {{ provider: string; model: string }} PricingDocumentKey
 * @typedef {{ id: string; ref: { delete: () => Promise<void> } }} FirestoreDocument
 * @typedef {{ docs: FirestoreDocument[]; empty?: boolean }} FirestoreQuerySnapshot
 * @typedef {{ set: (value: unknown) => Promise<void> }} FirestoreDocWriter
 * @typedef {{
 *   doc: (id: string) => FirestoreDocWriter;
 *   get: () => Promise<{ docs: FirestoreDocument[] }>;
 *   limit: (pageSize: number) => { get: () => Promise<FirestoreQuerySnapshot> };
 *   count?: () => { get: () => Promise<{ data: () => { count: number } }> };
 * }} FirestoreCollection
 * @typedef {{
 *   collection: (name: string) => FirestoreCollection;
 *   batch: () => {
 *     delete: (ref: FirestoreDocument['ref']) => unknown;
 *     commit: () => Promise<void>;
 *   };
 * }} ResetFirestore
 * @typedef {{
 *   status: string;
 *   preResetCounts?: Record<string, number>;
 *   resetCounts?: Record<string, number>;
 *   removedPricingRecords?: number;
 *   preservedCollections: string[];
 *   baselineCollections: string[];
 * }} DataBaselineSummary
 */

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(modulePath), '..');
const baselineReportDocumentId = '009_runtime-data-baseline-report';

export const metadata = {
  id: '009',
  name: 'runtime-data-baseline',
  description: 'Current Firestore data baseline and Knowledge Base index cleanup',
  createdAt: '2026-06-17',
};

export const removedKnowledgeCollections = [
  'fishing_knowledge_documents',
  'fishing_knowledge_chunks',
];

export const resetCollectionNames = [
  ...removedKnowledgeCollections,
  'fishing_conversations',
  'fishing_conversation_messages',
  'llm_usage_events',
  'llm_usage_daily_aggregates',
  'fa_knowledge_nodes',
  'fa_knowledge_pages',
  'fa_knowledge_chunks',
  'fa_knowledge_access_refresh_jobs',
  'fa_knowledge_access_audits',
  'fa_users',
  'fa_user_identity_reservations',
  'fa_user_change_events',
];

export const removedIndexes = [
  {
    collectionGroup: 'fishing_knowledge_documents',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'workspaceId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fishing_knowledge_documents',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'workspaceId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'syncStatus', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fishing_knowledge_documents',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'workspaceId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'indexingStatus', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fishing_knowledge_chunks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'workspaceId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'documentId', order: 'ASCENDING' },
      { fieldPath: 'index', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fishing_knowledge_chunks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'workspaceId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'embedding', vectorConfig: { dimension: 2048, flat: {} } },
    ],
  },
];

const requiredRegistryCollections = [
  'fa_knowledge_nodes',
  'fa_knowledge_pages',
  'fa_knowledge_chunks',
  'fa_knowledge_access_refresh_jobs',
  'fa_knowledge_access_audits',
  'fa_users',
  'fa_user_identity_reservations',
  'fa_user_change_events',
  'llm_pricing',
];

const requiredChatUserConversationIndex = {
  collectionGroup: 'fishing_conversations',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'userId', order: 'ASCENDING' },
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'lastMessageAt', order: 'DESCENDING' },
  ],
};

const requiredUserAuthSubjectIndex = {
  collectionGroup: 'fa_users',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'auth0Subject', order: 'ASCENDING' },
    { fieldPath: 'deletedAt', order: 'ASCENDING' },
  ],
};

const requiredKnowledgeVectorRetrievalIndex = {
  collectionGroup: 'fa_knowledge_chunks',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
    { fieldPath: 'embedding', vectorConfig: { dimension: 2048, flat: {} } },
  ],
};

const requiredKnowledgeAccessRefreshIndex = {
  collectionGroup: 'fa_knowledge_access_refresh_jobs',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'nextRunAt', order: 'ASCENDING' },
    { fieldPath: 'priority', order: 'DESCENDING' },
  ],
};

const requiredUsageOwnerDayAggregateIndex = {
  collectionGroup: 'llm_usage_daily_aggregates',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'owner.id', order: 'ASCENDING' },
    { fieldPath: 'bucket.day', order: 'ASCENDING' },
  ],
};

const requiredBaselineIndexes = [
  requiredChatUserConversationIndex,
  requiredUserAuthSubjectIndex,
  requiredKnowledgeVectorRetrievalIndex,
  requiredKnowledgeAccessRefreshIndex,
  requiredUsageOwnerDayAggregateIndex,
];

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {PricingDocumentKey} pricing
 * @returns {string}
 */
function pricingDocumentId(pricing) {
  return `${encodeURIComponent(pricing.provider)}__${encodeURIComponent(pricing.model)}`;
}

/**
 * @param {string} root
 * @param {string} relativePath
 * @returns {unknown}
 */
function readJsonArtifact(root, relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'));
}

/**
 * @param {unknown} index
 * @returns {string}
 */
function firestoreIndexKey(index) {
  return JSON.stringify(index);
}

/**
 * @param {string} [root]
 * @returns {string[]}
 */
export function validateRuntimeDataBaselineArtifacts(root = repoRoot) {
  const errors = /** @type {string[]} */ ([]);

  const registry = readJsonArtifact(root, 'firestore-collections.json');
  const collections =
    isRecord(registry) &&
    registry['collections'] !== null &&
    typeof registry['collections'] === 'object'
      ? /** @type {Record<string, unknown>} */ (registry['collections'])
      : {};

  for (const name of removedKnowledgeCollections) {
    if (Object.hasOwn(collections, name)) {
      errors.push(
        `${name} must be removed from firestore-collections.json before runtime data baseline`
      );
    }
  }

  for (const name of requiredRegistryCollections) {
    if (!Object.hasOwn(collections, name)) {
      errors.push(
        `${name} must remain registered in firestore-collections.json for runtime data baseline`
      );
    }
  }

  const artifact = readJsonArtifact(root, 'firestore.indexes.json');
  const indexes =
    isRecord(artifact) && Array.isArray(artifact['indexes']) ? artifact['indexes'] : [];
  const indexKeys = new Set(indexes.map((index) => firestoreIndexKey(index)));

  for (const index of removedIndexes) {
    if (indexKeys.has(firestoreIndexKey(index))) {
      errors.push(
        'firestore.indexes.json must remove removed Knowledge Base indexes before runtime data baseline'
      );
      break;
    }
  }

  for (const index of requiredBaselineIndexes) {
    if (!indexKeys.has(firestoreIndexKey(index))) {
      errors.push(
        'firestore.indexes.json must keep required current-schema user, knowledge, and usage indexes before runtime data baseline'
      );
      break;
    }
  }

  return errors;
}

/**
 * @param {ResetFirestore} firestore
 * @param {string} collectionName
 * @returns {Promise<number>}
 */
async function countCollectionDocuments(firestore, collectionName) {
  const collection = firestore.collection(collectionName);
  if (typeof collection.count === 'function') {
    const snapshot = await collection.count().get();
    return snapshot.data().count;
  }

  throw new Error(
    `Firestore count aggregation is required for bounded pre-reset counts on ${collectionName}`
  );
}

/**
 * @param {ResetFirestore} firestore
 * @param {string} collectionName
 * @param {number} [pageSize]
 * @returns {Promise<number>}
 */
async function deleteCollectionDocuments(firestore, collectionName, pageSize = 100) {
  let deletedCount = 0;

  for (;;) {
    const snapshot = await firestore.collection(collectionName).limit(pageSize).get();
    if (snapshot.empty) {
      return deletedCount;
    }

    const batch = firestore.batch();
    for (const document of snapshot.docs) {
      batch.delete(document.ref);
    }
    await batch.commit();
    deletedCount += snapshot.docs.length;
  }
}

/**
 * @param {ResetFirestore} firestore
 * @returns {Promise<number>}
 */
async function repairPricingSeed(firestore) {
  const expectedDocumentIds = new Set(pricingSeed.map((pricing) => pricingDocumentId(pricing)));
  const snapshot = await firestore.collection('llm_pricing').get();

  let removedPricingRecords = 0;
  for (const document of snapshot.docs) {
    if (expectedDocumentIds.has(document.id)) {
      continue;
    }

    removedPricingRecords += 1;
    await document.ref.delete();
  }

  const updatedAt = new Date().toISOString();
  for (const pricing of pricingSeed) {
    await firestore
      .collection('llm_pricing')
      .doc(pricingDocumentId(pricing))
      .set({ ...pricing, updatedAt });
  }

  return removedPricingRecords;
}

/**
 * @param {ResetFirestore} firestore
 * @param {DataBaselineSummary} summary
 * @returns {Promise<void>}
 */
async function writeDataBaselineReport(firestore, summary) {
  await firestore
    .collection('_migrations')
    .doc(baselineReportDocumentId)
    .set({
      migrationId: metadata.id,
      migrationName: metadata.name,
      recordedAt: new Date().toISOString(),
      ...summary,
    });
}

/**
 * @param {{
 *   firestore: ResetFirestore;
 *   deployIndexes: () => Promise<void>;
 *   deletePageSize?: number;
 * }} context
 * @returns {Promise<{ baseline: {
 *   status: string;
 *   preResetCounts: Record<string, number>;
 *   resetCounts: Record<string, number>;
 *   removedPricingRecords: number;
 *   preservedCollections: string[];
 *   baselineCollections: string[];
 * } }>}
 */
export async function up(context) {
  const artifactErrors = validateRuntimeDataBaselineArtifacts();
  if (artifactErrors.length > 0) {
    throw new Error(artifactErrors.join('\n'));
  }

  await context.deployIndexes();

  const preResetCounts = /** @type {Record<string, number>} */ ({});
  for (const collectionName of resetCollectionNames) {
    preResetCounts[collectionName] = await countCollectionDocuments(
      context.firestore,
      collectionName
    );
  }

  await writeDataBaselineReport(context.firestore, {
    status: 'reset_started',
    preResetCounts,
    preservedCollections: ['_migrations'],
    baselineCollections: ['llm_pricing'],
  });

  const resetCounts = /** @type {Record<string, number>} */ ({});
  const deletePageSize = context.deletePageSize ?? 100;
  for (const collectionName of resetCollectionNames) {
    resetCounts[collectionName] = await deleteCollectionDocuments(
      context.firestore,
      collectionName,
      deletePageSize
    );
  }

  const removedPricingRecords = await repairPricingSeed(context.firestore);
  const summary = {
    status: 'reset_completed',
    preResetCounts,
    resetCounts,
    removedPricingRecords,
    preservedCollections: ['_migrations'],
    baselineCollections: ['llm_pricing'],
  };

  await writeDataBaselineReport(context.firestore, summary);

  return { baseline: summary };
}
