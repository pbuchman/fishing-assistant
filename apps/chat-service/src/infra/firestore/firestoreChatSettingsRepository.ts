import { err, getErrorMessage, ok, type Result } from '@fa/common-core';
import { getFirestore, type Firestore } from '@fa/infra-firestore';
import type { ChatProvider } from '@fa/llm-factory';

import {
  CHAT_MODEL_SETTINGS_ID,
  CHAT_MODEL_SETTINGS_PROVIDER,
  type ChatModelSettings,
} from '../../domain/models/chatSettings.js';
import type {
  ChatSettingsRepository,
  ChatSettingsRepositoryError,
  SaveChatModelSettingsInput,
} from '../../domain/repositories/chatSettingsRepository.js';
import { CHAT_RUNTIME_SETTINGS_COLLECTION } from './collections.js';
import { isoFromTimestamp, timestampFromIso } from './firestoreMapping.js';

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

function numberField(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  return typeof value === 'number' ? value : 0;
}

function providerField(data: Record<string, unknown>): ChatProvider {
  const provider = stringField(data, 'provider');
  if (provider === 'minimax') {
    return 'minimax';
  }
  if (provider === 'openrouter' || provider.length === 0) {
    return 'openrouter';
  }
  return CHAT_MODEL_SETTINGS_PROVIDER;
}

function settingsToDoc(settings: ChatModelSettings): Record<string, unknown> {
  return {
    ...settings,
    updatedAt: timestampFromIso(settings.updatedAt),
  };
}

function settingsFromDoc(data: Record<string, unknown>): ChatModelSettings {
  return {
    id: CHAT_MODEL_SETTINGS_ID,
    provider: providerField(data),
    modelId: stringField(data, 'modelId'),
    revision: numberField(data, 'revision'),
    updatedAt: isoFromTimestamp(data['updatedAt'], 'updatedAt'),
    updatedByUserId: stringField(data, 'updatedByUserId'),
  };
}

function staleRevision(expectedRevision: number): ChatSettingsRepositoryError {
  return {
    code: 'CONFLICT',
    message: `Chat model setting revision ${String(expectedRevision)} is stale`,
  };
}

function settingsRepositoryError(error: unknown): ChatSettingsRepositoryError {
  return { code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'Firestore operation failed') };
}

export class FirestoreChatSettingsRepository implements ChatSettingsRepository {
  constructor(private readonly firestore?: Firestore) {}

  private get db(): Firestore {
    return this.firestore ?? getFirestore();
  }

  async getChatModelSettings(): Promise<
    Result<ChatModelSettings | null, ChatSettingsRepositoryError>
  > {
    try {
      const snapshot = await this.db
        .collection(CHAT_RUNTIME_SETTINGS_COLLECTION)
        .doc(CHAT_MODEL_SETTINGS_ID)
        .get();
      if (!snapshot.exists) {
        return ok(null);
      }

      return ok(settingsFromDoc(snapshot.data() as Record<string, unknown>));
    } catch (error) {
      return err(settingsRepositoryError(error));
    }
  }

  async saveChatModelSettings(
    input: SaveChatModelSettingsInput
  ): Promise<Result<ChatModelSettings, ChatSettingsRepositoryError>> {
    try {
      return await this.db.runTransaction(async (transaction) => {
        const ref = this.db
          .collection(CHAT_RUNTIME_SETTINGS_COLLECTION)
          .doc(CHAT_MODEL_SETTINGS_ID);
        const snapshot = await transaction.get(ref);
        const data = snapshot.data() as Record<string, unknown> | undefined;
        const currentRevision =
          snapshot.exists && data !== undefined ? numberField(data, 'revision') : 0;
        if (currentRevision !== input.expectedRevision) {
          return err(staleRevision(input.expectedRevision));
        }

        const next: ChatModelSettings = {
          id: CHAT_MODEL_SETTINGS_ID,
          provider: input.provider,
          modelId: input.modelId,
          revision: currentRevision + 1,
          updatedAt: input.updatedAt,
          updatedByUserId: input.updatedByUserId,
        };
        transaction.set(ref, settingsToDoc(next));

        return ok(next);
      });
    } catch (error) {
      return err(settingsRepositoryError(error));
    }
  }
}
