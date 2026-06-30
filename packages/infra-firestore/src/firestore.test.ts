import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FaError } from '@fa/common-core';

const firebaseMocks = vi.hoisted(() => {
  const fakeFirestore = { collection: vi.fn() };

  return {
    fakeFirestore,
    getApps: vi.fn<() => unknown[]>(() => []),
    initializeApp: vi.fn<(options: { projectId: string }) => unknown>(() => ({ name: 'app' })),
    getAdminFirestore: vi.fn<() => unknown>(() => fakeFirestore),
    Timestamp: class Timestamp {
      readonly seconds = 0;
      readonly nanoseconds = 0;
    },
    FieldValue: {
      serverTimestamp: vi.fn(() => 'server-timestamp'),
    },
  };
});

vi.mock('firebase-admin/app', () => ({
  getApps: firebaseMocks.getApps,
  initializeApp: firebaseMocks.initializeApp,
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: firebaseMocks.FieldValue,
  Timestamp: firebaseMocks.Timestamp,
  getFirestore: firebaseMocks.getAdminFirestore,
}));

describe('Firestore bootstrap', () => {
  beforeEach(async () => {
    vi.stubEnv('FA_GCP_PROJECT_ID', 'fishing-assistant');
    firebaseMocks.getApps.mockReturnValue([]);
    firebaseMocks.initializeApp.mockClear();
    firebaseMocks.getAdminFirestore.mockClear();
    const { resetFirestore } = await import('./firestore.js');
    resetFirestore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws a MISCONFIGURED FaError when FA_GCP_PROJECT_ID is missing', async () => {
    vi.stubEnv('FA_GCP_PROJECT_ID', undefined);
    const { getFirestore } = await import('./firestore.js');

    expect(() => getFirestore()).toThrow(FaError);
    try {
      getFirestore();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'MISCONFIGURED',
        message: 'Missing FA_GCP_PROJECT_ID environment variable.',
      });
    }
  });

  it('initializes once with the FA project id and reuses the cached instance', async () => {
    const { getFirestore } = await import('./firestore.js');

    expect(getFirestore()).toBe(firebaseMocks.fakeFirestore);
    expect(getFirestore()).toBe(firebaseMocks.fakeFirestore);
    expect(firebaseMocks.initializeApp).toHaveBeenCalledTimes(1);
    expect(firebaseMocks.initializeApp).toHaveBeenCalledWith({
      projectId: 'fishing-assistant',
    });
    expect(firebaseMocks.getAdminFirestore).toHaveBeenCalledTimes(1);
  });

  it('does not initialize a new app when Firebase already has one', async () => {
    firebaseMocks.getApps.mockReturnValue([{ name: '[DEFAULT]' }]);
    const { getFirestore } = await import('./firestore.js');

    expect(getFirestore()).toBe(firebaseMocks.fakeFirestore);
    expect(firebaseMocks.initializeApp).not.toHaveBeenCalled();
  });

  it('supports test-controlled setFirestore and resetFirestore', async () => {
    const fake = { collection: vi.fn() };
    const { getFirestore, resetFirestore, setFirestore } = await import('./firestore.js');

    setFirestore(fake as never);
    expect(getFirestore()).toBe(fake);

    resetFirestore();
    expect(getFirestore()).toBe(firebaseMocks.fakeFirestore);
  });

  it('exports Firestore primitives', async () => {
    const { FieldValue, Timestamp } = await import('./firestore.js');

    expect(FieldValue.serverTimestamp()).toBe('server-timestamp');
    expect(Timestamp).toBe(firebaseMocks.Timestamp);
  });
});
