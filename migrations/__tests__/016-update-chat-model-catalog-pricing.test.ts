import { describe, expect, it } from 'vitest';

import {
  CHAT_MODEL_SETTINGS_DOCUMENT_ID,
  CHAT_MODEL_SETTINGS_MIGRATION_USER_ID,
  CHAT_RUNTIME_SETTINGS_COLLECTION,
  chatModelPricingSeed,
  metadata,
  retiredChatModelPricingSeed,
  up,
} from '../016_update-chat-model-catalog-pricing.mjs'; // @allow-missing-js -- migration modules are .mjs

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
  readonly deletes = new Set<string>();
  private readonly documents = new Map<string, Record<string, unknown>>();

  constructor(initialDocuments: Record<string, Record<string, unknown>> = {}) {
    for (const [path, value] of Object.entries(initialDocuments)) {
      this.documents.set(path, value);
    }
  }

  collection(collectionName: string): {
    doc: (documentId: string) => {
      delete: () => Promise<void>;
      get: () => Promise<FakeDocumentSnapshot>;
      set: (value: Record<string, unknown>) => Promise<void>;
    };
  } {
    return {
      doc: (documentId: string) => {
        const path = `${collectionName}/${documentId}`;

        return {
          delete: () => {
            this.documents.delete(path);
            this.deletes.add(path);

            return Promise.resolve();
          },
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

function setting(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CHAT_MODEL_SETTINGS_DOCUMENT_ID,
    provider: 'openrouter',
    modelId: 'google/gemini-3.5-flash',
    revision: 3,
    updatedAt: '2026-06-20T12:00:00.000Z',
    updatedByUserId: 'admin-user-1',
    ...overrides,
  };
}

const expectedPricingSeed = [
  {
    provider: 'openrouter',
    model: 'x-ai/grok-4.20',
    inputUsdPer1M: 1.25,
    outputUsdPer1M: 2.5,
  },
  { provider: 'openrouter', model: 'minimax/minimax-m3', inputUsdPer1M: 0.3, outputUsdPer1M: 1.2 },
  {
    provider: 'openrouter',
    model: 'openai/gpt-5.4-nano',
    inputUsdPer1M: 0.2,
    outputUsdPer1M: 1.25,
  },
  {
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-pro',
    inputUsdPer1M: 0.435,
    outputUsdPer1M: 0.87,
  },
  {
    provider: 'openrouter',
    model: 'z-ai/glm-5.2',
    inputUsdPer1M: 0.95,
    outputUsdPer1M: 3,
  },
  {
    provider: 'openrouter',
    model: 'mistralai/mistral-large-2512',
    inputUsdPer1M: 0.5,
    outputUsdPer1M: 1.5,
  },
  {
    provider: 'openrouter',
    model: 'openai/gpt-4.1-mini',
    inputUsdPer1M: 0.4,
    outputUsdPer1M: 1.6,
  },
  {
    provider: 'openrouter',
    model: 'google/gemini-3.1-flash-lite',
    inputUsdPer1M: 0.25,
    outputUsdPer1M: 1.5,
  },
] as const;

describe('migration 016 - update chat model catalog pricing', () => {
  it('exports metadata and pricing snapshots', () => {
    expect(metadata).toEqual({
      id: '016',
      name: 'update-chat-model-catalog-pricing',
      description: 'Seed MiniMax-first chat model pricing and reset retired selected chat models',
      createdAt: '2026-06-22',
    });
    expect(chatModelPricingSeed).toEqual(expectedPricingSeed);
    expect(retiredChatModelPricingSeed.map((pricing) => pricing.model)).toEqual([
      'google/gemma-4-31b-it',
      'deepseek/deepseek-v4-flash',
      'openai/gpt-4o-mini',
    ]);
  });

  it('seeds pricing for the new catalog and removes retired non-baseline pricing rows', async () => {
    const firestore = new FakeFirestore({
      [`llm_pricing/${pricingDocumentId('openrouter', 'google/gemini-3.5-flash')}`]: {
        provider: 'openrouter',
        model: 'google/gemini-3.5-flash',
        inputUsdPer1M: 1.5,
        outputUsdPer1M: 9,
      },
      [`llm_pricing/${pricingDocumentId('openrouter', 'google/gemma-4-31b-it')}`]: {
        provider: 'openrouter',
        model: 'google/gemma-4-31b-it',
      },
      [`llm_pricing/${pricingDocumentId('openrouter', 'deepseek/deepseek-v4-flash')}`]: {
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
      },
      [`llm_pricing/${pricingDocumentId('openrouter', 'openai/gpt-4o-mini')}`]: {
        provider: 'openrouter',
        model: 'openai/gpt-4o-mini',
      },
    });

    await up({ firestore });

    for (const model of expectedPricingSeed) {
      expect(
        firestore.getDocument(`llm_pricing/${pricingDocumentId(model.provider, model.model)}`)
      ).toMatchObject(model);
    }
    for (const model of retiredChatModelPricingSeed) {
      expect(
        firestore.getDocument(`llm_pricing/${pricingDocumentId(model.provider, model.model)}`)
      ).toBeUndefined();
    }
    expect(
      firestore.getDocument(
        `llm_pricing/${pricingDocumentId('openrouter', 'google/gemini-3.5-flash')}`
      )
    ).toMatchObject({
      provider: 'openrouter',
      model: 'google/gemini-3.5-flash',
    });
  });

  it('creates MiniMax as the selected chat model setting when missing', async () => {
    const firestore = new FakeFirestore();

    await up({ firestore });

    expect(
      firestore.getDocument(
        `${CHAT_RUNTIME_SETTINGS_COLLECTION}/${CHAT_MODEL_SETTINGS_DOCUMENT_ID}`
      )
    ).toMatchObject({
      id: CHAT_MODEL_SETTINGS_DOCUMENT_ID,
      provider: 'openrouter',
      modelId: 'minimax/minimax-m3',
      revision: 1,
      updatedByUserId: CHAT_MODEL_SETTINGS_MIGRATION_USER_ID,
    });
  });

  it('moves old Gemini settings to MiniMax while preserving revision history', async () => {
    const firestore = new FakeFirestore({
      [`${CHAT_RUNTIME_SETTINGS_COLLECTION}/${CHAT_MODEL_SETTINGS_DOCUMENT_ID}`]: setting(),
    });

    await up({ firestore });

    expect(
      firestore.getDocument(
        `${CHAT_RUNTIME_SETTINGS_COLLECTION}/${CHAT_MODEL_SETTINGS_DOCUMENT_ID}`
      )
    ).toMatchObject({
      modelId: 'minimax/minimax-m3',
      revision: 4,
      updatedByUserId: CHAT_MODEL_SETTINGS_MIGRATION_USER_ID,
    });
  });

  it('preserves an existing valid selected chat model from the new catalog', async () => {
    const existingSetting = setting({
      modelId: 'openai/gpt-4.1-mini',
      revision: 7,
      updatedByUserId: 'admin-user-2',
    });
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
