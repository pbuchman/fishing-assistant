import { Timestamp } from '@fa/infra-firestore';

export function timestampFromIso(value: string): Timestamp {
  return Timestamp.fromDate(new Date(value));
}

export function isoFromTimestamp(value: unknown, fieldName: string): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value !== null && typeof value === 'object' && 'toDate' in value) {
    const date = (value as { toDate: () => unknown }).toDate();
    if (date instanceof Date) {
      return date.toISOString();
    }
  }

  throw new Error(`${fieldName} must be a Firestore Timestamp, Date, or ISO string`);
}
