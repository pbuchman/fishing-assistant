import { createElement, Fragment, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserLevel } from '@fa/http-contracts';

import { clearApiAuthProvider, setApiAuthProvider } from './services/apiClient.js';
import type { FaAuthAccountState } from './auth/useFaAuth.js';

const appModulePath = './App.js';
const configModulePath = './config.js';
const workspaceRouteLoadOptions = { timeout: 10_000 };
const faAuthProviderPropsSpy = vi.fn();

const mockLogin = vi.fn(() => Promise.resolve(undefined));
const mockLogout = vi.fn(() => Promise.resolve(undefined));
const mockRefreshCurrentUser = vi.fn(() => Promise.resolve(undefined));
const mockCompleteProfile = vi.fn(() => Promise.resolve(undefined));

function makeApprovedAccountState(
  overrides: Partial<{
    userId: string;
    auth0Subject: string;
    email: string;
    role: 'user' | 'admin';
    effectiveLevel: UserLevel;
    level: UserLevel | null;
  }> = {}
): FaAuthAccountState {
  const role = overrides.role ?? 'user';
  const effectiveLevel: UserLevel = overrides.effectiveLevel ?? (role === 'admin' ? 10 : 1);
  const level: UserLevel | null = overrides.level ?? (role === 'admin' ? null : 1);
  const userId = overrides.userId ?? 'user-1';
  const email = overrides.email ?? 'angler@example.com';
  const auth0Subject = overrides.auth0Subject ?? 'auth0|test-user';

  return {
    status: 'approved',
    account: {
      state: 'approved',
      user: {
        id: userId,
        email,
        firstName: 'River',
        lastName: 'Walker',
        mobileNumber: '+15550101000',
        role,
        status: 'approved',
        level,
        effectiveLevel,
      },
      authorization: {
        userId,
        auth0Subject,
        email,
        role,
        status: 'approved',
        effectiveLevel,
      },
    },
    authorization: {
      userId,
      auth0Subject,
      email,
      role,
      status: 'approved',
      effectiveLevel,
    },
  };
}

const userBootstrapGatePropsSpy = vi.fn();
let userBootstrapGateMountCounter = 0;

function MockUserBootstrapGate({
  routeHash,
  children,
}: {
  routeHash: string;
  children: ReactNode;
}): ReactNode {
  const [mountId] = useState(() => {
    userBootstrapGateMountCounter += 1;
    return userBootstrapGateMountCounter;
  });
  userBootstrapGatePropsSpy({ routeHash, mountId });

  return createElement(
    'div',
    {
      'data-testid': 'user-bootstrap-gate',
      'data-route-hash': routeHash,
      'data-mount-id': String(mountId),
    },
    children
  );
}

let mockAuthState: {
  isLoading: boolean;
  isAuthenticated: boolean;
  isLogoutInProgress: boolean;
  sessionKey: string;
  accountState: FaAuthAccountState;
  login: typeof mockLogin;
  logout: typeof mockLogout;
  refreshCurrentUser: typeof mockRefreshCurrentUser;
  completeProfile: typeof mockCompleteProfile;
} = {
  isLoading: false,
  isAuthenticated: true,
  isLogoutInProgress: false,
  sessionKey: 'session-default',
  accountState: makeApprovedAccountState(),
  login: mockLogin,
  logout: mockLogout,
  refreshCurrentUser: mockRefreshCurrentUser,
  completeProfile: mockCompleteProfile,
};

vi.mock('./auth/AuthProvider.js', () => ({
  FaAuthProvider: ({
    children,
    accountBootstrapEnabled,
  }: {
    children: unknown;
    accountBootstrapEnabled?: boolean;
  }) => {
    faAuthProviderPropsSpy({ accountBootstrapEnabled });
    return createElement(Fragment, null, children as ReactNode);
  },
}));

vi.mock('./auth/useFaAuth.js', () => ({
  useFaAuth: () => mockAuthState,
}));

vi.mock('./auth/UserBootstrapGate.js', () => ({
  UserBootstrapGate: (props: { routeHash: string; children: ReactNode }) =>
    MockUserBootstrapGate(props),
}));

type FetchHandler = (init: RequestInit) => Response | Promise<Response>;
interface FetchCall {
  url: string;
  method: string;
  init: RequestInit;
}

