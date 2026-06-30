import type {
  AdminPatchUserRequest,
  AdminPendingRequestsCountResponse,
  AdminPendingRequestsResponse,
  AdminUserHistoryResponse,
  AdminUserListResponse,
  AdminUserMutationResponse,
  ApproveUserRequest,
  AuthorizationResolveResponse,
  CompleteProfileRequest,
  UserLevel,
  UserRole,
  UserStatus,
} from '@fa/http-contracts';

import { config } from '../config.js';
import { apiRequest } from './apiClient.js';

const userBaseUrl = config.services.USER_SERVICE;

export interface ListUsersInput {
  query?: string;
  status?: UserStatus;
  role?: UserRole;
  level?: UserLevel;
  limit?: number;
  cursor?: string;
}

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  if (query === undefined) {
    return `${userBaseUrl}${path}`;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return `${userBaseUrl}${path}${suffix}`;
}

function emptyMutationBody(): string {
  return JSON.stringify({});
}

export function getCurrentUser(): Promise<AuthorizationResolveResponse> {
  return apiRequest<AuthorizationResolveResponse>(`${userBaseUrl}/me`, {
    method: 'GET',
  });
}

export function completeMyProfile(
  input: CompleteProfileRequest
): Promise<AuthorizationResolveResponse> {
  return apiRequest<AuthorizationResolveResponse>(`${userBaseUrl}/me/profile`, {
    method: 'PUT',
    body: JSON.stringify({
      firstName: input.firstName,
      lastName: input.lastName,
      mobileNumber: input.mobileNumber,
    }),
  });
}

export function listPendingRequests(input?: {
  limit?: number;
  cursor?: string;
}): Promise<AdminPendingRequestsResponse> {
  return apiRequest<AdminPendingRequestsResponse>(
    buildUrl('/admin/pending-requests', {
      limit: input?.limit,
      cursor: input?.cursor,
    }),
    {
      method: 'GET',
    }
  );
}

export function getPendingRequestsCount(): Promise<AdminPendingRequestsCountResponse> {
  return apiRequest<AdminPendingRequestsCountResponse>(
    `${userBaseUrl}/admin/pending-requests/count`,
    {
      method: 'GET',
    }
  );
}

export function approveUser(
  userId: string,
  input: ApproveUserRequest
): Promise<AdminUserMutationResponse> {
  return apiRequest<AdminUserMutationResponse>(`${userBaseUrl}/admin/users/${userId}/approve`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function rejectUser(userId: string): Promise<AdminUserMutationResponse> {
  return apiRequest<AdminUserMutationResponse>(`${userBaseUrl}/admin/users/${userId}/reject`, {
    method: 'POST',
    body: emptyMutationBody(),
  });
}

export function suspendUser(userId: string): Promise<AdminUserMutationResponse> {
  return apiRequest<AdminUserMutationResponse>(`${userBaseUrl}/admin/users/${userId}/suspend`, {
    method: 'POST',
    body: emptyMutationBody(),
  });
}

export function unsuspendUser(userId: string): Promise<AdminUserMutationResponse> {
  return apiRequest<AdminUserMutationResponse>(`${userBaseUrl}/admin/users/${userId}/unsuspend`, {
    method: 'POST',
    body: emptyMutationBody(),
  });
}

export function listUsers(input: ListUsersInput = {}): Promise<AdminUserListResponse> {
  return apiRequest<AdminUserListResponse>(
    buildUrl('/admin/users', {
      q: input.query,
      status: input.status,
      role: input.role,
      level: input.level,
      limit: input.limit,
      cursor: input.cursor,
    }),
    {
      method: 'GET',
    }
  );
}

export function patchUser(
  userId: string,
  input: AdminPatchUserRequest
): Promise<AdminUserMutationResponse> {
  return apiRequest<AdminUserMutationResponse>(`${userBaseUrl}/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function listUserHistory(
  userId: string,
  input?: { limit?: number; cursor?: string }
): Promise<AdminUserHistoryResponse> {
  return apiRequest<AdminUserHistoryResponse>(
    buildUrl(`/admin/users/${userId}/history`, {
      limit: input?.limit,
      cursor: input?.cursor,
    }),
    {
      method: 'GET',
    }
  );
}
