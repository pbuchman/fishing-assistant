export const metadata = {
  id: '006',
  name: 'chat-user-ownership',
  description: 'Chat Service user ownership indexes',
  createdAt: '2026-06-17',
};

export const removedIndexes = [
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

export const indexes = [
  {
    collectionGroup: 'fishing_conversations',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'lastMessageAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fishing_conversation_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
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
