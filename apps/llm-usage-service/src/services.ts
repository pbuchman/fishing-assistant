import type { Logger } from '@fa/common-core';
import {
  verifyAuth0JwtFromHeaders,
  type Auth0JwtVerificationConfig,
  type Auth0JwtVerificationResult,
} from '@fa/common-http';
import { createAppLogger } from '@fa/infra-observability';
import { createUserServiceClient, type UserServiceClient } from '@fa/internal-clients';

import type { PricingRepository } from './domain/repositories/pricingRepository.js';
import type { UsageAggregateRepository } from './domain/repositories/usageAggregateRepository.js';
import type { UsageEventRepository } from './domain/repositories/usageEventRepository.js';
import { createPricingCache, type PricingCache } from './domain/services/pricingCache.js';
import { FirestorePricingRepository } from './infra/firestore/firestorePricingRepository.js';
import { FirestoreUsageAggregateRepository } from './infra/firestore/firestoreUsageAggregateRepository.js';
import { FirestoreUsageEventRepository } from './infra/firestore/firestoreUsageEventRepository.js';

type HeaderValue = string | readonly string[] | number | undefined;

export type Auth0JwtVerifier = (
  headers: Record<string, HeaderValue>,
  config: Auth0JwtVerificationConfig
) => Promise<Auth0JwtVerificationResult>;

export interface ServiceContainer {
  serviceName: string;
  usageEventRepository: UsageEventRepository;
  usageAggregateRepository: UsageAggregateRepository;
  pricingRepository: PricingRepository;
  pricingCache: PricingCache;
  logger: Logger;
  auth0JwtVerifier: Auth0JwtVerifier;
  userServiceClient: UserServiceClient;
}

let services: ServiceContainer | null = null;

export function initServices(overrides: Partial<ServiceContainer> = {}): ServiceContainer {
  const pricingRepository = overrides.pricingRepository ?? new FirestorePricingRepository();

  services = {
    serviceName: overrides.serviceName ?? 'llm-usage-service',
    usageEventRepository: overrides.usageEventRepository ?? new FirestoreUsageEventRepository(),
    usageAggregateRepository:
      overrides.usageAggregateRepository ?? new FirestoreUsageAggregateRepository(),
    pricingRepository,
    pricingCache: overrides.pricingCache ?? createPricingCache(pricingRepository),
    logger: overrides.logger ?? createAppLogger({ service: 'llm-usage-service' }),
    auth0JwtVerifier: overrides.auth0JwtVerifier ?? verifyAuth0JwtFromHeaders,
    userServiceClient:
      overrides.userServiceClient ??
      createUserServiceClient({
        baseUrl: process.env['FA_USER_SERVICE_INTERNAL_URL'] ?? '',
        internalAuthToken: process.env['FA_INTERNAL_AUTH_TOKEN'] ?? '',
      }),
  };
  return services;
}

export function getServices(): ServiceContainer {
  services ??= initServices();
  return services;
}

export function setServices(next: Partial<ServiceContainer>): void {
  services = initServices(next);
}

export function resetServices(): void {
  services = null;
}
