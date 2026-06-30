export const metadata = {
  id: '003',
  name: 'knowledge-indexes',
  description: 'Composite and vector indexes for Knowledge Service document and chunk queries',
  createdAt: '2026-06-14',
};

export const indexes = [
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
      {
        fieldPath: 'embedding',
        order: 'ASCENDING',
        vectorConfig: {
          dimension: 2048,
          flatIndexEnabled: true,
        },
      },
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
