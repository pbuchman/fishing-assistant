import type { ReactElement, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import type { AuthorizationResolveResponse } from '@fa/http-contracts';

import { config } from '../config.js';
import { clearApiAuthProvider, setApiAuthProvider } from '../services/apiClient.js';
import { completeMyProfile, getCurrentUser } from '../services/userApi.js';
import { markLoginPromptAfterLogout } from './logoutIntent.js';
import { FaAuthContext, type FaAuthAccountState, type FaLoginOptions } from './useFaAuth.js';

export interface FaAuthProviderProps {
  children: ReactNode;
  accountBootstrapEnabled?: boolean;
}

function normalizeReturnHash(returnTo: string | undefined): string {
  if (typeof returnTo !== 'string' || returnTo.length === 0) {
    return '#/chat';
  }

  if (returnTo.startsWith('#')) {
    return returnTo;
  }

  const normalizedPath = returnTo.startsWith('/') ? returnTo : `/${returnTo}`;
  return `#${normalizedPath}`;
}

function replaceAuthRedirectUrl(returnTo: string | undefined): void {
  const targetHash = normalizeReturnHash(returnTo);
  window.history.replaceState(null, '', `/app${targetHash}`);
  window.dispatchEvent(new Event('hashchange'));
}

function replaceWithPublicHomeRoute(): void {
  window.history.replaceState(null, '', '/#/home');
  window.dispatchEvent(new Event('hashchange'));
}

const coarseAccountErrorMessage = 'Unable to verify your account. Please try again.';

interface AccountStateSnapshot {
  sessionMarker: string;
  accountState: FaAuthAccountState;
}

interface AccountRequestControl {
  sessionMarker: string;
  sessionVersion: number;
  latestRequestId: number;
}

interface AccountRequestToken {
  sessionMarker: string;
  sessionVersion: number;
  requestId: number;
}

function mapAccountState(response: AuthorizationResolveResponse): FaAuthAccountState {
  switch (response.state) {
    case 'profile_required':
      return { status: 'profile_required', account: response };
    case 'pending':
      return { status: 'pending', account: response };
    case 'rejected':
      return { status: 'rejected', account: response };
    case 'suspended':
      return { status: 'suspended', account: response };
    case 'approved':
      return {
        status: 'approved',
        account: response,
        authorization: response.authorization,
      };
  }
}

function FaAuthContextProvider({
  children,
  accountBootstrapEnabled = true,
}: FaAuthProviderProps): ReactElement {
  const {
    isLoading,
    isAuthenticated,
    user,
    loginWithRedirect,
    logout: auth0Logout,
    getAccessTokenSilently,
  } = useAuth0();
  const [logoutVersion, setLogoutVersion] = useState(0);
  const [logoutInProgress, setLogoutInProgress] = useState(false);
  const currentSessionMarker = isAuthenticated
    ? `auth-session:${String(logoutVersion)}:${user?.sub ?? 'unknown'}`
    : `anon:${String(logoutVersion)}`;
  const currentBootstrapMarker = `${currentSessionMarker}:${
    accountBootstrapEnabled ? 'protected' : 'public'
  }`;
  const [accountSnapshot, setAccountSnapshot] = useState<AccountStateSnapshot>(() => ({
    sessionMarker: currentBootstrapMarker,
    accountState: isLoading ? { status: 'loading' } : { status: 'unauthenticated' },
  }));
  const requestControlRef = useRef<AccountRequestControl>({
    sessionMarker: currentBootstrapMarker,
    sessionVersion: 0,
    latestRequestId: 0,
  });

  if (requestControlRef.current.sessionMarker !== currentBootstrapMarker) {
    requestControlRef.current = {
      sessionMarker: currentBootstrapMarker,
      sessionVersion: requestControlRef.current.sessionVersion + 1,
      latestRequestId: 0,
    };
  }

  const setSnapshotForSession = useCallback(
    (sessionMarker: string, nextAccountState: FaAuthAccountState): void => {
      setAccountSnapshot({
        sessionMarker,
        accountState: nextAccountState,
      });
    },
    []
  );

  const invalidateSession = useCallback((nextSessionMarker: string): void => {
    requestControlRef.current = {
      sessionMarker: nextSessionMarker,
      sessionVersion: requestControlRef.current.sessionVersion + 1,
      latestRequestId: 0,
    };
  }, []);

  const beginAccountRequest = useCallback((sessionMarker: string): AccountRequestToken => {
    const currentControl = requestControlRef.current;
    const requestId = currentControl.latestRequestId + 1;
    requestControlRef.current = {
      ...currentControl,
      latestRequestId: requestId,
    };

    return {
      sessionMarker,
      sessionVersion: currentControl.sessionVersion,
      requestId,
    };
  }, []);

  const commitAccountRequest = useCallback(
    (requestToken: AccountRequestToken, nextAccountState: FaAuthAccountState): boolean => {
      const currentControl = requestControlRef.current;
      if (
        currentControl.sessionVersion !== requestToken.sessionVersion ||
        currentControl.latestRequestId !== requestToken.requestId
      ) {
        return false;
      }

      setSnapshotForSession(requestToken.sessionMarker, nextAccountState);
      return true;
    },
    [setSnapshotForSession]
  );

  const getAccessToken = useCallback(async (): Promise<string> => {
    return await getAccessTokenSilently();
  }, [getAccessTokenSilently]);

  const refreshAccessToken = useCallback(async (): Promise<string> => {
    return await getAccessTokenSilently({ cacheMode: 'off' });
  }, [getAccessTokenSilently]);

  const login = useCallback(
    async (returnTo?: string, options?: FaLoginOptions): Promise<void> => {
      await loginWithRedirect({
        appState: {
          returnTo: normalizeReturnHash(returnTo),
        },
        ...(options === undefined
          ? {}
          : {
              authorizationParams: {
                ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
                ...(options.screenHint === undefined ? {} : { screen_hint: options.screenHint }),
              },
            }),
      });
    },
    [loginWithRedirect]
  );

  const logout = useCallback(async (): Promise<void> => {
    setLogoutInProgress(true);
    replaceWithPublicHomeRoute();
    clearApiAuthProvider();
    markLoginPromptAfterLogout();
    setLogoutVersion((current) => {
      const nextLogoutVersion = current + 1;
      const nextBootstrapMarker = `anon:${String(nextLogoutVersion)}:${
        accountBootstrapEnabled ? 'protected' : 'public'
      }`;
      invalidateSession(nextBootstrapMarker);
      setSnapshotForSession(nextBootstrapMarker, { status: 'unauthenticated' });
      return nextLogoutVersion;
    });
    try {
      await auth0Logout({
        logoutParams: {
          returnTo: `${window.location.origin}/#/home`,
        },
      });
    } finally {
      setLogoutInProgress(false);
    }
  }, [accountBootstrapEnabled, auth0Logout, invalidateSession, setSnapshotForSession]);

  const refreshCurrentUser = useCallback(async (): Promise<void> => {
    if (!accountBootstrapEnabled || !isAuthenticated) {
      setSnapshotForSession(currentBootstrapMarker, { status: 'unauthenticated' });
      return;
    }

    const requestToken = beginAccountRequest(currentBootstrapMarker);
    setSnapshotForSession(currentBootstrapMarker, { status: 'loading' });

    try {
      const response = await getCurrentUser();
      commitAccountRequest(requestToken, mapAccountState(response));
    } catch {
      commitAccountRequest(requestToken, {
        status: 'error',
        message: coarseAccountErrorMessage,
      });
    }
  }, [
    accountBootstrapEnabled,
    beginAccountRequest,
    commitAccountRequest,
    currentBootstrapMarker,
    isAuthenticated,
    setSnapshotForSession,
  ]);

  const completeProfile = useCallback(
    async (input: { firstName: string; lastName: string; mobileNumber: string }): Promise<void> => {
      if (!accountBootstrapEnabled || !isAuthenticated) {
        setSnapshotForSession(currentBootstrapMarker, { status: 'unauthenticated' });
        return;
      }

      const requestToken = beginAccountRequest(currentBootstrapMarker);

      try {
        const response = await completeMyProfile(input);
        commitAccountRequest(requestToken, mapAccountState(response));
      } catch {
        commitAccountRequest(requestToken, {
          status: 'error',
          message: coarseAccountErrorMessage,
        });
      }
    },
    [
      accountBootstrapEnabled,
      beginAccountRequest,
      commitAccountRequest,
      currentBootstrapMarker,
      isAuthenticated,
      setSnapshotForSession,
    ]
  );

  useEffect(() => {
    if (isLoading) {
      setSnapshotForSession(currentBootstrapMarker, { status: 'loading' });
      return;
    }

    if (!accountBootstrapEnabled || !isAuthenticated) {
      clearApiAuthProvider();
      setSnapshotForSession(currentBootstrapMarker, { status: 'unauthenticated' });
      return;
    }

    setApiAuthProvider({
      getAccessToken,
      refreshAccessToken,
    });
    void refreshCurrentUser();

    return () => {
      clearApiAuthProvider();
    };
  }, [
    accountBootstrapEnabled,
    currentBootstrapMarker,
    getAccessToken,
    isAuthenticated,
    isLoading,
    refreshAccessToken,
    refreshCurrentUser,
  ]);

  const accountState = isLoading
    ? ({ status: 'loading' } satisfies FaAuthAccountState)
    : !accountBootstrapEnabled || !isAuthenticated
      ? ({ status: 'unauthenticated' } satisfies FaAuthAccountState)
      : accountSnapshot.sessionMarker !== currentBootstrapMarker
        ? ({ status: 'loading' } satisfies FaAuthAccountState)
        : accountSnapshot.accountState;

  const value = useMemo(() => {
    const approvedUserId =
      accountState.status === 'approved' ? accountState.authorization.userId : 'account';

    return {
      accountState,
      isLoading,
      isAuthenticated,
      isLogoutInProgress: logoutInProgress,
      sessionKey: isAuthenticated
        ? `auth:${user?.sub ?? 'unknown'}:${approvedUserId}`
        : `anon:${String(logoutVersion)}`,
      login,
      logout,
      refreshCurrentUser,
      completeProfile,
      getAccessToken,
      refreshAccessToken,
    };
  }, [
    accountState,
    completeProfile,
    getAccessToken,
    isAuthenticated,
    isLoading,
    login,
    logout,
    logoutInProgress,
    logoutVersion,
    refreshCurrentUser,
    refreshAccessToken,
    user?.sub,
  ]);

  return <FaAuthContext.Provider value={value}>{children}</FaAuthContext.Provider>;
}

export function FaAuthProvider({
  children,
  accountBootstrapEnabled = true,
}: FaAuthProviderProps): ReactElement {
  return (
    <Auth0Provider
      domain={config.auth0.domain ?? ''}
      clientId={config.auth0.clientId ?? ''}
      authorizationParams={{
        audience: config.auth0.audience,
        redirect_uri: `${window.location.origin}/app#/auth/callback`,
        scope: 'openid profile email',
      }}
      cacheLocation="localstorage"
      onRedirectCallback={(appState) => {
        replaceAuthRedirectUrl((appState as { returnTo?: string } | undefined)?.returnTo);
      }}
    >
      <FaAuthContextProvider accountBootstrapEnabled={accountBootstrapEnabled}>
        {children}
      </FaAuthContextProvider>
    </Auth0Provider>
  );
}
