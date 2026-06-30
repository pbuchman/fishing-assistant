import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

import { AdminShell } from './admin/AdminShell.js';
import { AuthErrorPage } from './auth/AccountStatusPages.js';
import { FaAuthProvider } from './auth/AuthProvider.js';
import { UserBootstrapGate } from './auth/UserBootstrapGate.js';
import { consumeLoginPromptAfterLogout } from './auth/logoutIntent.js';
import { useFaAuth } from './auth/useFaAuth.js';
import { HomePage } from './home/index.js';
import { I18nProvider } from './i18n/I18nProvider.js';
import { LegalPage } from './legal/LegalPage.js';
import { isLegalRoutePath, legalDocumentByRoute } from './legal/legalDocuments.js';
import WorkspaceApp from './workspace/WorkspaceApp.js';

type AppSurface = 'home' | 'protected';

function isAppEntrypointPath(pathname: string): boolean {
  return pathname === '/app' || pathname.startsWith('/app/');
}

function defaultHashForPath(pathname: string): string {
  return isAppEntrypointPath(pathname) ? '#/chat' : '#/home';
}

function normalizeHash(hash: string, pathname = window.location.pathname): string {
  if (hash.trim().length === 0) {
    return defaultHashForPath(pathname);
  }

  if (hash.startsWith('#')) {
    return hash;
  }

  return `#${hash.replace(/^\/+/, '')}`;
}

function routeHashPath(hash: string): string {
  const queryIndex = hash.indexOf('?');
  return queryIndex === -1 ? hash : hash.slice(0, queryIndex);
}

function isAuthCallbackHash(hash: string): boolean {
  return routeHashPath(normalizeHash(hash, window.location.pathname)) === '#/auth/callback';
}

function stripStaleAuthSearch(hash: string, pathname: string, search: string): void {
  if (!isAppEntrypointPath(pathname) || isAuthCallbackHash(hash)) {
    return;
  }

  const searchParams = new URLSearchParams(search);
  if (!searchParams.has('code') || !searchParams.has('state')) {
    return;
  }

  const targetHash = normalizeHash(hash, pathname);
  window.history.replaceState(null, '', `${pathname}${targetHash}`);
}

function hasAuthCallbackError(routeHash: string): boolean {
  if (routeHashPath(routeHash) !== '#/auth/callback') {
    return false;
  }

  if (new URLSearchParams(window.location.search).has('error')) {
    return true;
  }

  const queryIndex = routeHash.indexOf('?');
  if (queryIndex === -1) {
    return false;
  }

  return new URLSearchParams(routeHash.slice(queryIndex + 1)).has('error');
}

function hasAuthCallbackPayload(routeHash: string): boolean {
  if (routeHashPath(routeHash) !== '#/auth/callback') {
    return false;
  }

  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has('code') && searchParams.has('state')) {
    return true;
  }

  const queryIndex = routeHash.indexOf('?');
  if (queryIndex === -1) {
    return false;
  }

  const hashParams = new URLSearchParams(routeHash.slice(queryIndex + 1));
  return hashParams.has('code') && hashParams.has('state');
}

function isProtectedHash(hash: string): boolean {
  const hashPath = routeHashPath(hash);

  return [
    /^#\/login$/,
    /^#\/signup$/,
    /^#\/auth\/callback$/,
    /^#\/profile$/,
    /^#\/pending$/,
    /^#\/rejected$/,
    /^#\/suspended$/,
    /^#\/not-allowed$/,
    /^#\/chat(?:\/.*)?$/,
    /^#\/usage$/,
    /^#\/admin(?:\/.*)?$/,
  ].some((pattern) => pattern.test(hashPath));
}

function appSurfaceFromHash(hash: string, pathname = window.location.pathname): AppSurface {
  if (isAppEntrypointPath(pathname)) {
    return 'protected';
  }

  return isProtectedHash(normalizeHash(hash, pathname)) ? 'protected' : 'home';
}

