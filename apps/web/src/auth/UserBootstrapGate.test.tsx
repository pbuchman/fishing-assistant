import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserLevel } from '@fa/http-contracts';

import type { FaAuthAccountState, FaAuthContextValue } from './useFaAuth.js';

const userBootstrapGateModulePath = './UserBootstrapGate.js';

const mockRefreshCurrentUser = vi.fn(() => Promise.resolve(undefined));
const mockCompleteProfile = vi.fn(() => Promise.resolve(undefined));
const mockLogout = vi.fn(() => Promise.resolve(undefined));

function makeApprovedState(
  overrides: Partial<
    Extract<FaAuthContextValue['accountState'], { status: 'approved' }>['account']['user']
  > &
    Partial<
      Extract<FaAuthContextValue['accountState'], { status: 'approved' }>['authorization']
    > = {}
): Extract<FaAuthContextValue['accountState'], { status: 'approved' }> {
  const role = overrides.role ?? 'user';
  const effectiveLevel: UserLevel = overrides.effectiveLevel ?? (role === 'admin' ? 10 : 1);
  const level: UserLevel | null = overrides.level ?? (role === 'admin' ? null : 1);
  const user = {
    id: 'user-1',
    email: 'angler@example.com',
    firstName: 'River',
    lastName: 'Walker',
    mobileNumber: '+15550101000',
    role,
    status: 'approved' as const,
    level,
    effectiveLevel,
    ...overrides,
  };

  const authorization = {
    userId: user.id,
    auth0Subject: 'auth0|user-1',
    email: user.email,
    role: user.role,
    status: 'approved' as const,
    effectiveLevel: user.effectiveLevel,
    ...overrides,
  };

  return {
    status: 'approved',
    account: {
      state: 'approved',
      user,
      authorization,
    },
    authorization,
  };
}

function makeStatusState<Status extends 'pending' | 'rejected' | 'suspended'>(
  status: Status
): Extract<FaAuthContextValue['accountState'], { status: Status }> {
  if (status === 'pending') {
    return {
      status,
      account: {
        state: status,
        user: {
          id: 'user-1',
          email: 'angler@example.com',
          firstName: 'River',
          lastName: 'Walker',
          mobileNumber: '+15550101000',
          role: 'user',
          status,
          level: 1,
          effectiveLevel: 1,
        },
      },
    } as Extract<FaAuthContextValue['accountState'], { status: Status }>;
  }

  if (status === 'rejected') {
    return {
      status,
      account: {
        state: status,
        user: {
          id: 'user-1',
          email: 'angler@example.com',
          firstName: 'River',
          lastName: 'Walker',
          mobileNumber: '+15550101000',
          role: 'user',
          status,
          level: 1,
          effectiveLevel: 1,
        },
      },
    } as Extract<FaAuthContextValue['accountState'], { status: Status }>;
  }

  return {
    status,
    account: {
      state: status,
      user: {
        id: 'user-1',
        email: 'angler@example.com',
        firstName: 'River',
        lastName: 'Walker',
        mobileNumber: '+15550101000',
        role: 'user',
        status,
        level: 1,
        effectiveLevel: 1,
      },
    },
  } as Extract<FaAuthContextValue['accountState'], { status: Status }>;
}

let mockAuthValue: FaAuthContextValue = {
  accountState: { status: 'loading' },
  sessionKey: 'gate-session',
  login: vi.fn(() => Promise.resolve(undefined)),
  logout: mockLogout,
  refreshCurrentUser: mockRefreshCurrentUser,
  completeProfile: mockCompleteProfile,
  isLoading: false,
  isAuthenticated: true,
  isLogoutInProgress: false,
  getAccessToken: vi.fn(() => Promise.resolve('token')),
  refreshAccessToken: vi.fn(() => Promise.resolve('token-refresh')),
};

vi.mock('./useFaAuth.js', () => ({
  useFaAuth: () => mockAuthValue,
}));

async function renderGate(routeHash: string): Promise<void> {
  const { UserBootstrapGate } = (await import(userBootstrapGateModulePath)) as {
    UserBootstrapGate: (props: {
      routeHash: string;
      children: React.ReactNode;
      adminChildren?: React.ReactNode;
    }) => React.ReactElement;
  };

  render(
    createElement(UserBootstrapGate, {
      routeHash,
      children: createElement('div', null, 'workspace children'),
      adminChildren: createElement('div', null, 'admin children'),
    })
  );
}

