import type { ReactElement } from 'react';
import type { Locale } from '@fa/i18n';

import { useI18n } from '../i18n/useI18n.js';

export function AppLanguageSwitch(): ReactElement {
  const { locale, messages, setLocale } = useI18n();
  const language = messages.shared.language;
  const helper = messages.app.chat.answerLanguageHint;
  const options: readonly { locale: Locale; label: string }[] = [
    { locale: 'pl', label: language.polish },
    { locale: 'en', label: language.english },
  ];

  return (
    <div className="fa-language-control">
      <div aria-label={language.label} className="fa-language-switch" role="group">
        {options.map((option) => (
          <button
            aria-pressed={locale === option.locale}
            className={locale === option.locale ? 'active' : undefined}
            key={option.locale}
            type="button"
            onClick={() => {
              setLocale(option.locale);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="fa-language-helper">{helper}</p>
    </div>
  );
}
