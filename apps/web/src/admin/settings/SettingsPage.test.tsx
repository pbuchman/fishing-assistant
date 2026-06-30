import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement, type ComponentType } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../../services/apiClient.js';
import type { ChatModelSettingsResponse } from '../../services/settingsApi.js';
import { I18nProvider } from '../../i18n/I18nProvider.js';

const settingsPageModulePath = './SettingsPage.js';
const stylesSource = readFileSync(join(process.cwd(), 'apps/web/src/styles.css'), 'utf8');

const mocks = vi.hoisted(() => ({
  getChatModelSettings: vi.fn(),
  updateChatModelSettings: vi.fn(),
}));

vi.mock('../../services/settingsApi.js', async () => {
  const actual = await vi.importActual('../../services/settingsApi.js');
  return {
    ...actual,
    getChatModelSettings: mocks.getChatModelSettings,
    updateChatModelSettings: mocks.updateChatModelSettings,
  };
});

function settingsResponse(
  overrides: Partial<ChatModelSettingsResponse['selected']> = {}
): ChatModelSettingsResponse {
  const selected = {
    id: 'chat-model' as const,
    provider: 'openrouter' as const,
    modelId: 'deepseek/deepseek-v4-flash',
    revision: 1,
    updatedAt: '2026-06-19T12:00:00.000Z',
    updatedByUserId: 'admin-user-1',
    ...overrides,
  };

  return {
    selected,
    active: {
      provider: selected.provider,
      modelId: selected.modelId,
      activeBecause: 'settings',
    },
    models: [
      {
        provider: 'openrouter',
        modelId: 'deepseek/deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        evaluationStatus: 'selected',
        contextTokens: 1_048_576,
        supportsStructuredOutputs: true,
        notes: 'Default OpenRouter chat model.',
      },
      {
        provider: 'openrouter',
        modelId: 'minimax/minimax-m3',
        label: 'MiniMax M3',
        evaluationStatus: 'selected',
        contextTokens: 1_048_576,
        supportsStructuredOutputs: true,
        notes: 'Default balanced chat model.',
      },
      {
        provider: 'minimax',
        modelId: 'MiniMax-M3',
        label: 'MiniMax M3',
        evaluationStatus: 'selected',
        contextTokens: 1_048_576,
        supportsStructuredOutputs: true,
        notes: 'Direct MiniMax provider model.',
      },
    ],
  };
}

async function renderSettingsPage(): Promise<void> {
  const { SettingsPage } = (await import(settingsPageModulePath)) as {
    SettingsPage: ComponentType;
  };

  render(createElement(I18nProvider, null, createElement(SettingsPage)));
}

