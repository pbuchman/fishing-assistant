import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { useI18n } from '../../i18n/useI18n.js';
import { ApiClientError } from '../../services/apiClient.js';
import {
  getChatModelSettings,
  updateChatModelSettings,
  type ChatModelSettingsResponse,
  type ChatModelProvider,
  type CuratedChatModel,
} from '../../services/settingsApi.js';
import { useAdminNavigationGuard } from '../navigationGuard.js';

type LoadStatus = 'loading' | 'ready' | 'error';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

interface DraftChatModelSelection {
  provider: ChatModelProvider;
  modelId: string;
}

function modelsForProvider(
  response: ChatModelSettingsResponse | null,
  provider: ChatModelProvider
): CuratedChatModel[] {
  return response?.models.filter((model) => model.provider === provider) ?? [];
}

function fallbackDraftSelection(response: ChatModelSettingsResponse): DraftChatModelSelection {
  if (
    response.models.some(
      (model) =>
        model.provider === response.selected.provider && model.modelId === response.selected.modelId
    )
  ) {
    return { provider: response.selected.provider, modelId: response.selected.modelId };
  }

  if (
    response.models.some(
      (model) =>
        model.provider === response.active.provider && model.modelId === response.active.modelId
    )
  ) {
    return { provider: response.active.provider, modelId: response.active.modelId };
  }

  const fallback = response.models[0];
  return {
    provider: fallback?.provider ?? 'openrouter',
    modelId: fallback?.modelId ?? '',
  };
}

function findModel(
  response: ChatModelSettingsResponse | null,
  provider: ChatModelProvider,
  modelId: string
): CuratedChatModel | null {
  return (
    response?.models.find((model) => model.provider === provider && model.modelId === modelId) ??
    null
  );
}

function formatContextTokens(model: CuratedChatModel): string {
  return `${new Intl.NumberFormat('en-US').format(model.contextTokens)} tokens`;
}

