import type { Logger, Clock } from '@fa/common-core';
import { type Auth0JwtVerificationConfig, type Auth0JwtVerificationResult } from '@fa/common-http';
import type { Auth0IdentityClaims } from '@fa/http-contracts';
import { expect, vi } from 'vitest';

import { verifyAuth0JwtFromHeadersWithKeyResolverForTests } from '../../../../packages/common-http/src/userAuth.js';
import type { FaUser } from '../domain/models/user.js';
import { MemoryUserRepository } from '../infra/memory/memoryUserRepository.js';
import type { ServiceContainer } from '../services.js';

export const testNow = '2026-06-17T10:00:00.000Z';
export const laterNow = '2026-06-17T11:00:00.000Z';

export const auth0Config: Auth0JwtVerificationConfig = {
  issuer: 'https://fa-test.eu.auth0.com/',
  audience: 'https://api.fishing-assistant.test',
  jwksUri: 'https://fa-test.eu.auth0.com/.well-known/jwks.json',
};

const testKeyId = 'fa-user-service-route-test-key';

const testPrivateJwk = {
  kty: 'EC',
  x: 'QaUc1Nw1shNc6zWwvO_l6FB--QdztjgqVEcO-Cpa4nQ',
  y: '8ntVy3Y6aQzIsJwI8zcUFctlhhQOKRWPwP-XjxmkIM0',
  crv: 'P-256',
  d: 'S-wCva4CBiI-KMBJqcJVi8F9-kwbS9k6mZuUMjsikls',
  alg: 'ES256',
  kid: testKeyId,
  use: 'sig',
} as const satisfies Record<string, unknown>;

const testPublicJwk = {
  kty: 'EC',
  x: 'QaUc1Nw1shNc6zWwvO_l6FB--QdztjgqVEcO-Cpa4nQ',
  y: '8ntVy3Y6aQzIsJwI8zcUFctlhhQOKRWPwP-XjxmkIM0',
  crv: 'P-256',
  alg: 'ES256',
  kid: testKeyId,
  use: 'sig',
} as const satisfies Record<string, unknown>;

const silentLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

type TestKeyResolver = Parameters<typeof verifyAuth0JwtFromHeadersWithKeyResolverForTests>[2];

interface SignJwtBuilder {
  setProtectedHeader(header: Record<string, unknown>): SignJwtBuilder;
  setIssuer(issuer: string): SignJwtBuilder;
  setAudience(audience: string): SignJwtBuilder;
  setIssuedAt(value: number): SignJwtBuilder;
  setExpirationTime(value: number): SignJwtBuilder;
  sign(key: CryptoKey | Uint8Array): Promise<string>;
}

interface JoseForTests {
  createLocalJWKSet(input: { keys: readonly Record<string, unknown>[] }): TestKeyResolver;
  importJWK(jwk: Record<string, unknown>, alg: string): Promise<CryptoKey | Uint8Array>;
  SignJWT: new (claims: Record<string, unknown>) => SignJwtBuilder;
}

let privateKey: CryptoKey | Uint8Array | null = null;
let localJwksResolver: TestKeyResolver | null = null;

async function loadJoseForTests(): Promise<JoseForTests> {
  return (await import(
    // @ts-expect-error test-only import through common-http's linked dependency.
    '../../../../packages/common-http/node_modules/jose/dist/webapi/index.js'
  )) as JoseForTests;
}

export async function setupJwtVerifier(): Promise<void> {
  const jose = await loadJoseForTests();
  privateKey ??= await jose.importJWK(testPrivateJwk, 'ES256');
  localJwksResolver ??= jose.createLocalJWKSet({ keys: [testPublicJwk] });
}

export async function signJwt(
  overrides: Partial<Auth0IdentityClaims> & {
    omitEmail?: boolean;
    omitEmailVerified?: boolean;
  } = {}
): Promise<string> {
  await setupJwtVerifier();
  if (privateKey === null) {
    throw new Error('JWT signing key was not initialized');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    sub: overrides.subject ?? 'auth0|user-1',
    name: overrides.name ?? 'Route Tester',
  };

  if (overrides.email !== undefined) {
    claims['email'] = overrides.email;
  } else if (!overrides.omitEmail) {
    claims['email'] = 'user@example.com';
  }

  if (overrides.emailVerified !== undefined) {
    claims['email_verified'] = overrides.emailVerified;
  } else if (!overrides.omitEmailVerified) {
    claims['email_verified'] = true;
  }

  const jose = await loadJoseForTests();
  return await new jose.SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: testKeyId })
    .setIssuer(auth0Config.issuer)
    .setAudience(auth0Config.audience)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 60 * 60)
    .sign(privateKey);
}

