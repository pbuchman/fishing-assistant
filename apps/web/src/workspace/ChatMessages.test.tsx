import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnswerGapCandidateSummary } from '@fa/http-contracts';

import type { ConversationMessage } from '../services/chatApi.js';
import { ChatMessages } from './ChatMessages.js';

afterEach(() => {
  cleanup();
});

type MessageOverrides = Omit<Partial<ConversationMessage>, 'errorMessage' | 'streamStatus'> & {
  errorMessage?: ConversationMessage['errorMessage'] | undefined;
  streamStatus?: ConversationMessage['streamStatus'] | undefined;
};

function message(overrides: MessageOverrides = {}): ConversationMessage {
  const candidate = {
    id: 'a1',
    userId: 'user-1',
    conversationId: 'c1',
    role: 'assistant',
    content: 'Useful partial draft with rig parameters.',
    createdAt: '2026-06-21T10:00:00.000Z',
    citations: [],
    missingInformation: [],
    streamStatus: 'failed',
    errorMessage: 'Answer generation failed. Please try again.',
    ...overrides,
  } as ConversationMessage & {
    errorMessage?: ConversationMessage['errorMessage'] | undefined;
    streamStatus?: ConversationMessage['streamStatus'] | undefined;
  };

  if ('errorMessage' in overrides && overrides.errorMessage === undefined) {
    delete candidate.errorMessage;
  }
  if ('streamStatus' in overrides && overrides.streamStatus === undefined) {
    delete candidate.streamStatus;
  }

  return candidate;
}

function streamPreview(content: string): ConversationMessage {
  return {
    id: 'stream-preview',
    userId: 'user-1',
    conversationId: 'c1',
    role: 'assistant',
    content,
    createdAt: '2026-06-21T10:00:00.000Z',
    citations: [],
    missingInformation: [],
  };
}

function answerGapCandidate(
  overrides: Partial<AnswerGapCandidateSummary> = {}
): AnswerGapCandidateSummary {
  return {
    id: 'answer-gap-candidate-a1',
    status: 'pending_user_consent',
    coverageKind: 'global_no_candidate_seen',
    missingInformation: ['flow speed'],
    expiresAt: '2026-07-14T12:00:00.000Z',
    ...overrides,
  };
}

