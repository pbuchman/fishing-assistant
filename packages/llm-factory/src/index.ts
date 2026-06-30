export {
  CURATED_CHAT_MODELS,
  assertValidCuratedChatModelCatalog,
  findCuratedChatModel,
  isCuratedChatModelId,
  type CuratedChatModel,
  type CuratedChatModelEvaluationStatus,
} from './chatModelCatalog.js';
export {
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_MINIMAX_BASE_URL,
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_PROVIDER_SORT,
  MINIMAX_CHAT_MODEL,
  MINIMAX_PROVIDER,
  OPENROUTER_PROVIDER,
  resolveLlmProviderConfig,
  type ChatProvider,
  type LlmProviderConfig,
  type LlmProviderEnv,
  type MiniMaxProvider,
  type MiniMaxProviderConfig,
  type OpenRouterProviderConfig,
  type OpenRouterProviderSort,
} from './config.js';
export {
  OpenRouterChatProvider,
  OpenRouterEmbeddingProvider,
  MiniMaxChatProvider,
  createLlmProviders,
  createMiniMaxChatProvider,
  createOpenRouterChatProvider,
  createOpenRouterEmbeddingProvider,
  type CreateLlmProvidersParams,
  type FetchLike,
  type MiniMaxChatProviderParams,
  type UsageWarningLogger,
} from './openRouter.js';

export const packageName = '@fa/llm-factory';
