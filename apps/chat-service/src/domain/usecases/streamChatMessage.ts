import { err, getErrorMessage, type Clock } from '@fa/common-core';
import type {
  AnswerGapContextMessage,
  AnswerGapCoverageProbe,
  AnswerGapRequesterSnapshot,
  AnswerGapSource,
  ChatStreamEvent,
  RagAuthorizationContext,
} from '@fa/http-contracts';
import {
  chatReasoningEfforts,
  type ChatReasoningConfig,
  type ChatReasoningEffort,
  type ChatCompletionRequest,
  type ChatMessage,
  type ChatToolCall,
  type LlmChatProvider,
  type LlmProviderCallPolicy,
} from '@fa/llm-contract';

import {
  chatOutputStructuredOutput,
  parseChatOutput,
  recoverableChatOutputErrorKind,
  type ChatOutput,
} from '../runtime/chatOutput.js';
import { repairStructuredChatOutputMessages } from '../runtime/chatOutputRecovery.js';
import type { ConversationMessage } from '../models/chat.js';
import { chatAssistantPrompt, retrieveKnowledgeTool } from '../prompts/chatAssistantPrompt.js';
import {
  aggregateRagEvidence,
  type ChatContextMessage,
  type RagEvidence,
  type RagSource,
} from '../rag/rag.js';
import { ragEvidenceKey } from '../rag/evidenceKeys.js';
import type {
  ConversationMessageRepository,
  ConversationMessageWriteRepository,
  ConversationRepository,
} from '../repositories/chatRepositories.js';
import type { AnswerGapCandidateRepository } from '../repositories/answerGapCandidateRepository.js';
import {
  answerGapCandidateSummary,
  createPendingAnswerGapCandidate,
  type AnswerGapConsentWithdrawalSink,
  type AnswerGapCreateSink,
} from './answerGapCandidates.js';
import {
  listConversationMessages,
  persistAssistantMessage,
  persistUserMessage,
} from './messageUsecases.js';

export interface StreamChatMessageDeps {
  conversationRepository: ConversationRepository;
  messageRepository: ConversationMessageRepository;
  messageWriteRepository: ConversationMessageWriteRepository;
  ragSources: readonly RagSource[];
  answerGapCandidateRepository?: AnswerGapCandidateRepository;
  answerGapSink?: AnswerGapSink;
  chatProvider: LlmChatProvider;
  clock: Clock;
  generateId: () => string;
  chatProviderId: string;
  chatModel: string;
  streamWarningLogger?: { warn(obj: object, message?: string): void };
  traceSink?: ChatRuntimeTraceSink;
}

export type AnswerGapSink = AnswerGapCreateSink & Partial<AnswerGapConsentWithdrawalSink>;

export interface StreamChatMessageInput {
  authorization: RagAuthorizationContext;
  requester: AnswerGapRequesterSnapshot;
  conversationId: string;
  message: string;
  signal?: AbortSignal;
}

export interface ChatRuntimeTraceStep {
  name:
    | 'messages.load'
    | 'message.user.persist'
    | 'llm.decision'
    | 'knowledge.retrieve'
    | 'llm.answer_stream'
    | 'llm.final'
    | 'answer.parse'
    | 'message.assistant.persist'
    | 'answer_gap.capture';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  details: Record<string, unknown>;
}

export interface ChatRuntimeTraceSink {
  record(step: ChatRuntimeTraceStep): void;
}

const failedAnswerContent = 'Nie udało mi się dokończyć odpowiedzi. Spróbuj ponownie.';
const publicAnswerErrorMessage = 'Nie udało się wygenerować odpowiedzi. Spróbuj ponownie.';
const structuredAnswerMaxOutputTokens = 6144;
const answerGapMaxQuestionChars = 2_000;
const answerGapMaxContextMessages = 8;
const answerGapMaxContextMessageChars = 1_200;
const answerGapMaxMissingInformationItems = 8;
const answerGapMaxMissingInformationChars = 500;
const retrievalEvidenceLimit = 16;
const fallbackRetrievalContextMessages = 10;
const fallbackRetrievalContextMessageChars = 500;
const fallbackRetrievalQueryMaxChars = 4_000;
const defaultStructuredJsonReasoningEffort = 'minimal';
const retrievalTraceBundleContentChars = 1_000;
const transientLlmRetryPolicy = {
  maxRetries: 1,
  retryBackoffMs: ({ attempt }) => Math.min(500 * attempt, 1_000),
} satisfies LlmProviderCallPolicy;
const maxStructuredOutputRepairAttempts = 3;
const maxEmptyAnswerStreamAttempts = 2;
const currentFactScopeQuestionPattern =
  /\b(?:aktualn\p{L}*|bieżąc\p{L}*|biezac\p{L}*|dzisiaj|teraz|obecnie|przepis\p{L}*|praw\p{L}*|pzw|regulamin\p{L}*|okres\p{L}*\s+ochron\p{L}*|wymiar\p{L}*\s+ochron\p{L}*|limit\p{L}*|pozwol\p{L}*|zezwol\p{L}*|licencj\p{L}*|zakaz\p{L}*)\b/iu;
