export const metadata = {
  id: '011',
  name: 'knowledge-page-active-list-index',
  description: 'Composite index for active Knowledge Base page list queries',
  createdAt: '2026-06-18',
};

export const indexes = [
  {
    collectionGroup: 'fa_knowledge_pages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
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
