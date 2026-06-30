import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createLocalJWKSet, importJWK, SignJWT, type JWK, type JWTVerifyGetKey } from 'jose';

import {
  extractBearerToken,
  getAuth0JwksCacheSizeForTests,
  readAuth0JwtConfigFromEnv,
  resetAuth0JwksCacheForTests,
  USER_AUTH_UNAUTHORIZED_ERROR,
  verifyAuth0Jwt,
  verifyAuth0JwtFromHeaders,
  verifyAuth0JwtFromHeadersWithKeyResolverForTests,
  verifyAuth0JwtWithKeyResolverForTests,
} from './userAuth.js';

const testKeyId = 'fa-common-http-test-key';

const testPrivateJwk = {
  kty: 'EC',
  x: 'QaUc1Nw1shNc6zWwvO_l6FB--QdztjgqVEcO-Cpa4nQ',
  y: '8ntVy3Y6aQzIsJwI8zcUFctlhhQOKRWPwP-XjxmkIM0',
  crv: 'P-256',
  d: 'S-wCva4CBiI-KMBJqcJVi8F9-kwbS9k6mZuUMjsikls',
  alg: 'ES256',
  kid: testKeyId,
  use: 'sig',
} as const satisfies JWK;

const wrongPrivateJwk = {
  kty: 'EC',
  x: 'KNCHOnZW_5c4zO-brhaDhmpl7-U6IGj_Wtlr-Jj0ph8',
  y: 'Foh9hF_adNwuySod_HeVLC92PnwCe48tUlZZKufip40',
  crv: 'P-256',
  d: 'TcczT8dnLYaPbcmu9fWo4CqaaTMWYI2ygtqY1dKLTAY',
  alg: 'ES256',
  kid: testKeyId,
  use: 'sig',
} as const satisfies JWK;

const testPublicJwk = {
  kty: 'EC',
  x: 'QaUc1Nw1shNc6zWwvO_l6FB--QdztjgqVEcO-Cpa4nQ',
  y: '8ntVy3Y6aQzIsJwI8zcUFctlhhQOKRWPwP-XjxmkIM0',
  crv: 'P-256',
  alg: 'ES256',
  kid: testKeyId,
  use: 'sig',
} as const satisfies JWK;

const auth0Config = {
  issuer: 'https://fa-dev.eu.auth0.com/',
  audience: 'https://api.fishing-assistant.online',
  jwksUri: 'https://fa-dev.eu.auth0.com/.well-known/jwks.json',
};
const auth0CustomClaimNamespace = 'https://intexuraos.cloud/';

let privateKey: CryptoKey | Uint8Array;
let wrongPrivateKey: CryptoKey | Uint8Array;
let localJwksResolver: JWTVerifyGetKey;

async function signTestJwt({
  claims = {},
  issuer = auth0Config.issuer,
  audience = auth0Config.audience,
  expiresInSeconds = 60 * 60,
  signingKey = privateKey,
}: {
  claims?: Record<string, unknown>;
  issuer?: string;
  audience?: string;
  expiresInSeconds?: number;
  signingKey?: CryptoKey | Uint8Array;
} = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({
    sub: 'auth0|user-123',
    email: 'angler@example.com',
    email_verified: true,
    name: 'River Angler',
    ...claims,
  })
    .setProtectedHeader({ alg: 'ES256', kid: testKeyId })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(signingKey);
}

function expectUnauthorized(result: unknown): void {
  expect(result).toEqual({
    ok: false,
    error: USER_AUTH_UNAUTHORIZED_ERROR,
  });
}

describe('Auth0 bearer token extraction', () => {
  it('rejects missing, empty, non-Bearer, and empty Bearer authorization headers', () => {
    expectUnauthorized(extractBearerToken({}));
    expectUnauthorized(extractBearerToken({ authorization: '' }));
    expectUnauthorized(extractBearerToken({ authorization: 'Basic opaque-token' }));
    expectUnauthorized(extractBearerToken({ authorization: 'Bearer   ' }));
  });

  it('extracts a Bearer token from Authorization case-insensitively and from array headers', () => {
    expect(extractBearerToken({ Authorization: 'Bearer token-value' })).toEqual({
      ok: true,
      token: 'token-value',
    });
    expect(
      extractBearerToken({ Authorization: ['Bearer first-token', 'Bearer second-token'] })
    ).toEqual({
      ok: true,
      token: 'first-token',
    });
  });

  it('maps numeric and empty array authorization headers to unauthorized', () => {
    expectUnauthorized(extractBearerToken({ authorization: 42 }));
    expectUnauthorized(extractBearerToken({ authorization: [] }));
  });
});

