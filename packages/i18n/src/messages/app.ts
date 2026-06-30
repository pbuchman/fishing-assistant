import type { Locale } from '../locales.js';

export interface AppMessages {
  shell: {
    productName: string;
    workspaceTitle: string;
    adminTitle: string;
    primaryNavigation: string;
    openNavigation: string;
    closeNavigation: string;
    collapseSidebar: string;
    expandSidebar: string;
    accountSettings: string;
    language: string;
    skipToContent: string;
    logout: string;
  };
  chat: {
    navLabel: string;
    newChat: string;
    conversations: string;
    noConversations: string;
    untitledConversation: string;
    emptyConversationPreview: string;
    failedAnswerBadge: string;
    failedConversationPreview: string;
    startHeading: string;
    startBody: string;
    suggestionsLabel: string;
    starterPrompts: readonly string[];
    composerLabel: string;
    composerPlaceholder: string;
    followUpPlaceholder: string;
    sendMessage: string;
    answerLanguageHint: string;
    assistantName: string;
    userName: string;
    draftAnswer: string;
    findingSources: string;
    writingAnswer: string;
    checkingAnswer: string;
    longRunningAnswer: string;
    preparingSources: string;
    partialDraftNotice: string;
    sourcesUsed: string;
    sourceFallbackLabel: string;
    showAllSources: string;
    showAdditionalSources: string;
    hideAdditionalSources: string;
    whatIsMissing: string;
    openSource: string;
    unsafeSourceHidden: string;
    knowledgeBaseSource: string;
    sourceViewerTitle: string;
    sourceViewerBack: string;
    sourceViewerLoading: string;
    sourceViewerLoadFailed: string;
    sourceViewerUpdated: string;
    noEvidence: string;
    conversationDeleteTitle: string;
    conversationDeleteBody: string;
    conversationLoading: string;
    conversationLoadFailed: string;
    conversationUnavailable: string;
    conversationRecoveryHint: string;
    conversationRefreshHint: string;
    conversationEmptyTitle: string;
    conversationEmptyBody: string;
    answerGenerationFailed: string;
    answerGenerationFailedBody: string;
    answerGenerationTimedOut: string;
    retryAnswer: string;
    cancelAnswer: string;
    answerGapShareTitle: string;
    answerGapShareBody: string;
    answerGapShareContext: string;
    answerGapShareContact: string;
    answerGapShareButton: string;
    answerGapDeclineButton: string;
    answerGapWithdrawButton: string;
    answerGapShared: string;
    answerGapWithdrawn: string;
    answerGapActionFailed: string;
    queueFollowUp: string;
    queuedFollowUpPlaceholder: string;
    editQueuedFollowUp: string;
    removeQueuedFollowUp: string;
  };
  usage: {
    navLabel: string;
    title: string;
    subtitle: string;
    estimatedCost: string;
    calls: string;
    tokens: string;
    reportPeriod: string;
    timezone: string;
    refreshed: string;
    estimateNotice: string;
    recentActivity: string;
    showDetails: string;
    hideDetails: string;
    noEvents: string;
    loadError: string;
    details: string;
    activityTime: string;
    created: string;
    model: string;
    component: string;
    promptType: string;
    operation: string;
    cost: string;
  };
  admin: {
    administration: string;
    pendingRequests: string;
    pendingRequestsSubtitle: string;
    noPendingRequests: string;
    noPendingRequestsBody: string;
    pendingRequestsLastChecked: string;
    pendingRequestsRefresh: string;
    pendingRequestsUsers: string;
    pendingRequestsUsage: string;
    pendingRequestsKnowledge: string;
    pendingUserFallback: string;
    pendingRejectTitle: string;
    pendingSuspendTitle: string;
    pendingAccessChangeMessagePrefix: string;
    pendingAccessChangeMessageSuffix: string;
    users: string;
    usersSubtitle: string;
    noUsers: string;
    knowledgeBase: string;
    knowledgeBaseInline: string;
    answerGaps: string;
    answerGapsRequiresAnswer: string;
    answerGapsAll: string;
    markAnswerGapDone: string;
    noAnswerGapsRequireAttention: string;
    noAnswerGapsRecorded: string;
    answerGapsSubtitle: string;
    gapQuestion: string;
    gapOrigin: string;
    gapOriginNoAccessibleEvidence: string;
    gapOriginUnsupportedEvidence: string;
    previewConversation: string;
    conversationPreviewContext: string;
    conversationPreviewSnapshotNote: string;
    conversationPreviewNoContext: string;
    conversationPreviewUserRole: string;
    conversationPreviewAssistantRole: string;
    requesterContactHidden: string;
    answerGapConsentContextShared: string;
    answerGapConsentContextHidden: string;
    answerGapConsentContactShared: string;
    answerGapConsentContactHidden: string;
    answerGapConsentSystemImported: string;
    answerGapConsentWithdrawn: string;
    answerGapAccessLevelIncluded: string;
    answerGapAccessLevelUnknown: string;
    answerGapCoverageGlobalMissing: string;
    answerGapCoverageUnsupportedAccessible: string;
    answerGapCoverageUnknown: string;
    loadedGapsPrefix: string;
    loadedGapsOf: string;
    loadingMoreGaps: string;
    requestedBy: string;
    userLevel: string;
    coverage: string;
    missingInformation: string;
    llmUsage: string;
    llmUsageSubtitle: string;
    rawUsageSubtitle: string;
    workspaceGroup: string;
    accessGroup: string;
    knowledgeGroup: string;
    reportingGroup: string;
    systemGroup: string;
    settings: string;
    settingsSubtitle: string;
    chatModelSection: string;
    activeModel: string;
    selectedProvider: string;
    selectedModel: string;
    unsavedModelSelection: string;
    unsavedSettingsTitle: string;
    unsavedSettingsDescription: string;
    unsavedSettingsConfirm: string;
    unsavedKnowledgeAccessTitle: string;
    unsavedKnowledgeAccessDescription: string;
    unsavedKnowledgeAccessChangedCategories: string;
    unsavedKnowledgeAccessConfirm: string;
    unsavedKnowledgePageTitle: string;
    unsavedKnowledgePageDescription: string;
    unsavedKnowledgePageChangedFields: string;
    unsavedKnowledgePageConfirm: string;
    provider: string;
    inputOutputPrice: string;
    contextWindow: string;
    structuredOutput: string;
    supported: string;
    currentRevision: string;
    lastUpdated: string;
    operationalEffect: string;
    fallbackBaselineOption: string;
    saveConflict: string;
    saveSuccess: string;
    loadSettingsError: string;
    saveSettingsError: string;
    environmentStatus: string;
    userRole: string;
    adminRole: string;
    level: string;
    showFilters: string;
    hideFilters: string;
    rawEvents: string;
  };
  userRoles: {
    user: string;
    admin: string;
  };
  userStatuses: {
    all: string;
    pending: string;
    approved: string;
    rejected: string;
    suspended: string;
    profileRequired: string;
  };
  adminUsers: {
    search: string;
    searchAriaLabel: string;
    searchPlaceholder: string;
    status: string;
    statusFilter: string;
    roleFilter: string;
    levelFilter: string;
    mobileStatusFilter: string;
    mobileRoleFilter: string;
    mobileLevelFilter: string;
    pageSize: string;
    pendingStatus: string;
    activeStatus: string;
    suspendedStatus: string;
    activate: string;
    loadedUsersPrefix: string;
    loadedUsersOf: string;
    loadingMoreUsers: string;
    usersTable: string;
    access: string;
    accessControlsFor: string;
    audit: string;
    auditDetails: string;
    auditFor: string;
    showAuditDetailsFor: string;
    actions: string;
    effectiveLevel: string;
    selfAccessBlocked: string;
    saving: string;
    saved: string;
    saveError: string;
    suspendTitle: string;
    confirmAccessChangeTitle: string;
    suspendMessagePrefix: string;
    accessChangeMessagePrefix: string;
    auditLoading: string;
    auditUnavailable: string;
    noRecentAccessChanges: string;
    changedBy: string;
    userId: string;
    roleFor: string;
    userRoleFor: string;
    adminRoleFor: string;
    statusFor: string;
    levelFor: string;
    adminLevelAccess: string;
    changeRole: string;
    changeStatus: string;
    changeLevel: string;
    auditChangeTypes: {
      levelChanged: string;
      profileChanged: string;
      roleChanged: string;
      statusChanged: string;
    };
  };
  adminUsage: {
    metrics: {
      estimatedCost: string;
      calls: string;
      totalTokens: string;
      errors: string;
    };
    filters: string;
    filterIntro: string;
    basics: string;
    advancedFilters: string;
    from: string;
    to: string;
    timeBucket: string;
    providerFilter: string;
    modelFilter: string;
    componentFilter: string;
    userIdFilter: string;
    promptTypeFilter: string;
    serviceFilter: string;
    operationFilter: string;
    all: string;
    day: string;
    hour: string;
    groupBy: string;
    groupByAriaPrefix: string;
    applyFilters: string;
    resetFilters: string;
    aggregateTable: string;
    dailyAggregateTable: string;
    hourlyAggregateTable: string;
    dateColumn: string;
    hourColumn: string;
    sortedNewestFirst: string;
    sortingNewestDays: string;
    sortingNewestHours: string;
    highlights: string;
    highestUsage: string;
    highestCost: string;
    noErrorsRecorded: string;
    errorsRecorded: string;
    noExtraFilters: string;
    loadingAggregates: string;
    noUsage: string;
    noFilteredUsage: string;
    tokenMetricHelp: string;
    rawEventsDescription: string;
    rawEventsTable: string;
    rawEventsSummary: string;
    user: string;
    service: string;
    action: string;
    status: string;
    statusOk: string;
    statusErrorPrefix: string;
    costAriaLabel: string;
    tokensAriaLabel: string;
    loadAggregatesError: string;
    loadRawEventsError: string;
    loadUserDirectoryError: string;
    loadDimensionsError: string;
    groupByLabels: {
      timeBucket: string;
      provider: string;
      model: string;
      userId: string;
      service: string;
      component: string;
      operation: string;
      promptType: string;
    };
    groupByAriaLabels: {
      timeBucket: string;
      provider: string;
      model: string;
      userId: string;
      service: string;
      component: string;
      operation: string;
      promptType: string;
    };
  };
  usageSources: {
    components: Record<string, string>;
    operations: Record<string, string>;
    promptTypes: Record<string, string>;
    services: Record<string, string>;
  };
  adminKnowledge: {
    subtitle: string;
    add: string;
    addCategory: string;
    addSection: string;
    addPage: string;
    addMenuCreateManually: string;
    addCategoryDescription: string;
    addSectionDescription: string;
    addPageDescription: string;
    page: string;
    pages: string;
    category: string;
    allCategories: string;
    allCategoriesHelp: string;
    categorySettings: string;
    loadedPages: string;
    showMorePages: string;
    openPage: string;
    subpages: string;
    noPagesInCategory: string;
    subpagesTitle: string;
    pageHasSubpages: string;
    categoryTitle: string;
    categoryAccess: string;
    categoryRequiredLevel: string;
    createCategory: string;
    sectionCategory: string;
    sectionTitle: string;
    noCategories: string;
    createSection: string;
    pageUnavailable: string;
    missingPageRecovery: string;
    missingPageMessage: string;
    backToKnowledgeBase: string;
    loading: string;
    loadingPage: string;
    loadingPageMessage: string;
    choosePage: string;
    choosePageMessage: string;
    assistantContentStatus: string;
    selectedKnowledgePage: string;
    assistantSyncBusy: string;
    assistantSyncResultPrefix: string;
    synced: string;
    skipped: string;
    failed: string;
    accessJobs: string;
    pageEditor: string;
    pageEditorEmpty: string;
    newPage: string;
    editPage: string;
    pageActions: string;
    syncPage: string;
    reindexPage: string;
    deletePage: string;
    publishPageDescription: string;
    reindexPageDescription: string;
    deletePageDescription: string;
    pageAlreadyPublishedDescription: string;
    contentQualityBlockerDescription: string;
    pageDangerZone: string;
    savePageEdits: string;
    selectedPageStatus: string;
    access: string;
    accessFor: string;
    pageDetails: string;
    pageTitle: string;
    section: string;
    noSection: string;
    markdownPreview: string;
    createPage: string;
    savePage: string;
    pageSubmitDisabledHelp: string;
    source: string;
    sourceType: string;
    sourceUrl: string;
    sourceUrlRequired: string;
    sourceLabel: string;
    sourceLabelHelp: string;
    sourceManual: string;
    sourceExternal: string;
    relationships: string;
    relatedTo: string;
    linksTo: string;
    supersedes: string;
    deletePageTitle: string;
    deletePageMessagePrefix: string;
    deletePageMessageSuffix: string;
    updateAssistantTitle: string;
    updateAssistant: string;
    updateAssistantDescription: string;
    updateAssistantConfirmation: string;
    publishAll: string;
    savedUnpublishedTitle: string;
    savedUnpublishedMessage: string;
    savedUnpublishedNavigationConfirm: string;
    unpublishedChange: string;
    unpublishedChangeCountOne: string;
    unpublishedChangeCountMany: string;
    pagesToSync: string;
    queuedAccessJobs: string;
    embeddingCostNotice: string;
    search: string;
    searchAriaLabel: string;
    noSearchResults: string;
    accessSettingsFor: string;
    accessSettingsDescriptionPrefix: string;
    accessSettingsDescriptionSuffix: string;
    accessSettingsScope: string;
    accessQuestion: string;
    accessEveryoneLabel: string;
    accessEveryoneHelp: string;
    accessLevelLabel: string;
    accessLevelHelp: string;
    accessPrivateLabel: string;
    accessPrivateHelp: string;
    accessPublishAfterSave: string;
    accessSaveSuccess: string;
    requiredLevel: string;
    requiredLevelFor: string;
    saveAccess: string;
    unsaved: string;
    statusReady: string;
    statusReadyForAnswers: string;
    statusNeedsAttention: string;
    statusNeedsUpdate: string;
    assistantNeedsAttention: string;
    assistantUpdating: string;
    assistantReady: string;
    selectPageForReadiness: string;
    duplicateContentTitle: string;
    duplicateContentDescription: string;
    duplicateContentItemsTitle: string;
    duplicateContentLines: string;
    duplicateContentLineJoiner: string;
    duplicateContentIntentionalHint: string;
    acknowledgeDuplicateContent: string;
    duplicateAcknowledgementReasonLabel: string;
    duplicateAcknowledgementHelp: string;
    confirmDuplicateAcknowledgement: string;
    duplicateAcknowledgedMessage: string;
    answerReadiness: string;
    status: string;
    details: string;
    answers: string;
    update: string;
    index: string;
    materials: string;
    indexingError: string;
    syncError: string;
    accessSyncError: string;
    actionFailed: string;
  };
  knowledgeAccess: {
    public: string;
    approved: string;
    level: string;
    excluded: string;
    manual: string;
  };
  knowledge: {
    syncRequiredAction: string;
    sourcesStatus: string;
    retrievalReady: string;
    retrievalBlocked: string;
  };
  commonActions: {
    approve: string;
    reject: string;
    suspend: string;
    unsuspend: string;
    saveChanges: string;
    reset: string;
    confirm: string;
    cancel: string;
    close: string;
    delete: string;
    more: string;
    actions: string;
    filters: string;
    loadMore: string;
  };
  status: {
    loading: string;
    ready: string;
    offline: string;
    error: string;
  };
  errors: {
    generic: string;
    offlineSend: string;
  };
}

