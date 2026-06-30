import { describe, expect, it } from 'vitest';

import { ok, type Clock, type Result } from '@fa/common-core';
import type {
  AnswerGapRequesterSnapshot,
  ChatStreamEvent,
  RagAuthorizationContext,
} from '@fa/http-contracts';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionStreamEvent,
  LlmChatProvider,
} from '@fa/llm-contract';

import {
  MemoryConversationMessageRepository,
  MemoryConversationMessageWriteRepository,
  MemoryConversationRepository,
} from '../../infra/memory/memoryChatRepositories.js';
import { MemoryAnswerGapCandidateRepository } from '../../infra/memory/memoryAnswerGapCandidateRepository.js';
import type { ConversationMessage } from '../models/chat.js';
import type { AnswerGapCandidateRepository } from '../repositories/answerGapCandidateRepository.js';
import type {
  RagEvidence,
  RagQuery,
  RagSource,
  RagSourceError,
  RagSourceResult,
} from '../rag/rag.js';
import { createConversation } from './conversationUsecases.js';
import { streamChatMessage } from './streamChatMessage.js';

const clock: Clock = {
  now: () => new Date('2026-06-24T12:00:00.000Z'),
};

const authorization: RagAuthorizationContext = {
  userId: 'user-1',
  role: 'user',
  status: 'approved',
  effectiveLevel: 7,
};

const requester: AnswerGapRequesterSnapshot = {
  userId: 'user-1',
  email: 'stream-test@example.com',
  role: 'user',
  effectiveLevel: 7,
};

function ids(values: string[]): () => string {
  const next = [...values];
  return () => next.shift() ?? 'extra-id';
}

function chatResponse(input: Partial<ChatCompletionResponse>): ChatCompletionResponse {
  return {
    provider: 'fake',
    model: 'fake-model',
    text: '',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: false },
    ...input,
  };
}

class RecordingChatProvider implements LlmChatProvider {
  readonly requests: ChatCompletionRequest[] = [];
  readonly streamRequests: ChatCompletionRequest[] = [];

  constructor(
    private readonly responses?: readonly ChatCompletionResponse[],
    private readonly streamEvents?: readonly ChatCompletionStreamEvent[]
  ) {}

  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.requests.push(request);
    const scriptedResponse = this.responses?.[this.requests.length - 1];
    if (scriptedResponse !== undefined) {
      return Promise.resolve(scriptedResponse);
    }

    if (this.requests.length === 1) {
      return Promise.resolve(
        chatResponse({
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: 'tool-call-1',
              type: 'function',
              function: {
                name: 'retrieveKnowledge',
                arguments: JSON.stringify({ query: 'condition A instead of condition B delta' }),
              },
            },
          ],
        })
      );
    }

    return Promise.resolve(
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown:
            'Zmienia sie punkt zaczepienia: warunek A zmienia wybor, wiec zamiast wariantu B uzyj neutralnego opisu testowego. [S1]',
          confidence: 'high',
          usedSources: [{ sourceId: 'S1', usedFor: 'hard-bottom bait signal shift' }],
          missingInformation: [],
          followUpQuestions: [],
        }),
      })
    );
  }

  async *stream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamEvent> {
    this.streamRequests.push(request);
    await Promise.resolve();
    if (this.streamEvents !== undefined) {
      yield* this.streamEvents;
      return;
    }

    const nextMetadataResponse = this.responses?.[this.requests.length];
    const text =
      answerMarkdownFromResponse(nextMetadataResponse) ??
      'Zmienia sie punkt zaczepienia: warunek A zmienia wybor, wiec zamiast wariantu B uzyj neutralnego opisu testowego. [S1]';
    yield { type: 'text_delta', text: text.slice(0, 35) };
    yield { type: 'text_delta', text: text.slice(35) };
    yield {
      type: 'done',
      response: chatResponse({
        finishReason: 'stop',
        text,
      }),
    };
  }
}

