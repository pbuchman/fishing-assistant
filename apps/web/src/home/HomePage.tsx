import type { ComponentType, ReactElement, ReactNode } from 'react';
import {
  ArrowRight,
  ArrowUp,
  BookOpenText,
  CheckCircle2,
  CircleHelp,
  Fish,
  Gauge,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  Trophy,
  Waves,
} from 'lucide-react';
import type { Locale } from '@fa/i18n';

import { useI18n } from '../i18n/useI18n.js';
import { legalDocumentLinks } from '../legal/legalDocuments.js';
import { SuggestionChips } from '../ui/SuggestionChips.js';
import { useDocumentTitle } from '../ui/useDocumentTitle.js';

const heroImageUrl = new URL('../assets/home-hero.webp', import.meta.url).href;
const contactEmailUrl = 'mailto:hello@fishing-assistant.example';

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

const valueIcons: readonly IconComponent[] = [BookOpenText, MessageCircle, Trophy];
const topicIcons: readonly IconComponent[] = [
  CheckCircle2,
  Gauge,
  Waves,
  Fish,
  BookOpenText,
  Trophy,
];
const processIcons: readonly IconComponent[] = [LockKeyhole, MessageCircle, ShieldCheck];

function iconAt(icons: readonly IconComponent[], index: number): IconComponent {
  return icons[index % icons.length] ?? CheckCircle2;
}

function AssistantAppLink({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}): ReactElement {
  return (
    <a className={className} href="/app#/chat">
      {children}
    </a>
  );
}

function chatPromptHref(prompt: string): string {
  return `/app#/chat?prompt=${encodeURIComponent(prompt)}`;
}

