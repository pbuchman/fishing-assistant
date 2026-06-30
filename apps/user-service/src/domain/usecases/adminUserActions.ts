import { err, ok, type Result } from '@fa/common-core';
import type { AdminPatchUserRequest, UserLevel, UserRole } from '@fa/http-contracts';

import type { FaUser, RestorableUserStatus, UserChangeEvent } from '../models/user.js';
import type { UserRepository, UserRepositoryError } from '../repositories/userRepositories.js';
import type { UserUsecaseError } from './bootstrapUser.js';
import { hasCompleteRequiredProfile } from './userMapping.js';

export interface AdminUserActionDependencies {
  repository: UserRepository;
  eventIdGenerator: () => string;
}

export interface AdminUserMutationResult {
  user: FaUser;
  events: UserChangeEvent[];
}

interface BaseAdminInput {
  actorUserId: string;
  targetUserId: string;
  now: string;
}

interface ApproveUserInput extends BaseAdminInput {
  role: UserRole;
  level?: UserLevel;
}

interface PatchUserInput extends BaseAdminInput {
  patch: AdminPatchUserRequest;
}

function userError(code: UserUsecaseError['code'], message: string): UserUsecaseError {
  return { code, message };
}

function repositoryError(error: UserRepositoryError): UserUsecaseError {
  if (error.code === 'CONFLICT') {
    return userError('PRECONDITION_FAILED', error.message);
  }
  return userError(error.code, error.message);
}

function createEvent(input: {
  deps: AdminUserActionDependencies;
  actorUserId: string;
  targetUserId: string;
  type: UserChangeEvent['type'];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  now: string;
}): UserChangeEvent {
  return {
    id: input.deps.eventIdGenerator(),
    targetUserId: input.targetUserId,
    actorUserId: input.actorUserId,
    type: input.type,
    before: input.before,
    after: input.after,
    createdAt: input.now,
  };
}

async function requireAdminActor(
  deps: AdminUserActionDependencies,
  actorUserId: string
): Promise<Result<FaUser, UserUsecaseError>> {
  const found = await deps.repository.getById(actorUserId);
  if (!found.ok) {
    return err(repositoryError(found.error));
  }
  if (found.value === null) {
    return err(userError('FORBIDDEN', 'Admin actor was not found.'));
  }
  if (found.value.status !== 'approved' || found.value.role !== 'admin') {
    return err(userError('FORBIDDEN', 'Admin actor is not authorized.'));
  }
  return ok(found.value);
}

async function findTarget(
  deps: AdminUserActionDependencies,
  targetUserId: string
): Promise<Result<FaUser, UserUsecaseError>> {
  const found = await deps.repository.getById(targetUserId);
  if (!found.ok) {
    return err(repositoryError(found.error));
  }
  if (found.value === null) {
    return err(userError('NOT_FOUND', 'Target user was not found.'));
  }
  return ok(found.value);
}

async function loadMutationUsers(
  deps: AdminUserActionDependencies,
  input: BaseAdminInput
): Promise<Result<{ actor: FaUser; target: FaUser }, UserUsecaseError>> {
  if (input.actorUserId === input.targetUserId) {
    const self = await deps.repository.getById(input.actorUserId);
    if (!self.ok) {
      return err(repositoryError(self.error));
    }
    if (self.value?.role === 'admin') {
      return err(userError('FORBIDDEN', 'Admins cannot modify their own access.'));
    }
  }

  const actor = await requireAdminActor(deps, input.actorUserId);
  if (!actor.ok) {
    return actor;
  }
  if (input.actorUserId === input.targetUserId) {
    return err(userError('FORBIDDEN', 'Admins cannot modify their own access.'));
  }
  const target = await findTarget(deps, input.targetUserId);
  if (!target.ok) {
    return target;
  }
  return ok({ actor: actor.value, target: target.value });
}

function requireCompleteProfileForApproval(user: FaUser): Result<void, UserUsecaseError> {
  if (!hasCompleteRequiredProfile(user)) {
    return err(userError('PRECONDITION_FAILED', 'Approved users require a complete profile.'));
  }
  return ok(undefined);
}

function requireTargetNotSuspended(user: FaUser): Result<void, UserUsecaseError> {
  if (user.status === 'suspended') {
    return err(userError('PRECONDITION_FAILED', 'Suspended users must be unsuspended first.'));
  }
  return ok(undefined);
}

