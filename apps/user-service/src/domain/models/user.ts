import type { UserChangeType, UserLevel, UserRole, UserStatus } from '@fa/http-contracts';

export const bootstrapAdminActorId = 'system:bootstrap-admin' as const;

export type BootstrapAdminActorId = typeof bootstrapAdminActorId;
export type ActorUserId = string;
export type RestorableUserStatus = Exclude<UserStatus, 'suspended'>;

export interface FaUser {
  id: string;
  auth0Subject: string;
  email: string;
  normalizedEmail: string;
  firstName: string | null;
  lastName: string | null;
  mobileNumber: string | null;
  role: UserRole;
  level: UserLevel | null;
  status: UserStatus;
  statusBeforeSuspension: RestorableUserStatus | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  suspendedAt: string | null;
  deletedAt: string | null;
}

export interface UserIdentityReservation {
  id: string;
  kind: 'auth0Subject' | 'normalizedEmail';
  valueHash: string;
  userId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  releasedAt: string | null;
}

export interface UserChangeEvent {
  id: string;
  targetUserId: string;
  actorUserId: ActorUserId;
  type: UserChangeType;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: string;
}
