import { describe, expect, it } from 'vitest';

import {
  ERROR_HTTP_STATUS,
  FaError,
  getErrorMessage,
  serializeError,
  type ErrorCode,
} from './errors.js';

describe('FA errors', () => {
  it('maps stable error codes to HTTP statuses', () => {
    const expected: Record<ErrorCode, number> = {
      INVALID_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      PRECONDITION_FAILED: 412,
      UNPROCESSABLE_ENTITY: 422,
      RATE_LIMITED: 429,
      DOWNSTREAM_ERROR: 502,
      INTERNAL_ERROR: 500,
      MISCONFIGURED: 503,
    };

    expect(ERROR_HTTP_STATUS).toEqual(expected);
  });

  it('preserves code, message, HTTP status, and optional details', () => {
    const details = { field: 'FA_INTERNAL_AUTH_TOKEN' };
    const error = new FaError('MISCONFIGURED', 'missing token', details);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('FaError');
    expect(error.code).toBe('MISCONFIGURED');
    expect(error.message).toBe('missing token');
    expect(error.httpStatus).toBe(503);
    expect(error.details).toBe(details);
  });

  it('extracts useful messages from unknown error values', () => {
    expect(getErrorMessage(new Error('hooked'))).toBe('hooked');
    expect(getErrorMessage('plain string')).toBe('plain string');
    expect(getErrorMessage({ message: 'object message' })).toBe('object message');
    expect(getErrorMessage({ details: 'detail message' })).toBe('detail message');
    expect(getErrorMessage('', 'fallback')).toBe('fallback');
    expect(getErrorMessage({ message: '' }, 'fallback')).toBe('fallback');
    expect(getErrorMessage(null, 'fallback')).toBe('fallback');
  });

  it('serializes Error objects, codes, and nested causes without throwing', () => {
    const cause = Object.assign(new Error('socket refused'), { code: 'ECONNREFUSED' });
    const error = Object.assign(new Error('downstream failed', { cause }), {
      code: 'DOWNSTREAM_ERROR',
    });

    const serialized = serializeError(error);

    expect(serialized).toMatchObject({
      message: 'downstream failed',
      name: 'Error',
      code: 'DOWNSTREAM_ERROR',
      cause: {
        message: 'socket refused',
        name: 'Error',
        code: 'ECONNREFUSED',
      },
    });
    expect(serialized.stack).toEqual(expect.any(String));
  });

  it('serializes errno, syscall, missing stack, and long stacks', () => {
    const error = Object.assign(new Error('fs failed'), {
      errno: -2,
      syscall: 'open',
    });
    delete error.stack;

    expect(serializeError(error)).toEqual({
      message: 'fs failed',
      name: 'Error',
      errno: -2,
      syscall: 'open',
    });

    const longStackError = new Error('long stack');
    longStackError.stack = 's'.repeat(2500);

    expect(serializeError(longStackError).stack).toHaveLength(2000);
  });

  it('serializes non-Error values without throwing', () => {
    expect(
      serializeError({ message: 'object message', name: 'CustomError', code: 'CUSTOM' })
    ).toEqual({
      message: 'object message',
      name: 'CustomError',
      code: 'CUSTOM',
    });
    expect(serializeError('string failure')).toEqual({ message: 'string failure' });
  });
});
