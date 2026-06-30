import { expect, test } from 'vitest';

import { FaError, fixedClock, getLogLevel, ok } from '@fa/common-core';

test('exports common-core public utilities', () => {
  expect(ok('value')).toEqual({ ok: true, value: 'value' });
  expect(new FaError('NOT_FOUND', 'missing').httpStatus).toBe(404);
  expect(getLogLevel({ NODE_ENV: 'production' })).toBe('info');
  expect(fixedClock(new Date('2026-06-13T00:00:00.000Z')).now().toISOString()).toBe(
    '2026-06-13T00:00:00.000Z'
  );
});
