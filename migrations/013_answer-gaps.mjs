const answerGapIndexes = [
  {
    collectionGroup: 'fa_answer_gaps',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'fa_answer_gaps',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'createdAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
];

export const migration = {
  id: '013',
  name: 'answer-gaps',
  description: 'Composite indexes for Knowledge Service Answer Gap admin queues',
  indexes: answerGapIndexes,
  async apply() {
    return { indexesDeclared: 2 };
  },
};

export const metadata = {
  id: migration.id,
  name: migration.name,
  description: migration.description,
  createdAt: '2026-06-19',
};

export const indexes = migration.indexes;

/**
 * @param {{ deployIndexes: () => Promise<void> }} context
 * @returns {Promise<void>}
 */
export async function up(context) {
  await context.deployIndexes();
}
