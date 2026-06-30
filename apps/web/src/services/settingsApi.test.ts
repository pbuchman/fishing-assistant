import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearApiAuthProvider, setApiAuthProvider } from './apiClient.js';
import { getChatModelSettings, updateChatModelSettings } from './settingsApi.js';

function jsonResponse(envelope: unknown, status = 200): Response {
  return new Response(JSON.stringify(envelope), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('settingsApi', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setApiAuthProvider({
      getAccessToken: vi.fn(() => Promise.resolve('settings-api-token')),
      refreshAccessToken: vi.fn(() => Promise.resolve('settings-api-token-refresh')),
    });
  });

  afterEach(() => {
    clearApiAuthProvider();
    vi.unstubAllGlobals();
  });

  it('loads chat model settings through the chat admin route', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: {
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
          models: [],
        },
      })
    );

    await expect(getChatModelSettings()).resolves.toMatchObject({
      selected: { modelId: 'google/gemini-3.5-flash' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/chat/admin/settings/chat-model');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('saves chat model settings through the chat admin route', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: {
          selected: {
            id: 'chat-model',
            provider: 'openrouter',
            modelId: 'deepseek/deepseek-v4-flash',
            revision: 2,
            updatedAt: '2026-06-19T12:05:00.000Z',
            updatedByUserId: 'admin-user-1',
          },
          active: {
            provider: 'openrouter',
            modelId: 'deepseek/deepseek-v4-flash',
            activeBecause: 'settings',
          },
          models: [],
        },
      })
    );

    await updateChatModelSettings({
      provider: 'openrouter',
      modelId: 'deepseek/deepseek-v4-flash',
      expectedRevision: 1,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/chat/admin/settings/chat-model');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        provider: 'openrouter',
        modelId: 'deepseek/deepseek-v4-flash',
        expectedRevision: 1,
      })
    );
  });
});
