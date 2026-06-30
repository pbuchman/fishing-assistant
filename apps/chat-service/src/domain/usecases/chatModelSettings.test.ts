import { describe, expect, it, vi } from 'vitest';

import { err, ok, type Clock, type Result } from '@fa/common-core';
import { CURATED_CHAT_MODELS, DEFAULT_CHAT_MODEL, MINIMAX_CHAT_MODEL } from '@fa/llm-factory';

import type { ChatModelSettings } from '../models/chatSettings.js';
import type {
  ChatSettingsRepository,
  ChatSettingsRepositoryError,
  SaveChatModelSettingsInput,
} from '../repositories/chatSettingsRepository.js';
import { createChatModelSettingsManager } from './chatModelSettings.js';

const clock: Clock = {
  now: () => new Date('2026-06-19T12:00:00.000Z'),
};

function setting(overrides: Partial<ChatModelSettings> = {}): ChatModelSettings {
  return {
    id: 'chat-model',
    provider: 'openrouter',
    modelId: DEFAULT_CHAT_MODEL,
    revision: 1,
    updatedAt: '2026-06-19T11:00:00.000Z',
    updatedByUserId: 'admin-user-1',
    ...overrides,
  };
}

class FakeChatSettingsRepository implements ChatSettingsRepository {
  readCount = 0;
  settings: ChatModelSettings | null;
  readError: ChatSettingsRepositoryError | null = null;

  constructor(initialSetting: ChatModelSettings | null = null) {
    this.settings = initialSetting;
  }

  getChatModelSettings(): Promise<Result<ChatModelSettings | null, ChatSettingsRepositoryError>> {
    this.readCount += 1;
    if (this.readError !== null) {
      return Promise.resolve(err(this.readError));
    }

    return Promise.resolve(ok(this.settings === null ? null : { ...this.settings }));
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

    this.settings = {
      id: 'chat-model',
      provider: input.provider,
      modelId: input.modelId,
      revision: currentRevision + 1,
      updatedAt: input.updatedAt,
      updatedByUserId: input.updatedByUserId,
    };

    return Promise.resolve(ok({ ...this.settings }));
  }
}

function manager(repository: ChatSettingsRepository, logger = { warn: vi.fn() }) {
  return createChatModelSettingsManager({
    repository,
    clock,
    logger,
  });
}

