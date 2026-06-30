import { describe, expect, it, vi } from 'vitest';

import { firestoreHealthCheck } from './health.js';

describe('Firestore health check', () => {
  it('returns ok in test env without touching Firestore', async () => {
    const getFirestore = vi.fn(() => {
      throw new Error('should not be called');
    });

    const check = firestoreHealthCheck(getFirestore, { NODE_ENV: 'test' });

    await expect(check.check()).resolves.toEqual({ ok: true });
    expect(getFirestore).not.toHaveBeenCalled();
  });

  it('returns down when getFirestore throws', async () => {
    const check = firestoreHealthCheck(
      () => {
        throw new Error('missing credentials');
      },
      { NODE_ENV: 'production' }
    );

    await expect(check.check()).resolves.toEqual({
      ok: false,
      detail: 'missing credentials',
    });
  });

  it('performs a lightweight _health_check/ping read outside tests', async () => {
    const get = vi.fn(() => Promise.resolve({ exists: false }));
    const doc = vi.fn(() => ({ get }));
    const collection = vi.fn(() => ({ doc }));
    const check = firestoreHealthCheck(() => ({ collection }) as never, {
      NODE_ENV: 'production',
    });

    await expect(check.check()).resolves.toEqual({ ok: true });
    expect(collection).toHaveBeenCalledWith('_health_check');
    expect(doc).toHaveBeenCalledWith('ping');
    expect(get).toHaveBeenCalledTimes(1);
  });
});
