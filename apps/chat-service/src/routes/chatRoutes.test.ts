import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AuthorizationContext,
  AuthorizationResolveResponse,
  CreateAnswerGapRequest,
} from '@fa/http-contracts';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionStreamEvent,
  LlmChatProvider,
} from '@fa/llm-contract';

import { MemoryConversationMessageWriteRepository } from '../infra/memory/memoryChatRepositories.js';
import { MemoryAnswerGapCandidateRepository } from '../infra/memory/memoryAnswerGapCandidateRepository.js';
import {
  MemoryConversationMessageRepository,
  MemoryConversationRepository,
} from '../infra/memory/memoryChatRepositories.js';
import { createServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import type { AnswerGapSink } from '../domain/usecases/streamChatMessage.js';
import { chatRouteInternals } from './chatRoutes.js';

const approvedAuthHeaders = { authorization: 'Bearer approved-chat-user' } as const;
const testApiToken = 'chat-test-token';

process.env['NODE_ENV'] = 'test';
process.env['FA_AUTH0_ISSUER'] = 'https://auth.example.com/';
process.env['FA_AUTH0_AUDIENCE'] = 'https://api.fishing-assistant.online';
process.env['FA_AUTH0_JWKS_URI'] = 'https://auth.example.com/.well-known/jwks.json';

function approvedAuthorization(): AuthorizationContext {
  return {
    userId: 'route-user-1',
    auth0Subject: 'auth0|route-user-1',
    email: 'route-user-1@example.com',
    firstName: 'Route',
    lastName: 'Tester',
    role: 'user',
    status: 'approved',
    effectiveLevel: 7,
  };
}

function approvedResolverResponse(): AuthorizationResolveResponse {
  const authorization = approvedAuthorization();
  return {
    state: 'approved',
    user: {
      id: authorization.userId,
      email: authorization.email,
      firstName: 'Route',
      lastName: 'Tester',
      mobileNumber: '+15550101000',
      role: authorization.role,
      status: authorization.status,
      level: authorization.effectiveLevel,
      effectiveLevel: authorization.effectiveLevel,
    },
    authorization,
  };
}

class StaticChatProvider implements LlmChatProvider {
  readonly requests: ChatCompletionRequest[] = [];
  readonly streamRequests: ChatCompletionRequest[] = [];

  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.requests.push(request);
    return Promise.resolve({
      provider: 'fake',
      model: request.model ?? 'fake-model',
      finishReason: 'stop',
      text: JSON.stringify({
        answerMarkdown: 'Cześć, mogę pomóc w pytaniach wędkarskich.',
        confidence: 'medium',
        usedSources: [],
        missingInformation: [],
        followUpQuestions: [],
      }),
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: false },
    });
  }

  async *stream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamEvent> {
    this.streamRequests.push(request);
    await Promise.resolve();
    yield { type: 'text_delta', text: 'Cześć, mogę pomóc ' };
    yield { type: 'text_delta', text: 'w pytaniach wędkarskich.' };
    yield {
      type: 'done',
      response: {
        provider: 'fake',
        model: request.model ?? 'fake-model',
        finishReason: 'stop',
        text: 'Cześć, mogę pomóc w pytaniach wędkarskich.',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: false },
      },
    };
  }
}

function toolCallChatCompletionResponse(): ChatCompletionResponse {
  return {
    provider: 'fake',
    model: 'fake-model',
    finishReason: 'tool_calls',
    text: '',
    toolCalls: [
      {
        id: 'tool-call-1',
        type: 'function',
        function: {
          name: 'retrieveKnowledge',
          arguments: JSON.stringify({ query: 'Cześć' }),
        },
      },
    ],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: false },
  };
}

