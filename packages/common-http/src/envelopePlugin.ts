import { ERROR_HTTP_STATUS, type ErrorCode } from '@fa/common-core';
import type { ApiErrorEnvelope, ApiSuccessEnvelope } from '@fa/http-contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyReply {
    // The generic preserves caller payload type in the public Fastify reply contract.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    ok<T>(data: T, statusCode?: number): FastifyReply;
    fail(code: ErrorCode, message: string, details?: unknown): FastifyReply;
  }
}

export function createSuccessEnvelope<T>(data: T): ApiSuccessEnvelope<T> {
  return { ok: true, data };
}

export function createErrorEnvelope(
  code: ErrorCode,
  message: string,
  details?: unknown
): ApiErrorEnvelope {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

function okReply(this: FastifyReply, data: unknown, statusCode = 200): FastifyReply {
  return this.status(statusCode).send(createSuccessEnvelope(data));
}

function failReply(
  this: FastifyReply,
  code: ErrorCode,
  message: string,
  details?: unknown
): FastifyReply {
  return this.status(ERROR_HTTP_STATUS[code]).send(createErrorEnvelope(code, message, details));
}

export function registerEnvelopePlugin(app: FastifyInstance): void {
  if (!app.hasReplyDecorator('ok')) {
    app.decorateReply('ok', okReply);
  }

  if (!app.hasReplyDecorator('fail')) {
    app.decorateReply('fail', failReply);
  }
}
