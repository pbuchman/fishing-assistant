import { err, ok, type Result } from '@fa/common-core';

import {
  CHAT_MODEL_SETTINGS_ID,
  type ChatModelSettings,
} from '../../domain/models/chatSettings.js';
import type {
  ChatSettingsRepository,
  ChatSettingsRepositoryError,
  SaveChatModelSettingsInput,
} from '../../domain/repositories/chatSettingsRepository.js';

function cloneSettings(settings: ChatModelSettings): ChatModelSettings {
  return { ...settings };
}

export class MemoryChatSettingsRepository implements ChatSettingsRepository {
  private settings: ChatModelSettings | null;

  constructor(initialSettings: ChatModelSettings | null = null) {
    this.settings = initialSettings === null ? null : cloneSettings(initialSettings);
  }

  getChatModelSettings(): Promise<Result<ChatModelSettings | null, ChatSettingsRepositoryError>> {
    return Promise.resolve(ok(this.settings === null ? null : cloneSettings(this.settings)));
  }

  saveChatModelSettings(
    input: SaveChatModelSettingsInput
  ): Promise<Result<ChatModelSettings, ChatSettingsRepositoryError>> {
    const currentRevision = this.settings?.revision ?? 0;
    if (input.expectedRevision !== currentRevision) {
      return Promise.resolve(
        err({
          code: 'CONFLICT',
          message: `Chat model setting revision ${String(input.expectedRevision)} is stale`,
        })
      );
    }

    const next: ChatModelSettings = {
      id: CHAT_MODEL_SETTINGS_ID,
      provider: input.provider,
      modelId: input.modelId,
      revision: currentRevision + 1,
      updatedAt: input.updatedAt,
      updatedByUserId: input.updatedByUserId,
    };
    this.settings = cloneSettings(next);

    return Promise.resolve(ok(next));
  }
}