function finalAnswerChatCompletionResponse(input?: {
  finishReason?: string;
  missingInformation?: unknown;
  usedSources?: unknown;
}): ChatCompletionResponse {
  return {
    provider: 'fake',
    model: 'fake-model',
    finishReason: input?.finishReason ?? 'stop',
    text: JSON.stringify({
      answerMarkdown: 'Cześć, mogę pomóc w pytaniach wędkarskich.',
      confidence: 'medium',
      usedSources: input?.usedSources ?? [],
      missingInformation: input?.missingInformation ?? [],
      followUpQuestions: [],
    }),
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: false },
  };
}

class TestingCompletionChatProvider extends StaticChatProvider {
  override complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      return Promise.resolve(toolCallChatCompletionResponse());
    }

    return Promise.resolve(finalAnswerChatCompletionResponse());
  }
}

class SlowStreamingTestingCompletionChatProvider extends TestingCompletionChatProvider {
  override async *stream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamEvent> {
    this.streamRequests.push(request);
    await new Promise((resolve) => setTimeout(resolve, 10));
    yield { type: 'text_delta', text: 'Cześć, mogę pomóc ' };
    yield { type: 'text_delta', text: 'w pytaniach wędkarskich.' };
    yield {
      type: 'done',
      response: {
        provider: 'fake',
        model: request.model ?? 'fake-model',
        finishReason: 'stop',
        text: 'Cześć, mogę pomóc w pytaniach wędkarskich.',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: false },
      },
    };
  }
}

class InvalidFinalAnswerChatProvider extends TestingCompletionChatProvider {
  override complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      return Promise.resolve(toolCallChatCompletionResponse());
    }

    return Promise.resolve(
      finalAnswerChatCompletionResponse({
        usedSources: 'invalid-shape',
      })
    );
  }
}

class TimeoutAwareHangingChatProvider extends StaticChatProvider {
  override complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.requests.push(request);
    if (request.signal === undefined) {
      return Promise.reject(
        new Error('testing completion provider did not receive a timeout signal')
      );
    }

    const signal = request.signal;
    return new Promise((_resolve, reject) => {
      const rejectWithAbortReason = () => {
        reject(
          signal.reason instanceof Error ? signal.reason : new Error('provider request aborted')
        );
      };

      if (signal.aborted) {
        rejectWithAbortReason();
        return;
      }

      signal.addEventListener('abort', rejectWithAbortReason, { once: true });
    });
  }
}

class MissingInfoChatProvider extends TestingCompletionChatProvider {
  override complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      return Promise.resolve(toolCallChatCompletionResponse());
    }

    return Promise.resolve(
      finalAnswerChatCompletionResponse({
        missingInformation: [
          {
            description: 'No accessible Knowledge Base evidence covers winter canal fishing.',
            saveForAdmin: true,
          },
        ],
      })
    );
  }
}

function setApprovedServices(
  chatProvider: StaticChatProvider = new StaticChatProvider(),
  answerGapSink?: AnswerGapSink,
  answerGapCandidateRepository = new MemoryAnswerGapCandidateRepository()
): StaticChatProvider {
  const conversationRepository = new MemoryConversationRepository();
  const messageRepository = new MemoryConversationMessageRepository();
  setServices({
    conversationRepository,
    messageRepository,
    messageWriteRepository: new MemoryConversationMessageWriteRepository(
      conversationRepository,
      messageRepository
    ),
    answerGapCandidateRepository,
    ...(answerGapSink === undefined ? {} : { answerGapSink }),
    chatProvider,
    clock: { now: () => new Date('2026-06-25T08:00:00.000Z') },
    generateId: (() => {
      const ids = ['conversation-1', 'message-user-1', 'message-assistant-1', 'conversation-2'];
      return () => ids.shift() ?? 'extra-id';
    })(),
    auth0JwtVerifier: (headers) =>
      Promise.resolve(
        headers['authorization'] === approvedAuthHeaders.authorization
          ? {
              ok: true as const,
              identity: {
                subject: 'auth0|route-user-1',
                email: 'route-user-1@example.com',
                emailVerified: true,
                name: 'Route Tester',
              },
            }
          : {
              ok: false as const,
              error: { statusCode: 401, code: 'UNAUTHORIZED', message: 'Unauthorized' },
            }
      ),
    userServiceClient: {
      resolveAuthorization: () => Promise.resolve(approvedResolverResponse()),
      lookupUserIdentities: () => Promise.resolve({ users: [] }),
    },
  });
  return chatProvider;
}

