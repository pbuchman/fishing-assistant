import { createContext, useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  DEFAULT_LOCALE,
  appMessages,
  homeMessages,
  isSupportedLocale,
  sharedMessages,
  type AppMessages,
  type HomeMessages,
  type Locale,
  type SharedMessages,
} from '@fa/i18n';

const storageKey = 'fa.locale';

export interface I18nMessages {
  app: AppMessages;
  home: HomeMessages;
  shared: SharedMessages;
}

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  messages: I18nMessages;
  t: I18nMessages;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): Locale {
  try {
    const storedLocale = window.localStorage.getItem(storageKey);
    return storedLocale !== null && isSupportedLocale(storedLocale) ? storedLocale : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(storageKey, locale);
  } catch {
    // The selected language still works for this session if storage is unavailable.
  }
}

export function I18nProvider({ children }: { children: ReactNode }): ReactElement {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale());

  useEffect(() => {
    document.documentElement.lang = locale;
    persistLocale(locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    const messages = {
      app: appMessages[locale],
      home: homeMessages[locale],
      shared: sharedMessages[locale],
    };

    return {
      locale,
      setLocale: setLocaleState,
      messages,
      t: messages,
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
