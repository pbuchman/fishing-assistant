import { randomUUID } from 'node:crypto';

import { FaError, systemClock, type Clock } from '@fa/common-core';
import {
  verifyAuth0JwtFromHeaders,
  type Auth0JwtVerificationConfig,
  type Auth0JwtVerificationResult,
} from '@fa/common-http';
import {
  createKnowledgeServiceClient,
  createUserServiceClient,
  type KnowledgeServiceClient,
  type UserServiceClient,
} from '@fa/internal-clients';
import { createAppLogger } from '@fa/infra-observability';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionStreamEvent,
  LlmChatProvider,
} from '@fa/llm-contract';
import { DEFAULT_CHAT_MODEL, createLlmProviders, resolveLlmProviderConfig } from '@fa/llm-factory';
import { HttpInternalAuthUsageSink } from '@fa/llm-pricing';

import {
  createChatModelSettingsManager,
  type ChatModelSettingsLogger,
  type ChatModelSettingsManager,
} from './domain/usecases/chatModelSettings.js';
import type {
  ConversationMessageRepository,
  ConversationMessageWriteRepository,
  ConversationRepository,
} from './domain/repositories/chatRepositories.js';
import type { AnswerGapCandidateRepository } from './domain/repositories/answerGapCandidateRepository.js';
import type { ChatSettingsRepository } from './domain/repositories/chatSettingsRepository.js';
import type { RagSource } from './domain/rag/rag.js';
import type { AnswerGapSink } from './domain/usecases/streamChatMessage.js';
import { FirestoreAnswerGapCandidateRepository } from './infra/firestore/firestoreAnswerGapCandidateRepository.js';
import { FirestoreChatSettingsRepository } from './infra/firestore/firestoreChatSettingsRepository.js';
import { FirestoreConversationMessageRepository } from './infra/firestore/firestoreConversationMessageRepository.js';
import { FirestoreConversationMessageWriteRepository } from './infra/firestore/firestoreConversationMessageWriteRepository.js';
import { FirestoreConversationRepository } from './infra/firestore/firestoreConversationRepository.js';
import { createRagSources } from './infra/http/knowledgeServiceRagSource.js';
import { MemoryAnswerGapCandidateRepository } from './infra/memory/memoryAnswerGapCandidateRepository.js';
import { MemoryChatSettingsRepository } from './infra/memory/memoryChatSettingsRepository.js';
import {
  MemoryConversationMessageRepository,
  MemoryConversationMessageWriteRepository,
  MemoryConversationRepository,
} from './infra/memory/memoryChatRepositories.js';

type HeaderValue = string | readonly string[] | number | undefined;

export type Auth0JwtVerifier = (
  headers: Record<string, HeaderValue>,
  config: Auth0JwtVerificationConfig
) => Promise<Auth0JwtVerificationResult>;

export interface ServiceContainer {
  serviceName: string;
  conversationRepository: ConversationRepository;
  messageRepository: ConversationMessageRepository;
  messageWriteRepository: ConversationMessageWriteRepository;
  answerGapCandidateRepository: AnswerGapCandidateRepository;
  ragSources: readonly RagSource[];
  answerGapSink?: AnswerGapSink;
  chatProvider: LlmChatProvider;
  clock: Clock;
  generateId: () => string;
  chatModel: string;
  chatSettingsRepository: ChatSettingsRepository;
  chatModelSettingsManager: ChatModelSettingsManager;
  auth0JwtVerifier: Auth0JwtVerifier;
  userServiceClient: UserServiceClient;
}

interface ServiceContainerOverrides extends Partial<ServiceContainer> {
  chatModelSettingsLogger?: ChatModelSettingsLogger;
}

let services: ServiceContainer | null = null;

const noopChatModelSettingsLogger: ChatModelSettingsLogger = {
  warn() {
    // Test containers should not write logs by default.
  },
};

class MisconfiguredChatProvider implements LlmChatProvider {
  complete(_request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return Promise.reject(
      new FaError('MISCONFIGURED', 'Chat Service provider has not been configured')
    );
  }

