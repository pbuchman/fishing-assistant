import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { pricingSeed } from '../../migrations/002_seed-llm-pricing.mjs'; // @allow-missing-js -- migration modules are .mjs
import { chatModelPricingSeed as historicalChatModelPricingSeed } from '../../migrations/012_seed-chat-model-settings-and-pricing.mjs'; // @allow-missing-js -- migration modules are .mjs
import { chatModelPricingSeed as updatedChatModelPricingSeed } from '../../migrations/016_update-chat-model-catalog-pricing.mjs'; // @allow-missing-js -- migration modules are .mjs

const verifyScriptPath = resolve(import.meta.dirname, '../verify-data-baseline.mjs');

interface DataBaselineVerifierModule {
  validateDataBaselineState(input: { firestore: FakeFirestore }): Promise<string[]>;
}

class FakeDocSnapshot {
  constructor(
    readonly id: string,
    private readonly value: Record<string, unknown>
  ) {}

  data(): Record<string, unknown> {
    return structuredClone(this.value);
  }
}

class FakeQuerySnapshot {
  constructor(readonly docs: FakeDocSnapshot[]) {}

  get empty(): boolean {
    return this.docs.length === 0;
  }
}

class FakeCollectionRef {
  constructor(
    private readonly firestore: FakeFirestore,
    private readonly name: string,
    private readonly maxRows?: number
  ) {}

  limit(maxRows: number): FakeCollectionRef {
    return new FakeCollectionRef(this.firestore, this.name, maxRows);
  }

  get(): Promise<FakeQuerySnapshot> {
    const docs = this.firestore
      .readCollection(this.name)
      .slice(0, this.maxRows ?? Number.MAX_SAFE_INTEGER)
      .map(({ id, value }) => new FakeDocSnapshot(id, value));
    return Promise.resolve(new FakeQuerySnapshot(docs));
  }
}

class FakeFirestore {
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>();

  seed(collectionName: string, id: string, value: Record<string, unknown>): void {
    const collection =
      this.collections.get(collectionName) ?? new Map<string, Record<string, unknown>>();
    collection.set(id, structuredClone(value));
    this.collections.set(collectionName, collection);
  }

  collection(name: string): FakeCollectionRef {
    return new FakeCollectionRef(this, name);
  }

  readCollection(collectionName: string): { id: string; value: Record<string, unknown> }[] {
    const collection = this.collections.get(collectionName);
    if (collection === undefined) {
      return [];
    }

    return [...collection.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, value]) => ({ id, value: structuredClone(value) }));
  }
}

async function loadVerifierModule(): Promise<DataBaselineVerifierModule | null> {
  expect(existsSync(verifyScriptPath)).toBe(true);
  if (!existsSync(verifyScriptPath)) {
    return null;
  }

  const module: unknown = await import(pathToFileURL(verifyScriptPath).href);
  return module as DataBaselineVerifierModule;
}

