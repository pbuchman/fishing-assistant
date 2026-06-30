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
    const timestampLike = value as { toDate?: () => unknown };
    if (timestampLike.toDate !== undefined) {
      const date = timestampLike.toDate();
      if (date instanceof Date) {
        return date.toISOString();
      }
    }
  }

  throw new Error(`${fieldName} must be a Firestore Timestamp, Date, or ISO string`);
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function numberField(value: unknown, fieldName: string): number {
  if (typeof value !== 'number') {
    throw new Error(`${fieldName} must be a number`);
  }

  return value;
}

export function stringField(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  return value;
}