function useAppSurface(): { surface: AppSurface; hash: string } {
  const [state, setState] = useState<{ surface: AppSurface; hash: string }>(() => {
    stripStaleAuthSearch(window.location.hash, window.location.pathname, window.location.search);
    const hash = normalizeHash(window.location.hash, window.location.pathname);
    return {
      surface: appSurfaceFromHash(hash),
      hash,
    };
  });

  useEffect(() => {
    const syncState = (): void => {
      stripStaleAuthSearch(window.location.hash, window.location.pathname, window.location.search);
      const hash = normalizeHash(window.location.hash, window.location.pathname);
      setState({
        surface: appSurfaceFromHash(hash),
        hash,
      });
    };

    const handleHashChange = (): void => {
      if (window.location.hash === '') {
        window.history.replaceState(null, '', defaultHashForPath(window.location.pathname));
      }

      syncState();
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  return state;
}

function LoadingSurface({ message }: { message: string }): ReactElement {
  return (
    <main className="min-h-screen bg-[#10110f] px-6 py-6 text-sm text-[#ecece4]">{message}</main>
  );
}

function ProtectedSurface({ routeHash }: { routeHash: string }): ReactElement {
  const auth = useFaAuth();
  const { accountState, isAuthenticated, isLoading, isLogoutInProgress, sessionKey } = auth;
  const routePath = routeHashPath(routeHash);
  const isCallbackRoute = routePath === '#/auth/callback';
  const authCallbackError = hasAuthCallbackError(routeHash);
  const emptyAuthCallback =
    isCallbackRoute && !authCallbackError && !hasAuthCallbackPayload(routeHash);

  useEffect(() => {
    if (
      isLogoutInProgress ||
      isLoading ||
      isAuthenticated ||
      isCallbackRoute ||
      authCallbackError
    ) {
      return;
    }

    const forceInteractiveLogin = consumeLoginPromptAfterLogout();
    if (routePath === '#/signup') {
      void auth.login('#/signup', { prompt: 'login', screenHint: 'signup' });
      return;
    }

    const loginTarget = routePath === '#/login' ? '#/login' : routeHash;
    if (forceInteractiveLogin) {
      void auth.login(loginTarget, { prompt: 'login' });
      return;
    }

    void auth.login(loginTarget);
  }, [
    auth,
    authCallbackError,
    isAuthenticated,
    isCallbackRoute,
    isLoading,
    isLogoutInProgress,
    routeHash,
    routePath,
  ]);

  if (authCallbackError) {
    return (
      <AuthErrorPage
        message="Nie udało się rozpocząć logowania."
        onRetry={() => auth.login('#/login')}
      />
    );
  }

  if (emptyAuthCallback) {
    return (
      <AuthErrorPage
        title="Link logowania wygasł"
        message="Brakuje danych powrotu z logowania albo link wygasł. Rozpocznij logowanie ponownie, aby kontynuować."
        retryLabel="Zaloguj ponownie"
        homeLink
        onRetry={() => auth.login('#/login')}
      />
    );
  }

  if (isLogoutInProgress) {
    return <LoadingSurface message="Signing out..." />;
  }

  if (isLoading || accountState.status === 'loading' || isCallbackRoute) {
    return <LoadingSurface message="Loading workspace..." />;
  }

  if (!isAuthenticated || accountState.status === 'unauthenticated') {
    return <LoadingSurface message="Redirecting to sign in..." />;
  }

  return (
    <UserBootstrapGate key={sessionKey} routeHash={routeHash} adminChildren={<AdminShell />}>
      <WorkspaceApp
        role={
          accountState.status === 'approved' && accountState.authorization.role === 'admin'
            ? 'admin'
            : 'user'
        }
      />
    </UserBootstrapGate>
  );
}

function AppRouter({ surface, hash }: { surface: AppSurface; hash: string }): ReactElement {
  if (surface === 'home') {
    const hashPath = routeHashPath(hash);

    if (isLegalRoutePath(hashPath)) {
      const document = legalDocumentByRoute(hashPath);
      return document === null ? <HomePage /> : <LegalPage document={document} />;
    }

    return <HomePage />;
  }

  return <ProtectedSurface routeHash={hash} />;
}

export default function App(): ReactElement {
  const { surface, hash } = useAppSurface();

  return (
    <I18nProvider>
      <FaAuthProvider accountBootstrapEnabled={surface === 'protected'}>
        <AppRouter surface={surface} hash={hash} />
      </FaAuthProvider>
    </I18nProvider>
  );
}
