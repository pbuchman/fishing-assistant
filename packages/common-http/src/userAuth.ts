import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';

import type { Auth0IdentityClaims } from '@fa/http-contracts';

type HeaderValue = string | readonly string[] | number | undefined;
type HeaderSource = Record<string, HeaderValue>;

export interface Auth0JwtVerificationConfig {
  issuer: string;
  audience: string;
  jwksUri: string;
}

export const USER_AUTH_UNAUTHORIZED_ERROR = {
  statusCode: 401,
  code: 'UNAUTHORIZED',
  message: 'Unauthorized',
} as const;

export type UserAuthUnauthorizedError = typeof USER_AUTH_UNAUTHORIZED_ERROR;

export interface UserAuthFailure {
  ok: false;
  error: UserAuthUnauthorizedError;
}

export type BearerTokenResult =
  | {
      ok: true;
      token: string;
    }
  | UserAuthFailure;

export type Auth0JwtVerificationResult =
  | {
      ok: true;
      identity: Auth0IdentityClaims;
    }
  | UserAuthFailure;

const jwksClientCache = new Map<string, JWTVerifyGetKey>();
const auth0CustomClaimNamespace = 'https://intexuraos.cloud/';

function unauthorized(): UserAuthFailure {
  return {
    ok: false,
    error: USER_AUTH_UNAUTHORIZED_ERROR,
  };
}

function firstHeaderValue(value: HeaderValue): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  return value?.[0];
}

function findHeaderValue(headers: HeaderSource, headerName: string): string | undefined {
  const expected = headerName.toLowerCase();

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === expected) {
      return firstHeaderValue(value);
    }
  }

  return undefined;
}

function getJwksClient(jwksUri: string): JWTVerifyGetKey {
  const cached = jwksClientCache.get(jwksUri);
  if (cached !== undefined) {
    return cached;
  }

  const client = createRemoteJWKSet(new URL(jwksUri));
  jwksClientCache.set(jwksUri, client);
  return client;
}

function readRequiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim() ?? '';
  if (value === '') {
    throw new Error('Auth0 JWT verification is not configured');
  }

  return value;
}

function readStringClaim(payload: JWTPayload, name: string): string | undefined {
  const namespaced = payload[`${auth0CustomClaimNamespace}${name}`];
  if (typeof namespaced === 'string' && namespaced.trim() !== '') {
    return namespaced;
  }

  const bare = payload[name];
  return typeof bare === 'string' && bare.trim() !== '' ? bare : undefined;
}

function readBooleanClaim(payload: JWTPayload, name: string): boolean | undefined {
  const namespaced = payload[`${auth0CustomClaimNamespace}${name}`];
  if (typeof namespaced === 'boolean') {
    return namespaced;
  }

  const bare = payload[name];
  return typeof bare === 'boolean' ? bare : undefined;
}

function identityFromPayload(payload: JWTPayload): Auth0IdentityClaims | undefined {
  const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (subject === '') {
    return undefined;
  }

  const identity: Auth0IdentityClaims = { subject };

  const email = readStringClaim(payload, 'email');
  if (email !== undefined) {
    identity.email = email;
  }

  const emailVerified = readBooleanClaim(payload, 'email_verified');
  if (emailVerified !== undefined) {
    identity.emailVerified = emailVerified;
  }

  const name = readStringClaim(payload, 'name');
  if (name !== undefined) {
    identity.name = name;
  } else if (payload[`${auth0CustomClaimNamespace}name`] === null || payload['name'] === null) {
    identity.name = null;
  }

  return identity;
}

export function resetAuth0JwksCacheForTests(): void {
  jwksClientCache.clear();
}

export function getAuth0JwksCacheSizeForTests(): number {
  return jwksClientCache.size;
}

export function readAuth0JwtConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Auth0JwtVerificationConfig {
  return {
    issuer: readRequiredEnv(env, 'FA_AUTH0_ISSUER'),
    audience: readRequiredEnv(env, 'FA_AUTH0_AUDIENCE'),
    jwksUri: readRequiredEnv(env, 'FA_AUTH0_JWKS_URI'),
  };
}

export function extractBearerToken(headers: HeaderSource): BearerTokenResult {
  const authorization = findHeaderValue(headers, 'authorization')?.trim() ?? '';
  if (authorization === '') {
    return unauthorized();
  }

  const bearerMatch = /^Bearer\s+(.+)$/iu.exec(authorization);
  const token = bearerMatch?.[1]?.trim() ?? '';
  if (token === '') {
    return unauthorized();
  }

  return {
    ok: true,
    token,
  };
}

async function verifyAuth0JwtWithKeyResolver(
  token: string,
  config: Auth0JwtVerificationConfig,
  keyResolver: JWTVerifyGetKey
): Promise<Auth0JwtVerificationResult> {
  if (token.trim() === '') {
    return unauthorized();
  }

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, keyResolver, {
      issuer: config.issuer,
      audience: config.audience,
    });
    payload = result.payload;
  } catch {
    return unauthorized();
  }

  const identity = identityFromPayload(payload);
  if (identity === undefined) {
    return unauthorized();
  }

  return {
    ok: true,
    identity,
  };
}

function assertTestResolverAllowed(): void {
  if (process.env['NODE_ENV'] !== 'test') {
    throw new Error('Auth0 JWT test resolver helpers are only available in test');
  }
}

export function verifyAuth0Jwt(
  token: string,
  config: Auth0JwtVerificationConfig
): Promise<Auth0JwtVerificationResult> {
  return verifyAuth0JwtWithKeyResolver(token, config, getJwksClient(config.jwksUri));
}

export async function verifyAuth0JwtFromHeaders(
  headers: HeaderSource,
  config: Auth0JwtVerificationConfig
): Promise<Auth0JwtVerificationResult> {
  const bearerToken = extractBearerToken(headers);
  if (!bearerToken.ok) {
    return bearerToken;
  }

  return await verifyAuth0Jwt(bearerToken.token, config);
}

export function verifyAuth0JwtWithKeyResolverForTests(
  token: string,
  config: Auth0JwtVerificationConfig,
  keyResolver: JWTVerifyGetKey
): Promise<Auth0JwtVerificationResult> {
  assertTestResolverAllowed();
  return verifyAuth0JwtWithKeyResolver(token, config, keyResolver);
}

export async function verifyAuth0JwtFromHeadersWithKeyResolverForTests(
  headers: HeaderSource,
  config: Auth0JwtVerificationConfig,
  keyResolver: JWTVerifyGetKey
): Promise<Auth0JwtVerificationResult> {
  assertTestResolverAllowed();
  const bearerToken = extractBearerToken(headers);
  if (!bearerToken.ok) {
    return bearerToken;
  }

  return await verifyAuth0JwtWithKeyResolver(bearerToken.token, config, keyResolver);
}