function authHeaders(): { headers: Record<string, string> } {
  return { headers: { ...approvedAuthHeaders } };
}

describe('chat routes', () => {
  afterEach(() => {
    delete process.env['FA_CHAT_TEST_API_TOKEN'];
    resetServices();
  });

  it('rejects non-empty create conversation bodies before creating conversations', async () => {
    setApprovedServices();
    const app = await createServer();

    const response = await app.inject({
      method: 'POST',
      url: '/conversations',
      payload: { unexpected: true },
      ...authHeaders(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Request body must be empty' },
    });
  });

  it('creates, lists, reads, lists messages, and deletes a conversation', async () => {
    setApprovedServices();
    const app = await createServer();

    const created = await app.inject({
      method: 'POST',
      url: '/conversations',
      payload: {},
      ...authHeaders(),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ ok: true, data: { id: 'conversation-1' } });

    const listed = await app.inject({ method: 'GET', url: '/conversations', ...authHeaders() });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ data: unknown[] }>().data).toHaveLength(1);

    const fetched = await app.inject({
      method: 'GET',
      url: '/conversations/conversation-1',
      ...authHeaders(),
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({ ok: true, data: { id: 'conversation-1' } });

    const messages = await app.inject({
      method: 'GET',
      url: '/conversations/conversation-1/messages',
      ...authHeaders(),
    });
    expect(messages.statusCode).toBe(200);
    expect(messages.json<{ data: unknown[] }>().data).toEqual([]);

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/conversations/conversation-1',
      ...authHeaders(),
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ ok: true });
  });

  it('protects and executes the non-streaming chat testing endpoint', async () => {
    process.env['FA_CHAT_TEST_API_TOKEN'] = testApiToken;
    const chatProvider = setApprovedServices(new TestingCompletionChatProvider());
    const app = await createServer();

    const unauthorized = await app.inject({
      method: 'POST',
      url: '/testing/chat/completions',
      headers: { authorization: 'Bearer wrong-token' },
      payload: {
        requester: {
          userId: 'route-user-1',
          email: 'route-user-1@example.com',
          role: 'user',
          effectiveLevel: 7,
        },
        message: 'Cześć',
      },
    });
    expect(unauthorized.statusCode).toBe(401);

    const completed = await app.inject({
      method: 'POST',
      url: '/testing/chat/completions',
      headers: { authorization: `Bearer ${testApiToken}` },
      payload: {
        requester: {
          userId: 'route-user-1',
          email: 'route-user-1@example.com',
          role: 'user',
          effectiveLevel: 7,
        },
        message: 'Cześć',
      },
    });

    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      ok: true,
      data: {
        conversationId: 'conversation-1',
        createdConversation: true,
        assistantMessage: {
          streamStatus: 'completed',
          content: 'Cześć, mogę pomóc w pytaniach wędkarskich.',
        },
        technicalStatus: {
          ok: true,
          streamStatus: 'completed',
          parseOk: true,
          finalFinishReason: 'stop',
        },
      },
    });
    expect(chatProvider.requests).toHaveLength(2);
    expect(chatProvider.requests[0]?.tools?.map((tool) => tool.function.name)).toContain(
      'retrieveKnowledge'
    );
  });

  it('keeps long testing completions alive with JSON whitespace before the final envelope', async () => {
    process.env['FA_CHAT_TEST_API_TOKEN'] = testApiToken;
    setApprovedServices(new SlowStreamingTestingCompletionChatProvider());
    const app = await createServer({ chatTestCompletionKeepAliveMs: 1 });

    const completed = await app.inject({
      method: 'POST',
      url: '/testing/chat/completions',
      headers: { authorization: `Bearer ${testApiToken}` },
      payload: {
        requester: {
          userId: 'route-user-1',
          email: 'route-user-1@example.com',
          role: 'user',
          effectiveLevel: 7,
        },
        message: 'Cześć',
      },
    });

    expect(completed.statusCode).toBe(200);
    expect(completed.body.startsWith('\n')).toBe(true);
    expect(completed.json()).toMatchObject({
      ok: true,
      data: {
        conversationId: 'conversation-1',
        assistantMessage: {
          streamStatus: 'completed',
          content: 'Cześć, mogę pomóc w pytaniach wędkarskich.',
        },
      },
    });
  });

  it('returns technical failure metadata from the non-streaming chat testing endpoint', async () => {
    process.env['FA_CHAT_TEST_API_TOKEN'] = testApiToken;
    setApprovedServices(new InvalidFinalAnswerChatProvider());
    const app = await createServer();

    const failed = await app.inject({
      method: 'POST',
      url: '/testing/chat/completions',
      headers: { authorization: `Bearer ${testApiToken}` },
      payload: {
        requester: {
          userId: 'route-user-1',
          email: 'route-user-1@example.com',
          role: 'user',
          effectiveLevel: 7,
        },
        message: 'Cześć',
      },
    });

    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toMatchObject({
      ok: true,
      data: {
        assistantMessage: {
          streamStatus: 'completed',
        },
        technicalStatus: {
          ok: false,
          streamStatus: 'completed',
          parseOk: false,
        },
      },
    });
  });

  it('returns structured technical failure metadata when the testing endpoint times out', async () => {
    process.env['FA_CHAT_TEST_API_TOKEN'] = testApiToken;
    const chatProvider = setApprovedServices(new TimeoutAwareHangingChatProvider());
    const app = await createServer({ streamTimeoutMs: 20 });

    const failed = await app.inject({
      method: 'POST',
      url: '/testing/chat/completions',
      headers: { authorization: `Bearer ${testApiToken}` },
      payload: {
        requester: {
          userId: 'route-user-1',
          email: 'route-user-1@example.com',
          role: 'user',
          effectiveLevel: 7,
        },
        message: 'Cześć',
      },
    });

    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toMatchObject({
      ok: true,
      data: {
        conversationId: 'conversation-1',
        createdConversation: true,
        assistantMessage: {
          streamStatus: 'failed',
          errorMessage: 'Chat test completion timed out',
        },
        technicalStatus: {
          ok: false,
          streamStatus: 'failed',
          errorMessage: 'Chat test completion timed out',
        },
      },
    });
    expect(chatProvider.requests[0]?.signal).toBeDefined();
    expect(chatProvider.requests[0]?.signal?.aborted).toBe(true);
  });

  it('streams chat events as server-sent events for an existing conversation', async () => {
    const chatProvider = setApprovedServices();
    const app = await createServer();

    const created = await app.inject({
      method: 'POST',
      url: '/conversations',
      payload: {},
      ...authHeaders(),
    });
    expect(created.statusCode).toBe(201);

    const streamed = await app.inject({
      method: 'POST',
      url: '/conversations/conversation-1/messages/stream',
      payload: { message: 'Cześć' },
      ...authHeaders(),
    });

    expect(streamed.statusCode).toBe(200);
    expect(streamed.headers['content-type']).toContain('text/event-stream');
    expect(streamed.payload).toContain('event: message.created');
    expect(streamed.payload).toContain('event: answer.started');
    expect(streamed.payload).toContain('event: answer.delta');
    expect(streamed.payload).toContain('event: answer.final');
    expect(streamed.payload).toContain('event: done');
    expect(chatProvider.requests).toHaveLength(2);
    expect(chatProvider.streamRequests).toHaveLength(1);
  });

  it('creates a sensitive answer gap candidate and shares it only after user consent', async () => {
    const captured: CreateAnswerGapRequest[] = [];
    const withdrawals: { gapId: string; candidateId: string }[] = [];
    const answerGapSink: AnswerGapSink = {
      create(input) {
        captured.push(input);
        return Promise.resolve();
      },
      withdrawConsent(input) {
        withdrawals.push(input);
        return Promise.resolve();
      },
    };
    const answerGapCandidateRepository = new MemoryAnswerGapCandidateRepository();
    setApprovedServices(new MissingInfoChatProvider(), answerGapSink, answerGapCandidateRepository);
    const app = await createServer();

    await app.inject({
      method: 'POST',
      url: '/conversations',
      payload: {},
      ...authHeaders(),
    });
    const streamed = await app.inject({
      method: 'POST',
      url: '/conversations/conversation-1/messages/stream',
      payload: { message: 'Jak łowić zimą na kanale?' },
      ...authHeaders(),
    });

    expect(streamed.statusCode).toBe(200);
    expect(streamed.payload).toContain('event: answer.gap_candidate');
    expect(captured).toHaveLength(0);

    const storedCandidate = await answerGapCandidateRepository.getById(
      'answer-gap-candidate-message-assistant-1'
    );
    expect(storedCandidate).toMatchObject({
      ok: true,
      value: {
        status: 'pending_user_consent',
        question: '',
        requester: {
          userId: 'route-user-1',
          email: null,
          firstName: null,
          lastName: null,
        },
        conversation: { contextWindow: [] },
      },
    });

    const shared = await app.inject({
      method: 'POST',
      url: '/answer-gap-candidates/answer-gap-candidate-message-assistant-1/share',
      payload: { includeContext: true, includeContact: true },
      ...authHeaders(),
    });

    expect(shared.statusCode).toBe(200);
    expect(shared.json()).toMatchObject({
      ok: true,
      data: {
        created: true,
        candidate: {
          id: 'answer-gap-candidate-message-assistant-1',
          status: 'shared',
          coverageKind: 'global_no_candidate_seen',
        },
      },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.requester).toMatchObject({
      userId: 'route-user-1',
      email: 'route-user-1@example.com',
      firstName: 'Route',
      lastName: 'Tester',
    });
    expect(captured[0]?.consent).toMatchObject({
      status: 'user_shared',
      includeContext: true,
      includeContact: true,
      candidateId: 'answer-gap-candidate-message-assistant-1',
    });
    expect(captured[0]?.conversation.contextWindow.length).toBeGreaterThan(0);

    const withdrawn = await app.inject({
      method: 'POST',
      url: '/answer-gap-candidates/answer-gap-candidate-message-assistant-1/withdraw',
      payload: {},
      ...authHeaders(),
    });

    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json()).toMatchObject({
      ok: true,
      data: {
        candidate: {
          id: 'answer-gap-candidate-message-assistant-1',
          status: 'withdrawn',
        },
      },
    });
    expect(withdrawals).toEqual([
      {
        gapId: 'answer-gap-message-assistant-1',
        candidateId: 'answer-gap-candidate-message-assistant-1',
      },
    ]);
  });

  it('declines a sensitive answer gap candidate without sending it to Knowledge Service', async () => {
    const captured: CreateAnswerGapRequest[] = [];
    const answerGapSink: AnswerGapSink = {
      create(input) {
        captured.push(input);
        return Promise.resolve();
      },
    };
    const answerGapCandidateRepository = new MemoryAnswerGapCandidateRepository();
    setApprovedServices(new MissingInfoChatProvider(), answerGapSink, answerGapCandidateRepository);
    const app = await createServer();

    await app.inject({
      method: 'POST',
      url: '/conversations',
      payload: {},
      ...authHeaders(),
    });
    await app.inject({
      method: 'POST',
      url: '/conversations/conversation-1/messages/stream',
      payload: { message: 'Jak łowić zimą na kanale?' },
      ...authHeaders(),
    });

    const declined = await app.inject({
      method: 'POST',
      url: '/answer-gap-candidates/answer-gap-candidate-message-assistant-1/decline',
      payload: {},
      ...authHeaders(),
    });

    expect(declined.statusCode).toBe(200);
    expect(declined.json()).toMatchObject({
      ok: true,
      data: {
        candidate: {
          id: 'answer-gap-candidate-message-assistant-1',
          status: 'declined',
        },
      },
    });
    expect(captured).toEqual([]);
  });

  it('keeps route helper guards deterministic', async () => {
    expect(chatRouteInternals.conversationIdParam({ conversationId: 'conversation-1' })).toBe(
      'conversation-1'
    );
    expect(chatRouteInternals.conversationIdParam({ conversationId: 1 })).toBeNull();
    expect(chatRouteInternals.conversationIdParam(null)).toBeNull();

    expect(chatRouteInternals.messageFromBody({ message: 'Cześć' })).toBe('Cześć');
    expect(chatRouteInternals.messageFromBody({ message: 1 })).toBeNull();
    expect(chatRouteInternals.messageFromBody([])).toBeNull();

    expect(
      chatRouteInternals.shouldAbortOnRequestClose({
        requestDestroyed: true,
        requestComplete: false,
        responseWritableEnded: false,
      })
    ).toBe(true);
    expect(
      chatRouteInternals.shouldAbortOnRequestClose({
        requestDestroyed: false,
        requestComplete: false,
        responseWritableEnded: false,
      })
    ).toBe(false);
    expect(
      chatRouteInternals.shouldAbortOnRequestClose({
        requestDestroyed: true,
        requestComplete: true,
        responseWritableEnded: false,
      })
    ).toBe(false);
    expect(
      chatRouteInternals.shouldAbortOnRequestClose({
        requestDestroyed: true,
        requestComplete: false,
        responseWritableEnded: true,
      })
    ).toBe(false);
    expect(chatRouteInternals.shouldAbortOnResponseClose({ responseWritableEnded: false })).toBe(
      true
    );
    expect(chatRouteInternals.shouldAbortOnResponseClose({ responseWritableEnded: true })).toBe(
      false
    );

    expect(chatRouteInternals.toHttpErrorCode('INVALID_REQUEST')).toBe('INVALID_REQUEST');
    expect(chatRouteInternals.toHttpErrorCode('NOT_FOUND')).toBe('NOT_FOUND');
    expect(chatRouteInternals.toHttpErrorCode('CONFLICT')).toBe('CONFLICT');
    expect(chatRouteInternals.toHttpErrorCode('INTERNAL_ERROR')).toBe('INTERNAL_ERROR');
    expect(chatRouteInternals.toHttpErrorCode('DOWNSTREAM_ERROR')).toBe('DOWNSTREAM_ERROR');
    expect(chatRouteInternals.toHttpErrorCode('SOMETHING_ELSE')).toBe('INTERNAL_ERROR');

    const reply = {
      fail: vi.fn(() => Promise.resolve('failed')),
    };
    await expect(
      chatRouteInternals.requireEmptyCreateConversationBody({}, reply as never)
    ).resolves.toBeUndefined();
    await expect(
      chatRouteInternals.requireEmptyCreateConversationBody({ body: {} }, reply as never)
    ).resolves.toBeUndefined();
    await expect(
      chatRouteInternals.requireEmptyCreateConversationBody(
        { body: { unexpected: true } },
        reply as never
      )
    ).resolves.toBe('failed');
    expect(reply.fail).toHaveBeenCalledWith('INVALID_REQUEST', 'Request body must be empty');
  });
});
