export const metadata = {
  id: '004',
  name: 'chat-indexes',
  description: 'Composite indexes for Chat Service conversation and message queries',
  createdAt: '2026-06-14',
};

export const indexes = [
  {
    collectionGroup: 'fishing_conversations',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'workspaceId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'lastMessageAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fishing_conversation_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'workspaceId', order: 'ASCENDING' },
      { fieldPath: 'conversationId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
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
