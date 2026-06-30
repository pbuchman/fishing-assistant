import { Timestamp } from '@fa/infra-firestore';

export function timestampFromIso(value: string): Timestamp {
  return Timestamp.fromDate(new Date(value));
}

export function isoFromTimestamp(value: unknown, fieldName: string): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (value !== null && typeof value === 'object' && 'toDate' in value) {
    const date = (value as { toDate: () => unknown }).toDate();
    if (date instanceof Date) {
      return date.toISOString();
    }
  }

  if (typeof value === 'string') {
    return value;
  }

  throw new Error(`${fieldName} must be a Firestore timestamp`);
}
