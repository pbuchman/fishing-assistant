import type { ReactElement } from 'react';
import {
  BarChart3,
  BookOpenText,
  Clock3,
  ListChecks,
  MessageSquareText,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import type { AppMessages } from '@fa/i18n';

import type { NavigationDrawerGroup } from './NavigationDrawer.js';

export type AppNavigationRole = 'user' | 'admin';
export type AppNavigationActiveRoute =
  | 'chat'
  | 'usage'
  | 'pending'
  | 'users'
  | 'knowledge'
  | 'answer-gaps'
  | 'settings';

interface AppNavItem {
  key: AppNavigationActiveRoute;
  label: string;
  hash: string;
  icon: ReactElement;
  badge?: number | null;
}

function navItem(
  item: AppNavItem,
  activeRoute: AppNavigationActiveRoute
): NavigationDrawerGroup['items'][number] {
  return {
    href: item.hash,
    label: item.label,
    icon: item.icon,
    active: activeRoute === item.key,
    badge: item.badge !== null && item.badge !== undefined && item.badge > 0 ? item.badge : null,
  };
}

export function appNavigationGroups({
  messages,
  role,
  activeRoute,
  pendingCount = 0,
}: {
  messages: AppMessages;
  role: AppNavigationRole;
  activeRoute: AppNavigationActiveRoute;
  pendingCount?: number;
}): NavigationDrawerGroup[] {
  const groups: NavigationDrawerGroup[] = [
    {
      items: [
        navItem(
          {
            key: 'chat',
            label: messages.chat.navLabel,
            hash: '#/chat',
            icon: <MessageSquareText aria-hidden="true" />,
          },
          activeRoute
        ),
      ],
    },
  ];

  if (role !== 'admin') {
    return groups;
  }

  groups.push(
    {
      label: messages.admin.accessGroup,
      items: [
        navItem(
          {
            key: 'usage',
            label: messages.usage.navLabel,
            hash: '#/admin/usage',
            icon: <BarChart3 aria-hidden="true" />,
          },
          activeRoute
        ),
        navItem(
          {
            key: 'pending',
            label: messages.admin.pendingRequests,
            hash: '#/admin/pending',
            icon: <Clock3 aria-hidden="true" />,
            badge: pendingCount,
          },
          activeRoute
        ),
        navItem(
          {
            key: 'users',
            label: messages.admin.users,
            hash: '#/admin/users',
            icon: <Users aria-hidden="true" />,
          },
          activeRoute
        ),
      ],
    },
    {
      label: messages.admin.knowledgeGroup,
      items: [
        navItem(
          {
            key: 'knowledge',
            label: messages.admin.knowledgeBase,
            hash: '#/admin/knowledge',
            icon: <BookOpenText aria-hidden="true" />,
          },
          activeRoute
        ),
        navItem(
          {
            key: 'answer-gaps',
            label: messages.admin.answerGaps,
            hash: '#/admin/answer-gaps',
            icon: <ListChecks aria-hidden="true" />,
          },
          activeRoute
        ),
      ],
    },
    {
      label: messages.admin.systemGroup,
      items: [
        navItem(
          {
            key: 'settings',
            label: messages.admin.settings,
            hash: '#/admin/settings',
            icon: <SlidersHorizontal aria-hidden="true" />,
          },
          activeRoute
        ),
      ],
    }
  );

  return groups;
}