function answerMarkdownFromResponse(
  response: ChatCompletionResponse | undefined
): string | undefined {
  if (response === undefined || response.text.trim().length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(response.text) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const answerMarkdown = (parsed as Record<string, unknown>)['answerMarkdown'];
      return typeof answerMarkdown === 'string' && answerMarkdown.length > 0
        ? answerMarkdown
        : undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

const hardFixtureEvidence: RagEvidence = {
  id: 'hard-bottom-bundle',
  sourceId: 'knowledge-service',
  sourceType: 'knowledge_page',
  title: 'Synthetic condition comparison',
  quote:
    'Condition A changes the fixture interpretation: factor one and factor two are natural leads.',
  content:
    'If condition A appears instead of condition B, do not answer with the default fixture. Condition A strengthens factor one, factor two, and factor three.',
  score: 9,
  metadata: {
    headingPath: ['Fixture', 'Condition A'],
    path: ['Knowledge Base', 'Test scenarios'],
  },
};

const ragSource: RagSource = {
  id: 'knowledge-service',
  label: 'Knowledge Service',
  retrieve(_input: RagQuery): Promise<Result<RagSourceResult, RagSourceError>> {
    return Promise.resolve(
      ok({
        sourceId: 'knowledge-service',
        items: [hardFixtureEvidence],
        coverageProbe: {
          classification: 'accessible_candidate_seen',
          minRequiredLevel: null,
          candidateCountBucket: '1',
          probeVersion: '1.0.0',
        },
        diagnostics: {},
      })
    );
  },
};

async function collectStream(
  input: Parameters<typeof streamChatMessage>[1],
  options: {
    chatProvider?: RecordingChatProvider;
    ragSources?: readonly RagSource[];
    seedPriorMessages?: boolean;
    answerGapCandidateRepository?: AnswerGapCandidateRepository;
    traceSteps?: import('./streamChatMessage.js').ChatRuntimeTraceStep[];
  } = {}
) {
  const conversationRepository = new MemoryConversationRepository();
  const messageRepository = new MemoryConversationMessageRepository();
  const messageWriteRepository = new MemoryConversationMessageWriteRepository(
    conversationRepository,
    messageRepository
  );
  const chatProvider = options.chatProvider ?? new RecordingChatProvider();

  await createConversation(
    { conversationRepository, clock, generateId: ids(['conversation-1']) },
    { userId: authorization.userId }
  );
  if (options.seedPriorMessages !== false) {
    await messageRepository.create({
      id: 'prior-user',
      userId: authorization.userId,
      conversationId: input.conversationId,
      role: 'user',
      content: 'Łowię przy roślinności, z mułem i fermentującym detrytusem.',
      createdAt: '2026-06-24T11:58:00.000Z',
      citations: [],
      missingInformation: [],
    } satisfies ConversationMessage);
    await messageRepository.create({
      id: 'prior-assistant',
      userId: authorization.userId,
      conversationId: input.conversationId,
      role: 'assistant',
      content: 'W takim miejscu bazowałbym na roślinności, mule i subtelnym sygnale fermentacji.',
      createdAt: '2026-06-24T11:59:00.000Z',
      citations: [],
      missingInformation: [],
    } satisfies ConversationMessage);
  }

  const events: ChatStreamEvent[] = [];
  for await (const event of streamChatMessage(
    {
      conversationRepository,
      messageRepository,
      messageWriteRepository,
      ragSources: options.ragSources ?? [ragSource],
      ...(options.answerGapCandidateRepository === undefined
        ? {}
        : { answerGapCandidateRepository: options.answerGapCandidateRepository }),
      chatProvider,
      clock,
      generateId: ids(['user-message-1', 'assistant-message-1']),
      chatProviderId: 'openrouter',
      chatModel: 'minimax/minimax-m3',
      ...(options.traceSteps === undefined
        ? {}
        : {
            traceSink: {
              record(step) {
                options.traceSteps?.push(step);
              },
            },
          }),
    },
    input
  )) {
    events.push(event);
  }

  return { events, chatProvider, messageRepository };
}

describe('streamChatMessage', () => {
  it('sends the raised max token cap to decision and structured final chat requests', async () => {
    const { events, chatProvider } = await collectStream({
      authorization,
      requester,
      conversationId: 'conversation-1',
      message: 'Co by sie zmienilo, gdybym wybral warunek A zamiast warunku B?',
    });

    expect(events.at(-1)).toEqual({ type: 'done', data: { ok: true } });
    expect(chatProvider.requests).toHaveLength(2);
    expect(chatProvider.streamRequests).toHaveLength(1);
    expect(chatProvider.requests.map((request) => request.maxOutputTokens)).toEqual([6144, 6144]);
    expect(chatProvider.streamRequests[0]?.structuredOutput).toBeUndefined();
    expect(chatProvider.requests[1]?.structuredOutput).toEqual({ type: 'json_object' });
    expect(
      chatProvider.requests[0]?.messages.map((message) => message.content).join('\n')
    ).toContain('fermentującym detrytusem');
    const finalMessage = events.find((event) => event.type === 'answer.final');
    expect(finalMessage?.type).toBe('answer.final');
    if (finalMessage?.type !== 'answer.final') {
      throw new Error('missing final answer event');
    }
    expect(finalMessage.data.streamStatus).toBe('completed');
    expect(finalMessage.data.content).toContain('warunek A');
    expect(finalMessage.data.content).not.toContain('nic się nie zmienia');
  });

  it('streams visible answer deltas before persisting final metadata', async () => {
    const chatProvider = new RecordingChatProvider(undefined, [
      { type: 'text_delta', text: 'Pierwszy fragment ' },
      { type: 'text_delta', text: 'odpowiedzi. [S1]' },
      {
        type: 'done',
        response: chatResponse({
          finishReason: 'stop',
          text: 'Pierwszy fragment odpowiedzi. [S1]',
        }),
      },
    ]);

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Co by sie zmienilo, gdybym wybral warunek A zamiast warunku B?',
      },
      { chatProvider }
    );

    expect(events.map((event) => event.type)).toEqual([
      'message.created',
      'retrieval.started',
      'retrieval.completed',
      'answer.started',
      'answer.delta',
      'answer.delta',
      'answer.progress',
      'answer.citation',
      'answer.final',
      'done',
    ]);
    expect(events[3]).toEqual({
      type: 'answer.started',
      data: { conversationId: 'conversation-1', messageId: 'assistant-message-1' },
    });
    expect(events[4]).toEqual({ type: 'answer.delta', data: { text: 'Pierwszy fragment ' } });
    expect(events[5]).toEqual({ type: 'answer.delta', data: { text: 'odpowiedzi. [S1]' } });
    expect(events[6]).toEqual({ type: 'answer.progress', data: { status: 'preparing_sources' } });
    const finalMessage = events.find((event) => event.type === 'answer.final');
    expect(finalMessage?.type).toBe('answer.final');
    if (finalMessage?.type !== 'answer.final') throw new Error('missing final answer event');
    expect(finalMessage.data.content).toBe('Pierwszy fragment odpowiedzi. [S1]');
    expect(chatProvider.streamRequests).toHaveLength(1);
    expect(chatProvider.requests).toHaveLength(2);
  });

  it('retrieves with the model-composed tool query instead of the raw latest turn', async () => {
    const receivedQueries: string[] = [];
    const recordingRagSource: RagSource = {
      id: 'knowledge-service',
      label: 'Knowledge Service',
      retrieve(input: RagQuery): Promise<Result<RagSourceResult, RagSourceError>> {
        receivedQueries.push(input.query);
        return Promise.resolve(
          ok({
            sourceId: 'knowledge-service',
            items: [hardFixtureEvidence],
            coverageProbe: {
              classification: 'accessible_candidate_seen',
              minRequiredLevel: null,
              candidateCountBucket: '1',
              probeVersion: '1.0.0',
            },
            diagnostics: {},
          })
        );
      },
    };
    const expandedQuery =
      'sezonowe zakresy płynnych dodatków ml na 1 kg zanęty wiosna lato jesień temperatura wody';
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'tool-call-1',
            type: 'function',
            function: {
              name: 'retrieveKnowledge',
              arguments: JSON.stringify({ query: expandedQuery }),
            },
          },
        ],
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Zakresy zależą od temperatury i sezonu. [S1]',
          confidence: 'medium',
          usedSources: [{ sourceId: 'S1', usedFor: 'sezonowe zakresy dodatków' }],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
    ]);

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'A jakie zakresy na wiosnę, lato i jesień? Podaj krótko w tabeli.',
      },
      { chatProvider, ragSources: [recordingRagSource] }
    );

    expect(receivedQueries).toHaveLength(1);
    expect(receivedQueries[0]).toContain(expandedQuery);
    expect(receivedQueries[0]).toContain(
      'Bieżące pytanie: A jakie zakresy na wiosnę, lato i jesień?'
    );
    expect(receivedQueries[0]).toContain('Wcześniejsze pytania użytkownika');
    expect(receivedQueries[0]).toContain('Łowię przy roślinności');
    expect(receivedQueries[0]).not.toContain('W takim miejscu bazowałbym');
    expect(events).toContainEqual({
      type: 'retrieval.started',
      data: { conversationId: 'conversation-1', query: receivedQueries[0] },
    });
    expect(events.at(-1)).toEqual({ type: 'done', data: { ok: true } });
  });

  it('uses recent conversation context when fallback retrieval is needed', async () => {
    const receivedQueries: string[] = [];
    const recordingRagSource: RagSource = {
      id: 'knowledge-service',
      label: 'Knowledge Service',
      retrieve(input: RagQuery): Promise<Result<RagSourceResult, RagSourceError>> {
        receivedQueries.push(input.query);
        return Promise.resolve(
          ok({
            sourceId: 'knowledge-service',
            items: [hardFixtureEvidence],
            coverageProbe: {
              classification: 'accessible_candidate_seen',
              minRequiredLevel: null,
              candidateCountBucket: '1',
              probeVersion: '1.0.0',
            },
            diagnostics: {},
          })
        );
      },
    };
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'stop',
        text: 'Mogę odpowiedzieć z kontekstu rozmowy.',
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Zakres trzeba dobrać do wcześniejszego kontekstu łowiska. [S1]',
          confidence: 'medium',
          usedSources: [{ sourceId: 'S1', usedFor: 'kontekst rozmowy i zakres' }],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
    ]);

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'A jakie zakresy na wiosnę, lato i jesień? Podaj krótko w tabeli.',
      },
      { chatProvider, ragSources: [recordingRagSource] }
    );

    expect(receivedQueries).toHaveLength(1);
    expect(receivedQueries[0]).toContain(
      'Bieżące pytanie: A jakie zakresy na wiosnę, lato i jesień?'
    );
    expect(receivedQueries[0]).toContain('Wcześniejsze pytania użytkownika');
    expect(receivedQueries[0]).toContain('Łowię przy roślinności');
    expect(receivedQueries[0]).not.toContain('W takim miejscu bazowałbym');
    expect(events).toContainEqual({
      type: 'retrieval.started',
      data: { conversationId: 'conversation-1', query: receivedQueries[0] },
    });
    expect(events.at(-1)).toEqual({ type: 'done', data: { ok: true } });
  });

  it('requests broader evidence without appending hidden domain framework terms', async () => {
    const receivedQueries: string[] = [];
    const receivedLimits: number[] = [];
    const recordingRagSource: RagSource = {
      id: 'knowledge-service',
      label: 'Knowledge Service',
      retrieve(input: RagQuery): Promise<Result<RagSourceResult, RagSourceError>> {
        receivedQueries.push(input.query);
        receivedLimits.push(input.limits.maxEvidenceItems);
        return Promise.resolve(
          ok({
            sourceId: 'knowledge-service',
            items: [hardFixtureEvidence],
            coverageProbe: {
              classification: 'accessible_candidate_seen',
              minRequiredLevel: null,
              candidateCountBucket: '1',
              probeVersion: '1.0.0',
            },
            diagnostics: {},
          })
        );
      },
    };

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Co by sie zmienilo w planie, gdybym wybral warunek A zamiast warunku B?',
      },
      { ragSources: [recordingRagSource] }
    );

    expect(receivedQueries).toHaveLength(1);
    expect(receivedLimits).toEqual([16]);
    expect(receivedQueries[0]).toContain('condition A instead of condition B delta');
    expect(receivedQueries[0]).toContain('Bieżące pytanie:');
    expect(receivedQueries[0]).toContain('Wcześniejsze pytania użytkownika');
    expect(receivedQueries[0]).not.toContain('W takim miejscu bazowałbym');
    expect(receivedQueries[0]).not.toContain('sygnatura chemiczna');
    expect(receivedQueries[0]).not.toContain('algorytm budowania zanęty');
    expect(receivedQueries[0]).not.toContain('strawność');
    expect(events.at(-1)).toEqual({ type: 'done', data: { ok: true } });
  });

  it('falls back to retrieval for factual Polish imperative requests', async () => {
    const receivedQueries: string[] = [];
    const recordingRagSource: RagSource = {
      id: 'knowledge-service',
      label: 'Knowledge Service',
      retrieve(input: RagQuery): Promise<Result<RagSourceResult, RagSourceError>> {
        receivedQueries.push(input.query);
        return Promise.resolve(
          ok({
            sourceId: 'knowledge-service',
            items: [hardFixtureEvidence],
            coverageProbe: {
              classification: 'accessible_candidate_seen',
              minRequiredLevel: null,
              candidateCountBucket: '1',
              probeVersion: '1.0.0',
            },
            diagnostics: {},
          })
        );
      },
    };
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'stop',
        text: 'Złożę plan z pamięci rozmowy.',
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Mini-plan musi zostać oparty na aktualnych pakietach dowodowych. [S1]',
          confidence: 'medium',
          usedSources: [{ sourceId: 'S1', usedFor: 'plan oparty na dowodach' }],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
    ]);

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Złóż dwa mini-plany: 12°C ostrożne ryby i 22°C aktywne ryby.',
      },
      { chatProvider, ragSources: [recordingRagSource] }
    );

    expect(receivedQueries).toHaveLength(1);
    expect(receivedQueries[0]).toContain('Złóż dwa mini-plany');
    expect(events.at(-1)).toEqual({ type: 'done', data: { ok: true } });
  });

  it('falls back to retrieval for factual give-me requests', async () => {
    const receivedQueries: string[] = [];
    const recordingRagSource: RagSource = {
      id: 'knowledge-service',
      label: 'Knowledge Service',
      retrieve(input: RagQuery): Promise<Result<RagSourceResult, RagSourceError>> {
        receivedQueries.push(input.query);
        return Promise.resolve(
          ok({
            sourceId: 'knowledge-service',
            items: [hardFixtureEvidence],
            coverageProbe: {
              classification: 'accessible_candidate_seen',
              minRequiredLevel: null,
              candidateCountBucket: '1',
              probeVersion: '1.0.0',
            },
            diagnostics: {},
          })
        );
      },
    };
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'stop',
        text: 'Daję odpowiedź z pamięci rozmowy.',
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Taki przepis musi zostać oparty na pobranych dowodach. [S1]',
          confidence: 'medium',
          usedSources: [{ sourceId: 'S1', usedFor: 'grounded factual request' }],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
    ]);

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Daj mi neutralny przyklad testowy z najwazniejszymi parametrami.',
      },
      { chatProvider, ragSources: [recordingRagSource] }
    );

    expect(receivedQueries).toHaveLength(1);
    expect(receivedQueries[0]).toContain('Daj mi neutralny przyklad testowy');
    expect(events.at(-1)).toEqual({ type: 'done', data: { ok: true } });
  });

  it('falls back to retrieval for factual summary requests', async () => {
    const receivedQueries: string[] = [];
    const recordingRagSource: RagSource = {
      id: 'knowledge-service',
      label: 'Knowledge Service',
      retrieve(input: RagQuery): Promise<Result<RagSourceResult, RagSourceError>> {
        receivedQueries.push(input.query);
        return Promise.resolve(
          ok({
            sourceId: 'knowledge-service',
            items: [hardFixtureEvidence],
            coverageProbe: {
              classification: 'accessible_candidate_seen',
              minRequiredLevel: null,
              candidateCountBucket: '1',
              probeVersion: '1.0.0',
            },
            diagnostics: {},
          })
        );
      },
    };
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Podsumowanie rozmowy z markerem źródła. [S1]',
          confidence: 'medium',
          usedSources: [],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Podsumowanie musi być oparte na aktualnych dowodach. [S1]',
          confidence: 'medium',
          usedSources: [{ sourceId: 'S1', usedFor: 'grounded summary request' }],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
    ]);

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Podsumuj cały zestaw i plan łowienia w 8 punktach.',
      },
      { chatProvider, ragSources: [recordingRagSource] }
    );

    expect(receivedQueries).toHaveLength(1);
    expect(receivedQueries[0]).toContain('Podsumuj cały zestaw');
    expect(events.at(-1)).toEqual({ type: 'done', data: { ok: true } });
  });

  it('falls back to retrieval for factual reminder requests', async () => {
    const receivedQueries: string[] = [];
    const recordingRagSource: RagSource = {
      id: 'knowledge-service',
      label: 'Knowledge Service',
      retrieve(input: RagQuery): Promise<Result<RagSourceResult, RagSourceError>> {
        receivedQueries.push(input.query);
        return Promise.resolve(
          ok({
            sourceId: 'knowledge-service',
            items: [hardFixtureEvidence],
            coverageProbe: {
              classification: 'accessible_candidate_seen',
              minRequiredLevel: null,
              candidateCountBucket: '1',
              probeVersion: '1.0.0',
            },
            diagnostics: {},
          })
        );
      },
    };
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Przypomnienie z markerem źródła. [S1]',
          confidence: 'medium',
          usedSources: [],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Przypomnienie musi być oparte na aktualnych dowodach. [S1]',
          confidence: 'medium',
          usedSources: [{ sourceId: 'S1', usedFor: 'grounded reminder request' }],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
    ]);

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Przypomnij różnicę między dnem żywym i martwym.',
      },
      { chatProvider, ragSources: [recordingRagSource] }
    );

    expect(receivedQueries).toHaveLength(1);
    expect(receivedQueries[0]).toContain('Przypomnij różnicę');
    expect(events.at(-1)).toEqual({ type: 'done', data: { ok: true } });
  });

  it('persists the structured answer without topic-specific traceability injection', async () => {
    const softFixtureFloatEvidence: RagEvidence = {
      id: 'soft-bottom-float-bundle',
      sourceId: 'knowledge-service',
      sourceType: 'knowledge_page',
      title: 'Example Float Setup A',
      quote: 'Example setup A keeps fixture presentation stable.',
      content: 'Synthetic setup text keeps component A above condition B for traceability tests.',
      score: 9,
      metadata: {
        headingPath: ['Fixture', 'Setup A'],
        path: ['Knowledge Base', 'Fixture'],
      },
    };
    const softFixtureRagSource: RagSource = {
      id: 'knowledge-service',
      label: 'Knowledge Service',
      retrieve(_input: RagQuery): Promise<Result<RagSourceResult, RagSourceError>> {
        return Promise.resolve(
          ok({
            sourceId: 'knowledge-service',
            items: [softFixtureFloatEvidence],
            coverageProbe: {
              classification: 'accessible_candidate_seen',
              minRequiredLevel: null,
              candidateCountBucket: '1',
              probeVersion: '1.0.0',
            },
            diagnostics: {},
          })
        );
      },
    };
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'tool-call-1',
            type: 'function',
            function: {
              name: 'retrieveKnowledge',
              arguments: JSON.stringify({ query: 'fixture setup A condition B' }),
            },
          },
        ],
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Use fixture component A so it stays visible in condition B. [S1]',
          confidence: 'high',
          usedSources: [{ sourceId: 'S1', usedFor: 'fixture presentation' }],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
    ]);

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Mam warunek B i chce uzyc ustawienia A. Jak ustawic przyklad?',
      },
      { chatProvider, ragSources: [softFixtureRagSource] }
    );

    const finalMessage = events.find((event) => event.type === 'answer.final');
    expect(finalMessage?.type).toBe('answer.final');
    if (finalMessage?.type !== 'answer.final') {
      throw new Error('missing final answer event');
    }
    expect(finalMessage.data.content).toBe(
      'Use fixture component A so it stays visible in condition B. [S1]'
    );
    expect(finalMessage.data.content).not.toContain('Kontekst odpowiedzi');
    expect(finalMessage.data.content).not.toContain('Tu kluczowe');
    expect(events.at(-1)).toEqual({ type: 'done', data: { ok: true } });
  });

  it('persists a direct structured answer for lightweight conversation', async () => {
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Cześć, w czym mogę pomóc?',
          confidence: 'medium',
          usedSources: [],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Cześć, w czym mogę pomóc?',
          confidence: 'medium',
          usedSources: [],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
    ]);

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Cześć',
      },
      { chatProvider }
    );

    expect(events.some((event) => event.type === 'retrieval.completed')).toBe(false);
    expect(events.some((event) => event.type === 'answer.missing_info')).toBe(false);
    const finalMessage = events.find((event) => event.type === 'answer.final');
    expect(finalMessage?.type).toBe('answer.final');
    if (finalMessage?.type !== 'answer.final') {
      throw new Error('missing final answer event');
    }
    expect(finalMessage.data.confidence).toBe('medium');
    expect(finalMessage.data.streamStatus).toBe('completed');
    expect(events.at(-1)).toEqual({ type: 'done', data: { ok: true } });
  });

  it('emits missing information after forced retrieval fallback', async () => {
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Spróbuję odpowiedzieć bez źródeł.',
          confidence: 'medium',
          usedSources: [],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Nie mam w bazie dokładnej dawki dla tego łowiska.',
          confidence: 'low',
          usedSources: [],
          missingInformation: [
            { description: 'Brakuje dawki dla wskazanego łowiska.', saveForAdmin: true },
            { description: 'Brakuje temperatury wody.', saveForAdmin: false },
          ],
          followUpQuestions: ['Podasz temperaturę wody?'],
        }),
      }),
    ]);

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Jakie informacje sa potrzebne do tej decyzji?',
      },
      { chatProvider }
    );

    expect(events.some((event) => event.type === 'retrieval.completed')).toBe(true);
    expect(events.find((event) => event.type === 'answer.missing_info')).toEqual({
      type: 'answer.missing_info',
      data: {
        missingInformation: ['Brakuje dawki dla wskazanego łowiska.', 'Brakuje temperatury wody.'],
      },
    });
    const finalMessage = events.find((event) => event.type === 'answer.final');
    expect(finalMessage?.type).toBe('answer.final');
    if (finalMessage?.type !== 'answer.final') {
      throw new Error('missing final answer event');
    }
    expect(finalMessage.data.missingInformation).toEqual([
      'Brakuje dawki dla wskazanego łowiska.',
      'Brakuje temperatury wody.',
    ]);
    expect(events.at(-1)).toEqual({ type: 'done', data: { ok: true } });
  });

  it('emits a pending answer gap candidate after explicit admin-saveable missing information', async () => {
    const answerGapCandidateRepository = new MemoryAnswerGapCandidateRepository();
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Spróbuję odpowiedzieć bez źródeł.',
          confidence: 'medium',
          usedSources: [],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Nie mam w bazie dokładnej dawki dla tego łowiska.',
          confidence: 'low',
          usedSources: [],
          missingInformation: [
            { description: 'Brakuje dawki dla wskazanego łowiska.', saveForAdmin: true },
            { description: 'Brakuje temperatury wody.', saveForAdmin: false },
          ],
          followUpQuestions: ['Podasz temperaturę wody?'],
        }),
      }),
    ]);

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Jakie informacje sa potrzebne do tej decyzji?',
      },
      { chatProvider, answerGapCandidateRepository }
    );

    expect(events.find((event) => event.type === 'answer.gap_candidate')).toEqual({
      type: 'answer.gap_candidate',
      data: {
        candidate: {
          id: 'answer-gap-candidate-assistant-message-1',
          status: 'pending_user_consent',
          coverageKind: 'unsupported_by_accessible_evidence',
          missingInformation: ['Brakuje dawki dla wskazanego łowiska.'],
          expiresAt: '2026-07-24T12:00:00.000Z',
        },
      },
    });
    const storedCandidate = await answerGapCandidateRepository.getById(
      'answer-gap-candidate-assistant-message-1'
    );
    expect(storedCandidate).toMatchObject({
      ok: true,
      value: {
        requester: {
          userId: requester.userId,
          email: null,
          firstName: null,
          lastName: null,
          role: requester.role,
          effectiveLevel: requester.effectiveLevel,
        },
        conversation: {
          conversationId: 'conversation-1',
          userMessageId: 'user-message-1',
          assistantMessageId: 'assistant-message-1',
          contextWindow: [],
        },
      },
    });
  });

  it('drops legal or current-scope missing information when the user did not ask for that scope', async () => {
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'tool-call-1',
            type: 'function',
            function: {
              name: 'retrieveKnowledge',
              arguments: JSON.stringify({ query: 'obrobione ziarna strawność zanęta' }),
            },
          },
        ],
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Obróbka poprawia sygnał i strawność ziaren.',
          confidence: 'high',
          usedSources: [],
          missingInformation: [
            {
              description:
                'Brak w Knowledge Base źródła prawnego lub regulaminowego o bieżących okresach ochronnych.',
              saveForAdmin: true,
            },
            { description: 'Brakuje dawki dla wskazanego łowiska.', saveForAdmin: true },
            { description: 'Brakuje lokalnego profilu dna.', saveForAdmin: true },
          ],
          followUpQuestions: [],
        }),
      }),
    ]);

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Jak przygotować obrobione ziarna pod kątem strawności?',
      },
      { chatProvider }
    );

    expect(events.find((event) => event.type === 'answer.missing_info')).toEqual({
      type: 'answer.missing_info',
      data: {
        missingInformation: [
          'Brakuje dawki dla wskazanego łowiska.',
          'Brakuje lokalnego profilu dna.',
        ],
      },
    });
    const finalMessage = events.find((event) => event.type === 'answer.final');
    expect(finalMessage?.type).toBe('answer.final');
    if (finalMessage?.type !== 'answer.final') {
      throw new Error('missing final answer event');
    }
    expect(finalMessage.data.missingInformation).toEqual([
      'Brakuje dawki dla wskazanego łowiska.',
      'Brakuje lokalnego profilu dna.',
    ]);
  });

  it('keeps legal or current-scope missing information when the user asks for it', async () => {
    const legalMissing =
      'Brak w Knowledge Base źródła prawnego lub regulaminowego o bieżących okresach ochronnych.';
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'tool-call-1',
            type: 'function',
            function: {
              name: 'retrieveKnowledge',
              arguments: JSON.stringify({ query: 'aktualne przepisy okresy ochronne' }),
            },
          },
        ],
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Nie mam aktualnego źródła prawnego w bazie wiedzy.',
          confidence: 'low',
          usedSources: [],
          missingInformation: [{ description: legalMissing, saveForAdmin: true }],
          followUpQuestions: [],
        }),
      }),
    ]);

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Jakie są aktualne przepisy i okresy ochronne?',
      },
      { chatProvider }
    );

    expect(events.find((event) => event.type === 'answer.missing_info')).toEqual({
      type: 'answer.missing_info',
      data: { missingInformation: [legalMissing] },
    });
    const finalMessage = events.find((event) => event.type === 'answer.final');
    expect(finalMessage?.type).toBe('answer.final');
    if (finalMessage?.type !== 'answer.final') {
      throw new Error('missing final answer event');
    }
    expect(finalMessage.data.missingInformation).toEqual([legalMissing]);
  });

  it('repairs recoverable usedSources array shape errors', async () => {
    const signal = new AbortController().signal;
    const traceSteps: import('./streamChatMessage.js').ChatRuntimeTraceStep[] = [];
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Najpierw odpowiem z kontekstu.',
          confidence: 'medium',
          usedSources: [],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Na detrytusie nęć mało i nie przykrywaj naturalnego tła.',
          confidence: 'medium',
          usedSources: {},
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Na detrytusie nęć mało i nie przykrywaj naturalnego tła.',
          confidence: 'medium',
          usedSources: [],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
    ]);

    const { events, chatProvider: provider } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Jeśli to jednak detrytus, jak nęcić, żeby nie przykryć naturalnego sygnału?',
        signal,
      },
      { chatProvider, traceSteps }
    );

    const finalMessage = events.find((event) => event.type === 'answer.final');
    expect(finalMessage?.type).toBe('answer.final');
    if (finalMessage?.type !== 'answer.final') throw new Error('missing final answer event');
    expect(finalMessage.data.streamStatus).toBe('completed');
    expect(finalMessage.data.content).toContain('Na detrytusie nęć mało');
    expect(provider.requests).toHaveLength(3);
    const repairRequest = provider.requests[2];
    expect(repairRequest?.messages.map((message) => message.content).join('\n')).toContain(
      'usedSources'
    );
    expect(repairRequest?.owner).toEqual({ type: 'user', id: authorization.userId });
    expect(repairRequest?.sessionId).toBe('conversation-1');
    expect(repairRequest?.correlation).toEqual({
      conversationId: 'conversation-1',
      messageId: 'assistant-message-1',
    });
    expect(repairRequest?.providerCallPolicy).toEqual(expect.objectContaining({ maxRetries: 1 }));
    expect(repairRequest?.signal).toBe(signal);
    expect(repairRequest?.reasoning).toEqual({ effort: 'minimal', exclude: true });
    const repairTrace = traceSteps.find(
      (step) =>
        step.name === 'llm.final' &&
        step.details['attempt'] === 2 &&
        step.details['retryReason'] === 'parse_error'
    );
    expect(repairTrace?.details['parseErrorMessage']).toMatch(/usedSources/);
    const parseTrace = traceSteps.find((step) => step.name === 'answer.parse');
    expect(parseTrace?.details['attemptCount']).toBe(2);
    expect(parseTrace?.details['attempts']).toMatchObject([
      { attempt: 1, ok: false },
      { attempt: 2, ok: true },
    ]);
    const attemptsValue = parseTrace?.details['attempts'];
    expect(Array.isArray(attemptsValue)).toBe(true);
    if (!Array.isArray(attemptsValue)) {
      throw new Error('missing parse attempts');
    }
    const attempts: readonly unknown[] = attemptsValue;
    const firstAttempt = attempts[0];
    if (firstAttempt === null || typeof firstAttempt !== 'object' || Array.isArray(firstAttempt)) {
      throw new Error('missing first parse attempt details');
    }
    expect(String((firstAttempt as { errorMessage?: unknown }).errorMessage)).toContain(
      'usedSources'
    );
  });

  it('keeps repairing recoverable usedSources item shape errors', async () => {
    const traceSteps: import('./streamChatMessage.js').ChatRuntimeTraceStep[] = [];
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Najpierw odpowiem z kontekstu.',
          confidence: 'medium',
          usedSources: [],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Kod rabatowy jest przywilejem poziomu 4; nie wymyślam kodu.',
          confidence: 'medium',
          usedSources: {},
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Kod rabatowy jest przywilejem poziomu 4; nie wymyślam kodu.',
          confidence: 'medium',
          usedSources: ['S1'],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Kod rabatowy jest przywilejem poziomu 4; nie wymyślam kodu.',
          confidence: 'medium',
          usedSources: [],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
    ]);

    const { events, chatProvider: provider } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Co powinienem wiedzieć o kuponach rabatowych? Nie wymyślaj kodu.',
      },
      { chatProvider, traceSteps }
    );

    const finalMessage = events.find((event) => event.type === 'answer.final');
    expect(finalMessage?.type).toBe('answer.final');
    if (finalMessage?.type !== 'answer.final') throw new Error('missing final answer event');
    expect(finalMessage.data.streamStatus).toBe('completed');
    expect(finalMessage.data.content).toContain('nie wymyślam kodu');
    expect(provider.requests).toHaveLength(4);

    const repairTraces = traceSteps.filter(
      (step) => step.name === 'llm.final' && step.details['retryReason'] === 'parse_error'
    );
    expect(repairTraces.map((step) => step.details['parseErrorMessage'])).toEqual([
      'usedSources must be an array',
      'usedSources items must be objects',
    ]);
    const parseTrace = traceSteps.find((step) => step.name === 'answer.parse');
    expect(parseTrace?.details['attemptCount']).toBe(3);
    expect(parseTrace?.details['attempts']).toMatchObject([
      { attempt: 1, ok: false, errorMessage: 'usedSources must be an array' },
      { attempt: 2, ok: false, errorMessage: 'usedSources items must be objects' },
      { attempt: 3, ok: true },
    ]);
  });

  it('normalizes loose missingInformation metadata without a repair round-trip', async () => {
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'tool-call-1',
            type: 'function',
            function: {
              name: 'retrieveKnowledge',
              arguments: JSON.stringify({
                query: 'protein hydrolysate krill betaine fermented liquid',
              }),
            },
          },
        ],
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Porównanie dodatków: dawkuj ostrożnie, szczególnie w zimnej wodzie.',
          confidence: 'medium',
          usedSources: [],
          missingInformation: {},
          followUpQuestions: [],
        }),
      }),
    ]);

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message:
          'Porównaj hydrolizat białka A, hydrolizat białka B, naturalną betainę, koncentrat białkowy i liquid fermentacyjny.',
      },
      { chatProvider }
    );

    const finalMessage = events.find((event) => event.type === 'answer.final');
    expect(finalMessage?.type).toBe('answer.final');
    if (finalMessage?.type !== 'answer.final') throw new Error('missing final answer event');
    expect(finalMessage.data.streamStatus).toBe('completed');
    expect(finalMessage.data.content).toContain('Porównanie dodatków');
    expect(chatProvider.requests).toHaveLength(2);
  });

  it('does not regenerate visible streamed answers after metadata extraction', async () => {
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'tool-call-1',
            type: 'function',
            function: {
              name: 'retrieveKnowledge',
              arguments: JSON.stringify({
                query: 'trening stanowiska obserwacja dna ryb sygnałów',
              }),
            },
          },
        ],
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown:
            'Powyższa treść to pełna odpowiedź.\n\n- Czy mam doprecyzować obserwacje?',
          confidence: 'medium',
          usedSources: [],
          missingInformation: [],
          followUpQuestions: ['Czy mam doprecyzować obserwacje?'],
        }),
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown:
            'Na treningu obserwuj dno, zachowanie ryb i to, czy sygnał pokarmowy pasuje do stanowiska. [S1]',
          confidence: 'medium',
          usedSources: [{ sourceId: 'S1', usedFor: 'training observation evidence' }],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
    ]);

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Co obserwować na treningu stanowiska?',
      },
      { chatProvider }
    );

    const finalMessage = events.find((event) => event.type === 'answer.final');
    expect(finalMessage?.type).toBe('answer.final');
    if (finalMessage?.type !== 'answer.final') throw new Error('missing final answer event');
    expect(finalMessage.data.streamStatus).toBe('completed');
    expect(finalMessage.data.content).toBe(
      'Powyższa treść to pełna odpowiedź.\n\n- Czy mam doprecyzować obserwacje?'
    );
    expect(chatProvider.requests).toHaveLength(2);
  });

  it('keeps the streamed answer when metadata reports a length finish reason', async () => {
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Użyję wiedzy z rozmowy.',
          confidence: 'medium',
          usedSources: [],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
      chatResponse({
        finishReason: 'length',
        text: JSON.stringify({
          answerMarkdown: 'Ucięta odpowiedź',
          confidence: 'medium',
          usedSources: [],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Krótko: połóż zestaw w przyssaniu, nęć mało i naturalnie.',
          confidence: 'medium',
          usedSources: [],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
    ]);

    const { events, chatProvider: provider } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Gdzie położyć zestaw: na twardym, w przyssaniu, czy w najdłuższym mule?',
      },
      { chatProvider }
    );

    const finalMessage = events.find((event) => event.type === 'answer.final');
    expect(finalMessage?.type).toBe('answer.final');
    if (finalMessage?.type !== 'answer.final') throw new Error('missing final answer event');
    expect(finalMessage.data.streamStatus).toBe('completed');
    expect(finalMessage.data.content).toBe('Ucięta odpowiedź');
    expect(provider.requests).toHaveLength(2);
    expect(provider.streamRequests).toHaveLength(1);
  });

  it('persists the streamed answer when metadata repair is truncated', async () => {
    const chatProvider = new RecordingChatProvider([
      chatResponse({
        finishReason: 'stop',
        text: JSON.stringify({
          answerMarkdown: 'Najpierw odpowiem z kontekstu.',
          confidence: 'medium',
          usedSources: {},
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
      chatResponse({
        finishReason: 'length',
        text: JSON.stringify({
          answerMarkdown: 'Naprawiona, ale też ucięta odpowiedź.',
          confidence: 'medium',
          usedSources: {},
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
      chatResponse({
        finishReason: 'length',
        text: JSON.stringify({
          answerMarkdown: 'Naprawiona, ale też ucięta odpowiedź.',
          confidence: 'medium',
          usedSources: [],
          missingInformation: [],
          followUpQuestions: [],
        }),
      }),
    ]);

    const { events, messageRepository } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Powiedz to w poprawnym JSON, ale tak by naprawa też się urwała.',
      },
      { chatProvider }
    );

    const finalMessage = events.find((event) => event.type === 'answer.final');
    expect(finalMessage?.type).toBe('answer.final');
    if (finalMessage?.type !== 'answer.final') {
      throw new Error('missing final answer event');
    }
    expect(finalMessage.data.streamStatus).toBe('completed');
    expect(finalMessage.data.content).toBe('Naprawiona, ale też ucięta odpowiedź.');
    expect(finalMessage.data.confidence).toBe('low');
    expect(events.at(-1)).toEqual({ type: 'done', data: { ok: true } });

    const persistedAssistant = messageRepository.messages.get('assistant-message-1');
    expect(persistedAssistant?.streamStatus).toBe('completed');
    expect(persistedAssistant?.content).toBe('Naprawiona, ale też ucięta odpowiedź.');
    expect(persistedAssistant?.errorMessage).toBeUndefined();
  });

  it('persists streamed content with empty metadata when metadata stays invalid', async () => {
    const chatProvider = new RecordingChatProvider(
      [
        chatResponse({
          finishReason: 'stop',
          text: JSON.stringify({
            answerMarkdown: '',
            confidence: 'medium',
            usedSources: [],
            missingInformation: [],
            followUpQuestions: [],
          }),
        }),
        chatResponse({
          finishReason: 'stop',
          text: JSON.stringify({
            answerMarkdown: '',
            confidence: 'medium',
            usedSources: [],
            missingInformation: [],
            followUpQuestions: [],
          }),
        }),
        chatResponse({
          finishReason: 'stop',
          text: JSON.stringify({
            answerMarkdown: '',
            confidence: 'medium',
            usedSources: [],
            missingInformation: [],
            followUpQuestions: [],
          }),
        }),
        chatResponse({
          finishReason: 'stop',
          text: JSON.stringify({
            answerMarkdown: '',
            confidence: 'medium',
            usedSources: [],
            missingInformation: [],
            followUpQuestions: [],
          }),
        }),
      ],
      [
        { type: 'text_delta', text: 'Widoczna odpowiedź zostaje.' },
        {
          type: 'done',
          response: chatResponse({
            finishReason: 'stop',
            text: 'Widoczna odpowiedź zostaje.',
          }),
        },
      ]
    );

    const { events } = await collectStream(
      {
        authorization,
        requester,
        conversationId: 'conversation-1',
        message: 'Odpowiedz niepoprawnym JSON.',
      },
      { chatProvider }
    );

    const finalMessage = events.find((event) => event.type === 'answer.final');
    expect(finalMessage?.type).toBe('answer.final');
    if (finalMessage?.type !== 'answer.final') {
      throw new Error('missing final answer event');
    }
    expect(finalMessage.data.streamStatus).toBe('completed');
    expect(finalMessage.data.content).toBe('Widoczna odpowiedź zostaje.');
    expect(finalMessage.data.confidence).toBe('low');
    expect(finalMessage.data.citations).toEqual([]);
    expect(finalMessage.data.missingInformation).toEqual([]);
    expect(events.at(-1)).toEqual({ type: 'done', data: { ok: true } });
  });
});
