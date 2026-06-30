import { config } from '../config.js';
import { apiRequest } from './apiClient.js';

export type ChatModelProvider = 'openrouter' | 'minimax';
export type ChatModelEvaluationStatus = 'fallback' | 'selected';
export type ActiveChatModelReason =
  | 'settings'
  | 'missing-settings'
  | 'invalid-settings'
  | 'read-error';

export interface CuratedChatModel {
  provider: ChatModelProvider;
  modelId: string;
  label: string;
  evaluationStatus: ChatModelEvaluationStatus;
  contextTokens: number;
  supportsStructuredOutputs: true;
  notes: string;
}

export interface ChatModelSettings {
  id: 'chat-model';
  provider: ChatModelProvider;
  modelId: string;
  revision: number;
  updatedAt: string;
  updatedByUserId: string;
}

export interface ActiveChatModel {
  provider: ChatModelProvider;
  modelId: string;
  activeBecause: ActiveChatModelReason;
}

export interface ChatModelSettingsResponse {
  selected: ChatModelSettings;
  active: ActiveChatModel;
  models: CuratedChatModel[];
}

export interface UpdateChatModelSettingsInput {
  provider: ChatModelProvider;
  modelId: string;
  expectedRevision: number;
}

const chatModelSettingsUrl = `${config.services.CHAT_SERVICE}/admin/settings/chat-model`;

export function getChatModelSettings(): Promise<ChatModelSettingsResponse> {
  return apiRequest<ChatModelSettingsResponse>(chatModelSettingsUrl, { method: 'GET' });
}

export function updateChatModelSettings(
  input: UpdateChatModelSettingsInput
): Promise<ChatModelSettingsResponse> {
  return apiRequest<ChatModelSettingsResponse>(chatModelSettingsUrl, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
