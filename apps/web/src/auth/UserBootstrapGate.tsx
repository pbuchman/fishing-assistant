import type { ReactElement, ReactNode } from 'react';
import { useEffect } from 'react';

import {
  AccountErrorPage,
  NotAllowedPage,
  NotFoundPage,
  PendingPage,
  RejectedPage,
  SuspendedPage,
  TemporaryAdminPlaceholder,
} from './AccountStatusPages.js';
import { ProfilePage } from '../profile/ProfilePage.js';
import { useFaAuth } from './useFaAuth.js';

export interface UserBootstrapGateProps {
  routeHash: string;
  children: ReactNode;
  adminChildren?: ReactNode;
}

function isChatRoute(routeHash: string): boolean {
  return /^#\/chat(?:\/[^/]+)?$/.test(routeHashPath(routeHash));
}

function isAdminRoute(routeHash: string): boolean {
  return /^#\/admin(?:\/.*)?$/.test(routeHashPath(routeHash));
}

function isUsageRoute(routeHash: string): boolean {
  return routeHashPath(routeHash) === '#/usage';
}

function isBlockedAccountStateRoute(routeHash: string): boolean {
  return ['#/pending', '#/rejected', '#/suspended'].includes(routeHashPath(routeHash));
}

function isAuthEntryRoute(routeHash: string): boolean {
  const hashPath = routeHashPath(routeHash);
  return hashPath === '#/login' || hashPath === '#/signup';
}

function isExplicitNotAllowedRoute(routeHash: string): boolean {
  return routeHashPath(routeHash) === '#/not-allowed';
}

function routeHashPath(routeHash: string): string {
  const queryIndex = routeHash.indexOf('?');
  return queryIndex === -1 ? routeHash : routeHash.slice(0, queryIndex);
}

function adminRedirectTarget(routeHash: string): string {
  if (routeHash === '#/usage') {
    return '#/admin/usage';
  }

  return '#/admin/pending';
}

function replaceHash(nextHash: string): void {
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
}

function LoadingPage(): ReactElement {
  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <p>Loading your account...</p>
      </section>
    </main>
  );
}

export function UserBootstrapGate({
  routeHash,
  children,
  adminChildren,
}: UserBootstrapGateProps): ReactElement {
  const auth = useFaAuth();
  const { accountState } = auth;
  const handleRetry = (): Promise<void> => auth.refreshCurrentUser();
  const handleLogout = (): Promise<void> => auth.logout();
  const adminRetiredRedirect =
    accountState.status === 'approved' &&
    accountState.authorization.role === 'admin' &&
    isUsageRoute(routeHash)
      ? adminRedirectTarget(routeHash)
      : null;

  useEffect(() => {
    switch (accountState.status) {
      case 'profile_required':
        if (routeHash !== '#/profile') {
          replaceHash('#/profile');
        }
        return;
      case 'pending':
        if (routeHash !== '#/pending') {
          replaceHash('#/pending');
        }
        return;
      case 'rejected':
        if (routeHash !== '#/rejected') {
          replaceHash('#/rejected');
        }
        return;
      case 'suspended':
        if (routeHash !== '#/suspended') {
          replaceHash('#/suspended');
        }
        return;
      case 'approved':
        if (accountState.authorization.role === 'admin') {
          if (adminRetiredRedirect !== null) {
            replaceHash(adminRetiredRedirect);
            return;
          }

          if (isBlockedAccountStateRoute(routeHash) || isAuthEntryRoute(routeHash)) {
            replaceHash('#/admin/pending');
          }
          return;
        }

        if (isBlockedAccountStateRoute(routeHash) || isAuthEntryRoute(routeHash)) {
          replaceHash('#/chat');
          return;
        }

        if (isUsageRoute(routeHash)) {
          replaceHash('#/chat');
        }
        return;
      default:
        break;
    }

    if (adminRetiredRedirect !== null) {
      replaceHash(adminRetiredRedirect);
    }
  }, [accountState, adminRetiredRedirect, routeHash]);

  if (accountState.status === 'loading') {
    return <LoadingPage />;
  }

  if (accountState.status === 'profile_required') {
    return <ProfilePage />;
  }

  if (accountState.status === 'pending') {
    return <PendingPage onLogout={handleLogout} />;
  }

  if (accountState.status === 'rejected') {
    return <RejectedPage onLogout={handleLogout} />;
  }

  if (accountState.status === 'suspended') {
    return <SuspendedPage onLogout={handleLogout} />;
  }

  if (accountState.status === 'error') {
    return (
      <AccountErrorPage
        message={accountState.message}
        onLogout={handleLogout}
        onRetry={handleRetry}
      />
    );
  }

  if (accountState.status === 'unauthenticated') {
    return <LoadingPage />;
  }

  if (routeHash === '#/profile') {
    return <ProfilePage />;
  }

  if (accountState.authorization.role === 'admin') {
    if (adminRetiredRedirect !== null) {
      return <LoadingPage />;
    }

    if (isBlockedAccountStateRoute(routeHash) || isAuthEntryRoute(routeHash)) {
      return <LoadingPage />;
    }

    if (isAdminRoute(routeHash)) {
      return <>{adminChildren ?? <TemporaryAdminPlaceholder />}</>;
    }

    if (isChatRoute(routeHash) || isUsageRoute(routeHash)) {
      return <>{children}</>;
    }

    if (isExplicitNotAllowedRoute(routeHash)) {
      return <NotAllowedPage onLogout={handleLogout} />;
    }

    return <NotFoundPage />;
  }

  if (isAdminRoute(routeHash)) {
    return <NotAllowedPage onLogout={handleLogout} />;
  }

  if (isUsageRoute(routeHash)) {
    return <LoadingPage />;
  }

  if (isChatRoute(routeHash)) {
    return <>{children}</>;
  }

  if (isExplicitNotAllowedRoute(routeHash)) {
    return <NotAllowedPage onLogout={handleLogout} />;
  }

  return <NotFoundPage />;
}
