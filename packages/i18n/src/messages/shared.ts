import type { Locale } from '../locales.js';

export interface LinkMessage {
  label: string;
  ariaLabel: string;
}

export interface SharedMessages {
  language: {
    label: string;
    polish: string;
    english: string;
  };
}

export const sharedMessages: Record<Locale, SharedMessages> = {
  pl: {
    language: {
      label: 'Zmień język',
      polish: 'Polski',
      english: 'Angielski',
    },
  },
  en: {
    language: {
      label: 'Change language',
      polish: 'Polski',
      english: 'English',
    },
  },
};
