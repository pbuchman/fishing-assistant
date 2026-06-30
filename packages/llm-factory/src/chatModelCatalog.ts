import {
  DEFAULT_CHAT_MODEL,
  MINIMAX_CHAT_MODEL,
  MINIMAX_PROVIDER,
  OPENROUTER_PROVIDER,
  type ChatProvider,
} from './config.js';

export type CuratedChatModelEvaluationStatus = 'fallback' | 'selected';

export interface CuratedChatModel {
  readonly provider: ChatProvider;
  readonly modelId: string;
  readonly label: string;
  readonly evaluationStatus: CuratedChatModelEvaluationStatus;
  readonly contextTokens: number;
  readonly supportsStructuredOutputs: true;
  readonly notes: string;
}

export const CURATED_CHAT_MODELS = [
  {
    provider: OPENROUTER_PROVIDER,
    modelId: DEFAULT_CHAT_MODEL,
    label: 'DeepSeek V4 Flash',
    evaluationStatus: 'selected',
    contextTokens: 1_048_576,
    supportsStructuredOutputs: true,
    notes:
      'Default OpenRouter chat model with very low cost, large context, tool use, and structured outputs.',
  },
  {
    provider: OPENROUTER_PROVIDER,
    modelId: 'minimax/minimax-m3',
    label: 'MiniMax M3',
    evaluationStatus: 'selected',
    contextTokens: 1_048_576,
    supportsStructuredOutputs: true,
    notes:
      'OpenRouter MiniMax M3 option with low output cost, large context, and app-specific structured-output validation.',
  },
  {
    provider: MINIMAX_PROVIDER,
    modelId: MINIMAX_CHAT_MODEL,
    label: 'MiniMax M3',
    evaluationStatus: 'selected',
    contextTokens: 1_048_576,
    supportsStructuredOutputs: true,
    notes: 'Direct MiniMax provider model with app-side cost tracking and disabled thinking.',
  },
] as const satisfies readonly CuratedChatModel[];

export function assertValidCuratedChatModelCatalog(models: readonly CuratedChatModel[]): void {
  if (models.length === 0) {
    throw new Error('Curated chat model catalog must not be empty');
  }

  const seenModelIds = new Set<string>();
  for (const model of models) {
    const key = `${model.provider}:${model.modelId}`;
    if (seenModelIds.has(key)) {
      throw new Error(`Duplicate curated chat model: ${model.provider}/${model.modelId}`);
    }
    seenModelIds.add(key);

    if (model.modelId.trim().length === 0) {
      throw new Error('Curated chat model ID must not be empty');
    }
    if (model.contextTokens <= 0) {
      throw new Error(`Curated chat model context window must be positive: ${model.modelId}`);
    }
  }
}

export function findCuratedChatModel(
  provider: ChatProvider,
  modelId: string
): CuratedChatModel | undefined {
  return CURATED_CHAT_MODELS.find(
    (model) => model.provider === provider && model.modelId === modelId
  );
}

export function isCuratedChatModelId(provider: ChatProvider, modelId: string): boolean {
  return findCuratedChatModel(provider, modelId) !== undefined;
}

assertValidCuratedChatModelCatalog(CURATED_CHAT_MODELS);
