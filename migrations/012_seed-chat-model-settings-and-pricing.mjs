export const metadata = {
  id: '012',
  name: 'seed-chat-model-settings-and-pricing',
  description: 'Seed selectable chat model pricing and the chat model runtime setting',
  createdAt: '2026-06-19',
};

export const CHAT_RUNTIME_SETTINGS_COLLECTION = 'fa_chat_runtime_settings';
export const CHAT_MODEL_SETTINGS_DOCUMENT_ID = 'chat-model';
export const CHAT_MODEL_SETTINGS_MIGRATION_USER_ID =
  'system:migration:012_seed-chat-model-settings-and-pricing';

export const chatModelPricingSeed = [
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
  if (isValidExistingChatModelSetting(snapshot.exists ? snapshot.data() : undefined)) {
    return;
  }

  await settingsRef.set({
    id: CHAT_MODEL_SETTINGS_DOCUMENT_ID,
    provider: 'openrouter',
    modelId: 'google/gemini-3.5-flash',
    revision: 1,
    updatedAt,
    updatedByUserId: CHAT_MODEL_SETTINGS_MIGRATION_USER_ID,
  });
}
