import { err, ok, type Clock, type Result } from '@fa/common-core';
import {
  CURATED_CHAT_MODELS,
  DEFAULT_CHAT_MODEL,
  findCuratedChatModel,
  isCuratedChatModelId,
  type ChatProvider,
} from '@fa/llm-factory';

import {
  CHAT_MODEL_SETTINGS_ID,
  CHAT_MODEL_SETTINGS_PROVIDER,
  type ActiveChatModel,
  type ChatModelSettings,
  type ChatModelSettingsResponse,
} from '../models/chatSettings.js';
import type {
  ChatSettingsRepository,
  ChatSettingsRepositoryError,
} from '../repositories/chatSettingsRepository.js';

export type ChatModelSettingsUseCaseError =
  | ChatSettingsRepositoryError
  | { code: 'INVALID_MODEL'; message: string };

export interface UpdateChatModelSettingsInput {
  provider: ChatProvider;
  modelId: string;
  expectedRevision: number;
  updatedByUserId: string;
}

export interface ChatModelSettingsLogger {
  warn(metadata: Record<string, unknown>, message: string): void;
}

export interface ChatModelSettingsManager {
  getChatModelSettings(): Promise<ChatModelSettingsResponse>;
  updateChatModelSettings(
    input: UpdateChatModelSettingsInput
  ): Promise<Result<ChatModelSettingsResponse, ChatModelSettingsUseCaseError>>;
  resolveActiveChatModel(): Promise<ActiveChatModel>;
  invalidateCache(): void;
}

export interface CreateChatModelSettingsManagerDeps {
  repository: ChatSettingsRepository;
  clock: Clock;
  logger: ChatModelSettingsLogger;
  cacheTtlMs?: number;
}

interface ReadState {
  loadedAtMs: number;
  settings: ChatModelSettings | null;
  error?: ChatSettingsRepositoryError;
}

const defaultCacheTtlMs = 30_000;

function fallbackSettings(): ChatModelSettings {
  return {
    id: CHAT_MODEL_SETTINGS_ID,
    provider: CHAT_MODEL_SETTINGS_PROVIDER,
    modelId: DEFAULT_CHAT_MODEL,
    revision: 0,
    updatedAt: '',
    updatedByUserId: 'system:application-default',
  };
}

function fallbackModelId(): string {
  return (
    findCuratedChatModel(CHAT_MODEL_SETTINGS_PROVIDER, DEFAULT_CHAT_MODEL)?.modelId ??
    DEFAULT_CHAT_MODEL
  );
}

function activeModelFromReadState(readState: ReadState): ActiveChatModel {
  const fallback = fallbackModelId();

  if (readState.error !== undefined) {
    return {
      provider: CHAT_MODEL_SETTINGS_PROVIDER,
      modelId: fallback,
      activeBecause: 'read-error',
    };
  }

  const settings = readState.settings;
  if (settings === null) {
    return {
      provider: CHAT_MODEL_SETTINGS_PROVIDER,
      modelId: fallback,
      activeBecause: 'missing-settings',
    };
  }

  if (!isCuratedChatModelId(settings.provider, settings.modelId)) {
    return {
      provider: CHAT_MODEL_SETTINGS_PROVIDER,
      modelId: fallback,
      activeBecause: 'invalid-settings',
    };
  }

  return {
    provider: settings.provider,
    modelId: settings.modelId,
    activeBecause: 'settings',
  };
}

function responseFromReadState(readState: ReadState): ChatModelSettingsResponse {
  return {
    selected: readState.settings ?? fallbackSettings(),
    active: activeModelFromReadState(readState),
    models: CURATED_CHAT_MODELS,
  };
}

function responseFromSavedSettings(settings: ChatModelSettings): ChatModelSettingsResponse {
  return {
    selected: settings,
    active: {
      provider: settings.provider,
      modelId: settings.modelId,
      activeBecause: 'settings',
    },
    models: CURATED_CHAT_MODELS,
  };
}

export function createChatModelSettingsManager(
  deps: CreateChatModelSettingsManagerDeps
): ChatModelSettingsManager {
  let cachedReadState: ReadState | null = null;

  async function readState(): Promise<ReadState> {
    const loadedAtMs = deps.clock.now().getTime();
    if (
      cachedReadState !== null &&
      loadedAtMs - cachedReadState.loadedAtMs < (deps.cacheTtlMs ?? defaultCacheTtlMs)
    ) {
      return cachedReadState;
    }

    const result = await deps.repository.getChatModelSettings();
    if (!result.ok) {
      deps.logger.warn(
        { error: result.error },
        'Chat model settings read failed; falling back to application default chat model'
      );
      cachedReadState = { loadedAtMs, settings: null, error: result.error };
      return cachedReadState;
    }

    cachedReadState = { loadedAtMs, settings: result.value };
    return cachedReadState;
  }

  return {
    async getChatModelSettings(): Promise<ChatModelSettingsResponse> {
      return responseFromReadState(await readState());
    },

    async updateChatModelSettings(
      input: UpdateChatModelSettingsInput
    ): Promise<Result<ChatModelSettingsResponse, ChatModelSettingsUseCaseError>> {
      if (!isCuratedChatModelId(input.provider, input.modelId)) {
        return err({
          code: 'INVALID_MODEL',
          message: `Unknown curated chat model: ${input.provider}/${input.modelId}`,
        });
      }

      const saved = await deps.repository.saveChatModelSettings({
        provider: input.provider,
        modelId: input.modelId,
        expectedRevision: input.expectedRevision,
        updatedAt: deps.clock.now().toISOString(),
        updatedByUserId: input.updatedByUserId,
      });
      if (!saved.ok) {
        return saved;
      }

      cachedReadState = null;
      return ok(responseFromSavedSettings(saved.value));
    },

    async resolveActiveChatModel(): Promise<ActiveChatModel> {
      return activeModelFromReadState(await readState());
    },

    invalidateCache(): void {
      cachedReadState = null;
    },
  };
}