export function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

export function configureAuthEnv(): void {
  process.env['NODE_ENV'] = 'test';
  process.env['FA_AUTH0_ISSUER'] = auth0Config.issuer;
  process.env['FA_AUTH0_AUDIENCE'] = auth0Config.audience;
  process.env['FA_AUTH0_JWKS_URI'] = auth0Config.jwksUri;
  process.env['FA_INTERNAL_AUTH_TOKEN'] = 'internal-token';
  delete process.env['FA_INTERNAL_AUTH_TOKEN_PREVIOUS'];
}

export function ids(values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `generated-${String(index)}`;
}

export function mutableClock(now: string = testNow): Clock & { set(value: string): void } {
  let current = now;
  return {
    now: () => new Date(current),
    set: (value: string) => {
      current = value;
    },
  };
}

export function makeUser(overrides: Partial<FaUser> = {}): FaUser {
  return {
    id: 'user-1',
    auth0Subject: 'auth0|user-1',
    email: 'user@example.com',
    normalizedEmail: 'user@example.com',
    firstName: null,
    lastName: null,
    mobileNumber: null,
    role: 'user',
    level: null,
    status: 'profile_required',
    statusBeforeSuspension: null,
    createdAt: '2026-06-16T09:00:00.000Z',
    updatedAt: '2026-06-16T09:00:00.000Z',
    approvedAt: null,
    suspendedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

export function adminUser(overrides: Partial<FaUser> = {}): FaUser {
  return makeUser({
    id: 'admin-1',
    auth0Subject: 'auth0|admin-1',
    email: 'admin@example.com',
    normalizedEmail: 'admin@example.com',
    firstName: 'Ada',
    lastName: 'Admin',
    mobileNumber: '+15550101000',
    role: 'admin',
    level: null,
    status: 'approved',
    approvedAt: '2026-06-16T09:00:00.000Z',
    ...overrides,
  });
}

export function completeUser(overrides: Partial<FaUser> = {}): FaUser {
  const id = overrides.id ?? 'target-1';
  return makeUser({
    id,
    auth0Subject: `auth0|${id}`,
    email: `${id}@example.com`,
    normalizedEmail: `${id}@example.com`,
    firstName: 'Tara',
    lastName: 'Target',
    mobileNumber: '+15550101000',
    status: 'pending',
    ...overrides,
  });
}

export function routeServices(
  input: {
    repository?: MemoryUserRepository;
    clock?: Clock;
    bootstrapAdminEmails?: string[];
    selfSignupAllowedEmailPattern?: RegExp;
    ids?: string[];
    eventIds?: string[];
  } = {}
): ServiceContainer & { userRepository: MemoryUserRepository } {
  const repository = input.repository ?? new MemoryUserRepository();
  const resolver = localJwksResolver;
  if (resolver === null) {
    throw new Error('JWT verifier was not initialized');
  }

  return {
    serviceName: 'user-service',
    logger: silentLogger,
    userRepository: repository,
    bootstrapAdminEmails: new Set(input.bootstrapAdminEmails ?? []),
    selfSignupAllowedEmailPattern:
      input.selfSignupAllowedEmailPattern ?? /^[^@\s]+\+allowed@example\.com$/u,
    clock: input.clock ?? mutableClock(),
    generateId: ids(input.ids ?? ['created-user']),
    generateEventId: ids(input.eventIds ?? ['event-1', 'event-2', 'event-3', 'event-4']),
    securityLogHashKey: 'internal-token',
    auth0JwtVerifier: (
      headers: Record<string, string | readonly string[] | number | undefined>,
      config: Auth0JwtVerificationConfig
    ): Promise<Auth0JwtVerificationResult> =>
      verifyAuth0JwtFromHeadersWithKeyResolverForTests(headers, config, resolver),
    logIdentityConflict: vi.fn(),
  };
}

interface JsonResponse<Body> {
  json(): Body;
}

export function expectError(
  response: { statusCode: number } & JsonResponse<{ ok: false; error: { code: string } }>,
  code: string
): void {
  const body = response.json();
  expect(body).toMatchObject({ ok: false, error: { code } });
}

export function expectData<T>(response: JsonResponse<{ ok: true; data: T }>): T {
  return response.json().data;
}
