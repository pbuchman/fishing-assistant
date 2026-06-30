import '@testing-library/jest-dom/vitest';

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();

  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      return entries.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    },
  };
}

function ensureBrowserStorage(name: 'localStorage' | 'sessionStorage'): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window[name].getItem('__fa_storage_probe__');
    return;
  } catch {
    Object.defineProperty(window, name, {
      configurable: true,
      value: createMemoryStorage(),
    });
  }
}

ensureBrowserStorage('localStorage');
ensureBrowserStorage('sessionStorage');
