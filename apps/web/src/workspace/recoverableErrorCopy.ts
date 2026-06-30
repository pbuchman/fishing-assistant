export const recoverableNetworkFailureCopy =
  'Connection interrupted. Check your network and try again.';

export function isRecoverableNetworkFailureCopy(value: string): boolean {
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  return (
    normalized.includes('failed to fetch') ||
    normalized.includes('network error') ||
    normalized.includes('load failed') ||
    normalized.includes('fetch failed') ||
    normalized.includes('api request failed with status 502') ||
    normalized.includes('api request failed with status 503') ||
    normalized.includes('api request failed with status 504')
  );
}

export function normalizeRecoverableErrorCopy(value: string): string {
  return isRecoverableNetworkFailureCopy(value) ? recoverableNetworkFailureCopy : value;
}
