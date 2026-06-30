import { expect, test } from 'vitest';

import * as commonHttp from '@fa/common-http';
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  REDACTED_HEADER_VALUE,
  USER_AUTH_UNAUTHORIZED_ERROR,
  validateInternalAuth,
  verifyAuth0JwtFromHeaders,
} from '@fa/common-http';

test('exports common HTTP helpers', () => {
  expect(createSuccessEnvelope({ ok: true })).toEqual({ ok: true, data: { ok: true } });
  expect(createErrorEnvelope('NOT_FOUND', 'missing')).toEqual({
    ok: false,
    error: { code: 'NOT_FOUND', message: 'missing' },
  });
  expect(validateInternalAuth({}, {})).toEqual({ valid: false, reason: 'not_configured' });
  expect(REDACTED_HEADER_VALUE).toBe('[REDACTED]');
  expect(USER_AUTH_UNAUTHORIZED_ERROR).toEqual({
    statusCode: 401,
    code: 'UNAUTHORIZED',
    message: 'Unauthorized',
  });
  expect(typeof verifyAuth0JwtFromHeaders).toBe('function');
});

test('does not export test-only Auth0 JWT resolver seams from the package root', () => {
  expect(commonHttp).not.toHaveProperty('verifyAuth0JwtWithKeyResolverForTests');
  expect(commonHttp).not.toHaveProperty('verifyAuth0JwtFromHeadersWithKeyResolverForTests');
  expect(commonHttp).not.toHaveProperty('getAuth0JwksCacheSizeForTests');
});
