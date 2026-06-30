import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';

import { I18nProvider } from './I18nProvider.js';
import { useI18n } from './useI18n.js';

function CaptureI18n(): ReactElement {
  const { locale, messages, setLocale, t } = useI18n();

  return (
    <div>
      <p data-testid="locale">{locale}</p>
      <p data-testid="hero-title">{messages.home.hero.title}</p>
      <p data-testid="shared-language-label">{t.shared.language.label}</p>
      <button
        type="button"
        onClick={() => {
          setLocale('en');
        }}
      >
        English
      </button>
      <button
        type="button"
        onClick={() => {
          setLocale('pl');
        }}
      >
        Polski
      </button>
    </div>
  );
}

describe('I18nProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('lang');
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.documentElement.removeAttribute('lang');
  });

  it('defaults to Polish and updates the document language', () => {
    render(
      <I18nProvider>
        <CaptureI18n />
      </I18nProvider>
    );

    expect(screen.getByTestId('locale')).toHaveTextContent('pl');
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Fishing Assistant');
    expect(screen.getByTestId('shared-language-label')).toHaveTextContent('Zmień język');
    expect(document.documentElement).toHaveAttribute('lang', 'pl');
  });

  it('persists language changes', () => {
    render(
      <I18nProvider>
        <CaptureI18n />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(screen.getByTestId('shared-language-label')).toHaveTextContent('Change language');
    expect(window.localStorage.getItem('fa.locale')).toBe('en');
    expect(document.documentElement).toHaveAttribute('lang', 'en');
  });

  it('starts from the stored supported language', () => {
    window.localStorage.setItem('fa.locale', 'en');

    render(
      <I18nProvider>
        <CaptureI18n />
      </I18nProvider>
    );

    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(screen.getByTestId('shared-language-label')).toHaveTextContent('Change language');
    expect(document.documentElement).toHaveAttribute('lang', 'en');
  });

  it('falls back to Polish when stored language is unsupported', () => {
    window.localStorage.setItem('fa.locale', 'de');

    render(
      <I18nProvider>
        <CaptureI18n />
      </I18nProvider>
    );

    expect(screen.getByTestId('locale')).toHaveTextContent('pl');
    expect(screen.getByTestId('shared-language-label')).toHaveTextContent('Zmień język');
    expect(document.documentElement).toHaveAttribute('lang', 'pl');
  });
});
