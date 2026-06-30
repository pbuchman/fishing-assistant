import { describe, expect, it, vi } from 'vitest';

import { metadata, pricingSeed, up } from '../002_seed-llm-pricing.mjs'; // @allow-missing-js -- migration modules are .mjs

describe('migration 002 - seed llm pricing', () => {
  it('exports metadata', () => {
    expect(metadata).toEqual({
      id: '002',
      name: 'seed-llm-pricing',
      description: 'Seed initial OpenRouter pricing for V1 chat and embedding models',
      createdAt: '2026-06-13',
    });
  });

  it('contains the two V1 default pricing records', () => {
    expect(pricingSeed).toEqual([
      {
        provider: 'openrouter',
        model: 'google/gemini-3.5-flash',
        inputUsdPer1M: 1.5,
        outputUsdPer1M: 9,
      },
      {
        provider: 'openrouter',
        model: 'qwen/qwen3-embedding-8b',
        inputUsdPer1M: 0.01,
        outputUsdPer1M: 0,
        embeddingUsdPer1M: 0.01,
      },
    ]);
  });

  it('writes pricing seed records to llm_pricing with provider/model doc ids', async () => {
    const writes = new Map<string, unknown>();
    const firestore = {
      collection: vi.fn((collectionName: string) => ({
        doc: vi.fn((docId: string) => ({
          set: vi.fn((value: unknown) => {
            writes.set(`${collectionName}/${docId}`, value);
            return Promise.resolve();
          }),
        })),
      })),
    };

    await up({ firestore });

    expect(writes.get('llm_pricing/openrouter__google%2Fgemini-3.5-flash')).toMatchObject({
      provider: 'openrouter',
      model: 'google/gemini-3.5-flash',
      inputUsdPer1M: 1.5,
      outputUsdPer1M: 9,
    });
    expect(writes.get('llm_pricing/openrouter__qwen%2Fqwen3-embedding-8b')).toMatchObject({
      provider: 'openrouter',
      model: 'qwen/qwen3-embedding-8b',
      embeddingUsdPer1M: 0.01,
    });
  });
});