describe('verify runtime data baseline', () => {
  it('passes when only reset-safe baseline pricing data remains', async () => {
    const verifier = await loadVerifierModule();
    if (verifier === null) {
      return;
    }

    const firestore = new FakeFirestore();
    firestore.seed('_migrations', '009', { status: 'applied' });
    for (const pricing of pricingSeed) {
      firestore.seed(
        'llm_pricing',
        `${encodeURIComponent(pricing.provider)}__${encodeURIComponent(pricing.model)}`,
        {
          ...pricing,
          updatedAt: '2026-06-17T00:00:00.000Z',
        }
      );
    }

    await expect(verifier.validateDataBaselineState({ firestore })).resolves.toEqual([]);
  });

  it('passes when retained usage rows satisfy the current-schema nested owner contract', async () => {
    const verifier = await loadVerifierModule();
    if (verifier === null) {
      return;
    }

    const firestore = new FakeFirestore();
    firestore.seed('llm_usage_events', 'event-1', {
      owner: { type: 'user', id: 'user-123' },
      source: { service: 'chat-service', operation: 'stream-chat-message' },
    });
    firestore.seed('llm_usage_daily_aggregates', 'aggregate-1', {
      owner: { type: 'user', id: 'user-123' },
      bucket: { day: '2026-06-17' },
    });
    for (const pricing of pricingSeed) {
      firestore.seed(
        'llm_pricing',
        `${encodeURIComponent(pricing.provider)}__${encodeURIComponent(pricing.model)}`,
        {
          ...pricing,
          updatedAt: '2026-06-17T00:00:00.000Z',
        }
      );
    }

    await expect(verifier.validateDataBaselineState({ firestore })).resolves.toEqual([]);
  });

  it('passes when post-baseline current-schema runtime collections contain accepted documents', async () => {
    const verifier = await loadVerifierModule();
    if (verifier === null) {
      return;
    }

    const firestore = new FakeFirestore();
    firestore.seed('fa_users', 'user-1', {
      auth0Subject: 'auth0|user-1',
      normalizedEmail: 'admin@example.com',
      role: 'admin',
      status: 'approved',
    });
    firestore.seed('fa_user_identity_reservations', 'reservation-1', {
      auth0Subject: 'auth0|user-1',
      userId: 'user-1',
    });
    firestore.seed('fa_user_change_events', 'change-1', {
      targetUserId: 'user-1',
      action: 'approved',
    });
    firestore.seed('fa_knowledge_nodes', 'node-1', {
      status: 'active',
      title: 'Knowledge Base',
      sortIndex: 0,
      pathIds: [],
    });
    firestore.seed('fa_knowledge_pages', 'page-1', {
      nodeId: 'node-1',
      status: 'active',
      syncStatus: 'synced',
      indexingStatus: 'ready',
    });
    firestore.seed('fa_knowledge_chunks', 'chunk-1', {
      pageId: 'page-1',
      status: 'active',
      accessSyncStatus: 'current',
    });
    for (const pricing of pricingSeed) {
      firestore.seed(
        'llm_pricing',
        `${encodeURIComponent(pricing.provider)}__${encodeURIComponent(pricing.model)}`,
        {
          ...pricing,
          updatedAt: '2026-06-17T00:00:00.000Z',
        }
      );
    }

    await expect(verifier.validateDataBaselineState({ firestore })).resolves.toEqual([]);
  });

  it('passes when selectable chat model pricing has been seeded after the V1 baseline', async () => {
    const verifier = await loadVerifierModule();
    if (verifier === null) {
      return;
    }

    const firestore = new FakeFirestore();
    const pricingById = new Map(
      [...pricingSeed, ...historicalChatModelPricingSeed].map((pricing) => [
        `${encodeURIComponent(pricing.provider)}__${encodeURIComponent(pricing.model)}`,
        pricing,
      ])
    );
    for (const [documentId, pricing] of pricingById) {
      firestore.seed('llm_pricing', documentId, {
        ...pricing,
        updatedAt: '2026-06-19T00:00:00.000Z',
      });
    }

    await expect(verifier.validateDataBaselineState({ firestore })).resolves.toEqual([]);
  });

  it('passes when MiniMax-first chat model pricing has been seeded after migration 016', async () => {
    const verifier = await loadVerifierModule();
    if (verifier === null) {
      return;
    }

    const firestore = new FakeFirestore();
    const pricingById = new Map(
      [...pricingSeed, ...updatedChatModelPricingSeed].map((pricing) => [
        `${encodeURIComponent(pricing.provider)}__${encodeURIComponent(pricing.model)}`,
        pricing,
      ])
    );
    for (const [documentId, pricing] of pricingById) {
      firestore.seed('llm_pricing', documentId, {
        ...pricing,
        updatedAt: '2026-06-22T00:00:00.000Z',
      });
    }

    await expect(verifier.validateDataBaselineState({ firestore })).resolves.toEqual([]);
  });

  it('passes when Gemma-first chat model pricing has been seeded after migration 018', async () => {
    const verifier = await loadVerifierModule();
    if (verifier === null) {
      return;
    }

    const { chatModelPricingSeed: gemmaChatModelPricingSeed } =
      await import('../../migrations/018_set-gemma-chat-model-catalog.mjs');
    const firestore = new FakeFirestore();
    const pricingById = new Map(
      [...pricingSeed, ...gemmaChatModelPricingSeed].map((pricing) => [
        `${encodeURIComponent(pricing.provider)}__${encodeURIComponent(pricing.model)}`,
        pricing,
      ])
    );
    for (const [documentId, pricing] of pricingById) {
      firestore.seed('llm_pricing', documentId, {
        ...pricing,
        updatedAt: '2026-06-25T00:00:00.000Z',
      });
    }

    await expect(verifier.validateDataBaselineState({ firestore })).resolves.toEqual([]);
  });

  it('fails retained usage rows that violate the nested owner contract without leaking document ids', async () => {
    const verifier = await loadVerifierModule();
    if (verifier === null) {
      return;
    }

    const firestore = new FakeFirestore();
    firestore.seed('fishing_knowledge_documents', 'doc-1', { workspaceId: 'anonymous' });
    firestore.seed('llm_usage_events', 'event-1', {
      ownerType: 'workspace',
      ownerId: 'anonymous',
      owner: { type: 'system', id: 'system' },
    });
    firestore.seed('llm_usage_daily_aggregates', 'aggregate-secret', {
      owner: { type: 'user', id: 'anonymous-workspace-1' },
      bucket: { day: '2026-06-17' },
    });
    for (const pricing of pricingSeed) {
      firestore.seed(
        'llm_pricing',
        `${encodeURIComponent(pricing.provider)}__${encodeURIComponent(pricing.model)}`,
        {
          ...pricing,
          updatedAt: '2026-06-17T00:00:00.000Z',
        }
      );
    }

    const errors = await verifier.validateDataBaselineState({ firestore });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('fishing_knowledge_documents'),
        expect.stringContaining('llm_usage_events'),
        expect.stringContaining('llm_usage_daily_aggregates'),
      ])
    );
    expect(errors.join('\n')).not.toContain('event-1');
    expect(errors.join('\n')).not.toContain('aggregate-secret');
  });

  it('rejects pricing payload drift even when provider/model ids match', async () => {
    const verifier = await loadVerifierModule();
    if (verifier === null) {
      return;
    }

    const firestore = new FakeFirestore();
    const chatPricing = pricingSeed[0];
    const embeddingPricing = pricingSeed[1];
    expect(chatPricing).toBeDefined();
    expect(embeddingPricing).toBeDefined();
    if (chatPricing === undefined || embeddingPricing === undefined) {
      return;
    }
    firestore.seed(
      'llm_pricing',
      `${encodeURIComponent(chatPricing.provider)}__${encodeURIComponent(chatPricing.model)}`,
      {
        ...chatPricing,
        inputUsdPer1M: chatPricing.inputUsdPer1M + 1,
        updatedAt: '2026-06-17T00:00:00.000Z',
      }
    );
    firestore.seed(
      'llm_pricing',
      `${encodeURIComponent(embeddingPricing.provider)}__${encodeURIComponent(embeddingPricing.model)}`,
      {
        ...embeddingPricing,
        embeddingUsdPer1M: 999,
        updatedAt: '2026-06-17T00:00:00.000Z',
      }
    );

    await expect(verifier.validateDataBaselineState({ firestore })).resolves.toEqual(
      expect.arrayContaining([
        expect.stringContaining('llm_pricing'),
        expect.stringContaining('approved pricing payload'),
      ])
    );
  });

  it('rejects missing or extra pricing documents after baseline reset', async () => {
    const verifier = await loadVerifierModule();
    if (verifier === null) {
      return;
    }

    const firestore = new FakeFirestore();
    const chatPricing = pricingSeed[0];
    expect(chatPricing).toBeDefined();
    if (chatPricing === undefined) {
      return;
    }
    firestore.seed(
      'llm_pricing',
      `${encodeURIComponent(chatPricing.provider)}__${encodeURIComponent(chatPricing.model)}`,
      {
        ...chatPricing,
        updatedAt: '2026-06-17T00:00:00.000Z',
      }
    );
    firestore.seed('llm_pricing', 'extra-price', {
      provider: 'extra',
      model: 'extra-model',
      updatedAt: '2026-06-17T00:00:00.000Z',
    });

    await expect(verifier.validateDataBaselineState({ firestore })).resolves.toEqual(
      expect.arrayContaining([expect.stringContaining('llm_pricing')])
    );
  });
});
