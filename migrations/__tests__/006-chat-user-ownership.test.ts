import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, removedIndexes, up } from '../006_chat-user-ownership.mjs'; // @allow-missing-js -- migration modules are .mjs

const expectedConversationIndex = {
  collectionGroup: 'fishing_conversations',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'userId', order: 'ASCENDING' },
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'lastMessageAt', order: 'DESCENDING' },
  ],
};

const expectedMessageIndex = {
  collectionGroup: 'fishing_conversation_messages',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'userId', order: 'ASCENDING' },
    { fieldPath: 'conversationId', order: 'ASCENDING' },
    { fieldPath: 'createdAt', order: 'ASCENDING' },
  ],
};

const expectedRemovedConversationIndex = {
  collectionGroup: 'fishing_conversations',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'workspaceId', order: 'ASCENDING' },
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'lastMessageAt', order: 'DESCENDING' },
  ],
};

const expectedRemovedMessageIndex = {
  collectionGroup: 'fishing_conversation_messages',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'workspaceId', order: 'ASCENDING' },
    { fieldPath: 'conversationId', order: 'ASCENDING' },
    { fieldPath: 'createdAt', order: 'ASCENDING' },
  ],
};

describe('migration 006 - chat user ownership', () => {
  it('exports metadata', () => {
    expect(metadata).toEqual({
      id: '006',
      name: 'chat-user-ownership',
      description: 'Chat Service user ownership indexes',
      createdAt: '2026-06-17',
    });
  });

  it('defines the replacement chat indexes and removes the obsolete workspace indexes', () => {
    expect(indexes).toEqual([expectedConversationIndex, expectedMessageIndex]);
    expect(removedIndexes).toEqual([expectedRemovedConversationIndex, expectedRemovedMessageIndex]);
  });

  it('deploys indexes through the migration context', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();
  });

  it('keeps firestore.indexes.json in sync with the user-owned chat indexes only', () => {
    const artifact = JSON.parse(readFileSync(resolve('firestore.indexes.json'), 'utf8')) as {
      indexes: unknown[];
    };

    expect(artifact.indexes).toEqual(
      expect.arrayContaining([expectedConversationIndex, expectedMessageIndex])
    );
    expect(artifact.indexes).not.toEqual(
      expect.arrayContaining([expectedRemovedConversationIndex, expectedRemovedMessageIndex])
    );
  });
});
