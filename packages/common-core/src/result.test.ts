import { describe, expect, it } from 'vitest';

import { err, isErr, isOk, ok, type Result } from './result.js';

describe('Result helpers', () => {
  it('creates an ok result with a readonly value', () => {
    expect(ok({ id: 'catch-1' })).toEqual({
      ok: true,
      value: { id: 'catch-1' },
    });
  });

  it('creates an err result with a readonly error', () => {
    const error = new Error('line snapped');

    expect(err(error)).toEqual({
      ok: false,
      error,
    });
  });

  it('narrows ok and err result values', () => {
    const results: Result<string>[] = [ok('brook trout'), err(new Error('no evidence'))];

    const values = results.filter(isOk).map((result) => result.value.toUpperCase());
    const errors = results.filter(isErr).map((result) => result.error.message);

    expect(values).toEqual(['BROOK TROUT']);
    expect(errors).toEqual(['no evidence']);
  });
});
