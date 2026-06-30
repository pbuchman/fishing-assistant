import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

import type { ErrorCode } from '@fa/common-core';
import { extractBearerToken } from '@fa/common-http';
import {
  chatAnswerGapCandidateParamsSchema,
  chatAnswerGapCandidateShareBodySchema,
  chatConversationParamsSchema,
  type AuthorizationContext,
  type ChatStreamConversationMessage,
  type RagAuthorizationContext,
  strictEmptyObjectSchema,
  chatStreamRequestBodySchema,
  chatTestCompletionRequestBodySchema,
  type ChatStreamEvent,
  type ChatTestCompletionRequest,
  type ChatTestCompletionResponse,
  type ChatTestCompletionTechnicalStatus,
  type ChatTestRuntimeTrace,
} from '@fa/http-contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  type ChatUseCaseError,
} from '../domain/usecases/conversationUsecases.js';
import { listConversationMessages } from '../domain/usecases/messageUsecases.js';
import {
  streamChatMessage,
  type ChatRuntimeTraceStep,
} from '../domain/usecases/streamChatMessage.js';
import {
  answerGapShareSnapshotFromMessages,
  answerGapCandidateSummary,
  declineAnswerGapCandidate,
  shareAnswerGapCandidate,
  withdrawAnswerGapCandidate,
} from '../domain/usecases/answerGapCandidates.js';
import { getServices } from '../services.js';
import { requireApprovedRequestAuthorization, requireApprovedUserAuth } from './authPreHandlers.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function conversationIdParam(params: unknown): string | null {
  return isRecord(params) && typeof params['conversationId'] === 'string'
    ? params['conversationId']
    : null;
}

function messageFromBody(body: unknown): string | null {
  return isRecord(body) && typeof body['message'] === 'string' ? body['message'] : null;
}

async function requireEmptyCreateConversationBody(
  request: { body?: unknown },
  reply: FastifyReply
): Promise<FastifyReply | undefined> {
  if (request.body === undefined) {
    return undefined;
  }

  if (isRecord(request.body) && Object.keys(request.body).length === 0) {
    return undefined;
  }

  return await reply.fail('INVALID_REQUEST', 'Request body must be empty');
}

function shouldAbortOnRequestClose(input: {
  requestDestroyed: boolean;
  requestComplete: boolean;
  responseWritableEnded: boolean;
}): boolean {
  return input.requestDestroyed && !input.requestComplete && !input.responseWritableEnded;
}

function shouldAbortOnResponseClose(input: { responseWritableEnded: boolean }): boolean {
  return !input.responseWritableEnded;
}

function toHttpErrorCode(code: string): ErrorCode {
  switch (code) {
    case 'INVALID_REQUEST':
    case 'NOT_FOUND':
    case 'CONFLICT':
    case 'INTERNAL_ERROR':
    case 'DOWNSTREAM_ERROR':
      return code;
    case 'EXPIRED':
      return 'CONFLICT';
    default:
      return 'INTERNAL_ERROR';
  }
}

async function failUseCase(reply: FastifyReply, error: ChatUseCaseError) {
  return await reply.fail(toHttpErrorCode(error.code), error.message);
}

function toRagAuthorizationContext(authorization: AuthorizationContext): RagAuthorizationContext {
  return {
    userId: authorization.userId,
    role: authorization.role,
    status: 'approved',
    effectiveLevel: authorization.effectiveLevel,
  };
}

export interface RegisterChatRoutesOptions {
  streamTimeoutMs: number;
}

const chatTestCompletionTimeoutSafetyMarginMs = 5_000;

interface ConversationParams {
  conversationId: string;
}

interface ChatStreamBody {
  message: string;
}

interface AnswerGapCandidateParams {
  candidateId: string;
}

interface AnswerGapCandidateShareBody {
  includeContext: boolean;
  includeContact: boolean;
}

function configuredTestApiToken(env: NodeJS.ProcessEnv = process.env): string {
  return (env['FA_CHAT_TEST_API_TOKEN'] ?? env['FA_INTERNAL_AUTH_TOKEN'] ?? '').trim();
}

