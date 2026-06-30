import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UsageEventInput } from '@fa/llm-pricing';

import { initRuntimeServices, initServices, resetServices } from './services.js';
import { queryEmbeddingInputBuilder } from './domain/usecases/retrieveKnowledge.js';
import { pageEmbeddingInputBuilder } from './domain/usecases/syncDocument.js';

function runtimeEnv(): NodeJS.ProcessEnv {
  return {
    FA_ENVIRONMENT: 'test',
    FA_BIND_HOST: '127.0.0.1',
    FA_GCP_PROJECT_ID: 'fishing-assistant',
    FA_OPENROUTER_APP_API_KEY: 'openrouter-key',
    FA_MINIMAX_APP_API_KEY: 'minimax-key',
    FA_AUTH0_ISSUER: 'https://auth.example.com/',
    FA_AUTH0_AUDIENCE: 'fa-api',
    FA_AUTH0_JWKS_URI: 'https://auth.example.com/.well-known/jwks.json',
    FA_WEB_APP_URL: 'https://dev.fishing-assistant.online',
    FA_PUBLIC_ORIGIN: 'https://dev.fishing-assistant.online',
    FA_CHAT_SERVICE_URL: '/api/chat',
    FA_KNOWLEDGE_SERVICE_URL: '/api/knowledge',
    FA_LLM_USAGE_SERVICE_URL: '/api/llm-usage',
    FA_CHAT_SERVICE_INTERNAL_URL: 'http://127.0.0.1:3201',
    FA_KNOWLEDGE_SERVICE_INTERNAL_URL: 'http://127.0.0.1:3202',
    FA_LLM_USAGE_SERVICE_INTERNAL_URL: 'http://usage-service.test',
    FA_USER_SERVICE_INTERNAL_URL: 'http://user-service.test',
    FA_INTERNAL_AUTH_TOKEN: 'internal-token',
  };
}

function fetchUrl(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }

  return input instanceof URL ? input.href : input.url;
}

function recordUsageEvents(body: unknown, usageEvents: UsageEventInput[]): void {
  if (
    body === null ||
    typeof body !== 'object' ||
    !Array.isArray((body as { events?: unknown }).events)
  ) {
    return;
  }

  const events = (body as { events: unknown[] }).events.filter(
    (event): event is UsageEventInput =>
      event !== null && typeof event === 'object' && !Array.isArray(event)
  );
  usageEvents.push(...events);
}

describe('knowledge-service runtime services', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetServices();
  });

  it('wires runtime embedding providers to nested usage events with required attribution', async () => {
    const usageEvents: UsageEventInput[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = fetchUrl(input);
        if (url.endsWith('/embeddings')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [{ index: 0, embedding: [0.1, 0.2] }],
                usage: { prompt_tokens: 2, total_tokens: 2 },
              })
            )
          );
        }

        if (url.endsWith('/internal/usage-events')) {
          const body = (typeof init?.body === 'string' ? JSON.parse(init.body) : {}) as unknown;
          recordUsageEvents(body, usageEvents);

          return Promise.resolve(
            new Response(
              JSON.stringify({ ok: true, data: { accepted: 1, duplicates: 0, rejected: [] } })
            )
          );
        }

        return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
      })
    );

    const services = initRuntimeServices(runtimeEnv());
    await services.embeddingProvider.embed({
      input: 'document chunk',
      model: 'custom/embedding',
      dimensions: 2,
      owner: { type: 'user', id: 'admin-user-1' },
      promptType: 'knowledge-page-sync-embedding',
      promptVersion: pageEmbeddingInputBuilder.version,
    });
    await services.embeddingProvider.embed({
      input: 'reindex chunk',
      model: 'custom/embedding',
      dimensions: 2,
      owner: { type: 'user', id: 'admin-user-1' },
      promptType: 'knowledge-page-reindex-embedding',
      promptVersion: pageEmbeddingInputBuilder.version,
    });
    await services.queryEmbeddingProvider.embed({
      input: 'retrieval query',
      model: 'custom/embedding',
      dimensions: 2,
      owner: { type: 'user', id: 'user-123' },
      promptType: 'rag-query-embedding',
      promptVersion: queryEmbeddingInputBuilder.version,
    });
    await services.syncEmbeddingProvider.embed({
      input: 'full sync chunk',
      model: 'custom/embedding',
      dimensions: 2,
      owner: { type: 'user', id: 'admin-user-1' },
      promptType: 'knowledge-full-sync-embedding',
      promptVersion: pageEmbeddingInputBuilder.version,
    });

    expect(usageEvents).toMatchObject([
      {
        owner: { type: 'user', id: 'admin-user-1' },
        source: {
          service: 'knowledge-service',
          component: 'knowledge-embedding',
          promptType: 'knowledge-page-sync-embedding',
        },
        request: { promptVersion: pageEmbeddingInputBuilder.version },
      },
      {
        owner: { type: 'user', id: 'admin-user-1' },
        source: {
          service: 'knowledge-service',
          component: 'knowledge-embedding',
          promptType: 'knowledge-page-reindex-embedding',
        },
        request: { promptVersion: pageEmbeddingInputBuilder.version },
      },
      {
        owner: { type: 'user', id: 'user-123' },
        source: {
          service: 'knowledge-service',
          component: 'query-embedding',
          promptType: 'rag-query-embedding',
        },
        request: { promptVersion: queryEmbeddingInputBuilder.version },
      },
      {
        owner: { type: 'user', id: 'admin-user-1' },
        source: {
          service: 'knowledge-service',
          component: 'knowledge-sync',
          promptType: 'knowledge-full-sync-embedding',
        },
        request: { promptVersion: pageEmbeddingInputBuilder.version },
      },
    ]);
  });

  it('exposes resolved runtime embedding config on the service container', () => {
    const services = initRuntimeServices({
      ...runtimeEnv(),
      FA_EMBEDDING_PROVIDER: 'openrouter',
      FA_EMBEDDING_MODEL: 'custom/fa-embedding',
      FA_EMBEDDING_DIMENSIONS: '1024',
    });

    expect(services.embeddingConfig).toEqual({
      provider: 'openrouter',
      model: 'custom/fa-embedding',
      dimensions: 1024,
    });
  });

  it('exposes an Answer Gap repository on default services', () => {
    const services = initServices();

    expect(services.answerGapRepository).toBeDefined();
  });
});
