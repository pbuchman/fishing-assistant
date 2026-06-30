import { getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldValue,
  getFirestore as getAdminFirestore,
  Timestamp,
  type DocumentData,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';

import { FaError } from '@fa/common-core';

export { FieldValue, Timestamp };
export type { DocumentData, Firestore, Query, QueryDocumentSnapshot };

let firestoreInstance: Firestore | null = null;

export function getFirestore(): Firestore {
  if (firestoreInstance !== null) {
    return firestoreInstance;
  }

  const projectId = process.env['FA_GCP_PROJECT_ID'];
  if (projectId === undefined || projectId === '') {
    throw new FaError('MISCONFIGURED', 'Missing FA_GCP_PROJECT_ID environment variable.');
  }

  if (getApps().length === 0) {
    initializeApp({ projectId });
  }

  firestoreInstance = getAdminFirestore();
  return firestoreInstance;
}

export function setFirestore(instance: Firestore): void {
  firestoreInstance = instance;
}

export function resetFirestore(): void {
  firestoreInstance = null;
}
