import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INTERNAL_AUTH_HEADER } from '@fa/http-contracts';

import { validateInternalAuth } from './internalAuth.js';

vi.mock('node:crypto', () => ({
  timingSafeEqual: vi.fn((left: Uint8Array, right: Uint8Array) =>
    Buffer.from(left).equals(Buffer.from(right))
  ),
}));

const tokenEnv = {
  FA_INTERNAL_AUTH_TOKEN: 'current-token',
  FA_INTERNAL_AUTH_TOKEN_PREVIOUS: 'previous-token',
};

const timingSafeEqualMock = vi.mocked(timingSafeEqual);

function authHeaders(token: string): Record<string, string> {
  return { [INTERNAL_AUTH_HEADER]: token };
}

describe('internal auth validation', () => {
  beforeEach(() => {
    timingSafeEqualMock.mockClear();
  });

  it('reports not_configured when the current token is missing', () => {
    expect(validateInternalAuth({}, {})).toEqual({
      valid: false,
      reason: 'not_configured',
    });
    expect(timingSafeEqualMock).not.toHaveBeenCalled();
  });

  it('reports not_configured when the current token is empty', () => {
    expect(
      validateInternalAuth(authHeaders('previous-token'), {
        FA_INTERNAL_AUTH_TOKEN: '',
        FA_INTERNAL_AUTH_TOKEN_PREVIOUS: 'previous-token',
      })
    ).toEqual({
      valid: false,
      reason: 'not_configured',
    });
    expect(timingSafeEqualMock).not.toHaveBeenCalled();
  });

  it('rejects a missing header as a token mismatch', () => {
    expect(validateInternalAuth({}, tokenEnv)).toEqual({
      valid: false,
      reason: 'token_mismatch',
    });
    expect(timingSafeEqualMock).not.toHaveBeenCalled();
  });

  it('rejects a wrong token with the same length using timing-safe comparison', () => {
    expect(validateInternalAuth(authHeaders('current-tokxn'), tokenEnv)).toEqual({
      valid: false,
      reason: 'token_mismatch',
    });
    expect(timingSafeEqualMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong token with a different length without throwing', () => {
    let result: ReturnType<typeof validateInternalAuth> | undefined;

    expect(() => {
      result = validateInternalAuth(authHeaders('short'), tokenEnv);
    }).not.toThrow();
    expect(result).toEqual({
      valid: false,
      reason: 'token_mismatch',
    });
    expect(timingSafeEqualMock).not.toHaveBeenCalled();
  });

  it('accepts the configured current token using timing-safe comparison', () => {
    expect(validateInternalAuth(authHeaders('current-token'), tokenEnv)).toEqual({
      valid: true,
      tokenUsed: 'current',
    });
    expect(timingSafeEqualMock).toHaveBeenCalledTimes(1);
  });

  it('accepts the optional previous token during rotation using timing-safe comparison', () => {
    expect(validateInternalAuth(authHeaders('previous-token'), tokenEnv)).toEqual({
      valid: true,
      tokenUsed: 'previous',
    });
    expect(timingSafeEqualMock).toHaveBeenCalledTimes(1);
  });
});
