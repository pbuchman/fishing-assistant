export const metadata = {
  id: '007',
  name: 'knowledge-tree-access',
  description: 'Current-schema Knowledge Base tree/page/chunk indexes',
  createdAt: '2026-06-17',
};

export const indexes = [
  {
    collectionGroup: 'fa_knowledge_nodes',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'parentId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'sortIndex', order: 'ASCENDING' },
      { fieldPath: 'title', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_nodes',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'categoryId', order: 'ASCENDING' },
      { fieldPath: 'type', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'sortIndex', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_pages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'categoryId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_pages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'syncStatus', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_pages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'indexingStatus', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_pages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_pages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'syncStatus', order: 'ASCENDING' },
      { fieldPath: 'indexingStatus', order: 'ASCENDING' },
      { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_pages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'access.effective.accessRevision', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_chunks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'pageId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'index', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_chunks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'categoryId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
      { fieldPath: 'accessRevision', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_chunks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
      { fieldPath: 'accessRefreshedAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_chunks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
      { fieldPath: 'embedding', vectorConfig: { dimension: 2048, flat: {} } },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_refresh_jobs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'nextRunAt', order: 'ASCENDING' },
      { fieldPath: 'priority', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_refresh_jobs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'leaseExpiresAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_refresh_jobs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'target.categoryId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_refresh_jobs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_refresh_jobs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'finishedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_audits',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'severity', order: 'ASCENDING' },
      { fieldPath: 'detectedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_audits',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'pageId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'detectedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_audits',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'chunkId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'detectedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_audits',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'kind', order: 'ASCENDING' },
      { fieldPath: 'detectedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_knowledge_access_audits',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'kind', order: 'ASCENDING' },
      { fieldPath: 'resolvedAt', order: 'DESCENDING' },
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