const conversation = {
  id: 'c1',
  title: 'River rigs',
  status: 'active',
  createdAt: '2026-06-14T09:00:00.000Z',
  updatedAt: '2026-06-14T09:05:00.000Z',
  lastMessageAt: '2026-06-14T09:05:00.000Z',
  lastMessagePreview: 'What hook length?',
  messageCount: 2,
  deletedAt: null,
};

const secondConversation = {
  ...conversation,
  id: 'c2',
  title: 'Canal bream',
  lastMessagePreview: 'Groundbait?',
};

const assistantMessage = {
  id: 'a1',
  userId: 'user-1',
  conversationId: 'c1',
  role: 'assistant',
  content: 'Use a short hook length when the water is clear.',
  createdAt: '2026-06-14T09:05:00.000Z',
  modelId: 'google/gemini-3.5-flash',
  confidence: 'medium',
  citations: [{ sourceId: 'knowledge\u0000chunk-1', usedFor: 'hook length' }],
  missingInformation: ['water temperature'],
  streamStatus: 'completed',
  retrieval: {
    query: 'What hook length?',
    startedAt: '2026-06-14T09:04:00.000Z',
    completedAt: '2026-06-14T09:04:01.000Z',
    sources: [],
    evidence: [
      {
        id: 'chunk-1',
        sourceId: 'knowledge',
        sourceType: 'knowledge_page',
        title: 'River notes',
        quote: 'Short hook lengths helped in clear water.',
        score: 0.91,
        metadata: { headingPath: ['Hooks', 'Clear water'] },
      },
    ],
  },
};

const unsafeMarkdown = [
  '# Markdown safety',
  '',
  '<script>window.__FA_MARKDOWN_XSS = true</script>',
  '',
  '<img src="x" onerror="window.__FA_MARKDOWN_XSS = true" alt="bad image" />',
  '',
  '<u>raw html should not render</u>',
  '',
  '[run javascript](javascript:alert(1))',
  '',
  '[safe external](https://example.com/fishing-notes)',
].join('\n');

function jsonResponse(data: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );
}

function installFetchRouter(routes: Record<string, FetchHandler>): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init = {}) => {
    const method = init.method ?? 'GET';
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = `${method} ${url}`;
    const handler = routes[key];
    if (handler === undefined) {
      throw new Error(`No fetch handler for ${key}`);
    }

    calls.push({ url, method, init });
    return await handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

async function renderApp(): Promise<ReturnType<typeof render>> {
  const { default: App } = (await import(appModulePath)) as { default: ComponentType };
  return render(createElement(App));
}

async function getConfig(): Promise<{
  services: {
    CHAT_SERVICE: string;
    KNOWLEDGE_SERVICE: string;
    LLM_USAGE_SERVICE: string;
  };
}> {
  const { config } = (await import(configModulePath)) as {
    config: {
      services: {
        CHAT_SERVICE: string;
        KNOWLEDGE_SERVICE: string;
        LLM_USAGE_SERVICE: string;
      };
    };
  };

  return config;
}

function expectHTMLElement(element: Element | null): HTMLElement {
  if (!(element instanceof HTMLElement)) {
    throw new Error('Expected HTMLElement to exist.');
  }

  return element;
}

function expectSafeMarkdownDom(container: Element): void {
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('u')).toBeNull();
  expect(
    Array.from(container.querySelectorAll('*')).find((element) =>
      element.getAttributeNames().some((name) => name.toLowerCase().startsWith('on'))
    )
  ).toBeUndefined();
  expect(
    Array.from(container.querySelectorAll('a')).find((anchor) => {
      const href = anchor.getAttribute('href')?.trim() ?? '';
      return href.toLowerCase().startsWith('javascript:');
    })
  ).toBeUndefined();

  for (const anchor of Array.from(container.querySelectorAll('a[target]'))) {
    const relTokens = new Set((anchor.getAttribute('rel') ?? '').split(/\s+/).filter(Boolean));
    expect(relTokens.has('noopener')).toBe(true);
    expect(relTokens.has('noreferrer')).toBe(true);
  }
}

function setMockAuthState(overrides: Partial<typeof mockAuthState> = {}): void {
  mockAuthState = {
    ...mockAuthState,
    ...overrides,
  };
}

