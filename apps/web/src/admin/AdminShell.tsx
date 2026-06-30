import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  BookOpenText,
  Clock3,
  ListChecks,
  MessageSquareText,
  SlidersHorizontal,
  Users,
} from 'lucide-react';

import { useFaAuth } from '../auth/useFaAuth.js';
import { useI18n } from '../i18n/useI18n.js';
import { getPendingRequestsCount } from '../services/userApi.js';
import { workspaceUserSummary } from '../ui/accountSummary.js';
import { WorkspaceSidebarShell, type WorkspaceSidebarGroup } from '../ui/WorkspaceSidebarShell.js';
import type { AppNavigationActiveRoute } from '../ui/appNavigation.js';
import { useDocumentTitle } from '../ui/useDocumentTitle.js';
import { AnswerGapsPage } from './answer-gaps/AnswerGapsPage.js';
import { KnowledgeAdminPage } from './knowledge/KnowledgeAdminPage.js';
import { AdminNavigationGuardProvider, type AdminNavigationGuardState } from './navigationGuard.js';
import { PendingRequestsPage } from './PendingRequestsPage.js';
import { SettingsPage } from './settings/SettingsPage.js';
import { UsageDashboard } from './usage/UsageDashboard.js';
import { UsersPage } from './UsersPage.js';

type AdminRoute =
  | { key: 'pending' }
  | { key: 'users' }
  | { key: 'knowledge'; pageId?: string }
  | { key: 'answer-gaps' }
  | { key: 'usage' }
  | { key: 'settings' }
  | { key: 'not-found' };

function parseAdminHash(hash: string): AdminRoute {
  const match = /^#\/admin(?:\/([^/]+)(?:\/([^/]+))?)?$/.exec(hash);
  const section = match?.[1];
  const detail = match?.[2];

  if (section === 'users') {
    return { key: 'users' };
  }

  if (section === 'knowledge') {
    return detail === undefined
      ? { key: 'knowledge' }
      : { key: 'knowledge', pageId: decodeURIComponent(detail) };
  }

  if (section === 'usage') {
    return { key: 'usage' };
  }

  if (section === 'settings') {
    return { key: 'settings' };
  }

  if (section === 'answer-gaps') {
    return { key: 'answer-gaps' };
  }

  if (section === undefined || section === 'pending') {
    return { key: 'pending' };
  }

  return { key: 'not-found' };
}

function AdminNotFoundPage(): ReactElement {
  return (
    <section className="view-stack" aria-labelledby="admin-not-found-heading">
      <div className="panel-header fa-section-header">
        <div>
          <h2 id="admin-not-found-heading">Admin page not found</h2>
          <p className="panel-subtitle">This admin route does not exist.</p>
        </div>
      </div>
      <div className="admin-actions">
        <a className="fa-primary-button" href="#/admin/usage">
          Open Usage
        </a>
        <a className="fa-secondary-button" href="#/admin/users">
          Open Users
        </a>
        <a className="fa-secondary-button" href="#/admin/knowledge">
          Open Knowledge Base
        </a>
      </div>
    </section>
  );
}

function CurrentAdminView({
  route,
  onPendingCountChanged,
}: {
  route: AdminRoute;
  onPendingCountChanged: () => Promise<void>;
}): ReactElement {
  if (route.key === 'users') {
    return (
      <UsersPage
        onUsersChanged={() => {
          return onPendingCountChanged();
        }}
      />
    );
  }

  if (route.key === 'knowledge') {
    return <KnowledgeAdminPage selectedPageId={route.pageId} />;
  }

  if (route.key === 'usage') {
    return <UsageDashboard />;
  }

  if (route.key === 'settings') {
    return <SettingsPage />;
  }

  if (route.key === 'answer-gaps') {
    return <AnswerGapsPage />;
  }

  if (route.key === 'not-found') {
    return <AdminNotFoundPage />;
  }

  return (
    <PendingRequestsPage
      onRequestsChanged={() => {
        return onPendingCountChanged();
      }}
    />
  );
}

function activeNavigationRoute(route: AdminRoute): AppNavigationActiveRoute {
  if (route.key === 'not-found') {
    return 'usage';
  }

  return route.key;
}

function adminPageTitle(
  route: AdminRoute,
  admin: ReturnType<typeof useI18n>['messages']['app']['admin']
): string {
  switch (route.key) {
    case 'pending':
      return admin.pendingRequests;
    case 'users':
      return admin.users;
    case 'knowledge':
      return admin.knowledgeBase;
    case 'answer-gaps':
      return admin.answerGaps;
    case 'usage':
      return admin.llmUsage;
    case 'settings':
      return admin.settings;
    case 'not-found':
      return 'Admin page not found';
  }
}

