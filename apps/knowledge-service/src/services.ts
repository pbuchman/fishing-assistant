import { randomUUID } from 'node:crypto';

import { FaError, systemClock, type Clock } from '@fa/common-core';
import {
  verifyAuth0JwtFromHeaders,
  type Auth0JwtVerificationConfig,
  type Auth0JwtVerificationResult,
} from '@fa/common-http';
import { createUserServiceClient, type UserServiceClient } from '@fa/internal-clients';
import { createAppLogger } from '@fa/infra-observability';
import { createLlmProviders } from '@fa/llm-factory';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionStreamEvent,
  EmbeddingRequest,
  EmbeddingResponse,
  LlmChatProvider,
  LlmEmbeddingProvider,
} from '@fa/llm-contract';
import { HttpInternalAuthUsageSink } from '@fa/llm-pricing';

import { createDefaultServiceConfig, loadConfig } from './config.js';
import type { AnswerGapRepository } from './domain/repositories/answerGapRepository.js';
import type {
  KnowledgeAccessRefreshRepository,
  KnowledgeNodeRepository,
  KnowledgePageCascadeRepository,
  KnowledgePageChunkRepository,
  KnowledgePageRepository,
} from './domain/repositories/knowledgeRepositories.js';
import { KnowledgeAccessRefreshExecutor } from './domain/usecases/accessRefresh.js';
import type { EmbeddingConfig } from './domain/usecases/syncDocument.js';
import { FirestoreAnswerGapRepository } from './infra/firestore/firestoreAnswerGapRepository.js';
import { FirestoreKnowledgeAccessRefreshRepository } from './infra/firestore/firestoreAccessRefreshRepository.js';
import { FirestoreKnowledgeChunkRepository } from './infra/firestore/firestoreKnowledgeChunkRepository.js';
import { FirestoreKnowledgeNodeRepository } from './infra/firestore/firestoreKnowledgeNodeRepository.js';
import { FirestoreKnowledgePageCascadeRepository } from './infra/firestore/firestoreKnowledgePageCascadeRepository.js';
import { FirestoreKnowledgePageRepository } from './infra/firestore/firestoreKnowledgePageRepository.js';
import { MemoryKnowledgeAccessRefreshRepository } from './infra/memory/memoryAccessRefreshRepository.js';
import { MemoryAnswerGapRepository } from './infra/memory/memoryAnswerGapRepository.js';
import {
  MemoryKnowledgeNodeRepository,
  MemoryKnowledgePageCascadeRepository,
  MemoryKnowledgePageChunkRepository,
  MemoryKnowledgePageRepository,
} from './infra/memory/memoryKnowledgeRepositories.js';

type HeaderValue = string | readonly string[] | number | undefined;

export type Auth0JwtVerifier = (
  headers: Record<string, HeaderValue>,
  config: Auth0JwtVerificationConfig
) => Promise<Auth0JwtVerificationResult>;

export interface ServiceContainer {
  serviceName: string;
  accessRefreshRepository: KnowledgeAccessRefreshRepository;
  answerGapRepository: AnswerGapRepository;
  nodeRepository: KnowledgeNodeRepository;
  pageRepository: KnowledgePageRepository;
  pageChunkRepository: KnowledgePageChunkRepository;
  pageCascadeRepository: KnowledgePageCascadeRepository;
  accessRefreshExecutor: { start(): void; stop(): void };
  embeddingProvider: LlmEmbeddingProvider;
  queryEmbeddingProvider: LlmEmbeddingProvider;
  syncEmbeddingProvider: LlmEmbeddingProvider;
  chatProvider: LlmChatProvider;
  embeddingConfig: EmbeddingConfig;
  clock: Clock;
  generateId: () => string;
  auth0JwtVerifier: Auth0JwtVerifier;
  userServiceClient: UserServiceClient;
}

let services: ServiceContainer | null = null;

class MisconfiguredEmbeddingProvider implements LlmEmbeddingProvider {
  embed(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return Promise.reject(
      new FaError('MISCONFIGURED', 'Knowledge Service embedding provider has not been configured')
    );
  }
}

class MisconfiguredChatProvider implements LlmChatProvider {
  complete(_request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return Promise.reject(
      new FaError('MISCONFIGURED', 'Knowledge Service chat provider has not been configured')
    );
  }