const currentFactScopeMissingInformationPattern =
  /\b(?:źród\p{L}*\s+prawn\p{L}*|zrodl\p{L}*\s+prawn\p{L}*|regulaminow\p{L}*|aktualn\p{L}*|bieżąc\p{L}*|biezac\p{L}*|przepis\p{L}*|praw\p{L}*|pzw|okres\p{L}*\s+ochron\p{L}*|wymiar\p{L}*\s+ochron\p{L}*|limit\p{L}*|pozwol\p{L}*|zezwol\p{L}*|licencj\p{L}*|zakaz\p{L}*)\b/iu;
const currentLegalEvidenceGapPattern =
  /\b(?:brak|nie\s+ma|missing|bez)\b[\s\S]{0,160}\b(?:aktualn\p{L}*|bieżąc\p{L}*|biezac\p{L}*|źród\p{L}*\s+prawn\p{L}*|zrodl\p{L}*\s+prawn\p{L}*|regulamin\p{L}*|przepis\p{L}*|praw\p{L}*|pzw|okres\p{L}*\s+ochron\p{L}*|wymiar\p{L}*\s+ochron\p{L}*|limit\p{L}*)\b/iu;
const currentLawSubjectPattern =
  /\b(?:aktualn\p{L}*|bieżąc\p{L}*|biezac\p{L}*|przepis\p{L}*|praw\p{L}*|pzw|regulamin\p{L}*|okres\p{L}*\s+ochron\p{L}*|wymiar\p{L}*\s+ochron\p{L}*|limit\p{L}*|zezwol\p{L}*|pozwol\p{L}*|licencj\p{L}*|zakaz\p{L}*)\b/iu;
const unsupportedCurrentLawSpecificPattern =
  /\b(?:od\s+\d{1,2}\s+\p{L}+(?:\s+do\s+\d{1,2}\s+\p{L}+)?)\b|\b\d{1,2}\s*(?:-|do)\s*\d{1,2}\s*(?:cm|szt\.?|sztuk)\b|\b\d{1,3}\s*(?:cm|szt\.?|sztuk)\b|\b(?:w\s+cał\p{L}*\s+kraj\p{L}*|standardow\p{L}*)\b/iu;
const currentLegalEvidenceGapNotice =
  'Nie mogę podać aktualnych przepisów, okresów ochronnych, wymiarów ani limitów, bo w Bazie Wiedzy brakuje aktualnego źródła prawnego lub regulaminowego dla tego łowiska.';
const defaultAnswerGapCoverageProbe: AnswerGapCoverageProbe = {
  classification: 'no_candidate_seen',
  minRequiredLevel: null,
  candidateCountBucket: '0',
  probeVersion: '1.0.0',
};

type RetrievalEvidenceSummary = NonNullable<ConversationMessage['retrieval']>['evidence'][number];

function configuredStructuredJsonReasoningEffort(): ChatReasoningEffort {
  const configuredEffort = process.env['FA_CHAT_STRUCTURED_REASONING_EFFORT']?.trim();
  return configuredEffort !== undefined &&
    (chatReasoningEfforts as readonly string[]).includes(configuredEffort)
    ? (configuredEffort as ChatReasoningEffort)
    : defaultStructuredJsonReasoningEffort;
}

function structuredJsonReasoning(): ChatReasoningConfig {
  return { effort: configuredStructuredJsonReasoningEffort(), exclude: true };
}

function normalizeAnswerForQuestion(answer: ChatOutput, question: string): ChatOutput {
  if (currentFactScopeQuestionPattern.test(question)) {
    if (!hasCurrentLegalEvidenceGap(answer)) {
      return answer;
    }

    const answerMarkdown = removeUnsupportedCurrentLawClaims(answer.answerMarkdown);
    return answerMarkdown === answer.answerMarkdown ? answer : { ...answer, answerMarkdown };
  }

  const missingInformation = answer.missingInformation.filter(
    (item) => !currentFactScopeMissingInformationPattern.test(item.description)
  );
  return missingInformation.length === answer.missingInformation.length
    ? answer
    : { ...answer, missingInformation };
}

function hasCurrentLegalEvidenceGap(answer: ChatOutput): boolean {
  return answer.missingInformation.some((item) =>
    currentLegalEvidenceGapPattern.test(item.description)
  );
}

function removeUnsupportedCurrentLawClaims(answerMarkdown: string): string {
  const paragraphs = answerMarkdown.split(/\n{2,}/u);
  const safeParagraphs = paragraphs.filter(
    (paragraph) =>
      !(
        currentLawSubjectPattern.test(paragraph) &&
        unsupportedCurrentLawSpecificPattern.test(paragraph)
      )
  );
  const cleaned = safeParagraphs.join('\n\n').trim();
  if (cleaned === answerMarkdown.trim()) {
    return answerMarkdown;
  }

  if (cleaned.length === 0 || !/\bnie\s+mog[ęe]\b[\s\S]{0,80}\b(?:podać|podac)\b/iu.test(cleaned)) {
    return [currentLegalEvidenceGapNotice, cleaned].filter((part) => part.length > 0).join('\n\n');
  }

  return cleaned;
}

function openRouterGenerationId(raw: unknown): string | null {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const value = (raw as Record<string, unknown>)['id'];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  return null;
}

function clipTraceText(value: string, maxChars: number): string {
  const compacted = value.replace(/\s+/gu, ' ').trim();
  if (compacted.length <= maxChars) {
    return compacted;
  }
  return `${compacted.slice(0, maxChars - 3).trimEnd()}...`;
}

