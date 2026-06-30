export const metadata = {
  id: '018',
  name: 'set-gemma-chat-model-catalog',
  description: 'Seed Gemma-first chat model pricing and select Gemma as the runtime chat model',
  createdAt: '2026-06-25',
};

export const CHAT_RUNTIME_SETTINGS_COLLECTION = 'fa_chat_runtime_settings';
export const CHAT_MODEL_SETTINGS_DOCUMENT_ID = 'chat-model';
export const CHAT_MODEL_SETTINGS_MIGRATION_USER_ID =
  'system:migration:018_set-gemma-chat-model-catalog';
export const DEFAULT_CHAT_MODEL = 'google/gemma-4-31b-it';

export const chatModelPricingSeed = [
  {
    provider: 'openrouter',
    model: 'google/gemma-4-31b-it',
    inputUsdPer1M: 0.12,
    outputUsdPer1M: 0.35,
  },
  {
    provider: 'openrouter',
    model: 'minimax/minimax-m3',
    inputUsdPer1M: 0.3,
    outputUsdPer1M: 1.2,
  },
  {
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    inputUsdPer1M: 0.089,
    outputUsdPer1M: 0.224,
  },
  {
    provider: 'openrouter',
    model: 'xiaomi/mimo-v2.5-pro',
    inputUsdPer1M: 0.435,
    outputUsdPer1M: 0.87,
  },
  {
    provider: 'openrouter',
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    inputUsdPer1M: 0.5,
    outputUsdPer1M: 2.2,
  },
  {
    provider: 'openrouter',
    model: 'qwen/qwen3.7-max',
    inputUsdPer1M: 1.25,
    outputUsdPer1M: 3.75,
  },
  {
    provider: 'openrouter',
    model: 'openai/gpt-5.4-mini',
    inputUsdPer1M: 0.75,
    outputUsdPer1M: 4.5,
  },
  {
    provider: 'openrouter',
    model: 'x-ai/grok-4.20',
    inputUsdPer1M: 1.25,
    outputUsdPer1M: 2.5,
  },
  {
    provider: 'openrouter',
    model: 'google/gemini-3.1-flash-lite',
    inputUsdPer1M: 0.25,
    outputUsdPer1M: 1.5,
  },
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
];

/**
 * @param {{ provider: string; model: string }} pricing
 * @returns {string}
 */
function pricingDocumentId(pricing) {
  return `${encodeURIComponent(pricing.provider)}__${encodeURIComponent(pricing.model)}`;
}

/**
 * @param {Record<string, unknown> | undefined} value
 * @returns {number}
 */
function nextRevision(value) {
  const revision = value?.['revision'];
  return Number.isSafeInteger(revision) && Number(revision) >= 0 ? Number(revision) + 1 : 1;
}

/**
 * @param {{ firestore: { collection: (name: string) => { doc: (id: string) => { get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>; set: (value: Record<string, unknown>) => Promise<void> } } } }} context
 * @returns {Promise<void>}
 */
export async function up(context) {
  const updatedAt = new Date().toISOString();

  await Promise.all(
    chatModelPricingSeed.map((pricing) =>
      context.firestore
        .collection('llm_pricing')
        .doc(pricingDocumentId(pricing))
        .set({ ...pricing, updatedAt })
    )
  );

  const settingsRef = context.firestore
    .collection(CHAT_RUNTIME_SETTINGS_COLLECTION)
    .doc(CHAT_MODEL_SETTINGS_DOCUMENT_ID);
  const snapshot = await settingsRef.get();
  const existingSetting = snapshot.exists ? snapshot.data() : undefined;

  if (existingSetting?.['modelId'] === DEFAULT_CHAT_MODEL) {
    return;
  }

  await settingsRef.set({
    id: CHAT_MODEL_SETTINGS_DOCUMENT_ID,
    provider: 'openrouter',
    modelId: DEFAULT_CHAT_MODEL,
    revision: nextRevision(existingSetting),
    updatedAt,
    updatedByUserId: CHAT_MODEL_SETTINGS_MIGRATION_USER_ID,
  });
}