function chatMessagesElement(
  messages: ConversationMessage[],
  options: {
    onRetryLastMessage?: () => void;
    streamPhase?: 'starting' | 'retrieving' | 'writing' | 'preparing_sources';
    streamError?: string | null;
    streamLongRunning?: boolean;
    streamPreview?: ConversationMessage | null;
    answerGapCandidatesByMessageId?: Record<string, AnswerGapCandidateSummary>;
    onShareAnswerGapCandidate?: (
      messageId: string,
      input: { includeContext: boolean; includeContact: boolean }
    ) => void;
    onDeclineAnswerGapCandidate?: (messageId: string) => void;
    onWithdrawAnswerGapCandidate?: (messageId: string) => void;
  } = {}
) {
  return (
    <ChatMessages
      assistantLabel="FA"
      draftLabel="Draft"
      failedAnswerContentLabel="Nie udało mi się dokończyć tej odpowiedzi. Spróbuj ponownie."
      failedAnswerErrorLabel="Nie udało się wygenerować odpowiedzi. Spróbuj ponownie."
      findingSourcesLabel="Szukam w Bazie Wiedzy..."
      longRunningLabel="Jeszcze przygotowuję odpowiedź..."
      messages={messages}
      missingHeading="Co jeszcze muszę wiedzieć"
      partialDraftNoticeLabel="Nie udało mi się w pełni potwierdzić tej odpowiedzi w źródłach. Potraktuj ją jako wskazówkę albo doprecyzuj pytanie."
      retryAnswerLabel="Ponów"
      onRetryLastMessage={options.onRetryLastMessage}
      showAllSourcesLabel="Pokaż wszystkie"
      answerGapCandidatesByMessageId={options.answerGapCandidatesByMessageId ?? {}}
      answerGapShareTitleLabel="Nie mamy tego w Bazie Wiedzy"
      answerGapShareBodyLabel="Do zgłoszenia zawsze dołączymy opis braku, pytanie, próg dostępu, datę i techniczne identyfikatory zgłoszenia. Opcjonalnie dołącz kontekst rozmowy lub kontakt, żeby administrator mógł trafniej uzupełnić materiał albo wrócić do Ciebie z pytaniem."
      answerGapShareContextLabel="Dołącz kontekst rozmowy"
      answerGapShareContactLabel="Dołącz mój kontakt"
      answerGapShareButtonLabel="Zgłoś brak"
      answerGapDeclineButtonLabel="Nie teraz"
      answerGapWithdrawButtonLabel="Usuń kontekst i kontakt"
      answerGapSharedLabel="Zgłoszenie wysłane administratorowi"
      answerGapWithdrawnLabel="Kontekst i kontakt usunięte ze zgłoszenia"
      answerGapActionFailedLabel="Nie udało się zapisać decyzji."
      onShareAnswerGapCandidate={options.onShareAnswerGapCandidate}
      onDeclineAnswerGapCandidate={options.onDeclineAnswerGapCandidate}
      onWithdrawAnswerGapCandidate={options.onWithdrawAnswerGapCandidate}
      sourcesHeading="Wykorzystane źródła"
      preparingSourcesLabel="Opracowuję listę źródeł..."
      streamError={options.streamError ?? null}
      streamPhase={options.streamPhase ?? 'writing'}
      streamLongRunning={options.streamLongRunning ?? false}
      streamPreview={options.streamPreview ?? null}
      timedOutLabel="Czas odpowiedzi minął. Spróbuj ponownie."
      userLabel="Ty"
      writingAnswerLabel="Układam odpowiedź..."
    />
  );
}

function renderMessages(
  messages: ConversationMessage[],
  options: {
    onRetryLastMessage?: () => void;
    streamPhase?: 'starting' | 'retrieving' | 'writing' | 'preparing_sources';
    streamError?: string | null;
    streamLongRunning?: boolean;
    streamPreview?: ConversationMessage | null;
    answerGapCandidatesByMessageId?: Record<string, AnswerGapCandidateSummary>;
    onShareAnswerGapCandidate?: (
      messageId: string,
      input: { includeContext: boolean; includeContact: boolean }
    ) => void;
    onDeclineAnswerGapCandidate?: (messageId: string) => void;
    onWithdrawAnswerGapCandidate?: (messageId: string) => void;
  } = {}
) {
  return render(
    chatMessagesElement(messages, {
      ...options,
      onRetryLastMessage: options.onRetryLastMessage ?? vi.fn(),
    })
  );
}

function setThreadScrollMetrics(
  thread: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number }
): void {
  Object.defineProperties(thread, {
    clientHeight: {
      configurable: true,
      value: metrics.clientHeight,
    },
    scrollHeight: {
      configurable: true,
      value: metrics.scrollHeight,
    },
    scrollTop: {
      configurable: true,
      value: metrics.scrollTop,
      writable: true,
    },
  });
}

function setPageScrollMetrics(metrics: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}): void {
  Object.defineProperties(document.documentElement, {
    clientHeight: {
      configurable: true,
      value: metrics.clientHeight,
    },
    scrollHeight: {
      configurable: true,
      value: metrics.scrollHeight,
    },
    scrollTop: {
      configurable: true,
      value: metrics.scrollTop,
      writable: true,
    },
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    value: vi.fn((options?: ScrollToOptions | number) => {
      document.documentElement.scrollTop =
        typeof options === 'number'
          ? options
          : (options?.top ?? document.documentElement.scrollTop);
    }),
  });
}

function getThread(): HTMLElement {
  const thread = document.querySelector('.message-thread');
  if (!(thread instanceof HTMLElement)) {
    throw new Error('Expected the message thread to render.');
  }
  return thread;
}

