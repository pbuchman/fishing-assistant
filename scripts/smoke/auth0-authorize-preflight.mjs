#!/usr/bin/env node
// @ts-check

import { createHash, randomBytes } from 'node:crypto';

/**
 * @param {string} name
 * @returns {string}
 */
function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

/**
 * @param {Buffer} buffer
 * @returns {string}
 */
function base64Url(buffer) {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/**
 * @param {string} domain
 * @returns {string}
 */
function normalizeAuth0Origin(domain) {
  if (/^https?:\/\//.test(domain)) {
    return new URL(domain).origin;
  }

  return new URL(`https://${domain}`).origin;
}

function buildAuthorizeUrl() {
  const auth0Origin = normalizeAuth0Origin(requiredEnv('FA_AUTH0_DOMAIN'));
  const publicOrigin = new URL(requiredEnv('FA_PUBLIC_ORIGIN')).origin;
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());
  const authorizeUrl = new URL('/authorize', auth0Origin);

  authorizeUrl.searchParams.set('audience', requiredEnv('FA_AUTH0_AUDIENCE'));
  authorizeUrl.searchParams.set('client_id', requiredEnv('FA_AUTH0_CLIENT_ID'));
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('nonce', base64Url(randomBytes(16)));
  authorizeUrl.searchParams.set('redirect_uri', `${publicOrigin}/app#/auth/callback`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'openid profile email');
  authorizeUrl.searchParams.set('state', base64Url(randomBytes(16)));

  return { auth0Origin, publicOrigin, authorizeUrl };
}

/**
 * @param {URL} location
 * @returns {string | null}
 */
function errorFromCallbackUrl(location) {
  const searchError = location.searchParams.get('error');
  if (searchError !== null) {
    return searchError;
  }

  const hashQueryIndex = location.hash.indexOf('?');
  if (hashQueryIndex === -1) {
    return null;
  }

  return new URLSearchParams(location.hash.slice(hashQueryIndex + 1)).get('error');
}

async function run() {
  const { auth0Origin, publicOrigin, authorizeUrl } = buildAuthorizeUrl();
  const response = await fetch(authorizeUrl, { redirect: 'manual' });
  const locationHeader = response.headers.get('location');

  if (locationHeader !== null) {
    const location = new URL(locationHeader, auth0Origin);
    const callbackError = location.origin === publicOrigin ? errorFromCallbackUrl(location) : null;
    if (callbackError !== null) {
      throw new Error(`Auth0 authorize returned ${callbackError}`);
    }

    if (location.origin === auth0Origin) {
      process.stdout.write(`Auth0 authorize preflight passed for ${publicOrigin}\n`);
      return;
    }

    throw new Error(`Auth0 authorize redirected to unexpected origin: ${location.origin}`);
  }

  if (response.ok) {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      process.stdout.write(`Auth0 authorize preflight passed for ${publicOrigin}\n`);
      return;
    }
  }

  throw new Error(`Auth0 authorize failed: ${response.status} ${response.statusText}`);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Auth0 authorize preflight failed: ${message}\n`);
  process.exit(1);
});
