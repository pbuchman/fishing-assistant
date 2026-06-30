import { err, ok, type Result } from '@fa/common-core';

import { bootstrapAdminActorId, type FaUser, type UserChangeEvent } from '../models/user.js';
import type { UserRepository, UserRepositoryError } from '../repositories/userRepositories.js';
import type { UserUsecaseError } from './bootstrapUser.js';
import { validateProfileFields } from './userMapping.js';

export interface CompleteProfileDependencies {
  repository: UserRepository;
  eventIdGenerator: () => string;
  bootstrapAdminEmails?: ReadonlySet<string>;
}

export interface CompleteProfileInput {
  actorUserId: string;
  profile: {
    firstName: string;
    lastName: string;
    mobileNumber: string;
  };
  now: string;
}

function createEvent(input: {
  deps: CompleteProfileDependencies;
  userId: string;
  type: UserChangeEvent['type'];
  actorUserId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  now: string;
}): UserChangeEvent {
  return {
    id: input.deps.eventIdGenerator(),
    targetUserId: input.userId,
    actorUserId: input.actorUserId,
    type: input.type,
    before: input.before,
    after: input.after,
    createdAt: input.now,
  };
}

function repositoryError(error: UserRepositoryError): UserUsecaseError {
  if (error.code === 'CONFLICT') {
    return { code: 'PRECONDITION_FAILED', message: error.message };
  }
  return { code: error.code, message: error.message };
}

async function persist(
  deps: CompleteProfileDependencies,
  user: FaUser,
  events: UserChangeEvent[],
  expectedUpdatedAt: string
): Promise<Result<FaUser, UserUsecaseError>> {
  const saved = await deps.repository.createOrUpdateWithEvents({
    user,
    events,
    identity: {
      auth0Subject: user.auth0Subject,
      normalizedEmail: user.normalizedEmail,
    },
    expectedUpdatedAt,
  });
  return saved.ok ? ok(saved.value) : err(repositoryError(saved.error));
}

export async function completeProfile(
  deps: CompleteProfileDependencies,
  input: CompleteProfileInput
): Promise<Result<FaUser, UserUsecaseError>> {
  const found = await deps.repository.getById(input.actorUserId);
  if (!found.ok) {
    return err(repositoryError(found.error));
  }
  if (found.value === null) {
    return err({ code: 'NOT_FOUND', message: 'User was not found.' });
  }

  const existing = found.value;
  if (
    existing.status === 'pending' ||
    existing.status === 'rejected' ||
    existing.status === 'suspended'
  ) {
    return err({ code: 'FORBIDDEN', message: 'Profile cannot be updated in this status.' });
  }

  const validated = validateProfileFields(input.profile);
  if (!validated.ok) {
    return err(validated.error);
  }

  const isBootstrapAdminCandidate =
    deps.bootstrapAdminEmails?.has(existing.normalizedEmail) === true;
  const shouldApplyBootstrapCompletion =
    existing.status === 'profile_required' && isBootstrapAdminCandidate;
  const nextStatus = shouldApplyBootstrapCompletion
    ? 'approved'
    : existing.status === 'profile_required'
      ? 'pending'
      : existing.status;
  const nextRole = shouldApplyBootstrapCompletion ? 'admin' : existing.role;
  const nextLevel = shouldApplyBootstrapCompletion
    ? null
    : nextRole === 'user'
      ? (existing.level ?? 1)
      : existing.level;
  const updated: FaUser = {
    ...existing,
    firstName: validated.value.firstName,
    lastName: validated.value.lastName,
    mobileNumber: validated.value.mobileNumber,
    role: nextRole,
    level: nextLevel,
    status: nextStatus,
    approvedAt:
      nextStatus === 'approved' ? (existing.approvedAt ?? input.now) : existing.approvedAt,
    updatedAt: input.now,
  };

  const events: UserChangeEvent[] = [
    createEvent({
      deps,
      userId: existing.id,
      type: 'profile_changed',
      actorUserId: existing.id,
      before: {
        firstName: existing.firstName,
        lastName: existing.lastName,
        mobileNumber: existing.mobileNumber,
      },
      after: { ...validated.value },
      now: input.now,
    }),
  ];

  if (existing.status !== nextStatus) {
    events.push(
      createEvent({
        deps,
        userId: existing.id,
        type: 'status_changed',
        actorUserId:
          nextStatus === 'approved' && isBootstrapAdminCandidate
            ? bootstrapAdminActorId
            : existing.id,
        before: { status: existing.status },
        after: { status: nextStatus },
        now: input.now,
      })
    );
  }

  if (existing.role !== nextRole) {
    events.push(
      createEvent({
        deps,
        userId: existing.id,
        type: 'role_changed',
        actorUserId: bootstrapAdminActorId,
        before: { role: existing.role },
        after: { role: nextRole },
        now: input.now,
      })
    );
  }

  if (existing.level !== nextLevel) {
    events.push(
      createEvent({
        deps,
        userId: existing.id,
        type: 'level_changed',
        actorUserId: bootstrapAdminActorId,
        before: { level: existing.level },
        after: { level: nextLevel },
        now: input.now,
      })
    );
  }

  return await persist(deps, updated, events, existing.updatedAt);
}