function evidenceBundleTrace(evidence: readonly RagEvidence[]): Record<string, unknown>[] {
  return evidence.map((item, index) => ({
    alias: `S${String(index + 1)}`,
    id: item.id,
    sourceId: item.sourceId,
    title: item.title,
    path: item.metadata.path ?? [],
    headingPath: item.metadata.headingPath ?? [],
    score: item.score,
    quote: clipTraceText(item.quote, 320),
    contentPreview: clipTraceText(item.content, retrievalTraceBundleContentChars),
  }));
}

async function traced<T>(
  deps: StreamChatMessageDeps,
  name: ChatRuntimeTraceStep['name'],
  details: Record<string, unknown>,
  action: () => Promise<T>
): Promise<T> {
  const startedAtDate = deps.clock.now();
  const startedAt = startedAtDate.toISOString();
  const monotonicStartedAt = globalThis.performance.now();
  try {
    return await action();
  } finally {
    const completedAt = deps.clock.now().toISOString();
    deps.traceSink?.record({
      name,
      startedAt,
      completedAt,
      durationMs: Math.max(0, globalThis.performance.now() - monotonicStartedAt),
      details,
    });
  }
}

function requireApprovedRagAuthorization(
  authorization: RagAuthorizationContext | undefined
): RagAuthorizationContext {
  if (authorization === undefined || authorization.userId.trim().length === 0) {
    throw new Error('streamChatMessage requires approved RAG authorization');
  }

  return authorization;
}

function clipText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

function chatContext(messages: readonly ConversationMessage[]): ChatContextMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.citations.length > 0 ? { citations: message.citations } : {}),
  }));
}

function answerGapContextWindow(input: {
  priorContext: readonly ChatContextMessage[];
  currentQuestion: string;
}): AnswerGapContextMessage[] {
  const priorMessages = input.priorContext
    .slice(-(answerGapMaxContextMessages - 1))
    .map((message) => ({
      role: message.role,
      content: clipText(message.content, answerGapMaxContextMessageChars),
    }));

  return [
    ...priorMessages,
    {
      role: 'user',
      content: clipText(input.currentQuestion, answerGapMaxContextMessageChars),
    },
  ];
}

function clippedMissingInformation(items: readonly string[]): string[] {
  return items
    .filter((item) => item.trim().length > 0)
    .slice(0, answerGapMaxMissingInformationItems)
    .map((item) => clipText(item, answerGapMaxMissingInformationChars));
}

function assistantPromptVersions(): NonNullable<ConversationMessage['promptVersions']> {
  return {
    answer: {
      name: chatAssistantPrompt.name,
      version: chatAssistantPrompt.version,
    },
  };
}

function providerRequest(input: {
  userId: string;
  provider: string;
  model: string;
  messages: ChatMessage[];
  conversationId: string;
  assistantMessageId: string;
  signal?: AbortSignal;
  withTools?: boolean;
  withStructuredOutput?: boolean;
  maxOutputTokens?: number;
}): ChatCompletionRequest {
  return {
    provider: input.provider,
    model: input.model,
    messages: input.messages,
    temperature: 0.2,
    maxOutputTokens: input.maxOutputTokens ?? structuredAnswerMaxOutputTokens,
    ...(input.withTools === true
      ? { tools: [retrieveKnowledgeTool], toolChoice: 'auto' as const }
      : {}),
    ...(input.withStructuredOutput === true
      ? {
          structuredOutput: chatOutputStructuredOutput,
          reasoning: structuredJsonReasoning(),
        }
      : {}),
    owner: { type: 'user', id: input.userId },
    promptType: chatAssistantPrompt.name,
    promptVersion: chatAssistantPrompt.version,
    sessionId: input.conversationId,
    providerCallPolicy: transientLlmRetryPolicy,
    correlation: {
      conversationId: input.conversationId,
      messageId: input.assistantMessageId,
    },
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  };
}

function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function retrievalQueryFromToolCall(toolCall: ChatToolCall, fallbackQuery: string): string {
  const parsed = parseToolArguments(toolCall.function.arguments);
  const query = parsed['query'];
  return typeof query === 'string' && query.trim().length > 0 ? query.trim() : fallbackQuery;
}

function firstRetrieveKnowledgeCall(response: {
  toolCalls?: readonly ChatToolCall[];
}): ChatToolCall | undefined {
  return response.toolCalls?.find(
    (toolCall) => toolCall.function.name === chatAssistantPrompt.retrieveKnowledgeToolName
  );
}

const lightweightInteractionPatterns = [
  /^(cześć|czesc|hej|hello|hi|siema|dzień dobry|dzien dobry)[!.?\s]*$/iu,
  /^(ok|okej|tak|nie|yes|no|dzięki|dzieki|thanks|thank you)[!.?\s]*$/iu,
];

const factualRequestPattern =
  /^(jak|co|czym|kiedy|ile|dlaczego|gdzie|który|ktory|jaki|jaka|jakie|czy|podaj|daj|podsumuj|streść|stresc|streszcz|przypomnij|przypomnieć|przypomniec|przypomnijmy|porównaj|porownaj|wyjaśnij|wyjasnij|opisz|dobierz|wybierz|poleć|polec|ułóż|uloz|złóż|zloz|zrób|zrob|przygotuj|zaproponuj)(?=$|[^\p{L}\p{N}_])/iu;

