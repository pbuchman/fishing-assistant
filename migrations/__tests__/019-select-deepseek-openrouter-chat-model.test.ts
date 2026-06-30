import { describe, expect, it } from 'vitest';

import {
  CHAT_MODEL_SETTINGS_DOCUMENT_ID,
  CHAT_MODEL_SETTINGS_MIGRATION_USER_ID,
  CHAT_RUNTIME_SETTINGS_COLLECTION,
  DEFAULT_CHAT_MODEL,
  metadata,
  up,
} from '../019_select-deepseek-openrouter-chat-model.mjs'; // @allow-missing-js -- migration modules are .mjs

class FakeDocumentSnapshot {
  constructor(
    readonly exists: boolean,
    private readonly value: Record<string, unknown> | undefined
  ) {}

  data(): Record<string, unknown> | undefined {
    return this.value;
  }
}

class FakeFirestore {
  readonly writes = new Map<string, Record<string, unknown>>();
  private readonly documents = new Map<string, Record<string, unknown>>();

  constructor(initialDocuments: Record<string, Record<string, unknown>> = {}) {
    for (const [path, value] of Object.entries(initialDocuments)) {
      this.documents.set(path, value);
    }
  }

  collection(collectionName: string): {
    doc: (documentId: string) => {
      get: () => Promise<FakeDocumentSnapshot>;
      set: (value: Record<string, unknown>) => Promise<void>;
    };
  } {
    return {
      doc: (documentId: string) => {
        const path = `${collectionName}/${documentId}`;

        return {
          get: () =>
            Promise.resolve(
              new FakeDocumentSnapshot(this.documents.has(path), this.documents.get(path))
            ),
          set: (value: Record<string, unknown>) => {
            this.documents.set(path, value);
            this.writes.set(path, value);

            return Promise.resolve();
          },
        };
      },
    };
  }

  getDocument(path: string): Record<string, unknown> | undefined {
    return this.documents.get(path);
  }
}

describe('migration 019 - select DeepSeek OpenRouter chat model', () => {
  it('exports metadata and the DeepSeek OpenRouter default', () => {
    expect(metadata).toEqual({
      id: '019',
      name: 'select-deepseek-openrouter-chat-model',
      description: 'Select DeepSeek V4 Flash on OpenRouter as the runtime chat model',
      createdAt: '2026-06-29',
    });
    expect(DEFAULT_CHAT_MODEL).toBe('deepseek/deepseek-v4-flash');
  });

  it('selects DeepSeek on OpenRouter and preserves revision history', async () => {
    const firestore = new FakeFirestore({
      [`${CHAT_RUNTIME_SETTINGS_COLLECTION}/${CHAT_MODEL_SETTINGS_DOCUMENT_ID}`]: {
        id: CHAT_MODEL_SETTINGS_DOCUMENT_ID,
        provider: 'minimax',
        modelId: 'MiniMax-M3',
        revision: 7,
        updatedAt: '2026-06-28T00:00:00.000Z',
        updatedByUserId: 'admin-user-1',
      },
    });

    await up({ firestore });

    expect(
      firestore.getDocument(
        `${CHAT_RUNTIME_SETTINGS_COLLECTION}/${CHAT_MODEL_SETTINGS_DOCUMENT_ID}`
      )
    ).toMatchObject({
      id: CHAT_MODEL_SETTINGS_DOCUMENT_ID,
      provider: 'openrouter',
      modelId: DEFAULT_CHAT_MODEL,
      revision: 8,
      updatedByUserId: CHAT_MODEL_SETTINGS_MIGRATION_USER_ID,
    });
  });

  it('does not rewrite an existing DeepSeek OpenRouter selection', async () => {
    const existingSetting = {
      id: CHAT_MODEL_SETTINGS_DOCUMENT_ID,
      provider: 'openrouter',
      modelId: DEFAULT_CHAT_MODEL,
      revision: 4,
      updatedAt: '2026-06-28T00:00:00.000Z',
      updatedByUserId: 'admin-user-2',
    };
    const firestore = new FakeFirestore({
      [`${CHAT_RUNTIME_SETTINGS_COLLECTION}/${CHAT_MODEL_SETTINGS_DOCUMENT_ID}`]: existingSetting,
    });

    await up({ firestore });

    expect(
      firestore.writes.has(`${CHAT_RUNTIME_SETTINGS_COLLECTION}/${CHAT_MODEL_SETTINGS_DOCUMENT_ID}`)
    ).toBe(false);
    expect(
      firestore.getDocument(
        `${CHAT_RUNTIME_SETTINGS_COLLECTION}/${CHAT_MODEL_SETTINGS_DOCUMENT_ID}`
      )
    ).toEqual(existingSetting);
  });
});
