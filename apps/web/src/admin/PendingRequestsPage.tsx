import type { ChangeEvent, ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { Ban, Check, XCircle } from 'lucide-react';

import type { CurrentUserSummaryForStatus, UserLevel, UserRole } from '@fa/http-contracts';

import { approveUser, listPendingRequests, rejectUser, suspendUser } from '../services/userApi.js';
import { useI18n } from '../i18n/useI18n.js';
import {
  adminRoleForLabel,
  levelForLabel,
  roleForLabel,
  userRoleForLabel,
} from '../i18n/displayLabels.js';
import { ActionMenu } from '../ui/ActionMenu.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { formatDateTime } from '../ui/formatters.js';
import { RoleToggle } from '../ui/RoleToggle.js';

interface PendingDraft {
  role: UserRole;
  level: UserLevel;
}

interface PendingConfirmation {
  type: 'reject' | 'suspend';
  userId: string;
  email: string;
}

export interface PendingRequestsPageProps {
  onRequestsChanged: () => Promise<void>;
}

function defaultDraft(): PendingDraft {
  return { role: 'user', level: 1 };
}

export function PendingRequestsPage({ onRequestsChanged }: PendingRequestsPageProps): ReactElement {
  const { locale, messages } = useI18n();
  const app = messages.app;
  const [users, setUsers] = useState<CurrentUserSummaryForStatus<'pending'>[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PendingDraft>>({});
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const emptyState = {
    title: app.admin.noPendingRequests,
    body: app.admin.noPendingRequestsBody,
    lastChecked: app.admin.pendingRequestsLastChecked,
    refresh: app.admin.pendingRequestsRefresh,
    users: app.admin.pendingRequestsUsers,
    usage: app.admin.pendingRequestsUsage,
    knowledge: app.admin.pendingRequestsKnowledge,
  };

  async function loadPendingRequests(): Promise<void> {
    const response = await listPendingRequests();
    setUsers(response.users);
    setLastLoadedAt(new Date().toISOString());
    setDrafts((current) => {
      const nextDrafts = { ...current };
      for (const user of response.users) {
        nextDrafts[user.id] = nextDrafts[user.id] ?? defaultDraft();
      }
      return nextDrafts;
    });
  }

  async function handleManualRefresh(): Promise<void> {
    await loadPendingRequests();
    await onRequestsChanged();
  }

  useEffect(() => {
    void loadPendingRequests();
  }, []);

  function updateDraft(userId: string, patch: Partial<PendingDraft>): void {
    setDrafts((current) => ({
      ...current,
      [userId]: {
        ...(current[userId] ?? defaultDraft()),
        ...patch,
      },
    }));
  }

  async function refreshAfterMutation(): Promise<void> {
    await loadPendingRequests();
    await onRequestsChanged();
  }

  async function handleApprove(userId: string): Promise<void> {
    const draft = drafts[userId] ?? defaultDraft();
    if (draft.role === 'admin') {
      await approveUser(userId, { role: 'admin' });
    } else {
      await approveUser(userId, { role: 'user', level: draft.level });
    }

    await refreshAfterMutation();
  }

  async function handleReject(userId: string): Promise<void> {
    await rejectUser(userId);
    await refreshAfterMutation();
  }

  async function handleSuspend(userId: string): Promise<void> {
    await suspendUser(userId);
    await refreshAfterMutation();
  }

  async function handleConfirmDestructive(): Promise<void> {
    if (confirmation === null) {
      return;
    }

    const { type, userId } = confirmation;
    setConfirmation(null);
    if (type === 'reject') {
      await handleReject(userId);
      return;
    }

    await handleSuspend(userId);
  }

  return (
    <section className="view-stack" aria-labelledby="pending-requests-heading">
      <div className="panel-header fa-section-header">
        <div>
          <h2 id="pending-requests-heading">{app.admin.pendingRequests}</h2>
          <p className="panel-subtitle">{app.admin.pendingRequestsSubtitle}</p>
        </div>
      </div>

      <div className="admin-review-list" aria-label={app.admin.pendingRequests}>
        {users.length === 0 ? (
          <section className="fa-surface admin-empty-state" aria-labelledby="pending-empty-title">
            <h3 id="pending-empty-title">{emptyState.title}</h3>
            <p>{emptyState.body}</p>
            <p>
              {emptyState.lastChecked}:{' '}
              {lastLoadedAt === null ? '-' : formatDateTime(lastLoadedAt, locale)}
            </p>
            <div className="admin-actions">
              <button
                className="fa-primary-button"
                type="button"
                onClick={() => void handleManualRefresh()}
              >
                {emptyState.refresh}
              </button>
              <a className="fa-secondary-button" href="#/admin/users">
                {emptyState.users}
              </a>
              <a className="fa-secondary-button" href="#/admin/usage">
                {emptyState.usage}
              </a>
              <a className="fa-secondary-button" href="#/admin/knowledge">
                {emptyState.knowledge}
              </a>
            </div>
          </section>
        ) : (
          users.map((user) => {
            const draft = drafts[user.id] ?? defaultDraft();

            return (
              <article className="fa-surface admin-review-card" key={user.id}>
                <div className="admin-review-person">
                  <strong>{user.email}</strong>
                  <span>
                    {[user.firstName, user.lastName].filter(Boolean).join(' ') ||
                      app.admin.pendingUserFallback}
                  </span>
                </div>
                <RoleToggle
                  label={roleForLabel(user.email, app)}
                  labels={{
                    user: app.userRoles.user,
                    admin: app.userRoles.admin,
                    userAriaLabel: userRoleForLabel(user.email, app),
                    adminAriaLabel: adminRoleForLabel(user.email, app),
                  }}
                  value={draft.role}
                  onChange={(role) => {
                    updateDraft(user.id, {
                      role,
                      ...(role === 'user' ? { level: draft.level } : {}),
                    });
                  }}
                />
                {draft.role === 'user' ? (
                  <label className="admin-inline-control">
                    <span>{app.admin.level}</span>
                    <select
                      aria-label={levelForLabel(user.email, app)}
                      value={draft.level}
                      onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                        updateDraft(user.id, {
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
                  <span className="muted-copy">{app.adminUsers.adminLevelAccess}</span>
                )}
                <div className="admin-actions admin-review-actions">
                  <button
                    className="fa-primary-button"
                    aria-label={`${app.commonActions.approve} ${user.email}`}
                    title={`${app.commonActions.approve} ${user.email}`}
                    type="button"
                    onClick={() => {
                      void handleApprove(user.id);
                    }}
                  >
                    <Check aria-hidden="true" />
                    <span className="admin-review-approve-label">{app.commonActions.approve}</span>
                  </button>
                  <ActionMenu
                    label={app.commonActions.more}
                    title={app.commonActions.more}
                    items={[
                      {
                        label: app.commonActions.reject,
                        ariaLabel: `${app.commonActions.reject} ${user.email}`,
                        title: `${app.commonActions.reject} ${user.email}`,
                        icon: XCircle,
                        onSelect: () => {
                          setConfirmation({
                            type: 'reject',
                            userId: user.id,
                            email: user.email,
                          });
                        },
                      },
                      {
                        label: app.commonActions.suspend,
                        ariaLabel: `${app.commonActions.suspend} ${user.email}`,
                        title: `${app.commonActions.suspend} ${user.email}`,
                        icon: Ban,
                        tone: 'danger',
                        onSelect: () => {
                          setConfirmation({
                            type: 'suspend',
                            userId: user.id,
                            email: user.email,
                          });
                        },
                      },
                    ]}
                  />
                </div>
              </article>
            );
          })
        )}
      </div>
      <ConfirmDialog
        cancelLabel={app.commonActions.cancel}
        confirmLabel={
          confirmation?.type === 'reject' ? app.commonActions.reject : app.commonActions.suspend
        }
        open={confirmation !== null}
        title={
          confirmation?.type === 'reject'
            ? app.admin.pendingRejectTitle
            : app.admin.pendingSuspendTitle
        }
        onCancel={() => {
          setConfirmation(null);
        }}
        onConfirm={() => {
          void handleConfirmDestructive();
        }}
      >
        {confirmation === null ? null : (
          <p>
            {app.admin.pendingAccessChangeMessagePrefix} {confirmation.email}.{' '}
            {app.admin.pendingAccessChangeMessageSuffix}
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}
