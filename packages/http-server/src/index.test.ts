import { expect, test } from 'vitest';

import {
  computeOverallHealth,
  createServiceApp,
  findMissingEnv,
  validateRequiredEnv,
} from '@fa/http-server';

test('exports http-server utilities', () => {
  expect(findMissingEnv(['FA_ENVIRONMENT'], {})).toEqual(['FA_ENVIRONMENT']);
  expect(() => {
    validateRequiredEnv([], {});
  }).not.toThrow();
  expect(computeOverallHealth([])).toBe('ok');
  expect(createServiceApp).toEqual(expect.any(Function));
});
