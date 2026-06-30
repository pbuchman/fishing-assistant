export const metadata = {
  id: '016',
  name: 'update-chat-model-catalog-pricing',
  description: 'Seed MiniMax-first chat model pricing and reset retired selected chat models',
  createdAt: '2026-06-22',
};

export const CHAT_RUNTIME_SETTINGS_COLLECTION = 'fa_chat_runtime_settings';
export const CHAT_MODEL_SETTINGS_DOCUMENT_ID = 'chat-model';
export const CHAT_MODEL_SETTINGS_MIGRATION_USER_ID =
  'system:migration:016_update-chat-model-catalog-pricing';
export const DEFAULT_CHAT_MODEL = 'minimax/minimax-m3';

export const chatModelPricingSeed = [
  {
    provider: 'openrouter',
    model: 'x-ai/grok-4.20',
    inputUsdPer1M: 1.25,
    outputUsdPer1M: 2.5,
  },
  {
    provider: 'openrouter',
    model: 'minimax/minimax-m3',
    inputUsdPer1M: 0.3,
    outputUsdPer1M: 1.2,
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
  {
    provider: 'openrouter',
    model: 'google/gemini-3.1-flash-lite',
    inputUsdPer1M: 0.25,
    outputUsdPer1M: 1.5,
  },
];

export const retiredChatModelPricingSeed = [
  { provider: 'openrouter', model: 'google/gemma-4-31b-it' },
  { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' },
  { provider: 'openrouter', model: 'openai/gpt-4o-mini' },
];

const validChatModelIds = new Set(chatModelPricingSeed.map((pricing) => pricing.model));

/**
 * @param {{ provider: string; model: string }} pricing
 * @returns {string}
 */
function pricingDocumentId(pricing) {
  return `${encodeURIComponent(pricing.provider)}__${encodeURIComponent(pricing.model)}`;
}

/**
 * @param {Record<string, unknown> | undefined} value
 * @returns {boolean}
 */
function isValidExistingChatModelSetting(value) {
  return (
    value !== undefined &&
    value['id'] === CHAT_MODEL_SETTINGS_DOCUMENT_ID &&
    value['provider'] === 'openrouter' &&
    typeof value['modelId'] === 'string' &&
    validChatModelIds.has(value['modelId'])
  );
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
 * @param {{ firestore: { collection: (name: string) => { doc: (id: string) => { delete: () => Promise<void>; get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>; set: (value: Record<string, unknown>) => Promise<void> } } } }} context
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

  await Promise.all(
    retiredChatModelPricingSeed.map((pricing) =>
      context.firestore.collection('llm_pricing').doc(pricingDocumentId(pricing)).delete()
    )
  );

  const settingsRef = context.firestore
    .collection(CHAT_RUNTIME_SETTINGS_COLLECTION)
    .doc(CHAT_MODEL_SETTINGS_DOCUMENT_ID);
  const snapshot = await settingsRef.get();
  const existingSetting = snapshot.exists ? snapshot.data() : undefined;
  if (isValidExistingChatModelSetting(existingSetting)) {
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
