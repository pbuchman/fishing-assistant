import type { Result } from '@fa/common-core';
import type { ChatProvider } from '@fa/llm-factory';

import type { ChatModelSettings } from '../models/chatSettings.js';

export interface ChatSettingsRepositoryError {
  code: 'CONFLICT' | 'INTERNAL_ERROR';
  message: string;
}

export interface SaveChatModelSettingsInput {
  provider: ChatProvider;
  modelId: string;
  expectedRevision: number;
  updatedAt: string;
  updatedByUserId: string;
}

export interface ChatSettingsRepository {
  getChatModelSettings(): Promise<Result<ChatModelSettings | null, ChatSettingsRepositoryError>>;
  saveChatModelSettings(
    input: SaveChatModelSettingsInput
  ): Promise<Result<ChatModelSettings, ChatSettingsRepositoryError>>;
}
