import type { FaAuthAccountState } from '../auth/useFaAuth.js';

export interface WorkspaceAccountSummary {
  displayName: string;
  initials: string;
  level: number;
}

function accountInitials(firstName: string | null, lastName: string | null, email: string): string {
  const firstInitial = firstName?.trim().charAt(0) ?? '';
  const lastInitial = lastName?.trim().charAt(0) ?? '';
  const initials = `${firstInitial}${lastInitial}`.trim();

  return (initials || email.trim().charAt(0) || 'U').toUpperCase();
}

export function workspaceUserSummary(accountState: FaAuthAccountState): WorkspaceAccountSummary {
  if (accountState.status !== 'approved') {
    return {
      displayName: 'Użytkownik',
      initials: 'U',
      level: 1,
    };
  }

  const user = accountState.account.user;
  const displayName =
    [user.firstName, user.lastName].filter((value) => value?.trim()).join(' ') || user.email;

  return {
    displayName,
    initials: accountInitials(user.firstName, user.lastName, user.email),
    level: user.effectiveLevel,
  };
}