  stream(_request: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamEvent> {
    throw new FaError('MISCONFIGURED', 'Knowledge Service chat provider has not been configured');
  }
}

const noopAccessRefreshExecutor = {
  start() {
    // No-op test/default lifecycle; runtime services install the real executor.
  },
  stop() {
    // No-op test/default lifecycle; runtime services install the real executor.
  },
};

function createServiceContainer(overrides: Partial<ServiceContainer> = {}): ServiceContainer {
  const embeddingProvider = overrides.embeddingProvider ?? new MisconfiguredEmbeddingProvider();
  const nodeRepository = overrides.nodeRepository ?? new MemoryKnowledgeNodeRepository();
  const pageRepository = overrides.pageRepository ?? new MemoryKnowledgePageRepository();
  const pageChunkRepository =
    overrides.pageChunkRepository ??
    new MemoryKnowledgePageChunkRepository(
      pageRepository instanceof MemoryKnowledgePageRepository ? pageRepository : undefined
    );
  const memoryAccessRefreshRepositories: {
    pages?: MemoryKnowledgePageRepository;
    chunks?: MemoryKnowledgePageChunkRepository;
  } = {};
  if (pageRepository instanceof MemoryKnowledgePageRepository) {
    memoryAccessRefreshRepositories.pages = pageRepository;
  }
  if (pageChunkRepository instanceof MemoryKnowledgePageChunkRepository) {
    memoryAccessRefreshRepositories.chunks = pageChunkRepository;
  }
  const accessRefreshRepository =
    overrides.accessRefreshRepository ??
    new MemoryKnowledgeAccessRefreshRepository(memoryAccessRefreshRepositories);
  return {
    serviceName: overrides.serviceName ?? 'knowledge-service',
    accessRefreshRepository,
    answerGapRepository: overrides.answerGapRepository ?? new MemoryAnswerGapRepository(),
    nodeRepository,
    pageRepository,
    pageChunkRepository,
    pageCascadeRepository:
      overrides.pageCascadeRepository ??
      new MemoryKnowledgePageCascadeRepository({
        nodes:
          nodeRepository instanceof MemoryKnowledgeNodeRepository
            ? nodeRepository
            : new MemoryKnowledgeNodeRepository(),
        pages:
          pageRepository instanceof MemoryKnowledgePageRepository
            ? pageRepository
            : new MemoryKnowledgePageRepository(),
        chunks:
          pageChunkRepository instanceof MemoryKnowledgePageChunkRepository
            ? pageChunkRepository
            : new MemoryKnowledgePageChunkRepository(),
      }),
    accessRefreshExecutor: overrides.accessRefreshExecutor ?? noopAccessRefreshExecutor,
    embeddingProvider,
    queryEmbeddingProvider: overrides.queryEmbeddingProvider ?? embeddingProvider,
    syncEmbeddingProvider: overrides.syncEmbeddingProvider ?? embeddingProvider,
    chatProvider: overrides.chatProvider ?? new MisconfiguredChatProvider(),
    embeddingConfig: overrides.embeddingConfig ?? createDefaultServiceConfig().embeddingConfig,
    clock: overrides.clock ?? systemClock,
    generateId: overrides.generateId ?? randomUUID,
    auth0JwtVerifier: overrides.auth0JwtVerifier ?? verifyAuth0JwtFromHeaders,
    userServiceClient:
      overrides.userServiceClient ??
      ({
        resolveAuthorization() {
          return Promise.reject(
            new FaError(
              'MISCONFIGURED',
              'Knowledge Service user authorization client is not configured'
            )
          );
        },
        lookupUserIdentities() {
          return Promise.reject(
            new FaError('MISCONFIGURED', 'Knowledge Service user identity client is not configured')
          );
        },
      } satisfies UserServiceClient),
  };
}

function createRuntimeEmbeddingProvider(input: {
  env: NodeJS.ProcessEnv;
  logger: ReturnType<typeof createAppLogger>;
  component: string;
}): LlmEmbeddingProvider {
  const usageSink = new HttpInternalAuthUsageSink({
    service: 'knowledge-service',
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
  }).embeddings;
}

function createRuntimeChatProvider(input: {
  env: NodeJS.ProcessEnv;
  logger: ReturnType<typeof createAppLogger>;
  component: string;
}): LlmChatProvider {
  const usageSink = new HttpInternalAuthUsageSink({
    service: 'knowledge-service',
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

export function initServices(overrides: Partial<ServiceContainer> = {}): ServiceContainer {
  services = createServiceContainer(overrides);
  return services;
}

export function initRuntimeServices(env: NodeJS.ProcessEnv = process.env): ServiceContainer {
  const logger = createAppLogger({ service: 'knowledge-service' });
  const config = loadConfig(env);
  const nodeRepository = new FirestoreKnowledgeNodeRepository();
  const pageRepository = new FirestoreKnowledgePageRepository();
  const pageChunkRepository = new FirestoreKnowledgeChunkRepository();
  const pageCascadeRepository = new FirestoreKnowledgePageCascadeRepository();
  const accessRefreshRepository = new FirestoreKnowledgeAccessRefreshRepository();
  const answerGapRepository = new FirestoreAnswerGapRepository();
  const embeddingProvider = createRuntimeEmbeddingProvider({
    env,
    logger,
    component: 'knowledge-embedding',
  });
  const queryEmbeddingProvider = createRuntimeEmbeddingProvider({
    env,
    logger,
    component: 'query-embedding',
  });
  const syncEmbeddingProvider = createRuntimeEmbeddingProvider({
    env,
    logger,
    component: 'knowledge-sync',
  });
  services = createServiceContainer({
    accessRefreshRepository,
    answerGapRepository,
    nodeRepository,
    pageRepository,
    pageChunkRepository,
    pageCascadeRepository,
    accessRefreshExecutor: new KnowledgeAccessRefreshExecutor({
      accessRefreshRepository,
      pageRepository,
      pageChunkRepository,
      clock: systemClock,
      leaseOwnerId: `knowledge-service-${randomUUID()}`,
      logger,
    }),
    embeddingProvider,
    queryEmbeddingProvider,
    syncEmbeddingProvider,
    chatProvider: createRuntimeChatProvider({
      env,
      logger,
      component: 'knowledge-admin',
    }),
    userServiceClient: createUserServiceClient({
      baseUrl: env['FA_USER_SERVICE_INTERNAL_URL'] ?? '',
      internalAuthToken: env['FA_INTERNAL_AUTH_TOKEN'] ?? '',
    }),
    embeddingConfig: config.embeddingConfig,
  });
  return services;
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