describe('ChatMessages', () => {
  it('renders answer gap sharing controls and sends selected consent options', () => {
    const share = vi.fn();
    const decline = vi.fn();
    renderMessages([message({ id: 'a1', streamStatus: 'completed', errorMessage: undefined })], {
      answerGapCandidatesByMessageId: { a1: answerGapCandidate() },
      onShareAnswerGapCandidate: share,
      onDeclineAnswerGapCandidate: decline,
    });

    expect(screen.getByText('Nie mamy tego w Bazie Wiedzy')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Do zgłoszenia zawsze dołączymy opis braku, pytanie, próg dostępu, datę i techniczne identyfikatory zgłoszenia. Opcjonalnie dołącz kontekst rozmowy lub kontakt, żeby administrator mógł trafniej uzupełnić materiał albo wrócić do Ciebie z pytaniem.'
      )
    ).toBeInTheDocument();
    const contextCheckbox = screen.getByRole('checkbox', { name: 'Dołącz kontekst rozmowy' });
    const contactCheckbox = screen.getByRole('checkbox', { name: 'Dołącz mój kontakt' });
    expect(contextCheckbox).not.toBeChecked();
    expect(contactCheckbox).not.toBeChecked();

    fireEvent.click(contactCheckbox);
    fireEvent.click(screen.getByRole('button', { name: 'Zgłoś brak' }));

    expect(share).toHaveBeenCalledWith('a1', {
      includeContext: false,
      includeContact: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Nie teraz' }));
    expect(decline).toHaveBeenCalledWith('a1');
  });

  it('renders completed answer gap decisions without active controls', () => {
    const withdraw = vi.fn();
    renderMessages([message({ id: 'a1', streamStatus: 'completed', errorMessage: undefined })], {
      answerGapCandidatesByMessageId: { a1: answerGapCandidate({ status: 'shared' }) },
      onWithdrawAnswerGapCandidate: withdraw,
    });

    expect(screen.getByText('Zgłoszenie wysłane administratorowi')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Usuń kontekst i kontakt' }));
    expect(withdraw).toHaveBeenCalledWith('a1');
    expect(screen.queryByRole('button', { name: 'Zgłoś brak' })).toBeNull();
  });

  it('shows a partial-draft notice without repeating the generic failure copy', () => {
    renderMessages([message()]);

    expect(screen.getByText('Useful partial draft with rig parameters.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Nie udało mi się w pełni potwierdzić tej odpowiedzi w źródłach. Potraktuj ją jako wskazówkę albo doprecyzuj pytanie.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Nie udało się wygenerować odpowiedzi. Spróbuj ponownie.')
    ).not.toBeInTheDocument();
  });

  it('does not repeat live generic stream errors below preserved drafts', () => {
    renderMessages([message()], {
      streamError: 'Answer generation failed. Please try again.',
    });

    expect(
      screen.getByText(
        'Nie udało mi się w pełni potwierdzić tej odpowiedzi w źródłach. Potraktuj ją jako wskazówkę albo doprecyzuj pytanie.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Nie udało się wygenerować odpowiedzi. Spróbuj ponownie.')
    ).not.toBeInTheDocument();
  });

  it('still shows non-generic live stream errors below preserved drafts', () => {
    renderMessages([message()], {
      streamError: 'Połączenie zostało przerwane. Sprawdź internet i spróbuj ponownie.',
    });

    expect(
      screen.getByText('Połączenie zostało przerwane. Sprawdź internet i spróbuj ponownie.')
    ).toBeInTheDocument();
  });

  it('normalizes raw gateway stream errors before rendering them', () => {
    renderMessages(
      [
        message({
          id: 'u1',
          role: 'user',
          content: 'Krotko: co to jest method feeder?',
          streamStatus: undefined,
          errorMessage: undefined,
        }),
      ],
      {
        streamError: 'API request failed with status 502.',
      }
    );

    expect(
      screen.getByText('Nie udało się wygenerować odpowiedzi. Spróbuj ponownie.')
    ).toBeInTheDocument();
    expect(screen.queryByText('API request failed with status 502.')).not.toBeInTheDocument();
  });

  it('localizes raw provider abort errors before rendering failed fallback panels', () => {
    renderMessages([
      message({
        content: 'Nie udało mi się dokończyć odpowiedzi. Spróbuj ponownie.',
        streamStatus: 'failed',
        errorMessage: 'OpenRouter chat stream request was aborted',
      }),
    ]);

    expect(
      screen.getByText('Nie udało się wygenerować odpowiedzi. Spróbuj ponownie.')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('OpenRouter chat stream request was aborted')
    ).not.toBeInTheDocument();
  });

  it('renders one inline retrieval status row in the live stream placeholder', () => {
    renderMessages([], {
      streamPhase: 'retrieving',
      streamPreview: {
        id: 'stream-draft',
        userId: 'user-preview',
        conversationId: 'c1',
        role: 'assistant',
        content: '',
        createdAt: '',
        citations: [],
        missingInformation: [],
      },
    });

    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByText('Szukam w Bazie Wiedzy...')).toBeInTheDocument();
    expect(document.querySelector('.stream-progress-list')).toBeNull();
    expect(document.querySelector('.thinking-dots')).toBeNull();
    expect(screen.queryByText('Układam odpowiedź...')).not.toBeInTheDocument();
    expect(screen.queryByText('Jeszcze przygotowuję odpowiedź...')).not.toBeInTheDocument();
  });

  it('keeps the stream status visible below streamed answer content', () => {
    renderMessages([], {
      streamPhase: 'preparing_sources',
      streamPreview: {
        id: 'stream-draft',
        userId: 'user-preview',
        conversationId: 'c1',
        role: 'assistant',
        content: 'Gotowa treść odpowiedzi.',
        createdAt: '',
        citations: [],
        missingInformation: [],
      },
    });

    expect(screen.getByText('Gotowa treść odpowiedzi.')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Opracowuję listę źródeł...' })).toBeInTheDocument();
    expect(screen.getByText('Opracowuję listę źródeł...')).toBeInTheDocument();
  });

  it('hides the writing status once answer tokens are streaming', () => {
    renderMessages([], {
      streamPhase: 'writing',
      streamPreview: {
        id: 'stream-draft',
        userId: 'user-preview',
        conversationId: 'c1',
        role: 'assistant',
        content: 'Pierwsze zdanie odpowiedzi jest już widoczne.',
        createdAt: '',
        citations: [],
        missingInformation: [],
      },
    });

    expect(screen.getByText('Pierwsze zdanie odpowiedzi jest już widoczne.')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Układam odpowiedź...' })).not.toBeInTheDocument();
    expect(screen.queryByText('Układam odpowiedź...')).not.toBeInTheDocument();
  });

  it('renders the long-running fallback after progress is flagged', () => {
    renderMessages([], {
      streamLongRunning: true,
      streamPreview: {
        id: 'stream-draft',
        userId: 'user-preview',
        conversationId: 'c1',
        role: 'assistant',
        content: '',
        createdAt: '',
        citations: [],
        missingInformation: [],
      },
    });

    expect(screen.getByText('Jeszcze przygotowuję odpowiedź...')).toHaveClass('stream-status-copy');
  });

  it('hides declined answer-gap consent decisions after the user chooses not to share', () => {
    renderMessages([message({ id: 'a1', streamStatus: 'completed', errorMessage: undefined })], {
      answerGapCandidatesByMessageId: { a1: answerGapCandidate({ status: 'declined' }) },
    });

    expect(screen.queryByText('Nie udostępniono')).not.toBeInTheDocument();
    expect(screen.queryByText('Nie mamy tego w Bazie Wiedzy')).not.toBeInTheDocument();
  });

  it('redacts raw URLs from rendered assistant answers', () => {
    renderMessages([
      message({
        content:
          'Material jest na https://example.invalid/. Szczegoly: [katalog](https://blocked.example.invalid/source). Image reference is sample-hidden.png.',
        missingInformation: ['Nie mam tekstu z pliku sample-hidden.png.'],
        streamStatus: 'completed',
        errorMessage: undefined,
      }),
    ]);

    expect(document.body.textContent).toContain('Material jest na [link hidden]');
    expect(document.body.textContent).toContain('Szczegoly: katalog');
    expect(document.body.textContent).toContain('Image reference is [image hidden]');
    expect(document.body.textContent).toContain('Nie mam tekstu z pliku [image hidden]');
    expect(document.body.textContent).not.toContain('https://example.invalid');
    expect(document.body.textContent).not.toContain('blocked.example.invalid');
    expect(document.body.textContent).not.toContain('sample-hidden.png');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('redacts image filenames from live stream previews', () => {
    renderMessages([], {
      streamPreview: streamPreview('Image reference is sample-hidden.png.'),
    });

    expect(document.body.textContent).toContain('Image reference is [image hidden]');
    expect(document.body.textContent).not.toContain('sample-hidden.png');
  });

  it('still shows the localized error for failed answers without preserved content', () => {
    renderMessages([
      message({
        content: 'I could not complete this answer. Please try again.',
      }),
    ]);

    expect(
      screen.getAllByText('Nie udało mi się dokończyć tej odpowiedzi. Spróbuj ponownie.')
    ).toHaveLength(1);
    expect(
      screen.getByText('Nie udało się wygenerować odpowiedzi. Spróbuj ponownie.')
    ).toBeInTheDocument();
  });

  it('renders new Polish failed assistant fallback as a retry panel', () => {
    renderMessages([
      message({
        content: 'Nie udało mi się dokończyć odpowiedzi. Spróbuj ponownie.',
        streamStatus: 'failed',
        errorMessage: 'Nie udało się wygenerować odpowiedzi. Spróbuj ponownie.',
      }),
    ]);

    expect(
      screen.getByText('Nie udało się wygenerować odpowiedzi. Spróbuj ponownie.')
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ponów' })).toBeVisible();
  });

  it('renders live stream failures as an actionable retry panel', () => {
    const onRetryLastMessage = vi.fn();

    renderMessages([], {
      onRetryLastMessage,
      streamError: 'Provider paused.',
    });

    const alert = screen.getByRole('alert', {
      name: 'Nie udało się wygenerować odpowiedzi. Spróbuj ponownie.',
    });
    expect(within(alert).getByText('Provider paused.')).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: 'Ponów' }));

    expect(onRetryLastMessage).toHaveBeenCalledTimes(1);
  });

  it('follows streaming output while the user is already at the bottom', () => {
    const preview = streamPreview('Initial draft');
    const { rerender } = renderMessages([], { streamPreview: preview });
    const thread = getThread();
    setThreadScrollMetrics(thread, { clientHeight: 500, scrollHeight: 700, scrollTop: 200 });

    rerender(
      chatMessagesElement([], {
        streamPreview: {
          ...preview,
          content: `${preview.content}\n\nExpanded answer section`,
        },
      })
    );

    setThreadScrollMetrics(thread, { clientHeight: 500, scrollHeight: 900, scrollTop: 200 });

    rerender(
      chatMessagesElement([], {
        streamPreview: {
          ...preview,
          content: `${preview.content}\n\nExpanded answer section\n\nMore output`,
        },
      })
    );

    expect(thread.scrollTop).toBe(900);
  });

  it('pauses following after the user scrolls away and resumes after they return to the bottom', () => {
    const preview = streamPreview('Initial draft');
    const { rerender } = renderMessages([], { streamPreview: preview });
    const thread = getThread();

    setThreadScrollMetrics(thread, { clientHeight: 500, scrollHeight: 900, scrollTop: 100 });
    fireEvent.scroll(thread);

    rerender(
      chatMessagesElement([], {
        streamPreview: {
          ...preview,
          content: `${preview.content}\n\nMore output while reading above`,
        },
      })
    );

    expect(thread.scrollTop).toBe(100);

    setThreadScrollMetrics(thread, { clientHeight: 500, scrollHeight: 1000, scrollTop: 500 });
    fireEvent.scroll(thread);

    rerender(
      chatMessagesElement([], {
        streamPreview: {
          ...preview,
          content: `${preview.content}\n\nMore output while reading above\n\nFresh bottom output`,
        },
      })
    );

    expect(thread.scrollTop).toBe(1000);
  });

  it('does not fall back to document scrolling when the thread initially fits', () => {
    const preview = streamPreview('Initial draft');
    const { rerender } = renderMessages([], { streamPreview: preview });
    const thread = getThread();

    setThreadScrollMetrics(thread, { clientHeight: 900, scrollHeight: 900, scrollTop: 0 });
    setPageScrollMetrics({ clientHeight: 500, scrollHeight: 900, scrollTop: 400 });

    rerender(
      chatMessagesElement([], {
        streamPreview: {
          ...preview,
          content: `${preview.content}\n\nExpanded answer section`,
        },
      })
    );

    setThreadScrollMetrics(thread, { clientHeight: 1100, scrollHeight: 1100, scrollTop: 0 });
    setPageScrollMetrics({ clientHeight: 500, scrollHeight: 1100, scrollTop: 400 });

    rerender(
      chatMessagesElement([], {
        streamPreview: {
          ...preview,
          content: `${preview.content}\n\nExpanded answer section\n\nMore output`,
        },
      })
    );

    expect(thread.scrollTop).toBe(1100);
    expect(document.documentElement.scrollTop).toBe(400);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('ignores window scroll events for chat follow state', () => {
    const preview = streamPreview('Initial draft');
    const { rerender } = renderMessages([], { streamPreview: preview });
    const thread = getThread();

    setThreadScrollMetrics(thread, { clientHeight: 900, scrollHeight: 900, scrollTop: 0 });
    setPageScrollMetrics({ clientHeight: 500, scrollHeight: 900, scrollTop: 100 });
    fireEvent.scroll(window);

    rerender(
      chatMessagesElement([], {
        streamPreview: {
          ...preview,
          content: `${preview.content}\n\nMore output while reading above`,
        },
      })
    );

    expect(thread.scrollTop).toBe(900);
    expect(document.documentElement.scrollTop).toBe(100);

    setThreadScrollMetrics(thread, { clientHeight: 1000, scrollHeight: 1000, scrollTop: 0 });
    setPageScrollMetrics({ clientHeight: 500, scrollHeight: 1000, scrollTop: 500 });
    fireEvent.scroll(window);

    rerender(
      chatMessagesElement([], {
        streamPreview: {
          ...preview,
          content: `${preview.content}\n\nMore output while reading above\n\nFresh bottom output`,
        },
      })
    );

    expect(thread.scrollTop).toBe(1000);
    expect(document.documentElement.scrollTop).toBe(500);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('keeps the message thread bottom anchored when a stream preview is replaced by the final answer', () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView'
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      const preview = streamPreview('Initial draft');
      const finalAnswer = message({
        id: 'final-answer',
        content: 'Final answer with source-backed details.',
        streamStatus: 'completed',
        errorMessage: undefined,
      });
      const { rerender } = renderMessages([], { streamPreview: preview });
      const thread = getThread();

      setThreadScrollMetrics(thread, { clientHeight: 900, scrollHeight: 900, scrollTop: 0 });
      setPageScrollMetrics({ clientHeight: 500, scrollHeight: 900, scrollTop: 400 });

      rerender(chatMessagesElement([finalAnswer], { streamPreview: null }));

      expect(thread.scrollTop).toBe(900);
      expect(document.documentElement.scrollTop).toBe(400);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      if (originalScrollIntoView === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
      } else {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
      }
    }
  });
});