function tokenMatches(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function requireChatTestBearerAuth(
  request: { headers: Record<string, string | string[] | undefined> },
  reply: FastifyReply
): Promise<FastifyReply | undefined> {
  const expectedToken = configuredTestApiToken();
  const bearer = extractBearerToken(request.headers);
  if (expectedToken.length === 0 || !bearer.ok || !tokenMatches(bearer.token, expectedToken)) {
    return await reply.fail('UNAUTHORIZED', 'Chat test API authorization failed');
  }

  return undefined;
}

function toRagAuthorizationContextFromTestRequest(
  request: ChatTestCompletionRequest
): RagAuthorizationContext {
  return {
    userId: request.requester.userId,
    role: request.requester.role,
    status: 'approved',
    effectiveLevel: request.requester.effectiveLevel as RagAuthorizationContext['effectiveLevel'],
  };
}

function traceStart(clock: { now(): Date }): { startedAt: string; startedMs: number } {
  return { startedAt: clock.now().toISOString(), startedMs: globalThis.performance.now() };
}

function traceComplete(input: {
  clock: { now(): Date };
  startedAt: string;
  startedMs: number;
  steps: readonly ChatRuntimeTraceStep[];
  events: ChatTestRuntimeTrace['events'];
}): ChatTestRuntimeTrace {
  const completedAt = input.clock.now().toISOString();
  return {
    startedAt: input.startedAt,
    completedAt,
    totalMs: Math.max(0, globalThis.performance.now() - input.startedMs),
    steps: [...input.steps],
    events: input.events,
  };
}

function chatTestTechnicalStatus(input: {
  assistantMessage: ChatStreamConversationMessage;
  traceSteps: readonly ChatRuntimeTraceStep[];
}): ChatTestCompletionTechnicalStatus {
  const finalDetails = [...input.traceSteps]
    .reverse()
    .find((step) => step.name === 'llm.final')?.details;
  const parseDetails = [...input.traceSteps]
    .reverse()
    .find((step) => step.name === 'answer.parse')?.details;
  const streamStatus = input.assistantMessage.streamStatus ?? null;
  const parseOk = typeof parseDetails?.['ok'] === 'boolean' ? parseDetails['ok'] : null;

  return {
    ok: streamStatus !== 'failed' && parseOk !== false,
    streamStatus,
    ...(input.assistantMessage.errorMessage !== undefined
      ? { errorMessage: input.assistantMessage.errorMessage }
      : {}),
    parseOk,
    finalFinishReason:
      typeof finalDetails?.['finishReason'] === 'string' ? finalDetails['finishReason'] : null,
  };
}

function chatTestCompletionTimeoutMs(streamTimeoutMs: number): number {
  return Math.max(1, streamTimeoutMs - chatTestCompletionTimeoutSafetyMarginMs);
}

export function registerChatRoutes(
  app: FastifyInstance,
  options: RegisterChatRoutesOptions = { streamTimeoutMs: 300_000 }
): void {
  app.get('/conversations', {
    preValidation: requireApprovedUserAuth,
    schema: { querystring: strictEmptyObjectSchema },
    handler: async (request, reply) => {
      const services = getServices();
      const approvedAuthorization = requireApprovedRequestAuthorization(request);
      const result = await listConversations(
        { conversationRepository: services.conversationRepository },
        { userId: approvedAuthorization.userId }
      );
      if (!result.ok) {
        return await failUseCase(reply, result.error);
      }

      return await reply.ok(result.value);
    },
  });

  app.post('/conversations', {
    preValidation: [requireApprovedUserAuth, requireEmptyCreateConversationBody],
    schema: {
      querystring: strictEmptyObjectSchema,
    },
    handler: async (request, reply) => {
      const services = getServices();
      const approvedAuthorization = requireApprovedRequestAuthorization(request);
      const result = await createConversation(
        {
          conversationRepository: services.conversationRepository,
          clock: services.clock,
          generateId: services.generateId,
        },
        { userId: approvedAuthorization.userId }
      );
      if (!result.ok) {
        return await failUseCase(reply, result.error);
      }

      return await reply.ok(result.value, 201);
    },
  });

  app.get('/conversations/:conversationId', {
    preValidation: requireApprovedUserAuth,
    schema: {
      params: chatConversationParamsSchema,
      querystring: strictEmptyObjectSchema,
    },
    handler: async (request, reply) => {
      const { conversationId } = request.params as ConversationParams;
      const services = getServices();
      const approvedAuthorization = requireApprovedRequestAuthorization(request);
      const result = await getConversation(
        { conversationRepository: services.conversationRepository },
        { userId: approvedAuthorization.userId, conversationId }
      );
      if (!result.ok) {
        return await failUseCase(reply, result.error);
      }

      return await reply.ok(result.value);
    },
  });

  app.delete('/conversations/:conversationId', {
    preValidation: requireApprovedUserAuth,
    schema: {
      params: chatConversationParamsSchema,
      querystring: strictEmptyObjectSchema,
    },
    handler: async (request, reply) => {
      const { conversationId } = request.params as ConversationParams;
      const services = getServices();
      const approvedAuthorization = requireApprovedRequestAuthorization(request);
      const result = await deleteConversation(
        {
          conversationRepository: services.conversationRepository,
          clock: services.clock,
        },
        { userId: approvedAuthorization.userId, conversationId }
      );
      if (!result.ok) {
        return await failUseCase(reply, result.error);
      }

      return await reply.ok(result.value);
    },
  });

  app.get('/conversations/:conversationId/messages', {
    preValidation: requireApprovedUserAuth,
    schema: {
      params: chatConversationParamsSchema,
      querystring: strictEmptyObjectSchema,
    },
    handler: async (request, reply) => {
      const { conversationId } = request.params as ConversationParams;
      const services = getServices();
      const approvedAuthorization = requireApprovedRequestAuthorization(request);
      const result = await listConversationMessages(
        {
          conversationRepository: services.conversationRepository,
          messageRepository: services.messageRepository,
        },
        { userId: approvedAuthorization.userId, conversationId }
      );
      if (!result.ok) {
        return await failUseCase(reply, result.error);
      }

      return await reply.ok(result.value);
    },
  });

  app.post('/testing/chat/completions', {
    preValidation: requireChatTestBearerAuth,
    schema: {
      body: chatTestCompletionRequestBodySchema,
      querystring: strictEmptyObjectSchema,
    },
    handler: async (request, reply) => {
      const body = request.body as ChatTestCompletionRequest;
      const services = getServices();
      const activeChatModel = await services.chatModelSettingsManager.resolveActiveChatModel();
      let conversationId = body.conversationId;
      let createdConversation = false;

      if (conversationId === undefined) {
        const created = await createConversation(
          {
            conversationRepository: services.conversationRepository,
            clock: services.clock,
            generateId: services.generateId,
          },
          { userId: body.requester.userId }
        );
        if (!created.ok) {
          return await failUseCase(reply, created.error);
        }
        conversationId = created.value.id;
        createdConversation = true;
      } else {
        const conversation = await getConversation(
          { conversationRepository: services.conversationRepository },
          { userId: body.requester.userId, conversationId }
        );
        if (!conversation.ok) {
          return await failUseCase(reply, conversation.error);
        }
      }

      const started = traceStart(services.clock);
      const traceSteps: ChatRuntimeTraceStep[] = [];
      const traceEvents: ChatTestRuntimeTrace['events'] = [];
      let userMessage: ChatStreamConversationMessage | undefined;
      let assistantMessage: ChatStreamConversationMessage | undefined;
      const abortController = new AbortController();
      const timeout = setTimeout(() => {
        abortController.abort(new Error('Chat test completion timed out'));
      }, chatTestCompletionTimeoutMs(options.streamTimeoutMs));

      try {
        for await (const event of streamChatMessage(
          {
            conversationRepository: services.conversationRepository,
            messageRepository: services.messageRepository,
            messageWriteRepository: services.messageWriteRepository,
            answerGapCandidateRepository: services.answerGapCandidateRepository,
            ragSources: services.ragSources,
            ...(services.answerGapSink !== undefined
              ? { answerGapSink: services.answerGapSink }
              : {}),
            chatProvider: services.chatProvider,
            clock: services.clock,
            generateId: services.generateId,
            chatProviderId: activeChatModel.provider,
            chatModel: activeChatModel.modelId,
            streamWarningLogger: request.log,
            traceSink: { record: (step) => traceSteps.push(step) },
          },
          {
            authorization: toRagAuthorizationContextFromTestRequest(body),
            requester: body.requester,
            conversationId,
            message: body.message,
            signal: abortController.signal,
          }
        )) {
          traceEvents.push({
            type: event.type,
            atMs: Math.max(0, globalThis.performance.now() - started.startedMs),
            data: event.data,
          });
          if (event.type === 'message.created') {
            userMessage = event.data;
          }
          if (event.type === 'answer.final') {
            assistantMessage = event.data;
          }
        }
      } finally {
        clearTimeout(timeout);
      }

      if (userMessage === undefined || assistantMessage === undefined) {
        return await reply.fail('DOWNSTREAM_ERROR', 'Chat test completion did not finish');
      }

      return await reply.ok({
        conversationId,
        createdConversation,
        userMessage,
        assistantMessage,
        trace: traceComplete({
          clock: services.clock,
          startedAt: started.startedAt,
          startedMs: started.startedMs,
          steps: traceSteps,
          events: traceEvents,
        }),
        technicalStatus: chatTestTechnicalStatus({ assistantMessage, traceSteps }),
      } satisfies ChatTestCompletionResponse);
    },
  });

  app.post('/answer-gap-candidates/:candidateId/share', {
    preValidation: requireApprovedUserAuth,
    schema: {
      body: chatAnswerGapCandidateShareBodySchema,
      params: chatAnswerGapCandidateParamsSchema,
      querystring: strictEmptyObjectSchema,
    },
    handler: async (request, reply) => {
      const { candidateId } = request.params as AnswerGapCandidateParams;
      const { includeContext, includeContact } = request.body as AnswerGapCandidateShareBody;
      const services = getServices();
      const approvedAuthorization = requireApprovedRequestAuthorization(request);
      if (services.answerGapSink === undefined) {
        return await reply.fail('INTERNAL_ERROR', 'Answer Gap sharing is not configured');
      }

      const result = await shareAnswerGapCandidate(
        {
          repository: services.answerGapCandidateRepository,
          answerGapSink: services.answerGapSink,
          clock: services.clock,
          resolveShareSnapshot: async ({ candidate, userId, includeContext }) => {
            const messages = await listConversationMessages(
              {
                conversationRepository: services.conversationRepository,
                messageRepository: services.messageRepository,
              },
              { userId, conversationId: candidate.conversation.conversationId }
            );
            if (!messages.ok) {
              return messages;
            }

            return answerGapShareSnapshotFromMessages({
              candidate,
              messages: messages.value,
              includeContext,
            });
          },
        },
        {
          candidateId,
          userId: approvedAuthorization.userId,
          requester: {
            userId: approvedAuthorization.userId,
            email: approvedAuthorization.email,
            firstName: approvedAuthorization.firstName ?? null,
            lastName: approvedAuthorization.lastName ?? null,
            role: approvedAuthorization.role,
            effectiveLevel: approvedAuthorization.effectiveLevel,
          },
          includeContext,
          includeContact,
        }
      );
      if (!result.ok) {
        return await reply.fail(toHttpErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok({
        candidate: answerGapCandidateSummary(result.value.candidate),
        created: result.value.created,
      });
    },
  });

  app.post('/answer-gap-candidates/:candidateId/decline', {
    preValidation: requireApprovedUserAuth,
    schema: {
      body: strictEmptyObjectSchema,
      params: chatAnswerGapCandidateParamsSchema,
      querystring: strictEmptyObjectSchema,
    },
    handler: async (request, reply) => {
      const { candidateId } = request.params as AnswerGapCandidateParams;
      const services = getServices();
      const approvedAuthorization = requireApprovedRequestAuthorization(request);
      const result = await declineAnswerGapCandidate(
        {
          repository: services.answerGapCandidateRepository,
          clock: services.clock,
        },
        { candidateId, userId: approvedAuthorization.userId }
      );
      if (!result.ok) {
        return await reply.fail(toHttpErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok({ candidate: answerGapCandidateSummary(result.value.candidate) });
    },
  });

  app.post('/answer-gap-candidates/:candidateId/withdraw', {
    preValidation: requireApprovedUserAuth,
    schema: {
      body: strictEmptyObjectSchema,
      params: chatAnswerGapCandidateParamsSchema,
      querystring: strictEmptyObjectSchema,
    },
    handler: async (request, reply) => {
      const { candidateId } = request.params as AnswerGapCandidateParams;
      const services = getServices();
      const approvedAuthorization = requireApprovedRequestAuthorization(request);
      if (services.answerGapSink === undefined) {
        return await reply.fail('INTERNAL_ERROR', 'Answer Gap sharing is not configured');
      }
      if (services.answerGapSink.withdrawConsent === undefined) {
        return await reply.fail(
          'INTERNAL_ERROR',
          'Answer Gap sharing withdrawal is not configured'
        );
      }

      const result = await withdrawAnswerGapCandidate(
        {
          repository: services.answerGapCandidateRepository,
          answerGapSink: { withdrawConsent: services.answerGapSink.withdrawConsent },
          clock: services.clock,
        },
        { candidateId, userId: approvedAuthorization.userId }
      );
      if (!result.ok) {
        return await reply.fail(toHttpErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok({ candidate: answerGapCandidateSummary(result.value.candidate) });
    },
  });

  app.post('/conversations/:conversationId/messages/stream', {
    preValidation: requireApprovedUserAuth,
    schema: {
      body: chatStreamRequestBodySchema,
      params: chatConversationParamsSchema,
      querystring: strictEmptyObjectSchema,
    },
    handler: async (request, reply) => {
      const { conversationId } = request.params as ConversationParams;
      const { message } = request.body as ChatStreamBody;
      const services = getServices();
      const approvedAuthorization = requireApprovedRequestAuthorization(request);
      const conversation = await getConversation(
        { conversationRepository: services.conversationRepository },
        { userId: approvedAuthorization.userId, conversationId }
      );
      if (!conversation.ok) {
        return await failUseCase(reply, conversation.error);
      }
      const activeChatModel = await services.chatModelSettingsManager.resolveActiveChatModel();

      const abortController = new AbortController();
      const timeout = setTimeout(() => {
        abortController.abort(new Error('Chat stream timed out'));
      }, options.streamTimeoutMs);
      const abortOnRequestClose = (): void => {
        if (
          shouldAbortOnRequestClose({
            requestDestroyed: request.raw.destroyed,
            requestComplete: request.raw.complete,
            responseWritableEnded: reply.raw.writableEnded,
          })
        ) {
          abortController.abort(new Error('Client disconnected'));
        }
      };
      const abortOnResponseClose = (): void => {
        if (shouldAbortOnResponseClose({ responseWritableEnded: reply.raw.writableEnded })) {
          abortController.abort(new Error('Client disconnected'));
        }
      };
      request.raw.once('close', abortOnRequestClose);
      reply.raw.once('close', abortOnResponseClose);

      reply.hijack();
      const sseFlushPadding = `: ${' '.repeat(2048)}\n\n`;

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const writeEvent = (event: ChatStreamEvent): void => {
        reply.raw.write(`event: ${event.type}\n`);
        reply.raw.write(`data: ${JSON.stringify(event.data)}\n\n`);
      };

      try {
        for await (const event of streamChatMessage(
          {
            conversationRepository: services.conversationRepository,
            messageRepository: services.messageRepository,
            messageWriteRepository: services.messageWriteRepository,
            answerGapCandidateRepository: services.answerGapCandidateRepository,
            ragSources: services.ragSources,
            ...(services.answerGapSink !== undefined
              ? { answerGapSink: services.answerGapSink }
              : {}),
            chatProvider: services.chatProvider,
            clock: services.clock,
            generateId: services.generateId,
            chatProviderId: activeChatModel.provider,
            chatModel: activeChatModel.modelId,
            streamWarningLogger: request.log,
          },
          {
            authorization: toRagAuthorizationContext(approvedAuthorization),
            requester: {
              userId: approvedAuthorization.userId,
              email: approvedAuthorization.email,
              firstName: approvedAuthorization.firstName ?? null,
              lastName: approvedAuthorization.lastName ?? null,
              role: approvedAuthorization.role,
              effectiveLevel: approvedAuthorization.effectiveLevel,
            },
            conversationId,
            message,
            signal: abortController.signal,
          }
        )) {
          if (event.type === 'answer.progress') {
            request.log.info({ conversationId }, 'chat stream progress emitted');
          }
          writeEvent(event);
          if (event.type === 'answer.progress') {
            reply.raw.write(sseFlushPadding);
          }
        }
      } finally {
        clearTimeout(timeout);
        request.raw.off('close', abortOnRequestClose);
        reply.raw.off('close', abortOnResponseClose);
        reply.raw.end();
      }
    },
  });
}

export const chatRouteInternals = {
  conversationIdParam,
  messageFromBody,
  requireEmptyCreateConversationBody,
  shouldAbortOnRequestClose,
  shouldAbortOnResponseClose,
  toHttpErrorCode,
};
