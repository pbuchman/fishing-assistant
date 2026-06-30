import type { ErrorCode } from '@fa/common-core';

import { apiErrorBodySchema } from './errors.js';

export interface ApiSuccessEnvelope<T> {
  ok: true;
  data: T;
}

export interface ApiErrorEnvelope {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

export const apiSuccessEnvelopeSchema = {
  type: 'object',
  required: ['ok', 'data'],
  additionalProperties: false,
  properties: {
    ok: { const: true },
    data: {},
  },
} as const;

export const apiErrorEnvelopeSchema = {
  type: 'object',
  required: ['ok', 'error'],
  additionalProperties: false,
  properties: {
    ok: { const: false },
    error: apiErrorBodySchema,
  },
} as const;
