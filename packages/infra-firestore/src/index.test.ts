import { expect, test } from 'vitest';

import { firestoreHealthCheck, resetFirestore, setFirestore } from '@fa/infra-firestore';

test('exports Firestore infrastructure utilities', () => {
  expect(firestoreHealthCheck).toEqual(expect.any(Function));
  expect(resetFirestore).toEqual(expect.any(Function));
  expect(setFirestore).toEqual(expect.any(Function));
});
