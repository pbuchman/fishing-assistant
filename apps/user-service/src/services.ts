import { randomUUID } from 'node:crypto';

import { systemClock, type Clock, type Logger } from '@fa/common-core';
import {
  verifyAuth0JwtFromHeaders,
  type Auth0JwtVerificationConfig,
  type Auth0JwtVerificationResult,
} from '@fa/common-http';
import { createAppLogger } from '@fa/infra-observability';

import { serviceName } from './config.js';
import type { IdentityConflictLogEvent } from './domain/usecases/bootstrapUser.js';
import type { UserRepository } from './domain/repositories/userRepositories.js';
import { FirestoreUserRepository } from './infra/firestore/firestoreUserRepository.js';
import { MemoryUserRepository } from './infra/memory/memoryUserRepository.js';

type HeaderValue = string | readonly string[] | number | undefined;

export type Auth0JwtVerifier = (
  headers: Record<string, HeaderValue>,
  config: Auth0JwtVerificationConfig
) => Promise<Auth0JwtVerificationResult>;

export interface ServiceContainer {
  serviceName: string;
  logger: Logger;
  userRepository: UserRepository;
  bootstrapAdminEmails: ReadonlySet<string>;
  selfSignupAllowedEmailPattern: RegExp;
  clock: Clock;
  generateId: () => string;
  generateEventId: () => string;
  securityLogHashKey: string;
  auth0JwtVerifier: Auth0JwtVerifier;
  logIdentityConflict: (event: IdentityConflictLogEvent) => void;
}

let services: ServiceContainer | null = null;

function parseBootstrapAdminEmails(rawValue: string | undefined): ReadonlySet<string> {
  return new Set(
    (rawValue ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0)
  );
}

function parseSignupAllowedEmailPattern(rawValue: string | undefined): RegExp {
  const value = rawValue?.trim() ?? '';
  if (value.length === 0) {
    return /$a/;
  }

  try {
    return new RegExp(value, 'u');
  } catch (error) {
    throw new Error(
      `Invalid FA_SIGNUP_ALLOWED_EMAIL_PATTERN: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function createServiceContainer(overrides: Partial<ServiceContainer> = {}): ServiceContainer {
  const logger = overrides.logger ?? createAppLogger({ service: serviceName });
  return {
    serviceName: overrides.serviceName ?? serviceName,
    logger,
    userRepository: overrides.userRepository ?? new MemoryUserRepository(),
    bootstrapAdminEmails: overrides.bootstrapAdminEmails ?? new Set<string>(),
    selfSignupAllowedEmailPattern: overrides.selfSignupAllowedEmailPattern ?? /$a/,
    clock: overrides.clock ?? systemClock,
    generateId: overrides.generateId ?? randomUUID,
    generateEventId: overrides.generateEventId ?? randomUUID,
    securityLogHashKey: overrides.securityLogHashKey ?? '',
    auth0JwtVerifier: overrides.auth0JwtVerifier ?? verifyAuth0JwtFromHeaders,
    logIdentityConflict:
      overrides.logIdentityConflict ??
      ((event) => {
        logger.warn(event, 'User identity conflict');
      }),
  };
}

export function initServices(overrides: Partial<ServiceContainer> = {}): ServiceContainer {
  services = createServiceContainer(overrides);
  return services;
}

export function initRuntimeServices(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<ServiceContainer> = {}
): ServiceContainer {
  services = createServiceContainer({
    ...overrides,
    logger: overrides.logger ?? createAppLogger({ service: serviceName }),
    userRepository: new FirestoreUserRepository(),
    bootstrapAdminEmails: parseBootstrapAdminEmails(env['FA_BOOTSTRAP_ADMIN_EMAILS']),
    selfSignupAllowedEmailPattern: parseSignupAllowedEmailPattern(
      env['FA_SIGNUP_ALLOWED_EMAIL_PATTERN']
    ),
    securityLogHashKey: env['FA_INTERNAL_AUTH_TOKEN'] ?? '',
  });
  return services;
}

export function getServices(): ServiceContainer {
  services ??= initServices();
  return services;
}

export function setServices(next: ServiceContainer): void {
  services = next;
}

export function resetServices(): void {
  services = null;
}
