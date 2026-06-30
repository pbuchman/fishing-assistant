import { createContext, useContext } from 'react';
import type { AuthorizationContext, AuthorizationResolveResponse } from '@fa/http-contracts';

export type FaAuthAccountState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | {
      status: 'profile_required';
      account: Extract<AuthorizationResolveResponse, { state: 'profile_required' }>;
    }
  | { status: 'pending'; account: Extract<AuthorizationResolveResponse, { state: 'pending' }> }
  | { status: 'rejected'; account: Extract<AuthorizationResolveResponse, { state: 'rejected' }> }
  | {
      status: 'suspended';
      account: Extract<AuthorizationResolveResponse, { state: 'suspended' }>;
    }
  | {
      status: 'approved';
      account: Extract<AuthorizationResolveResponse, { state: 'approved' }>;
      authorization: AuthorizationContext;
    }
  | { status: 'error'; message: string };

export interface FaLoginOptions {
  prompt?: 'login';
  screenHint?: 'signup';
}

export interface FaAuthContextValue {
  accountState: FaAuthAccountState;
  isLoading: boolean;
  isAuthenticated: boolean;
  isLogoutInProgress: boolean;
  sessionKey: string;
  login(returnTo?: string, options?: FaLoginOptions): Promise<void>;
  logout(): Promise<void>;
  refreshCurrentUser(): Promise<void>;
  completeProfile(input: {
    firstName: string;
    lastName: string;
    mobileNumber: string;
  }): Promise<void>;
  getAccessToken(): Promise<string>;
  refreshAccessToken(): Promise<string>;
}

export const FaAuthContext = createContext<FaAuthContextValue | null>(null);

export function useFaAuth(): FaAuthContextValue {
  const value = useContext(FaAuthContext);
  if (value === null) {
    throw new Error('useFaAuth must be used within FaAuthProvider.');
  }

  return value;
}
