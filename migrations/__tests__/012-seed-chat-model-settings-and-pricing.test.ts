import { describe, expect, it } from 'vitest';

import {
  CHAT_MODEL_SETTINGS_DOCUMENT_ID,
  CHAT_MODEL_SETTINGS_MIGRATION_USER_ID,
  CHAT_RUNTIME_SETTINGS_COLLECTION,
  chatModelPricingSeed,
  metadata,
  up,
} from '../012_seed-chat-model-settings-and-pricing.mjs'; // @allow-missing-js -- migration modules are .mjs

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

function pricingDocumentId(provider: string, model: string): string {
  return `${encodeURIComponent(provider)}__${encodeURIComponent(model)}`;
}

const migration012CatalogSnapshot = [
  {
    provider: 'openrouter',
    model: 'google/gemini-3.5-flash',
    inputUsdPer1M: 1.5,
    outputUsdPer1M: 9,
  },
  {
    provider: 'openrouter',
    model: 'google/gemma-4-31b-it',
    inputUsdPer1M: 0.12,
    outputUsdPer1M: 0.35,
  },
  {
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    inputUsdPer1M: 0.09,
    outputUsdPer1M: 0.18,
  },
  {
    provider: 'openrouter',
    model: 'openai/gpt-4o-mini',
    inputUsdPer1M: 0.15,
    outputUsdPer1M: 0.6,
  },
] as const;

describe('migration 012 - seed chat model settings and pricing', () => {
  it('exports metadata', () => {
    expect(metadata).toEqual({
      id: '012',
      name: 'seed-chat-model-settings-and-pricing',
      description: 'Seed selectable chat model pricing and the chat model runtime setting',
      createdAt: '2026-06-19',
    });
  });

  it('seeds its historical chat model pricing snapshot', async () => {
    const firestore = new FakeFirestore();

    await up({ firestore });

    expect(chatModelPricingSeed).toEqual(migration012CatalogSnapshot);
    for (const model of migration012CatalogSnapshot) {
      expect(
        firestore.getDocument(`llm_pricing/${pricingDocumentId(model.provider, model.model)}`)
      ).toMatchObject({
        provider: model.provider,
        model: model.model,
        inputUsdPer1M: model.inputUsdPer1M,
        outputUsdPer1M: model.outputUsdPer1M,
      });
    }
  });

  it('creates its historical Gemini selected chat model setting when missing', async () => {
    const firestore = new FakeFirestore();

    await up({ firestore });

    expect(
      firestore.getDocument(
        `${CHAT_RUNTIME_SETTINGS_COLLECTION}/${CHAT_MODEL_SETTINGS_DOCUMENT_ID}`
      )
    ).toMatchObject({
      id: CHAT_MODEL_SETTINGS_DOCUMENT_ID,
      provider: 'openrouter',
      modelId: 'google/gemini-3.5-flash',
      revision: 1,
      updatedByUserId: CHAT_MODEL_SETTINGS_MIGRATION_USER_ID,
    });
  });

  it('preserves an existing valid selected chat model setting', async () => {
    const existingSetting = {
      id: CHAT_MODEL_SETTINGS_DOCUMENT_ID,
      provider: 'openrouter',
      modelId: 'deepseek/deepseek-v4-flash',
      revision: 7,
      updatedAt: '2026-06-18T10:00:00.000Z',
      updatedByUserId: 'admin-user-1',
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

  it('replaces an existing invalid selected chat model setting with its historical Gemini default', async () => {
    const firestore = new FakeFirestore({
      [`${CHAT_RUNTIME_SETTINGS_COLLECTION}/${CHAT_MODEL_SETTINGS_DOCUMENT_ID}`]: {
        id: CHAT_MODEL_SETTINGS_DOCUMENT_ID,
        provider: 'openrouter',
        modelId: 'unknown/model',
        revision: 3,
        updatedAt: '2026-06-18T10:00:00.000Z',
        updatedByUserId: 'admin-user-1',
      },
    });

    await up({ firestore });

    expect(
      firestore.getDocument(
        `${CHAT_RUNTIME_SETTINGS_COLLECTION}/${CHAT_MODEL_SETTINGS_DOCUMENT_ID}`
      )
    ).toMatchObject({
      modelId: 'google/gemini-3.5-flash',
      revision: 1,
      updatedByUserId: CHAT_MODEL_SETTINGS_MIGRATION_USER_ID,
    });
  });
});
