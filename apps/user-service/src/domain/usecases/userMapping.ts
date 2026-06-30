import type {
  AdminUserStatusTransition,
  AuthorizationContext,
  CurrentUserSummary,
  UserLevel,
} from '@fa/http-contracts';

import type { FaUser } from '../models/user.js';

export interface ValidatedProfileFields {
  firstName: string;
  lastName: string;
  mobileNumber: string;
}

export type RequiredProfileField = 'firstName' | 'lastName' | 'mobileNumber';

export interface ProfileValidationError {
  code: 'INVALID_REQUEST' | 'PRECONDITION_FAILED';
  message: string;
}

const mobileNumberPattern = /^\+[1-9][0-9]{7,14}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function computeEffectiveLevel(user: Pick<FaUser, 'role' | 'level' | 'status'>): UserLevel {
  if (user.role === 'admin') {
    return 10;
  }

  if (user.level === null) {
    if (user.status === 'approved') {
      throw new Error('Approved normal users require a level.');
    }
    return 1;
  }

  return user.level;
}

export function validateProfileFields(input: {
  firstName: string;
  lastName: string;
  mobileNumber: string;
}): { ok: true; value: ValidatedProfileFields } | { ok: false; error: ProfileValidationError } {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const mobileNumber = input.mobileNumber.trim();

  if (firstName.length === 0 || lastName.length === 0) {
    return {
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Profile names are required.' },
    };
  }

  if (!mobileNumberPattern.test(mobileNumber)) {
    return {
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Profile mobile number is invalid.' },
    };
  }

  return { ok: true, value: { firstName, lastName, mobileNumber } };
}

export function missingRequiredProfileFields(user: FaUser): RequiredProfileField[] {
  const missing: RequiredProfileField[] = [];
  if (user.firstName === null || user.firstName.trim().length === 0) {
    missing.push('firstName');
  }
  if (user.lastName === null || user.lastName.trim().length === 0) {
    missing.push('lastName');
  }
  if (user.mobileNumber === null || !mobileNumberPattern.test(user.mobileNumber)) {
    missing.push('mobileNumber');
  }
  return missing;
}

export function hasCompleteRequiredProfile(user: FaUser): boolean {
  return missingRequiredProfileFields(user).length === 0;
}

export function mapUserToCurrentUserSummary(user: FaUser): CurrentUserSummary {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    mobileNumber: user.mobileNumber,
    role: user.role,
    status: user.status,
    level: user.level,
    effectiveLevel: computeEffectiveLevel(user),
  };
}

export function availableStatusTransitionsForUser(input: {
  actorUserId: string;
  user: FaUser;
}): AdminUserStatusTransition[] {
  if (input.actorUserId === input.user.id) {
    return [];
  }

  switch (input.user.status) {
    case 'pending':
    case 'profile_required':
      return ['approved'];
    case 'approved':
      return ['suspended'];
    case 'suspended':
      return ['approved'];
    case 'rejected':
      return [];
  }
}

export function mapUserToAdminUserSummary(input: {
  actorUserId: string;
  user: FaUser;
}): CurrentUserSummary {
  return {
    ...mapUserToCurrentUserSummary(input.user),
    availableStatusTransitions: availableStatusTransitionsForUser(input),
  };
}

export function mapUserToAuthorizationContext(user: FaUser): AuthorizationContext {
  return {
    userId: user.id,
    auth0Subject: user.auth0Subject,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: 'approved',
    effectiveLevel: computeEffectiveLevel(user),
  };
}
