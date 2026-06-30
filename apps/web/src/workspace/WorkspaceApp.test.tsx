import { createElement, type ComponentType } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Conversation,
  ConversationMessage,
  RetrievalEvidenceSummary,
} from '../services/chatApi.js';
import { I18nProvider } from '../i18n/I18nProvider.js';
import { appMessages } from '@fa/i18n';
import type { UseChatWorkflowResult } from './useChatWorkflow.js';

const workspaceAppModulePath = './WorkspaceApp.js';
const mobileDrawerQuery = '(max-width: 980px)';

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  getPendingRequestsCount: vi.fn(),
  getKnowledgeSource: vi.fn(),
  listConversations: vi.fn(),
  useChatWorkflow: vi.fn(),
  logout: vi.fn(() => Promise.resolve()),
}));

function mockMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query === mobileDrawerQuery ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
}

vi.mock('../services/chatApi.js', () => ({
  createConversation: mocks.createConversation,
  deleteConversation: mocks.deleteConversation,
  listConversations: mocks.listConversations,
}));

vi.mock('../services/knowledgeApi.js', async () => {
  const actual = await vi.importActual('../services/knowledgeApi.js');
  return {
    ...actual,
    getKnowledgeSource: mocks.getKnowledgeSource,
  };
});

vi.mock('../services/userApi.js', async () => {
  const actual = await vi.importActual('../services/userApi.js');
  return {
    ...actual,
    getPendingRequestsCount: mocks.getPendingRequestsCount,
  };
});

vi.mock('./useChatWorkflow.js', () => ({
  useChatWorkflow: mocks.useChatWorkflow,
}));

vi.mock('../auth/useFaAuth.js', () => ({
  useFaAuth: () => ({
    accountState: {
      status: 'approved',
      account: {
        state: 'approved',
        user: {
          id: 'user-1',
          email: 'angler@example.com',
          firstName: 'River',
          lastName: 'Walker',
          mobileNumber: '+15550101000',
          role: 'admin',
          status: 'approved',
          level: 3,
          effectiveLevel: 3,
        },
        authorization: {
          userId: 'user-1',
          auth0Subject: 'auth0|river',
          email: 'angler@example.com',
          role: 'admin',
          status: 'approved',
          effectiveLevel: 3,
        },
      },
      authorization: {
        userId: 'user-1',
        auth0Subject: 'auth0|river',
        email: 'angler@example.com',
        role: 'admin',
        status: 'approved',
        effectiveLevel: 3,
      },
    },
    isLoading: false,
    isAuthenticated: true,
    isLogoutInProgress: false,
    sessionKey: 'workspace-session',
    login: vi.fn(() => Promise.resolve()),
    logout: mocks.logout,
    refreshCurrentUser: vi.fn(() => Promise.resolve()),
    completeProfile: vi.fn(() => Promise.resolve()),
    getAccessToken: vi.fn(() => Promise.resolve('token')),
    refreshAccessToken: vi.fn(() => Promise.resolve('token')),
  }),
}));

vi.mock('../admin/PendingRequestsPage.js', () => ({
  PendingRequestsPage: ({ onRequestsChanged }: { onRequestsChanged: () => Promise<void> }) =>
    createElement(
      'div',
      null,
      createElement('h2', null, 'Pending Requests'),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            void onRequestsChanged();
          },
        },
        'Refresh count from pending page'
      )
    ),
}));

vi.mock('../admin/UsersPage.js', () => ({
  UsersPage: ({ onUsersChanged }: { onUsersChanged: () => Promise<void> }) =>
    createElement(
      'div',
      null,
      createElement('h2', null, 'Users'),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            void onUsersChanged();
          },
        },
        'Refresh count from users page'
      )
    ),
}));

vi.mock('../admin/knowledge/KnowledgeAdminPage.js', () => ({
  KnowledgeAdminPage: ({ selectedPageId }: { selectedPageId?: string }) =>
    createElement(
      'div',
      null,
      selectedPageId === undefined ? 'Admin Knowledge Base' : `Admin Knowledge ${selectedPageId}`
    ),
}));

vi.mock('../admin/usage/UsageDashboard.js', () => ({
  UsageDashboard: () => createElement('div', null, 'Admin Usage Dashboard'),
}));

const conversation: Conversation = {
  id: 'c1',
  title: 'River rigs',
  status: 'active',
  createdAt: '2026-06-14T09:00:00.000Z',
  updatedAt: '2026-06-14T09:05:00.000Z',
  lastMessageAt: '2026-06-14T09:05:00.000Z',
  lastMessagePreview: '',
  messageCount: 2,
  deletedAt: null,
};

const laterConversation: Conversation = {
  ...conversation,
  id: 'c2',
  title: 'Canal tench',
  lastMessageAt: '2026-06-14T10:05:00.000Z',
  lastMessagePreview: 'Try hemp near lilies.',
};

const streamPreviewMessage: ConversationMessage = {
  id: 'stream-draft',
  userId: 'user-1',
  conversationId: 'c1',
  role: 'assistant',
  content: 'Draft answer',
  createdAt: '',
  citations: [
    { sourceId: 'knowledge\u0000chunk-preview', usedFor: 'preview citation' },
    { sourceId: 'knowledge\u0000chunk-manual-source', usedFor: 'manual-source citation' },
    { sourceId: 'knowledge\u0000chunk-external', usedFor: 'external citation' },
    { sourceId: 'knowledge\u0000chunk-unsafe-url', usedFor: 'unsafe citation' },
  ],
  missingInformation: ['No evidence about hook bait.'],
  retrieval: {
    query: 'Which bait?',
    startedAt: '2026-06-14T09:04:00.000Z',
    completedAt: '2026-06-14T09:04:01.000Z',
    sources: [],
    evidence: [
      {
        id: 'chunk-preview',
        sourceId: 'knowledge',
        sourceType: 'knowledge_page',
        title: 'Preview evidence',
        quote: 'Use a light feeder mix.',
        score: 0.91,
        metadata: { headingPath: 'not-a-heading-array' },
      },
      {
        id: 'chunk-manual-source',
        sourceId: 'knowledge',
        sourceType: 'knowledge_page',
        title: 'Manual-source evidence',
        quote: 'Manual-source evidence should render without a fabricated link.',
        score: 0.82,
        metadata: {},
      },
      {
        id: 'chunk-external',
        sourceId: 'knowledge',
        sourceType: 'knowledge_page',
        title: 'External evidence',
        quote: 'External source link.',
        score: 0.72,
        metadata: {},
      },
      {
        id: 'chunk-unsafe-url',
        sourceId: 'knowledge',
        sourceType: 'knowledge_page',
        title: 'Unsafe URL evidence',
        quote: 'Unsafe source link.',
        score: 0.62,
        metadata: {},
      },
    ],
  },
};

const persistedAssistantMessage: ConversationMessage = {
  id: 'm1',
  userId: 'user-1',
  conversationId: 'c1',
  role: 'assistant',
  content: 'Use a short hooklink and keep notes tied to sources.',
  createdAt: '2026-06-14T09:06:00.000Z',
  citations: [
    { sourceId: 'chunk-safe', usedFor: 'rig length' },
    { sourceId: 'knowledge\u0000chunk-manual', usedFor: 'manual source' },
    { sourceId: 'knowledge\u0000chunk-unsafe', usedFor: 'unsafe source' },
  ],
  missingInformation: [],
  retrieval: {
    query: 'How long should the hooklink be?',
    startedAt: '2026-06-14T09:05:00.000Z',
    completedAt: '2026-06-14T09:05:01.000Z',
    sources: [],
    evidence: [
      {
        id: 'chunk-safe',
        sourceId: 'knowledge',
        sourceType: 'knowledge_page',
        title: 'Hooklink notes',
        quote: 'Short hooklinks work well near weed.',
        score: 0.93,
        metadata: { headingPath: ['Category', 'Rigs', 'Hooklinks'] },
      },
      {
        id: 'chunk-manual',
        sourceId: 'knowledge',
        sourceType: 'knowledge_page',
        title: 'Manual rig note',
        quote: 'Manual notes do not imply a link.',
        score: 0.73,
        metadata: {},
      },
      {
        id: 'chunk-unsafe',
        sourceId: 'knowledge',
        sourceType: 'knowledge_page',
        title: 'Unsafe note',
        quote: 'Unsafe URLs must not render.',
        score: 0.63,
        metadata: {},
      },
    ],
  },
};

