import type { ReactElement, ReactNode } from 'react';
import { House, Plus, Trash2 } from 'lucide-react';

import type { Conversation } from '../services/chatApi.js';
import type { AppNavigationRole } from '../ui/appNavigation.js';
import type { WorkspaceAccountSummary } from '../ui/accountSummary.js';
import { WorkspaceSidebarShell, type WorkspaceSidebarItem } from '../ui/WorkspaceSidebarShell.js';
import { useI18n } from '../i18n/useI18n.js';

const englishNewChatFallback = 'New Chat';

interface WorkspaceShellProps {
  children: ReactNode;
  conversations: Conversation[];
  deleteConversationLabel: string;
  emptyConversationLabel: string;
  newChatLabel: string;
  role: AppNavigationRole;
  selectedConversationId: string | undefined;
  skipToContentLabel: string;
  untitledConversationLabel: string;
  user: WorkspaceAccountSummary;
  onDeleteConversation: (conversationId: string) => void | Promise<void>;
  onLogout: () => void | Promise<void>;
  onNewChat: () => void | Promise<void>;
  onOpenProfile: () => void;
  routeForConversation: (conversationId: string) => string;
}

function displayConversationTitle(
  conversation: Conversation,
  labels: { newChatLabel: string; untitledConversationLabel: string }
): string {
  if (conversation.messageCount === 0) {
    return labels.untitledConversationLabel;
  }

  return conversation.title.trim() === englishNewChatFallback
    ? labels.newChatLabel
    : conversation.title;
}

function deleteConversationAriaLabel(deleteLabel: string, title: string): string {
  if (deleteLabel === 'Usuń') {
    return `Usuń rozmowę: ${title}`;
  }

  if (deleteLabel === 'Delete') {
    return `Delete conversation: ${title}`;
  }

  return `${deleteLabel}: ${title}`;
}

export function WorkspaceShell({
  children,
  conversations,
  deleteConversationLabel,
  emptyConversationLabel,
  newChatLabel,
  role,
  selectedConversationId,
  skipToContentLabel,
  untitledConversationLabel,
  user,
  onDeleteConversation,
  onLogout,
  onNewChat,
  onOpenProfile,
  routeForConversation,
}: WorkspaceShellProps): ReactElement {
  const { messages } = useI18n();
  const shell = messages.app.shell;
  const adminLink: WorkspaceSidebarItem | null =
    role === 'admin'
      ? {
          key: 'administration',
          href: '#/admin',
          label: messages.app.admin.administration,
          icon: <House aria-hidden="true" />,
        }
      : null;

  return (
    <WorkspaceSidebarShell
      brandTitle={shell.workspaceTitle}
      mainId="workspace-main-content"
      mobileTitle={shell.workspaceTitle}
      resetKey={`chat:${selectedConversationId ?? 'new'}`}
      skipToContentLabel={skipToContentLabel}
      user={user}
      utilityItems={adminLink === null ? [] : [adminLink]}
      onLogout={onLogout}
      onOpenProfile={onOpenProfile}
      primaryAction={({ closeNavigation, controlTabIndex }) => (
        <button
          className="workspace-new-chat"
          tabIndex={controlTabIndex}
          type="button"
          onClick={() => {
            closeNavigation();
            void onNewChat();
          }}
        >
          <Plus aria-hidden="true" />
          <span className="workspace-sidebar-text">{newChatLabel}</span>
        </button>
      )}
      sidebarContent={({ closeNavigation, controlTabIndex }) => (
        <section
          className="workspace-conversation-list"
          aria-label={messages.app.chat.conversations}
        >
          <div className="workspace-sidebar-section-label workspace-sidebar-text">
            {messages.app.chat.conversations}
          </div>
          {conversations.length === 0 ? (
            <p className="workspace-empty-conversations workspace-sidebar-text">
              {emptyConversationLabel}
            </p>
          ) : (
            conversations.map((conversation) => {
              const title = displayConversationTitle(conversation, {
                newChatLabel,
                untitledConversationLabel,
              });

              return (
                <div
                  className={
                    conversation.id === selectedConversationId
                      ? 'workspace-conversation-row active'
                      : 'workspace-conversation-row'
                  }
                  key={conversation.id}
                >
                  <a
                    aria-current={conversation.id === selectedConversationId ? 'page' : undefined}
                    href={routeForConversation(conversation.id)}
                    tabIndex={controlTabIndex}
                    title={title}
                    onClick={closeNavigation}
                  >
                    <span>{title}</span>
                  </a>
                  <button
                    aria-label={deleteConversationAriaLabel(deleteConversationLabel, title)}
                    className="workspace-conversation-delete"
                    tabIndex={controlTabIndex}
                    type="button"
                    onClick={() => {
                      void onDeleteConversation(conversation.id);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              );
            })
          )}
        </section>
      )}
    >
      {children}
    </WorkspaceSidebarShell>
  );
}
