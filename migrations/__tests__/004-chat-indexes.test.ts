import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../004_chat-indexes.mjs'; // @allow-missing-js -- migration modules are .mjs

describe('migration 004 - chat indexes', () => {
  it('exports metadata', () => {
    expect(metadata).toEqual({
      id: '004',
      name: 'chat-indexes',
      description: 'Composite indexes for Chat Service conversation and message queries',
      createdAt: '2026-06-14',
    });
  });

  it('defines the required chat conversation and message indexes', () => {
    expect(indexes).toEqual([
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
    ]);
  });

  it('deploys indexes through the migration context', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();
  });
});
