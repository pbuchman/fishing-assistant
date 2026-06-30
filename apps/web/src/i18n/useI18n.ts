import { useContext } from 'react';

import { I18nContext } from './I18nProvider.js';
import type { I18nContextValue } from './I18nProvider.js';

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);

  if (context === null) {
    throw new Error('useI18n must be used within I18nProvider');
  }

  return context;
}