  stream(_request: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamEvent> {
    const error = new FaError('MISCONFIGURED', 'Chat Service provider has not been configured');

    return {
      [Symbol.asyncIterator](): AsyncIterator<ChatCompletionStreamEvent> {
        return {
          next: () => Promise.reject(error),
        };
      },
    };
  }
}

function createServiceContainer(overrides: ServiceContainerOverrides = {}): ServiceContainer {
  const chatProvider = overrides.chatProvider ?? new MisconfiguredChatProvider();
  const conversationRepository =
    overrides.conversationRepository ?? new MemoryConversationRepository();
  const messageRepository =
    overrides.messageRepository ?? new MemoryConversationMessageRepository();
  const answerGapCandidateRepository =
    overrides.answerGapCandidateRepository ?? new MemoryAnswerGapCandidateRepository();
  const chatModel = overrides.chatModel ?? DEFAULT_CHAT_MODEL;
  const clock = overrides.clock ?? systemClock;
  const chatSettingsRepository =
    overrides.chatSettingsRepository ?? new MemoryChatSettingsRepository();
  return {
    serviceName: overrides.serviceName ?? 'chat-service',
    conversationRepository,
    messageRepository,
    messageWriteRepository:
      overrides.messageWriteRepository ??
      (conversationRepository instanceof MemoryConversationRepository &&
      messageRepository instanceof MemoryConversationMessageRepository
        ? new MemoryConversationMessageWriteRepository(conversationRepository, messageRepository)
        : new MisconfiguredConversationMessageWriteRepository()),
    answerGapCandidateRepository,
    ragSources: overrides.ragSources ?? [],
    ...(overrides.answerGapSink !== undefined ? { answerGapSink: overrides.answerGapSink } : {}),
    chatProvider,
    clock,
    generateId: overrides.generateId ?? randomUUID,
    chatModel,
    chatSettingsRepository,
    chatModelSettingsManager:
      overrides.chatModelSettingsManager ??
      createChatModelSettingsManager({
        repository: chatSettingsRepository,
        clock,
        logger: overrides.chatModelSettingsLogger ?? noopChatModelSettingsLogger,
      }),
    auth0JwtVerifier: overrides.auth0JwtVerifier ?? verifyAuth0JwtFromHeaders,
    userServiceClient:
      overrides.userServiceClient ??
      ({
        resolveAuthorization() {
          return Promise.reject(
            new FaError('MISCONFIGURED', 'Chat Service user authorization client is not configured')
          );
        },
        lookupUserIdentities() {
          return Promise.reject(
            new FaError('MISCONFIGURED', 'Chat Service user identity client is not configured')
          );
        },
      } satisfies UserServiceClient),
  };
}

class MisconfiguredConversationMessageWriteRepository implements ConversationMessageWriteRepository {
  appendToActiveConversation(): ReturnType<
    ConversationMessageWriteRepository['appendToActiveConversation']
  > {
    return Promise.resolve({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Chat Service message write repository has not been configured',
      },
    });
  }
}

export function initServices(overrides: ServiceContainerOverrides = {}): ServiceContainer {
  services = createServiceContainer(overrides);
  return services;
}

function createRuntimeChatProvider(input: {
  env: NodeJS.ProcessEnv;
  component: 'rag-chat';
  logger: ReturnType<typeof createAppLogger>;
}): LlmChatProvider {
  const usageSink = new HttpInternalAuthUsageSink({
    service: 'chat-service',
    component: input.component,
    usageServiceUrl: input.env['FA_LLM_USAGE_SERVICE_INTERNAL_URL'] ?? '',
    internalAuthToken: input.env['FA_INTERNAL_AUTH_TOKEN'] ?? '',
    logger: input.logger,
    maxBatchSize: 1,
  });

  return createLlmProviders({
    env: input.env,
    usageSink,
    logger: input.logger,
  }).chat;
}

export function initRuntimeServices(env: NodeJS.ProcessEnv = process.env): ServiceContainer {
  const logger = createAppLogger({ service: 'chat-service' });
  const llmConfig = resolveLlmProviderConfig(env);
  const knowledgeServiceClient = createKnowledgeServiceClient({
    baseUrl: env['FA_KNOWLEDGE_SERVICE_INTERNAL_URL'] ?? '',
    internalAuthToken: env['FA_INTERNAL_AUTH_TOKEN'] ?? '',
  });

  services = createServiceContainer({
    conversationRepository: new FirestoreConversationRepository(),
    messageRepository: new FirestoreConversationMessageRepository(),
    messageWriteRepository: new FirestoreConversationMessageWriteRepository(),
    answerGapCandidateRepository: new FirestoreAnswerGapCandidateRepository(),
    chatSettingsRepository: new FirestoreChatSettingsRepository(),
    chatModelSettingsLogger: logger,
    ragSources: createRagSources({ knowledgeServiceClient }),
    answerGapSink: createKnowledgeServiceAnswerGapSink(knowledgeServiceClient),
    userServiceClient: createUserServiceClient({
      baseUrl: env['FA_USER_SERVICE_INTERNAL_URL'] ?? '',
      internalAuthToken: env['FA_INTERNAL_AUTH_TOKEN'] ?? '',
    }),
    chatProvider: createRuntimeChatProvider({ env, component: 'rag-chat', logger }),
    chatModel: llmConfig.chat.model,
  });
  return services;
}

function createKnowledgeServiceAnswerGapSink(
  knowledgeServiceClient: KnowledgeServiceClient
): AnswerGapSink {
  return {
    async create(input, options) {
      await knowledgeServiceClient.createAnswerGap(input, options);
    },
    async withdrawConsent(input, options) {
      await knowledgeServiceClient.withdrawAnswerGapConsent(input, options);
    },
  };
}

export function getServices(): ServiceContainer {
  services ??= initServices();
  return services;
}

export function setServices(next: Partial<ServiceContainer>): void {
  services = createServiceContainer(next);
}

export function resetServices(): void {
  services = null;
}