function validateApprovedRoleLevel(input: {
  role: UserRole;
  level: UserLevel | null | undefined;
}): Result<UserLevel | null, UserUsecaseError> {
  if (input.role === 'admin') {
    if (input.level !== undefined && input.level !== null) {
      return err(userError('PRECONDITION_FAILED', 'Approved admin users must not store a level.'));
    }
    return ok(null);
  }
  if (input.level === undefined || input.level === null) {
    return err(userError('PRECONDITION_FAILED', 'Approved normal users require a level.'));
  }
  return ok(input.level);
}

function requireApprovedUserInvariants(user: FaUser): Result<void, UserUsecaseError> {
  const profileComplete = requireCompleteProfileForApproval(user);
  if (!profileComplete.ok) {
    return profileComplete;
  }

  const validLevel = validateApprovedRoleLevel({ role: user.role, level: user.level });
  if (!validLevel.ok) {
    return validLevel;
  }

  return ok(undefined);
}

function statusBeforeSuspension(user: FaUser): RestorableUserStatus | null {
  return user.status === 'suspended' ? user.statusBeforeSuspension : user.status;
}

function collectEvents(input: {
  deps: AdminUserActionDependencies;
  actorUserId: string;
  before: FaUser;
  after: FaUser;
  now: string;
}): UserChangeEvent[] {
  const events: UserChangeEvent[] = [];
  if (input.before.status !== input.after.status) {
    events.push(
      createEvent({
        deps: input.deps,
        actorUserId: input.actorUserId,
        targetUserId: input.before.id,
        type: 'status_changed',
        before: { status: input.before.status },
        after: { status: input.after.status },
        now: input.now,
      })
    );
  }
  if (input.before.role !== input.after.role) {
    events.push(
      createEvent({
        deps: input.deps,
        actorUserId: input.actorUserId,
        targetUserId: input.before.id,
        type: 'role_changed',
        before: { role: input.before.role },
        after: { role: input.after.role },
        now: input.now,
      })
    );
  }
  if (input.before.level !== input.after.level) {
    events.push(
      createEvent({
        deps: input.deps,
        actorUserId: input.actorUserId,
        targetUserId: input.before.id,
        type: 'level_changed',
        before: { level: input.before.level },
        after: { level: input.after.level },
        now: input.now,
      })
    );
  }
  return events;
}

async function persistMutation(
  deps: AdminUserActionDependencies,
  input: {
    actor: FaUser;
    actorUserId: string;
    before: FaUser;
    after: FaUser;
    now: string;
  }
): Promise<Result<AdminUserMutationResult, UserUsecaseError>> {
  const events = collectEvents({ deps, ...input });
  const saved = await deps.repository.createOrUpdateWithEvents({
    user: input.after,
    events,
    identity: {
      auth0Subject: input.after.auth0Subject,
      normalizedEmail: input.after.normalizedEmail,
    },
    adminActorPrecondition: {
      actorUserId: input.actor.id,
      expectedUpdatedAt: input.actor.updatedAt,
    },
    expectedUpdatedAt: input.before.updatedAt,
  });

  if (!saved.ok) {
    return err(repositoryError(saved.error));
  }

  return ok({ user: saved.value, events });
}

export async function approveUser(
  deps: AdminUserActionDependencies,
  input: ApproveUserInput
): Promise<Result<AdminUserMutationResult, UserUsecaseError>> {
  const loaded = await loadMutationUsers(deps, input);
  if (!loaded.ok) {
    return loaded;
  }
  const target = loaded.value.target;
  const notSuspended = requireTargetNotSuspended(target);
  if (!notSuspended.ok) {
    return notSuspended;
  }
  const profileComplete = requireCompleteProfileForApproval(target);
  if (!profileComplete.ok) {
    return profileComplete;
  }
  const level = validateApprovedRoleLevel({ role: input.role, level: input.level });
  if (!level.ok) {
    return level;
  }

  return await persistMutation(deps, {
    actor: loaded.value.actor,
    actorUserId: input.actorUserId,
    before: target,
    after: {
      ...target,
      role: input.role,
      level: level.value,
      status: 'approved',
      approvedAt: input.now,
      suspendedAt: null,
      statusBeforeSuspension: null,
      updatedAt: input.now,
    },
    now: input.now,
  });
}

