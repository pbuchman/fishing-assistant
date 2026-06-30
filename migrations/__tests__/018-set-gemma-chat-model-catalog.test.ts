import { describe, expect, it } from 'vitest';

import {
  CHAT_MODEL_SETTINGS_DOCUMENT_ID,
  CHAT_MODEL_SETTINGS_MIGRATION_USER_ID,
  CHAT_RUNTIME_SETTINGS_COLLECTION,
  DEFAULT_CHAT_MODEL,
  chatModelPricingSeed,
  metadata,
  up,
} from '../018_set-gemma-chat-model-catalog.mjs'; // @allow-missing-js -- migration modules are .mjs

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

describe('migration 018 - set Gemma chat model catalog', () => {
  it('exports metadata and Gemma-first pricing snapshot', () => {
    expect(metadata).toEqual({
      id: '018',
      name: 'set-gemma-chat-model-catalog',
      description: 'Seed Gemma-first chat model pricing and select Gemma as the runtime chat model',
      createdAt: '2026-06-25',
    });
    expect(DEFAULT_CHAT_MODEL).toBe('google/gemma-4-31b-it');
    expect(chatModelPricingSeed.map((pricing) => pricing.model)).toEqual([
      'google/gemma-4-31b-it',
      'minimax/minimax-m3',
      'deepseek/deepseek-v4-flash',
      'xiaomi/mimo-v2.5-pro',
      'nvidia/nemotron-3-ultra-550b-a55b',
      'qwen/qwen3.7-max',
      'openai/gpt-5.4-mini',
      'x-ai/grok-4.20',
      'google/gemini-3.1-flash-lite',
      'openai/gpt-5.4-nano',
      'deepseek/deepseek-v4-pro',
      'z-ai/glm-5.2',
      'mistralai/mistral-large-2512',
      'openai/gpt-4.1-mini',
    ]);
  });

  it('seeds pricing for all approved chat models', async () => {
    const firestore = new FakeFirestore();

    await up({ firestore });

    for (const pricing of chatModelPricingSeed) {
      expect(
        firestore.getDocument(`llm_pricing/${pricingDocumentId(pricing.provider, pricing.model)}`)
      ).toMatchObject(pricing);
    }
  });

  it('selects Gemma as the runtime chat model and preserves revision history', async () => {
    const firestore = new FakeFirestore({
      [`${CHAT_RUNTIME_SETTINGS_COLLECTION}/${CHAT_MODEL_SETTINGS_DOCUMENT_ID}`]: {
        id: CHAT_MODEL_SETTINGS_DOCUMENT_ID,
        provider: 'openrouter',
        modelId: 'minimax/minimax-m3',
        revision: 7,
        updatedAt: '2026-06-24T00:00:00.000Z',
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
});
