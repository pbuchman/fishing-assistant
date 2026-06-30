import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import {
  isLegalRoutePath,
  legalDocumentByRoute,
  legalDocumentLinks,
  legalDocuments,
} from './legalDocuments.js';
import { LegalIndexPage } from './LegalIndexPage.js';
import { LegalPage } from './LegalPage.js';

afterEach(() => {
  cleanup();
});

function legalDocumentText(): string {
  return legalDocuments
    .flatMap((document) => [
      document.title,
      document.summary,
      ...document.sections.flatMap((section) => [
        section.title,
        ...(section.paragraphs ?? []),
        ...(section.bullets ?? []),
      ]),
    ])
    .join('\n');
}

describe('legalDocuments', () => {
  it('defines the five required Polish legal routes', () => {
    expect(legalDocumentLinks.map((link) => [link.route, link.label])).toEqual([
      ['#/legal', 'Informacje prawne'],
      ['#/privacy', 'Polityka prywatności'],
      ['#/cookies', 'Cookies i pamięć przeglądarki'],
      ['#/terms', 'Regulamin korzystania z asystenta'],
      ['#/ai', 'Informacja o AI'],
    ]);
  });

  it('keeps every document informational without launch-history wording', () => {
    for (const document of legalDocuments) {
      const text = [
        document.title,
        document.summary,
        ...document.sections.flatMap((section) => [
          section.title,
          ...(section.paragraphs ?? []),
          ...(section.bullets ?? []),
        ]),
      ].join('\n');

      expect(text).toMatch(/charakter informacyjny/i);
      expect(text).toMatch(/operator/i);
      expect(text).not.toMatch(/wersja robocza/i);
      expect(text).not.toMatch(/przed publicznym uruchomieniem/i);
      expect(text).not.toMatch(/darmowych generator/i);
      expect(text).not.toMatch(/launch/i);
    }
  });

  it('contains the required FA-specific legal facts', () => {
    const allText = legalDocumentText();

    expect(allText).toMatch(/asystent wiedzy wędkarskiej/i);
    expect(allText).toMatch(/FA nie jest sklepem/i);
    expect(allText).toMatch(/Auth0/i);
    expect(allText).toMatch(/fa\.locale/i);
    expect(allText).toMatch(/fa\.force_login_after_logout/i);
    expect(allText).toMatch(/service worker/i);
    expect(allText).toMatch(/nie używa marketingowych cookies/i);
    expect(allText).toMatch(/dostawców modeli AI/i);
    expect(allText).toMatch(/nie powinien wpisywać danych wrażliwych/i);
    expect(allText).toMatch(/odpowiedzi AI są wsparciem informacyjnym/i);
  });

  it('describes answer-gap report data, legal bases, and retention criteria', () => {
    const allText = legalDocumentText();

    expect(allText).toMatch(/Zgłoszenia luk wiedzy/i);
    expect(allText).toMatch(/próg dostępu użytkownika/i);
    expect(allText).toMatch(/techniczne identyfikatory zgłoszenia/i);
    expect(allText).toMatch(/opcjonalnie kontekst rozmowy i kontakt/i);
    expect(allText).toMatch(/uzupełniać Bazę Wiedzy/);
    expect(allText).toMatch(/prawnie uzasadniony interes/i);
    expect(allText).toMatch(/zgodzie użytkownika/i);
    expect(allText).toMatch(/dobrowolne udostępnienie kontaktu i kontekstu/i);
    expect(allText).toMatch(/kryteria retencji/i);
  });

  it('resolves document routes and rejects non-legal hashes', () => {
    expect(legalDocumentByRoute('#/privacy')?.id).toBe('privacy');
    expect(legalDocumentByRoute('#/privacy?x=1')?.id).toBe('privacy');
    expect(legalDocumentByRoute('#/chat')).toBeNull();
    expect(isLegalRoutePath('#/cookies')).toBe(true);
    expect(isLegalRoutePath('#/chat')).toBe(false);
  });
});

describe('legal page rendering', () => {
  it('renders the legal index with every document link', () => {
    render(<LegalIndexPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Informacje prawne FA' })).toBeVisible();
    for (const link of legalDocumentLinks) {
      expect(screen.getByRole('link', { name: link.label })).toHaveAttribute('href', link.route);
    }
  });

  it('renders a document with informational scope and home link', () => {
    const document = legalDocumentByRoute('#/privacy');
    if (document === null) {
      throw new Error('privacy document missing');
    }

    render(<LegalPage document={document} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Polityka prywatności' })).toBeVisible();
    expect(screen.getByText(/charakter informacyjny/i)).toBeVisible();
    expect(screen.queryByText(/wersja robocza/i)).toBeNull();
    expect(screen.queryByText(/darmowych generatorów/i)).toBeNull();
    expect(screen.getByRole('link', { name: 'Wróć na stronę główną' })).toHaveAttribute(
      'href',
      '#/home'
    );
    expect(
      within(screen.getByRole('navigation', { name: 'Dokumenty prawne' })).getByRole('link', {
        name: 'Informacja o AI',
      })
    ).toHaveAttribute('href', '#/ai');
  });
});