export async function rejectUser(
  deps: AdminUserActionDependencies,
  input: BaseAdminInput
): Promise<Result<AdminUserMutationResult, UserUsecaseError>> {
  const loaded = await loadMutationUsers(deps, input);
  if (!loaded.ok) {
    return loaded;
  }
  const target = loaded.value.target;
  const notSuspended = requireTargetNotSuspended(target);
  if (!notSuspended.ok) {
    return notSuspended;
  }

  return await persistMutation(deps, {
    actor: loaded.value.actor,
    actorUserId: input.actorUserId,
    before: target,
    after: {
      ...target,
      status: 'rejected',
      suspendedAt: null,
      statusBeforeSuspension: null,
      updatedAt: input.now,
    },
    now: input.now,
  });
}

export async function suspendUser(
  deps: AdminUserActionDependencies,
  input: BaseAdminInput
): Promise<Result<AdminUserMutationResult, UserUsecaseError>> {
  const loaded = await loadMutationUsers(deps, input);
  if (!loaded.ok) {
    return loaded;
  }
  const target = loaded.value.target;

  return await persistMutation(deps, {
    actor: loaded.value.actor,
    actorUserId: input.actorUserId,
    before: target,
    after: {
      ...target,
      status: 'suspended',
      statusBeforeSuspension: statusBeforeSuspension(target),
      suspendedAt: input.now,
      updatedAt: input.now,
    },
    now: input.now,
  });
}

export async function unsuspendUser(
  deps: AdminUserActionDependencies,
  input: BaseAdminInput
): Promise<Result<AdminUserMutationResult, UserUsecaseError>> {
  const loaded = await loadMutationUsers(deps, input);
  if (!loaded.ok) {
    return loaded;
  }
  const target = loaded.value.target;
  if (target.status !== 'suspended' || target.statusBeforeSuspension === null) {
    return err(userError('PRECONDITION_FAILED', 'User cannot be unsuspended.'));
  }

  const restored: FaUser = {
    ...target,
    status: target.statusBeforeSuspension,
    statusBeforeSuspension: null,
    suspendedAt: null,
    updatedAt: input.now,
  };
  if (restored.status === 'approved') {
    const validRestored = requireApprovedUserInvariants(restored);
    if (!validRestored.ok) {
      return validRestored;
    }
  }

  return await persistMutation(deps, {
    actor: loaded.value.actor,
    actorUserId: input.actorUserId,
    before: target,
    after: restored,
    now: input.now,
  });
}

export async function patchUser(
  deps: AdminUserActionDependencies,
  input: PatchUserInput
): Promise<Result<AdminUserMutationResult, UserUsecaseError>> {
  const loaded = await loadMutationUsers(deps, input);
  if (!loaded.ok) {
    return loaded;
  }
  const target = loaded.value.target;
  const desiredStatus = input.patch.status ?? target.status;

  if (
    target.status === 'suspended' &&
    input.patch.status !== undefined &&
    input.patch.status !== 'suspended'
  ) {
    return err(userError('PRECONDITION_FAILED', 'Suspended users must be unsuspended first.'));
  }

  const desiredRole = input.patch.role ?? target.role;
  if (desiredRole === 'admin' && input.patch.level !== undefined && input.patch.level !== null) {
    return err(userError('PRECONDITION_FAILED', 'Admin users must not store a level.'));
  }
  const desiredLevel =
    desiredRole === 'admin'
      ? input.patch.role === 'admin' || input.patch.level === null || target.role !== 'admin'
        ? null
        : target.level
      : input.patch.level !== undefined
        ? input.patch.level
        : target.level;

  const restoredStatus =
    target.status === 'suspended' ? target.statusBeforeSuspension : desiredStatus;

  if (desiredStatus === 'approved' || restoredStatus === 'approved') {
    const candidate = {
      ...target,
      role: desiredRole,
      level: desiredLevel,
      status: 'approved' as const,
    };
    const validApproved = requireApprovedUserInvariants(candidate);
    if (!validApproved.ok) {
      return validApproved;
    }
  }

  const suspending = desiredStatus === 'suspended';
  return await persistMutation(deps, {
    actor: loaded.value.actor,
    actorUserId: input.actorUserId,
    before: target,
    after: {
      ...target,
      role: desiredRole,
      level: desiredLevel,
      status: desiredStatus,
      approvedAt:
        desiredStatus === 'approved' ? (target.approvedAt ?? input.now) : target.approvedAt,
      statusBeforeSuspension: suspending
        ? statusBeforeSuspension(target)
        : target.statusBeforeSuspension,
      suspendedAt: suspending ? (target.suspendedAt ?? input.now) : target.suspendedAt,
      updatedAt: input.now,
    },
    now: input.now,
  });
}
