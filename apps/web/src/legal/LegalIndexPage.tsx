import type { ReactElement } from 'react';

import { useDocumentTitle } from '../ui/useDocumentTitle.js';
import { legalDocumentLinks } from './legalDocuments.js';

export function LegalIndexPage(): ReactElement {
  useDocumentTitle('Informacje prawne FA');

  return (
    <main className="min-h-screen bg-[#f8fbf7] px-5 py-8 text-[#10231d] sm:px-8 lg:px-10">
      <div className="mx-auto max-w-4xl">
        <a className="inline-flex min-h-11 items-center font-black !text-[#24765a]" href="#/home">
          Wróć na stronę główną
        </a>
        <header className="mt-8 border-b border-[#10231d]/12 pb-8">
          <p className="text-sm font-black uppercase tracking-[0.08em] text-[#24765a]">
            Dokumenty aplikacji
          </p>
          <h1 className="mt-3 text-4xl leading-tight font-black text-balance sm:text-5xl">
            Informacje prawne FA
          </h1>
          <p className="mt-4 text-lg leading-8 text-[#496158]">
            Zebraliśmy w jednym miejscu dokumenty, które wyjaśniają zakres FA, prywatność, pamięć
            przeglądarki, zasady korzystania i użycie AI.
          </p>
        </header>
        <nav aria-label="Dokumenty prawne" className="mt-8 grid gap-3">
          {legalDocumentLinks.map((link) => (
            <a
              className="rounded-lg border border-[#10231d]/12 bg-white p-5 text-lg font-black !text-[#10231d] no-underline transition hover:border-[#24765a] hover:!text-[#24765a]"
              href={link.route}
              key={link.id}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </main>
  );
}
