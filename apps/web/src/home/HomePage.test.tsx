import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider.js';
import { HomePage } from './HomePage.js';

const stylesSource = readFileSync(join(process.cwd(), 'apps/web/src/styles.css'), 'utf8');

function renderHomePage(): void {
  render(
    <I18nProvider>
      <HomePage />
    </I18nProvider>
  );
}

describe('HomePage', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('defaults to Polish knowledge-base positioning with the assistant as the primary CTA', () => {
    renderHomePage();

    expect(screen.getByRole('heading', { level: 1, name: 'Fishing Assistant' })).toBeVisible();
    expect(screen.getByText('Baza wiedzy i asystent wędkarski do decyzji nad wodą')).toBeVisible();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /asystent wiedzy wędkarskiej/i,
      })
    ).toBeVisible();

    expect(
      screen
        .getAllByRole('link', { name: /Otwórz asystenta/i })
        .some((link) => link.getAttribute('href') === '/app#/chat')
    ).toBe(true);
    expect(
      screen
        .getAllByRole('link', { name: /Zobacz przykłady/i })
        .some((link) => link.getAttribute('href') === '#assistant')
    ).toBe(true);
  });

  it('switches all core homepage copy into meaning-first English', () => {
    renderHomePage();

    fireEvent.click(screen.getByRole('button', { name: /Angielski/i }));

    expect(
      screen.getByText('A fishing knowledge base and assistant for decisions at the water')
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Fishing Assistant homepage' })).toHaveAttribute(
      'href',
      '#/home'
    );
    expect(screen.getByText(/knowledge-guided fishing assistant/i)).toBeVisible();
    expect(screen.getByRole('button', { name: /Polski/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.getByRole('button', { name: /English/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(
      screen
        .getAllByRole('link', { name: /Open the assistant/i })
        .some((link) => link.getAttribute('href') === '/app#/chat')
    ).toBe(true);
  });

  it('keeps the public page neutral and avoids closed-access positioning', () => {
    renderHomePage();

    const pageText = document.body.textContent;
    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
      .join(' ');

    expect(pageText).not.toMatch(/gwarantowane brania|złowisz więcej za każdym razem/i);
    expect(pageText).not.toMatch(/\b(?:RAG|embeddings?|chunks?|markdown|tokens?|backend)\b/i);
    expect(`${pageText} ${hrefs}`).not.toMatch(/facebook\.com|1586456719824680/i);
    expect(hrefs).not.toMatch(/^https?:\/\//i);
  });

  it('stays public and static while hiding admin routes', () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    renderHomePage();

    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
      .filter(Boolean);

    expect(hrefs).not.toContain('#/admin/knowledge');
    expect(hrefs).not.toContain('#/admin/usage');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('provides keyboard skip navigation, assistant FAQ link, and footer legal/contact links', () => {
    renderHomePage();

    expect(screen.getByRole('link', { name: 'Fishing Assistant - strona główna' })).toHaveAttribute(
      'href',
      '#/home'
    );

    const skipLink = screen.getByRole('link', { name: /pomiń do treści/i });
    expect(skipLink).toHaveAttribute('href', '#home-main-content');
    expect(document.querySelector('#home-main-content')).toBeTruthy();

    const faqRegion = document.querySelector('#faq');
    expect(faqRegion).toBeTruthy();
    expect(
      within(faqRegion as HTMLElement).getByRole('link', { name: /otwórz asystenta/i })
    ).toHaveAttribute('href', '/app#/chat');

    const footer = screen.getByRole('contentinfo');
    expect(
      within(footer).getByText(/kontakt i dokumenty prawne są dostępne poniżej/i)
    ).toBeVisible();
    expect(within(footer).getByRole('link', { name: /kontakt/i })).toHaveAttribute(
      'href',
      'mailto:hello@fishing-assistant.example'
    );
    expect(within(footer).getByRole('link', { name: 'Informacje prawne' })).toHaveAttribute(
      'href',
      '#/legal'
    );
    expect(within(footer).getByRole('link', { name: 'Polityka prywatności' })).toHaveAttribute(
      'href',
      '#/privacy'
    );
    expect(
      within(footer).getByRole('link', { name: 'Cookies i pamięć przeglądarki' })
    ).toHaveAttribute('href', '#/cookies');
    expect(
      within(footer).getByRole('link', { name: 'Regulamin korzystania z asystenta' })
    ).toHaveAttribute('href', '#/terms');
    expect(within(footer).getByRole('link', { name: 'Informacja o AI' })).toHaveAttribute(
      'href',
      '#/ai'
    );
    expect(within(footer).queryByRole('link', { name: /^Prywatność$/i })).toBeNull();
    expect(within(footer).queryByRole('link', { name: /^Regulamin$/i })).toBeNull();
  });

  it('offers compact mobile section navigation with direct section links', () => {
    renderHomePage();

    const mobileNav = screen.getByRole('navigation', { name: /sekcje strony/i });

    expect(within(mobileNav).getByRole('link', { name: 'Baza wiedzy' })).toHaveAttribute(
      'href',
      '#knowledge'
    );
    expect(within(mobileNav).getByRole('link', { name: 'Tematy' })).toHaveAttribute(
      'href',
      '#topics'
    );
    expect(within(mobileNav).getByRole('link', { name: 'Proces' })).toHaveAttribute(
      'href',
      '#process'
    );
    expect(within(mobileNav).getByRole('link', { name: 'FAQ' })).toHaveAttribute('href', '#faq');
  });

  it('wraps mobile section navigation instead of relying on horizontal scroll', () => {
    renderHomePage();

    const mobileNav = screen.getByRole('navigation', { name: /sekcje strony/i });

    expect(mobileNav.className).toContain('flex-wrap');
    expect(mobileNav.className).not.toContain('overflow-x-auto');
  });

  it('keeps the public stats focused on topic coverage', () => {
    renderHomePage();

    expect(screen.getByText('120+')).toBeVisible();
    expect(screen.getByText('obszarów i notatek')).toBeVisible();
    expect(screen.getByText('10+')).toBeVisible();
    expect(screen.getByText('obszarów tematycznych')).toBeVisible();
    expect(screen.getByText('24/7')).toBeVisible();
    expect(screen.getByText('dostęp do asystenta')).toBeVisible();
  });

  it('uses mobile-first footer and final CTA layout copy', () => {
    renderHomePage();

    expect(screen.getByText(/kontakt i dokumenty prawne są dostępne poniżej/i)).toBeVisible();
    expect(screen.queryByText(/robocze dokumenty prawne FA/i)).toBeNull();
    expect(screen.getByRole('link', { name: 'Regulamin korzystania z asystenta' })).toHaveAttribute(
      'href',
      '#/terms'
    );
  });

  it('keeps public homepage chip tap targets at least 44px tall', () => {
    renderHomePage();

    for (const label of ['Polski', 'Angielski']) {
      expect(screen.getByRole('button', { name: label }).className).toContain('!min-h-11');
    }

    const desktopNav = screen.getByRole('navigation', { name: 'Strona główna' });
    for (const label of ['Baza wiedzy', 'Tematy', 'Asystent', 'Proces', 'FAQ']) {
      expect(within(desktopNav).getByRole('link', { name: label }).className).toContain('min-h-11');
    }

    const chipRule = /\.fa-chip\s*{[^}]*}/s.exec(stylesSource)?.[0] ?? '';

    expect(chipRule).toContain('min-height: 44px');
  });

  it('keeps responsive homepage layout rules aligned with the visual audit', () => {
    const finalCtaRule =
      /<section className="bg-white px-5 py-20 sm:px-8 lg:px-10">[\s\S]*?<div className="([^"]+)"/.exec(
        readFileSync(join(process.cwd(), 'apps/web/src/home/HomePage.tsx'), 'utf8')
      )?.[1];

    expect(finalCtaRule).toContain('lg:flex-row');
    expect(finalCtaRule).not.toContain('md:flex-row');
    expect(stylesSource).toMatch(/\.home-prompt-preview\s*{[^}]*gap:\s*10px/s);
    expect(stylesSource).toMatch(/@media \(min-width: 1024px\)\s*{[\s\S]*\.home-prompt-preview/s);
  });

  it('carries a selected assistant preview prompt into the protected chat route', () => {
    renderHomePage();

    const promptLink = screen.getByRole('link', { name: 'Zapytaj o warunki' });

    expect(promptLink).toHaveAttribute('href', '/app#/chat?prompt=Zapytaj%20o%20warunki');
  });

  it('uses icons for assistant preview and primary protected entry points', () => {
    renderHomePage();

    const assistantLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/app#/chat');

    expect(assistantLinks).toHaveLength(4);
    expect(
      assistantLinks.filter((link) => link.querySelector('svg.lucide-arrow-right')).length
    ).toBe(2);

    const exampleLinks = screen.getAllByRole('link', { name: /Zobacz przykłady/i });
    expect(exampleLinks).toHaveLength(2);
    for (const exampleLink of exampleLinks) {
      expect(exampleLink.querySelector('svg.lucide-message-circle')).not.toBeNull();
    }

    expect(screen.getByLabelText('Asystent').querySelector('svg.lucide-arrow-up')).not.toBeNull();
  });
});