function adminNavigationGroups({
  activeRoute,
  messages,
  pendingCount,
}: {
  activeRoute: AppNavigationActiveRoute;
  messages: ReturnType<typeof useI18n>['messages']['app'];
  pendingCount: number;
}): WorkspaceSidebarGroup[] {
  const admin = messages.admin;

  return [
    {
      label: admin.workspaceGroup,
      items: [
        {
          key: 'chat',
          href: '#/chat',
          label: messages.chat.navLabel,
          icon: <MessageSquareText aria-hidden="true" />,
          active: activeRoute === 'chat',
        },
      ],
    },
    {
      label: admin.accessGroup,
      items: [
        {
          key: 'pending',
          href: '#/admin/pending',
          label: admin.pendingRequests,
          icon: <Clock3 aria-hidden="true" />,
          active: activeRoute === 'pending',
          badge: pendingCount > 0 ? pendingCount : null,
        },
        {
          key: 'users',
          href: '#/admin/users',
          label: admin.users,
          icon: <Users aria-hidden="true" />,
          active: activeRoute === 'users',
        },
      ],
    },
    {
      label: admin.knowledgeGroup,
      items: [
        {
          key: 'knowledge',
          href: '#/admin/knowledge',
          label: admin.knowledgeBase,
          icon: <BookOpenText aria-hidden="true" />,
          active: activeRoute === 'knowledge',
        },
        {
          key: 'answer-gaps',
          href: '#/admin/answer-gaps',
          label: admin.answerGaps,
          icon: <ListChecks aria-hidden="true" />,
          active: activeRoute === 'answer-gaps',
        },
      ],
    },
    {
      label: admin.reportingGroup,
      items: [
        {
          key: 'usage',
          href: '#/admin/usage',
          label: admin.llmUsage,
          icon: <BarChart3 aria-hidden="true" />,
          active: activeRoute === 'usage',
        },
      ],
    },
    {
      label: admin.systemGroup,
      items: [
        {
          key: 'settings',
          href: '#/admin/settings',
          label: admin.settings,
          icon: <SlidersHorizontal aria-hidden="true" />,
          active: activeRoute === 'settings',
        },
      ],
    },
  ];
}

export function AdminShell(): ReactElement {
  const [route, setRoute] = useState<AdminRoute>(() => parseAdminHash(window.location.hash));
  const [pendingCount, setPendingCount] = useState(0);
  const [navigationGuard, setNavigationGuard] = useState<AdminNavigationGuardState | null>(null);
  const acceptedHashRef = useRef(window.location.hash);
  const navigationGuardRef = useRef<AdminNavigationGuardState | null>(null);
  const auth = useFaAuth();
  const { messages } = useI18n();
  const pageTitle = adminPageTitle(route, messages.app.admin);
  const navGroups = useMemo(
    () =>
      adminNavigationGroups({
        activeRoute: activeNavigationRoute(route),
        messages: messages.app,
        pendingCount,
      }),
    [messages.app, pendingCount, route.key]
  );
  const userSummary = workspaceUserSummary(auth.accountState);
  useDocumentTitle(`${pageTitle} - Admin`);

  async function refreshPendingCount(): Promise<void> {
    const response = await getPendingRequestsCount();
    setPendingCount(response.count);
  }

  useEffect(() => {
    navigationGuardRef.current = navigationGuard;
  }, [navigationGuard]);

  const handleNavigationGuardChange = useCallback((guard: AdminNavigationGuardState | null) => {
    setNavigationGuard(guard);
  }, []);

  useEffect(() => {
    const syncRoute = (): void => {
      if (window.location.hash === '#/admin' || window.location.hash === '#/admin/') {
        window.history.replaceState(null, '', '#/admin/pending');
      }

      const nextHash = window.location.hash;
      const guard = navigationGuardRef.current;
      if (nextHash !== acceptedHashRef.current && guard?.isDirty === true) {
        const shouldLeave = window.confirm(guard.confirmMessage);
        if (!shouldLeave) {
          window.history.replaceState(null, '', acceptedHashRef.current);
          return;
        }
      }

      acceptedHashRef.current = window.location.hash;
      setRoute(parseAdminHash(window.location.hash));
    };

    syncRoute();
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  useEffect(() => {
    void refreshPendingCount();
  }, []);

  return (
    <AdminNavigationGuardProvider setGuard={handleNavigationGuardChange}>
      <WorkspaceSidebarShell
        brandTitle={messages.app.shell.workspaceTitle}
        mainId="admin-main-content"
        mobileTitle={pageTitle}
        navigationGroups={navGroups}
        resetKey={`admin:${route.key}${route.key === 'knowledge' ? `:${route.pageId ?? ''}` : ''}`}
        skipToContentLabel={messages.app.shell.skipToContent}
        user={userSummary}
        onLogout={() => {
          void auth.logout();
        }}
        onOpenProfile={() => {
          window.location.hash = '#/profile';
        }}
      >
        <div className="admin-content-shell">
          <CurrentAdminView route={route} onPendingCountChanged={refreshPendingCount} />
        </div>
      </WorkspaceSidebarShell>
    </AdminNavigationGuardProvider>
  );
}
