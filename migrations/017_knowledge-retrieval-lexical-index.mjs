const knowledgeRetrievalLexicalIndexes = [
  {
    collectionGroup: 'fa_knowledge_chunks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'pageId', order: 'ASCENDING' },
      { fieldPath: 'index', order: 'ASCENDING' },
    ],
  },
];

export const migration = {
  id: '017',
  name: 'knowledge-retrieval-lexical-index',
  description: 'Composite index for projected Knowledge Service lexical retrieval candidates',
  indexes: knowledgeRetrievalLexicalIndexes,
  async apply() {
    return { indexesDeclared: 1 };
  },
};

export const metadata = {
  id: migration.id,
  name: migration.name,
  description: migration.description,
  createdAt: '2026-06-23',
};

export const indexes = migration.indexes;

/**
 * @param {{ deployIndexes: () => Promise<void> }} context
 * @returns {Promise<void>}
 */
export async function up(context) {
  await context.deployIndexes();
}
