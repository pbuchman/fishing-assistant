import type { ChatProvider, CuratedChatModel } from '@fa/llm-factory';

export const CHAT_MODEL_SETTINGS_ID = 'chat-model';
export const CHAT_MODEL_SETTINGS_PROVIDER: ChatProvider = 'openrouter';

export interface ChatModelSettings {
  id: typeof CHAT_MODEL_SETTINGS_ID;
  provider: ChatProvider;
  modelId: string;
  revision: number;
  updatedAt: string;
  updatedByUserId: string;
}

export type ActiveChatModelReason =
  | 'settings'
  | 'missing-settings'
  | 'invalid-settings'
  | 'read-error';

export interface ActiveChatModel {
  provider: ChatProvider;
  modelId: string;
  activeBecause: ActiveChatModelReason;
}

export interface ChatModelSettingsResponse {
  selected: ChatModelSettings;
  active: ActiveChatModel;
  models: readonly CuratedChatModel[];
}
