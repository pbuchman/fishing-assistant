import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

import { INTERNAL_AUTH_HEADER } from '@fa/http-contracts';

export interface InternalAuthResult {
  valid: boolean;
  reason?: 'not_configured' | 'token_mismatch';
  tokenUsed?: 'current' | 'previous';
}

type HeaderValue = string | readonly string[] | undefined;
type HeaderSource = Record<string, HeaderValue>;

function firstHeaderValue(value: HeaderValue): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  return value?.[0];
}

function tokenMatchesHeader(headerValue: string | undefined, configuredToken: string): boolean {
  if (headerValue === undefined) {
    return false;
  }

  const headerBuffer = Buffer.from(headerValue);
  const configuredBuffer = Buffer.from(configuredToken);
  if (headerBuffer.length !== configuredBuffer.length) {
    return false;
  }

  return timingSafeEqual(headerBuffer, configuredBuffer);
}

export function validateInternalAuth(
  headers: HeaderSource,
  env: NodeJS.ProcessEnv = process.env
): InternalAuthResult {
  const current = env['FA_INTERNAL_AUTH_TOKEN'] ?? '';
  if (current === '') {
    return { valid: false, reason: 'not_configured' };
  }

  const headerValue = firstHeaderValue(headers[INTERNAL_AUTH_HEADER]);
  if (tokenMatchesHeader(headerValue, current)) {
    return { valid: true, tokenUsed: 'current' };
  }

  const previous = env['FA_INTERNAL_AUTH_TOKEN_PREVIOUS'] ?? '';
  if (previous !== '' && tokenMatchesHeader(headerValue, previous)) {
    return { valid: true, tokenUsed: 'previous' };
  }

  return { valid: false, reason: 'token_mismatch' };
}