describe('SettingsPage', () => {
  beforeEach(() => {
    window.localStorage.setItem('fa.locale', 'en');
    mocks.getChatModelSettings.mockReset();
    mocks.updateChatModelSettings.mockReset();
    mocks.getChatModelSettings.mockResolvedValue(settingsResponse());
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('loads chat model settings and renders curated options in order', async () => {
    await renderSettingsPage();

    expect(await screen.findByRole('heading', { level: 2, name: 'Settings' })).not.toBeNull();
    expect(screen.getByLabelText('Selected provider')).toHaveValue('openrouter');
    const modelSelect = screen.getByLabelText<HTMLSelectElement>('Selected model');
    expect(modelSelect).toHaveValue('deepseek/deepseek-v4-flash');
    expect(Array.from(modelSelect.options).map((option) => option.value)).toEqual([
      'deepseek/deepseek-v4-flash',
      'minimax/minimax-m3',
    ]);
    expect(screen.getByText('Active model: DeepSeek V4 Flash')).not.toBeNull();
    expect(screen.queryByText('Fallback/baseline option')).toBeNull();
    expect(screen.queryByText(/per 1M/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('shows only MiniMax-M3 when the MiniMax provider is selected', async () => {
    await renderSettingsPage();

    fireEvent.change(await screen.findByLabelText('Selected provider'), {
      target: { value: 'minimax' },
    });

    expect(screen.getByLabelText('Selected model')).toHaveValue('MiniMax-M3');
    const modelSelect = screen.getByLabelText<HTMLSelectElement>('Selected model');
    expect(Array.from(modelSelect.options).map((option) => option.value)).toEqual(['MiniMax-M3']);
    expect(screen.getByText('Provider')).not.toBeNull();
    expect(screen.getAllByText('MiniMax').length).toBeGreaterThan(0);
    expect(screen.queryByText(/per 1M/)).toBeNull();
  });

  it('saves a changed model and updates the selected revision', async () => {
    mocks.updateChatModelSettings.mockResolvedValue(
      settingsResponse({ modelId: 'minimax/minimax-m3', revision: 2 })
    );
    await renderSettingsPage();

    fireEvent.change(await screen.findByLabelText('Selected model'), {
      target: { value: 'minimax/minimax-m3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(mocks.updateChatModelSettings).toHaveBeenCalledWith({
      provider: 'openrouter',
      modelId: 'minimax/minimax-m3',
      expectedRevision: 1,
    });
    expect(await screen.findByText('Saved')).not.toBeNull();
    expect(screen.getByText('Revision 2')).not.toBeNull();
  });

  it('reloads after a save conflict while keeping the attempted model selected', async () => {
    mocks.updateChatModelSettings.mockRejectedValueOnce(
      new ApiClientError('Chat model setting revision 1 is stale', 409)
    );
    mocks.getChatModelSettings
      .mockResolvedValueOnce(settingsResponse())
      .mockResolvedValueOnce(settingsResponse({ modelId: 'minimax/minimax-m3', revision: 2 }));
    await renderSettingsPage();

    fireEvent.change(await screen.findByLabelText('Selected model'), {
      target: { value: 'minimax/minimax-m3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText('Settings changed before your save. Current settings were reloaded.')
    ).not.toBeNull();
    await waitFor(() => {
      expect(screen.getByLabelText('Selected model')).toHaveValue('minimax/minimax-m3');
    });
    expect(screen.getByText('Revision 2')).not.toBeNull();
  });

  it('labels unsaved model choices separately from the active saved model', async () => {
    await renderSettingsPage();

    fireEvent.change(await screen.findByLabelText('Selected model'), {
      target: { value: 'minimax/minimax-m3' },
    });

    expect(screen.getByText('Unsaved selection: MiniMax M3')).not.toBeNull();
    expect(screen.getByText('Active model: DeepSeek V4 Flash')).not.toBeNull();
  });

  it('shows an unsaved warning and protects browser unload for changed model choices', async () => {
    await renderSettingsPage();

    fireEvent.change(await screen.findByLabelText('Selected model'), {
      target: { value: 'minimax/minimax-m3' },
    });

    expect(screen.getByRole('status', { name: 'Unsaved changes' })).not.toBeNull();
    expect(screen.getByText('Selected model: MiniMax M3')).not.toBeNull();

    const event = new Event('beforeunload', { cancelable: true });

    expect(window.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('formats model update timestamps instead of rendering raw ISO strings', async () => {
    await renderSettingsPage();

    await screen.findByText('Active model: DeepSeek V4 Flash');

    expect(screen.queryByText('2026-06-19T12:00:00.000Z')).toBeNull();
    expect(screen.getByText(/2026/)).not.toBeNull();
  });

  it('keeps settings action buttons visually distinct and at least 44px tall', () => {
    const buttonRule =
      /\.fa-icon-button,\s*\.fa-primary-button,[^}]*}/s.exec(stylesSource)?.[0] ?? '';
    const disabledRule = /\.fa-primary-button:disabled,[^}]*}/s.exec(stylesSource)?.[0] ?? '';

    expect(buttonRule).toContain('.fa-secondary-button');
    expect(buttonRule).toContain('min-height: 44px');
    expect(disabledRule).toContain('.fa-secondary-button:disabled');
    expect(disabledRule).toContain('background: var(--fa-surface-muted)');
  });
});
