import type { ChangeEvent, ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';

import type {
  AdminPatchUserRequest,
  CurrentUserSummary,
  UserChangeEventResponse,
  UserLevel,
  UserRole,
  UserStatus,
} from '@fa/http-contracts';

import { useFaAuth } from '../auth/useFaAuth.js';
import {
  adminRoleForLabel,
  levelForLabel,
  roleForLabel,
  statusForLabel,
  userRoleForLabel,
  userRoleLabel,
  userStatusLabel,
} from '../i18n/displayLabels.js';
import { listUserHistory, listUsers, patchUser, type ListUsersInput } from '../services/userApi.js';
import { useI18n } from '../i18n/useI18n.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { DetailSheet } from '../ui/DetailSheet.js';
import { RoleToggle } from '../ui/RoleToggle.js';
import { formatDateTime } from '../ui/formatters.js';
import type { AppMessages } from '@fa/i18n';

interface AccessChangeConfirmation {
  type: 'access-change';
  user: CurrentUserSummary;
  patch: AdminPatchUserRequest;
  changes: string[];
}

type UserConfirmation = AccessChangeConfirmation;
type UserAuditState =
  | { status: 'loading' }
  | { status: 'loaded'; events: UserChangeEventResponse[] }
  | { status: 'error' };

interface UserFilters {
  query?: string | undefined;
  status?: UserStatus | undefined;
  role?: UserRole | undefined;
  level?: UserLevel | undefined;
}

export interface UsersPageProps {
  onUsersChanged: () => Promise<void>;
}

function levelValue(user: CurrentUserSummary): UserLevel {
  return user.level ?? 1;
}

function toListUsersInput(filters: UserFilters, cursor?: string): ListUsersInput {
  const query = filters.query?.trim();
  return {
    ...(query === undefined || query.length === 0 ? {} : { query }),
    ...(filters.status === undefined ? {} : { status: filters.status }),
    ...(filters.role === undefined ? {} : { role: filters.role }),
    ...(filters.level === undefined ? {} : { level: filters.level }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function describeAccessPatch(patch: AdminPatchUserRequest, app: AppMessages): string[] {
  return [
    ...(patch.role === undefined
      ? []
      : [`${app.adminUsers.changeRole}: ${userRoleLabel(patch.role, app)}`]),
    ...(patch.status === undefined
      ? []
      : [`${app.adminUsers.changeStatus}: ${adminUserStatusLabel(patch.status, app)}`]),
    ...(patch.level === undefined ? [] : [`${app.adminUsers.changeLevel}: ${String(patch.level)}`]),
  ];
}

function changeTypeLabel(type: UserChangeEventResponse['type'], app: AppMessages): string {
  const labels: Record<UserChangeEventResponse['type'], string> = {
    level_changed: app.adminUsers.auditChangeTypes.levelChanged,
    profile_changed: app.adminUsers.auditChangeTypes.profileChanged,
    role_changed: app.adminUsers.auditChangeTypes.roleChanged,
    status_changed: app.adminUsers.auditChangeTypes.statusChanged,
  };

  return labels[type];
}

function actorLabel(
  actorUserId: string,
  usersById: ReadonlyMap<string, CurrentUserSummary>
): string {
  const actor = usersById.get(actorUserId);
  if (actor !== undefined) {
    return userDisplayName(actor);
  }

  return actorUserId;
}

function userDisplayName(user: CurrentUserSummary): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
}

function userInitials(user: CurrentUserSummary): string {
  const names = [user.firstName, user.lastName]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().at(0)?.toUpperCase() ?? '');
  const initials = names.join('');

  if (initials.length > 0) {
    return initials.slice(0, 2);
  }

  return user.email.slice(0, 2).toUpperCase();
}

function userAvatarTone(user: CurrentUserSummary): string {
  if (user.role === 'admin') {
    return 'blue';
  }

  if (user.status === 'pending') {
    return 'navy';
  }

  return user.effectiveLevel >= 7 ? 'green' : 'navy';
}

function UserAuditSummary({
  app,
  user,
}: {
  app: AppMessages;
  user: CurrentUserSummary;
}): ReactElement {
  return (
    <div className="admin-user-audit-summary">
      <span className={`admin-user-avatar ${userAvatarTone(user)}`}>{userInitials(user)}</span>
      <span className="admin-user-copy">
        <strong>{userDisplayName(user)}</strong>
        <span>{user.email}</span>
      </span>
      <span className="mini-chip">
        {app.admin.userRole}: {userRoleLabel(user.role, app)}
      </span>
      <span className="mini-chip">
        {app.adminUsers.status}: {adminUserStatusLabel(user.status, app)}
      </span>
      <span className="mini-chip">
        {app.admin.userLevel} {user.effectiveLevel}
      </span>
    </div>
  );
}

function adminUserStatusLabel(status: UserStatus, app: AppMessages): string {
  if (status === 'approved') {
    return app.adminUsers.activeStatus;
  }

  if (status === 'pending' || status === 'profile_required') {
    return app.adminUsers.pendingStatus;
  }

  if (status === 'suspended') {
    return app.adminUsers.suspendedStatus;
  }

  return userStatusLabel(status, app);
}

function loadedUsersCopy(count: number, totalCount: number | null, app: AppMessages): string {
  if (totalCount === null) {
    return `${app.adminUsers.loadedUsersPrefix} ${String(count)}`;
  }

  return `${app.adminUsers.loadedUsersPrefix} ${String(count)} ${app.adminUsers.loadedUsersOf} ${String(totalCount)}`;
}

function canTransitionTo(user: CurrentUserSummary, status: 'approved' | 'suspended'): boolean {
  return user.availableStatusTransitions?.includes(status) ?? true;
}

function UserAuditDetails({
  audit,
  app,
  locale,
  user,
  usersById,
}: {
  audit: UserAuditState | undefined;
  app: AppMessages;
  locale: string;
  user: CurrentUserSummary;
  usersById: ReadonlyMap<string, CurrentUserSummary>;
}): ReactElement {
  if (audit === undefined || audit.status === 'loading') {
    return (
      <div className="admin-user-audit-details">
        <UserAuditSummary app={app} user={user} />
        <strong>{app.adminUsers.auditLoading}</strong>
      </div>
    );
  }

  if (audit.status === 'error') {
    return (
      <div className="admin-user-audit-details">
        <UserAuditSummary app={app} user={user} />
        <strong>{app.adminUsers.auditUnavailable}</strong>
      </div>
    );
  }

  if (audit.events.length === 0) {
    return (
      <div className="admin-user-audit-details">
        <UserAuditSummary app={app} user={user} />
        <strong>{app.adminUsers.noRecentAccessChanges}</strong>
      </div>
    );
  }

  return (
    <div className="admin-user-audit-details">
      <UserAuditSummary app={app} user={user} />
      <ol className="admin-user-audit-events">
        {audit.events.map((event) => (
          <li key={event.id}>
            <strong>{changeTypeLabel(event.type, app)}</strong>
            <span>{formatDateTime(event.createdAt, locale)}</span>
            <span>
              {app.adminUsers.changedBy} {actorLabel(event.actorUserId, usersById)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function UsersPage({ onUsersChanged }: UsersPageProps): ReactElement {
  const { locale, messages } = useI18n();
  const { accountState } = useFaAuth();
  const app = messages.app;
  const [users, setUsers] = useState<CurrentUserSummary[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [filters, setFilters] = useState<UserFilters>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirmation, setConfirmation] = useState<UserConfirmation | null>(null);
  const [auditDetailsUserId, setAuditDetailsUserId] = useState<string | null>(null);
  const [userAuditById, setUserAuditById] = useState<Record<string, UserAuditState>>({});
  const [savingByUserId, setSavingByUserId] = useState<
    Record<string, 'idle' | 'saving' | 'saved' | 'error'>
  >({});
  const currentAdminUserId =
    accountState.status === 'approved' ? accountState.authorization.userId : null;
  const usersById = new Map(users.map((user) => [user.id, user]));
  const auditDetailsUser = users.find((user) => user.id === auditDetailsUserId) ?? null;
  const userIdsKey = users.map((user) => user.id).join('|');
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const loadUsers = useCallback(
    async (
      mode: 'replace' | 'append' = 'replace',
      nextFilters: UserFilters = filters,
      cursor?: string
    ): Promise<void> => {
      if (mode === 'append') {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const response = await listUsers(toListUsersInput(nextFilters, cursor));
        setUsers((current) =>
          mode === 'append' ? [...current, ...response.users] : response.users
        );
        setNextCursor(response.nextCursor);
        setTotalCount(typeof response.totalCount === 'number' ? response.totalCount : null);
      } finally {
        if (mode === 'append') {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    },
    [filters]
  );

  useEffect(() => {
    void loadUsers('replace', filters);
  }, [filters, loadUsers]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (node === null || nextCursor === null || loading || loadingMore) {
      return;
    }

    if (!('IntersectionObserver' in window)) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadUsers('append', filters, nextCursor);
      }
    });

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [filters, loadUsers, loading, loadingMore, nextCursor]);

  useEffect(() => {
    let cancelled = false;

    if (users.length === 0) {
      setUserAuditById({});
      return () => {
        cancelled = true;
      };
    }

    setUserAuditById(
      Object.fromEntries(
        users.map((user) => [user.id, { status: 'loading' } satisfies UserAuditState])
      )
    );

    async function loadAudit(): Promise<void> {
      const entries = await Promise.all(
        users.map(async (user): Promise<[string, UserAuditState]> => {
          try {
            const response = await listUserHistory(user.id, { limit: 3 });
            return [user.id, { status: 'loaded', events: response.events }];
          } catch {
            return [user.id, { status: 'error' }];
          }
        })
      );

      if (!cancelled) {
        setUserAuditById(Object.fromEntries(entries));
      }
    }

    void loadAudit();

    return () => {
      cancelled = true;
    };
  }, [userIdsKey]);

  function updateFilters(nextPatch: Partial<UserFilters>): void {
    setFilters((current) => {
      return {
        ...current,
        ...nextPatch,
      };
    });
  }

  async function refreshAfterMutation(): Promise<void> {
    await loadUsers('replace', filters);
    await onUsersChanged();
  }

  function updateLocalUser(userId: string, patch: AdminPatchUserRequest): void {
    setUsers((current) =>
      current.map((user) => {
        if (user.id !== userId) {
          return user;
        }

        const nextRole = patch.role ?? user.role;
        const nextStatus = patch.status ?? user.status;
        let nextLevel: UserLevel | null = null;
        let nextEffectiveLevel: UserLevel = 10;

        if (nextRole === 'user') {
          nextLevel = patch.level ?? (user.role === 'user' ? levelValue(user) : 1);
          nextEffectiveLevel = nextLevel;
        }

        return {
          ...user,
          role: nextRole,
          status: nextStatus,
          level: nextLevel,
          effectiveLevel: nextEffectiveLevel,
        };
      })
    );
  }

  async function saveAccessPatch(
    user: CurrentUserSummary,
    patch: AdminPatchUserRequest
  ): Promise<void> {
    updateLocalUser(user.id, patch);
    setSavingByUserId((current) => ({ ...current, [user.id]: 'saving' }));

    try {
      await patchUser(user.id, patch);
      setSavingByUserId((current) => ({ ...current, [user.id]: 'saved' }));
      await refreshAfterMutation();
    } catch {
      setSavingByUserId((current) => ({ ...current, [user.id]: 'error' }));
      await loadUsers('replace', filters);
    }
  }

  function requestAccessChange(user: CurrentUserSummary, patch: AdminPatchUserRequest): void {
    setConfirmation({
      type: 'access-change',
      user,
      patch,
      changes: describeAccessPatch(patch, app),
    });
  }

  async function handleConfirmDestructive(): Promise<void> {
    if (confirmation === null) {
      return;
    }

    const { user, patch } = confirmation;
    setConfirmation(null);
    await saveAccessPatch(user, patch);
  }

  return (
    <section className="view-stack" aria-labelledby="users-heading">
      <div className="panel-header fa-section-header">
        <div>
          <h2 id="users-heading">{app.admin.users}</h2>
          <p className="panel-subtitle">{app.admin.usersSubtitle}</p>
        </div>
      </div>

      <div className="toolbar-actions admin-filters admin-users-filters fa-surface">
        <label className="admin-inline-control admin-users-search-filter">
          <span>{app.adminUsers.search}</span>
          <input
            aria-label={app.adminUsers.searchAriaLabel}
            placeholder={app.adminUsers.searchPlaceholder}
            type="search"
            value={filters.query ?? ''}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const nextQuery = event.currentTarget.value;
              updateFilters({ query: nextQuery.length === 0 ? undefined : nextQuery });
            }}
          />
        </label>
        <label className="admin-inline-control">
          <span>{app.adminUsers.status}</span>
          <select
            aria-label={app.adminUsers.statusFilter}
            value={filters.status ?? ''}
            onChange={(event) => {
              const nextStatus = event.currentTarget.value;
              setFilters((current) => ({
                ...current,
                status: nextStatus === '' ? undefined : (nextStatus as UserStatus),
              }));
            }}
          >
            <option value="">{app.userStatuses.all}</option>
            <option value="pending">{app.adminUsers.pendingStatus}</option>
            <option value="approved">{app.adminUsers.activeStatus}</option>
            <option value="suspended">{app.adminUsers.suspendedStatus}</option>
          </select>
        </label>
        <label className="admin-inline-control">
          <span>{app.admin.userRole}</span>
          <select
            aria-label={app.adminUsers.roleFilter}
            value={filters.role ?? ''}
            onChange={(event) => {
              const nextRole = event.currentTarget.value;
              setFilters((current) => ({
                ...current,
                role: nextRole === '' ? undefined : (nextRole as UserRole),
              }));
            }}
          >
            <option value="">{app.userStatuses.all}</option>
            <option value="user">{app.userRoles.user}</option>
            <option value="admin">{app.userRoles.admin}</option>
          </select>
        </label>
        <label className="admin-inline-control">
          <span>{app.admin.level}</span>
          <select
            aria-label={app.adminUsers.levelFilter}
            value={filters.level === undefined ? '' : String(filters.level)}
            onChange={(event) => {
              const nextLevel = event.currentTarget.value;
              setFilters((current) => ({
                ...current,
                level: nextLevel === '' ? undefined : (Number(nextLevel) as UserLevel),
              }));
            }}
          >
            <option value="">{app.userStatuses.all}</option>
            {Array.from({ length: 10 }, (_, index) => index + 1).map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <p className="admin-users-result-note">{loadedUsersCopy(users.length, totalCount, app)}</p>
        <details className="admin-users-mobile-filters">
          <summary>{app.admin.showFilters}</summary>
          <div className="admin-users-mobile-filter-grid">
            <label className="admin-inline-control">
              <span>{app.adminUsers.status}</span>
              <select
                aria-label={app.adminUsers.mobileStatusFilter}
                value={filters.status ?? ''}
                onChange={(event) => {
                  const nextStatus = event.currentTarget.value;
                  setFilters((current) => ({
                    ...current,
                    status: nextStatus === '' ? undefined : (nextStatus as UserStatus),
                  }));
                }}
              >
                <option value="">{app.userStatuses.all}</option>
                <option value="pending">{app.adminUsers.pendingStatus}</option>
                <option value="approved">{app.adminUsers.activeStatus}</option>
                <option value="suspended">{app.adminUsers.suspendedStatus}</option>
              </select>
            </label>
            <label className="admin-inline-control">
              <span>{app.admin.userRole}</span>
              <select
                aria-label={app.adminUsers.mobileRoleFilter}
                value={filters.role ?? ''}
                onChange={(event) => {
                  const nextRole = event.currentTarget.value;
                  setFilters((current) => ({
                    ...current,
                    role: nextRole === '' ? undefined : (nextRole as UserRole),
                  }));
                }}
              >
                <option value="">{app.userStatuses.all}</option>
                <option value="user">{app.userRoles.user}</option>
                <option value="admin">{app.userRoles.admin}</option>
              </select>
            </label>
            <label className="admin-inline-control">
              <span>{app.admin.level}</span>
              <select
                aria-label={app.adminUsers.mobileLevelFilter}
                value={filters.level === undefined ? '' : String(filters.level)}
                onChange={(event) => {
                  const nextLevel = event.currentTarget.value;
                  setFilters((current) => ({
                    ...current,
                    level: nextLevel === '' ? undefined : (Number(nextLevel) as UserLevel),
                  }));
                }}
              >
                <option value="">{app.userStatuses.all}</option>
                {Array.from({ length: 10 }, (_, index) => index + 1).map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
      </div>

      <div
        className="table-shell admin-user-table"
        role="table"
        aria-label={app.adminUsers.usersTable}
      >
        {!loading && users.length === 0 ? (
          <div className="table-row admin-user-empty-row" role="row">
            <span>{app.admin.noUsers}</span>
          </div>
        ) : (
          users.map((user) => {
            const isSelf = currentAdminUserId === user.id;
            const saveStatus = savingByUserId[user.id] ?? 'idle';
            const controlsDisabled = isSelf || saveStatus === 'saving';
            const displayName = userDisplayName(user);

            return (
              <div
                className={`table-row admin-user-row${isSelf ? ' self-user-row' : ''}`}
                role="row"
                key={user.id}
              >
                <span className="admin-user-identity admin-row-title">
                  <span className={`admin-user-avatar ${userAvatarTone(user)}`}>
                    {userInitials(user)}
                  </span>
                  <span className="admin-user-copy">
                    <strong>{displayName}</strong>
                    <span>{user.email}</span>
                    {isSelf ? (
                      <span className="admin-row-note" title={app.adminUsers.selfAccessBlocked}>
                        {app.adminUsers.selfAccessBlocked}
                      </span>
                    ) : null}
                  </span>
                </span>
                <fieldset
                  aria-label={`${app.adminUsers.accessControlsFor} ${user.email}`}
                  className="admin-user-access"
                >
                  <legend className="sr-only">{app.adminUsers.access}</legend>
                  <div className="admin-access-control role-control">
                    <span>{app.admin.userRole}</span>
                    <RoleToggle
                      disabled={controlsDisabled}
                      label={roleForLabel(user.email, app)}
                      labels={{
                        user: app.userRoles.user,
                        admin: app.userRoles.admin,
                        userAriaLabel: userRoleForLabel(user.email, app),
                        adminAriaLabel: adminRoleForLabel(user.email, app),
                      }}
                      value={user.role}
                      onChange={(nextRole) => {
                        if (nextRole === user.role) {
                          return;
                        }

                        requestAccessChange(user, {
                          role: nextRole,
                          ...(nextRole === 'user' ? { level: levelValue(user) } : {}),
                        });
                      }}
                    />
                  </div>
                  <div className="admin-access-control status-control">
                    <span>{app.adminUsers.status}</span>
                    {user.status === 'pending' || user.status === 'profile_required' ? (
                      <div
                        aria-label={statusForLabel(user.email, app)}
                        className="pending-status-transition"
                      >
                        <span className="pending-status-chip">
                          {adminUserStatusLabel(user.status, app)}
                        </span>
                        <span className="pending-status-arrow" aria-hidden="true">
                          <ArrowRight />
                        </span>
                        <button
                          className="fa-primary-button pending-activate-button"
                          disabled={controlsDisabled || !canTransitionTo(user, 'approved')}
                          type="button"
                          onClick={() => {
                            requestAccessChange(user, { status: 'approved' });
                          }}
                        >
                          {app.adminUsers.activate}
                        </button>
                      </div>
                    ) : (
                      <fieldset
                        aria-label={statusForLabel(user.email, app)}
                        className="fa-status-toggle"
                        disabled={controlsDisabled}
                        title={isSelf ? app.adminUsers.selfAccessBlocked : undefined}
                      >
                        <legend className="sr-only">{statusForLabel(user.email, app)}</legend>
                        <div className="fa-segmented-control" role="group">
                          {(
                            [
                              ['approved', app.adminUsers.activeStatus],
                              ['suspended', app.adminUsers.suspendedStatus],
                            ] as const
                          ).map(([statusValue, label]) => (
                            <button
                              aria-pressed={user.status === statusValue}
                              className={user.status === statusValue ? 'selected' : undefined}
                              disabled={controlsDisabled || !canTransitionTo(user, statusValue)}
                              key={statusValue}
                              type="button"
                              onClick={() => {
                                if (user.status === statusValue) {
                                  return;
                                }

                                requestAccessChange(user, { status: statusValue });
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </fieldset>
                    )}
                  </div>
                  {user.role === 'user' ? (
                    <label className="admin-access-control">
                      <span>{app.admin.level}</span>
                      <select
                        disabled={controlsDisabled}
                        aria-label={levelForLabel(user.email, app)}
                        title={isSelf ? app.adminUsers.selfAccessBlocked : undefined}
                        value={levelValue(user)}
                        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                          requestAccessChange(user, {
                            level: Number(event.currentTarget.value) as UserLevel,
                          });
                        }}
                      >
                        {Array.from({ length: 10 }, (_, index) => index + 1).map((level) => (
                          <option key={level} value={level}>
                            {level}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className="admin-access-control">
                      <span>{app.admin.level}</span>
                      <span className="admin-effective-level locked">10</span>
                    </span>
                  )}
                </fieldset>
                <div className="admin-actions admin-user-row-actions">
                  {saveStatus === 'saving' ? (
                    <span className="admin-save-state">{app.adminUsers.saving}</span>
                  ) : null}
                  {saveStatus === 'saved' ? (
                    <span className="admin-save-state">{app.adminUsers.saved}</span>
                  ) : null}
                  {saveStatus === 'error' ? (
                    <span className="admin-save-state error-copy">{app.adminUsers.saveError}</span>
                  ) : null}
                  <button
                    aria-label={`${app.adminUsers.showAuditDetailsFor} ${user.email}`}
                    className="fa-secondary-button admin-audit-details-trigger"
                    type="button"
                    onClick={() => {
                      setAuditDetailsUserId(user.id);
                    }}
                  >
                    {app.adminUsers.auditDetails}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
      <DetailSheet
        closeLabel={app.commonActions.close}
        open={auditDetailsUser !== null}
        title={
          auditDetailsUser === null
            ? app.adminUsers.audit
            : `${app.adminUsers.auditFor} ${userDisplayName(auditDetailsUser)}`
        }
        onClose={() => {
          setAuditDetailsUserId(null);
        }}
      >
        {auditDetailsUser === null ? null : (
          <UserAuditDetails
            audit={userAuditById[auditDetailsUser.id]}
            app={app}
            locale={locale}
            user={auditDetailsUser}
            usersById={usersById}
          />
        )}
      </DetailSheet>
      {nextCursor === null && !loadingMore ? null : (
        <div
          aria-label={app.adminUsers.loadingMoreUsers}
          className="admin-infinite-scroll"
          ref={loadMoreRef}
          role="status"
        >
          <p className="admin-meta-text">{loadedUsersCopy(users.length, totalCount, app)}</p>
          <div className="admin-continuation-rows" aria-hidden="true">
            <span />
            <span />
          </div>
          <div className="admin-load-sentinel">
            <span className="admin-spinner" aria-hidden="true" />
            <span>{app.adminUsers.loadingMoreUsers}</span>
          </div>
        </div>
      )}
      <ConfirmDialog
        cancelLabel={app.commonActions.cancel}
        confirmLabel={app.commonActions.confirm}
        open={confirmation !== null}
        title={app.adminUsers.confirmAccessChangeTitle}
        onCancel={() => {
          setConfirmation(null);
        }}
        onConfirm={() => {
          void handleConfirmDestructive();
        }}
      >
        {confirmation?.type === 'access-change' ? (
          <div>
            <p>
              {app.adminUsers.accessChangeMessagePrefix} {confirmation.user.email}.
            </p>
            <ul>
              {confirmation.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
