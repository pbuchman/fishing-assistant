import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthorizationResolveResponse, UserLevel } from '@fa/http-contracts';
import type { ApiAuthProvider } from '../services/apiClient.js';

const authProviderModulePath = './AuthProvider.js';

interface Auth0StateForTests {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: { sub?: string } | undefined;
  loginWithRedirect: (options?: unknown) => Promise<void>;
  logout: (options?: unknown) => Promise<void>;
  getAccessTokenSilently: (options?: { cacheMode?: string }) => Promise<string>;
}

interface CompleteProfileInput {
  firstName: string;
  lastName: string;
  mobileNumber: string;
}

const auth0ProviderSpy = vi.fn(
  ({ children }: { children: ReactNode }): ReactElement =>
    createElement('div', { 'data-testid': 'auth0' }, children)
);
const useAuth0Spy = vi.fn<() => Auth0StateForTests>();
const setApiAuthProviderSpy = vi.fn<(provider: ApiAuthProvider | null) => void>();
const clearApiAuthProviderSpy = vi.fn<() => void>();
const getCurrentUserSpy = vi.fn<() => Promise<AuthorizationResolveResponse>>();
const completeMyProfileSpy =
  vi.fn<(input: CompleteProfileInput) => Promise<AuthorizationResolveResponse>>();

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function makeApprovedResponse(
  overrides: Partial<{
    userId: string;
    auth0Subject: string;
    email: string;
    role: 'user' | 'admin';
    effectiveLevel: UserLevel;
    level: UserLevel | null;
  }> = {}
): AuthorizationResolveResponse {
  const role = overrides.role ?? 'user';
  const effectiveLevel = overrides.effectiveLevel ?? (role === 'admin' ? 10 : 1);
  const level = overrides.level ?? (role === 'admin' ? null : 1);
  const userId = overrides.userId ?? 'user-1';
  const email = overrides.email ?? 'angler@example.com';
  const auth0Subject = overrides.auth0Subject ?? 'auth0|user-1';

  return {
    state: 'approved' as const,
    user: {
      id: userId,
      email,
      firstName: 'River',
      lastName: 'Walker',
      mobileNumber: '+15550101000',
      role,
      status: 'approved' as const,
      level,
      effectiveLevel,
    },
    authorization: {
      userId,
      auth0Subject,
      email,
      role,
      status: 'approved' as const,
      effectiveLevel,
    },
  };
}

function makeProfileRequiredResponse() {
  return {
    state: 'profile_required' as const,
    user: null,
    requiredFields: ['firstName', 'lastName', 'mobileNumber'],
  } satisfies AuthorizationResolveResponse;
}

function makePendingResponse(): AuthorizationResolveResponse {
  return {
    state: 'pending' as const,
    user: {
      id: 'user-1',
      email: 'angler@example.com',
      firstName: 'River',
      lastName: 'Walker',
      mobileNumber: '+15550101000',
      role: 'user' as const,
      status: 'pending' as const,
      level: 1,
      effectiveLevel: 1,
    },
  };
}

function makeRejectedResponse(): AuthorizationResolveResponse {
  return {
    state: 'rejected' as const,
    user: {
      id: 'user-1',
      email: 'angler@example.com',
      firstName: 'River',
      lastName: 'Walker',
      mobileNumber: '+15550101000',
      role: 'user' as const,
      status: 'rejected' as const,
      level: 1,
      effectiveLevel: 1,
    },
  };
}

let currentAuth0State: Auth0StateForTests = {
  isLoading: false,
  isAuthenticated: false,
  user: undefined,
  loginWithRedirect: vi.fn(() => Promise.resolve()),
  logout: vi.fn(() => Promise.resolve()),
  getAccessTokenSilently: vi.fn(() => Promise.resolve('token-123')),
};

vi.mock('@auth0/auth0-react', () => ({
  Auth0Provider: (props: { children: ReactNode }): ReactElement => auth0ProviderSpy(props),
  useAuth0: (): Auth0StateForTests => useAuth0Spy(),
}));

vi.mock('../config.js', () => ({
  config: {
    auth0: {
      domain: 'fa.example.auth0.com',
      clientId: 'client-123',
      audience: 'https://api.fa.example.com',
    },
  },
}));

vi.mock('../services/apiClient.js', () => ({
  setApiAuthProvider: (provider: ApiAuthProvider | null) => {
    setApiAuthProviderSpy(provider);
  },
  clearApiAuthProvider: () => {
    clearApiAuthProviderSpy();
  },
}));

