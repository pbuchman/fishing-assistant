import { createElement, type ComponentType } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerGap } from '@fa/http-contracts';

import { I18nProvider } from '../../i18n/I18nProvider.js';

const answerGapsPageModulePath = './AnswerGapsPage.js';
const stylesPath = process.cwd().endsWith('/apps/web')
  ? resolve(process.cwd(), 'src/styles.css')
  : resolve(process.cwd(), 'apps/web/src/styles.css');

const mocks = vi.hoisted(() => ({
  listAnswerGaps: vi.fn(),
  markAnswerGapDone: vi.fn(),
}));

vi.mock('../../services/knowledgeApi.js', async () => {
  const actual = await vi.importActual('../../services/knowledgeApi.js');
  return {
    ...actual,
    listAnswerGaps: mocks.listAnswerGaps,
    markAnswerGapDone: mocks.markAnswerGapDone,
  };
});

function answerGap(overrides: Partial<AnswerGap> = {}): AnswerGap {
  return {
    id: 'gap-1',
    status: 'needs_answer',
    source: 'no_accessible_evidence',
    question: 'What should I change next?',
    formulatedQuestion:
      'Add or adjust Knowledge Base content so FA can answer: "What should I change next?"',
    missingInformation: ['No accessible Knowledge Base evidence matched this question.'],
    requester: {
      userId: 'user-1',
      email: 'angler@example.com',
      firstName: 'Ava',
      lastName: 'Angler',
      role: 'user',
      effectiveLevel: 4,
    },
    origin: {
      reason: 'unsupported_by_retrieved_evidence',
    },
    conversation: {
      conversationId: 'conversation-1',
      userMessageId: 'user-message-1',
      assistantMessageId: 'assistant-message-1',
      contextWindow: [
        { role: 'user', content: 'What should I change next?' },
        {
          role: 'assistant',
          content: 'I found partial test notes, but not enough evidence for a confident answer.',
        },
      ],
    },
    coverageProbe: {
      classification: 'no_candidate_seen',
      minRequiredLevel: null,
      candidateCountBucket: '0',
      probeVersion: '1.0.0',
    },
    coverageKind: 'global_no_candidate_seen',
    consent: {
      status: 'user_shared',
      sharedAt: '2026-06-14T12:00:00.000Z',
      includeContext: true,
      includeContact: true,
      candidateId: 'answer-gap-candidate-assistant-message-1',
    },
    processing: { similarityStatus: 'not_started' },
    createdAt: '2026-06-14T12:00:00.250Z',
    updatedAt: '2026-06-14T12:01:00.500Z',
    doneAt: null,
    doneByUserId: null,
    ...overrides,
  };
}

async function renderAnswerGapsPage(): Promise<ReturnType<typeof render>> {
  const { AnswerGapsPage } = (await import(answerGapsPageModulePath)) as {
    AnswerGapsPage: ComponentType;
  };

  return render(createElement(I18nProvider, null, createElement(AnswerGapsPage)));
}

