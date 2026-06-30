import { err, ok, type Result } from '@fa/common-core';
import type { Auth0IdentityClaims } from '@fa/http-contracts';

import { bootstrapAdminActorId, type FaUser, type UserChangeEvent } from '../models/user.js';
import type { UserRepository, UserRepositoryError } from '../repositories/userRepositories.js';
import { hashSecurityLogValue } from './securityLogging.js';
import { hasCompleteRequiredProfile, normalizeEmail } from './userMapping.js';
import type { IdentityConflictLogEvent, IdentityConflictReason } from './securityLogging.js';

export type { IdentityConflictLogEvent } from './securityLogging.js';

export interface UserUsecaseError {
  code: 'FORBIDDEN' | 'NOT_FOUND' | 'PRECONDITION_FAILED' | 'INTERNAL_ERROR' | 'INVALID_REQUEST';
  message: string;
}

export interface BootstrapUserDependencies {
  repository: UserRepository;
  bootstrapAdminEmails: ReadonlySet<string>;
  selfSignupAllowedEmailPattern?: RegExp;
  idGenerator: () => string;
  eventIdGenerator: () => string;
  securityLogHashKey: string;
  logIdentityConflict?: (event: IdentityConflictLogEvent) => void;
}

export interface BootstrapUserInput {
  auth0: Auth0IdentityClaims;
  now: string;
}

function forbidden(message: string): UserUsecaseError {
  return { code: 'FORBIDDEN', message };
}

function fromRepositoryError(error: UserRepositoryError): UserUsecaseError {
  if (error.code === 'CONFLICT') {
    return forbidden('Identity cannot be safely bound.');
  }
  return { code: error.code, message: error.message };
}

function isAllowedSelfSignupEmail(
  deps: BootstrapUserDependencies,
  normalizedEmail: string
): boolean {
  return deps.selfSignupAllowedEmailPattern?.test(normalizedEmail) ?? false;
}

function logConflict(
  deps: BootstrapUserDependencies,
  input: {
    reason: IdentityConflictReason;
    auth0Subject: string;
    normalizedEmail?: string;
    existingUserId?: string;
  }
): void {
  deps.logIdentityConflict?.({
    event: 'user_identity_conflict',
    reason: input.reason,
    auth0SubjectHash: hashSecurityLogValue(deps.securityLogHashKey, input.auth0Subject),
    ...(input.normalizedEmail === undefined
      ? {}
      : {
          normalizedEmailHash: hashSecurityLogValue(deps.securityLogHashKey, input.normalizedEmail),
        }),
    ...(input.existingUserId === undefined ? {} : { existingUserId: input.existingUserId }),
  });
}

function createEvent(input: {
  deps: BootstrapUserDependencies;
  targetUserId: string;
  type: UserChangeEvent['type'];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  now: string;
  actorUserId?: string;
}): UserChangeEvent {
  return {
    id: input.deps.eventIdGenerator(),
    targetUserId: input.targetUserId,
    actorUserId: input.actorUserId ?? bootstrapAdminActorId,
    type: input.type,
    before: input.before,
    after: input.after,
    createdAt: input.now,
  };
}

function createNewUser(input: {
  deps: BootstrapUserDependencies;
  auth0Subject: string;
  email: string;
  normalizedEmail: string;
  isBootstrapAdmin: boolean;
  now: string;
}): { user: FaUser; events: UserChangeEvent[] } {
  const userId = input.deps.idGenerator();
  const role = input.isBootstrapAdmin ? 'admin' : 'user';
  const user: FaUser = {
    id: userId,
    auth0Subject: input.auth0Subject,
    email: input.email,
    normalizedEmail: input.normalizedEmail,
    firstName: null,
    lastName: null,
    mobileNumber: null,
    role,
    level: null,
    status: 'profile_required',
    statusBeforeSuspension: null,
    createdAt: input.now,
    updatedAt: input.now,
    approvedAt: null,
    suspendedAt: null,
    deletedAt: null,
  };

  const events = input.isBootstrapAdmin
    ? [
        createEvent({
          deps: input.deps,
          targetUserId: userId,
          type: 'role_changed',
          before: {},
          after: { role: 'admin' },
          now: input.now,
        }),
        createEvent({
          deps: input.deps,
          targetUserId: userId,
          type: 'level_changed',
          before: {},
          after: { level: null },
          now: input.now,
        }),
      ]
    : [];

  return { user, events };
}

function applyBootstrapCorrection(
  deps: BootstrapUserDependencies,
  user: FaUser,
  now: string
): { user: FaUser; events: UserChangeEvent[]; changed: boolean } {
  const corrected: FaUser = { ...user };
  const events: UserChangeEvent[] = [];

  if (corrected.role !== 'admin') {
    events.push(
      createEvent({
        deps,
        targetUserId: corrected.id,
        type: 'role_changed',
        before: { role: corrected.role },
        after: { role: 'admin' },
        now,
      })
    );
    corrected.role = 'admin';
  }

  if (corrected.level !== null) {
    events.push(
      createEvent({
        deps,
        targetUserId: corrected.id,
        type: 'level_changed',
        before: { level: corrected.level },
        after: { level: null },
        now,
      })
    );
    corrected.level = null;
  }

  if (corrected.status !== 'suspended') {
    const nextStatus = hasCompleteRequiredProfile(corrected) ? 'approved' : 'profile_required';
    if (corrected.status !== nextStatus) {
      events.push(
        createEvent({
          deps,
          targetUserId: corrected.id,
          type: 'status_changed',
          before: { status: corrected.status },
          after: { status: nextStatus },
          now,
        })
      );
      corrected.status = nextStatus;
      corrected.approvedAt = nextStatus === 'approved' ? now : null;
    }
  }

  if (events.length > 0) {
    corrected.updatedAt = now;
  }

  return { user: corrected, events, changed: events.length > 0 };
}

