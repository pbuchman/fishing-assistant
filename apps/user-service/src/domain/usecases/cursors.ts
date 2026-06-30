import { err, ok, type Result } from '@fa/common-core';

import type { UserListCursor } from '../repositories/userRepositories.js';

export interface CursorError {
  code: 'INVALID_REQUEST';
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDateTime(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function encodeUserListCursor(cursor: UserListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeUserListCursor(encoded: string): Result<UserListCursor, CursorError> {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
      return err({ code: 'INVALID_REQUEST', message: 'Cursor is malformed.' });
    }

    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!isRecord(parsed)) {
      return err({ code: 'INVALID_REQUEST', message: 'Cursor payload must be an object.' });
    }

    const { sortValue, id } = parsed;
    if (typeof sortValue !== 'string' || typeof id !== 'string' || id.length === 0) {
      return err({ code: 'INVALID_REQUEST', message: 'Cursor payload is missing fields.' });
    }

    if (!isIsoDateTime(sortValue)) {
      return err({ code: 'INVALID_REQUEST', message: 'Cursor sort value must be ISO date-time.' });
    }

    return ok({ sortValue, id });
  } catch {
    return err({ code: 'INVALID_REQUEST', message: 'Cursor is malformed.' });
  }
}

export function normalizeUserListLimit(
  rawLimit: number | string | undefined
): Result<number, CursorError> {
  if (rawLimit === undefined) {
    return ok(50);
  }

  const limit = typeof rawLimit === 'string' ? Number(rawLimit) : rawLimit;
  if (!Number.isInteger(limit) || limit < 1) {
    return err({ code: 'INVALID_REQUEST', message: 'Limit must be a positive integer.' });
  }

  return ok(Math.min(limit, 200));
}
