export const metadata = {
  id: '002',
  name: 'seed-llm-pricing',
  description: 'Seed initial OpenRouter pricing for V1 chat and embedding models',
  createdAt: '2026-06-13',
};

export const pricingSeed = [
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
];

/**
 * @param {{ provider: string; model: string }} pricing
 * @returns {string}
 */
function pricingDocumentId(pricing) {
  return `${encodeURIComponent(pricing.provider)}__${encodeURIComponent(pricing.model)}`;
}

/**
 * @param {{ firestore: { collection: (name: string) => { doc: (id: string) => { set: (value: unknown) => Promise<void> } } } }} context
 * @returns {Promise<void>}
 */
export async function up(context) {
  const updatedAt = new Date().toISOString();

  await Promise.all(
    pricingSeed.map((pricing) =>
      context.firestore
        .collection('llm_pricing')
        .doc(pricingDocumentId(pricing))
        .set({ ...pricing, updatedAt })
    )
  );
}
