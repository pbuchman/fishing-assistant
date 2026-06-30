export const OPENROUTER_PROVIDER = 'openrouter';
export const MINIMAX_PROVIDER = 'minimax';
export const DEFAULT_CHAT_MODEL = 'deepseek/deepseek-v4-flash';
export const MINIMAX_CHAT_MODEL = 'MiniMax-M3';
export const DEFAULT_EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';
export const DEFAULT_EMBEDDING_DIMENSIONS = 2048;
export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
export const DEFAULT_OPENROUTER_PROVIDER_SORT = 'throughput';

export type OpenRouterProvider = typeof OPENROUTER_PROVIDER;
export type MiniMaxProvider = typeof MINIMAX_PROVIDER;
export type ChatProvider = OpenRouterProvider | MiniMaxProvider;
export type OpenRouterProviderSort = 'price' | 'throughput' | 'latency';

export type LlmProviderEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

export interface OpenRouterProviderConfig {
  apiKey: string;
  baseUrl: string;
  providerSort: OpenRouterProviderSort;
}

export interface MiniMaxProviderConfig {
  apiKey: string;
  baseUrl: string;
}

export interface LlmProviderConfig {
  chat: {
    provider: ChatProvider;
    model: string;
  };
  embeddings: {
    provider: OpenRouterProvider;
    model: string;
    dimensions: number;
  };
  openRouter: OpenRouterProviderConfig;
  minimax: MiniMaxProviderConfig;
}

function optionalString(env: LlmProviderEnv, key: string): string | undefined {
  const value = env[key];
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function provider(env: LlmProviderEnv, key: string): OpenRouterProvider {
  const value = optionalString(env, key) ?? OPENROUTER_PROVIDER;
  if (value !== OPENROUTER_PROVIDER) {
    throw new Error(`${key} must be openrouter`);
  }

  return OPENROUTER_PROVIDER;
}

function requiredSecret(env: LlmProviderEnv, key: string): string {
  const value = optionalString(env, key);
  if (value === undefined) {
    throw new Error(`${key} must be set`);
  }

  return value;
}

function positiveInteger(env: LlmProviderEnv, key: string, defaultValue: number): number {
  const value = optionalString(env, key);
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }

  return parsed;
}

function openRouterProviderSort(env: LlmProviderEnv): OpenRouterProviderSort {
  const value =
    optionalString(env, 'FA_OPENROUTER_PROVIDER_SORT') ?? DEFAULT_OPENROUTER_PROVIDER_SORT;
  if (value !== 'price' && value !== 'throughput' && value !== 'latency') {
    throw new Error('FA_OPENROUTER_PROVIDER_SORT must be price, throughput, or latency');
  }

  return value;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveLlmProviderConfig(env: LlmProviderEnv = process.env): LlmProviderConfig {
  const embeddingProvider = provider(env, 'FA_EMBEDDING_PROVIDER');

  return {
    chat: {
      provider: OPENROUTER_PROVIDER,
      model: DEFAULT_CHAT_MODEL,
    },
    embeddings: {
      provider: embeddingProvider,
      model: optionalString(env, 'FA_EMBEDDING_MODEL') ?? DEFAULT_EMBEDDING_MODEL,
      dimensions: positiveInteger(env, 'FA_EMBEDDING_DIMENSIONS', DEFAULT_EMBEDDING_DIMENSIONS),
    },
    openRouter: {
      apiKey: requiredSecret(env, 'FA_OPENROUTER_APP_API_KEY'),
      baseUrl: trimTrailingSlashes(
        optionalString(env, 'FA_OPENROUTER_BASE_URL') ?? DEFAULT_OPENROUTER_BASE_URL
      ),
      providerSort: openRouterProviderSort(env),
    },
    minimax: {
      apiKey: requiredSecret(env, 'FA_MINIMAX_APP_API_KEY'),
      baseUrl: trimTrailingSlashes(
        optionalString(env, 'FA_MINIMAX_BASE_URL') ?? DEFAULT_MINIMAX_BASE_URL
      ),
    },
  };
}