function isLightweightInteraction(question: string): boolean {
  const trimmed = question.trim();
  return (
    trimmed.length <= 40 && lightweightInteractionPatterns.some((pattern) => pattern.test(trimmed))
  );
}

function shouldFallbackRetrieve(input: { question: string; decisionText: string }): boolean {
  void input.decisionText;
  const question = input.question.trim();
  if (question.length === 0 || isLightweightInteraction(question)) {
    return false;
  }

  return question.includes('?') || factualRequestPattern.test(question);
}

function userAuthoredContextLines(latestMessages: readonly ChatContextMessage[]): string[] {
  return latestMessages
    .filter((message) => message.role === 'user')
    .slice(-fallbackRetrievalContextMessages)
    .map((message) => {
      return `Użytkownik: ${clipText(message.content, fallbackRetrievalContextMessageChars)}`;
    })
    .filter((line) => line.trim().length > 0);
}

function contextualRetrievalQuery(input: {
  question: string;
  retrievalQuery?: string | undefined;
  latestMessages: readonly ChatContextMessage[];
}): string {
  const question = input.question.trim();
  const retrievalQuery = input.retrievalQuery?.trim() ?? question;
  const userContext = userAuthoredContextLines(input.latestMessages);
  const queryLines =
    retrievalQuery === question
      ? [`Bieżące pytanie: ${question}`]
      : [`Bieżące pytanie: ${question}`, `Zapytanie wyszukiwawcze modelu: ${retrievalQuery}`];
  if (userContext.length === 0) {
    return retrievalQuery;
  }

  return clipText(
    [
      ...queryLines,
      'Wcześniejsze pytania użytkownika jako kontekst nazw, tematów, produktów, gatunków, metod, zakresów i ograniczeń:',
      ...userContext,
    ].join('\n'),
    fallbackRetrievalQueryMaxChars
  );
}

function fallbackRetrieveKnowledgeCall(input: {
  assistantMessageId: string;
  query: string;
  latestMessages: readonly ChatContextMessage[];
}): ChatToolCall {
  return {
    id: `${input.assistantMessageId}:fallback-retrieveKnowledge`,
    type: 'function',
    function: {
      name: chatAssistantPrompt.retrieveKnowledgeToolName,
      arguments: JSON.stringify({
        query: contextualRetrievalQuery({
          question: input.query,
          latestMessages: input.latestMessages,
        }),
      }),
    },
  };
}

function finalizedAnswerContent(input: { answer: ChatOutput }): string {
  return input.answer.answerMarkdown;
}

function retrievalSummaryKey(evidence: RetrievalEvidenceSummary): string {
  return `${evidence.sourceId}\u0000${evidence.id}`;
}

function citationEvidence(input: {
  retrieval: ConversationMessage['retrieval'];
  citation: ConversationMessage['citations'][number];
}): RetrievalEvidenceSummary | undefined {
  return input.retrieval?.evidence.find(
    (evidence) =>
      input.citation.sourceId === retrievalSummaryKey(evidence) ||
      input.citation.sourceId === evidence.id
  );
}

async function createAnswerGapCandidateIfNeeded(input: {
  deps: StreamChatMessageDeps;
  source: AnswerGapSource;
  question: string;
  missingInformation: readonly string[];
  requester: AnswerGapRequesterSnapshot;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  priorContext: readonly ChatContextMessage[];
  coverageProbe: AnswerGapCoverageProbe | undefined;
}): Promise<Extract<ChatStreamEvent, { type: 'answer.gap_candidate' }> | null> {
  if (
    input.deps.answerGapCandidateRepository === undefined ||
    input.missingInformation.length === 0
  ) {
    return null;
  }

  try {
    const result = await createPendingAnswerGapCandidate(
      {
        repository: input.deps.answerGapCandidateRepository,
        clock: input.deps.clock,
      },
      {
        source: input.source,
        question: clipText(input.question, answerGapMaxQuestionChars),
        missingInformation: clippedMissingInformation(input.missingInformation),
        requester: input.requester,
        conversation: {
          conversationId: input.conversationId,
          userMessageId: input.userMessageId,
          assistantMessageId: input.assistantMessageId,
          contextWindow: answerGapContextWindow({
            priorContext: input.priorContext,
            currentQuestion: input.question,
          }),
        },
        coverageProbe: input.coverageProbe ?? defaultAnswerGapCoverageProbe,
      }
    );
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    if (result.value.candidate === null) {
      return null;
    }

    return {
      type: 'answer.gap_candidate',
      data: { candidate: answerGapCandidateSummary(result.value.candidate) },
    };
  } catch (error) {
    input.deps.streamWarningLogger?.warn(
      {
        event: 'answer_gap_candidate_create_failed',
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        source: input.source,
        errorMessage: getErrorMessage(error),
      },
      'answer gap candidate create failed'
    );
    return null;
  }
}

