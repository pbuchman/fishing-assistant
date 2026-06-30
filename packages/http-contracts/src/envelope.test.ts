import { describe, expect, it } from 'vitest';

import {
  apiErrorEnvelopeSchema,
  apiSuccessEnvelopeSchema,
  type ApiErrorEnvelope,
  type ApiSuccessEnvelope,
} from './envelope.js';
import { apiErrorBodySchema, ERROR_CODE_VALUES } from './errors.js';
import { INTERNAL_AUTH_HEADER } from './internalAuth.js';

describe('HTTP envelope contracts', () => {
  it('defines the success envelope shape', () => {
    const envelope: ApiSuccessEnvelope<{ id: string }> = {
      ok: true,
      data: { id: 'conversation-1' },
    };

    expect(envelope).toEqual({ ok: true, data: { id: 'conversation-1' } });
    expect(apiSuccessEnvelopeSchema).toMatchObject({
      type: 'object',
      required: ['ok', 'data'],
      properties: {
        ok: { const: true },
      },
    });
  });

  it('defines the error envelope shape with optional details', () => {
    const envelope: ApiErrorEnvelope = {
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'bad bait',
        details: { field: 'bait' },
      },
    };

    expect(envelope).toEqual({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'bad bait',
        details: { field: 'bait' },
      },
    });
    expect(apiErrorEnvelopeSchema).toMatchObject({
      type: 'object',
      required: ['ok', 'error'],
      properties: {
        ok: { const: false },
        error: apiErrorBodySchema,
      },
    });
  });

  it('keeps error code values aligned with the Phase 2 code set', () => {
    expect(ERROR_CODE_VALUES).toEqual([
      'INVALID_REQUEST',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'PRECONDITION_FAILED',
      'UNPROCESSABLE_ENTITY',
      'RATE_LIMITED',
      'DOWNSTREAM_ERROR',
      'INTERNAL_ERROR',
      'MISCONFIGURED',
    ]);
  });

  it('exports the lowercase internal auth header name', () => {
    expect(INTERNAL_AUTH_HEADER).toBe('x-internal-auth');
  });
});
