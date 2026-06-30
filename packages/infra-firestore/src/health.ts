import { getErrorMessage } from '@fa/common-core';

import { getFirestore, type Firestore } from './firestore.js';

export type HealthCheckOutcome = { ok: true } | { ok: false; detail?: string };

export interface HealthCheck {
  name: string;
  check(): Promise<HealthCheckOutcome>;
}

export function firestoreHealthCheck(
  getDb: () => Firestore = getFirestore,
  env: NodeJS.ProcessEnv = process.env
): HealthCheck {
  return {
    name: 'firestore',
    async check(): Promise<HealthCheckOutcome> {
      if (env['NODE_ENV'] === 'test' || env['VITEST'] !== undefined) {
        return { ok: true };
      }

      try {
        const db = getDb();
        await db.collection('_health_check').doc('ping').get();
        return { ok: true };
      } catch (error) {
        return { ok: false, detail: getErrorMessage(error) };
      }
    },
  };
}