async function persistFailedAssistant(input: {
  deps: StreamChatMessageDeps;
  userId: string;
  conversationId: string;
  assistantMessageId: string;
  errorMessage: string;
}): Promise<ConversationMessage | undefined> {
  const persisted = await persistAssistantMessage(
    {
      conversationRepository: input.deps.conversationRepository,
      messageRepository: input.deps.messageRepository,
      messageWriteRepository: input.deps.messageWriteRepository,
      clock: input.deps.clock,
      generateId: input.deps.generateId,
    },
    {
      id: input.assistantMessageId,
      userId: input.userId,
      conversationId: input.conversationId,
      role: 'assistant',
      content: failedAnswerContent,
      createdAt: input.deps.clock.now().toISOString(),
      modelId: input.deps.chatModel,
      citations: [],
      missingInformation: [],
      promptVersions: assistantPromptVersions(),
      streamStatus: 'failed',
      errorMessage: input.errorMessage,
    }
  );

  return persisted.ok ? persisted.value : undefined;
}

export async function* streamChatMessage(
  deps: StreamChatMessageDeps,
  input: StreamChatMessageInput
): AsyncGenerator<ChatStreamEvent> {
  const authorization = requireApprovedRagAuthorization(input.authorization);
  const priorMessages = await traced(
    deps,
    'messages.load',
    { conversationId: input.conversationId, userId: authorization.userId },
    async () =>
      await listConversationMessages(
        {
          conversationRepository: deps.conversationRepository,
          messageRepository: deps.messageRepository,
        },
        { userId: authorization.userId, conversationId: input.conversationId }
      )
  );
  if (!priorMessages.ok) {
    yield { type: 'error', data: { message: priorMessages.error.message } };
    return;
  }

  const priorContext = chatContext(priorMessages.value);
  const userMessage = await traced(
    deps,
    'message.user.persist',
    { conversationId: input.conversationId, userId: authorization.userId },
    async () =>
      await persistUserMessage(
        {
          conversationRepository: deps.conversationRepository,
          messageRepository: deps.messageRepository,
          messageWriteRepository: deps.messageWriteRepository,
          clock: deps.clock,
          generateId: deps.generateId,
        },
        {
          userId: authorization.userId,
          conversationId: input.conversationId,
          content: input.message,
        }
      )
  );
  if (!userMessage.ok) {
    yield { type: 'error', data: { message: userMessage.error.message } };
    return;
  }

  yield { type: 'message.created', data: userMessage.value };

  const assistantMessageId = deps.generateId();
  let retrieval: ConversationMessage['retrieval'];
  let sourceAliases = new Map<string, string>();
  let answerToolCall: ChatToolCall | undefined;
  let answerToolResultContent: string | undefined;
  let answerStreamAttemptCount = 0;
  let lastAnswerStreamTraceDetails: Record<string, unknown> | undefined;

  async function parseOrRepairAnswer(parseInput: {
    answerText: string;
    sourceAliases: ReadonlyMap<string, string>;
    parseTraceDetails: Record<string, unknown>;
  }): Promise<ReturnType<typeof parseChatOutput>> {
    const attempts: Record<string, unknown>[] = [];
    let currentAnswerText = parseInput.answerText;

    for (let attempt = 1; attempt <= maxStructuredOutputRepairAttempts; attempt += 1) {
      const parsed = parseChatOutput(currentAnswerText, {
        sourceAliases: parseInput.sourceAliases,
      });
      attempts.push({
        attempt,
        ok: parsed.ok,
        errorMessage: parsed.ok ? undefined : parsed.error.message,
      });

      if (parsed.ok) {
        parseInput.parseTraceDetails['attempts'] = attempts;
        return parsed;
      }

      const recoverableKind = recoverableChatOutputErrorKind(parsed.error.message);
      if (recoverableKind === null || attempt >= maxStructuredOutputRepairAttempts) {
        parseInput.parseTraceDetails['attempts'] = attempts;
        if (attempt >= maxStructuredOutputRepairAttempts) {
          parseInput.parseTraceDetails['recoveryExhausted'] = true;
        }
        return parsed;
      }

      const repairAttempt = attempt + 1;
      const repairTraceDetails: Record<string, unknown> = {
        attempt: repairAttempt,
        retryReason: 'parse_error',
        parseErrorMessage: parsed.error.message,
        recoverableKind,
        model: deps.chatModel,
      };
      const repairResponse = await traced(deps, 'llm.final', repairTraceDetails, async () => {
        const response = await deps.chatProvider.complete(
          providerRequest({
            userId: authorization.userId,
            provider: deps.chatProviderId,
            model: deps.chatModel,
            messages: repairStructuredChatOutputMessages({
              parseErrorMessage: parsed.error.message,
              malformedOutput: currentAnswerText,
            }),
            conversationId: input.conversationId,
            assistantMessageId,
            withStructuredOutput: true,
            ...(input.signal !== undefined ? { signal: input.signal } : {}),
          })
        );
        repairTraceDetails['finishReason'] = response.finishReason ?? null;
        repairTraceDetails['outputTokens'] = response.usage.outputTokens;
        repairTraceDetails['inputTokens'] = response.usage.inputTokens;
        repairTraceDetails['generationId'] = openRouterGenerationId(response.raw);
        return response;
      });

      if (repairResponse.finishReason === 'length') {
        const repairLengthErrorMessage =
          'repair response hit length limit after exhausted recovery';
        attempts.push({
          attempt: repairAttempt,
          ok: false,
          errorMessage: repairLengthErrorMessage,
        });
        parseInput.parseTraceDetails['attempts'] = attempts;
        parseInput.parseTraceDetails['recoveryExhausted'] = true;
        return err({
          code: 'INVALID_OUTPUT',
          message: repairLengthErrorMessage,
        });
      }

      currentAnswerText = repairResponse.text;
    }

    parseInput.parseTraceDetails['attempts'] = attempts;
    parseInput.parseTraceDetails['recoveryExhausted'] = true;
    return err({
      code: 'INVALID_OUTPUT',
      message: 'structured output repair attempts exhausted',
    });
  }

  try {
    const decisionMessages = chatAssistantPrompt.buildDecisionMessages({
      question: userMessage.value.content,
      latestMessages: priorContext,
      now: deps.clock.now(),
    });
    const decisionTraceDetails: Record<string, unknown> = {
      model: deps.chatModel,
      promptType: chatAssistantPrompt.name,
      promptVersion: chatAssistantPrompt.version,
      tools: [chatAssistantPrompt.retrieveKnowledgeToolName],
    };
    const decisionResponse = await traced(deps, 'llm.decision', decisionTraceDetails, async () => {
      const response = await deps.chatProvider.complete(
        providerRequest({
          userId: authorization.userId,
          provider: deps.chatProviderId,
          model: deps.chatModel,
          messages: decisionMessages,
          conversationId: input.conversationId,
          assistantMessageId,
          withTools: true,
          ...(input.signal !== undefined ? { signal: input.signal } : {}),
        })
      );
      decisionTraceDetails['finishReason'] = response.finishReason ?? null;
      decisionTraceDetails['toolCallCount'] = response.toolCalls?.length ?? 0;
      decisionTraceDetails['toolCallNames'] =
        response.toolCalls?.map((toolCall) => toolCall.function.name) ?? [];
      decisionTraceDetails['outputTokens'] = response.usage.outputTokens;
      decisionTraceDetails['inputTokens'] = response.usage.inputTokens;
      decisionTraceDetails['generationId'] = openRouterGenerationId(response.raw);
      return response;
    });

    const modelToolCall = firstRetrieveKnowledgeCall(decisionResponse);
    const fallbackToolCall =
      modelToolCall === undefined &&
      shouldFallbackRetrieve({
        question: userMessage.value.content,
        decisionText: decisionResponse.text,
      })
        ? fallbackRetrieveKnowledgeCall({
            assistantMessageId,
            query: userMessage.value.content,
            latestMessages: priorContext,
          })
        : undefined;
    const toolCall = modelToolCall ?? fallbackToolCall;
    const retrievalDecisionSource =
      modelToolCall !== undefined
        ? 'model_tool_call'
        : fallbackToolCall !== undefined
          ? 'fallback_current_query'
          : 'none';
    let answerResponseText = '';

    if (toolCall !== undefined) {
      const modelRequestedRetrievalQuery = retrievalQueryFromToolCall(
        toolCall,
        userMessage.value.content
      );
      const retrievalQuery =
        modelToolCall === undefined
          ? modelRequestedRetrievalQuery
          : contextualRetrievalQuery({
              question: userMessage.value.content,
              retrievalQuery: modelRequestedRetrievalQuery,
              latestMessages: priorContext,
            });
      yield {
        type: 'retrieval.started',
        data: { conversationId: input.conversationId, query: retrievalQuery },
      };

      const retrievalTraceDetails: Record<string, unknown> = {
        query: retrievalQuery,
        maxEvidenceItems: retrievalEvidenceLimit,
        decisionSource: retrievalDecisionSource,
        modelRequestedQuery: modelRequestedRetrievalQuery,
        querySource:
          modelToolCall !== undefined
            ? retrievalQuery === modelRequestedRetrievalQuery
              ? 'model_tool_query'
              : 'model_tool_query_with_user_context'
            : 'fallback_context_query',
      };
      const retrievalResult = await traced(
        deps,
        'knowledge.retrieve',
        retrievalTraceDetails,
        async () => {
          const result = await aggregateRagEvidence(
            { sources: deps.ragSources, clock: deps.clock },
            {
              authorization,
              query: retrievalQuery,
              conversationId: input.conversationId,
              messageId: userMessage.value.id,
              latestMessages: priorContext,
              limits: { maxEvidenceItems: retrievalEvidenceLimit },
              ...(input.signal !== undefined ? { signal: input.signal } : {}),
            }
          );
          if (result.ok) {
            retrievalTraceDetails['evidenceCount'] = result.value.evidence.length;
            retrievalTraceDetails['coverageProbe'] = result.value.coverageProbe ?? null;
            retrievalTraceDetails['sources'] = result.value.trace.sources.map((source) => ({
              sourceId: source.sourceId,
              status: source.status,
              itemCount: source.itemCount,
              ...(source.performance === undefined ? {} : { performance: source.performance }),
            }));
            retrievalTraceDetails['evidenceBundles'] = evidenceBundleTrace(result.value.evidence);
          }
          return result;
        }
      );
      if (!retrievalResult.ok) {
        throw new Error(retrievalResult.error.message);
      }

      retrieval = retrievalResult.value.trace;
      yield {
        type: 'retrieval.completed',
        data: {
          sourceCounts: retrieval.sources.map((source) => ({
            sourceId: source.sourceId,
            status: source.status,
            itemCount: source.itemCount,
          })),
          topEvidenceIds: retrievalResult.value.evidence.map((item) => ragEvidenceKey(item)),
        },
      };

      const toolResult = chatAssistantPrompt.buildToolResult({
        query: retrievalQuery,
        evidence: retrievalResult.value.evidence,
      });
      sourceAliases = toolResult.aliases;
      answerToolCall = toolCall;
      answerToolResultContent = toolResult.content;
    }

    yield {
      type: 'answer.started',
      data: { conversationId: input.conversationId, messageId: assistantMessageId },
    };

    const answerMessages = chatAssistantPrompt.buildStreamingAnswerMessages({
      question: userMessage.value.content,
      latestMessages: priorContext,
      now: deps.clock.now(),
      ...(answerToolCall !== undefined && answerToolResultContent !== undefined
        ? { toolCall: answerToolCall, toolResultContent: answerToolResultContent }
        : {}),
    });
    let streamedAnswerText = '';
    for (let attempt = 1; attempt <= maxEmptyAnswerStreamAttempts; attempt += 1) {
      answerStreamAttemptCount = attempt;
      const answerStreamTraceDetails: Record<string, unknown> = {
        model: deps.chatModel,
        promptType: chatAssistantPrompt.name,
        promptVersion: chatAssistantPrompt.version,
        sourceAliasCount: sourceAliases.size,
        attempt,
        ...(attempt > 1 ? { retryReason: 'empty_stream' } : {}),
      };
      const answerStreamStartedAtDate = deps.clock.now();
      const answerStreamStartedAt = answerStreamStartedAtDate.toISOString();
      const answerStreamMonotonicStartedAt = globalThis.performance.now();
      let attemptAnswerText = '';
      try {
        for await (const streamEvent of deps.chatProvider.stream(
          providerRequest({
            userId: authorization.userId,
            provider: deps.chatProviderId,
            model: deps.chatModel,
            messages: answerMessages,
            conversationId: input.conversationId,
            assistantMessageId,
            ...(input.signal !== undefined ? { signal: input.signal } : {}),
          })
        )) {
          if (streamEvent.type === 'text_delta') {
            if (streamEvent.text.length === 0) {
              continue;
            }
            attemptAnswerText += streamEvent.text;
            yield { type: 'answer.delta', data: { text: streamEvent.text } };
            continue;
          }

          answerStreamTraceDetails['finishReason'] = streamEvent.response.finishReason ?? null;
          answerStreamTraceDetails['outputTokens'] = streamEvent.response.usage.outputTokens;
          answerStreamTraceDetails['inputTokens'] = streamEvent.response.usage.inputTokens;
          answerStreamTraceDetails['generationId'] = openRouterGenerationId(
            streamEvent.response.raw
          );
          if (attemptAnswerText.length === 0 && streamEvent.response.text.length > 0) {
            attemptAnswerText = streamEvent.response.text;
            yield { type: 'answer.delta', data: { text: streamEvent.response.text } };
          }
        }
      } finally {
        lastAnswerStreamTraceDetails = answerStreamTraceDetails;
        deps.traceSink?.record({
          name: 'llm.answer_stream',
          startedAt: answerStreamStartedAt,
          completedAt: deps.clock.now().toISOString(),
          durationMs: Math.max(0, globalThis.performance.now() - answerStreamMonotonicStartedAt),
          details: answerStreamTraceDetails,
        });
      }

      if (attemptAnswerText.trim().length > 0) {
        streamedAnswerText = attemptAnswerText;
        break;
      }
    }

    if (streamedAnswerText.trim().length === 0) {
      throw new Error('streamed answer was empty');
    }

    yield { type: 'answer.progress', data: { status: 'preparing_sources' } };

    const metadataMessages = chatAssistantPrompt.buildMetadataMessages({
      question: userMessage.value.content,
      latestMessages: priorContext,
      now: deps.clock.now(),
      answerMarkdown: streamedAnswerText,
      ...(answerToolCall !== undefined && answerToolResultContent !== undefined
        ? { toolCall: answerToolCall, toolResultContent: answerToolResultContent }
        : {}),
    });
    const finalTraceDetails: Record<string, unknown> = {
      model: deps.chatModel,
      promptType: chatAssistantPrompt.name,
      promptVersion: chatAssistantPrompt.version,
      structuredOutput: chatOutputStructuredOutput.type,
      reasoningEffort: configuredStructuredJsonReasoningEffort(),
      sourceAliasCount: sourceAliases.size,
    };
    const finalResponse = await traced(deps, 'llm.final', finalTraceDetails, async () => {
      const response = await deps.chatProvider.complete(
        providerRequest({
          userId: authorization.userId,
          provider: deps.chatProviderId,
          model: deps.chatModel,
          messages: metadataMessages,
          conversationId: input.conversationId,
          assistantMessageId,
          withStructuredOutput: true,
          ...(input.signal !== undefined ? { signal: input.signal } : {}),
        })
      );
      finalTraceDetails['finishReason'] = response.finishReason ?? null;
      finalTraceDetails['outputTokens'] = response.usage.outputTokens;
      finalTraceDetails['inputTokens'] = response.usage.inputTokens;
      finalTraceDetails['generationId'] = openRouterGenerationId(response.raw);
      return response;
    });
    answerResponseText = finalResponse.text;

    const parseTraceDetails: Record<string, unknown> = {
      sourceAliasCount: sourceAliases.size,
    };
    const parsedAnswer = await traced(deps, 'answer.parse', parseTraceDetails, async () => {
      const result = await parseOrRepairAnswer({
        answerText: answerResponseText,
        sourceAliases,
        parseTraceDetails,
      });
      const attempts = Array.isArray(parseTraceDetails['attempts'])
        ? (parseTraceDetails['attempts'] as Record<string, unknown>[])
        : [];
      parseTraceDetails['attemptCount'] = attempts.length;
      parseTraceDetails['ok'] = result.ok;
      if (result.ok) {
        parseTraceDetails['confidence'] = result.value.confidence;
        parseTraceDetails['usedSourceCount'] = result.value.usedSources.length;
        parseTraceDetails['missingInformationCount'] = result.value.missingInformation.length;
      } else {
        parseTraceDetails['errorMessage'] = result.error.message;
      }
      return result;
    });
    const answer: ChatOutput = parsedAnswer.ok
      ? normalizeAnswerForQuestion(
          { ...parsedAnswer.value, answerMarkdown: streamedAnswerText },
          userMessage.value.content
        )
      : {
          answerMarkdown: streamedAnswerText,
          confidence: 'low',
          usedSources: [],
          missingInformation: [],
          followUpQuestions: [],
        };
    if (!parsedAnswer.ok) {
      deps.streamWarningLogger?.warn(
        {
          event: 'chat_answer_metadata_parse_failed',
          conversationId: input.conversationId,
          assistantMessageId,
          errorMessage: parsedAnswer.error.message,
        },
        'chat answer metadata parse failed'
      );
    }
    const missingInformation = answer.missingInformation.map((item) => item.description);
    const answerContent = finalizedAnswerContent({
      answer,
    });
    const assistantMessage: ConversationMessage = {
      id: assistantMessageId,
      userId: authorization.userId,
      conversationId: input.conversationId,
      role: 'assistant',
      content: answerContent,
      createdAt: deps.clock.now().toISOString(),
      modelId: deps.chatModel,
      confidence: answer.confidence,
      citations: answer.usedSources,
      missingInformation,
      promptVersions: assistantPromptVersions(),
      ...(retrieval !== undefined ? { retrieval } : {}),
      streamStatus: 'completed',
    };

    const persistedAssistant = await traced(
      deps,
      'message.assistant.persist',
      { conversationId: input.conversationId, assistantMessageId },
      async () =>
        await persistAssistantMessage(
          {
            conversationRepository: deps.conversationRepository,
            messageRepository: deps.messageRepository,
            messageWriteRepository: deps.messageWriteRepository,
            clock: deps.clock,
            generateId: deps.generateId,
          },
          assistantMessage
        )
    );
    if (!persistedAssistant.ok) {
      throw new Error(persistedAssistant.error.message);
    }

    for (const citation of persistedAssistant.value.citations) {
      const evidence =
        retrieval === undefined ? undefined : citationEvidence({ retrieval, citation });
      yield {
        type: 'answer.citation',
        data: {
          citation,
          ...(evidence === undefined ? {} : { evidence }),
        },
      };
    }

    if (persistedAssistant.value.missingInformation.length > 0) {
      yield {
        type: 'answer.missing_info',
        data: { missingInformation: persistedAssistant.value.missingInformation },
      };
    }

    const missingForAdmin = answer.missingInformation
      .filter((item) => item.saveForAdmin)
      .map((item) => item.description);
    const answerGapCandidateEvent = await traced(
      deps,
      'answer_gap.capture',
      { missingInformationCount: missingForAdmin.length },
      async () => {
        return await createAnswerGapCandidateIfNeeded({
          deps,
          source:
            retrieval === undefined || retrieval.evidence.length === 0
              ? 'no_accessible_evidence'
              : 'unsupported_by_retrieved_evidence',
          question: userMessage.value.content,
          missingInformation: missingForAdmin,
          requester: input.requester,
          conversationId: input.conversationId,
          userMessageId: userMessage.value.id,
          assistantMessageId: persistedAssistant.value.id,
          priorContext,
          coverageProbe: retrieval?.coverageProbe,
        });
      }
    );
    if (answerGapCandidateEvent !== null) {
      yield answerGapCandidateEvent;
    }

    yield { type: 'answer.final', data: persistedAssistant.value };
    yield { type: 'done', data: { ok: true } };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    deps.streamWarningLogger?.warn(
      {
        event: 'chat_answer_failed',
        conversationId: input.conversationId,
        assistantMessageId,
        errorMessage,
        chatProviderId: deps.chatProviderId,
        chatModel: deps.chatModel,
        answerStreamAttemptCount,
        ...(lastAnswerStreamTraceDetails === undefined
          ? {}
          : {
              lastAnswerStreamFinishReason: lastAnswerStreamTraceDetails['finishReason'] ?? null,
              lastAnswerStreamInputTokens: lastAnswerStreamTraceDetails['inputTokens'] ?? null,
              lastAnswerStreamOutputTokens: lastAnswerStreamTraceDetails['outputTokens'] ?? null,
              lastAnswerStreamGenerationId: lastAnswerStreamTraceDetails['generationId'] ?? null,
            }),
      },
      'chat answer failed'
    );
    const failedAssistant = await persistFailedAssistant({
      deps,
      userId: authorization.userId,
      conversationId: input.conversationId,
      assistantMessageId,
      errorMessage,
    });
    if (failedAssistant !== undefined) {
      yield { type: 'answer.final', data: failedAssistant };
    }
    yield { type: 'error', data: { message: publicAnswerErrorMessage } };
  }
}
