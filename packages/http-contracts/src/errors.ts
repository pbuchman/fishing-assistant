import type { ErrorCode } from '@fa/common-core';

export const ERROR_CODE_VALUES = [
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
] as const satisfies readonly ErrorCode[];

export const apiErrorBodySchema = {
  type: 'object',
  required: ['code', 'message'],
  additionalProperties: false,
  properties: {
    code: { type: 'string', enum: ERROR_CODE_VALUES },
    message: { type: 'string' },
    details: {},
  },
} as const;

export type { ErrorCode };
