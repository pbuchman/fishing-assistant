import { getFirestore, type Firestore } from '@fa/infra-firestore';

import type { LlmPricing } from '../../domain/models/pricing.js';
import { pricingDocumentId } from '../../domain/models/pricing.js';
import type { PricingRepository } from '../../domain/repositories/pricingRepository.js';
import {
  isoFromTimestamp,
  numberField,
  stringField,
  timestampFromIso,
} from './firestoreMapping.js';

const COLLECTION = 'llm_pricing';

function pricingToDoc(pricing: LlmPricing): Record<string, unknown> {
  return {
    ...pricing,
    updatedAt: timestampFromIso(pricing.updatedAt),
  };
}

function pricingFromDoc(data: Record<string, unknown>): LlmPricing {
  const embeddingUsdPer1M = data['embeddingUsdPer1M'];

  return {
    provider: stringField(data['provider'], 'provider'),
    model: stringField(data['model'], 'model'),
    inputUsdPer1M: numberField(data['inputUsdPer1M'], 'inputUsdPer1M'),
    outputUsdPer1M: numberField(data['outputUsdPer1M'], 'outputUsdPer1M'),
    ...(typeof embeddingUsdPer1M === 'number' ? { embeddingUsdPer1M } : {}),
    updatedAt: isoFromTimestamp(data['updatedAt'], 'updatedAt'),
  };
}

export class FirestorePricingRepository implements PricingRepository {
  constructor(private readonly firestore?: Firestore) {}

  private get db(): Firestore {
    return this.firestore ?? getFirestore();
  }

  async get(provider: string, model: string): Promise<LlmPricing | null> {
    const snapshot = await this.db
      .collection(COLLECTION)
      .doc(pricingDocumentId(provider, model))
      .get();
    if (!snapshot.exists) {
      return null;
    }

    return pricingFromDoc(snapshot.data() as Record<string, unknown>);
  }

  async list(): Promise<LlmPricing[]> {
    const snapshot = await this.db.collection(COLLECTION).get();
    return snapshot.docs.map((doc) => pricingFromDoc(doc.data() as Record<string, unknown>));
  }

  async upsert(pricing: LlmPricing): Promise<void> {
    await this.db
      .collection(COLLECTION)
      .doc(pricingDocumentId(pricing.provider, pricing.model))
      .set(pricingToDoc(pricing));
  }
}