describe('Auth0 JWT verification', () => {
  beforeAll(async () => {
    privateKey = await importJWK(testPrivateJwk, 'ES256');
    wrongPrivateKey = await importJWK(wrongPrivateJwk, 'ES256');
    localJwksResolver = createLocalJWKSet({ keys: [testPublicJwk] });
  });

  beforeEach(() => {
    resetAuth0JwksCacheForTests();
  });

  afterEach(() => {
    process.env['NODE_ENV'] = 'test';
  });

  it('maps malformed JWTs to one coarse unauthorized error without leaking JOSE internals', async () => {
    const result = await verifyAuth0JwtWithKeyResolverForTests(
      'not-a-jwt',
      auth0Config,
      localJwksResolver
    );

    expectUnauthorized(result);
    expect(JSON.stringify(result)).not.toContain('JWS');
  });

  it('uses real jose issuer validation', async () => {
    const token = await signTestJwt({ issuer: 'https://wrong-tenant.example.com/' });

    const result = await verifyAuth0JwtWithKeyResolverForTests(
      token,
      auth0Config,
      localJwksResolver
    );

    expectUnauthorized(result);
  });

  it('uses real jose audience validation', async () => {
    const token = await signTestJwt({ audience: 'https://wrong-audience.example.com' });

    const result = await verifyAuth0JwtWithKeyResolverForTests(
      token,
      auth0Config,
      localJwksResolver
    );

    expectUnauthorized(result);
  });

  it('uses real jose expiration validation', async () => {
    const token = await signTestJwt({ expiresInSeconds: -60 });

    const result = await verifyAuth0JwtWithKeyResolverForTests(
      token,
      auth0Config,
      localJwksResolver
    );

    expectUnauthorized(result);
  });

  it('uses real jose signature validation', async () => {
    const token = await signTestJwt({ signingKey: wrongPrivateKey });

    const result = await verifyAuth0JwtWithKeyResolverForTests(
      token,
      auth0Config,
      localJwksResolver
    );

    expectUnauthorized(result);
  });

  it('rejects a verified JWT without a non-empty subject using the coarse unauthorized error', async () => {
    const token = await signTestJwt({ claims: { sub: '' } });

    const result = await verifyAuth0JwtWithKeyResolverForTests(
      token,
      auth0Config,
      localJwksResolver
    );

    expectUnauthorized(result);
  });

  it('extracts approved Auth0 identity claims from a valid signed JWT', async () => {
    const token = await signTestJwt({ claims: { ignored_claim: 'ignored' } });

    await expect(
      verifyAuth0JwtWithKeyResolverForTests(token, auth0Config, localJwksResolver)
    ).resolves.toEqual({
      ok: true,
      identity: {
        subject: 'auth0|user-123',
        email: 'angler@example.com',
        emailVerified: true,
        name: 'River Angler',
      },
    });
  });

  it('prefers namespaced Auth0 API claims over bare profile claims', async () => {
    const token = await signTestJwt({
      claims: {
        email: 'bare@example.com',
        email_verified: false,
        name: 'Bare Name',
        [`${auth0CustomClaimNamespace}email`]: 'namespaced@example.com',
        [`${auth0CustomClaimNamespace}email_verified`]: true,
        [`${auth0CustomClaimNamespace}name`]: 'Namespaced Name',
      },
    });

    await expect(
      verifyAuth0JwtWithKeyResolverForTests(token, auth0Config, localJwksResolver)
    ).resolves.toEqual({
      ok: true,
      identity: {
        subject: 'auth0|user-123',
        email: 'namespaced@example.com',
        emailVerified: true,
        name: 'Namespaced Name',
      },
    });
  });

  it('omits blank or non-Auth0 optional claims from a valid signed JWT identity', async () => {
    const token = await signTestJwt({
      claims: {
        email: ' ',
        email_verified: 'yes',
        name: ' ',
      },
    });

    await expect(
      verifyAuth0JwtWithKeyResolverForTests(token, auth0Config, localJwksResolver)
    ).resolves.toEqual({
      ok: true,
      identity: {
        subject: 'auth0|user-123',
      },
    });
  });

  it('verifies the bearer token from request headers with a local JWKS resolver', async () => {
    const token = await signTestJwt({ claims: { sub: 'auth0|header-user', name: null } });

    await expect(
      verifyAuth0JwtFromHeadersWithKeyResolverForTests(
        { authorization: `Bearer ${token}` },
        auth0Config,
        localJwksResolver
      )
    ).resolves.toEqual({
      ok: true,
      identity: {
        subject: 'auth0|header-user',
        email: 'angler@example.com',
        emailVerified: true,
        name: null,
      },
    });
  });

  it('maps missing bearer tokens from public and test-only header verifiers to unauthorized', async () => {
    await expect(verifyAuth0JwtFromHeaders({}, auth0Config)).resolves.toEqual({
      ok: false,
      error: USER_AUTH_UNAUTHORIZED_ERROR,
    });
    await expect(
      verifyAuth0JwtFromHeadersWithKeyResolverForTests({}, auth0Config, localJwksResolver)
    ).resolves.toEqual({
      ok: false,
      error: USER_AUTH_UNAUTHORIZED_ERROR,
    });
  });

  it('rejects direct test resolver use outside NODE_ENV test', async () => {
    process.env['NODE_ENV'] = 'production';

    expect(() => {
      void verifyAuth0JwtWithKeyResolverForTests('token', auth0Config, localJwksResolver);
    }).toThrow('Auth0 JWT test resolver helpers are only available in test');
    await expect(
      verifyAuth0JwtFromHeadersWithKeyResolverForTests(
        { authorization: 'Bearer token' },
        auth0Config,
        localJwksResolver
      )
    ).rejects.toThrow('Auth0 JWT test resolver helpers are only available in test');
  });

  it('keeps the production JWKS cache reset seam separate from injected local JWKS verification', async () => {
    expect(getAuth0JwksCacheSizeForTests()).toBe(0);

    await verifyAuth0Jwt('not-a-jwt', auth0Config);
    await verifyAuth0Jwt('still-not-a-jwt', auth0Config);

    expect(getAuth0JwksCacheSizeForTests()).toBe(1);

    await verifyAuth0Jwt('not-a-jwt-for-other-tenant', {
      ...auth0Config,
      jwksUri: 'https://fa-prod.eu.auth0.com/.well-known/jwks.json',
    });

    expect(getAuth0JwksCacheSizeForTests()).toBe(2);

    resetAuth0JwksCacheForTests();

    expect(getAuth0JwksCacheSizeForTests()).toBe(0);
    expect(await verifyAuth0Jwt('not-a-jwt-after-reset', auth0Config)).toEqual({
      ok: false,
      error: USER_AUTH_UNAUTHORIZED_ERROR,
    });
  });
});

describe('Auth0 JWT backend config', () => {
  it('reads verifier config from FA backend env names and ignores browser-only Auth0 fields', () => {
    expect(
      readAuth0JwtConfigFromEnv({
        FA_AUTH0_ISSUER: auth0Config.issuer,
        FA_AUTH0_AUDIENCE: auth0Config.audience,
        FA_AUTH0_JWKS_URI: auth0Config.jwksUri,
        FA_AUTH0_DOMAIN: 'browser-only-domain',
        FA_AUTH0_CLIENT_ID: 'browser-only-client-id',
      })
    ).toEqual(auth0Config);
  });

  it('does not treat browser-only Auth0 env as sufficient for backend JWT verification', () => {
    expect(() =>
      readAuth0JwtConfigFromEnv({
        FA_AUTH0_DOMAIN: 'browser-only-domain',
        FA_AUTH0_CLIENT_ID: 'browser-only-client-id',
        FA_AUTH0_AUDIENCE: auth0Config.audience,
      })
    ).toThrow('Auth0 JWT verification is not configured');
  });
});
