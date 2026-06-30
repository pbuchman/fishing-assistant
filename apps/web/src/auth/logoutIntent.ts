const postLogoutLoginPromptKey = 'fa.force_login_after_logout';

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function markLoginPromptAfterLogout(): void {
  sessionStorageOrNull()?.setItem(postLogoutLoginPromptKey, '1');
}

export function consumeLoginPromptAfterLogout(): boolean {
  const storage = sessionStorageOrNull();
  if (storage?.getItem(postLogoutLoginPromptKey) !== '1') {
    return false;
  }

  storage.removeItem(postLogoutLoginPromptKey);
  return true;
}