describe('AnswerGapsPage', () => {
  beforeEach(() => {
    window.localStorage.setItem('fa.locale', 'en');
    mocks.listAnswerGaps.mockReset();
    mocks.markAnswerGapDone.mockReset();
    mocks.listAnswerGaps.mockResolvedValue({
      gaps: [answerGap()],
      nextCursor: null,
      totalCount: 1,
    });
    mocks.markAnswerGapDone.mockResolvedValue({ gap: answerGap({ status: 'done' }) });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('loads answer gaps that require attention by default', async () => {
    await renderAnswerGapsPage();

    await waitFor(() => {
      expect(mocks.listAnswerGaps).toHaveBeenCalledWith({ status: 'needs_answer' });
    });
  });

  it('shows each gap with question, requester, missing information, origin, and report details', async () => {
    await renderAnswerGapsPage();

    const row = await screen.findByRole('article', { name: /What should I change/i });
    expect(within(row).queryByText(answerGap().formulatedQuestion)).toBeNull();
    expect(within(row).getByText('User question')).toBeInTheDocument();
    expect(within(row).getByText(answerGap().question)).toBeInTheDocument();
    expect(within(row).getByText('Ava Angler')).toBeInTheDocument();
    expect(within(row).queryByText('angler@example.com')).toBeNull();
    expect(within(row).getByText('Access tier 4')).toBeInTheDocument();
    expect(within(row).getByText('Access tier included')).toBeInTheDocument();
    expect(within(row).getByText('Context shared')).toBeInTheDocument();
    expect(within(row).getByText('Contact shared')).toBeInTheDocument();
    expect(within(row).getByText('Missing from the Knowledge Base')).toBeInTheDocument();
    expect(within(row).getByText(/Jun 14, 2026/)).toBeInTheDocument();
    expect(within(row).getByText('Why this gap was recorded')).toBeInTheDocument();
    expect(
      within(row).getByText(
        'The assistant found the topic, but the available material was not strong enough to answer.'
      )
    ).toBeInTheDocument();
    expect(
      within(row).getByText('No accessible Knowledge Base evidence matched this question.')
    ).toBeInTheDocument();
    expect(within(row).queryByText('No accessible evidence')).toBeNull();
    expect(within(row).queryByText('No candidate seen')).toBeNull();
    expect(within(row).queryByRole('link', { name: 'Report details' })).toBeNull();

    fireEvent.click(within(row).getByRole('button', { name: 'Report details' }));

    const dialog = await screen.findByRole('dialog', { name: 'Report details' });
    expect(
      within(dialog).getByText(
        'This is the snapshot from when the gap was reported. It shows only the conversation and contact scope stored for this gap.'
      )
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText(/full conversation preview will be a dedicated admin view/i)
    ).toBeNull();
    expect(within(dialog).getByText('Conversation context')).toBeInTheDocument();
    expect(within(dialog).getAllByText('What should I change next?').length).toBe(2);
    expect(
      within(dialog).getByText(
        'I found partial test notes, but not enough evidence for a confident answer.'
      )
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Missing information')).toBeInTheDocument();
    expect(within(dialog).getByText('Why this gap was recorded')).toBeInTheDocument();
    expect(within(dialog).getByText('Report scope')).toBeInTheDocument();
    expect(within(dialog).getByText('Access tier included')).toBeInTheDocument();
    expect(within(dialog).getByText('Missing from the Knowledge Base')).toBeInTheDocument();
    expect(
      within(dialog).getByText('No accessible Knowledge Base evidence matched this question.')
    ).toBeInTheDocument();
  });

  it('shows withheld contact and context consent on answer gaps', async () => {
    mocks.listAnswerGaps.mockResolvedValue({
      gaps: [
        answerGap({
          requester: {
            userId: 'user-1',
            email: null,
            firstName: null,
            lastName: null,
            role: 'user',
            effectiveLevel: 4,
          },
          conversation: { ...answerGap().conversation, contextWindow: [] },
          consent: {
            status: 'user_shared',
            sharedAt: '2026-06-14T12:00:00.000Z',
            includeContext: false,
            includeContact: false,
            candidateId: 'answer-gap-candidate-assistant-message-1',
          },
        }),
      ],
      nextCursor: null,
      totalCount: 1,
    });

    await renderAnswerGapsPage();

    const row = await screen.findByRole('article', { name: /What should I change/i });
    expect(within(row).getByText('Contact not shared')).toBeInTheDocument();
    expect(within(row).getByText('Access tier 4')).toBeInTheDocument();
    expect(within(row).getByText('Access tier included')).toBeInTheDocument();
    expect(within(row).getByText('No conversation context')).toBeInTheDocument();
    expect(within(row).getByText('No contact details')).toBeInTheDocument();
    expect(within(row).queryByText('angler@example.com')).toBeNull();

    fireEvent.click(within(row).getByRole('button', { name: 'Report details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Report details' });
    expect(
      within(dialog).getByText('No conversation snapshot was stored for this gap.')
    ).toBeInTheDocument();
  });

  it('does not present retired access tier zero as a real user level', async () => {
    mocks.listAnswerGaps.mockResolvedValue({
      gaps: [
        answerGap({
          requester: {
            userId: 'anonymous-answer-gap-candidate-assistant-message-1',
            email: null,
            firstName: null,
            lastName: null,
            role: 'user',
            effectiveLevel: 0,
          },
          consent: {
            status: 'user_shared',
            sharedAt: '2026-06-14T12:00:00.000Z',
            includeContext: false,
            includeContact: false,
            candidateId: 'answer-gap-candidate-assistant-message-1',
          },
        }),
      ],
      nextCursor: null,
      totalCount: 1,
    });

    await renderAnswerGapsPage();

    const row = await screen.findByRole('article', { name: /What should I change/i });
    expect(within(row).getByText('Access tier unknown')).toBeInTheDocument();
    expect(within(row).queryByText('Access tier included')).toBeNull();
    expect(within(row).queryByText('Access tier 0')).toBeNull();
  });

  it('uses mobile-friendly answer gap header and button styles', async () => {
    await renderAnswerGapsPage();

    const filterGroup = await screen.findByRole('group', { name: 'Knowledge gaps' });
    expect(filterGroup.closest('.answer-gaps-header')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Report details' })).toHaveClass(
      'fa-secondary-button'
    );

    const styles = readFileSync(stylesPath, 'utf8');
    expect(styles).toMatch(/\.fa-secondary-button\s*{[^}]*text-decoration:\s*none/s);
    expect(styles).toMatch(/\.answer-gaps-header\s*{[^}]*flex-direction:\s*column/s);
    expect(styles).toMatch(/\.answer-gaps-header \.fa-segmented-control\s*{[^}]*width:\s*100%/s);
    expect(styles).toMatch(
      /\.answer-gaps-header \.fa-segmented-control button\s*{[^}]*white-space:\s*nowrap/s
    );
    expect(styles).toMatch(
      /\.fa-detail-sheet\.answer-gap-preview-sheet\s*{[^}]*width:\s*min\(100%,\s*920px\)/s
    );
    expect(styles).toMatch(/\.answer-gap-preview-meta-grid\s*{[^}]*grid-template-columns/s);
    expect(styles).toMatch(/\.answer-gap-preview-missing\s*{[^}]*overflow-wrap:\s*break-word/s);
    expect(styles).toMatch(
      /\.answer-gap-preview-sheet \.fa-detail-sheet-close-icon\s*{[^}]*width:\s*40px/s
    );
  });

  it('reloads with all gaps when the admin toggles the status filter', async () => {
    await renderAnswerGapsPage();
    await screen.findByText(answerGap().question);

    fireEvent.click(screen.getByRole('button', { name: 'All' }));

    await waitFor(() => {
      expect(mocks.listAnswerGaps).toHaveBeenLastCalledWith({ status: 'all' });
    });
  });

  it('marks a gap done, removes it from the requires-answer view, and does not backfill', async () => {
    await renderAnswerGapsPage();
    await screen.findByText(answerGap().question);

    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));

    await waitFor(() => {
      expect(mocks.markAnswerGapDone).toHaveBeenCalledWith('gap-1');
    });
    expect(screen.queryByText(answerGap().question)).toBeNull();
    expect(mocks.listAnswerGaps).toHaveBeenCalledTimes(1);
  });

  it('loads more gaps with the returned cursor through the infinite-scroll sentinel', async () => {
    const secondGap = answerGap({
      id: 'gap-2',
      question: 'What hook bait should I use?',
      formulatedQuestion:
        'Add or adjust Knowledge Base content so FA can answer: "What hook bait should I use?"',
    });
    const originalIntersectionObserver = window.IntersectionObserver;
    const observers: { trigger(): void }[] = [];
    class TestIntersectionObserver {
      constructor(private readonly callback: IntersectionObserverCallback) {
        observers.push({
          trigger: () => {
            this.callback(
              [{ isIntersecting: true } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver
            );
          },
        });
      }

      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }

    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      writable: true,
      value: TestIntersectionObserver,
    });
    mocks.listAnswerGaps
      .mockResolvedValueOnce({ gaps: [answerGap()], nextCursor: 'cursor-2', totalCount: 7 })
      .mockResolvedValueOnce({ gaps: [secondGap], nextCursor: 'cursor-3', totalCount: 7 });

    try {
      await renderAnswerGapsPage();
      await screen.findByText(answerGap().question);

      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
      expect(screen.getByText('Loaded 1 of 7')).toBeInTheDocument();
      expect(screen.getByRole('status', { name: 'Loading more gaps' })).toBeInTheDocument();
      await waitFor(() => {
        expect(observers.length).toBeGreaterThan(0);
      });
      observers[0]?.trigger();

      await waitFor(() => {
        expect(mocks.listAnswerGaps).toHaveBeenLastCalledWith({
          status: 'needs_answer',
          cursor: 'cursor-2',
        });
      });
      expect(await screen.findByText(secondGap.question)).toBeInTheDocument();
      expect(await screen.findByText('Loaded 2 of 7')).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'IntersectionObserver', {
        configurable: true,
        writable: true,
        value: originalIntersectionObserver,
      });
    }
  });

  it('uses different empty states for the needs-answer and all views', async () => {
    mocks.listAnswerGaps.mockResolvedValue({ gaps: [], nextCursor: null, totalCount: 0 });

    await renderAnswerGapsPage();

    expect(await screen.findByText('No answer gaps require attention')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));

    expect(await screen.findByText('No answer gaps recorded')).toBeInTheDocument();
  });
});
