import { createHash } from 'node:crypto';

import { Timestamp } from '@fa/infra-firestore';

import type { FaUser, UserChangeEvent, UserIdentityReservation } from '../../domain/models/user.js';

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

export function identityValueHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function identityReservationId(
  kind: UserIdentityReservation['kind'],
  value: string
): string {
  return `${kind}:${identityValueHash(value)}`;
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`);
  }

  return value;
}

function booleanField(data: Record<string, unknown>, key: string): boolean {
  const value = data[key];
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean`);
  }

  return value;
}

function nullableString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string or null`);
  }

  return value;
}

function nullableTimestamp(data: Record<string, unknown>, key: string): string | null {
  return data[key] === null ? null : isoFromTimestamp(data[key], key);
}

function objectField(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = data[key];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }

  return value as Record<string, unknown>;
}

export function userToDoc(user: FaUser): Record<string, unknown> {
  return {
    ...user,
    createdAt: timestampFromIso(user.createdAt),
    updatedAt: timestampFromIso(user.updatedAt),
    approvedAt: user.approvedAt === null ? null : timestampFromIso(user.approvedAt),
    suspendedAt: user.suspendedAt === null ? null : timestampFromIso(user.suspendedAt),
    deletedAt: user.deletedAt === null ? null : timestampFromIso(user.deletedAt),
  };
}

export function userFromDoc(id: string, data: Record<string, unknown>): FaUser {
  return {
    id,
    auth0Subject: stringField(data, 'auth0Subject'),
    email: stringField(data, 'email'),
    normalizedEmail: stringField(data, 'normalizedEmail'),
    firstName: nullableString(data, 'firstName'),
    lastName: nullableString(data, 'lastName'),
    mobileNumber: nullableString(data, 'mobileNumber'),
    role: stringField(data, 'role') as FaUser['role'],
    level: data['level'] === null ? null : (data['level'] as FaUser['level']),
    status: stringField(data, 'status') as FaUser['status'],
    statusBeforeSuspension: nullableString(
      data,
      'statusBeforeSuspension'
    ) as FaUser['statusBeforeSuspension'],
    createdAt: isoFromTimestamp(data['createdAt'], 'createdAt'),
    updatedAt: isoFromTimestamp(data['updatedAt'], 'updatedAt'),
    approvedAt: nullableTimestamp(data, 'approvedAt'),
    suspendedAt: nullableTimestamp(data, 'suspendedAt'),
    deletedAt: nullableTimestamp(data, 'deletedAt'),
  };
}

export function reservationToDoc(reservation: UserIdentityReservation): Record<string, unknown> {
  return {
    ...reservation,
    createdAt: timestampFromIso(reservation.createdAt),
    updatedAt: timestampFromIso(reservation.updatedAt),
    releasedAt: reservation.releasedAt === null ? null : timestampFromIso(reservation.releasedAt),
  };
}

export function reservationFromDoc(
  id: string,
  data: Record<string, unknown>
): UserIdentityReservation {
  return {
    id,
    kind: stringField(data, 'kind') as UserIdentityReservation['kind'],
    valueHash: stringField(data, 'valueHash'),
    userId: stringField(data, 'userId'),
    active: booleanField(data, 'active'),
    createdAt: isoFromTimestamp(data['createdAt'], 'createdAt'),
    updatedAt: isoFromTimestamp(data['updatedAt'], 'updatedAt'),
    releasedAt: nullableTimestamp(data, 'releasedAt'),
  };
}

export function eventToDoc(event: UserChangeEvent): Record<string, unknown> {
  return {
    ...event,
    createdAt: timestampFromIso(event.createdAt),
  };
}

export function eventFromDoc(id: string, data: Record<string, unknown>): UserChangeEvent {
  return {
    id,
    targetUserId: stringField(data, 'targetUserId'),
    actorUserId: stringField(data, 'actorUserId'),
    type: stringField(data, 'type') as UserChangeEvent['type'],
    before: objectField(data, 'before'),
    after: objectField(data, 'after'),
    createdAt: isoFromTimestamp(data['createdAt'], 'createdAt'),
  };
}
