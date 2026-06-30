export const metadata = {
  id: '010',
  name: 'knowledge-node-active-list-index',
  description: 'Composite index for active Knowledge Base node list queries',
  createdAt: '2026-06-18',
};

export const indexes = [
  {
    collectionGroup: 'fa_knowledge_nodes',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'sortIndex', order: 'ASCENDING' },
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