async function persistUser(
  deps: BootstrapUserDependencies,
  input: {
    user: FaUser;
    events: UserChangeEvent[];
    previousNormalizedEmail?: string | null;
    expectedUpdatedAt: string | null;
  }
): Promise<Result<FaUser, UserUsecaseError>> {
  const saved = await deps.repository.createOrUpdateWithEvents({
    user: input.user,
    events: input.events,
    identity: {
      auth0Subject: input.user.auth0Subject,
      normalizedEmail: input.user.normalizedEmail,
      ...(input.previousNormalizedEmail === undefined
        ? {}
        : { previousNormalizedEmail: input.previousNormalizedEmail }),
    },
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
  return saved.ok ? ok(saved.value) : err(fromRepositoryError(saved.error));
}

export async function bootstrapUser(
  deps: BootstrapUserDependencies,
  input: BootstrapUserInput
): Promise<Result<FaUser, UserUsecaseError>> {
  const auth0Subject = input.auth0.subject.trim();
  if (auth0Subject.length === 0) {
    return err(forbidden('Auth0 subject is required.'));
  }

  const email = input.auth0.email?.trim();
  if (email === undefined || email.length === 0) {
    logConflict(deps, { reason: 'email_missing', auth0Subject });
    return err(forbidden('Verified email is required.'));
  }

  const normalizedEmail = normalizeEmail(email);
  const isBootstrapAdmin = deps.bootstrapAdminEmails.has(normalizedEmail);
  const isSelfSignupEmail = isAllowedSelfSignupEmail(deps, normalizedEmail);
  const bySubject = await deps.repository.findActiveByAuth0Subject(auth0Subject);
  if (!bySubject.ok) {
    return err(fromRepositoryError(bySubject.error));
  }

  if (input.auth0.emailVerified !== true) {
    if (
      bySubject.value !== null &&
      bySubject.value.normalizedEmail === normalizedEmail &&
      isSelfSignupEmail &&
      !isBootstrapAdmin
    ) {
      return ok(bySubject.value);
    }

    const isAllowedNewUnverifiedSelfSignup =
      bySubject.value === null && isSelfSignupEmail && !isBootstrapAdmin;
    if (!isAllowedNewUnverifiedSelfSignup) {
      const reason =
        bySubject.value !== null ? 'subject_email_changed_unverified' : 'email_unverified';
      logConflict(deps, { reason, auth0Subject, normalizedEmail });
      return err(forbidden('Verified email is required.'));
    }
  }

  if (bySubject.value !== null) {
    const existing = bySubject.value;
    if (existing.normalizedEmail !== normalizedEmail) {
      const emailOwner = await deps.repository.findActiveByNormalizedEmail(normalizedEmail);
      if (!emailOwner.ok) {
        return err(fromRepositoryError(emailOwner.error));
      }
      if (emailOwner.value !== null && emailOwner.value.id !== existing.id) {
        logConflict(deps, {
          reason: 'subject_email_changed_to_owned_email',
          auth0Subject,
          normalizedEmail,
          existingUserId: emailOwner.value.id,
        });
        return err(forbidden('Identity cannot be safely bound.'));
      }

      const updated: FaUser = {
        ...existing,
        email,
        normalizedEmail,
        updatedAt: input.now,
      };
      const profileEvent = createEvent({
        deps,
        targetUserId: existing.id,
        type: 'profile_changed',
        actorUserId: existing.id,
        before: {
          email: existing.email,
          normalizedEmail: existing.normalizedEmail,
        },
        after: { email, normalizedEmail },
        now: input.now,
      });
      if (isBootstrapAdmin) {
        const correction = applyBootstrapCorrection(deps, updated, input.now);
        return await persistUser(deps, {
          user: correction.user,
          events: [profileEvent, ...correction.events],
          previousNormalizedEmail: existing.normalizedEmail,
          expectedUpdatedAt: existing.updatedAt,
        });
      }

      return await persistUser(deps, {
        user: updated,
        events: [profileEvent],
        previousNormalizedEmail: existing.normalizedEmail,
        expectedUpdatedAt: existing.updatedAt,
      });
    }

    if (!isBootstrapAdmin) {
      return ok(existing);
    }

    const correction = applyBootstrapCorrection(deps, existing, input.now);
    if (!correction.changed) {
      return ok(correction.user);
    }
    return await persistUser(deps, {
      user: correction.user,
      events: correction.events,
      expectedUpdatedAt: existing.updatedAt,
    });
  }

  const emailOwner = await deps.repository.findActiveByNormalizedEmail(normalizedEmail);
  if (!emailOwner.ok) {
    return err(fromRepositoryError(emailOwner.error));
  }
  if (emailOwner.value !== null) {
    logConflict(deps, {
      reason: 'email_owned_by_other_subject',
      auth0Subject,
      normalizedEmail,
      existingUserId: emailOwner.value.id,
    });
    return err(forbidden('Identity cannot be safely bound.'));
  }

  if (!isBootstrapAdmin && !isSelfSignupEmail) {
    logConflict(deps, { reason: 'email_not_allowed_for_signup', auth0Subject, normalizedEmail });
    return err(forbidden('Email is not allowed for sign-up.'));
  }

  const { user, events } = createNewUser({
    deps,
    auth0Subject,
    email,
    normalizedEmail,
    isBootstrapAdmin,
    now: input.now,
  });
  return await persistUser(deps, { user, events, expectedUpdatedAt: null });
}