vi.mock('../services/userApi.js', () => ({
  getCurrentUser: () => getCurrentUserSpy(),
  completeMyProfile: (input: CompleteProfileInput) => completeMyProfileSpy(input),
}));

async function renderProvider(
  children: ReactNode = createElement('div', { id: 'child' }),
  props: { accountBootstrapEnabled?: boolean } = {}
) {
  const { FaAuthProvider } = (await import(authProviderModulePath)) as {
    FaAuthProvider: (props: {
      children: ReactNode;
      accountBootstrapEnabled?: boolean;
    }) => ReactElement;
  };

  return render(createElement(FaAuthProvider, { ...props, children }));
}

describe('FaAuthProvider', () => {
  beforeEach(() => {
    auth0ProviderSpy.mockClear();
    useAuth0Spy.mockReset();
    setApiAuthProviderSpy.mockReset();
    clearApiAuthProviderSpy.mockReset();
    getCurrentUserSpy.mockReset();
    completeMyProfileSpy.mockReset();
    window.history.replaceState(null, '', '/#/chat');
    window.sessionStorage.clear();

    currentAuth0State = {
      isLoading: false,
      isAuthenticated: false,
      user: undefined,
      loginWithRedirect: vi.fn(() => Promise.resolve()),
      logout: vi.fn(() => Promise.resolve()),
      getAccessTokenSilently: vi.fn(() => Promise.resolve('token-123')),
    };
    useAuth0Spy.mockImplementation(() => currentAuth0State);
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('passes browser-safe Auth0 config with the app callback route and localstorage cache', async () => {
    await renderProvider();

    expect(auth0ProviderSpy).toHaveBeenCalledTimes(1);
    expect(auth0ProviderSpy.mock.calls[0]?.[0]).toMatchObject({
      domain: 'fa.example.auth0.com',
      clientId: 'client-123',
      authorizationParams: {
        audience: 'https://api.fa.example.com',
        redirect_uri: `${window.location.origin}/app#/auth/callback`,
        scope: 'openid profile email',
      },
      cacheLocation: 'localstorage',
    });
  });

  it('starts Auth0 signup with Universal Login signup hints while preserving the return hash', async () => {
    const loginWithRedirect = vi.fn(() => Promise.resolve());
    currentAuth0State = {
      ...currentAuth0State,
      loginWithRedirect,
    };

    let authContext:
      | {
          login(
            returnTo?: string,
            options?: { screenHint?: 'signup'; prompt?: 'login' }
          ): Promise<void>;
        }
      | undefined;
    const { useFaAuth } = (await import('./useFaAuth.js')) as {
      useFaAuth: () => {
        login(
          returnTo?: string,
          options?: { screenHint?: 'signup'; prompt?: 'login' }
        ): Promise<void>;
      };
    };
    function CaptureAuth(): ReactElement {
      authContext = useFaAuth();
      return createElement('div');
    }

    await renderProvider(createElement(CaptureAuth));

    await authContext?.login('#/signup', { screenHint: 'signup', prompt: 'login' });

    expect(loginWithRedirect).toHaveBeenCalledWith({
      appState: {
        returnTo: '#/signup',
      },
      authorizationParams: {
        prompt: 'login',
        screen_hint: 'signup',
      },
    });
  });

  it.each([
    { appState: { returnTo: '/chat/c1' }, expectedHash: '#/chat/c1' },
    { appState: { returnTo: '#/admin/users' }, expectedHash: '#/admin/users' },
    { appState: undefined, expectedHash: '#/chat' },
  ])(
    'normalizes Auth0 callback returnTo values to hash routes',
    async ({ appState, expectedHash }) => {
      await renderProvider();

      const props = auth0ProviderSpy.mock.calls[0]?.[0] as
        | { onRedirectCallback?: (appState?: unknown) => void }
        | undefined;
      const onRedirectCallback = props?.onRedirectCallback;
      if (onRedirectCallback === undefined) {
        throw new Error('Expected Auth0 onRedirectCallback prop.');
      }

      act(() => {
        onRedirectCallback(appState);
      });

      expect(window.location.hash).toBe(expectedHash);
    }
  );

  it('removes Auth0 code and state from the URL after redirect callback', async () => {
    window.history.replaceState(null, '', '/app?code=auth-code&state=auth-state#/auth/callback');
    await renderProvider();

    const props = auth0ProviderSpy.mock.calls[0]?.[0] as
      | { onRedirectCallback?: (appState?: unknown) => void }
      | undefined;
    const onRedirectCallback = props?.onRedirectCallback;
    if (onRedirectCallback === undefined) {
      throw new Error('Expected Auth0 onRedirectCallback prop.');
    }

    act(() => {
      onRedirectCallback({ returnTo: '#/chat/c1' });
    });

    expect(window.location.pathname).toBe('/app');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#/chat/c1');
    expect(window.location.href).toBe('http://localhost:3000/app#/chat/c1');
  });

  it.each([
    {
      label: 'Auth0 is still loading',
      auth0State: {
        isLoading: true,
        isAuthenticated: false,
        user: undefined,
      },
    },
    {
      label: 'the user is unauthenticated',
      auth0State: {
        isLoading: false,
        isAuthenticated: false,
        user: undefined,
      },
    },
  ])('does not call /me while %s', async ({ auth0State }) => {
    currentAuth0State = {
      ...currentAuth0State,
      ...auth0State,
    };

    await renderProvider();

    expect(getCurrentUserSpy).not.toHaveBeenCalled();
    expect(setApiAuthProviderSpy).not.toHaveBeenCalled();
  });

  it('does not install API auth or call /me when account bootstrap is disabled', async () => {
    currentAuth0State = {
      ...currentAuth0State,
      isAuthenticated: true,
      user: { sub: 'auth0|user-1' },
    };

    await renderProvider(undefined, { accountBootstrapEnabled: false });

    expect(getCurrentUserSpy).not.toHaveBeenCalled();
    expect(setApiAuthProviderSpy).not.toHaveBeenCalled();
  });

  it('installs the API auth provider before loading the current account state', async () => {
    const callOrder: string[] = [];
    const getAccessTokenSilently = vi.fn((options?: { cacheMode?: string }) =>
      Promise.resolve(options?.cacheMode === 'off' ? 'token-refresh' : 'token-default')
    );
    currentAuth0State = {
      ...currentAuth0State,
      isAuthenticated: true,
      user: { sub: 'auth0|user-1' },
      getAccessTokenSilently,
    };
    setApiAuthProviderSpy.mockImplementation((provider: ApiAuthProvider | null) => {
      if (provider !== null) {
        callOrder.push('set');
      }
    });
    getCurrentUserSpy.mockImplementation(() => {
      callOrder.push('me');
      return Promise.resolve(makeApprovedResponse());
    });

    let authContext:
      | {
          accountState: { status: string };
        }
      | undefined;
    const { useFaAuth } = (await import('./useFaAuth.js')) as {
      useFaAuth: () => {
        accountState: { status: string };
        getAccessToken(): Promise<string>;
        refreshAccessToken(): Promise<string>;
      };
    };
    function CaptureAuth(): ReactElement {
      authContext = useFaAuth();
      return createElement('div');
    }

    await renderProvider(createElement(CaptureAuth));

    await waitFor(() => {
      expect(authContext?.accountState.status).toBe('approved');
    });

    const provider = setApiAuthProviderSpy.mock.calls[0]?.[0];
    if (provider === undefined || provider === null) {
      throw new Error('Expected API auth provider to be installed.');
    }

    expect(await provider.getAccessToken()).toBe('token-default');
    expect(await provider.refreshAccessToken()).toBe('token-refresh');
    expect(callOrder.slice(0, 2)).toEqual(['set', 'me']);
  });

  it('clears the installed API auth provider when the authenticated provider unmounts', async () => {
    currentAuth0State = {
      ...currentAuth0State,
      isAuthenticated: true,
      user: { sub: 'auth0|user-1' },
    };
    getCurrentUserSpy.mockResolvedValueOnce(makeApprovedResponse());

    const view = await renderProvider();

    await waitFor(() => {
      expect(setApiAuthProviderSpy).toHaveBeenCalledTimes(1);
    });

    view.unmount();

    expect(clearApiAuthProviderSpy).toHaveBeenCalled();
  });

  it('updates account state when profile completion succeeds', async () => {
    currentAuth0State = {
      ...currentAuth0State,
      isAuthenticated: true,
      user: { sub: 'auth0|user-1' },
    };
    getCurrentUserSpy.mockResolvedValueOnce(makeProfileRequiredResponse());
    completeMyProfileSpy.mockResolvedValueOnce(makePendingResponse());

    let authContext:
      | {
          accountState: { status: string };
          completeProfile(input: {
            firstName: string;
            lastName: string;
            mobileNumber: string;
          }): Promise<void>;
        }
      | undefined;
    const { useFaAuth } = (await import('./useFaAuth.js')) as {
      useFaAuth: () => {
        accountState: { status: string };
        completeProfile(input: {
          firstName: string;
          lastName: string;
          mobileNumber: string;
        }): Promise<void>;
      };
    };
    function CaptureAuth(): ReactElement {
      authContext = useFaAuth();
      return createElement('div');
    }

    await renderProvider(createElement(CaptureAuth));

    await waitFor(() => {
      expect(authContext?.accountState.status).toBe('profile_required');
    });

    await authContext?.completeProfile({
      firstName: 'River',
      lastName: 'Walker',
      mobileNumber: '+15550101000',
    });

    expect(completeMyProfileSpy).toHaveBeenCalledWith({
      firstName: 'River',
      lastName: 'Walker',
      mobileNumber: '+15550101000',
    });
    await waitFor(() => {
      expect(authContext?.accountState.status).toBe('pending');
    });
  });

  it('sets a coarse account error when profile completion fails', async () => {
    currentAuth0State = {
      ...currentAuth0State,
      isAuthenticated: true,
      user: { sub: 'auth0|user-1' },
    };
    getCurrentUserSpy.mockResolvedValueOnce(makeProfileRequiredResponse());
    completeMyProfileSpy.mockRejectedValueOnce(new Error('profile service down'));

    let authContext:
      | {
          accountState: { status: string; message?: string };
          completeProfile(input: {
            firstName: string;
            lastName: string;
            mobileNumber: string;
          }): Promise<void>;
        }
      | undefined;
    const { useFaAuth } = (await import('./useFaAuth.js')) as {
      useFaAuth: () => {
        accountState: { status: string; message?: string };
        completeProfile(input: {
          firstName: string;
          lastName: string;
          mobileNumber: string;
        }): Promise<void>;
      };
    };
    function CaptureAuth(): ReactElement {
      authContext = useFaAuth();
      return createElement('div');
    }

    await renderProvider(createElement(CaptureAuth));

    await waitFor(() => {
      expect(authContext?.accountState.status).toBe('profile_required');
    });

    await authContext?.completeProfile({
      firstName: 'River',
      lastName: 'Walker',
      mobileNumber: '+15550101000',
    });

    await waitFor(() => {
      expect(authContext?.accountState).toMatchObject({
        status: 'error',
        message: 'Unable to verify your account. Please try again.',
      });
    });
  });

  it('keeps profile completion unauthenticated when bootstrap is disabled', async () => {
    currentAuth0State = {
      ...currentAuth0State,
      isAuthenticated: true,
      user: { sub: 'auth0|user-1' },
    };

    let authContext:
      | {
          accountState: { status: string };
          completeProfile(input: {
            firstName: string;
            lastName: string;
            mobileNumber: string;
          }): Promise<void>;
        }
      | undefined;
    const { useFaAuth } = (await import('./useFaAuth.js')) as {
      useFaAuth: () => {
        accountState: { status: string };
        completeProfile(input: {
          firstName: string;
          lastName: string;
          mobileNumber: string;
        }): Promise<void>;
      };
    };
    function CaptureAuth(): ReactElement {
      authContext = useFaAuth();
      return createElement('div');
    }

    await renderProvider(createElement(CaptureAuth), { accountBootstrapEnabled: false });
    await authContext?.completeProfile({
      firstName: 'River',
      lastName: 'Walker',
      mobileNumber: '+15550101000',
    });

    expect(completeMyProfileSpy).not.toHaveBeenCalled();
    expect(authContext?.accountState.status).toBe('unauthenticated');
  });

  it('maps rejected current-user responses without authorization data', async () => {
    currentAuth0State = {
      ...currentAuth0State,
      isAuthenticated: true,
      user: { sub: 'auth0|user-1' },
    };
    getCurrentUserSpy.mockResolvedValueOnce(makeRejectedResponse());

    let authContext:
      | {
          accountState: { status: string };
          sessionKey: string;
        }
      | undefined;
    const { useFaAuth } = (await import('./useFaAuth.js')) as {
      useFaAuth: () => {
        accountState: { status: string };
        sessionKey: string;
      };
    };
    function CaptureAuth(): ReactElement {
      authContext = useFaAuth();
      return createElement('div');
    }

    await renderProvider(createElement(CaptureAuth));

    await waitFor(() => {
      expect(authContext?.accountState.status).toBe('rejected');
      expect(authContext?.sessionKey).toBe('auth:auth0|user-1:account');
    });
  });

  it('ignores stale profile completion results from an older authenticated subject', async () => {
    currentAuth0State = {
      ...currentAuth0State,
      isAuthenticated: true,
      user: { sub: 'auth0|user-1' },
    };
    const completeProfileDeferred = createDeferred<ReturnType<typeof makePendingResponse>>();
    getCurrentUserSpy.mockResolvedValueOnce(makeProfileRequiredResponse()).mockResolvedValueOnce(
      makeApprovedResponse({
        userId: 'user-2',
        auth0Subject: 'auth0|user-2',
        email: 'second@example.com',
      })
    );
    completeMyProfileSpy.mockImplementationOnce(() => completeProfileDeferred.promise);

    let authContext:
      | {
          accountState:
            | { status: string }
            | {
                status: 'approved';
                authorization: {
                  userId: string;
                  auth0Subject: string;
                };
              };
          completeProfile(input: {
            firstName: string;
            lastName: string;
            mobileNumber: string;
          }): Promise<void>;
        }
      | undefined;
    const { useFaAuth } = (await import('./useFaAuth.js')) as {
      useFaAuth: () => {
        accountState:
          | { status: string }
          | {
              status: 'approved';
              authorization: {
                userId: string;
                auth0Subject: string;
              };
            };
        completeProfile(input: {
          firstName: string;
          lastName: string;
          mobileNumber: string;
        }): Promise<void>;
      };
    };
    function CaptureAuth(): ReactElement {
      authContext = useFaAuth();
      return createElement('div');
    }

    const view = await renderProvider(createElement(CaptureAuth));
    const { FaAuthProvider } = (await import(authProviderModulePath)) as {
      FaAuthProvider: (props: { children: ReactNode }) => ReactElement;
    };

    await waitFor(() => {
      expect(authContext?.accountState.status).toBe('profile_required');
    });

    let completionPromise: Promise<void> | undefined;
    act(() => {
      completionPromise = authContext?.completeProfile({
        firstName: 'River',
        lastName: 'Walker',
        mobileNumber: '+15550101000',
      });
    });
    if (completionPromise === undefined) {
      throw new Error('Expected completeProfile to return a promise.');
    }

    currentAuth0State = {
      ...currentAuth0State,
      user: { sub: 'auth0|user-2' },
    };
    view.rerender(createElement(FaAuthProvider, { children: createElement(CaptureAuth) }));

    await waitFor(() => {
      expect(getCurrentUserSpy).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(authContext?.accountState).toMatchObject({
        status: 'approved',
        authorization: {
          userId: 'user-2',
          auth0Subject: 'auth0|user-2',
        },
      });
    });

    await act(() => {
      completeProfileDeferred.resolve(makePendingResponse());
      return completionPromise;
    });

    expect(authContext?.accountState).toMatchObject({
      status: 'approved',
      authorization: {
        userId: 'user-2',
        auth0Subject: 'auth0|user-2',
      },
    });
  });

  it('sets a coarse account error when current-user resolution fails and refreshes on demand', async () => {
    currentAuth0State = {
      ...currentAuth0State,
      isAuthenticated: true,
      user: { sub: 'auth0|user-1' },
    };
    getCurrentUserSpy
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(makeApprovedResponse());

    let authContext:
      | {
          accountState: { status: string; message?: string };
          refreshCurrentUser(): Promise<void>;
        }
      | undefined;
    const { useFaAuth } = (await import('./useFaAuth.js')) as {
      useFaAuth: () => {
        accountState: { status: string; message?: string };
        refreshCurrentUser(): Promise<void>;
      };
    };
    function CaptureAuth(): ReactElement {
      authContext = useFaAuth();
      return createElement('div');
    }

    await renderProvider(createElement(CaptureAuth));

    await waitFor(() => {
      expect(authContext?.accountState).toMatchObject({
        status: 'error',
        message: 'Unable to verify your account. Please try again.',
      });
    });

    await authContext?.refreshCurrentUser();

    await waitFor(() => {
      expect(authContext?.accountState.status).toBe('approved');
    });
  });

  it('changes sessionKey when the approved FA user id changes', async () => {
    currentAuth0State = {
      ...currentAuth0State,
      isAuthenticated: true,
      user: { sub: 'auth0|user-1' },
    };
    getCurrentUserSpy
      .mockResolvedValueOnce(makeApprovedResponse({ userId: 'user-1' }))
      .mockResolvedValueOnce(makeApprovedResponse({ userId: 'user-2' }));

    let authContext:
      | {
          sessionKey: string;
          refreshCurrentUser(): Promise<void>;
        }
      | undefined;
    const { useFaAuth } = (await import('./useFaAuth.js')) as {
      useFaAuth: () => {
        sessionKey: string;
        refreshCurrentUser(): Promise<void>;
      };
    };
    function CaptureAuth(): ReactElement {
      authContext = useFaAuth();
      return createElement('div');
    }

    await renderProvider(createElement(CaptureAuth));

    await waitFor(() => {
      expect(authContext?.sessionKey).toBeTruthy();
    });
    const firstSessionKey = authContext?.sessionKey;

    await authContext?.refreshCurrentUser();

    await waitFor(() => {
      expect(authContext?.sessionKey).not.toBe(firstSessionKey);
    });
  });

  it('ignores stale current-user responses from an older authenticated subject', async () => {
    currentAuth0State = {
      ...currentAuth0State,
      isAuthenticated: true,
      user: { sub: 'auth0|user-1' },
    };
    const firstRequest = createDeferred<ReturnType<typeof makeApprovedResponse>>();
    const secondRequest = createDeferred<ReturnType<typeof makeApprovedResponse>>();
    getCurrentUserSpy
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);

    let authContext:
      | {
          accountState:
            | { status: string }
            | {
                status: 'approved';
                authorization: {
                  userId: string;
                  auth0Subject: string;
                };
              };
          sessionKey: string;
        }
      | undefined;
    const { useFaAuth } = (await import('./useFaAuth.js')) as {
      useFaAuth: () => {
        accountState:
          | { status: string }
          | {
              status: 'approved';
              authorization: {
                userId: string;
                auth0Subject: string;
              };
            };
        sessionKey: string;
      };
    };
    function CaptureAuth(): ReactElement {
      authContext = useFaAuth();
      return createElement('div');
    }

    const view = await renderProvider(createElement(CaptureAuth));
    const { FaAuthProvider } = (await import(authProviderModulePath)) as {
      FaAuthProvider: (props: { children: ReactNode }) => ReactElement;
    };

    await waitFor(() => {
      expect(getCurrentUserSpy).toHaveBeenCalledTimes(1);
    });

    currentAuth0State = {
      ...currentAuth0State,
      user: { sub: 'auth0|user-2' },
    };
    view.rerender(createElement(FaAuthProvider, { children: createElement(CaptureAuth) }));

    await waitFor(() => {
      expect(getCurrentUserSpy).toHaveBeenCalledTimes(2);
    });

    await act(() => {
      secondRequest.resolve(
        makeApprovedResponse({
          userId: 'user-2',
          auth0Subject: 'auth0|user-2',
          email: 'second@example.com',
        })
      );
      return secondRequest.promise;
    });

    await waitFor(() => {
      expect(authContext?.accountState).toMatchObject({
        status: 'approved',
        authorization: {
          userId: 'user-2',
          auth0Subject: 'auth0|user-2',
        },
      });
      expect(authContext?.sessionKey).toBe('auth:auth0|user-2:user-2');
    });

    await act(() => {
      firstRequest.resolve(
        makeApprovedResponse({ userId: 'user-1', auth0Subject: 'auth0|user-1' })
      );
      return firstRequest.promise;
    });

    expect(authContext?.accountState).toMatchObject({
      status: 'approved',
      authorization: {
        userId: 'user-2',
        auth0Subject: 'auth0|user-2',
      },
    });
    expect(authContext?.sessionKey).toBe('auth:auth0|user-2:user-2');
  });

  it('ignores stale current-user refresh results after logout', async () => {
    currentAuth0State = {
      ...currentAuth0State,
      isAuthenticated: true,
      user: { sub: 'auth0|user-1' },
    };
    const staleRefresh = createDeferred<ReturnType<typeof makeApprovedResponse>>();
    getCurrentUserSpy
      .mockResolvedValueOnce(
        makeApprovedResponse({ userId: 'user-1', auth0Subject: 'auth0|user-1' })
      )
      .mockImplementationOnce(() => staleRefresh.promise);

    let authContext:
      | {
          accountState:
            | { status: string }
            | {
                status: 'approved';
                authorization: {
                  userId: string;
                  auth0Subject: string;
                };
              };
          sessionKey: string;
          logout(): Promise<void>;
          refreshCurrentUser(): Promise<void>;
        }
      | undefined;
    const { useFaAuth } = (await import('./useFaAuth.js')) as {
      useFaAuth: () => {
        accountState:
          | { status: string }
          | {
              status: 'approved';
              authorization: {
                userId: string;
                auth0Subject: string;
              };
            };
        sessionKey: string;
        logout(): Promise<void>;
        refreshCurrentUser(): Promise<void>;
      };
    };
    function CaptureAuth(): ReactElement {
      authContext = useFaAuth();
      return createElement('div');
    }

    const view = await renderProvider(createElement(CaptureAuth));
    const { FaAuthProvider } = (await import(authProviderModulePath)) as {
      FaAuthProvider: (props: { children: ReactNode }) => ReactElement;
    };

    await waitFor(() => {
      expect(authContext?.accountState).toMatchObject({
        status: 'approved',
        authorization: {
          userId: 'user-1',
          auth0Subject: 'auth0|user-1',
        },
      });
    });

    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = authContext?.refreshCurrentUser();
    });
    if (refreshPromise === undefined) {
      throw new Error('Expected refreshCurrentUser to return a promise.');
    }

    await waitFor(() => {
      expect(authContext?.accountState.status).toBe('loading');
    });

    await act(async () => {
      await authContext?.logout();
    });

    currentAuth0State = {
      ...currentAuth0State,
      isAuthenticated: false,
      user: undefined,
    };
    view.rerender(createElement(FaAuthProvider, { children: createElement(CaptureAuth) }));

    await waitFor(() => {
      expect(authContext?.accountState.status).toBe('unauthenticated');
      expect(authContext?.sessionKey).toBe('anon:1');
    });

    await act(() => {
      staleRefresh.resolve(
        makeApprovedResponse({ userId: 'user-2', auth0Subject: 'auth0|user-2' })
      );
      return refreshPromise;
    });

    expect(authContext?.accountState.status).toBe('unauthenticated');
    expect(authContext?.sessionKey).toBe('anon:1');
  });

  it('ignores stale overlapping manual refreshes for the same authenticated subject', async () => {
    currentAuth0State = {
      ...currentAuth0State,
      isAuthenticated: true,
      user: { sub: 'auth0|user-1' },
    };
    const firstRefresh = createDeferred<ReturnType<typeof makeApprovedResponse>>();
    const secondRefresh = createDeferred<ReturnType<typeof makeApprovedResponse>>();
    getCurrentUserSpy
      .mockResolvedValueOnce(makeApprovedResponse({ effectiveLevel: 1, level: 1 }))
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => secondRefresh.promise);

    let authContext:
      | {
          accountState:
            | { status: string }
            | {
                status: 'approved';
                authorization: {
                  effectiveLevel: number;
                };
              };
          refreshCurrentUser(): Promise<void>;
        }
      | undefined;
    const { useFaAuth } = (await import('./useFaAuth.js')) as {
      useFaAuth: () => {
        accountState:
          | { status: string }
          | {
              status: 'approved';
              authorization: {
                effectiveLevel: number;
              };
            };
        refreshCurrentUser(): Promise<void>;
      };
    };
    function CaptureAuth(): ReactElement {
      authContext = useFaAuth();
      return createElement('div');
    }

    await renderProvider(createElement(CaptureAuth));

    await waitFor(() => {
      expect(authContext?.accountState).toMatchObject({
        status: 'approved',
        authorization: {
          effectiveLevel: 1,
        },
      });
    });

    let firstRefreshPromise: Promise<void> | undefined;
    let secondRefreshPromise: Promise<void> | undefined;
    act(() => {
      firstRefreshPromise = authContext?.refreshCurrentUser();
      secondRefreshPromise = authContext?.refreshCurrentUser();
    });
    if (firstRefreshPromise === undefined || secondRefreshPromise === undefined) {
      throw new Error('Expected refreshCurrentUser to return promises.');
    }

    await act(() => {
      secondRefresh.resolve(makeApprovedResponse({ effectiveLevel: 7, level: 7 }));
      return secondRefreshPromise;
    });

    await waitFor(() => {
      expect(authContext?.accountState).toMatchObject({
        status: 'approved',
        authorization: {
          effectiveLevel: 7,
        },
      });
    });

    await act(() => {
      firstRefresh.resolve(makeApprovedResponse({ effectiveLevel: 2, level: 2 }));
      return firstRefreshPromise;
    });

    expect(authContext?.accountState).toMatchObject({
      status: 'approved',
      authorization: {
        effectiveLevel: 7,
      },
    });
  });

  it('does not expose the previous approved account while a new authenticated subject is resolving', async () => {
    currentAuth0State = {
      ...currentAuth0State,
      isAuthenticated: true,
      user: { sub: 'auth0|user-1' },
    };
    const nextSubjectRequest = createDeferred<ReturnType<typeof makeApprovedResponse>>();
    getCurrentUserSpy
      .mockResolvedValueOnce(
        makeApprovedResponse({ userId: 'user-1', auth0Subject: 'auth0|user-1' })
      )
      .mockImplementationOnce(() => nextSubjectRequest.promise);

    const renderSnapshots: { sessionKey: string; status: string }[] = [];
    let authContext:
      | {
          accountState: { status: string };
          sessionKey: string;
        }
      | undefined;
    const { useFaAuth } = (await import('./useFaAuth.js')) as {
      useFaAuth: () => {
        accountState: { status: string };
        sessionKey: string;
      };
    };
    function CaptureAuth(): ReactElement {
      authContext = useFaAuth();
      renderSnapshots.push({
        sessionKey: authContext.sessionKey,
        status: authContext.accountState.status,
      });
      return createElement('div');
    }

    const view = await renderProvider(createElement(CaptureAuth));
    const { FaAuthProvider } = (await import(authProviderModulePath)) as {
      FaAuthProvider: (props: { children: ReactNode }) => ReactElement;
    };

    await waitFor(() => {
      expect(authContext?.accountState.status).toBe('approved');
    });

    currentAuth0State = {
      ...currentAuth0State,
      user: { sub: 'auth0|user-2' },
    };
    view.rerender(createElement(FaAuthProvider, { children: createElement(CaptureAuth) }));

    await waitFor(() => {
      expect(getCurrentUserSpy).toHaveBeenCalledTimes(2);
      expect(authContext?.accountState.status).toBe('loading');
    });

    expect(
      renderSnapshots.some(
        (snapshot) =>
          snapshot.sessionKey.startsWith('auth:auth0|user-2') && snapshot.status === 'approved'
      )
    ).toBe(false);

    await act(() => {
      nextSubjectRequest.resolve(
        makeApprovedResponse({
          userId: 'user-2',
          auth0Subject: 'auth0|user-2',
          email: 'second@example.com',
        })
      );
      return nextSubjectRequest.promise;
    });

    await waitFor(() => {
      expect(authContext?.accountState.status).toBe('approved');
      expect(authContext?.sessionKey).toBe('auth:auth0|user-2:user-2');
    });
  });

  it('moves to the public Home route before starting Auth0 logout', async () => {
    const logoutStartLocations: string[] = [];
    const logout = vi.fn(() => {
      logoutStartLocations.push(`${window.location.pathname}${window.location.hash}`);
      return Promise.resolve();
    });
    currentAuth0State = {
      ...currentAuth0State,
      isAuthenticated: true,
      user: { sub: 'auth0|admin' },
      logout,
    };

    let authContext:
      | {
          logout(): Promise<void>;
        }
      | undefined;
    const { useFaAuth } = (await import('./useFaAuth.js')) as {
      useFaAuth: () => { logout(): Promise<void> };
    };
    function CaptureAuth(): ReactElement {
      authContext = useFaAuth();
      return createElement('div');
    }

    window.history.replaceState(null, '', '/app#/chat');
    await renderProvider(createElement(CaptureAuth));

    await waitFor(() => {
      expect(setApiAuthProviderSpy).toHaveBeenCalled();
    });

    await authContext?.logout();

    expect(window.sessionStorage.getItem('fa.force_login_after_logout')).toBe('1');
    expect(logoutStartLocations).toEqual(['/#/home']);
    expect(logout).toHaveBeenCalledWith({
      logoutParams: {
        returnTo: `${window.location.origin}/#/home`,
      },
    });
  });
});
