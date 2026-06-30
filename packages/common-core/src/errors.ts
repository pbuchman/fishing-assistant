export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PRECONDITION_FAILED'
  | 'UNPROCESSABLE_ENTITY'
  | 'RATE_LIMITED'
  | 'DOWNSTREAM_ERROR'
  | 'INTERNAL_ERROR'
  | 'MISCONFIGURED';

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
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

export class FaError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'FaError';
    this.code = code;
    this.httpStatus = ERROR_HTTP_STATUS[code];
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export interface SerializedError {
  message: string;
  name?: string;
  stack?: string;
  code?: string;
  errno?: number;
  syscall?: string;
  cause?: SerializedError;
}

const MAX_STACK_LENGTH = 2000;
const MAX_CAUSE_DEPTH = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error) {
    return error.message.length > 0 ? error.message : fallback;
  }

  if (typeof error === 'string') {
    return error.length > 0 ? error : fallback;
  }

  if (isRecord(error)) {
    const message = error['message'];
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }

    const details = error['details'];
    if (typeof details === 'string' && details.length > 0) {
      return details;
    }
  }

  return fallback;
}

export function serializeError(error: unknown, depth = 0): SerializedError {
  if (!(error instanceof Error)) {
    const message = getErrorMessage(error);
    if (!isRecord(error)) {
      return { message };
    }

    return {
      message,
      ...(typeof error['name'] === 'string' ? { name: error['name'] } : {}),
      ...(typeof error['code'] === 'string' ? { code: error['code'] } : {}),
    };
  }

  const serialized: SerializedError = {
    message: getErrorMessage(error),
    name: error.name,
  };

  if (error.stack !== undefined) {
    serialized.stack =
      error.stack.length > MAX_STACK_LENGTH ? error.stack.slice(0, MAX_STACK_LENGTH) : error.stack;
  }

  const errorWithFields = error as Error & {
    code?: unknown;
    errno?: unknown;
    syscall?: unknown;
  };

  if (typeof errorWithFields.code === 'string') {
    serialized.code = errorWithFields.code;
  }

  if (typeof errorWithFields.errno === 'number') {
    serialized.errno = errorWithFields.errno;
  }

  if (typeof errorWithFields.syscall === 'string') {
    serialized.syscall = errorWithFields.syscall;
  }

  if (error.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    serialized.cause = serializeError(error.cause, depth + 1);
  }

  return serialized;
}