describe('App shell', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockLogin.mockReset();
    mockLogout.mockReset();
    mockRefreshCurrentUser.mockReset();
    mockCompleteProfile.mockReset();
    faAuthProviderPropsSpy.mockReset();
    userBootstrapGatePropsSpy.mockReset();
    userBootstrapGateMountCounter = 0;
    setApiAuthProvider({
      getAccessToken: vi.fn(() => Promise.resolve('app-test-token')),
      refreshAccessToken: vi.fn(() => Promise.resolve('app-test-token-refresh')),
    });
    mockAuthState = {
      isLoading: false,
      isAuthenticated: true,
      isLogoutInProgress: false,
      sessionKey: 'session-default',
      accountState: makeApprovedAccountState(),
      login: mockLogin,
      logout: mockLogout,
      refreshCurrentUser: mockRefreshCurrentUser,
      completeProfile: mockCompleteProfile,
    };
  });

  afterEach(() => {
    clearApiAuthProvider();
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  it('defaults to the replaceable Home route without calling APIs', async () => {
    setMockAuthState({ isAuthenticated: false, accountState: { status: 'unauthenticated' } });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await renderApp();

    expect(window.location.hash).toBe('#/home');
    expect(screen.getByRole('heading', { level: 1, name: 'Fishing Assistant' })).not.toBeNull();
    expect(
      screen
        .getAllByRole('link', { name: /Otwórz asystenta/i })
        .some((link) => link.getAttribute('href') === '/app#/chat')
    ).toBe(true);
    expect(
      screen
        .getAllByRole('link', { name: /Zobacz przykłady/i })
        .some((link) => link.getAttribute('href') === '#assistant')
    ).toBe(true);
    expect(document.querySelector('.app-shell')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  }, 10_000);

  it('keeps account bootstrap disabled on the public Home surface even for authenticated sessions', async () => {
    window.history.replaceState(null, '', '/#/home');

    await renderApp();

    expect(faAuthProviderPropsSpy).toHaveBeenLastCalledWith({
      accountBootstrapEnabled: false,
    });
  });

  it('renders the isolated Home route with CTAs into protected product access', async () => {
    setMockAuthState({ isAuthenticated: false, accountState: { status: 'unauthenticated' } });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/#/home');

    await renderApp();

    expect(screen.getByRole('heading', { level: 1, name: 'Fishing Assistant' })).not.toBeNull();
    expect(
      screen
        .getAllByRole('link', { name: /Otwórz asystenta/i })
        .some((link) => link.getAttribute('href') === '/app#/chat')
    ).toBe(true);
    expect(screen.queryByRole('link', { name: /Manage knowledge/i })).toBeNull();
    expect(
      screen
        .getAllByRole('link')
        .some((link) => link.getAttribute('href')?.startsWith('#/admin') ?? false)
    ).toBe(false);
    expect(document.querySelector('.app-shell')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders legal routes on the public surface without Auth0 login or product APIs', async () => {
    setMockAuthState({ isAuthenticated: false, accountState: { status: 'unauthenticated' } });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/#/privacy');

    await renderApp();

    expect(screen.getByRole('heading', { level: 1, name: 'Polityka prywatności' })).toBeVisible();
    expect(screen.getByText(/charakter informacyjny/i)).toBeVisible();
    expect(screen.queryByText(/wersja robocza/i)).toBeNull();
    expect(faAuthProviderPropsSpy).toHaveBeenLastCalledWith({
      accountBootstrapEnabled: false,
    });
    expect(mockLogin).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders the legal information document on the public legal route', async () => {
    setMockAuthState({ isAuthenticated: false, accountState: { status: 'unauthenticated' } });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/#/legal');

    await renderApp();

    expect(screen.getByRole('heading', { level: 1, name: 'Informacje prawne' })).toBeVisible();
    expect(screen.getByText(/charakter informacyjny/i)).toBeVisible();
    expect(screen.queryByText(/wersja robocza/i)).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Dane podmiotu' })).toBeVisible();
    expect(screen.queryByRole('heading', { level: 1, name: 'Informacje prawne FA' })).toBeNull();
    expect(faAuthProviderPropsSpy).toHaveBeenLastCalledWith({
      accountBootstrapEnabled: false,
    });
    expect(mockLogin).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts Auth0 login for unauthenticated protected routes without calling product APIs', async () => {
    setMockAuthState({ isAuthenticated: false, accountState: { status: 'unauthenticated' } });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/#/chat');

    await renderApp();

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('#/chat');
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Redirecting to sign in...')).toBeInTheDocument();
  });

  it('forces the next protected login to show Universal Login after product logout', async () => {
    setMockAuthState({ isAuthenticated: false, accountState: { status: 'unauthenticated' } });
    window.sessionStorage.setItem('fa.force_login_after_logout', '1');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/#/chat');

    await renderApp();

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('#/chat', { prompt: 'login' });
    });
    expect(window.sessionStorage.getItem('fa.force_login_after_logout')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not restart Auth0 login while product logout is in progress', async () => {
    setMockAuthState({
      isAuthenticated: false,
      isLogoutInProgress: true,
      accountState: { status: 'unauthenticated' },
    });
    window.sessionStorage.setItem('fa.force_login_after_logout', '1');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/app#/chat');

    await renderApp();

    expect(screen.getByText('Signing out...')).toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('fa.force_login_after_logout')).toBe('1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves selected starter prompts when protected chat routes begin login', async () => {
    setMockAuthState({ isAuthenticated: false, accountState: { status: 'unauthenticated' } });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/#/chat?prompt=Dobierz%20przyn%C4%99t%C4%99');

    await renderApp();

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('#/chat?prompt=Dobierz%20przyn%C4%99t%C4%99');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defaults the /app entrypoint to the protected chat route without calling product APIs', async () => {
    setMockAuthState({ isAuthenticated: false, accountState: { status: 'unauthenticated' } });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/app');

    await renderApp();

    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat');
      expect(mockLogin).toHaveBeenCalledWith('#/chat');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps unknown /app hashes on the protected surface instead of rendering Home', async () => {
    setMockAuthState({ isAuthenticated: false, accountState: { status: 'unauthenticated' } });
    window.history.replaceState(null, '', '/app#/definitely-not-a-route');

    await renderApp();

    expect(screen.queryByRole('heading', { level: 1, name: 'Fishing Assistant' })).toBeNull();
    expect(await screen.findByText('Redirecting to sign in...')).not.toBeNull();
    expect(mockLogin).toHaveBeenCalledWith('#/definitely-not-a-route');
  });

  it('keeps the explicit not-allowed app route on the protected surface', async () => {
    setMockAuthState({ isAuthenticated: false, accountState: { status: 'unauthenticated' } });
    window.history.replaceState(null, '', '/app#/not-allowed');

    await renderApp();

    expect(screen.queryByRole('heading', { level: 1, name: 'Fishing Assistant' })).toBeNull();
    expect(await screen.findByText('Redirecting to sign in...')).not.toBeNull();
    expect(mockLogin).toHaveBeenCalledWith('#/not-allowed');
  });

  it('does not keep Auth0 callback query parameters on protected chat routes', async () => {
    window.history.replaceState(null, '', '/app?code=abc&state=xyz#/chat');
    setMockAuthState({
      isAuthenticated: true,
      accountState: makeApprovedAccountState(),
    });

    installFetchRouter({
      'GET /api/chat/conversations': () => jsonResponse([]),
    });

    await renderApp();

    expect(
      await screen.findByRole(
        'heading',
        { level: 2, name: 'O co chcesz zapytać?' },
        workspaceRouteLoadOptions
      )
    ).not.toBeNull();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#/chat');
  });

  it('shows a recoverable auth error for an empty callback route', async () => {
    setMockAuthState({ isAuthenticated: false, accountState: { status: 'unauthenticated' } });
    window.history.replaceState(null, '', '/app#/auth/callback');

    await renderApp();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Link logowania wygasł' })
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Zaloguj ponownie' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Wróć na stronę główną' })).toHaveAttribute(
      'href',
      '#/home'
    );
  });

  it('keeps the default login return hash neutral for role-based post-login routing', async () => {
    setMockAuthState({ isAuthenticated: false, accountState: { status: 'unauthenticated' } });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/#/login');

    await renderApp();

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('#/login');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts Auth0 signup for the signup route without calling product APIs', async () => {
    setMockAuthState({ isAuthenticated: false, accountState: { status: 'unauthenticated' } });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/#/signup');

    await renderApp();

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('#/signup', {
        prompt: 'login',
        screenHint: 'signup',
      });
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a retryable sign-in error when Auth0 returns an authorization error', async () => {
    setMockAuthState({ isAuthenticated: false, accountState: { status: 'unauthenticated' } });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(
      null,
      '',
      '/?error=invalid_request&error_description=client%20is%20not%20authorized#/auth/callback'
    );

    await renderApp();

    expect(screen.getByRole('heading', { name: 'Logowanie nie powiodło się' })).toBeInTheDocument();
    expect(screen.getByText('Nie udało się rozpocząć logowania.')).toBeInTheDocument();
    expect(screen.queryByText('Loading workspace...')).toBeNull();
    expect(screen.queryByText(/client is not authorized/i)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockLogin).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('#/login');
    });
  });

  it('remounts the protected gate when the auth session key changes', async () => {
    window.history.replaceState(null, '', '/#/chat');
    installFetchRouter({
      'GET /api/chat/conversations': () => jsonResponse([]),
    });

    const view = await renderApp();

    expect(
      await screen.findByRole(
        'heading',
        { level: 2, name: 'O co chcesz zapytać?' },
        workspaceRouteLoadOptions
      )
    ).not.toBeNull();
    expect(screen.getByTestId('user-bootstrap-gate')).toHaveAttribute('data-mount-id', '1');

    setMockAuthState({
      sessionKey: 'session-next',
      accountState: makeApprovedAccountState({
        userId: 'user-2',
        auth0Subject: 'auth0|test-user-2',
        email: 'second@example.com',
      }),
    });
    const { default: App } = (await import(appModulePath)) as { default: ComponentType };
    view.rerender(createElement(App));

    await waitFor(() => {
      expect(screen.getByTestId('user-bootstrap-gate')).toHaveAttribute('data-mount-id', '2');
    });
  });

  it('renders the chat route and uses generated same-origin API service paths', async () => {
    window.history.replaceState(null, '', '/#/chat');
    installFetchRouter({
      'GET /api/chat/conversations': () => jsonResponse([]),
    });

    await renderApp();

    expect(window.location.hash).toBe('#/chat');
    expect(faAuthProviderPropsSpy).toHaveBeenLastCalledWith({
      accountBootstrapEnabled: true,
    });
    expect(
      await screen.findByRole(
        'heading',
        { level: 2, name: 'O co chcesz zapytać?' },
        workspaceRouteLoadOptions
      )
    ).not.toBeNull();
    expect(
      screen.getByText('Zacznij od łowiska, metody, przynęty albo problemu z ostatniej sesji.')
    ).not.toBeNull();
    expect(screen.getByPlaceholderText('Zapytaj o łowisko, metodę albo sprzęt')).not.toBeNull();
    expect(await getConfig()).toMatchObject({
      services: {
        CHAT_SERVICE: '/api/chat',
        KNOWLEDGE_SERVICE: '/api/knowledge',
        LLM_USAGE_SERVICE: '/api/llm-usage',
      },
    });
  });

  it('renders conversation history, selected messages, missing information, and citations', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    installFetchRouter({
      'GET /api/chat/conversations': () => jsonResponse([conversation]),
      'GET /api/chat/conversations/c1/messages': () =>
        jsonResponse([
          {
            id: 'u1',
            userId: 'user-1',
            conversationId: 'c1',
            role: 'user',
            content: 'What hook length?',
            createdAt: '',
            citations: [],
            missingInformation: [],
          },
          assistantMessage,
        ]),
    });

    await renderApp();

    expect(await screen.findByRole('link', { name: /River rigs/ })).not.toBeNull();
    expect(screen.getAllByText('What hook length?').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Use a short hook length when the water is clear.')).not.toBeNull();
    expect(screen.getByText('water temperature')).not.toBeNull();
    expect(screen.queryByText('Źródło 1')).toBeNull();
    expect(screen.queryByText('Short hook lengths helped in clear water.')).toBeNull();
    expect(screen.getByText('River notes')).not.toBeNull();
    expect(screen.queryByText('Hooks / Clear water')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open document' })).toBeNull();
  });

  it('switches app chrome language without rewriting fetched assistant answers', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    installFetchRouter({
      'GET /api/chat/conversations': () => jsonResponse([conversation]),
      'GET /api/chat/conversations/c1/messages': () =>
        jsonResponse([
          {
            id: 'u1',
            userId: 'user-1',
            conversationId: 'c1',
            role: 'user',
            content: 'Jak dobrać przynętę?',
            createdAt: '',
            citations: [],
            missingInformation: [],
          },
          {
            ...assistantMessage,
            content: 'Użyj krótkiego przyponu, gdy woda jest przejrzysta.',
          },
        ]),
    });

    await renderApp();

    expect(
      await screen.findByText('Użyj krótkiego przyponu, gdy woda jest przejrzysta.')
    ).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Angielski' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ustawienia konta' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Język' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'EN English' }));

    expect(screen.getByRole('menuitem', { name: 'Log out' })).not.toBeNull();
    expect(screen.getByPlaceholderText('Ask a follow-up')).not.toBeNull();
    expect(screen.getByText('Użyj krótkiego przyponu, gdy woda jest przejrzysta.')).not.toBeNull();
  });

  it('renders failed assistant drafts with chunk-id citations', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    installFetchRouter({
      'GET /api/chat/conversations': () => jsonResponse([conversation]),
      'GET /api/chat/conversations/c1/messages': () =>
        jsonResponse([
          {
            ...assistantMessage,
            id: 'a-failed',
            content: 'I could not finish that answer.',
            citations: [{ sourceId: 'chunk-1', usedFor: 'retired chunk id' }],
            streamStatus: 'failed',
            errorMessage: 'The stream stopped before completion.',
          },
        ]),
    });

    await renderApp();

    expect(await screen.findByText('I could not finish that answer.')).not.toBeNull();
    expect(
      screen.getByText(
        'Nie udało mi się w pełni potwierdzić tej odpowiedzi w źródłach. Potraktuj ją jako wskazówkę albo doprecyzuj pytanie.'
      )
    ).not.toBeNull();
    expect(screen.queryByText('The stream stopped before completion.')).toBeNull();
    expect(screen.queryByText('retired chunk id')).toBeNull();
    expect(screen.queryByText('Źródło 1')).toBeNull();
    expect(screen.queryByText('Short hook lengths helped in clear water.')).toBeNull();
    expect(screen.getByText('River notes')).not.toBeNull();
  });

  it('renders unmatched citations without document links', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    installFetchRouter({
      'GET /api/chat/conversations': () => jsonResponse([conversation]),
      'GET /api/chat/conversations/c1/messages': () =>
        jsonResponse([
          {
            ...assistantMessage,
            id: 'a-unmatched-citation',
            citations: [{ sourceId: 'missing-source', usedFor: 'source no longer indexed' }],
            retrieval: {
              ...assistantMessage.retrieval,
              evidence: [],
            },
          },
        ]),
    });

    await renderApp();

    expect(
      await screen.findByText('Use a short hook length when the water is clear.')
    ).not.toBeNull();
    expect(screen.queryByText('Źródło z Bazy Wiedzy')).toBeNull();
    expect(screen.queryByText('Wykorzystane źródła')).toBeNull();
    expect(screen.queryByText('missing-source')).toBeNull();
    expect(screen.queryByText('source no longer indexed')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open document' })).toBeNull();
  });

  it('renders unsafe chat Markdown without executable HTML or javascript links', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    installFetchRouter({
      'GET /api/chat/conversations': () => jsonResponse([conversation]),
      'GET /api/chat/conversations/c1/messages': () =>
        jsonResponse([
          {
            ...assistantMessage,
            id: 'unsafe-chat-markdown',
            content: unsafeMarkdown,
            citations: [],
            missingInformation: [],
            retrieval: undefined,
          },
        ]),
    });

    await renderApp();

    const heading = await screen.findByRole('heading', { level: 1, name: 'Markdown safety' });
    const messageBubble = expectHTMLElement(heading.closest('.message-bubble'));

    expectSafeMarkdownDom(messageBubble);
    expect(within(messageBubble).getByText('safe external')).not.toBeNull();
    expect(within(messageBubble).queryByRole('link', { name: 'safe external' })).toBeNull();
    expect(messageBubble.textContent).not.toContain('https://example.com/fishing-notes');
  });

  it('creates and soft-deletes conversations with hash navigation', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    let listConversationRequestCount = 0;
    const createdConversation = {
      ...conversation,
      id: 'c3',
      title: 'New Chat',
      lastMessagePreview: '',
      messageCount: 0,
    };
    const fetchLog = installFetchRouter({
      'GET /api/chat/conversations': () => {
        listConversationRequestCount += 1;
        return jsonResponse(
          listConversationRequestCount === 1
            ? [conversation, secondConversation]
            : [createdConversation, conversation]
        );
      },
      'GET /api/chat/conversations/c1/messages': () => jsonResponse([]),
      'POST /api/chat/conversations': () => jsonResponse(createdConversation, { status: 201 }),
      'GET /api/chat/conversations/c3/messages': () => jsonResponse([]),
      'POST /api/chat/conversations/c3/messages/stream': () =>
        sseResponse(['event: done\ndata: {"ok":true}\n\n']),
      'DELETE /api/chat/conversations/c2': () => jsonResponse({ deleted: true }),
      'DELETE /api/chat/conversations/c3': () => jsonResponse({ deleted: true }),
    });

    await renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Usuń rozmowę: Canal bream' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Usunąć rozmowę?' })).getByRole('button', {
        name: 'Usuń',
      })
    );
    expect(window.location.hash).toBe('#/chat/c1');

    fireEvent.click(await screen.findByRole('button', { name: 'Nowy chat' }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat');
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Pytanie' }), {
      target: { value: 'Start a new chat' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Wyślij wiadomość' }));

    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat/c3');
    });
    expect(screen.getByRole('link', { name: /Bez tytułu/i })).not.toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'Usuń rozmowę: Bez tytułu' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Usunąć rozmowę?' })).getByRole('button', {
        name: 'Usuń',
      })
    );

    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat/c1');
    });
    expect(fetchLog.calls.map((call) => [call.url, call.method])).toContainEqual([
      '/api/chat/conversations/c3',
      'DELETE',
    ]);
  });

  it('deletes the only selected conversation back to the chat root', async () => {
    window.history.replaceState(null, '', '/#/chat/c1');
    installFetchRouter({
      'GET /api/chat/conversations': () => jsonResponse([conversation]),
      'GET /api/chat/conversations/c1/messages': () => jsonResponse([]),
      'DELETE /api/chat/conversations/c1': () => jsonResponse({ deleted: true }),
    });

    await renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Usuń rozmowę: River rigs' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Usunąć rozmowę?' })).getByRole('button', {
        name: 'Usuń',
      })
    );

    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat');
    });
  });

  it('does not expose the removed workspace knowledge editor to approved users', async () => {
    window.history.replaceState(null, '', '/#/chat');
    const fetchLog = installFetchRouter({
      'GET /api/chat/conversations': () => jsonResponse([]),
    });

    await renderApp();

    expect(
      await screen.findByRole('heading', { level: 2, name: 'O co chcesz zapytać?' })
    ).not.toBeNull();
    expect(screen.queryByLabelText('Markdown editor')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New document' })).toBeNull();
    expect(
      fetchLog.calls.map((call) => call.url).some((url) => url.startsWith('/api/knowledge'))
    ).toBe(false);
  });

  it('redirects regular users away from personal usage without calling usage APIs', async () => {
    window.history.replaceState(null, '', '/#/usage');
    const calls: FetchCall[] = [];
    const fetchMock = vi.fn<typeof fetch>((input, init = {}) => {
      const method = init.method ?? 'GET';
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, method, init });
      if (method === 'GET' && url === '/api/chat/conversations') {
        return Promise.resolve(jsonResponse([]));
      }

      throw new Error(`No fetch handler for ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await renderApp();

    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat');
    });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'O co chcesz zapytać?' })
    ).not.toBeNull();
    expect(calls.some((call) => call.url.startsWith('/api/llm-usage/'))).toBe(false);
  });

  it.each([
    '#/login',
    '#/signup',
    '#/auth/callback',
    '#/profile',
    '#/pending',
    '#/rejected',
    '#/suspended',
    '#/chat',
    '#/admin/pending',
    '#/usage',
    '#/not-allowed',
  ])('does not swallow %s into HomePage', async (hash) => {
    setMockAuthState({ isAuthenticated: false, accountState: { status: 'unauthenticated' } });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', `/${hash}`);

    await renderApp();

    expect(screen.queryByRole('heading', { level: 1, name: 'Fishing Assistant' })).toBeNull();
  });
});