const methodFeederEvidence: RetrievalEvidenceSummary = {
  id: 'method-feeder-evidence',
  sourceId: 'knowledge-page:method-feeder',
  sourceType: 'knowledge_page',
  title: 'Synthetic Fixture Source - Markdown Cleanup Case',
  quote:
    'Synthetic Fixture Source - Markdown Cleanup Case / **1. What is synthetic fixture?**\n\n![method1.jpg](https://example.com/method1.jpg) **Synthetic fixture** contains placeholder quote text for cleanup assertions. It keeps markdown, image syntax, and extra trailing text for rendering tests.',
  score: 0.88,
  metadata: {},
};

function chatWorkflow(overrides: Partial<UseChatWorkflowResult> = {}): UseChatWorkflowResult {
  return {
    messages: [],
    messagesStatus: 'idle',
    messagesError: null,
    composer: '',
    setComposer: vi.fn(),
    streaming: false,
    streamPhase: 'starting',
    streamLongRunning: false,
    streamDraft: '',
    streamCitations: [],
    streamEvidence: [],
    streamMissing: [],
    streamError: null,
    answerGapCandidatesByMessageId: {},
    answerGapActionBusyByMessageId: {},
    answerGapActionErrorByMessageId: {},
    hasStreamPreview: false,
    streamPreviewMessage,
    queuedFollowUp: null,
    handleSendMessage: vi.fn(() => Promise.resolve()),
    cancelStream: vi.fn(),
    clearQueuedFollowUp: vi.fn(),
    editQueuedFollowUp: vi.fn(),
    retryLastMessage: vi.fn(() => Promise.resolve()),
    shareAnswerGapCandidateForMessage: vi.fn(() => Promise.resolve()),
    declineAnswerGapCandidateForMessage: vi.fn(() => Promise.resolve()),
    withdrawAnswerGapCandidateForMessage: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

async function renderWorkspaceApp(role: 'user' | 'admin' = 'user'): Promise<void> {
  const { default: WorkspaceApp } = (await import(workspaceAppModulePath)) as {
    default: ComponentType<{ role?: 'user' | 'admin' }>;
  };
  render(createElement(I18nProvider, null, createElement(WorkspaceApp, { role })));
}

async function renderAdminShell(): Promise<void> {
  const { AdminShell } = (await import('../admin/AdminShell.js')) as {
    AdminShell: ComponentType;
  };

  render(createElement(I18nProvider, null, createElement(AdminShell)));
}

describe('WorkspaceApp render states', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    window.localStorage.clear();
    mocks.getKnowledgeSource.mockResolvedValue({
      id: 'source-page-1',
      sourceId: 'knowledge-page:source-page-1',
      title: 'spring liquid additive quantity',
      content: 'Przykladowa tresc zrodla testowego.',
      updatedAt: '2026-06-14T12:01:00.500Z',
      access: { gate: 'approved', requiredLevel: null, retrievalReady: true },
    });
    mocks.getPendingRequestsCount.mockResolvedValue({ count: 3 });
    mocks.listConversations.mockResolvedValue([]);
    mocks.useChatWorkflow.mockReturnValue(chatWorkflow());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    mocks.logout.mockClear();
    window.history.replaceState(null, '', '/');
  });

  it('renders the approved Gemini-style workspace sidebar contract', async () => {
    window.history.replaceState(null, '', '/#/chat/c2');
    mocks.listConversations.mockResolvedValue([laterConversation, conversation]);
    mocks.useChatWorkflow.mockReturnValue(chatWorkflow({ messages: [persistedAssistantMessage] }));

    await renderWorkspaceApp('admin');

    const sidebar = await screen.findByRole('navigation', {
      name: 'Główna nawigacja',
    });
    expect(within(sidebar).getByText('Asystent wędkarski')).not.toBeNull();
    expect(within(sidebar).getByRole('button', { name: 'Nowy chat' })).not.toBeNull();
    expect(within(sidebar).getByRole('link', { name: 'Canal tench' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(within(sidebar).getByRole('link', { name: 'River rigs' })).not.toBeNull();
    expect(within(sidebar).queryByText('Try hemp near lilies.')).toBeNull();
    expect(within(sidebar).queryByText('2026-06-14')).toBeNull();
    expect(within(sidebar).queryByText('Dostęp')).toBeNull();
    expect(within(sidebar).queryByText('Wiedza')).toBeNull();
    expect(within(sidebar).queryByText('System')).toBeNull();
    expect(within(sidebar).getByRole('link', { name: 'Administracja' })).toHaveAttribute(
      'href',
      '#/admin'
    );
    expect(within(sidebar).queryByRole('link', { name: 'Użycie' })).toBeNull();
    expect(within(sidebar).queryByRole('link', { name: 'Użytkownicy' })).toBeNull();
    expect(within(sidebar).queryByRole('link', { name: 'Oczekujące prośby' })).toBeNull();
    expect(within(sidebar).queryByRole('link', { name: 'Baza Wiedzy' })).toBeNull();
    expect(within(sidebar).queryByRole('link', { name: 'Luki w wiedzy' })).toBeNull();

    expect(within(sidebar).getByRole('button', { name: 'River Walker Level 3' })).not.toBeNull();
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Ustawienia konta' }));

    const accountMenu = await within(sidebar).findByRole('menu', { name: 'Ustawienia konta' });
    expect(
      within(accountMenu).getByRole('menuitem', { name: 'River Walker Level 3' })
    ).not.toBeNull();
    expect(within(accountMenu).getByRole('menuitem', { name: 'Język' })).not.toBeNull();
    expect(within(accountMenu).getByRole('menuitem', { name: 'Wyloguj' })).not.toBeNull();
    expect(within(accountMenu).queryByText('angler@example.com')).toBeNull();
    expect(within(accountMenu).queryByText('Add account')).toBeNull();

    fireEvent.click(within(accountMenu).getByRole('menuitem', { name: 'Język' }));

    const languageMenu = await within(sidebar).findByRole('menu', { name: 'Język' });
    expect(within(languageMenu).getByRole('menuitemradio', { name: 'PL Polski' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(within(languageMenu).getByRole('menuitemradio', { name: 'EN English' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    expect(within(languageMenu).queryByText('PB')).toBeNull();
  });

  it('collapses the desktop workspace sidebar into an icon rail without floating content controls', async () => {
    await renderWorkspaceApp('admin');

    const shell = document.querySelector('.workspace-shell');
    if (!(shell instanceof HTMLElement)) {
      throw new Error('Expected the workspace shell to render.');
    }

    fireEvent.click(await screen.findByRole('button', { name: 'Ustawienia konta' }));
    const accountMenu = await screen.findByRole('menu', { name: 'Ustawienia konta' });
    fireEvent.click(within(accountMenu).getByRole('menuitem', { name: 'Język' }));
    expect(await screen.findByRole('menu', { name: 'Język' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Zwiń panel boczny' }));

    expect(shell).toHaveClass('workspace-shell-collapsed');
    expect(document.querySelector('.workspace-sidebar-rail')).not.toBeNull();
    expect(document.querySelector('.workspace-floating-collapse')).toBeNull();
    expect(screen.queryByRole('menu', { name: 'Ustawienia konta' })).toBeNull();
    expect(screen.queryByRole('menu', { name: 'Język' })).toBeNull();
  });

  it('renders a centered empty chat start state instead of the framed conversation panel', async () => {
    await renderWorkspaceApp();

    expect(await screen.findByRole('heading', { name: 'O co chcesz zapytać?' })).not.toBeNull();
    expect(screen.getByPlaceholderText('Zapytaj o łowisko, metodę albo sprzęt')).not.toBeNull();
    expect(screen.getByLabelText('Kluczowe tematy')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Zapytaj o warunki' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Dobierz kolejny krok' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Zapytaj o zmiane planu' })).not.toBeNull();
    expect(document.querySelector('.workspace-empty-start')).not.toBeNull();
    expect(document.querySelector('.workspace-empty-start .chat-composer-shell')).not.toBeNull();
    expect(document.querySelector('.chat-panel.fa-surface')).toBeNull();
  });

  it('uses a mobile hamburger drawer with inline language selection', async () => {
    mockMatchMedia(true);

    await renderWorkspaceApp('admin');

    expect(await screen.findByRole('button', { name: 'Otwórz nawigację' })).not.toBeNull();
    expect(screen.getByRole('banner')).toHaveTextContent('Asystent wędkarski');
    expect(screen.queryByRole('heading', { level: 1, name: 'Czat' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Otwórz nawigację' }));

    const drawer = await screen.findByRole('dialog', { name: 'Główna nawigacja' });
    expect(within(drawer).getByRole('button', { name: 'Zamknij nawigację' })).not.toBeNull();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Ustawienia konta' }));
    fireEvent.click(within(drawer).getByRole('menuitem', { name: 'Język' }));

    const languageMenu = within(drawer).getByRole('menu', { name: 'Język' });
    expect(within(languageMenu).getByRole('menuitemradio', { name: 'PL Polski' })).not.toBeNull();
    expect(within(languageMenu).getByRole('menuitemradio', { name: 'EN English' })).not.toBeNull();
  });

  it('normalizes an empty workspace hash to the chat route', async () => {
    await renderWorkspaceApp();

    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat');
    });
    expect(await screen.findByRole('heading', { name: 'O co chcesz zapytać?' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Zapytaj o zmiane planu' })).not.toBeNull();
    expect(screen.getByLabelText('Kluczowe tematy')).not.toBeNull();
    expect(screen.queryByText(appMessages.pl.chat.answerLanguageHint)).toBeNull();
    expect(screen.queryByText('Gotowe')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Użycie' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Baza Wiedzy' })).toBeNull();
  });

  it('redirects regular users away from the retired usage route without loading usage data', async () => {
    window.history.replaceState(null, '', '/#/usage');

    await renderWorkspaceApp();

    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat');
    });
    expect(await screen.findByRole('heading', { name: 'O co chcesz zapytać?' })).not.toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Użycie' })).toBeNull();
    expect(document.title).toBe('Czat - Fishing Assistant');
  });

  it('keeps language and logout inside the compact account menu for normal users', async () => {
    await renderWorkspaceApp();

    expect(await screen.findByRole('navigation', { name: 'Główna nawigacja' })).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'Użycie' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Wyloguj' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Zmień język' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ustawienia konta' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Język' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'EN English' }));

    expect(window.localStorage.getItem('fa.locale')).toBe('en');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'PL Polski' }));
    expect(window.localStorage.getItem('fa.locale')).toBe('pl');
    expect(screen.getByRole('menuitem', { name: 'Wyloguj' })).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'Oczekujące prośby' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Użytkownicy' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Baza Wiedzy' })).toBeNull();
  });

  it('keeps the language selector in the account menu on desktop and mobile', async () => {
    const styles = readFileSync(join(process.cwd(), 'apps/web/src/styles.css'), 'utf8');

    expect(styles).toMatch(/\.workspace-language-option\.active\s*{[^}]*background:\s*#eef3f8/s);
    expect(styles).toMatch(
      /@media \(max-width: 980px\)\s*{[\s\S]*\.workspace-language-menu\s*{[^}]*position:\s*static/s
    );

    await renderWorkspaceApp();

    expect(document.querySelector('.fa-language-switch')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ustawienia konta' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Język' }));
    expect(screen.getByRole('menuitemradio', { name: 'PL Polski' })).not.toBeNull();

    cleanup();
    mockMatchMedia(true);

    await renderWorkspaceApp();

    fireEvent.click(screen.getByRole('button', { name: 'Otwórz nawigację' }));
    const drawer = screen.getByRole('dialog', { name: 'Główna nawigacja' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Ustawienia konta' }));
    fireEvent.click(within(drawer).getByRole('menuitem', { name: 'Język' }));
    expect(within(drawer).getByRole('menuitemradio', { name: 'PL Polski' })).not.toBeNull();
  });

  it('does not expose the usage menu item to regular users', async () => {
    await renderWorkspaceApp();

    expect(await screen.findByRole('navigation', { name: 'Główna nawigacja' })).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'Użycie' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ustawienia konta' })).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'Użytkownicy' })).toBeNull();
  });

  it('labels conversation deletes for screen readers in Polish and English', async () => {
    mocks.listConversations.mockResolvedValue([conversation]);

    await renderWorkspaceApp();

    const polishDeleteButton = await screen.findByRole('button', {
      name: 'Usuń rozmowę: River rigs',
    });
    expect(polishDeleteButton.querySelector('svg.lucide-trash2')).not.toBeNull();

    cleanup();
    window.localStorage.setItem('fa.locale', 'en');
    mocks.listConversations.mockResolvedValue([conversation]);

    await renderWorkspaceApp();

    const englishDeleteButton = await screen.findByRole('button', {
      name: 'Delete conversation: River rigs',
    });
    expect(englishDeleteButton.querySelector('svg.lucide-trash2')).not.toBeNull();
  });

  it('distinguishes the new-chat command from untitled and failed history rows', async () => {
    const emptyConversation: Conversation = {
      ...conversation,
      id: 'empty-conversation',
      title: 'New Chat',
      lastMessagePreview: '',
      messageCount: 0,
    };
    const failedConversation: Conversation = {
      ...conversation,
      id: 'failed-conversation',
      title: 'Jak łowić na mule przy wietrze?',
      lastMessagePreview: 'I could not complete this answer. Please try again.',
      lastMessageRole: 'assistant',
      lastAssistantStreamStatus: 'failed',
      messageCount: 2,
    };
    mocks.listConversations.mockResolvedValue([failedConversation, emptyConversation]);

    await renderWorkspaceApp();

    expect(await screen.findByRole('button', { name: 'Nowy chat' })).not.toBeNull();
    expect(screen.getByText('Bez tytułu')).not.toBeNull();
    expect(screen.queryByText('Jeszcze bez pytania')).toBeNull();
    expect(screen.queryByText('Do ponowienia')).toBeNull();
    expect(screen.queryByText('Odpowiedź nie została ukończona')).toBeNull();
  });

  it('navigates admin chat into the administration shell and keeps the menu model stable', async () => {
    await renderWorkspaceApp('admin');

    expect(await screen.findByRole('navigation', { name: 'Główna nawigacja' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Administracja' })).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'Użycie' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Oczekujące prośby' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Użytkownicy' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Baza Wiedzy' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ustawienia konta' })).not.toBeNull();

    fireEvent.click(screen.getByRole('link', { name: 'Administracja' }));

    await waitFor(() => {
      expect(window.location.hash).toBe('#/admin');
    });

    cleanup();
    await renderAdminShell();

    expect(await screen.findByRole('link', { name: 'Czat' })).not.toBeNull();
    await waitFor(() => {
      expect(window.location.hash).toBe('#/admin/pending');
    });
    expect(screen.getByRole('link', { name: 'Koszty AI' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Oczekujące prośby 3' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Użytkownicy' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Baza Wiedzy' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Wyloguj' })).toBeNull();
  });

  it('logs out from the shell action', async () => {
    await renderWorkspaceApp();

    fireEvent.click(await screen.findByRole('button', { name: 'Ustawienia konta' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Wyloguj' }));

    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });

  it('fills the composer from a starter chip without auto-sending', async () => {
    const setComposer = vi.fn();
    const handleSendMessage = vi.fn(() => Promise.resolve());
    mocks.useChatWorkflow.mockReturnValue(chatWorkflow({ setComposer, handleSendMessage }));

    await renderWorkspaceApp();

    fireEvent.click(await screen.findByRole('button', { name: 'Dobierz kolejny krok' }));

    expect(setComposer).toHaveBeenCalledWith('Dobierz kolejny krok');
    expect(handleSendMessage).not.toHaveBeenCalled();
  });

  it('imports a selected homepage prompt from the chat route without auto-sending', async () => {
    const setComposer = vi.fn();
    const handleSendMessage = vi.fn(() => Promise.resolve());
    window.history.replaceState(
      null,
      '',
      '/#/chat?prompt=Przyk%C5%82adowe%20pytanie%20do%20asystenta'
    );
    mocks.useChatWorkflow.mockReturnValue(chatWorkflow({ setComposer, handleSendMessage }));

    await renderWorkspaceApp();

    await waitFor(() => {
      expect(setComposer).toHaveBeenCalledWith('Przykładowe pytanie do asystenta');
    });
    expect(window.location.hash).toBe('#/chat');
    expect(handleSendMessage).not.toHaveBeenCalled();
  });

  it('does not replace an existing composer draft when a starter chip is tapped', async () => {
    const setComposer = vi.fn();
    const handleSendMessage = vi.fn(() => Promise.resolve());
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        composer: 'Mój własny szkic pytania QA',
        setComposer,
        handleSendMessage,
      })
    );

    await renderWorkspaceApp();

    fireEvent.click(await screen.findByRole('button', { name: 'Zapytaj o warunki' }));

    expect(setComposer).not.toHaveBeenCalled();
    expect(handleSendMessage).not.toHaveBeenCalled();
  });

  it('keeps the empty-chat composer centered instead of reserving bottom composer space', () => {
    const styles = readFileSync(join(process.cwd(), 'apps/web/src/styles.css'), 'utf8');

    expect(styles).toMatch(
      /\.workspace-empty-start \.chat-composer-shell\s*{[^}]*position:\s*static[^}]*background:\s*transparent/s
    );
    expect(styles).toMatch(
      /@media \(max-width: 640px\)\s*{[\s\S]*\.workspace-empty-start \.fa-prompt-bar textarea\s*{[^}]*min-height:\s*42px/s
    );
  });

  it('keeps mobile drawer and starter controls compact but tappable', () => {
    const styles = readFileSync(join(process.cwd(), 'apps/web/src/styles.css'), 'utf8');

    expect(/\.workspace-new-chat\s*{[^}]*min-height:\s*44px/s.test(styles)).toBe(true);
    expect(/\.workspace-nav-item\s*{[^}]*min-height:\s*40px/s.test(styles)).toBe(true);
    expect(/\.workspace-account-profile\s*{[^}]*min-height:\s*48px/s.test(styles)).toBe(true);
    expect(
      /\.workspace-empty-start \.fa-suggestion-tile\s*{[^}]*min-height:\s*42px/s.test(styles)
    ).toBe(true);
    expect(/\.fa-detail-sheet-header button\s*{[^}]*min-height:\s*44px/s.test(styles)).toBe(true);
  });

  it('keeps composer text optically centered in the single-line prompt bar', () => {
    const styles = readFileSync(join(process.cwd(), 'apps/web/src/styles.css'), 'utf8');

    expect(/\.fa-prompt-bar textarea\s*{[^}]*box-sizing:\s*border-box/s.test(styles)).toBe(true);
    expect(/\.fa-prompt-bar textarea\s*{[^}]*min-height:\s*42px/s.test(styles)).toBe(true);
    expect(/\.fa-prompt-bar textarea\s*{[^}]*padding-block:\s*9px/s.test(styles)).toBe(true);
    expect(/\.fa-prompt-bar textarea\s*{[^}]*line-height:\s*24px/s.test(styles)).toBe(true);
    expect(
      /@media \(max-width: 640px\)\s*{[\s\S]*\.fa-prompt-bar textarea\s*{[^}]*min-height:\s*42px[^}]*padding:\s*9px 8px/s.test(
        styles
      )
    ).toBe(true);
    expect(
      /\.fa-prompt-bar textarea:focus::placeholder\s*{[^}]*color:\s*transparent/s.test(styles)
    ).toBe(true);
  });

  it('keeps assistant markdown headings compact on mobile', () => {
    const styles = readFileSync(join(process.cwd(), 'apps/web/src/styles.css'), 'utf8');

    expect(
      /@media \(max-width: 640px\)\s*{[\s\S]*\.message-bubble\.assistant \.markdown-body h2\s*{[^}]*font-size:\s*1\.45rem[^}]*line-height:\s*1\.18/s.test(
        styles
      )
    ).toBe(true);
  });

  it('keeps the mobile shell fixed while each view owns its own scroll area', () => {
    const styles = readFileSync(join(process.cwd(), 'apps/web/src/styles.css'), 'utf8');

    expect(
      /\.workspace-sidebar\s*{[^}]*position:\s*sticky[^}]*height:\s*100svh/s.test(styles)
    ).toBe(true);
    expect(
      /\.chat-view\s*{[^}]*height:\s*100%[^}]*min-height:\s*0[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/s.test(
        styles
      )
    ).toBe(true);
    expect(/\.chat-panel\s*{[^}]*height:\s*100%[^}]*overflow:\s*hidden/s.test(styles)).toBe(true);
    expect(/\.message-thread\s*{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s.test(styles)).toBe(
      true
    );
    expect(
      /@media \(max-width: 980px\)\s*{[\s\S]*\.workspace-shell,\s*\.workspace-shell-collapsed\s*{[^}]*height:\s*100dvh[^}]*min-height:\s*100svh[^}]*overflow:\s*hidden/s.test(
        styles
      )
    ).toBe(true);
    expect(
      /@media \(max-width: 980px\)\s*{[\s\S]*\.workspace-main\s*{[^}]*display:\s*grid[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)[^}]*overflow:\s*hidden/s.test(
        styles
      )
    ).toBe(true);
    expect(
      /@media \(max-width: 980px\)\s*{[\s\S]*\.workspace-main \.admin-content-shell\s*{[^}]*height:\s*100%[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s.test(
        styles
      )
    ).toBe(true);
    expect(
      /@media \(max-width: 980px\)\s*{[\s\S]*\.chat-view\s*{[^}]*height:\s*100%[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s.test(
        styles
      )
    ).toBe(true);
    expect(
      /@media \(max-width: 640px\)\s*{[\s\S]*\.chat-view\s*{[^}]*height:\s*100%[^}]*min-height:\s*0[^}]*padding:\s*0/s.test(
        styles
      )
    ).toBe(true);
    expect(styles).not.toContain('height: calc(100dvh - 64px)');
    expect(styles).not.toContain('min-height: calc(100svh - 64px)');
    expect(styles).not.toContain('height: calc(100dvh - 68px)');
    expect(styles).not.toContain('min-height: calc(100svh - 68px)');
  });

  it('keeps the routed knowledge source page scrollable outside the chat panel layout', () => {
    const styles = readFileSync(join(process.cwd(), 'apps/web/src/styles.css'), 'utf8');

    expect(
      /\.source-route-view\s*{[^}]*display:\s*block[^}]*overflow-y:\s*auto/s.test(styles)
    ).toBe(true);
  });

  it('reveals conversation delete actions on desktop hover and focus while keeping them visible for touch layouts', () => {
    const styles = readFileSync(join(process.cwd(), 'apps/web/src/styles.css'), 'utf8');

    expect(/\.workspace-conversation-delete\s*{[^}]*opacity:\s*0(?:\D|$)/s.test(styles)).toBe(true);
    expect(
      styles.includes('.workspace-conversation-row:hover .workspace-conversation-delete')
    ).toBe(true);
    expect(
      styles.includes('.workspace-conversation-row:focus-within .workspace-conversation-delete')
    ).toBe(true);
    expect(
      /@media \(hover: none\), \(pointer: coarse\)[\s\S]*\.workspace-conversation-delete\s*{[^}]*opacity:\s*1/s.test(
        styles
      )
    ).toBe(true);
  });

  it('does not show starter prompts while an existing conversation route is loading messages', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        messages: [],
        messagesStatus: 'loading',
        hasStreamPreview: false,
        streaming: false,
      })
    );

    await renderWorkspaceApp();

    expect(await screen.findByRole('link', { name: /River rigs/ })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'O co chcesz zapytać?' })).toBeNull();
    expect(screen.getByRole('status', { name: 'Ładowanie rozmowy' })).not.toBeNull();
  });

  it('keeps optimistic thread content visible while the routed conversation is still loading', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        messages: [
          {
            id: 'optimistic-user-1',
            userId: 'user-preview',
            conversationId: 'c1',
            role: 'user',
            content: 'Wyslij przykladowa wiadomosc',
            createdAt: '2026-06-19T15:00:00.000Z',
            citations: [],
            missingInformation: [],
          },
        ],
        messagesStatus: 'loading',
        streaming: true,
        hasStreamPreview: true,
        streamPreviewMessage: {
          ...streamPreviewMessage,
          conversationId: 'c1',
          content: '',
        },
      })
    );

    await renderWorkspaceApp();

    const thread = document.querySelector('.message-thread');
    if (!(thread instanceof HTMLElement)) {
      throw new Error('Expected the message thread to render.');
    }

    expect(await screen.findByRole('link', { name: /River rigs/ })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'O co chcesz zapytać?' })).toBeNull();
    expect(screen.queryByRole('status', { name: 'Ładowanie rozmowy' })).toBeNull();
    expect(within(thread).getByText('Wyslij przykladowa wiadomosc')).not.toBeNull();
    expect(screen.getByRole('status', { name: 'Szukam w Bazie Wiedzy...' })).not.toBeNull();
  });

  it('keeps the first starter-prompt send in the message thread immediately', async () => {
    const handleSendMessage = vi.fn(() => Promise.resolve());
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        composer: 'Wyslij przykladowa wiadomosc',
        messages: [
          {
            id: 'optimistic-user-1',
            userId: 'user-preview',
            conversationId: 'pending',
            role: 'user',
            content: 'Wyslij przykladowa wiadomosc',
            createdAt: '2026-06-19T15:00:00.000Z',
            citations: [],
            missingInformation: [],
          },
        ],
        messagesStatus: 'ready',
        streaming: true,
        hasStreamPreview: true,
        streamPreviewMessage: {
          ...streamPreviewMessage,
          content: '',
        },
        handleSendMessage,
      })
    );

    await renderWorkspaceApp();

    const thread = document.querySelector('.message-thread');
    if (!(thread instanceof HTMLElement)) {
      throw new Error('Expected the message thread to render.');
    }

    expect(screen.queryByRole('heading', { name: 'O co chcesz zapytać?' })).toBeNull();
    expect(within(thread).getByText('Wyslij przykladowa wiadomosc')).not.toBeNull();
    expect(screen.getByRole('status', { name: 'Szukam w Bazie Wiedzy...' })).not.toBeNull();
  });

  it('renders a route-load error state instead of stale messages for a failed conversation load', async () => {
    window.history.replaceState(null, '', '/#/chat/c2');
    window.localStorage.setItem('fa.locale', 'en');
    mocks.listConversations.mockResolvedValue([laterConversation, conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        messages: [
          {
            id: 'stale-message-1',
            userId: 'user-1',
            conversationId: 'c1',
            role: 'assistant',
            content: 'Old river advice that should stay hidden.',
            createdAt: '2026-06-14T09:06:00.000Z',
            citations: [],
            missingInformation: [],
          },
        ],
        messagesStatus: 'error',
        messagesError: null,
        hasStreamPreview: false,
        streaming: false,
      })
    );

    await renderWorkspaceApp();

    expect(await screen.findByRole('link', { name: /Canal tench/ })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'O co chcesz zapytać?' })).toBeNull();
    expect(
      screen.getByRole('alert', { name: appMessages.en.chat.conversationLoadFailed })
    ).not.toBeNull();
    expect(screen.getByText(appMessages.en.chat.conversationRefreshHint)).not.toBeNull();
    expect(screen.queryByText('Old river advice that should stay hidden.')).toBeNull();
    expect(screen.queryByText(appMessages.en.chat.answerLanguageHint)).toBeNull();
  });

  it('localizes missing conversation links and offers chat recovery actions', async () => {
    window.history.replaceState(null, '', '/#/chat/00000000-0000-4000-8000-000000000000');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        messagesStatus: 'error',
        messagesError: 'Conversation 00000000-0000-4000-8000-000000000000 not found',
        hasStreamPreview: false,
        streaming: false,
      })
    );

    await renderWorkspaceApp();

    expect(await screen.findByRole('link', { name: /River rigs/ })).not.toBeNull();
    const alert = screen.getByRole('alert', { name: appMessages.pl.chat.conversationLoadFailed });
    expect(within(alert).getByText(appMessages.pl.chat.conversationUnavailable)).not.toBeNull();
    expect(within(alert).getByText(appMessages.pl.chat.conversationRecoveryHint)).not.toBeNull();
    expect(within(alert).getByRole('button', { name: 'Nowy chat' })).not.toBeNull();
    expect(screen.queryByText(/00000000-0000-4000-8000-000000000000/)).toBeNull();
  });

  it('renders the empty conversation panel from locale copy', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        messages: [],
        messagesStatus: 'ready',
        hasStreamPreview: false,
        streaming: false,
      })
    );

    await renderWorkspaceApp();

    expect(await screen.findByRole('link', { name: /River rigs/ })).not.toBeNull();
    expect(
      screen.getByRole('status', { name: appMessages.pl.chat.conversationEmptyTitle })
    ).not.toBeNull();
    expect(screen.getByText(appMessages.pl.chat.conversationEmptyBody)).not.toBeNull();
  });

  it('renders streaming chat preview and stream errors', async () => {
    const cancelStream = vi.fn();

    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        streaming: true,
        streamDraft: 'Draft answer',
        streamPhase: 'writing',
        streamMissing: ['No evidence about hook bait.'],
        streamError: 'Provider paused.',
        hasStreamPreview: true,
        streamPreviewMessage,
        cancelStream,
      })
    );

    await renderWorkspaceApp();

    expect(await screen.findByRole('link', { name: /River rigs/ })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Nowy chat' })).not.toBeNull();
    expect(screen.getByText('Szkic odpowiedzi')).not.toBeNull();
    expect(screen.queryByRole('status', { name: 'Układam odpowiedź...' })).toBeNull();
    expect(screen.getByText('Draft answer')).not.toBeNull();
    expect(screen.getByText('No evidence about hook bait.')).not.toBeNull();
    expect(screen.getByText('Provider paused.')).not.toBeNull();
    expect(screen.queryByText('Źródło 1')).toBeNull();
    expect(screen.queryByText('Źródło 2')).toBeNull();
    expect(screen.queryByText('Źródło 3')).toBeNull();
    expect(screen.queryByText('Use a light feeder mix.')).toBeNull();
    expect(
      screen.queryByText('Manual-source evidence should render without a fabricated link.')
    ).toBeNull();
    expect(screen.queryByText('External source link.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż 1 dodatkowe źródła' }));
    expect(screen.queryByText('Źródło 4')).toBeNull();
    expect(screen.queryByText('Unsafe source link.')).toBeNull();
    expect(screen.queryByText('Otwórz źródło')).toBeNull();
    expect(screen.queryByRole('link', { name: /Open source:/ })).toBeNull();
    expect(screen.getByText('Preview evidence')).not.toBeNull();
    expect(screen.getByText('Manual-source evidence')).not.toBeNull();
    expect(screen.getByText('External evidence')).not.toBeNull();
    expect(screen.getByText('Unsafe URL evidence')).not.toBeNull();
    expect(screen.queryByText('preview citation')).toBeNull();
    expect(document.body.textContent).not.toContain('https://example.com/fishing/source');
    expect(document.body.textContent).not.toContain('javascript:alert(1)');
    expect(screen.queryByText(/\bS\d+\b/)).toBeNull();
    const composer = screen.getByLabelText('Pytanie');
    if (!(composer instanceof HTMLTextAreaElement)) {
      throw new Error('Expected the composer to be a textarea.');
    }
    expect(composer.disabled).toBe(false);
    const promptBar = composer.closest('.fa-prompt-bar');
    if (!(promptBar instanceof HTMLElement)) {
      throw new Error('Expected the composer to render inside the prompt bar.');
    }
    const stopButton = within(promptBar).getByRole('button', { name: 'Przerwij' });
    expect(stopButton).toBeEnabled();
    fireEvent.click(stopButton);
    expect(cancelStream).toHaveBeenCalledTimes(1);
  });

  it('turns the streaming composer action into queue send when follow-up text is typed', async () => {
    const handleSendMessage = vi.fn(() => Promise.resolve());

    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        composer: 'Dopytaj o haczyk',
        streaming: true,
        streamDraft: 'Draft answer',
        streamPhase: 'writing',
        hasStreamPreview: true,
        streamPreviewMessage,
        handleSendMessage,
      })
    );

    await renderWorkspaceApp();

    const composer = screen.getByLabelText('Pytanie');
    expect(composer).toHaveAttribute('placeholder', 'Dopytaj o szczegóły');
    expect(composer).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Wyślij po odpowiedzi' })).toBeEnabled();

    fireEvent.submit(composer.closest('form') ?? composer);

    expect(handleSendMessage).toHaveBeenCalledTimes(1);
  });

  it('shows the queued follow-up state after one follow-up is queued', async () => {
    const editQueuedFollowUp = vi.fn();
    const clearQueuedFollowUp = vi.fn();

    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        streaming: true,
        streamDraft: 'Draft answer',
        streamPhase: 'writing',
        hasStreamPreview: true,
        streamPreviewMessage,
        queuedFollowUp: 'Dopytaj o haczyk',
        editQueuedFollowUp,
        clearQueuedFollowUp,
      })
    );

    await renderWorkspaceApp();

    const composer = screen.getByLabelText('Pytanie');
    expect(composer).toBeDisabled();
    expect(composer).toHaveAttribute('placeholder', 'Pytanie czeka w kolejce');
    expect(
      screen.queryByText('Wyślę po tej odpowiedzi: „Dopytaj o haczyk”')
    ).not.toBeInTheDocument();

    const queuedStatus = screen.getByRole('status', {
      name: 'Pytanie czeka w kolejce: Dopytaj o haczyk',
    });
    expect(within(queuedStatus).getByText('Dopytaj o haczyk')).toBeVisible();

    const editButton = within(queuedStatus).getByRole('button', {
      name: 'Edytuj zakolejkowane pytanie',
    });
    const removeButton = within(queuedStatus).getByRole('button', {
      name: 'Usuń zakolejkowane pytanie',
    });
    expect(editButton).toBeEnabled();
    expect(removeButton).toBeEnabled();
    expect(editButton.textContent).toBe('');
    expect(removeButton.textContent).toBe('');

    fireEvent.click(editButton);
    expect(editQueuedFollowUp).toHaveBeenCalledTimes(1);
    fireEvent.click(removeButton);
    expect(clearQueuedFollowUp).toHaveBeenCalledTimes(1);
  });

  it('hides raw gateway failures from the chat thread', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        messages: [
          {
            ...persistedAssistantMessage,
            id: 'user-message',
            role: 'user',
            content: 'Krotko: co to jest synthetic fixture?',
          },
        ],
        streamError: 'API request failed with status 502.',
      })
    );

    await renderWorkspaceApp();

    expect(
      await screen.findByText('Nie udało się wygenerować odpowiedzi. Spróbuj ponownie.')
    ).not.toBeNull();
    expect(screen.queryByText('API request failed with status 502.')).toBeNull();
  });

  it('escalates the streaming status when an answer is taking longer than usual', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        streaming: true,
        streamDraft: 'Draft answer',
        streamPhase: 'writing',
        streamLongRunning: true,
        hasStreamPreview: true,
        streamPreviewMessage,
      })
    );

    await renderWorkspaceApp();

    await screen.findByText('Draft answer');
    expect(screen.queryByRole('status', { name: 'Jeszcze przygotowuję odpowiedź...' })).toBeNull();
    expect(screen.getByPlaceholderText('Dopytaj o szczegóły')).not.toBeNull();
  });

  it('escalates an in-flight stream after the local UI threshold even before the hook reports it', async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, '', '/#/chat/c1');
      mocks.listConversations.mockResolvedValue([conversation]);
      mocks.useChatWorkflow.mockReturnValue(
        chatWorkflow({
          streaming: true,
          streamDraft: 'Draft answer',
          streamPhase: 'writing',
          streamLongRunning: false,
          hasStreamPreview: true,
          streamPreviewMessage,
        })
      );

      await renderWorkspaceApp();

      expect(screen.getByText('Szkic odpowiedzi')).not.toBeNull();
      expect(screen.queryByRole('status', { name: 'Układam odpowiedź...' })).toBeNull();

      act(() => {
        vi.advanceTimersByTime(15_000);
      });

      expect(
        screen.queryByRole('status', { name: 'Jeszcze przygotowuję odpowiedź...' })
      ).toBeNull();
      expect(screen.getByPlaceholderText('Dopytaj o szczegóły')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps progress visible when an in-flight stream has no draft preview yet', async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, '', '/#/chat/c1');
      mocks.listConversations.mockResolvedValue([conversation]);
      mocks.useChatWorkflow.mockReturnValue(
        chatWorkflow({
          messages: [
            {
              id: 'u-persisted',
              userId: 'user-1',
              conversationId: 'c1',
              role: 'user',
              content: 'Rozpisz to jeszcze bardziej szczegolowo.',
              createdAt: '2026-06-22T11:52:00.000Z',
              citations: [],
              missingInformation: [],
            },
          ],
          streaming: true,
          streamPhase: 'writing',
          streamLongRunning: false,
          hasStreamPreview: false,
          streamPreviewMessage: {
            ...streamPreviewMessage,
            conversationId: 'c1',
            content: '',
            citations: [],
            missingInformation: [],
          },
        })
      );

      await renderWorkspaceApp();

      expect(screen.getByText('Szkic odpowiedzi')).not.toBeNull();
      expect(screen.getByRole('status', { name: 'Układam odpowiedź...' })).not.toBeNull();
      expect(screen.getAllByText('Układam odpowiedź...')).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(15_000);
      });

      expect(
        screen.getByRole('status', { name: 'Jeszcze przygotowuję odpowiedź...' })
      ).not.toBeNull();
      expect(screen.getByPlaceholderText('Dopytaj o szczegóły')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('localizes failed assistant fallback copy in the Polish chat UI', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        messages: [
          {
            ...persistedAssistantMessage,
            id: 'failed-assistant',
            content: 'I could not complete this answer. Please try again.',
            streamStatus: 'failed',
            errorMessage: 'Answer generation failed. Please try again.',
          },
        ],
        streamError: 'Answer generation failed. Please try again.',
      })
    );

    await renderWorkspaceApp();

    expect(
      await screen.findAllByText('Nie udało mi się dokończyć tej odpowiedzi. Spróbuj ponownie.')
    ).toHaveLength(1);
    expect(
      screen.getAllByText('Nie udało się wygenerować odpowiedzi. Spróbuj ponownie.').length
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('I could not complete this answer. Please try again.')).toBeNull();
    expect(screen.queryByText('Answer generation failed. Please try again.')).toBeNull();
  });

  it('marks failed partial assistant drafts as incomplete in the Polish chat UI', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        messages: [
          {
            ...persistedAssistantMessage,
            id: 'partial-failed-assistant',
            content: 'Use a light feeder mix while the water is cold.',
            streamStatus: 'failed',
            errorMessage: 'Chat stream timed out',
          },
        ],
      })
    );

    await renderWorkspaceApp();

    expect(
      await screen.findByText('Use a light feeder mix while the water is cold.')
    ).not.toBeNull();
    expect(
      screen.getByText(
        'Nie udało mi się w pełni potwierdzić tej odpowiedzi w źródłach. Potraktuj ją jako wskazówkę albo doprecyzuj pytanie.'
      )
    ).not.toBeNull();
    expect(screen.queryByText('Generowanie odpowiedzi trwało zbyt długo.')).toBeNull();
    expect(screen.queryByText('Chat stream timed out')).toBeNull();
  });

  it('keeps conversation history in the mobile drawer instead of a separate sheet trigger', async () => {
    mockMatchMedia(true);
    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(chatWorkflow({ messages: [persistedAssistantMessage] }));

    await renderWorkspaceApp();

    expect(screen.queryByRole('button', { name: 'Rozmowy' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Otwórz nawigację' }));
    const drawer = screen.getByRole('dialog', { name: 'Główna nawigacja' });
    expect(within(drawer).getByRole('link', { name: /River rigs/ })).not.toBeNull();
    expect(screen.getByLabelText('Pytanie')).not.toBeNull();
  });

  it('opens conversation history in the mobile drawer without leaving the drawer bounds', async () => {
    mockMatchMedia(true);
    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation, laterConversation]);

    await renderWorkspaceApp();

    fireEvent.click(await screen.findByRole('button', { name: 'Otwórz nawigację' }));

    const dialog = screen.getByRole('dialog', { name: 'Główna nawigacja' });
    expect(within(dialog).getByRole('link', { name: /River rigs/ })).not.toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Nowy chat' })).not.toBeNull();
  });

  it('localizes chat history fallback titles without rendering failure previews', async () => {
    mocks.listConversations.mockResolvedValue([
      {
        ...conversation,
        id: 'failed-empty',
        title: 'New Chat',
        lastMessagePreview: 'I could not complete this answer. Please try again.',
        lastMessageRole: 'assistant',
        lastAssistantStreamStatus: 'failed',
      },
    ]);

    await renderWorkspaceApp();

    expect(await screen.findByRole('link', { name: 'Nowy chat' })).not.toBeNull();
    expect(screen.queryByText('Odpowiedź nie została ukończona')).toBeNull();
    expect(screen.queryByText('Do ponowienia')).toBeNull();
    expect(screen.getByRole('button', { name: 'Usuń rozmowę: Nowy chat' })).not.toBeNull();
    expect(screen.queryByText('New Chat')).toBeNull();
    expect(screen.queryByText('I could not complete this answer. Please try again.')).toBeNull();
  });

  it('keeps New chat local until the chat workflow sends the first message', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    const createdFromWorkflow = {
      ...conversation,
      id: 'created-workflow',
      title: 'Workflow-created chat',
      lastMessageAt: '2026-06-14T11:05:00.000Z',
    };
    mocks.createConversation.mockResolvedValueOnce(createdFromWorkflow);

    await renderWorkspaceApp();

    fireEvent.click(await screen.findByRole('button', { name: 'Nowy chat' }));

    expect(mocks.createConversation).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat');
    });

    const workflowInput = mocks.useChatWorkflow.mock.calls.at(-1)?.[0] as
      | { ensureConversationId?: () => Promise<string> }
      | undefined;
    const ensureConversationId = workflowInput?.ensureConversationId;
    if (ensureConversationId === undefined) {
      throw new Error('Expected chat workflow input to include ensureConversationId.');
    }

    let ensuredConversationId = '';
    await act(async () => {
      ensuredConversationId = await ensureConversationId();
    });

    expect(ensuredConversationId).toBe('created-workflow');
    expect(window.location.hash).toBe('#/chat/created-workflow');
  });

  it('defers blank-chat workflow route change until the created id is returned', async () => {
    const createdFromWorkflow = {
      ...conversation,
      id: 'created-deferred-workflow',
      title: 'Deferred workflow chat',
    };
    mocks.createConversation.mockResolvedValueOnce(createdFromWorkflow);

    await renderWorkspaceApp();

    const workflowInput = mocks.useChatWorkflow.mock.calls[0]?.[0] as
      | { ensureConversationId?: () => Promise<string> }
      | undefined;
    const ensureConversationId = workflowInput?.ensureConversationId;
    if (ensureConversationId === undefined) {
      throw new Error('Expected chat workflow input to include ensureConversationId.');
    }

    let hashChangeCount = 0;
    const handleHashChange = (): void => {
      hashChangeCount += 1;
    };
    window.addEventListener('hashchange', handleHashChange);

    try {
      let ensuredConversationId = '';
      await act(async () => {
        ensuredConversationId = await ensureConversationId();
      });

      expect(ensuredConversationId).toBe('created-deferred-workflow');
      expect(window.location.hash).toBe('#/chat/created-deferred-workflow');
      expect(hashChangeCount).toBe(0);

      await waitFor(() => {
        expect(hashChangeCount).toBe(1);
      });
    } finally {
      window.removeEventListener('hashchange', handleHashChange);
    }
  });

  it('refreshes conversation titles after chat activity without rendering previews', async () => {
    const blankConversation = {
      ...conversation,
      title: 'Nowy chat',
      lastMessagePreview: '',
      lastMessageAt: '2026-06-14T09:00:00.000Z',
    };
    const titledConversation = {
      ...blankConversation,
      title: 'Where should I cast?',
      lastMessagePreview: 'Fish the **near shelf**. [S3] * Use feeder.',
      lastMessageAt: '2026-06-14T09:06:00.000Z',
    };
    mocks.listConversations
      .mockResolvedValueOnce([blankConversation])
      .mockResolvedValueOnce([titledConversation]);

    await renderWorkspaceApp();

    expect(await screen.findByRole('link', { name: /Nowy chat/ })).not.toBeNull();

    const workflowInput = mocks.useChatWorkflow.mock.calls[0]?.[0] as
      | { onConversationActivity?: (conversationId: string) => Promise<void> | void }
      | undefined;
    const onConversationActivity = workflowInput?.onConversationActivity;
    if (onConversationActivity === undefined) {
      throw new Error('Expected chat workflow input to include onConversationActivity.');
    }

    await act(async () => {
      await onConversationActivity('c1');
    });

    expect(await screen.findByRole('link', { name: /Where should I cast\\?/ })).not.toBeNull();
    expect(screen.queryByText('Fish the near shelf. Use feeder.')).toBeNull();
    expect(screen.queryByText(/\*\*/)).toBeNull();
    expect(screen.queryByText(/\* Use feeder/)).toBeNull();
    expect(screen.queryByText(/\[S3\]/)).toBeNull();
  });

  it('confirms before deleting the selected conversation and navigating to the next chat', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation, laterConversation]);
    mocks.deleteConversation.mockResolvedValue({ deleted: true });

    await renderWorkspaceApp();

    expect(await screen.findByRole('link', { name: /River rigs/ })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Usuń rozmowę: River rigs' }));

    expect(mocks.deleteConversation).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Usunąć rozmowę?' });
    expect(
      within(dialog).getByText(
        appMessages.pl.chat.conversationDeleteBody.replace('{title}', 'River rigs')
      )
    ).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń' }));

    await waitFor(() => {
      expect(mocks.deleteConversation).toHaveBeenCalledWith('c1');
      expect(screen.queryByRole('link', { name: /River rigs/ })).toBeNull();
      expect(window.location.hash).toBe('#/chat/c2');
    });
  });

  it('submits the composer through the chat workflow', async () => {
    const setComposer = vi.fn();
    const handleSendMessage = vi.fn(() => Promise.resolve());
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        composer: 'Where should I cast?',
        setComposer,
        handleSendMessage,
      })
    );

    await renderWorkspaceApp();

    const composer = screen.getByLabelText('Pytanie');
    fireEvent.change(composer, { target: { value: 'Fish the near shelf?' } });
    fireEvent.submit(composer.closest('form') ?? composer);

    expect(setComposer).toHaveBeenCalledWith('Fish the near shelf?');
    await waitFor(() => {
      expect(handleSendMessage).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
  ])('disables send while the composer is %s', async (_caseName, composer) => {
    mocks.useChatWorkflow.mockReturnValue(chatWorkflow({ composer }));

    await renderWorkspaceApp();

    expect(await screen.findByRole('button', { name: 'Wyślij wiadomość' })).toBeDisabled();
  });

  it('enables send when the composer has substantive text', async () => {
    mocks.useChatWorkflow.mockReturnValue(chatWorkflow({ composer: 'Where should I cast?' }));

    await renderWorkspaceApp();

    expect(await screen.findByRole('button', { name: 'Wyślij wiadomość' })).toBeEnabled();
  });

  it('renders persisted citations with safe links only', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        messages: [persistedAssistantMessage],
      })
    );

    await renderWorkspaceApp();

    expect(await screen.findByText('Hooklink notes')).not.toBeNull();
    expect(screen.queryByText('Źródło 1')).toBeNull();
    expect(screen.queryByText('Źródło 2')).toBeNull();
    expect(screen.queryByText('Źródło 3')).toBeNull();
    expect(screen.queryByText('Short hooklinks work well near weed.')).toBeNull();
    expect(screen.queryByText('Manual notes do not imply a link.')).toBeNull();
    expect(screen.queryByText('Unsafe URLs must not render.')).toBeNull();
    expect(screen.getByText('Hooklink notes')).not.toBeNull();
    expect(screen.queryByText('Category / Rigs / Hooklinks')).toBeNull();
    expect(screen.getByText('Manual rig note')).not.toBeNull();
    expect(screen.getByText('Unsafe note')).not.toBeNull();
    expect(screen.queryByText('Otwórz źródło')).toBeNull();
    expect(screen.queryByRole('link', { name: /Open source:/ })).toBeNull();
    expect(document.body.textContent).not.toContain('https://example.com/hooklink');
    expect(document.body.textContent).not.toContain('data:text/html,boom');
  });

  it('renders a full-page read-only knowledge source route', async () => {
    window.history.replaceState(null, '', '/#/chat/source/knowledge-page%3Asource-page-1');
    mocks.listConversations.mockResolvedValue([conversation]);

    await renderWorkspaceApp();

    expect(mocks.getKnowledgeSource).toHaveBeenCalledWith('knowledge-page:source-page-1');
    expect(
      await screen.findByRole('heading', { name: 'spring liquid additive quantity' })
    ).not.toBeNull();
    expect(screen.queryByRole('dialog', { name: 'spring liquid additive quantity' })).toBeNull();
    expect(screen.getByText('Zaktualizowano')).not.toBeNull();
    expect(screen.getByText('Przykladowa tresc zrodla testowego.')).not.toBeNull();
  });

  it('renders a clean method-feeder source tile without markdown noise or inline labels', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        messages: [
          {
            id: 'method-feeder-answer',
            userId: 'user-1',
            conversationId: 'c1',
            role: 'assistant',
            content: 'Synthetic fixture answer. [S3]\nUse a short example.',
            createdAt: '2026-06-14T09:06:00.000Z',
            citations: [
              {
                sourceId: 'knowledge-page:method-feeder\u0000method-feeder-evidence',
                usedFor: 'synthetic fixture',
              },
            ],
            missingInformation: [],
            retrieval: {
              query: 'What is synthetic fixture?',
              startedAt: '2026-06-14T09:05:00.000Z',
              completedAt: '2026-06-14T09:05:01.000Z',
              sources: [],
              evidence: [methodFeederEvidence],
            },
          },
        ],
      })
    );

    await renderWorkspaceApp();

    expect(screen.queryByText('Źródło 1')).toBeNull();
    expect(screen.queryByText(/!\[method1\.jpg\]/)).toBeNull();
    expect(
      await screen.findByText('Synthetic Fixture Source - Markdown Cleanup Case')
    ).not.toBeNull();
    expect(screen.queryByText(/What is synthetic fixture/)).toBeNull();
    expect(screen.queryByText(/Synthetic fixture contains placeholder quote text/)).toBeNull();
    expect(screen.getByRole('link', { name: /Synthetic Fixture Source/ })).toHaveAttribute(
      'href',
      '#/chat/source/knowledge-page%3Amethod-feeder'
    );
    expect(screen.queryByRole('link', { name: /Open source:/ })).toBeNull();
    expect(document.body.textContent).not.toContain('example.com/method1.jpg');
    expect(screen.queryByText(/\bS\d+\b/)).toBeNull();
  });

  it('preserves a legitimate source line that contains slash-separated content', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        messages: [
          {
            id: 'slash-content-answer',
            userId: 'user-1',
            conversationId: 'c1',
            role: 'assistant',
            content: 'Slash content answer.',
            createdAt: '2026-06-14T09:06:00.000Z',
            citations: [
              {
                sourceId: 'knowledge-page:slash-content\u0000slash-content-evidence',
                usedFor: 'slash content',
              },
            ],
            missingInformation: [],
            retrieval: {
              query: 'What line should be kept?',
              startedAt: '2026-06-14T09:05:00.000Z',
              completedAt: '2026-06-14T09:05:01.000Z',
              sources: [],
              evidence: [
                {
                  id: 'slash-content-evidence',
                  sourceId: 'knowledge-page:slash-content',
                  sourceType: 'knowledge_page',
                  title: 'Slash content evidence',
                  quote:
                    'Use the 1 / 4 oz feeder when the swim is shallow.\n\nFollow with a short cast and slow retrieve.',
                  score: 0.91,
                  metadata: {},
                },
              ],
            },
          },
        ],
      })
    );

    await renderWorkspaceApp();

    expect(screen.queryByText(/Use the 1 \/ 4 oz feeder when the swim is shallow/)).toBeNull();
    expect(screen.queryByText('Źródło 1')).toBeNull();
    expect(await screen.findByText('Slash content evidence')).not.toBeNull();
    expect(screen.getByRole('link', { name: /Slash content evidence/ })).toHaveAttribute(
      'href',
      '#/chat/source/knowledge-page%3Aslash-content'
    );
    expect(screen.queryByRole('link', { name: /Open source:/ })).toBeNull();
    expect(document.body.textContent).not.toContain('https://example.com/slash-content');
  });

  it('removes leading markdown bullets from source tile snippets', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        messages: [
          {
            id: 'bullet-source-answer',
            userId: 'user-1',
            conversationId: 'c1',
            role: 'assistant',
            content: 'Bullet source answer.',
            createdAt: '2026-06-14T09:06:00.000Z',
            citations: [
              {
                sourceId: 'knowledge-page:effective-feeder\u0000effective-feeder-evidence',
                usedFor: 'effective feeder',
              },
            ],
            missingInformation: [],
            retrieval: {
              query: 'Why is synthetic fixture effective?',
              startedAt: '2026-06-14T09:05:00.000Z',
              completedAt: '2026-06-14T09:05:01.000Z',
              sources: [],
              evidence: [
                {
                  id: 'effective-feeder-evidence',
                  sourceId: 'knowledge-page:effective-feeder',
                  sourceType: 'knowledge_page',
                  title: 'Na poczatek.',
                  quote:
                    '- **Skutecznosc** - Dzieki synthetic fixtureowi szybko skupisz ryby w jednym miejscu.',
                  score: 0.89,
                  metadata: {},
                },
              ],
            },
          },
        ],
      })
    );

    await renderWorkspaceApp();

    expect(screen.queryByText(/Skutecznosc - Dzieki synthetic fixtureowi/)).toBeNull();
    expect(screen.queryByText(/- Skutecznosc/)).toBeNull();
    expect(screen.queryByText('Źródło 1')).toBeNull();
    expect(await screen.findByText('Na poczatek.')).not.toBeNull();
    expect(screen.getByRole('link', { name: /Na poczatek/ })).toHaveAttribute(
      'href',
      '#/chat/source/knowledge-page%3Aeffective-feeder'
    );
    expect(screen.queryByRole('link', { name: /Open source:/ })).toBeNull();
    expect(document.body.textContent).not.toContain('https://example.com/effective-feeder');
  });

  it('preserves a useful first evidence line without terminal punctuation', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.useChatWorkflow.mockReturnValue(
      chatWorkflow({
        messages: [
          {
            id: 'snag-advice-answer',
            userId: 'user-1',
            conversationId: 'c1',
            role: 'assistant',
            content: 'Snag advice answer.',
            createdAt: '2026-06-14T09:06:00.000Z',
            citations: [
              {
                sourceId: 'knowledge-page:snag-advice\u0000snag-advice-evidence',
                usedFor: 'snag advice',
              },
            ],
            missingInformation: [],
            retrieval: {
              query: 'How should I fish near snags?',
              startedAt: '2026-06-14T09:05:00.000Z',
              completedAt: '2026-06-14T09:05:01.000Z',
              sources: [],
              evidence: [
                {
                  id: 'snag-advice-evidence',
                  sourceId: 'knowledge-page:snag-advice',
                  sourceType: 'knowledge_page',
                  title: 'Snag advice evidence',
                  quote: 'Use barbless hooks near snags\nKeep the lead moving to avoid snagging.',
                  score: 0.89,
                  metadata: {},
                },
              ],
            },
          },
        ],
      })
    );

    await renderWorkspaceApp();

    expect(
      screen.queryByText(/Use barbless hooks near snags Keep the lead moving to avoid snagging/)
    ).toBeNull();
    expect(screen.queryByText('Źródło 1')).toBeNull();
    expect(await screen.findByText('Snag advice evidence')).not.toBeNull();
    expect(screen.getByRole('link', { name: /Snag advice evidence/ })).toHaveAttribute(
      'href',
      '#/chat/source/knowledge-page%3Asnag-advice'
    );
    expect(screen.queryByRole('link', { name: /Open source:/ })).toBeNull();
    expect(document.body.textContent).not.toContain('https://example.com/snag-advice');
  });

  it('keeps the chat workspace free of the removed knowledge editor UI', async () => {
    window.history.replaceState(null, '', '/#/chat');

    await renderWorkspaceApp();

    expect(await screen.findByRole('heading', { level: 2, name: 'Czat' })).not.toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Baza Wiedzy' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sync knowledge base' })).toBeNull();
    expect(screen.queryByLabelText('Markdown editor')).toBeNull();
  });
});
