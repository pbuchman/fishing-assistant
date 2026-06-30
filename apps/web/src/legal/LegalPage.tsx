import type { ReactElement } from 'react';

import { useDocumentTitle } from '../ui/useDocumentTitle.js';
import { legalDocumentLinks, type LegalDocument } from './legalDocuments.js';

export function LegalPage({ document }: { document: LegalDocument }): ReactElement {
  useDocumentTitle(`${document.title} | FA`);

  return (
    <main className="min-h-screen bg-[#f8fbf7] px-5 py-8 text-[#10231d] sm:px-8 lg:px-10">
      <div className="mx-auto max-w-4xl">
        <a className="inline-flex min-h-11 items-center font-black !text-[#24765a]" href="#/home">
          Wróć na stronę główną
        </a>

        <header className="mt-8 border-b border-[#10231d]/12 pb-8">
          <p className="text-sm font-black uppercase tracking-[0.08em] text-[#24765a]">
            Dokumenty prawne FA
          </p>
          <h1 className="mt-3 text-4xl leading-tight font-black text-balance sm:text-5xl">
            {document.title}
          </h1>
          <p className="mt-4 text-lg leading-8 text-[#496158]">{document.summary}</p>
        </header>

        <nav aria-label="Dokumenty prawne" className="mt-6 flex flex-wrap gap-3 text-sm font-black">
          {legalDocumentLinks.map((link) => (
            <a
              className={`inline-flex min-h-11 items-center rounded-full border px-4 no-underline transition ${
                link.id === document.id
                  ? 'border-[#24765a] bg-[#24765a] !text-white'
                  : 'border-[#10231d]/15 bg-white !text-[#28453b] hover:border-[#24765a] hover:!text-[#24765a]'
              }`}
              href={link.route}
              key={link.id}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="mt-8 grid gap-5">
          {document.sections.map((section) => (
            <section
              className="rounded-lg border border-[#10231d]/12 bg-white p-6"
              key={section.title}
            >
              <h2 className="text-2xl font-black text-[#10231d]">{section.title}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p className="mt-4 leading-8 text-[#496158]" key={paragraph}>
                  {paragraph}
                </p>
              ))}
              {section.bullets ? (
                <ul className="mt-4 grid gap-3 leading-7 text-[#496158]">
                  {section.bullets.map((bullet) => (
                    <li className="flex gap-3" key={bullet}>
                      <span
                        aria-hidden="true"
                        className="mt-3 size-2 shrink-0 rounded-full bg-[#24765a]"
                      />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