export const appMessages: Record<Locale, AppMessages> = {
  pl: {
    shell: {
      productName: 'Fishing Assistant',
      workspaceTitle: 'Asystent wędkarski',
      adminTitle: 'Admin',
      primaryNavigation: 'Główna nawigacja',
      openNavigation: 'Otwórz nawigację',
      closeNavigation: 'Zamknij nawigację',
      collapseSidebar: 'Zwiń panel boczny',
      expandSidebar: 'Rozwiń panel boczny',
      accountSettings: 'Ustawienia konta',
      language: 'Język',
      skipToContent: 'Pomiń do treści',
      logout: 'Wyloguj',
    },
    chat: {
      navLabel: 'Czat',
      newChat: 'Nowy chat',
      conversations: 'Rozmowy',
      noConversations: 'Brak rozmów',
      untitledConversation: 'Bez tytułu',
      emptyConversationPreview: 'Jeszcze bez pytania',
      failedAnswerBadge: 'Do ponowienia',
      failedConversationPreview: 'Odpowiedź nie została ukończona',
      startHeading: 'O co chcesz zapytać?',
      startBody: 'Zacznij od łowiska, metody, przynęty albo problemu z ostatniej sesji.',
      suggestionsLabel: 'Kluczowe tematy',
      starterPrompts: ['Zapytaj o warunki', 'Dobierz kolejny krok', 'Zapytaj o zmiane planu'],
      composerLabel: 'Pytanie',
      composerPlaceholder: 'Zapytaj o łowisko, metodę albo sprzęt',
      followUpPlaceholder: 'Dopytaj o szczegóły',
      sendMessage: 'Wyślij wiadomość',
      answerLanguageHint:
        'Przełącznik zmienia język interfejsu. Odpowiedź dopasuje się do języka pytania.',
      assistantName: 'FA',
      userName: 'Ty',
      draftAnswer: 'Szkic odpowiedzi',
      findingSources: 'Szukam w Bazie Wiedzy...',
      writingAnswer: 'Układam odpowiedź...',
      checkingAnswer: 'Jeszcze przygotowuję odpowiedź...',
      longRunningAnswer: 'Jeszcze przygotowuję odpowiedź...',
      preparingSources: 'Opracowuję listę źródeł...',
      partialDraftNotice:
        'Nie udało mi się w pełni potwierdzić tej odpowiedzi w źródłach. Potraktuj ją jako wskazówkę albo doprecyzuj pytanie.',
      sourcesUsed: 'Wykorzystane źródła',
      sourceFallbackLabel: 'Źródło {number}',
      showAllSources: 'Pokaż wszystkie źródła',
      showAdditionalSources: 'Pokaż {count} dodatkowe źródła',
      hideAdditionalSources: 'Ukryj {count} dodatkowe źródła',
      whatIsMissing: 'Do doprecyzowania',
      openSource: 'Otwórz źródło',
      unsafeSourceHidden: 'Link źródła ukryty',
      knowledgeBaseSource: 'Źródło z Bazy Wiedzy',
      sourceViewerTitle: 'Źródło z Bazy Wiedzy',
      sourceViewerBack: 'Wróć do czatu',
      sourceViewerLoading: 'Ładowanie źródła',
      sourceViewerLoadFailed: 'Nie udało się wczytać źródła.',
      sourceViewerUpdated: 'Zaktualizowano',
      noEvidence: 'Nie znalazłem wystarczająco dużo w Bazie Wiedzy, żeby odpowiedzieć pewnie.',
      conversationDeleteTitle: 'Usunąć rozmowę?',
      conversationDeleteBody: 'Ta akcja usunie rozmowę {title} z historii.',
      conversationLoading: 'Ładowanie rozmowy',
      conversationLoadFailed: 'Nie udało się wczytać rozmowy',
      conversationUnavailable: 'Ta rozmowa nie jest już dostępna.',
      conversationRecoveryHint: 'Możesz rozpocząć nowy chat albo wybrać inną rozmowę z historii.',
      conversationRefreshHint: 'Spróbuj odświeżyć rozmowę.',
      conversationEmptyTitle: 'Ta rozmowa jest pusta',
      conversationEmptyBody: 'Możesz zadać pytanie albo wybrać nowy chat.',
      answerGenerationFailed: 'Nie udało się wygenerować odpowiedzi. Spróbuj ponownie.',
      answerGenerationFailedBody: 'Nie udało mi się dokończyć tej odpowiedzi. Spróbuj ponownie.',
      answerGenerationTimedOut: 'Generowanie odpowiedzi trwało zbyt długo.',
      retryAnswer: 'Ponów',
      cancelAnswer: 'Przerwij',
      answerGapShareTitle: 'Nie mamy tego w Bazie Wiedzy',
      answerGapShareBody:
        'Do zgłoszenia zawsze dołączymy opis braku, pytanie, próg dostępu, datę i techniczne identyfikatory zgłoszenia. Opcjonalnie dołącz kontekst rozmowy lub kontakt, żeby administrator mógł trafniej uzupełnić materiał albo wrócić do Ciebie z pytaniem.',
      answerGapShareContext: 'Dołącz kontekst rozmowy',
      answerGapShareContact: 'Dołącz mój kontakt',
      answerGapShareButton: 'Zgłoś brak',
      answerGapDeclineButton: 'Nie teraz',
      answerGapWithdrawButton: 'Usuń kontekst i kontakt',
      answerGapShared: 'Zgłoszenie wysłane administratorowi',
      answerGapWithdrawn: 'Kontekst i kontakt usunięte ze zgłoszenia',
      answerGapActionFailed: 'Nie udało się zapisać decyzji.',
      queueFollowUp: 'Wyślij po odpowiedzi',
      queuedFollowUpPlaceholder: 'Pytanie czeka w kolejce',
      editQueuedFollowUp: 'Edytuj zakolejkowane pytanie',
      removeQueuedFollowUp: 'Usuń zakolejkowane pytanie',
    },
    usage: {
      navLabel: 'Użycie',
      title: 'Użycie',
      subtitle: 'Szacowany koszt AI i ostatnia aktywność na Twoim koncie.',
      estimatedCost: 'Szacowany koszt',
      calls: 'Operacje AI',
      tokens: 'Tokeny',
      reportPeriod: 'Okres',
      timezone: 'Strefa czasu',
      refreshed: 'Odświeżono',
      estimateNotice: 'Koszty są szacowane i mogą się zmienić po przetworzeniu użycia.',
      recentActivity: 'Ostatnia aktywność',
      showDetails: 'Pokaż szczegóły',
      hideDetails: 'Ukryj szczegóły',
      noEvents: 'Brak użycia',
      loadError: 'Nie można teraz wczytać użycia.',
      details: 'Szczegóły użycia',
      activityTime: 'Czas',
      created: 'Utworzono',
      model: 'Model',
      component: 'Komponent',
      promptType: 'Typ promptu',
      operation: 'Operacja',
      cost: 'Koszt',
    },
    admin: {
      administration: 'Administracja',
      pendingRequests: 'Oczekujące prośby',
      pendingRequestsSubtitle: 'Sprawdź nowe prośby o dostęp, zanim użytkownik otworzy chat.',
      noPendingRequests: 'Brak oczekujących próśb',
      noPendingRequestsBody:
        'Nowe prośby użytkowników pojawią się tutaj, zanim zostanie odblokowany dostęp do chatu. Możesz odświeżyć kolejkę albo przejść do innej części panelu admina.',
      pendingRequestsLastChecked: 'Ostatnio sprawdzono',
      pendingRequestsRefresh: 'Odśwież prośby',
      pendingRequestsUsers: 'Zobacz wszystkich użytkowników',
      pendingRequestsUsage: 'Otwórz Użycie',
      pendingRequestsKnowledge: 'Otwórz Bazę Wiedzy',
      pendingUserFallback: 'Oczekujący użytkownik',
      pendingRejectTitle: 'Odrzucić prośbę?',
      pendingSuspendTitle: 'Zawiesić prośbę?',
      pendingAccessChangeMessagePrefix: 'Ta zmiana dotyczy dostępu dla',
      pendingAccessChangeMessageSuffix: 'Użytkowników możesz sprawdzić później.',
      users: 'Użytkownicy',
      usersSubtitle: 'Zarządzaj dostępem bez czytania technicznych identyfikatorów.',
      noUsers: 'Brak użytkowników dla tych filtrów',
      knowledgeBase: 'Baza Wiedzy',
      knowledgeBaseInline: 'Bazie Wiedzy',
      answerGaps: 'Luki w wiedzy',
      answerGapsRequiresAnswer: 'Wymaga odpowiedzi',
      answerGapsAll: 'Wszystkie',
      markAnswerGapDone: 'Oznacz jako gotowe',
      noAnswerGapsRequireAttention: 'Brak braków odpowiedzi wymagających uwagi',
      noAnswerGapsRecorded: 'Brak zapisanych braków odpowiedzi',
      answerGapsSubtitle:
        'Najpierw brakująca informacja i kontekst, dopiero potem szczegóły techniczne.',
      gapQuestion: 'Pytanie użytkownika',
      gapOrigin: 'Dlaczego powstała luka',
      gapOriginNoAccessibleEvidence:
        'Asystent nie znalazł dostępnego materiału w Bazie Wiedzy, który pozwala odpowiedzieć bez zgadywania.',
      gapOriginUnsupportedEvidence:
        'Asystent znalazł temat, ale dostępne materiały nie dawały wystarczającej podstawy do odpowiedzi.',
      previewConversation: 'Szczegóły zgłoszenia',
      conversationPreviewContext: 'Kontekst rozmowy',
      conversationPreviewSnapshotNote:
        'To jest migawka z chwili zgłoszenia. Pokazuje tylko zakres rozmowy i kontaktu zapisany dla tej luki.',
      conversationPreviewNoContext: 'Brak zapisanej migawki rozmowy dla tej luki.',
      conversationPreviewUserRole: 'Użytkownik',
      conversationPreviewAssistantRole: 'Asystent',
      requesterContactHidden: 'Kontakt nieudostępniony',
      answerGapConsentContextShared: 'Kontekst udostępniony',
      answerGapConsentContextHidden: 'Bez kontekstu rozmowy',
      answerGapConsentContactShared: 'Kontakt udostępniony',
      answerGapConsentContactHidden: 'Bez danych kontaktowych',
      answerGapConsentSystemImported: 'Zapis systemowy',
      answerGapConsentWithdrawn: 'Kontekst i kontakt usunięte',
      answerGapAccessLevelIncluded: 'Próg dostępu dołączony',
      answerGapAccessLevelUnknown: 'Próg dostępu nieustalony',
      answerGapCoverageGlobalMissing: 'Brak informacji w Bazie Wiedzy',
      answerGapCoverageUnsupportedAccessible: 'Dostępne materiały nie wystarczyły',
      answerGapCoverageUnknown: 'Pokrycie nieustalone',
      loadedGapsPrefix: 'Wczytano',
      loadedGapsOf: 'z',
      loadingMoreGaps: 'Wczytuję kolejne luki',
      requestedBy: 'Zgłoszone przez',
      userLevel: 'Próg dostępu',
      coverage: 'Zakres zgłoszenia',
      missingInformation: 'Brakujące informacje',
      llmUsage: 'Koszty AI',
      llmUsageSubtitle: 'Koszty zapytań do AI i zużycie w wybranym okresie.',
      rawUsageSubtitle: 'Ostatnie 50 zapytań z wybranego okresu.',
      workspaceGroup: 'Workspace',
      accessGroup: 'Dostęp',
      knowledgeGroup: 'Wiedza',
      reportingGroup: 'Raporty',
      systemGroup: 'System',
      settings: 'Ustawienia',
      settingsSubtitle: 'Kontrole runtime dla tego środowiska.',
      chatModelSection: 'Model chatu',
      activeModel: 'Aktywny model',
      selectedProvider: 'Wybrany dostawca',
      selectedModel: 'Wybrany model',
      unsavedModelSelection: 'Niezapisany wybór',
      unsavedSettingsTitle: 'Niezapisane zmiany',
      unsavedSettingsDescription: 'Zapisz albo cofnij zmiany przed opuszczeniem ustawień modelu.',
      unsavedSettingsConfirm: 'Masz niezapisane zmiany w Ustawieniach. Opuścić bez zapisu?',
      unsavedKnowledgeAccessTitle: 'Niezapisane zmiany dostępu',
      unsavedKnowledgeAccessDescription:
        'Zapisz albo cofnij zmieniony dostęp kategorii przed opuszczeniem Bazy Wiedzy.',
      unsavedKnowledgeAccessChangedCategories: 'Zmienione kategorie',
      unsavedKnowledgeAccessConfirm:
        'Masz niezapisane zmiany dostępu w Bazie Wiedzy. Opuścić bez zapisu?',
      unsavedKnowledgePageTitle: 'Niezapisane zmiany strony',
      unsavedKnowledgePageDescription:
        'Zapisz albo cofnij zmiany edytora przed opuszczeniem strony.',
      unsavedKnowledgePageChangedFields: 'Zmienione pola',
      unsavedKnowledgePageConfirm:
        'Masz niezapisane edycje strony w Bazie Wiedzy. Opuścić bez zapisu?',
      provider: 'Dostawca',
      inputOutputPrice: 'Cena wejścia/wyjścia',
      contextWindow: 'Okno kontekstu',
      structuredOutput: 'Wyjście strukturalne',
      supported: 'Wspierane',
      currentRevision: 'Wersja',
      lastUpdated: 'Ostatnia zmiana',
      operationalEffect:
        'Nowe odpowiedzi chatu użyją zapisanego modelu; odpowiedzi w toku zostają przy modelu startowym.',
      fallbackBaselineOption: 'Opcja fallback/baseline',
      saveConflict:
        'Ustawienia zmieniły się przed zapisem. Aktualny stan został wczytany ponownie.',
      saveSuccess: 'Zapisano',
      loadSettingsError: 'Nie można teraz wczytać ustawień.',
      saveSettingsError: 'Nie można teraz zapisać ustawień.',
      environmentStatus: 'Status środowiska',
      userRole: 'Rola',
      adminRole: 'Admin',
      level: 'Próg',
      showFilters: 'Filtry',
      hideFilters: 'Ukryj filtry',
      rawEvents: 'Pojedyncze zapytania',
    },
    userRoles: {
      user: 'Użytkownik',
      admin: 'Admin',
    },
    userStatuses: {
      all: 'Wszystkie',
      pending: 'Oczekujące',
      approved: 'Zatwierdzone',
      rejected: 'Odrzucone',
      suspended: 'Zawieszone',
      profileRequired: 'Wymaga profilu',
    },
    adminUsers: {
      search: 'Szukaj',
      searchAriaLabel: 'Szukaj użytkowników',
      searchPlaceholder: 'Imię, nazwisko albo email',
      status: 'Status',
      statusFilter: 'Filtr statusu',
      roleFilter: 'Filtr roli',
      levelFilter: 'Filtr progu',
      mobileStatusFilter: 'Mobilny filtr statusu',
      mobileRoleFilter: 'Mobilny filtr roli',
      mobileLevelFilter: 'Mobilny filtr progu',
      pageSize: 'Rozmiar strony',
      pendingStatus: 'Oczekujący',
      activeStatus: 'Aktywny',
      suspendedStatus: 'Zawieszony',
      activate: 'Aktywuj',
      loadedUsersPrefix: 'Wczytano',
      loadedUsersOf: 'z',
      loadingMoreUsers: 'Wczytuję kolejnych użytkowników',
      usersTable: 'Użytkownicy',
      access: 'Dostęp',
      accessControlsFor: 'Kontrole dostępu dla',
      audit: 'Audyt',
      auditDetails: 'Szczegóły',
      auditFor: 'Audyt dla',
      showAuditDetailsFor: 'Pokaż szczegóły audytu dla',
      actions: 'Akcje',
      effectiveLevel: 'Próg efektywny',
      selfAccessBlocked: 'Nie możesz zmienić własnego dostępu',
      saving: 'Zapisywanie',
      saved: 'Zapisano',
      saveError: 'Błąd',
      suspendTitle: 'Zawiesić użytkownika?',
      confirmAccessChangeTitle: 'Potwierdzić zmianę dostępu?',
      suspendMessagePrefix: 'To natychmiast blokuje dostęp do chatu dla',
      accessChangeMessagePrefix: 'Ta zmiana zostanie zastosowana po potwierdzeniu dla',
      auditLoading: 'Wczytywanie audytu',
      auditUnavailable: 'Audyt niedostępny',
      noRecentAccessChanges: 'Brak ostatnich zmian dostępu',
      changedBy: 'Przez',
      userId: 'ID użytkownika',
      roleFor: 'Rola dla',
      userRoleFor: 'Rola użytkownika dla',
      adminRoleFor: 'Rola admina dla',
      statusFor: 'Status dla',
      levelFor: 'Próg dla',
      adminLevelAccess: 'Admini mają dostęp progu 10.',
      changeRole: 'rola',
      changeStatus: 'status',
      changeLevel: 'próg',
      auditChangeTypes: {
        levelChanged: 'Zmieniono próg',
        profileChanged: 'Zmieniono profil',
        roleChanged: 'Zmieniono rolę',
        statusChanged: 'Zmieniono status',
      },
    },
    adminUsage: {
      metrics: {
        estimatedCost: 'Koszt',
        calls: 'Zapytania AI',
        totalTokens: 'Zużyte tokeny',
        errors: 'Błędy',
      },
      filters: 'Filtry',
      filterIntro: 'Zacznij od daty, dostawcy i modelu; zaawansowane filtry służą do diagnostyki.',
      basics: 'Podstawowe',
      advancedFilters: 'Zaawansowane filtry',
      from: 'Od',
      to: 'Do',
      timeBucket: 'Widok',
      providerFilter: 'Filtr dostawcy',
      modelFilter: 'Filtr modelu',
      componentFilter: 'Filtr komponentu',
      userIdFilter: 'Filtr użytkownika',
      promptTypeFilter: 'Filtr typu promptu',
      serviceFilter: 'Filtr usługi',
      operationFilter: 'Filtr operacji',
      all: 'Wszystkie',
      day: 'Dziennie',
      hour: 'Godzinowo',
      groupBy: 'Grupuj według',
      groupByAriaPrefix: 'Grupuj według',
      applyFilters: 'Zastosuj filtry',
      resetFilters: 'Cofnij filtry',
      aggregateTable: 'Podsumowanie użycia',
      dailyAggregateTable: 'Użycie dzienne',
      hourlyAggregateTable: 'Użycie godzinowe',
      dateColumn: 'Data',
      hourColumn: 'Godzina',
      sortedNewestFirst: 'sortowanie od najnowszych',
      sortingNewestDays: 'Sortowanie: najnowsze dni',
      sortingNewestHours: 'Sortowanie: najnowsze godziny',
      highlights: 'Najważniejsze',
      highestUsage: 'Największe użycie: {date}',
      highestCost: 'Największy koszt: {date}',
      noErrorsRecorded: 'Brak błędów',
      errorsRecorded: 'Liczba błędów: {count}',
      noExtraFilters: 'Bez dodatkowych filtrów',
      loadingAggregates: 'Ładuję dane użycia AI...',
      noUsage: 'Brak użycia AI w tym okresie.',
      noFilteredUsage: 'Brak wyników dla wybranych filtrów.',
      tokenMetricHelp: 'Miara zużycia modelu AI.',
      rawEventsDescription: 'Ostatnie 50 zapytań z wybranego okresu.',
      rawEventsTable: 'Pojedyncze zapytania AI',
      rawEventsSummary: 'Podsumowanie pojedynczych zapytań AI',
      user: 'Użytkownik',
      service: 'Usługa',
      action: 'Akcja',
      status: 'Status',
      statusOk: 'OK',
      statusErrorPrefix: 'Błąd',
      costAriaLabel: 'koszt',
      tokensAriaLabel: 'tokeny',
      loadAggregatesError: 'Nie można teraz wczytać raportu użycia.',
      loadRawEventsError: 'Nie można teraz wczytać pojedynczych zapytań.',
      loadUserDirectoryError: 'Nie można teraz wczytać etykiet użytkowników użycia.',
      loadDimensionsError: 'Nie można teraz wczytać wymiarów filtrów użycia.',
      groupByLabels: {
        timeBucket: 'Data',
        provider: 'Dostawca',
        model: 'Model',
        userId: 'Użytkownik',
        service: 'Usługa',
        component: 'Komponent',
        operation: 'Operacja',
        promptType: 'Typ promptu',
      },
      groupByAriaLabels: {
        timeBucket: 'daty',
        provider: 'dostawcy',
        model: 'modelu',
        userId: 'użytkownika',
        service: 'usługi',
        component: 'komponentu',
        operation: 'operacji',
        promptType: 'typu promptu',
      },
    },
    usageSources: {
      components: {
        'rag-chat': 'Chat z wiedzą',
        'query-embedding': 'Wyszukiwanie w wiedzy',
      },
      operations: {
        'chat.completion': 'Generowanie treści',
        'chat.stream': 'Odpowiedź asystenta',
        embedding: 'Przygotowanie wyszukiwania',
      },
      promptTypes: {
        'fishing-answer': 'Odpowiedź wędkarska',
        'chat-assistant': 'Asystent czatu',
        'rag-query-embedding': 'Wyszukiwanie podobnych materiałów',
      },
      services: {
        'chat-service': 'Chat',
        'knowledge-service': 'Baza Wiedzy',
        'llm-usage-service': 'Raport użycia',
        'user-service': 'Użytkownicy',
      },
    },
    adminKnowledge: {
      subtitle: 'Edytuj treść i publikuj zmiany, żeby asystent używał ich w odpowiedziach.',
      add: 'Dodaj',
      addCategory: 'Dodaj kategorię',
      addSection: 'Dodaj sekcję',
      addPage: 'Dodaj stronę',
      addMenuCreateManually: 'Utwórz ręcznie',
      addCategoryDescription: 'Główny zbiór materiałów, np. Taktyka feederowa.',
      addSectionDescription: 'Grupa stron w kategorii.',
      addPageDescription: 'Pojedynczy materiał dla asystenta.',
      page: 'Strona',
      pages: 'Strony',
      category: 'Kategoria',
      allCategories: 'Wszystkie kategorie',
      allCategoriesHelp:
        'Pokazujemy strony ze wszystkich kategorii. Wybierz kategorię, aby zmienić dostęp dla jej stron.',
      categorySettings: 'Zmień dostęp kategorii',
      loadedPages: 'Pokazano {shown} z {total} stron',
      showMorePages: 'Pokaż więcej',
      openPage: 'Otwórz',
      subpages: 'podstron',
      noPagesInCategory: 'Brak stron w tej kategorii.',
      subpagesTitle: 'Podstrony',
      pageHasSubpages: 'Ta strona ma {count} podstron.',
      categoryTitle: 'Tytuł kategorii',
      categoryAccess: 'Dostęp kategorii',
      categoryRequiredLevel: 'Wymagany próg kategorii',
      createCategory: 'Utwórz kategorię',
      sectionCategory: 'Kategoria sekcji',
      sectionTitle: 'Tytuł sekcji',
      noCategories: 'Brak kategorii',
      createSection: 'Utwórz sekcję',
      pageUnavailable: 'Strona niedostępna',
      missingPageRecovery: 'Odzyskiwanie brakującej strony wiedzy',
      missingPageMessage:
        'Nie można wczytać wybranej strony Bazy Wiedzy. Wróć do Bazy Wiedzy albo wybierz inną dostępną stronę poniżej.',
      backToKnowledgeBase: 'Wróć do Bazy Wiedzy',
      loading: 'Wczytywanie...',
      loadingPage: 'Wczytywanie strony',
      loadingPageMessage: 'Pobieram wybraną stronę wiedzy.',
      choosePage: 'Wybierz stronę',
      choosePageMessage: 'Wybierz dostępną stronę z drzewa.',
      assistantContentStatus: 'Status treści asystenta',
      selectedKnowledgePage: 'Wybrana strona wiedzy',
      assistantSyncBusy: 'Publikuję zapisane zmiany dla asystenta.',
      assistantSyncResultPrefix: 'Ostatnia publikacja',
      synced: 'opublikowano',
      skipped: 'pominięto',
      failed: 'błędy',
      accessJobs: 'zadania dostępu',
      pageEditor: 'Edytor strony',
      pageEditorEmpty: 'Wybierz stronę do edycji albo użyj Dodaj, żeby utworzyć nową stronę.',
      newPage: 'Nowa strona',
      editPage: 'Edytuj stronę',
      pageActions: 'Akcje strony',
      syncPage: 'Opublikuj stronę',
      reindexPage: 'Zindeksuj ponownie',
      deletePage: 'Usuń stronę',
      publishPageDescription:
        'Publikuje zapisaną wersję tej strony, żeby asystent używał jej w odpowiedziach.',
      reindexPageDescription:
        'Odświeża wyszukiwanie dla tej strony, gdy asystent nie znajduje aktualnej treści.',
      deletePageDescription: 'Usuwa stronę z Bazy Wiedzy i przyszłych odpowiedzi asystenta.',
      pageAlreadyPublishedDescription: 'Ta strona jest już aktualna dla asystenta.',
      contentQualityBlockerDescription:
        'Rozwiąż sprawdzenie treści przed publikacją albo ponownym indeksowaniem.',
      pageDangerZone: 'Usuwanie',
      savePageEdits: 'Zapisz edycje strony',
      selectedPageStatus: 'Status wybranej strony',
      access: 'Dostęp',
      accessFor: 'Dostęp dla',
      pageDetails: 'Szczegóły strony',
      pageTitle: 'Tytuł strony',
      section: 'Sekcja',
      noSection: 'Brak sekcji',
      markdownPreview: 'Podgląd Markdown',
      createPage: 'Utwórz szkic strony',
      savePage: 'Zapisz zmiany',
      pageSubmitDisabledHelp: 'Uzupełnij tytuł, treść, kategorię i link źródłowy.',
      source: 'Materiał źródłowy',
      sourceType: 'Typ źródła',
      sourceUrl: 'Link źródłowy',
      sourceUrlRequired: 'Dodaj link źródłowy.',
      sourceLabel: 'Nazwa źródła',
      sourceLabelHelp: 'Pomaga opisać materiał źródłowy w administracji.',
      sourceManual: 'Ręczne',
      sourceExternal: 'Zewnętrzne',
      relationships: 'Relacje',
      relatedTo: 'Powiązane z',
      linksTo: 'Linkuje do',
      supersedes: 'Zastępuje',
      deletePageTitle: 'Usunąć stronę wiedzy?',
      deletePageMessagePrefix: 'Ta strona zostanie usunięta:',
      deletePageMessageSuffix: 'nie pojawi się w przyszłych odpowiedziach asystenta.',
      updateAssistantTitle: 'Opublikować zapisane zmiany dla asystenta?',
      updateAssistant: 'Opublikuj zmiany dla asystenta',
      updateAssistantDescription:
        'Publikuje zapisane zmiany w Bazie Wiedzy, żeby przyszłe odpowiedzi ich używały.',
      updateAssistantConfirmation:
        'Opublikowane zostaną tylko zapisane zmiany. Po zakończeniu asystent będzie używał ich w kolejnych odpowiedziach.',
      publishAll: 'Opublikuj wszystkie',
      savedUnpublishedTitle: 'Zapisana nieopublikowana wersja asystenta',
      savedUnpublishedMessage: 'Zapisano. Asystent jeszcze nie używa tej wersji.',
      savedUnpublishedNavigationConfirm:
        'Ta strona jest zapisana, ale asystent nadal używa poprzedniej wersji.',
      unpublishedChange: 'Nieopublikowana',
      unpublishedChangeCountOne: '1 nieopublikowana zmiana',
      unpublishedChangeCountMany: '{count} nieopublikowane zmiany',
      pagesToSync: 'Strony do opublikowania',
      queuedAccessJobs: 'Zadania dostępu w kolejce',
      embeddingCostNotice: 'Publikowanie może potrwać od kilku sekund do kilku minut.',
      search: 'Szukaj',
      searchAriaLabel: 'Szukaj w Bazie Wiedzy',
      noSearchResults: 'Żadne strony ani foldery Bazy Wiedzy nie pasują do wyszukiwania.',
      accessSettingsFor: 'Ustawienia dostępu dla',
      accessSettingsDescriptionPrefix: 'Zmiany obejmą',
      accessSettingsDescriptionSuffix: 'oraz podpięte sekcje i strony.',
      accessSettingsScope: 'Zmiana obejmie tę kategorię oraz wszystkie jej sekcje i strony.',
      accessQuestion: 'Kto może dostawać odpowiedzi z tych materiałów?',
      accessEveryoneLabel: 'Wszyscy zatwierdzeni użytkownicy',
      accessEveryoneHelp:
        'Asystent może używać tych materiałów dla każdego zatwierdzonego użytkownika.',
      accessLevelLabel: 'Użytkownicy od progu',
      accessLevelHelp:
        'Asystent użyje tych materiałów tylko dla użytkowników z tym progiem lub wyższym.',
      accessPrivateLabel: 'Nie używaj w odpowiedziach',
      accessPrivateHelp:
        'Materiał zostaje w panelu admina, ale asystent go nie wyszukuje dla użytkowników.',
      accessPublishAfterSave:
        'Po zapisaniu opublikuj zmiany dla asystenta, żeby nowe zasady dostępu zaczęły obowiązywać w odpowiedziach.',
      accessSaveSuccess:
        'Dostęp zapisany dla kategorii. Opublikuj zmiany dla asystenta, żeby nowe zasady dostępu zaczęły obowiązywać w odpowiedziach.',
      requiredLevel: 'Wymagany próg',
      requiredLevelFor: 'Wymagany próg dla',
      saveAccess: 'Zapisz dostęp',
      unsaved: 'Niezapisane',
      statusReady: 'Aktualna',
      statusReadyForAnswers: 'Aktualna',
      statusNeedsAttention: 'Wymaga uwagi',
      statusNeedsUpdate: 'Nieopublikowana',
      assistantNeedsAttention: 'Materiały asystenta wymagają uwagi',
      assistantUpdating: 'Materiały asystenta są aktualizowane',
      assistantReady: 'Wszystko aktualne',
      selectPageForReadiness:
        'Wybierz stronę, aby sprawdzić, czy materiał jest gotowy do odpowiedzi.',
      duplicateContentTitle: 'Sprawdzenie treści wymaga uwagi',
      duplicateContentDescription:
        'Automatyczne sprawdzenie znalazło powtórzone sąsiadujące fragmenty. Takie powtórzenia pogarszają jakość odpowiedzi asystenta, dlatego usuń jeden z powtórzonych fragmentów przed publikacją.',
      duplicateContentItemsTitle: 'Powtórzenia:',
      duplicateContentLines: 'linie',
      duplicateContentLineJoiner: 'i',
      duplicateContentIntentionalHint:
        'Jeśli powtórzenie ma zostać, oznacz je jako celowe dla tej wersji materiału.',
      acknowledgeDuplicateContent: 'To powtórzenie jest celowe',
      duplicateAcknowledgementReasonLabel: 'Wyjaśnienie (opcjonalnie)',
      duplicateAcknowledgementHelp:
        'Użyj tego tylko wtedy, gdy powtórzone linie są potrzebne w materiale.',
      confirmDuplicateAcknowledgement: 'Potwierdź celowe powtórzenie',
      duplicateAcknowledgedMessage: 'Powtórzenie oznaczone jako celowe dla tej wersji.',
      answerReadiness: 'Gotowość odpowiedzi',
      status: 'Status',
      details: 'Szczegóły',
      answers: 'Odpowiedzi',
      update: 'Aktualizacja',
      index: 'Indeks',
      materials: 'Materiały',
      indexingError: 'Błąd indeksowania',
      syncError: 'Błąd synchronizacji',
      accessSyncError: 'Błąd synchronizacji dostępu',
      actionFailed: 'Akcja Bazy Wiedzy nie powiodła się.',
    },
    knowledgeAccess: {
      public: 'Wszyscy',
      approved: 'Wszyscy',
      level: 'Próg',
      excluded: 'Nie w odpowiedziach',
      manual: 'ręczny',
    },
    knowledge: {
      syncRequiredAction: 'Zsynchronizuj teraz, żeby chat mógł używać tej strony.',
      sourcesStatus: 'Status źródeł',
      retrievalReady: 'Gotowe do odpowiedzi',
      retrievalBlocked: 'Zablokowane dla odpowiedzi',
    },
    commonActions: {
      approve: 'Zatwierdź',
      reject: 'Odrzuć',
      suspend: 'Zawieś',
      unsuspend: 'Odwieś',
      saveChanges: 'Zapisz zmiany',
      reset: 'Cofnij',
      confirm: 'Potwierdź',
      cancel: 'Anuluj',
      close: 'Zamknij',
      delete: 'Usuń',
      more: 'Więcej',
      actions: 'Akcje',
      filters: 'Filtry',
      loadMore: 'Wczytaj więcej',
    },
    status: {
      loading: 'Wczytywanie',
      ready: 'Gotowe',
      offline: 'Jesteś offline',
      error: 'Błąd',
    },
    errors: {
      generic: 'Coś poszło nie tak.',
      offlineSend: 'Jesteś offline. Połącz się ponownie, żeby wysłać.',
    },
  },
  en: {
    shell: {
      productName: 'Fishing Assistant',
      workspaceTitle: 'Fishing Assistant',
      adminTitle: 'Admin',
      primaryNavigation: 'Primary navigation',
      openNavigation: 'Open navigation',
      closeNavigation: 'Close navigation',
      collapseSidebar: 'Collapse sidebar',
      expandSidebar: 'Expand sidebar',
      accountSettings: 'Account settings',
      language: 'Language',
      skipToContent: 'Skip to content',
      logout: 'Log out',
    },
    chat: {
      navLabel: 'Chat',
      newChat: 'New chat',
      conversations: 'Conversations',
      noConversations: 'No conversations yet',
      untitledConversation: 'Untitled',
      emptyConversationPreview: 'No question yet',
      failedAnswerBadge: 'Retry needed',
      failedConversationPreview: 'Answer was not completed',
      startHeading: 'What would you like to ask?',
      startBody: 'Start with a venue, method, bait, or a problem from your last session.',
      suggestionsLabel: 'Key topics',
      starterPrompts: [
        'Ask about current conditions',
        'Choose the next step',
        'Ask about changing the plan',
      ],
      composerLabel: 'Question',
      composerPlaceholder: 'Ask about a venue, method, or tackle',
      followUpPlaceholder: 'Ask a follow-up',
      sendMessage: 'Send message',
      answerLanguageHint:
        'This switch changes the interface language. Answers follow the language of the question.',
      assistantName: 'FA',
      userName: 'You',
      draftAnswer: 'Draft answer',
      findingSources: 'Searching the Knowledge Base...',
      writingAnswer: 'Composing the answer...',
      checkingAnswer: 'Still preparing the answer...',
      longRunningAnswer: 'Still preparing the answer...',
      preparingSources: 'Preparing the source list...',
      partialDraftNotice:
        'I could not fully verify this answer against sources. Treat it as guidance or refine the question.',
      sourcesUsed: 'Sources used',
      sourceFallbackLabel: 'Source {number}',
      showAllSources: 'Show all sources',
      showAdditionalSources: 'Show {count} more sources',
      hideAdditionalSources: 'Hide {count} additional sources',
      whatIsMissing: 'To clarify',
      openSource: 'Open source',
      unsafeSourceHidden: 'Source link hidden',
      knowledgeBaseSource: 'Knowledge Base source',
      sourceViewerTitle: 'Knowledge Base source',
      sourceViewerBack: 'Back to chat',
      sourceViewerLoading: 'Loading source',
      sourceViewerLoadFailed: 'Unable to load source.',
      sourceViewerUpdated: 'Updated',
      noEvidence: 'I could not find enough in the Knowledge Base to answer confidently.',
      conversationDeleteTitle: 'Delete conversation?',
      conversationDeleteBody: 'This action will remove conversation {title} from history.',
      conversationLoading: 'Loading conversation',
      conversationLoadFailed: 'Unable to load conversation',
      conversationUnavailable: 'This conversation is no longer available.',
      conversationRecoveryHint:
        'You can start a new chat or pick another conversation from history.',
      conversationRefreshHint: 'Try refreshing the conversation.',
      conversationEmptyTitle: 'This conversation is empty',
      conversationEmptyBody: 'You can ask a question or choose a new chat.',
      answerGenerationFailed: 'Answer generation failed. Please try again.',
      answerGenerationFailedBody: 'I could not complete this answer. Please try again.',
      answerGenerationTimedOut: 'Answer generation took too long.',
      retryAnswer: 'Retry',
      cancelAnswer: 'Cancel',
      answerGapShareTitle: 'We do not have this in the Knowledge Base',
      answerGapShareBody:
        'The report always includes the missing-information note, question, access tier, date, and technical report identifiers. Optionally include conversation context or contact details so the administrator can update the material more accurately or follow up with you.',
      answerGapShareContext: 'Include conversation context',
      answerGapShareContact: 'Include my contact',
      answerGapShareButton: 'Report gap',
      answerGapDeclineButton: 'Not now',
      answerGapWithdrawButton: 'Remove context and contact',
      answerGapShared: 'Report sent to the administrator',
      answerGapWithdrawn: 'Context and contact removed from the report',
      answerGapActionFailed: 'Unable to save this decision.',
      queueFollowUp: 'Send after answer',
      queuedFollowUpPlaceholder: 'Question queued',
      editQueuedFollowUp: 'Edit queued question',
      removeQueuedFollowUp: 'Remove queued question',
    },
    usage: {
      navLabel: 'Usage',
      title: 'Usage',
      subtitle: 'Estimated AI cost and recent activity for your account.',
      estimatedCost: 'Estimated cost',
      calls: 'AI operations',
      tokens: 'Tokens',
      reportPeriod: 'Period',
      timezone: 'Timezone',
      refreshed: 'Refreshed',
      estimateNotice: 'Costs are estimated and may change after usage is processed.',
      recentActivity: 'Recent activity',
      showDetails: 'Show details',
      hideDetails: 'Hide details',
      noEvents: 'No usage yet',
      loadError: 'Unable to load usage right now.',
      details: 'Usage details',
      activityTime: 'Time',
      created: 'Created',
      model: 'Model',
      component: 'Component',
      promptType: 'Prompt type',
      operation: 'Operation',
      cost: 'Cost',
    },
    admin: {
      administration: 'Administration',
      pendingRequests: 'Pending requests',
      pendingRequestsSubtitle: 'Review new user access requests before chat opens.',
      noPendingRequests: 'No pending requests right now',
      noPendingRequestsBody:
        'New user requests will appear here before chat access opens. You can refresh the queue or continue with another admin area.',
      pendingRequestsLastChecked: 'Last checked',
      pendingRequestsRefresh: 'Refresh requests',
      pendingRequestsUsers: 'View all users',
      pendingRequestsUsage: 'Open Usage',
      pendingRequestsKnowledge: 'Open Knowledge Base',
      pendingUserFallback: 'Pending user',
      pendingRejectTitle: 'Reject request?',
      pendingSuspendTitle: 'Suspend request?',
      pendingAccessChangeMessagePrefix: 'This changes access for',
      pendingAccessChangeMessageSuffix: 'You can review users later.',
      users: 'Users',
      usersSubtitle: 'Manage access without reading technical identifiers.',
      noUsers: 'No users match the current filters',
      knowledgeBase: 'Knowledge Base',
      knowledgeBaseInline: 'Knowledge Base',
      answerGaps: 'Knowledge gaps',
      answerGapsRequiresAnswer: 'Requires answer',
      answerGapsAll: 'All',
      markAnswerGapDone: 'Mark done',
      noAnswerGapsRequireAttention: 'No answer gaps require attention',
      noAnswerGapsRecorded: 'No answer gaps recorded',
      answerGapsSubtitle: 'Start with the missing information and context, then technical details.',
      gapQuestion: 'User question',
      gapOrigin: 'Why this gap was recorded',
      gapOriginNoAccessibleEvidence:
        'The assistant did not find accessible Knowledge Base material that could answer without guessing.',
      gapOriginUnsupportedEvidence:
        'The assistant found the topic, but the available material was not strong enough to answer.',
      previewConversation: 'Report details',
      conversationPreviewContext: 'Conversation context',
      conversationPreviewSnapshotNote:
        'This is the snapshot from when the gap was reported. It shows only the conversation and contact scope stored for this gap.',
      conversationPreviewNoContext: 'No conversation snapshot was stored for this gap.',
      conversationPreviewUserRole: 'User',
      conversationPreviewAssistantRole: 'Assistant',
      requesterContactHidden: 'Contact not shared',
      answerGapConsentContextShared: 'Context shared',
      answerGapConsentContextHidden: 'No conversation context',
      answerGapConsentContactShared: 'Contact shared',
      answerGapConsentContactHidden: 'No contact details',
      answerGapConsentSystemImported: 'System-imported capture',
      answerGapConsentWithdrawn: 'Context and contact removed',
      answerGapAccessLevelIncluded: 'Access tier included',
      answerGapAccessLevelUnknown: 'Access tier unknown',
      answerGapCoverageGlobalMissing: 'Missing from the Knowledge Base',
      answerGapCoverageUnsupportedAccessible: 'Available material was not enough',
      answerGapCoverageUnknown: 'Coverage unknown',
      loadedGapsPrefix: 'Loaded',
      loadedGapsOf: 'of',
      loadingMoreGaps: 'Loading more gaps',
      requestedBy: 'Requested by',
      userLevel: 'Access tier',
      coverage: 'Report scope',
      missingInformation: 'Missing information',
      llmUsage: 'AI costs',
      llmUsageSubtitle: 'AI request costs and usage for the selected period.',
      rawUsageSubtitle: 'The latest 50 requests from the selected period.',
      workspaceGroup: 'Workspace',
      accessGroup: 'Access',
      knowledgeGroup: 'Knowledge',
      reportingGroup: 'Reporting',
      systemGroup: 'System',
      settings: 'Settings',
      settingsSubtitle: 'Runtime controls for this environment.',
      chatModelSection: 'Chat model',
      activeModel: 'Active model',
      selectedProvider: 'Selected provider',
      selectedModel: 'Selected model',
      unsavedModelSelection: 'Unsaved selection',
      unsavedSettingsTitle: 'Unsaved changes',
      unsavedSettingsDescription: 'Save or reset changes before leaving model settings.',
      unsavedSettingsConfirm: 'You have unsaved Settings changes. Leave without saving?',
      unsavedKnowledgeAccessTitle: 'Unsaved access changes',
      unsavedKnowledgeAccessDescription:
        'Save or reset changed category access before leaving the Knowledge Base.',
      unsavedKnowledgeAccessChangedCategories: 'Changed categories',
      unsavedKnowledgeAccessConfirm:
        'You have unsaved Knowledge access changes. Leave without saving?',
      unsavedKnowledgePageTitle: 'Unsaved page edits',
      unsavedKnowledgePageDescription: 'Save or reset editor changes before leaving this page.',
      unsavedKnowledgePageChangedFields: 'Changed fields',
      unsavedKnowledgePageConfirm: 'You have unsaved Knowledge page edits. Leave without saving?',
      provider: 'Provider',
      inputOutputPrice: 'Input/output price',
      contextWindow: 'Context window',
      structuredOutput: 'Structured output',
      supported: 'Supported',
      currentRevision: 'Revision',
      lastUpdated: 'Last updated',
      operationalEffect:
        'New chat responses use the saved model; in-flight responses keep their started model.',
      fallbackBaselineOption: 'Fallback/baseline option',
      saveConflict: 'Settings changed before your save. Current settings were reloaded.',
      saveSuccess: 'Saved',
      loadSettingsError: 'Unable to load settings right now.',
      saveSettingsError: 'Unable to save settings right now.',
      environmentStatus: 'Environment status',
      userRole: 'Role',
      adminRole: 'Admin',
      level: 'Tier',
      showFilters: 'Filters',
      hideFilters: 'Hide filters',
      rawEvents: 'Individual requests',
    },
    userRoles: {
      user: 'User',
      admin: 'Admin',
    },
    userStatuses: {
      all: 'All',
      pending: 'Pending',
      approved: 'Approved',
      rejected: 'Rejected',
      suspended: 'Suspended',
      profileRequired: 'Profile required',
    },
    adminUsers: {
      search: 'Search',
      searchAriaLabel: 'Search users',
      searchPlaceholder: 'First name, last name, or email',
      status: 'Status',
      statusFilter: 'Status filter',
      roleFilter: 'Role filter',
      levelFilter: 'Tier filter',
      mobileStatusFilter: 'Mobile status filter',
      mobileRoleFilter: 'Mobile role filter',
      mobileLevelFilter: 'Mobile tier filter',
      pageSize: 'Page size',
      pendingStatus: 'Pending',
      activeStatus: 'Active',
      suspendedStatus: 'Suspended',
      activate: 'Activate',
      loadedUsersPrefix: 'Loaded',
      loadedUsersOf: 'of',
      loadingMoreUsers: 'Loading more users',
      usersTable: 'Users',
      access: 'Access',
      accessControlsFor: 'Access controls for',
      audit: 'Audit',
      auditDetails: 'Details',
      auditFor: 'Audit for',
      showAuditDetailsFor: 'Show audit details for',
      actions: 'Actions',
      effectiveLevel: 'Effective tier',
      selfAccessBlocked: 'You cannot modify your own access',
      saving: 'Saving',
      saved: 'Saved',
      saveError: 'Error',
      suspendTitle: 'Suspend user?',
      confirmAccessChangeTitle: 'Confirm access change?',
      suspendMessagePrefix: 'This immediately blocks chat access for',
      accessChangeMessagePrefix: 'This changes access after confirmation for',
      auditLoading: 'Audit loading',
      auditUnavailable: 'Audit unavailable',
      noRecentAccessChanges: 'No recent access changes',
      changedBy: 'By',
      userId: 'User id',
      roleFor: 'Role for',
      userRoleFor: 'User role for',
      adminRoleFor: 'Admin role for',
      statusFor: 'Status for',
      levelFor: 'Tier for',
      adminLevelAccess: 'Admins get tier 10 access.',
      changeRole: 'role',
      changeStatus: 'status',
      changeLevel: 'tier',
      auditChangeTypes: {
        levelChanged: 'Tier changed',
        profileChanged: 'Profile changed',
        roleChanged: 'Role changed',
        statusChanged: 'Status changed',
      },
    },
    adminUsage: {
      metrics: {
        estimatedCost: 'Cost',
        calls: 'AI requests',
        totalTokens: 'Tokens used',
        errors: 'Errors',
      },
      filters: 'Filters',
      filterIntro: 'Start with date, provider, and model; use advanced filters for diagnostics.',
      basics: 'Basics',
      advancedFilters: 'Advanced filters',
      from: 'From',
      to: 'To',
      timeBucket: 'View',
      providerFilter: 'Provider filter',
      modelFilter: 'Model filter',
      componentFilter: 'Component filter',
      userIdFilter: 'User filter',
      promptTypeFilter: 'Prompt type filter',
      serviceFilter: 'Service filter',
      operationFilter: 'Operation filter',
      all: 'All',
      day: 'Daily',
      hour: 'Hourly',
      groupBy: 'Group by',
      groupByAriaPrefix: 'Group by',
      applyFilters: 'Apply filters',
      resetFilters: 'Reset filters',
      aggregateTable: 'Usage summary',
      dailyAggregateTable: 'Daily usage',
      hourlyAggregateTable: 'Hourly usage',
      dateColumn: 'Date',
      hourColumn: 'Hour',
      sortedNewestFirst: 'sorted newest first',
      sortingNewestDays: 'Sorting: newest days first',
      sortingNewestHours: 'Sorting: newest hours first',
      highlights: 'Highlights',
      highestUsage: 'Highest usage: {date}',
      highestCost: 'Highest cost: {date}',
      noErrorsRecorded: 'No errors recorded',
      errorsRecorded: 'Errors recorded: {count}',
      noExtraFilters: 'No extra filters',
      loadingAggregates: 'Loading AI usage...',
      noUsage: 'No AI usage in this period.',
      noFilteredUsage: 'No results match the current filters.',
      tokenMetricHelp: 'A measure of AI model usage.',
      rawEventsDescription: 'The latest 50 requests from the selected period.',
      rawEventsTable: 'Individual AI requests',
      rawEventsSummary: 'Individual AI requests summary',
      user: 'User',
      service: 'Service',
      action: 'Action',
      status: 'Status',
      statusOk: 'OK',
      statusErrorPrefix: 'Error',
      costAriaLabel: 'cost',
      tokensAriaLabel: 'tokens',
      loadAggregatesError: 'Unable to load usage reporting right now.',
      loadRawEventsError: 'Unable to load individual requests right now.',
      loadUserDirectoryError: 'Unable to load usage user labels right now.',
      loadDimensionsError: 'Unable to load usage filter dimensions right now.',
      groupByLabels: {
        timeBucket: 'Date',
        provider: 'Provider',
        model: 'Model',
        userId: 'User',
        service: 'Service',
        component: 'Component',
        operation: 'Operation',
        promptType: 'Prompt type',
      },
      groupByAriaLabels: {
        timeBucket: 'date',
        provider: 'provider',
        model: 'model',
        userId: 'user',
        service: 'service',
        component: 'component',
        operation: 'operation',
        promptType: 'prompt type',
      },
    },
    usageSources: {
      components: {
        'rag-chat': 'Knowledge chat',
        'query-embedding': 'Knowledge search',
      },
      operations: {
        'chat.completion': 'Content generation',
        'chat.stream': 'Assistant answer',
        embedding: 'Search preparation',
      },
      promptTypes: {
        'fishing-answer': 'Fishing answer',
        'chat-assistant': 'Chat assistant',
        'rag-query-embedding': 'Similar-material search',
      },
      services: {
        'chat-service': 'Chat',
        'knowledge-service': 'Knowledge Base',
        'llm-usage-service': 'Usage reporting',
        'user-service': 'Users',
      },
    },
    adminKnowledge: {
      subtitle: 'Edit content, then publish changes so the assistant uses them in answers.',
      add: 'Add',
      addCategory: 'Add category',
      addSection: 'Add section',
      addPage: 'Add page',
      addMenuCreateManually: 'Create manually',
      addCategoryDescription: 'Main collection of materials, for example Feeder tactics.',
      addSectionDescription: 'Group of pages inside a category.',
      addPageDescription: 'Single material for the assistant.',
      page: 'Page',
      pages: 'Pages',
      category: 'Category',
      allCategories: 'All categories',
      allCategoriesHelp:
        'Showing pages from all categories. Choose a category to change access for its pages.',
      categorySettings: 'Change category access',
      loadedPages: 'Showing {shown} of {total} pages',
      showMorePages: 'Show more',
      openPage: 'Open',
      subpages: 'subpages',
      noPagesInCategory: 'No pages in this category.',
      subpagesTitle: 'Subpages',
      pageHasSubpages: 'This page has {count} subpages.',
      categoryTitle: 'Category title',
      categoryAccess: 'Category access',
      categoryRequiredLevel: 'Category required tier',
      createCategory: 'Create category',
      sectionCategory: 'Section category',
      sectionTitle: 'Section title',
      noCategories: 'No categories',
      createSection: 'Create section',
      pageUnavailable: 'Page unavailable',
      missingPageRecovery: 'Missing Knowledge page recovery',
      missingPageMessage:
        'The requested Knowledge Base page could not be loaded. Return to the Knowledge Base or choose another available page below.',
      backToKnowledgeBase: 'Back to Knowledge Base',
      loading: 'Loading...',
      loadingPage: 'Loading page',
      loadingPageMessage: 'Fetching the selected knowledge page.',
      choosePage: 'Choose a page',
      choosePageMessage: 'Select an available page from the tree.',
      assistantContentStatus: 'Assistant content status',
      selectedKnowledgePage: 'Selected knowledge page',
      assistantSyncBusy: 'Publishing saved changes for the assistant.',
      assistantSyncResultPrefix: 'Last publish',
      synced: 'published',
      skipped: 'skipped',
      failed: 'errors',
      accessJobs: 'access jobs',
      pageEditor: 'Page editor',
      pageEditorEmpty: 'Select a page to edit it, or use Add to create a new page.',
      newPage: 'New Page',
      editPage: 'Edit Page',
      pageActions: 'Page actions',
      syncPage: 'Publish page',
      reindexPage: 'Reindex page',
      deletePage: 'Delete page',
      publishPageDescription:
        'Publishes the saved version of this page so the assistant can use it in answers.',
      reindexPageDescription:
        'Refreshes search for this page when the assistant is not finding the current content.',
      deletePageDescription: 'Removes this page from the Knowledge Base and future answers.',
      pageAlreadyPublishedDescription: 'This page is already current for the assistant.',
      contentQualityBlockerDescription:
        'Resolve the content check before publishing or reindexing.',
      pageDangerZone: 'Delete',
      savePageEdits: 'Save page edits',
      selectedPageStatus: 'Selected page status',
      access: 'Access',
      accessFor: 'Access for',
      pageDetails: 'Page details',
      pageTitle: 'Page title',
      section: 'Section',
      noSection: 'No section',
      markdownPreview: 'Markdown preview',
      createPage: 'Create page draft',
      savePage: 'Save changes',
      pageSubmitDisabledHelp: 'Complete the title, content, category, and source link.',
      source: 'Source material',
      sourceType: 'Source type',
      sourceUrl: 'Source link',
      sourceUrlRequired: 'Add a source link.',
      sourceLabel: 'Source name',
      sourceLabelHelp: 'Helps describe the source material in administration.',
      sourceManual: 'Manual',
      sourceExternal: 'External',
      relationships: 'Relationships',
      relatedTo: 'Related to',
      linksTo: 'Links to',
      supersedes: 'Supersedes',
      deletePageTitle: 'Delete knowledge page?',
      deletePageMessagePrefix: 'This page will be removed:',
      deletePageMessageSuffix: 'it will not appear in future assistant answers.',
      updateAssistantTitle: 'Publish saved changes for assistant?',
      updateAssistant: 'Publish changes for assistant',
      updateAssistantDescription:
        'Publishes saved Knowledge Base changes so future answers use them.',
      updateAssistantConfirmation:
        'Only saved changes will be published. After this finishes, the assistant will use them in future answers.',
      publishAll: 'Publish all',
      savedUnpublishedTitle: 'Saved unpublished assistant version',
      savedUnpublishedMessage: 'Saved. The assistant is not using this version yet.',
      savedUnpublishedNavigationConfirm:
        'This page is saved, but the assistant is still using the previous version.',
      unpublishedChange: 'Unpublished',
      unpublishedChangeCountOne: '1 unpublished change',
      unpublishedChangeCountMany: '{count} unpublished changes',
      pagesToSync: 'Pages to publish',
      queuedAccessJobs: 'Queued access jobs',
      embeddingCostNotice: 'Publishing may take from a few seconds to a few minutes.',
      search: 'Search',
      searchAriaLabel: 'Search Knowledge Base',
      noSearchResults: 'No Knowledge pages or folders match this search.',
      accessSettingsFor: 'Access settings for',
      accessSettingsDescriptionPrefix: 'Changes apply to',
      accessSettingsDescriptionSuffix: 'and its child sections/pages.',
      accessSettingsScope: 'Changes apply to this category and all sections and pages inside it.',
      accessQuestion: 'Who can receive answers from these materials?',
      accessEveryoneLabel: 'Everyone approved',
      accessEveryoneHelp: 'The assistant can use these materials for every approved user.',
      accessLevelLabel: 'Users from tier',
      accessLevelHelp:
        'The assistant will use these materials only for users at this tier or higher.',
      accessPrivateLabel: 'Do not use in answers',
      accessPrivateHelp:
        'The material stays in the admin panel, but the assistant will not search it for users.',
      accessPublishAfterSave:
        'After saving, publish changes for the assistant so the new access rules are used in answers.',
      accessSaveSuccess:
        'Access saved for the category. Publish changes for the assistant so the new access rules are used in answers.',
      requiredLevel: 'Required tier',
      requiredLevelFor: 'Required tier for',
      saveAccess: 'Save access',
      unsaved: 'Unsaved',
      statusReady: 'Current',
      statusReadyForAnswers: 'Current',
      statusNeedsAttention: 'Needs attention',
      statusNeedsUpdate: 'Unpublished',
      assistantNeedsAttention: 'Assistant materials need attention',
      assistantUpdating: 'Assistant materials are updating',
      assistantReady: 'Everything is current',
      selectPageForReadiness: 'Select a page to check whether the material is ready for answers.',
      duplicateContentTitle: 'Content check needs attention',
      duplicateContentDescription:
        'The automatic check found repeated neighboring fragments. Repetition can reduce answer quality, so remove one copy before publishing.',
      duplicateContentItemsTitle: 'Repeated fragments:',
      duplicateContentLines: 'lines',
      duplicateContentLineJoiner: 'and',
      duplicateContentIntentionalHint:
        'If the repetition should stay, mark it as intentional for this material version.',
      acknowledgeDuplicateContent: 'This repetition is intentional',
      duplicateAcknowledgementReasonLabel: 'Explanation (optional)',
      duplicateAcknowledgementHelp:
        'Use this only when the repeated lines are needed in the material.',
      confirmDuplicateAcknowledgement: 'Confirm intentional repetition',
      duplicateAcknowledgedMessage: 'Repetition marked as intentional for this version.',
      answerReadiness: 'Answer readiness',
      status: 'Status',
      details: 'Details',
      answers: 'Answers',
      update: 'Update',
      index: 'Index',
      materials: 'Materials',
      indexingError: 'Indexing error',
      syncError: 'Sync error',
      accessSyncError: 'Access sync error',
      actionFailed: 'Knowledge Base action failed.',
    },
    knowledgeAccess: {
      public: 'Everyone',
      approved: 'Everyone',
      level: 'Tier',
      excluded: 'Not in answers',
      manual: 'manual',
    },
    knowledge: {
      syncRequiredAction: 'Sync now so chat can use this page.',
      sourcesStatus: 'Source status',
      retrievalReady: 'Ready for answers',
      retrievalBlocked: 'Blocked for answers',
    },
    commonActions: {
      approve: 'Approve',
      reject: 'Reject',
      suspend: 'Suspend',
      unsuspend: 'Unsuspend',
      saveChanges: 'Save changes',
      reset: 'Reset',
      confirm: 'Confirm',
      cancel: 'Cancel',
      close: 'Close',
      delete: 'Delete',
      more: 'More',
      actions: 'Actions',
      filters: 'Filters',
      loadMore: 'Load more',
    },
    status: {
      loading: 'Loading',
      ready: 'Ready',
      offline: "You're offline",
      error: 'Error',
    },
    errors: {
      generic: 'Something went wrong.',
      offlineSend: "You're offline. Reconnect to send.",
    },
  },
};
