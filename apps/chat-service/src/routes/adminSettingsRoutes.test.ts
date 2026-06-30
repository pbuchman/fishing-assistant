import { afterEach, describe, expect, it } from 'vitest';

import type { AuthorizationContext, AuthorizationResolveResponse } from '@fa/http-contracts';
import { DEFAULT_CHAT_MODEL } from '@fa/llm-factory';

import type { ChatModelSettings } from '../domain/models/chatSettings.js';
import { MemoryChatSettingsRepository } from '../infra/memory/memoryChatSettingsRepository.js';
import { createServer } from '../server.js';
import { resetServices, setServices } from '../services.js';

const approvedAuthHeaders = { authorization: 'Bearer approved-test-user' } as const;

process.env['NODE_ENV'] = 'test';
process.env['FA_AUTH0_ISSUER'] = 'https://auth.example.com/';
process.env['FA_AUTH0_AUDIENCE'] = 'https://api.fishing-assistant.online';
process.env['FA_AUTH0_JWKS_URI'] = 'https://auth.example.com/.well-known/jwks.json';

function chatModelSetting(overrides: Partial<ChatModelSettings> = {}): ChatModelSettings {
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

function approvedAuthorization(role: AuthorizationContext['role']): AuthorizationContext {
  return {
    userId: `${role}-user-1`,
    auth0Subject: `auth0|${role}-user-1`,
    email: `${role}-user-1@example.com`,
    role,
    status: 'approved',
    effectiveLevel: role === 'admin' ? 10 : 4,
  };
}

function approvedResolverResponse(
  role: AuthorizationContext['role']
): AuthorizationResolveResponse {
  const authorization = approvedAuthorization(role);

  return {
    state: 'approved',
    user: {
      id: authorization.userId,
      email: authorization.email,
      firstName: 'Route',
      lastName: 'Tester',
      mobileNumber: '+15550101000',
      role,
      status: 'approved',
      level: authorization.effectiveLevel,
      effectiveLevel: authorization.effectiveLevel,
    },
    authorization,
  };
}

function setApprovedServices(input: {
  role: AuthorizationContext['role'];
  repository?: MemoryChatSettingsRepository;
}): MemoryChatSettingsRepository {
  const repository = input.repository ?? new MemoryChatSettingsRepository();
  setServices({
    chatSettingsRepository: repository,
    auth0JwtVerifier: (
      headers: Record<string, string | readonly string[] | number | undefined>
    ) => {
      const authorization = headers['authorization'];
      return Promise.resolve(
        authorization === approvedAuthHeaders.authorization
          ? {
              ok: true as const,
              identity: {
                subject: `auth0|${input.role}-user-1`,
                email: `${input.role}-user-1@example.com`,
                emailVerified: true,
                name: 'Route Tester',
              },
            }
          : {
              ok: false as const,
              error: { statusCode: 401, code: 'UNAUTHORIZED', message: 'Unauthorized' },
            }
      );
    },
    userServiceClient: {
      resolveAuthorization: () => Promise.resolve(approvedResolverResponse(input.role)),
      lookupUserIdentities: () => Promise.resolve({ users: [] }),
    },
  });

  return repository;
}

function authHeaders(): { headers: Record<string, string> } {
  return { headers: { ...approvedAuthHeaders } };
}

describe('chat-service admin settings routes', () => {
  afterEach(() => {
    resetServices();
  });

  it('returns selected chat model settings and the curated catalog for admins', async () => {
    setApprovedServices({
      role: 'admin',
      repository: new MemoryChatSettingsRepository(
        chatModelSetting({ modelId: 'deepseek/deepseek-v4-flash', revision: 2 })
      ),
    });
    const app = await createServer();

    const response = await app.inject({
      method: 'GET',
      url: '/admin/settings/chat-model',
      ...authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: {
        selected: {
          modelId: 'deepseek/deepseek-v4-flash',
          revision: 2,
        },
        active: {
          provider: 'openrouter',
          modelId: 'deepseek/deepseek-v4-flash',
          activeBecause: 'settings',
        },
      },
    });
    expect(
      response
        .json<{ data: { models: { provider: string; modelId: string }[] } }>()
        .data.models.map((model) => `${model.provider}:${model.modelId}`)
    ).toEqual([
      'openrouter:deepseek/deepseek-v4-flash',
      'openrouter:minimax/minimax-m3',
      'minimax:MiniMax-M3',
    ]);
    expect(
      JSON.stringify(response.json<{ data: { models: Record<string, unknown>[] } }>().data.models)
    ).not.toContain('UsdPer1M');
  });

  it('returns redacted runtime diagnostics for admins', async () => {
    setApprovedServices({
      role: 'admin',
      repository: new MemoryChatSettingsRepository(
        chatModelSetting({ modelId: 'deepseek/deepseek-v4-flash', revision: 2 })
      ),
    });
    const originalReleaseSha = process.env['FA_RELEASE_SHA'];
    process.env['FA_RELEASE_SHA'] = 'abc123def456';
    const app = await createServer({
      environment: 'prod',
      streamTimeoutMs: 300_000,
    });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/settings/runtime-diagnostics',
        ...authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ok: true,
        data: {
          service: 'chat-service',
          environment: 'prod',
          releaseSha: 'abc123def456',
          provider: 'openrouter',
          activeModel: {
            provider: 'openrouter',
            modelId: 'deepseek/deepseek-v4-flash',
            activeBecause: 'settings',
          },
          streamTimeoutMs: 300_000,
          processing: {
            assistantRuntime: 'single-retrieval-tool',
            outputFormat: 'json_object',
            outputParser: 'strict-json',
          },
          edgeTimeout: {
            proxyReadTimeoutMs: 330_000,
            note: 'PROD nginx proxy_read_timeout is 330s; app chat stream timeout is 300s.',
          },
        },
      });
      expect(JSON.stringify(response.json())).not.toContain('learning-hub');
      expect(JSON.stringify(response.json())).not.toContain('http');
    } finally {
      if (originalReleaseSha === undefined) {
        delete process.env['FA_RELEASE_SHA'];
      } else {
        process.env['FA_RELEASE_SHA'] = originalReleaseSha;
      }
    }
  });

  it('rejects runtime diagnostics without authentication', async () => {
    setApprovedServices({ role: 'admin' });
    const app = await createServer();

    const response = await app.inject({
      method: 'GET',
      url: '/admin/settings/runtime-diagnostics',
    });

    expect(response.statusCode).toBe(401);
  });

  it.each([
    {
      method: 'GET' as const,
      url: '/admin/settings/chat-model',
    },
    {
      method: 'PATCH' as const,
      url: '/admin/settings/chat-model',
      payload: {
        provider: 'openrouter',
        modelId: 'deepseek/deepseek-v4-flash',
        expectedRevision: 1,
      },
    },
    {
      method: 'GET' as const,
      url: '/admin/settings/runtime-diagnostics',
    },
  ])('rejects approved non-admin users for $method $url', async ({ method, payload, url }) => {
    setApprovedServices({ role: 'user' });
    const app = await createServer();

    const response = await app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload }),
      ...authHeaders(),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('persists a known selected chat model for admins', async () => {
    setApprovedServices({
      role: 'admin',
      repository: new MemoryChatSettingsRepository(chatModelSetting({ revision: 1 })),
    });
    const app = await createServer();

    const response = await app.inject({
      method: 'PATCH',
      url: '/admin/settings/chat-model',
      payload: {
        provider: 'openrouter',
        modelId: 'deepseek/deepseek-v4-flash',
        expectedRevision: 1,
      },
      ...authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: {
        selected: {
          provider: 'openrouter',
          modelId: 'deepseek/deepseek-v4-flash',
          revision: 2,
          updatedByUserId: 'admin-user-1',
        },
        active: {
          provider: 'openrouter',
          modelId: 'deepseek/deepseek-v4-flash',
          activeBecause: 'settings',
        },
      },
    });
  });

  it('rejects missing bearer tokens', async () => {
    setApprovedServices({ role: 'admin' });
    const app = await createServer();

    const response = await app.inject({
      method: 'GET',
      url: '/admin/settings/chat-model',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
  });

  it('rejects unknown model updates', async () => {
    setApprovedServices({
      role: 'admin',
      repository: new MemoryChatSettingsRepository(chatModelSetting({ revision: 1 })),
    });
    const app = await createServer();

    const response = await app.inject({
      method: 'PATCH',
      url: '/admin/settings/chat-model',
      payload: {
        provider: 'openrouter',
        modelId: 'unknown/model',
        expectedRevision: 1,
      },
      ...authHeaders(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Unknown curated chat model: openrouter/unknown/model',
      },
    });
  });

  it('persists MiniMax as a provider-level chat model selection for admins', async () => {
    setApprovedServices({
      role: 'admin',
      repository: new MemoryChatSettingsRepository(chatModelSetting({ revision: 1 })),
    });
    const app = await createServer();

    const response = await app.inject({
      method: 'PATCH',
      url: '/admin/settings/chat-model',
      payload: {
        provider: 'openrouter',
        modelId: 'deepseek/deepseek-v4-flash',
        expectedRevision: 1,
      },
      ...authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: {
        selected: {
          provider: 'openrouter',
          modelId: 'deepseek/deepseek-v4-flash',
          revision: 2,
        },
        active: {
          provider: 'openrouter',
          modelId: 'deepseek/deepseek-v4-flash',
          activeBecause: 'settings',
        },
      },
    });
  });

  it('rejects stale revision updates', async () => {
    setApprovedServices({
      role: 'admin',
      repository: new MemoryChatSettingsRepository(chatModelSetting({ revision: 3 })),
    });
    const app = await createServer();

    const response = await app.inject({
      method: 'PATCH',
      url: '/admin/settings/chat-model',
      payload: {
        provider: 'openrouter',
        modelId: 'deepseek/deepseek-v4-flash',
        expectedRevision: 2,
      },
      ...authHeaders(),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
  });
});