function formatUpdatedAt(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

function selectedOptionLabel(model: CuratedChatModel, fallbackLabel: string): string {
  return model.evaluationStatus === 'fallback' ? `${model.label} - ${fallbackLabel}` : model.label;
}

function providerLabel(provider: ChatModelProvider): string {
  return provider === 'minimax' ? 'MiniMax' : 'OpenRouter';
}

export function SettingsPage(): ReactElement {
  const { locale, messages } = useI18n();
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [settings, setSettings] = useState<ChatModelSettingsResponse | null>(null);
  const [draftProvider, setDraftProvider] = useState<ChatModelProvider>('openrouter');
  const [draftModelId, setDraftModelId] = useState('');
  const admin = messages.app.admin;
  const providerModels = useMemo(
    () => modelsForProvider(settings, draftProvider),
    [draftProvider, settings]
  );
  const selectedModel = useMemo(
    () => findModel(settings, draftProvider, draftModelId),
    [draftModelId, draftProvider, settings]
  );
  const activeModel = useMemo(
    () =>
      settings === null
        ? null
        : findModel(settings, settings.selected.provider, settings.selected.modelId),
    [settings]
  );
  const changed =
    settings !== null &&
    (draftProvider !== settings.selected.provider || draftModelId !== settings.selected.modelId);
  const canSave = loadStatus === 'ready' && changed && saveStatus !== 'saving';
  const navigationGuard = useMemo(
    () =>
      changed
        ? {
            isDirty: true,
            confirmMessage: admin.unsavedSettingsConfirm,
          }
        : null,
    [admin.unsavedSettingsConfirm, changed]
  );
  useAdminNavigationGuard(navigationGuard);

  useEffect(() => {
    if (!changed) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [changed]);

  async function loadSettings(
    options: { draftProvider?: ChatModelProvider; draftModelId?: string } = {}
  ): Promise<void> {
    setLoadStatus('loading');
    try {
      const response = await getChatModelSettings();
      const draftSelection =
        options.draftModelId === undefined
          ? fallbackDraftSelection(response)
          : {
              provider: options.draftProvider ?? response.selected.provider,
              modelId: options.draftModelId,
            };
      setSettings(response);
      setDraftProvider(draftSelection.provider);
      setDraftModelId(draftSelection.modelId);
      setLoadStatus('ready');
    } catch {
      setLoadStatus('error');
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  async function handleSave(): Promise<void> {
    if (settings === null || !canSave) {
      return;
    }

    const attemptedModelId = draftModelId;
    const attemptedProvider = draftProvider;
    setSaveStatus('saving');
    try {
      const response = await updateChatModelSettings({
        provider: attemptedProvider,
        modelId: attemptedModelId,
        expectedRevision: settings.selected.revision,
      });
      const draftSelection = fallbackDraftSelection(response);
      setSettings(response);
      setDraftProvider(draftSelection.provider);
      setDraftModelId(draftSelection.modelId);
      setLoadStatus('ready');
      setSaveStatus('saved');
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        setSaveStatus('conflict');
        await loadSettings({ draftProvider: attemptedProvider, draftModelId: attemptedModelId });
        return;
      }

      setSaveStatus('error');
    }
  }

  function handleReset(): void {
    if (settings === null) {
      return;
    }

    const draftSelection = fallbackDraftSelection(settings);
    setDraftProvider(draftSelection.provider);
    setDraftModelId(draftSelection.modelId);
    setSaveStatus('idle');
  }

  return (
    <div className="settings-page">
      <header className="panel-header">
        <h2>{admin.settings}</h2>
        <p className="panel-subtitle">{admin.settingsSubtitle}</p>
      </header>

      {changed && selectedModel !== null ? (
        <div
          aria-label={admin.unsavedSettingsTitle}
          className="settings-unsaved-banner"
          role="status"
        >
          <strong>{admin.unsavedSettingsTitle}</strong>
          <p>{admin.unsavedSettingsDescription}</p>
          <p>
            {admin.selectedModel}: {selectedModel.label}
          </p>
        </div>
      ) : null}

      {loadStatus === 'error' ? <p className="error-copy">{admin.loadSettingsError}</p> : null}

      <section className="settings-section" aria-labelledby="chat-model-settings-heading">
        <div className="settings-section-header">
          <div>
            <h3 id="chat-model-settings-heading">{admin.chatModelSection}</h3>
            <p>{admin.operationalEffect}</p>
          </div>
          {settings === null ? null : (
            <span className="settings-revision">
              {admin.currentRevision} {settings.selected.revision}
            </span>
          )}
        </div>

        {loadStatus === 'loading' && settings === null ? (
          <p className="muted-copy">{messages.app.status.loading}</p>
        ) : null}

        {settings !== null ? (
          <>
            <label className="settings-model-control">
              <span>{admin.selectedProvider}</span>
              <select
                value={draftProvider}
                onChange={(event) => {
                  const nextProvider = event.currentTarget.value as ChatModelProvider;
                  const nextModel = modelsForProvider(settings, nextProvider)[0]?.modelId ?? '';
                  setDraftProvider(nextProvider);
                  setDraftModelId(nextModel);
                  if (saveStatus !== 'saving') {
                    setSaveStatus('idle');
                  }
                }}
              >
                <option value="openrouter">OpenRouter</option>
                <option value="minimax">MiniMax</option>
              </select>
            </label>

            <label className="settings-model-control">
              <span>{admin.selectedModel}</span>
              <select
                value={draftModelId}
                onChange={(event) => {
                  setDraftModelId(event.currentTarget.value);
                  if (saveStatus !== 'saving') {
                    setSaveStatus('idle');
                  }
                }}
              >
                {providerModels.map((model) => (
                  <option key={`${model.provider}:${model.modelId}`} value={model.modelId}>
                    {selectedOptionLabel(model, admin.fallbackBaselineOption)}
                  </option>
                ))}
              </select>
            </label>

            {selectedModel !== null ? (
              <>
                <p className="settings-model-current">
                  {changed
                    ? `${admin.unsavedModelSelection}: ${selectedModel.label}`
                    : `${admin.activeModel}: ${selectedModel.label}`}
                </p>
                {changed && activeModel !== null ? (
                  <p className="settings-model-saved">
                    {admin.activeModel}: {activeModel.label}
                  </p>
                ) : null}
                <dl className="settings-model-details">
                  <div>
                    <dt>{admin.provider}</dt>
                    <dd>{providerLabel(selectedModel.provider)}</dd>
                  </div>
                  <div>
                    <dt>{admin.contextWindow}</dt>
                    <dd>{formatContextTokens(selectedModel)}</dd>
                  </div>
                  <div>
                    <dt>{admin.structuredOutput}</dt>
                    <dd>{admin.supported}</dd>
                  </div>
                  <div>
                    <dt>{admin.lastUpdated}</dt>
                    <dd>{formatUpdatedAt(settings.selected.updatedAt, locale)}</dd>
                  </div>
                </dl>
              </>
            ) : null}

            {selectedModel?.evaluationStatus === 'fallback' ? (
              <p className="settings-model-note">{admin.fallbackBaselineOption}</p>
            ) : null}

            <div className="admin-actions settings-actions">
              <button
                className="fa-primary-button"
                type="button"
                disabled={!canSave}
                onClick={() => {
                  void handleSave();
                }}
              >
                {messages.app.commonActions.saveChanges}
              </button>
              <button
                className="fa-secondary-button"
                type="button"
                disabled={!changed || saveStatus === 'saving'}
                onClick={handleReset}
              >
                {messages.app.commonActions.reset}
              </button>
              <span className="admin-save-state" role="status">
                {saveStatus === 'saving' ? messages.app.status.loading : null}
                {saveStatus === 'saved' ? admin.saveSuccess : null}
                {saveStatus === 'conflict' ? admin.saveConflict : null}
                {saveStatus === 'error' ? admin.saveSettingsError : null}
              </span>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