function LanguageSwitch(): ReactElement {
  const { locale, messages, setLocale } = useI18n();
  const language = messages.shared.language;

  const options: readonly { locale: Locale; label: string }[] = [
    { locale: 'pl', label: language.polish },
    { locale: 'en', label: language.english },
  ];

  return (
    <div
      aria-label={language.label}
      className="inline-flex min-h-11 items-center rounded-full border border-[#1c342b]/15 bg-white/82 p-1 text-sm font-extrabold text-[#1c342b] shadow-[0_16px_36px_rgba(16,35,29,0.08)] backdrop-blur"
      role="group"
    >
      {options.map((option) => (
        <button
          aria-pressed={locale === option.locale}
          className={`!min-h-11 !rounded-full !border-0 px-3 text-sm transition focus:outline-none focus:ring-4 focus:ring-[#24765a]/20 ${
            locale === option.locale
              ? '!bg-[#24765a] !text-white hover:!bg-[#24765a]'
              : '!bg-transparent !text-[#355449] hover:!bg-[#eef7f1]'
          }`}
          key={option.locale}
          onClick={() => {
            setLocale(option.locale);
          }}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function HomePage(): ReactElement {
  const { messages } = useI18n();
  useDocumentTitle('Fishing Assistant');
  const home = messages.home;
  const chat = messages.app.chat;
  const sectionLinks = [
    { href: '#knowledge', label: home.nav.knowledge },
    { href: '#topics', label: home.nav.topics },
    { href: '#assistant', label: home.nav.assistant },
    { href: '#process', label: home.nav.process },
    { href: '#faq', label: home.nav.faq },
  ] as const;

  return (
    <>
      <a className="fa-skip-link" href="#home-main-content">
        {home.meta.skipToContent}
      </a>
      <main
        className="min-h-screen overflow-hidden bg-[var(--fa-bg)] text-[var(--fa-text)]"
        id="home-main-content"
      >
        <section className="relative min-h-[92svh] overflow-hidden">
          <img
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-[62%_center]"
            src={heroImageUrl}
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(244,247,251,0.98)_0%,rgba(244,247,251,0.92)_42%,rgba(244,247,251,0.58)_70%,rgba(244,247,251,0.18)_100%)]" />
          <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[var(--fa-bg)] via-[rgba(244,247,251,0.82)] to-transparent" />

          <div className="relative z-10 mx-auto flex min-h-[92svh] w-full max-w-7xl flex-col px-5 py-5 sm:px-8 lg:px-10">
            <header className="flex min-h-14 items-center justify-between gap-3">
              <a
                aria-label={home.meta.brandLabel}
                className="flex min-w-0 items-center gap-3 text-base font-extrabold !text-[#10231d] no-underline"
                href="#/home"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#24765a] text-sm font-black text-white shadow-[0_16px_42px_rgba(36,118,90,0.18)]">
                  FA
                </span>
                <span className="hidden truncate sm:inline">{home.hero.title}</span>
              </a>

              <nav
                aria-label={home.meta.navLabel}
                className="hidden items-center gap-6 rounded-full border border-white/70 bg-white/78 px-5 py-3 text-sm font-semibold text-[#28453b] shadow-[0_16px_42px_rgba(16,35,29,0.07)] backdrop-blur lg:flex"
              >
                {sectionLinks.map((link) => (
                  <a
                    className="inline-flex min-h-11 items-center !text-[#28453b] no-underline transition hover:!text-[#24765a]"
                    href={link.href}
                    key={link.href}
                  >
                    {link.label}
                  </a>
                ))}
              </nav>

              <div className="flex shrink-0 items-center gap-2">
                <LanguageSwitch />
                <AssistantAppLink className="hidden min-h-11 items-center justify-center rounded-full bg-[#24765a] px-5 text-sm font-extrabold !text-white no-underline shadow-[0_16px_42px_rgba(36,118,90,0.18)] transition hover:bg-[#1d604a] focus:outline-none focus:ring-4 focus:ring-[#24765a]/25 md:inline-flex">
                  {home.hero.primaryCta.label}
                </AssistantAppLink>
              </div>
            </header>

            <nav
              aria-label={home.meta.mobileNavLabel}
              className="mt-4 flex flex-wrap gap-2 pb-1 lg:hidden"
            >
              {sectionLinks.map((link) => (
                <a
                  className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-[#10231d]/12 bg-white/84 px-4 text-sm font-extrabold !text-[#28453b] no-underline shadow-[0_10px_28px_rgba(16,35,29,0.06)] backdrop-blur transition hover:border-[#24765a] hover:!text-[#24765a] focus:outline-none focus:ring-4 focus:ring-[#24765a]/20"
                  href={link.href}
                  key={link.href}
                >
                  {link.label}
                </a>
              ))}
            </nav>

            <div className="grid flex-1 items-center gap-6 py-6 sm:py-10 lg:grid-cols-[0.96fr_0.72fr] lg:py-10 2xl:py-14">
              <div className="max-w-4xl">
                <h1 className="max-w-4xl text-[2.65rem] leading-[0.96] font-black text-balance sm:text-6xl lg:text-6xl 2xl:text-7xl">
                  {home.hero.title}
                </h1>
                <p className="mt-4 max-w-2xl text-xl leading-snug font-black text-[#24765a] sm:mt-5 sm:text-2xl 2xl:text-3xl">
                  {home.hero.subtitle}
                </p>
                <div className="mt-5 flex flex-col gap-3 sm:mt-6 sm:flex-row">
                  <AssistantAppLink className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-[#24765a] px-7 text-base font-extrabold !text-white no-underline shadow-[0_18px_48px_rgba(36,118,90,0.22)] transition hover:bg-[#1d604a] focus:outline-none focus:ring-4 focus:ring-[#24765a]/25">
                    {home.hero.primaryCta.label}
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </AssistantAppLink>
                  <a
                    className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full border border-[#10231d]/20 bg-white/84 px-7 text-base font-extrabold !text-[#10231d] no-underline backdrop-blur transition hover:border-[#24765a] hover:!text-[#24765a] focus:outline-none focus:ring-4 focus:ring-[#24765a]/20"
                    href="#assistant"
                  >
                    {home.hero.assistantCta.label}
                    <MessageCircle aria-hidden="true" className="size-4" />
                  </a>
                </div>
                <p className="mt-4 max-w-2xl text-base leading-7 font-medium text-[#355449] sm:text-lg sm:leading-8">
                  {home.hero.body}
                </p>

                <div
                  className="home-prompt-preview fa-surface mt-5 max-w-2xl"
                  aria-label={home.nav.assistant}
                >
                  <div className="home-prompt-line">
                    <span>{chat.composerPlaceholder}</span>
                    <ArrowUp aria-hidden="true" className="size-4" />
                  </div>
                  <SuggestionChips
                    label={chat.suggestionsLabel}
                    prompts={chat.starterPrompts.slice(0, 3)}
                    hrefForPrompt={chatPromptHref}
                    onSelect={() => undefined}
                  />
                </div>

                <div className="mt-6 grid max-w-2xl grid-cols-1 gap-3 text-sm font-bold text-[#28453b] sm:grid-cols-3">
                  {home.hero.proof.map((item) => (
                    <div className="border-l-2 border-[#24765a] pl-3" key={item}>
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <aside className="hidden rounded-lg border border-white bg-white/90 p-5 shadow-[0_24px_70px_rgba(16,35,29,0.12)] backdrop-blur lg:block">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {home.hero.stats.map((stat) => (
                    <div className="rounded-lg bg-[#f2f8f4] p-4 text-center" key={stat.label}>
                      <p className="text-2xl font-black text-[#24765a]">{stat.value}</p>
                      <p className="mt-1 text-xs leading-5 font-bold text-[#496158]">
                        {stat.label}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-5 overflow-hidden rounded-lg">
                  <img
                    alt=""
                    className="aspect-[4/3] w-full object-cover object-[55%_center]"
                    loading="lazy"
                    src={heroImageUrl}
                  />
                </div>
              </aside>
            </div>
          </div>
        </section>

        <section
          id="knowledge"
          className="border-y border-[#10231d]/12 bg-white px-5 py-16 sm:px-8 lg:px-10"
        >
          <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <h2 className="text-4xl leading-tight font-black text-[#10231d] text-balance sm:text-5xl">
                {home.knowledgeValue.title}
              </h2>
              <p className="mt-5 text-lg leading-8 text-[#496158]">{home.knowledgeValue.body}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {home.knowledgeValue.cards.map((card, index) => {
                const Icon = iconAt(valueIcons, index);

                return (
                  <article
                    className="rounded-lg border border-[#10231d]/12 bg-[#f8fbf7] p-5"
                    key={card.title}
                  >
                    <Icon aria-hidden={true} className="mb-5 size-6 text-[#24765a]" />
                    <h3 className="text-xl font-black text-[#10231d]">{card.title}</h3>
                    <p className="mt-3 leading-7 text-[#496158]">{card.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="assistant" className="px-5 py-20 sm:px-8 lg:px-10">
          <div className="mx-auto grid max-w-7xl items-start gap-10 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <h2 className="text-4xl leading-tight font-black text-[#10231d] text-balance sm:text-5xl">
                {home.assistant.title}
              </h2>
              <p className="mt-5 text-lg leading-8 text-[#496158]">{home.assistant.body}</p>
              <p className="mt-6 inline-flex min-h-11 items-center rounded-full bg-[#d79a2b]/14 px-5 text-sm font-black text-[#6f4a05]">
                {home.assistant.statusLabel}
              </p>
              <div className="mt-8">
                <h3 className="text-xl font-black text-[#10231d]">
                  {home.assistant.examplesTitle}
                </h3>
                <ul className="mt-4 grid gap-3">
                  {home.assistant.examples.map((example) => (
                    <li className="flex gap-3 text-[#496158]" key={example}>
                      <CheckCircle2
                        aria-hidden="true"
                        className="mt-1 size-5 shrink-0 text-[#24765a]"
                      />
                      <span>{example}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <article className="rounded-lg border border-[#10231d]/12 bg-white p-5 shadow-[0_24px_70px_rgba(16,35,29,0.08)]">
              <div className="rounded-lg bg-[#10231d] p-5 text-white">
                <p className="text-sm font-black text-[#9ce0c5]">{home.assistant.questionLabel}</p>
                <p className="mt-3 text-lg leading-8">{home.assistant.question}</p>
              </div>
              <div className="mt-4 rounded-lg bg-[#eef7f1] p-5">
                <p className="text-sm font-black text-[#24765a]">{home.assistant.answerLabel}</p>
                <p className="mt-3 leading-7 text-[#28453b]">{home.assistant.answer}</p>
              </div>
              <div className="mt-4 rounded-lg border border-[#d79a2b]/30 bg-[#fff8e7] p-5">
                <p className="text-sm font-black text-[#6f4a05]">
                  {home.assistant.missingInfoLabel}
                </p>
                <p className="mt-3 leading-7 text-[#5d4d29]">{home.assistant.missingInfo}</p>
              </div>
            </article>
          </div>
        </section>

        <section
          id="topics"
          className="bg-[linear-gradient(135deg,#ffffff_0%,#eef8f2_46%,#eaf5f7_100%)] px-5 py-20 sm:px-8 lg:px-10"
        >
          <div className="mx-auto max-w-7xl">
            <div className="max-w-4xl">
              <h2 className="text-4xl leading-tight font-black text-[#10231d] text-balance sm:text-5xl">
                {home.topics.title}
              </h2>
              <p className="mt-5 max-w-3xl text-lg leading-8 text-[#496158]">{home.topics.body}</p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {home.topics.items.map((item, index) => {
                const Icon = iconAt(topicIcons, index);

                return (
                  <article
                    className="rounded-lg border border-[#10231d]/12 bg-white/88 p-6 shadow-[0_18px_44px_rgba(16,35,29,0.05)]"
                    key={item.title}
                  >
                    <Icon aria-hidden={true} className="size-6 text-[#24765a]" />
                    <h3 className="mt-5 text-2xl font-black text-[#10231d]">{item.title}</h3>
                    <p className="mt-3 leading-7 text-[#496158]">{item.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="process" className="bg-white px-5 py-20 sm:px-8 lg:px-10">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.82fr_1.18fr]">
            <div>
              <h2 className="text-4xl leading-tight font-black text-[#10231d] text-balance sm:text-5xl">
                {home.process.title}
              </h2>
              <p className="mt-5 text-lg leading-8 text-[#496158]">{home.process.body}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {home.process.items.map((item, index) => {
                const Icon = iconAt(processIcons, index);

                return (
                  <article
                    className="rounded-lg border border-[#10231d]/12 bg-[#f8fbf7] p-6"
                    key={item.title}
                  >
                    <Icon aria-hidden={true} className="size-6 text-[#24765a]" />
                    <h3 className="mt-5 text-xl font-black text-[#10231d]">{item.title}</h3>
                    <p className="mt-3 leading-7 text-[#496158]">{item.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bg-[#10231d] px-5 py-20 text-white sm:px-8 lg:px-10">
          <div className="mx-auto grid max-w-7xl min-w-0 items-center gap-10 md:grid-cols-[0.85fr_1.15fr]">
            <div className="min-w-0">
              <h2 className="break-words text-4xl leading-tight font-black text-balance sm:text-5xl">
                {home.author.title}
              </h2>
              <p className="mt-6 text-lg leading-8 text-white/78">{home.author.body}</p>
            </div>
            <blockquote className="min-w-0 break-words rounded-lg border border-white/15 bg-white/[0.07] p-6 text-xl leading-8 font-black text-white sm:text-2xl sm:leading-10">
              {home.author.quote}
            </blockquote>
          </div>
        </section>

        <section id="faq" className="bg-[#f8fbf7] px-5 py-20 sm:px-8 lg:px-10">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-4xl leading-tight font-black text-[#10231d] text-balance sm:text-5xl">
              {home.faq.title}
            </h2>
            <div className="mt-10 grid gap-4">
              {home.faq.items.map((item) => (
                <article
                  className="rounded-lg border border-[#10231d]/12 bg-white p-6"
                  key={item.question}
                >
                  <div className="flex gap-4">
                    <CircleHelp
                      aria-hidden="true"
                      className="mt-1 size-6 shrink-0 text-[#24765a]"
                    />
                    <div>
                      <h3 className="text-xl font-black text-[#10231d]">{item.question}</h3>
                      <p className="mt-3 leading-7 text-[#496158]">{item.answer}</p>
                      {item.cta ? (
                        <AssistantAppLink className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-[#24765a] px-5 text-sm font-extrabold !text-white no-underline transition hover:bg-[#1d604a] focus:outline-none focus:ring-4 focus:ring-[#24765a]/25">
                          {item.cta.label}
                        </AssistantAppLink>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white px-5 py-20 sm:px-8 lg:px-10">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 border-t border-[#10231d]/12 pt-12 lg:flex-row lg:items-center">
            <div className="max-w-3xl">
              <h2 className="text-4xl leading-tight font-black text-[#10231d] text-balance sm:text-5xl">
                {home.finalCta.title}
              </h2>
              <p className="mt-5 text-lg leading-8 text-[#496158]">{home.finalCta.body}</p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <AssistantAppLink className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-[#24765a] px-7 text-base font-extrabold !text-white no-underline shadow-[0_18px_48px_rgba(36,118,90,0.22)] transition hover:bg-[#1d604a] focus:outline-none focus:ring-4 focus:ring-[#24765a]/25">
                {home.finalCta.primaryCta.label}
                <ArrowRight aria-hidden="true" className="size-4" />
              </AssistantAppLink>
              <a
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full border border-[#10231d]/20 bg-white px-7 text-base font-extrabold !text-[#10231d] no-underline transition hover:border-[#24765a] hover:!text-[#24765a] focus:outline-none focus:ring-4 focus:ring-[#24765a]/20"
                href="#assistant"
              >
                {home.finalCta.assistantCta.label}
                <MessageCircle aria-hidden="true" className="size-4" />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#10231d] px-5 py-8 text-white sm:px-8 lg:px-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 border-t border-white/15 pt-8 md:flex-row md:items-center md:justify-between">
          <p className="max-w-3xl text-sm leading-6 text-white/78">{home.footer.summary}</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-3 text-sm font-black">
            <a
              aria-label={home.footer.contact.ariaLabel}
              className="inline-flex min-h-11 items-center rounded-full border border-white/20 px-4 !text-white no-underline transition hover:bg-white/10"
              href={contactEmailUrl}
            >
              {home.footer.contact.label}
            </a>
            {legalDocumentLinks.map((link) => (
              <a
                aria-label={link.label}
                className="inline-flex min-h-11 items-center rounded-full border border-white/20 px-4 !text-white no-underline transition hover:bg-white/10"
                href={link.route}
                key={link.id}
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      </footer>
    </>
  );
}
