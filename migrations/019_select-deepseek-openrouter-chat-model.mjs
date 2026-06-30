export const metadata = {
  id: '019',
  name: 'select-deepseek-openrouter-chat-model',
  description: 'Select DeepSeek V4 Flash on OpenRouter as the runtime chat model',
  createdAt: '2026-06-29',
};

export const CHAT_RUNTIME_SETTINGS_COLLECTION = 'fa_chat_runtime_settings';
export const CHAT_MODEL_SETTINGS_DOCUMENT_ID = 'chat-model';
export const CHAT_MODEL_SETTINGS_MIGRATION_USER_ID =
  'system:migration:019_select-deepseek-openrouter-chat-model';
export const DEFAULT_CHAT_MODEL = 'deepseek/deepseek-v4-flash';
export const DEFAULT_CHAT_PROVIDER = 'openrouter';

/**
 * @param {Record<string, unknown> | undefined} value
 * @returns {number}
 */
function nextRevision(value) {
  const revision = value?.['revision'];
  return Number.isSafeInteger(revision) && Number(revision) >= 0 ? Number(revision) + 1 : 1;
}

/**
 * @param {Record<string, unknown> | undefined} value
 * @returns {boolean}
 */
function isDeepSeekOpenRouterSetting(value) {
  return (
    value !== undefined &&
    value['id'] === CHAT_MODEL_SETTINGS_DOCUMENT_ID &&
    value['provider'] === DEFAULT_CHAT_PROVIDER &&
    value['modelId'] === DEFAULT_CHAT_MODEL
  );
}

/**
 * @param {{ firestore: { collection: (name: string) => { doc: (id: string) => { get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>; set: (value: Record<string, unknown>) => Promise<void> } } } }} context
 * @returns {Promise<void>}
 */
export async function up(context) {
  const settingsRef = context.firestore
    .collection(CHAT_RUNTIME_SETTINGS_COLLECTION)
    .doc(CHAT_MODEL_SETTINGS_DOCUMENT_ID);
  const snapshot = await settingsRef.get();
  const existingSetting = snapshot.exists ? snapshot.data() : undefined;

  if (isDeepSeekOpenRouterSetting(existingSetting)) {
    return;
  }

  await settingsRef.set({
    id: CHAT_MODEL_SETTINGS_DOCUMENT_ID,
    provider: DEFAULT_CHAT_PROVIDER,
    modelId: DEFAULT_CHAT_MODEL,
    revision: nextRevision(existingSetting),
    updatedAt: new Date().toISOString(),
    updatedByUserId: CHAT_MODEL_SETTINGS_MIGRATION_USER_ID,
  });
}
