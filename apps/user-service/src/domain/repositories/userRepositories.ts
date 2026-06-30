import type { Result } from '@fa/common-core';
import type { UserLevel, UserRole, UserStatus } from '@fa/http-contracts';

import type { FaUser, UserChangeEvent } from '../models/user.js';

export interface UserRepositoryError {
  code: 'NOT_FOUND' | 'CONFLICT' | 'PRECONDITION_FAILED' | 'INTERNAL_ERROR';
  message: string;
}

export interface UserListCursor {
  sortValue: string;
  id: string;
}

export interface UserListPage {
  users: FaUser[];
  nextCursor: UserListCursor | null;
  totalCount: number;
}

export interface UserHistoryPage {
  events: UserChangeEvent[];
  nextCursor: UserListCursor | null;
}

export interface UserFilters {
  query?: string;
  status?: UserStatus;
  role?: UserRole;
  level?: UserLevel;
}

export interface UserRepository {
  resolveByAuth0Identity(input: {
    auth0Subject: string;
    normalizedEmail: string;
  }): Promise<Result<FaUser | null, UserRepositoryError>>;

  findActiveByAuth0Subject(
    auth0Subject: string
  ): Promise<Result<FaUser | null, UserRepositoryError>>;

  findActiveByNormalizedEmail(
    normalizedEmail: string
  ): Promise<Result<FaUser | null, UserRepositoryError>>;

  getById(userId: string): Promise<Result<FaUser | null, UserRepositoryError>>;

  createOrUpdateWithEvents(input: {
    user: FaUser;
    events: UserChangeEvent[];
    identity: {
      auth0Subject: string;
      normalizedEmail: string;
      previousNormalizedEmail?: string | null;
    };
    adminActorPrecondition?: {
      actorUserId: string;
      expectedUpdatedAt: string;
    };
    expectedUpdatedAt: string | null;
  }): Promise<Result<FaUser, UserRepositoryError>>;

  listPending(input: {
    limit: number;
    cursor: UserListCursor | null;
  }): Promise<Result<UserListPage, UserRepositoryError>>;

  countPending(): Promise<Result<number, UserRepositoryError>>;

  listUsers(input: {
    filters: UserFilters;
    limit: number;
    cursor: UserListCursor | null;
  }): Promise<Result<UserListPage, UserRepositoryError>>;

  listHistory(input: {
    targetUserId: string;
    limit: number;
    cursor: UserListCursor | null;
  }): Promise<Result<UserHistoryPage, UserRepositoryError>>;
}