describe('UserBootstrapGate', () => {
  beforeEach(() => {
    mockRefreshCurrentUser.mockReset();
    mockCompleteProfile.mockReset();
    mockLogout.mockReset();
    mockAuthValue = {
      accountState: { status: 'loading' },
      sessionKey: 'gate-session',
      login: vi.fn(() => Promise.resolve(undefined)),
      logout: mockLogout,
      refreshCurrentUser: mockRefreshCurrentUser,
      completeProfile: mockCompleteProfile,
      isLoading: false,
      isAuthenticated: true,
      isLogoutInProgress: false,
      getAccessToken: vi.fn(() => Promise.resolve('token')),
      refreshAccessToken: vi.fn(() => Promise.resolve('token-refresh')),
    };
    window.history.replaceState(null, '', '/#/chat');
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/');
  });

  it('renders loading UI while the current account state is resolving', async () => {
    mockAuthValue.accountState = { status: 'loading' };

    await renderGate('#/chat');

    expect(screen.getByText('Loading your account...')).toBeInTheDocument();
    expect(screen.queryByText('workspace children')).toBeNull();
  });

  it('renders the profile completion form for profile-required users', async () => {
    mockAuthValue.accountState = {
      status: 'profile_required',
      account: {
        state: 'profile_required',
        user: null,
        requiredFields: ['firstName', 'lastName', 'mobileNumber'],
      },
    };

    await renderGate('#/profile');

    expect(screen.getByLabelText('Imię')).toBeInTheDocument();
    expect(screen.getByLabelText('Nazwisko')).toBeInTheDocument();
    expect(screen.getByLabelText('Telefon')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Wyloguj' }).click();
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('workspace children')).toBeNull();
  });

  it('renders pending, rejected, and suspended account-state pages without product children', async () => {
    mockAuthValue.accountState = makeStatusState('pending');
    await renderGate('#/pending');
    expect(
      screen.getByText('Administrator sprawdzi dostęp i odblokuje asystenta.')
    ).toBeInTheDocument();
    expect(screen.getByText('Fishing Assistant')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Wyloguj' }).click();
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('workspace children')).toBeNull();

    cleanup();
    mockAuthValue.accountState = makeStatusState('rejected');
    await renderGate('#/rejected');
    expect(screen.getByText(/Twoje konto nie zostało zatwierdzone/)).toBeInTheDocument();
    screen.getByRole('button', { name: 'Wyloguj' }).click();
    expect(screen.queryByText('Fishing Assistant')).toBeNull();
    expect(mockLogout).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('workspace children')).toBeNull();

    cleanup();
    mockAuthValue.accountState = makeStatusState('suspended');
    await renderGate('#/suspended');
    expect(screen.getByText('Twoje konto zostało zawieszone.')).toBeInTheDocument();
    expect(
      screen.getByText('Skontaktuj się z administratorem, aby przywrócić dostęp.')
    ).toBeInTheDocument();
    screen.getByRole('button', { name: 'Wyloguj' }).click();
    expect(screen.queryByText('Fishing Assistant')).toBeNull();
    expect(mockLogout).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(/reason/i)).toBeNull();
    expect(screen.queryByText('workspace children')).toBeNull();
  });

  it('renders a readable pending account screen', async () => {
    mockAuthValue.accountState = makeStatusState('pending');

    await renderGate('#/pending');

    expect(screen.getByRole('heading', { name: 'Konto czeka na akceptację' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wyloguj' })).toBeInTheDocument();
  });

  it('renders a sign-out button on not-allowed account pages', async () => {
    mockAuthValue.accountState = makeApprovedState();

    await renderGate('#/admin/usage');

    expect(screen.getByText('Ta strona nie jest dostępna dla Twojego konta.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wyloguj' })).toBeInTheDocument();
    expect(screen.queryByText('Fishing Assistant')).toBeNull();
  });

  it('renders the original treatment for account check errors', async () => {
    mockAuthValue.accountState = {
      status: 'error',
      message: 'Unable to verify your account. Please try again.',
    };

    await renderGate('#/chat');

    expect(
      screen.getByRole('heading', { name: 'Nie udało się sprawdzić konta' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spróbuj ponownie' })).toBeInTheDocument();
    expect(screen.queryByText('Fishing Assistant')).toBeNull();
  });

  it('renders a coarse retryable error state when account verification fails', async () => {
    mockAuthValue.accountState = {
      status: 'error',
      message: 'Unable to verify your account. Please try again.',
    };

    await renderGate('#/chat');

    screen.getByRole('button', { name: 'Spróbuj ponownie' }).click();
    expect(
      screen.getByText('Unable to verify your account. Please try again.')
    ).toBeInTheDocument();
    expect(mockRefreshCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('renders sign-out and home recovery actions when account verification fails', async () => {
    mockAuthValue.accountState = {
      status: 'error',
      message: 'Unable to verify your account. Please try again.',
    };

    await renderGate('#/chat');

    screen.getByRole('button', { name: 'Wyloguj' }).click();
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Wróć na stronę główną' })).toHaveAttribute(
      'href',
      '#/home'
    );
    expect(document.title).toBe('Nie udało się sprawdzić konta - Fishing Assistant');
  });

  it('renders product children for approved chat routes', async () => {
    mockAuthValue.accountState = makeApprovedState();

    await renderGate('#/chat');

    expect(screen.getByText('workspace children')).toBeInTheDocument();
  });

  it('renders approved chat routes that carry a starter prompt query', async () => {
    mockAuthValue.accountState = makeApprovedState();

    await renderGate('#/chat?prompt=Dobierz%20przyn%C4%99t%C4%99');

    expect(screen.getByText('workspace children')).toBeInTheDocument();
  });

  it('renders the profile route for approved users without redirecting to chat', async () => {
    mockAuthValue.accountState = makeApprovedState();
    window.history.replaceState(null, '', '/#/profile');

    await renderGate('#/profile');

    expect(window.location.hash).toBe('#/profile');
    expect(screen.getByRole('heading', { level: 1, name: 'Profil' })).toBeInTheDocument();
    expect(screen.getByText('angler@example.com')).toBeInTheDocument();
    expect(screen.queryByText('workspace children')).toBeNull();
  });

  it('redirects approved admins away from login to admin pending', async () => {
    mockAuthValue.accountState = makeApprovedState({
      role: 'admin',
      level: null,
      effectiveLevel: 10,
    });
    window.history.replaceState(null, '', '/#/login');

    await renderGate('#/login');

    await waitFor(() => {
      expect(window.location.hash).toBe('#/admin/pending');
    });
    expect(screen.queryByText('workspace children')).toBeNull();
  });

  it('renders product children for approved admins on chat routes', async () => {
    mockAuthValue.accountState = makeApprovedState({
      role: 'admin',
      level: null,
      effectiveLevel: 10,
    });

    window.history.replaceState(null, '', '/#/chat');
    await renderGate('#/chat');

    expect(window.location.hash).toBe('#/chat');
    expect(screen.getByText('workspace children')).toBeInTheDocument();
    expect(screen.queryByText('admin children')).toBeNull();
  });

  it('renders the profile route for approved admins without redirecting to admin pending', async () => {
    mockAuthValue.accountState = makeApprovedState({
      role: 'admin',
      level: null,
      effectiveLevel: 10,
    });
    window.history.replaceState(null, '', '/#/profile');

    await renderGate('#/profile');

    expect(window.location.hash).toBe('#/profile');
    expect(screen.getByRole('heading', { level: 1, name: 'Profil' })).toBeInTheDocument();
    expect(screen.getByText('Administrator')).toBeInTheDocument();
    expect(screen.queryByText('admin children')).toBeNull();
    expect(screen.queryByText('workspace children')).toBeNull();
  });

  it('renders a not-allowed screen for approved non-admin admin routes', async () => {
    mockAuthValue.accountState = makeApprovedState();

    await renderGate('#/admin/usage');

    expect(screen.getByText('Ta strona nie jest dostępna dla Twojego konta.')).toBeInTheDocument();
    expect(screen.queryByText('admin children')).toBeNull();
    expect(screen.queryByText('workspace children')).toBeNull();
  });

  it('renders a not-allowed screen with chat recovery for explicit not-allowed routes', async () => {
    mockAuthValue.accountState = makeApprovedState();

    await renderGate('#/not-allowed');

    expect(screen.getByRole('heading', { level: 1, name: 'Brak dostępu' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wróć do chatu' })).toHaveAttribute('href', '#/chat');
    expect(screen.getByRole('button', { name: 'Wyloguj' })).toBeInTheDocument();
    expect(screen.queryByText('workspace children')).toBeNull();
  });

  it('renders a workspace not-found state for unknown approved routes', async () => {
    mockAuthValue.accountState = makeApprovedState();

    await renderGate('#/definitely-not-a-route');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Nie znaleziono strony' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wróć do chatu' })).toHaveAttribute('href', '#/chat');
    expect(screen.queryByText('workspace children')).toBeNull();
  });

  it('redirects approved non-admin users from retired usage routes to chat', async () => {
    mockAuthValue.accountState = makeApprovedState();
    window.history.replaceState(null, '', '/#/usage');

    await renderGate('#/usage');

    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat');
    });
    expect(screen.queryByText('workspace children')).toBeNull();
    expect(screen.queryByText('admin children')).toBeNull();
    expect(screen.queryByText('Ta strona nie jest dostępna dla Twojego konta.')).toBeNull();
  });

  it('renders admin children for approved admins on admin usage routes', async () => {
    mockAuthValue.accountState = makeApprovedState({
      role: 'admin',
      level: null,
      effectiveLevel: 10,
    });

    await renderGate('#/admin/usage');

    expect(screen.getByText('admin children')).toBeInTheDocument();
    expect(screen.queryByText('workspace children')).toBeNull();
  });

  it('redirects approved admins from retired usage to admin usage', async () => {
    mockAuthValue.accountState = makeApprovedState({
      role: 'admin',
      level: null,
      effectiveLevel: 10,
    });
    window.history.replaceState(null, '', '/#/usage');

    await renderGate('#/usage');

    await waitFor(() => {
      expect(window.location.hash).toBe('#/admin/usage');
    });
    expect(screen.queryByText('admin children')).toBeNull();
    expect(screen.queryByText('workspace children')).toBeNull();
  });

  it('does not mutate the hash during render for approved admin non-protected routes', async () => {
    mockAuthValue.accountState = makeApprovedState({
      role: 'admin',
      level: null,
      effectiveLevel: 10,
    });
    window.history.replaceState(null, '', '/#/public-share/demo');

    const { UserBootstrapGate } = (await import(userBootstrapGateModulePath)) as {
      UserBootstrapGate: (props: {
        routeHash: string;
        children: React.ReactNode;
        adminChildren?: React.ReactNode;
      }) => React.ReactElement;
    };

    renderToStaticMarkup(
      createElement(UserBootstrapGate, {
        routeHash: '#/public-share/demo',
        children: createElement('div', null, 'workspace children'),
        adminChildren: createElement('div', null, 'admin children'),
      })
    );

    expect(window.location.hash).toBe('#/public-share/demo');
  });

  it.each([
    [makeStatusState('pending'), '#/chat', '#/pending'],
    [makeStatusState('rejected'), '#/chat', '#/rejected'],
    [makeStatusState('suspended'), '#/chat', '#/suspended'],
    [makeApprovedState(), '#/pending', '#/chat'],
    [
      makeApprovedState({ role: 'admin', level: null, effectiveLevel: 10 }),
      '#/pending',
      '#/admin/pending',
    ],
    [
      {
        status: 'profile_required' as const,
        account: {
          state: 'profile_required' as const,
          user: null,
          requiredFields: ['firstName', 'lastName', 'mobileNumber'] as const,
        },
      },
      '#/chat',
      '#/profile',
    ],
  ] satisfies [FaAuthAccountState, string, string][])(
    'redirects mismatched account-state routes from %s to %s',
    async (accountState, routeHash, expectedHash) => {
      mockAuthValue.accountState = accountState;
      window.history.replaceState(null, '', `/${routeHash}`);

      await renderGate(routeHash);

      await waitFor(() => {
        expect(window.location.hash).toBe(expectedHash);
      });
    }
  );
});
