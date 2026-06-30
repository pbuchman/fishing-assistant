import { describe, expect, it } from 'vitest';

import { isoFromTimestamp, numberField, optionalString, stringField } from './firestoreMapping.js';

describe('firestore mapping helpers', () => {
  it('maps strings, dates, and timestamp-like values to ISO strings', () => {
    expect(isoFromTimestamp('2026-06-14T00:00:00.000Z', 'createdAt')).toBe(
      '2026-06-14T00:00:00.000Z'
    );
    expect(isoFromTimestamp(new Date('2026-06-14T00:00:00.000Z'), 'createdAt')).toBe(
      '2026-06-14T00:00:00.000Z'
    );
    expect(
      isoFromTimestamp({ toDate: () => new Date('2026-06-14T00:00:00.000Z') }, 'createdAt')
    ).toBe('2026-06-14T00:00:00.000Z');
  });

  it('throws on invalid field values', () => {
    expect(() => isoFromTimestamp({ toDate: () => 'not-date' }, 'createdAt')).toThrow(
      'createdAt must be a Firestore Timestamp, Date, or ISO string'
    );
    expect(() => isoFromTimestamp({ toDate: undefined }, 'createdAt')).toThrow(
      'createdAt must be a Firestore Timestamp, Date, or ISO string'
    );
    expect(() => isoFromTimestamp({}, 'createdAt')).toThrow(
      'createdAt must be a Firestore Timestamp, Date, or ISO string'
    );
    expect(() => numberField('1', 'calls')).toThrow('calls must be a number');
    expect(() => stringField(1, 'id')).toThrow('id must be a string');
    expect(optionalString('prompt')).toBe('prompt');
    expect(optionalString(1)).toBeUndefined();
  });
});