describe('chat model settings manager', () => {
  it('falls back to the application default model when no settings document exists', async () => {
    const response = await manager(new FakeChatSettingsRepository()).getChatModelSettings();

    expect(response.selected).toMatchObject({
      id: 'chat-model',
      provider: 'openrouter',
      modelId: DEFAULT_CHAT_MODEL,
      revision: 0,
    });
    expect(response.active).toEqual({
      provider: 'openrouter',
      modelId: DEFAULT_CHAT_MODEL,
      activeBecause: 'missing-settings',
    });
    expect(response.models.map((model) => model.modelId)).toEqual(
      CURATED_CHAT_MODELS.map((model) => model.modelId)
    );
  });

  it('uses valid saved settings as the active chat model', async () => {
    const response = await manager(
      new FakeChatSettingsRepository(setting({ modelId: 'deepseek/deepseek-v4-flash' }))
    ).getChatModelSettings();

    expect(response.selected.modelId).toBe('deepseek/deepseek-v4-flash');
    expect(response.active).toEqual({
      provider: 'openrouter',
      modelId: 'deepseek/deepseek-v4-flash',
      activeBecause: 'settings',
    });
  });

  it('uses direct MiniMax provider settings as the active chat model', async () => {
    const response = await manager(
      new FakeChatSettingsRepository(setting({ provider: 'minimax', modelId: MINIMAX_CHAT_MODEL }))
    ).getChatModelSettings();

    expect(response.selected.modelId).toBe(MINIMAX_CHAT_MODEL);
    expect(response.active).toEqual({
      provider: 'minimax',
      modelId: MINIMAX_CHAT_MODEL,
      activeBecause: 'settings',
    });
  });

  it('falls back to the application default model when saved settings contain an unknown model', async () => {
    const response = await manager(
      new FakeChatSettingsRepository(setting({ modelId: 'unknown/model' }))
    ).getChatModelSettings();

    expect(response.selected.modelId).toBe('unknown/model');
    expect(response.active).toEqual({
      provider: 'openrouter',
      modelId: DEFAULT_CHAT_MODEL,
      activeBecause: 'invalid-settings',
    });
  });

  it('logs and reports read-error fallback when the repository read fails', async () => {
    const repository = new FakeChatSettingsRepository();
    repository.readError = { code: 'INTERNAL_ERROR', message: 'read failed' };
    const logger = { warn: vi.fn() };

    const response = await manager(repository, logger).getChatModelSettings();

    expect(response.active).toEqual({
      provider: 'openrouter',
      modelId: DEFAULT_CHAT_MODEL,
      activeBecause: 'read-error',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { error: repository.readError },
      'Chat model settings read failed; falling back to application default chat model'
    );
  });

  it('rejects unknown model updates', async () => {
    const result = await manager(new FakeChatSettingsRepository(setting())).updateChatModelSettings(
      {
        provider: 'openrouter',
        modelId: 'unknown/model',
        expectedRevision: 1,
        updatedByUserId: 'admin-user-1',
      }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_MODEL',
        message: 'Unknown curated chat model: openrouter/unknown/model',
      },
    });
  });

  it('rejects provider/model pairs that belong to another provider', async () => {
    const result = await manager(new FakeChatSettingsRepository(setting())).updateChatModelSettings(
      {
        provider: 'minimax',
        modelId: 'minimax/minimax-m3',
        expectedRevision: 1,
        updatedByUserId: 'admin-user-1',
      }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_MODEL',
        message: 'Unknown curated chat model: minimax/minimax/minimax-m3',
      },
    });
  });

  it('persists a known model update with revision and user metadata', async () => {
    const result = await manager(new FakeChatSettingsRepository(setting())).updateChatModelSettings(
      {
        provider: 'openrouter',
        modelId: 'deepseek/deepseek-v4-flash',
        expectedRevision: 1,
        updatedByUserId: 'admin-user-2',
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        selected: {
          provider: 'openrouter',
          modelId: 'deepseek/deepseek-v4-flash',
          revision: 2,
          updatedAt: '2026-06-19T12:00:00.000Z',
          updatedByUserId: 'admin-user-2',
        },
        active: {
          provider: 'openrouter',
          modelId: 'deepseek/deepseek-v4-flash',
          activeBecause: 'settings',
        },
      },
    });
  });

  it('returns conflict for stale revision updates', async () => {
    const result = await manager(
      new FakeChatSettingsRepository(setting({ revision: 4 }))
    ).updateChatModelSettings({
      provider: 'openrouter',
      modelId: 'deepseek/deepseek-v4-flash',
      expectedRevision: 3,
      updatedByUserId: 'admin-user-2',
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'CONFLICT',
      },
    });
  });

  it('caches active model reads and supports invalidation', async () => {
    const repository = new FakeChatSettingsRepository(setting({ modelId: 'minimax/minimax-m3' }));
    const settingsManager = manager(repository);

    await expect(settingsManager.resolveActiveChatModel()).resolves.toEqual({
      provider: 'openrouter',
      modelId: 'minimax/minimax-m3',
      activeBecause: 'settings',
    });
    repository.settings = setting({ modelId: 'deepseek/deepseek-v4-flash', revision: 2 });
    await expect(settingsManager.resolveActiveChatModel()).resolves.toMatchObject({
      modelId: 'minimax/minimax-m3',
    });

    settingsManager.invalidateCache();

    await expect(settingsManager.resolveActiveChatModel()).resolves.toMatchObject({
      modelId: 'deepseek/deepseek-v4-flash',
    });
    expect(repository.readCount).toBe(2);
  });
});
