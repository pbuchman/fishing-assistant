import { createElement, type ComponentType } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider.js';
import type { ChatModelSettingsResponse } from '../services/settingsApi.js';

const adminShellModulePath = './AdminShell.js';

const mocks = vi.hoisted(() => ({
  getPendingRequestsCount: vi.fn(),
  getChatModelSettings: vi.fn(),
  updateChatModelSettings: vi.fn(),
  logout: vi.fn(() => Promise.resolve()),
}));

vi.mock('../services/userApi.js', async () => {
  const actual = await vi.importActual('../services/userApi.js');
  return {
    ...actual,
    getPendingRequestsCount: mocks.getPendingRequestsCount,
  };
});

vi.mock('../services/settingsApi.js', async () => {
  const actual = await vi.importActual('../services/settingsApi.js');
  return {
    ...actual,
    getChatModelSettings: mocks.getChatModelSettings,
    updateChatModelSettings: mocks.updateChatModelSettings,
  };
});

vi.mock('./PendingRequestsPage.js', () => ({
  PendingRequestsPage: () => createElement('div', null, 'Admin Pending Requests Page'),
}));

vi.mock('./UsersPage.js', () => ({
  UsersPage: () => createElement('div', null, 'Admin Users Page'),
}));

vi.mock('./knowledge/KnowledgeAdminPage.js', () => ({
  KnowledgeAdminPage: () => createElement('div', null, 'Admin Knowledge Page'),
}));

vi.mock('./answer-gaps/AnswerGapsPage.js', () => ({
  AnswerGapsPage: () => createElement('div', null, 'Admin Answer Gaps Page'),
}));

vi.mock('./usage/UsageDashboard.js', () => ({
  UsageDashboard: () => createElement('div', null, 'Admin Usage Page'),
}));

vi.mock('../auth/useFaAuth.js', () => ({
  useFaAuth: () => ({
    accountState: {
      status: 'approved',
      account: {
        state: 'approved',
        user: {
          id: 'admin-user-1',
          email: 'admin@example.com',
          firstName: 'Admin',
          lastName: 'User',
          mobileNumber: '+15550101000',
          role: 'admin',
          status: 'approved',
          level: null,
          effectiveLevel: 10,
        },
        authorization: {
          userId: 'admin-user-1',
          auth0Subject: 'auth0|admin-user-1',
          email: 'admin@example.com',
          role: 'admin',
          status: 'approved',
          effectiveLevel: 10,
        },
      },
      authorization: {
        userId: 'admin-user-1',
        auth0Subject: 'auth0|admin-user-1',
        email: 'admin@example.com',
        role: 'admin',
        status: 'approved',
        effectiveLevel: 10,
      },
    },
    logout: mocks.logout,
  }),
}));

function settingsResponse(): ChatModelSettingsResponse {
  return {
    selected: {
      id: 'chat-model',
      provider: 'openrouter',
      modelId: 'google/gemini-3.5-flash',
      revision: 1,
      updatedAt: '2026-06-19T12:00:00.000Z',
      updatedByUserId: 'admin-user-1',
    },
    active: {
      provider: 'openrouter',
      modelId: 'google/gemini-3.5-flash',
      activeBecause: 'settings',
    },
    models: [
      {
        provider: 'openrouter',
        modelId: 'google/gemini-3.5-flash',
        label: 'Gemini 3.5 Flash',
        evaluationStatus: 'fallback',
        contextTokens: 1_048_576,
        supportsStructuredOutputs: true,
        notes: 'Fallback/baseline option.',
      },
      {
        provider: 'openrouter',
        modelId: 'deepseek/deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        evaluationStatus: 'selected',
        contextTokens: 1_048_576,
        supportsStructuredOutputs: true,
        notes: 'DeepSeek candidate.',
      },
    ],
  };
}

async function renderAdminShell(): Promise<ReturnType<typeof render>> {
  const { AdminShell } = (await import(adminShellModulePath)) as {
    AdminShell: ComponentType;
  };

  return render(createElement(I18nProvider, null, createElement(AdminShell)));
}

describe('AdminShell Settings navigation guard', () => {
  beforeEach(() => {
    window.localStorage.setItem('fa.locale', 'en');
    window.history.replaceState(null, '', '/#/admin/settings');
    mocks.getPendingRequestsCount.mockReset();
    mocks.getPendingRequestsCount.mockResolvedValue({ count: 0 });
    mocks.getChatModelSettings.mockReset();
    mocks.getChatModelSettings.mockResolvedValue(settingsResponse());
    mocks.updateChatModelSettings.mockReset();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('keeps the admin on Settings when dirty model changes are not confirmed', async () => {
    await renderAdminShell();

    fireEvent.change(await screen.findByLabelText('Selected model'), {
      target: { value: 'deepseek/deepseek-v4-flash' },
    });
    expect(screen.getByRole('status', { name: 'Unsaved changes' })).not.toBeNull();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    window.location.hash = '#/admin/users';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    await waitFor(() => {
      expect(window.location.hash).toBe('#/admin/settings');
    });
    expect(confirm).toHaveBeenCalledWith(
      'You have unsaved Settings changes. Leave without saving?'
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).not.toBeNull();
    expect(screen.queryByText('Admin Users Page')).toBeNull();
  });

  it('allows leaving Settings when dirty model changes are confirmed', async () => {
    await renderAdminShell();

    fireEvent.change(await screen.findByLabelText('Selected model'), {
      target: { value: 'deepseek/deepseek-v4-flash' },
    });

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    window.location.hash = '#/admin/users';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(confirm).toHaveBeenCalledWith(
      'You have unsaved Settings changes. Leave without saving?'
    );
    expect(await screen.findByText('Admin Users Page')).not.toBeNull();
    expect(window.location.hash).toBe('#/admin/users');
  });
});
