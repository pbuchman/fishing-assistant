import { describe, expect, it } from 'vitest';

import {
  appMessages,
  DEFAULT_LOCALE,
  homeMessages,
  isSupportedLocale,
  sharedMessages,
  SUPPORTED_LOCALES,
} from '../index.js';

function collectPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectPaths(item, `${prefix}[${index.toString()}]`));
  }

  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      collectPaths(child, prefix.length > 0 ? `${prefix}.${key}` : key)
    );
  }

  return [prefix];
}

function collectStringValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringValues(item));
  }

  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap((child) => collectStringValues(child));
  }

  return typeof value === 'string' ? [value] : [];
}

describe('i18n message catalogs', () => {
  it('defaults public product copy to Polish', () => {
    expect(DEFAULT_LOCALE).toBe('pl');
    expect(SUPPORTED_LOCALES).toEqual(['pl', 'en']);
    expect(isSupportedLocale('pl')).toBe(true);
    expect(isSupportedLocale('en')).toBe(true);
    expect(isSupportedLocale('de')).toBe(false);
  });

  it('keeps Polish and English home message keys in sync', () => {
    expect(collectPaths(homeMessages.pl)).toEqual(collectPaths(homeMessages.en));
  });

  it('keeps Polish and English shared message keys in sync', () => {
    expect(collectPaths(sharedMessages.pl)).toEqual(collectPaths(sharedMessages.en));
  });

  it('keeps Polish and English app message keys in sync', () => {
    expect(collectPaths(appMessages.pl)).toEqual(collectPaths(appMessages.en));
    expect(appMessages.en.chat.startHeading).toBe('What would you like to ask?');
    expect(appMessages.pl.chat.sourcesUsed).toBe('Wykorzystane źródła');
    expect(appMessages.en.chat.sourceFallbackLabel).toBe('Source {number}');
    expect(appMessages.pl.chat.knowledgeBaseSource).toBe('Źródło z Bazy Wiedzy');
    expect(appMessages.pl.chat.navLabel).toBe('Czat');
    expect(sharedMessages.pl.language.english).toBe('Angielski');
    expect(appMessages.pl.chat.answerLanguageHint).toBe(
      'Przełącznik zmienia język interfejsu. Odpowiedź dopasuje się do języka pytania.'
    );
    expect(appMessages.en.chat.answerLanguageHint).toBe(
      'This switch changes the interface language. Answers follow the language of the question.'
    );
    expect(appMessages.pl.chat.suggestionsLabel).toBe('Kluczowe tematy');
    expect(appMessages.en.chat.suggestionsLabel).toBe('Key topics');
    expect(appMessages.pl.chat.starterPrompts).toEqual([
      'Zapytaj o warunki',
      'Dobierz kolejny krok',
      'Zapytaj o zmiane planu',
    ]);
    expect(appMessages.en.chat.starterPrompts).toEqual([
      'Ask about current conditions',
      'Choose the next step',
      'Ask about changing the plan',
    ]);
    expect(appMessages.pl.chat.untitledConversation).toBe('Bez tytułu');
    expect(appMessages.en.chat.untitledConversation).toBe('Untitled');
    expect(appMessages.pl.chat.emptyConversationPreview).toBe('Jeszcze bez pytania');
    expect(appMessages.en.chat.emptyConversationPreview).toBe('No question yet');
    expect(appMessages.pl.chat.failedAnswerBadge).toBe('Do ponowienia');
    expect(appMessages.en.chat.failedAnswerBadge).toBe('Retry needed');
    expect(appMessages.pl.chat.failedConversationPreview).toBe('Odpowiedź nie została ukończona');
    expect(appMessages.en.chat.failedConversationPreview).toBe('Answer was not completed');
    expect(appMessages.pl.chat.showAdditionalSources).toBe('Pokaż {count} dodatkowe źródła');
    expect(appMessages.en.chat.showAdditionalSources).toBe('Show {count} more sources');
    expect(appMessages.pl.chat.hideAdditionalSources).toBe('Ukryj {count} dodatkowe źródła');
    expect(appMessages.en.chat.hideAdditionalSources).toBe('Hide {count} additional sources');
    expect(appMessages.pl.chat.whatIsMissing).toBe('Do doprecyzowania');
    expect(appMessages.en.chat.whatIsMissing).toBe('To clarify');
    expect(appMessages.pl.chat.followUpPlaceholder).toBe('Dopytaj o szczegóły');
    expect(appMessages.en.chat.followUpPlaceholder).toBe('Ask a follow-up');
    expect(appMessages.pl.chat.checkingAnswer).toBe('Jeszcze przygotowuję odpowiedź...');
    expect(appMessages.en.chat.checkingAnswer).toBe('Still preparing the answer...');
    expect(appMessages.pl.chat.longRunningAnswer).toBe('Jeszcze przygotowuję odpowiedź...');
    expect(appMessages.en.chat.longRunningAnswer).toBe('Still preparing the answer...');
    expect(appMessages.pl.chat.preparingSources).toBe('Opracowuję listę źródeł...');
    expect(appMessages.en.chat.preparingSources).toBe('Preparing the source list...');
    expect(appMessages.pl.chat.queueFollowUp).toBe('Wyślij po odpowiedzi');
    expect(appMessages.en.chat.queueFollowUp).toBe('Send after answer');
    expect(appMessages.pl.chat.queuedFollowUpPlaceholder).toBe('Pytanie czeka w kolejce');
    expect(appMessages.en.chat.queuedFollowUpPlaceholder).toBe('Question queued');
    expect(appMessages.pl.chat.retryAnswer).toBe('Ponów');
    expect(appMessages.en.chat.retryAnswer).toBe('Retry');
    expect(appMessages.pl.chat.cancelAnswer).toBe('Przerwij');
    expect(appMessages.en.chat.cancelAnswer).toBe('Cancel');
    expect(appMessages.pl.chat.answerGapShareTitle).toBe('Nie mamy tego w Bazie Wiedzy');
    expect(appMessages.en.chat.answerGapShareTitle).toBe(
      'We do not have this in the Knowledge Base'
    );
    expect(appMessages.pl.chat.answerGapShareBody).toBe(
      'Do zgłoszenia zawsze dołączymy opis braku, pytanie, próg dostępu, datę i techniczne identyfikatory zgłoszenia. Opcjonalnie dołącz kontekst rozmowy lub kontakt, żeby administrator mógł trafniej uzupełnić materiał albo wrócić do Ciebie z pytaniem.'
    );
    expect(appMessages.en.chat.answerGapShareBody).toBe(
      'The report always includes the missing-information note, question, access tier, date, and technical report identifiers. Optionally include conversation context or contact details so the administrator can update the material more accurately or follow up with you.'
    );
    expect(appMessages.pl.chat.answerGapShareContext).toBe('Dołącz kontekst rozmowy');
    expect(appMessages.en.chat.answerGapShareContext).toBe('Include conversation context');
    expect(appMessages.pl.chat.answerGapShareButton).toBe('Zgłoś brak');
    expect(appMessages.en.chat.answerGapShareButton).toBe('Report gap');
    expect(appMessages.pl.chat.answerGapShared).toBe('Zgłoszenie wysłane administratorowi');
    expect(appMessages.en.chat.answerGapShared).toBe('Report sent to the administrator');
    expect(appMessages.pl.chat.answerGapWithdrawButton).toBe('Usuń kontekst i kontakt');
    expect(appMessages.en.chat.answerGapWithdrawButton).toBe('Remove context and contact');
    expect(appMessages.pl.admin.previewConversation).toBe('Szczegóły zgłoszenia');
    expect(appMessages.en.admin.previewConversation).toBe('Report details');
    expect(appMessages.pl.admin.gapOrigin).toBe('Dlaczego powstała luka');
    expect(appMessages.en.admin.gapOrigin).toBe('Why this gap was recorded');
    expect(appMessages.pl.admin.coverage).toBe('Zakres zgłoszenia');
    expect(appMessages.en.admin.coverage).toBe('Report scope');
    expect(appMessages.pl.admin.userLevel).toBe('Próg dostępu');
    expect(appMessages.en.admin.userLevel).toBe('Access tier');
    expect(appMessages.pl.admin.answerGapAccessLevelIncluded).toBe('Próg dostępu dołączony');
    expect(appMessages.en.admin.answerGapAccessLevelIncluded).toBe('Access tier included');
    expect(appMessages.pl.admin.answerGapAccessLevelUnknown).toBe('Próg dostępu nieustalony');
    expect(appMessages.en.admin.answerGapAccessLevelUnknown).toBe('Access tier unknown');
    expect(appMessages.pl.admin.conversationPreviewSnapshotNote).toBe(
      'To jest migawka z chwili zgłoszenia. Pokazuje tylko zakres rozmowy i kontaktu zapisany dla tej luki.'
    );
    expect(appMessages.en.admin.conversationPreviewSnapshotNote).toBe(
      'This is the snapshot from when the gap was reported. It shows only the conversation and contact scope stored for this gap.'
    );
    expect(appMessages.pl.admin.requesterContactHidden).toBe('Kontakt nieudostępniony');
    expect(appMessages.en.admin.requesterContactHidden).toBe('Contact not shared');
    expect(appMessages.pl.admin.answerGapConsentWithdrawn).toBe('Kontekst i kontakt usunięte');
    expect(appMessages.en.admin.answerGapConsentWithdrawn).toBe('Context and contact removed');
    expect(appMessages.pl.admin.answerGapCoverageGlobalMissing).toBe(
      'Brak informacji w Bazie Wiedzy'
    );
    expect(appMessages.en.admin.answerGapCoverageGlobalMissing).toBe(
      'Missing from the Knowledge Base'
    );
    expect(appMessages.pl.chat.conversationLoading).toBe('Ładowanie rozmowy');
    expect(appMessages.en.chat.conversationLoading).toBe('Loading conversation');
    expect(appMessages.pl.chat.conversationLoadFailed).toBe('Nie udało się wczytać rozmowy');
    expect(appMessages.en.chat.conversationLoadFailed).toBe('Unable to load conversation');
    expect(appMessages.pl.chat.conversationUnavailable).toBe('Ta rozmowa nie jest już dostępna.');
    expect(appMessages.en.chat.conversationUnavailable).toBe(
      'This conversation is no longer available.'
    );
    expect(appMessages.pl.chat.conversationRecoveryHint).toBe(
      'Możesz rozpocząć nowy chat albo wybrać inną rozmowę z historii.'
    );
    expect(appMessages.en.chat.conversationRecoveryHint).toBe(
      'You can start a new chat or pick another conversation from history.'
    );
    expect(appMessages.pl.chat.conversationRefreshHint).toBe('Spróbuj odświeżyć rozmowę.');
    expect(appMessages.en.chat.conversationRefreshHint).toBe('Try refreshing the conversation.');
    expect(appMessages.pl.chat.conversationEmptyTitle).toBe('Ta rozmowa jest pusta');
    expect(appMessages.en.chat.conversationEmptyTitle).toBe('This conversation is empty');
    expect(appMessages.pl.chat.conversationEmptyBody).toBe(
      'Możesz zadać pytanie albo wybrać nowy chat.'
    );
    expect(appMessages.en.chat.conversationEmptyBody).toBe(
      'You can ask a question or choose a new chat.'
    );
  });

  it('keeps Polish Baza Wiedzy branding capitalized and English labels translated', () => {
    const polishCopy = collectStringValues(appMessages.pl).join('\n');
    const englishCopy = collectStringValues(appMessages.en).join('\n');
    const abbreviation = String.fromCharCode(75, 66);

    expect(polishCopy).not.toMatch(/knowledge base/iu);
    expect(polishCopy).not.toMatch(new RegExp(`\\b${abbreviation}\\b`, 'u'));
    expect(polishCopy).not.toMatch(/\b(?:baza|bazy|bazie|bazę) wiedzy\b/u);
    expect(polishCopy).not.toMatch(/\b(?:Baza|Bazy|Bazie|Bazę) wiedzy\b/u);
    expect(englishCopy).not.toMatch(/\b(?:baza|bazy|bazie|bazę) wiedzy\b/iu);
  });

  it('contains Polish labels for repo-owned issue 23 admin copy surfaces', () => {
    expect(appMessages.pl.userRoles.user).toBe('Użytkownik');
    expect(appMessages.pl.userStatuses.approved).toBe('Zatwierdzone');
    expect(appMessages.pl.adminUsers.selfAccessBlocked).toBe('Nie możesz zmienić własnego dostępu');
    expect(appMessages.pl.admin.administration).toBe('Administracja');
    expect(appMessages.pl.adminUsage.groupByLabels.component).toBe('Komponent');
    expect(appMessages.pl.usageSources.components['rag-chat']).toBe('Chat z wiedzą');
    expect(appMessages.pl.usageSources.operations['chat.stream']).toBe('Odpowiedź asystenta');
    expect(appMessages.pl.adminKnowledge.pageDetails).toBe('Szczegóły strony');
    expect(appMessages.pl.adminKnowledge.category).toBe('Kategoria');
    expect(appMessages.pl.adminKnowledge.allCategories).toBe('Wszystkie kategorie');
    expect(appMessages.pl.adminKnowledge.categorySettings).toBe('Zmień dostęp kategorii');
    expect(appMessages.pl.adminKnowledge.source).toBe('Materiał źródłowy');
    expect(appMessages.pl.adminKnowledge.sourceLabel).toBe('Nazwa źródła');
    expect(appMessages.pl.adminKnowledge.sourceLabelHelp).toBe(
      'Pomaga opisać materiał źródłowy w administracji.'
    );
    expect(appMessages.pl.adminKnowledge.syncPage).toBe('Opublikuj stronę');
    expect(appMessages.pl.adminKnowledge.reindexPage).toBe('Zindeksuj ponownie');
    expect(appMessages.pl.knowledgeAccess.approved).toBe('Wszyscy');
    expect(appMessages.pl.knowledgeAccess.public).toBe('Wszyscy');
    expect(appMessages.pl.knowledgeAccess.excluded).toBe('Nie w odpowiedziach');
  });

  it('contains the required neutral assistant positioning', () => {
    expect(homeMessages.pl.hero.title).toBe('Fishing Assistant');
    expect(homeMessages.pl.hero.primaryCta.label).toBe('Otwórz asystenta');
    expect(homeMessages.pl.hero.assistantCta.label).toBe('Zobacz przykłady');
    expect(homeMessages.pl.assistant.title).toBe('Asystent wiedzy wędkarskiej');
    expect(homeMessages.pl.hero.stats).toContainEqual({
      value: '120+',
      label: 'obszarów i notatek',
    });
    expect(homeMessages.en.hero.title).toBe('Fishing Assistant');
    expect(homeMessages.en.hero.primaryCta.label).toBe('Open the assistant');
    expect(homeMessages.en.hero.primaryCta.ariaLabel).toContain('Fishing Assistant app');
    expect(homeMessages.en.assistant.title).toBe('A knowledge-guided fishing assistant');
  });
});
