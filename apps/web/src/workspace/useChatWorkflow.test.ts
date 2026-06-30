import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../services/apiClient.js';
import type { ChatStreamEvent, ConversationMessage } from '../services/chatApi.js';
import { useChatWorkflow } from './useChatWorkflow.js';
import type { AnswerGapCandidateSummary } from '@fa/http-contracts';

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function nonErrorRejectedPromise(reason: unknown): Promise<never> {
  const thenable: PromiseLike<never> = {
    then<TResult1 = never, TResult2 = never>(
      _onfulfilled?: ((value: never) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): PromiseLike<TResult1 | TResult2> {
      if (!onrejected) {
        return Promise.resolve(undefined as TResult1 | TResult2);
      }

      return Promise.resolve(onrejected(reason));
    },
  };

  return thenable as Promise<never>;
}

function message(overrides: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: 'message-1',
    userId: 'user-1',
    conversationId: 'c1',
    role: 'assistant',
    content: 'Assistant answer.',
    createdAt: '2026-06-14T10:00:00.000Z',
    citations: [],
    missingInformation: [],
    ...overrides,
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

describe('useChatWorkflow', () => {
  it('marks an in-flight answer as long-running and clears it after completion', async () => {
    vi.useFakeTimers();
    try {
      const stream = deferred();
      let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
      let sendPromise: Promise<void> | undefined;
      const streamConversationMessage = vi.fn(
        async (
          _conversationId: string,
          _message: string,
          onEvent: (event: ChatStreamEvent) => void
        ) => {
          emitStreamEvent = onEvent;
          await stream.promise;
        }
      );

      const { result } = renderHook(() =>
        useChatWorkflow({
          conversationId: 'c1',
          ensureConversationId: () => Promise.resolve('c1'),
          services: {
            listConversationMessages: () => Promise.resolve([]),
            streamConversationMessage,
          },
        })
      );

      act(() => {
        result.current.setComposer('Build me a complete plan');
      });
      act(() => {
        sendPromise = result.current.handleSendMessage();
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(streamConversationMessage).toHaveBeenCalled();
      expect(result.current.streaming).toBe(true);
      expect(result.current.streamLongRunning).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      expect(result.current.streamLongRunning).toBe(true);

      await act(async () => {
        emitStreamEvent?.({
          type: 'answer.final',
          data: message({
            id: 'a-long-running',
            content: 'Complete plan.',
            streamStatus: 'completed',
          }),
        });
        stream.resolve();
        await stream.promise;
        await sendPromise;
      });

      expect(result.current.streaming).toBe(false);
      expect(result.current.streamLongRunning).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks the stream as preparing sources after the text draft is complete', async () => {
    const stream = deferred();
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        emitStreamEvent = onEvent;
        await stream.promise;
      }
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Build me a complete plan');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalled();
    });

    act(() => {
      emitStreamEvent?.({ type: 'answer.progress', data: { status: 'preparing_sources' } });
    });

    expect(result.current.streamPhase).toBe('preparing_sources');
    expect(result.current.streamLongRunning).toBe(false);
    stream.resolve();
  });

  it('marks an in-flight answer as long-running when the stream sends progress', async () => {
    const stream = deferred();
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        emitStreamEvent = onEvent;
        await stream.promise;
      }
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Build me a complete plan');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalled();
    });
    expect(result.current.streamLongRunning).toBe(false);

    act(() => {
      emitStreamEvent?.({ type: 'answer.progress', data: { status: 'long_running' } });
    });

    expect(result.current.streamLongRunning).toBe(true);
    stream.resolve();
  });

  it('exposes a cancel action that aborts the active stream and clears progress state', async () => {
    const stream = deferred();
    let receivedSignal: AbortSignal | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        _onEvent: (event: ChatStreamEvent) => void,
        signal?: AbortSignal
      ) => {
        receivedSignal = signal;
        await stream.promise;
      }
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Build me a complete plan');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalled();
    });

    act(() => {
      result.current.cancelStream();
    });

    expect(receivedSignal?.aborted).toBe(true);
    expect(result.current.streaming).toBe(false);
    expect(result.current.hasStreamPreview).toBe(false);
    stream.resolve();
  });

  it('retries the last submitted prompt after a recoverable stream failure', async () => {
    const streamConversationMessage = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Best bait?');
    });
    await act(async () => {
      await result.current.handleSendMessage();
    });

    expect(result.current.streamError).toBe(
      'Connection interrupted. Check your network and try again.'
    );

    await act(async () => {
      await result.current.retryLastMessage();
    });

    expect(streamConversationMessage).toHaveBeenCalledTimes(2);
    expect(streamConversationMessage.mock.calls[1]?.[1]).toBe('Best bait?');
  });

  it('retries the user prompt before a loaded failed assistant fallback', async () => {
    const persistedUserMessage = message({
      id: 'u-failed',
      conversationId: 'c1',
      role: 'user',
      content: 'Rig parameters?',
      citations: [],
      missingInformation: [],
    });
    const persistedFailedAssistant = message({
      id: 'a-failed',
      conversationId: 'c1',
      content: 'Nie udało mi się dokończyć odpowiedzi. Spróbuj ponownie.',
      citations: [],
      missingInformation: [],
      streamStatus: 'failed',
      errorMessage: 'OpenRouter chat stream request was aborted',
    });
    const listConversationMessages = vi.fn(() =>
      Promise.resolve([persistedUserMessage, persistedFailedAssistant])
    );
    const streamConversationMessage = vi.fn(() => Promise.resolve());

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages,
          streamConversationMessage,
        },
      })
    );

    await waitFor(() => {
      expect(result.current.messages.map((item) => item.id)).toEqual(['u-failed', 'a-failed']);
    });

    await act(async () => {
      await result.current.retryLastMessage();
    });

    expect(streamConversationMessage).toHaveBeenCalledWith(
      'c1',
      'Rig parameters?',
      expect.any(Function),
      expect.any(AbortSignal)
    );
  });

  it('keeps long-running progress visible when a blank chat creates a conversation first', async () => {
    const stream = deferred();
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const route = { conversationId: undefined as string | undefined };
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        emitStreamEvent = onEvent;
        await stream.promise;
      }
    );

    const { result, rerender } = renderHook(() =>
      useChatWorkflow({
        conversationId: route.conversationId,
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Build me a complete plan');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalledWith(
        'c1',
        'Build me a complete plan',
        expect.any(Function),
        expect.any(AbortSignal)
      );
    });

    route.conversationId = 'c1';
    rerender();

    act(() => {
      emitStreamEvent?.({ type: 'answer.progress', data: { status: 'long_running' } });
    });

    expect(result.current.streamLongRunning).toBe(true);
    stream.resolve();
  });

  it('applies draft, replacement, citation, missing-info, and final stream transitions', async () => {
    const stream = deferred();
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        emitStreamEvent = onEvent;
        await stream.promise;
      }
    );
    const ensureConversationId = vi.fn(() => Promise.resolve('c1'));

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId,
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer(' Best bait? ');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalledWith(
        'c1',
        'Best bait?',
        expect.any(Function),
        expect.any(AbortSignal)
      );
    });
    expect(result.current.composer).toBe('');
    expect(result.current.streaming).toBe(true);

    act(() => {
      emitStreamEvent?.({
        type: 'message.created',
        data: message({
          id: 'u1',
          role: 'user',
          content: 'Best bait?',
          citations: [],
          missingInformation: [],
        }),
      });
      emitStreamEvent?.({
        type: 'retrieval.completed',
        data: { sourceCounts: [], topEvidenceIds: [] },
      });
      emitStreamEvent?.({
        type: 'answer.started',
        data: { conversationId: 'c1', messageId: 'a1' },
      });
      emitStreamEvent?.({
        type: 'answer.delta',
        data: { text: 'Use corn ' },
      });
      emitStreamEvent?.({
        type: 'answer.delta',
        data: { text: 'close to the shelf.' },
      });
    });

    expect(result.current.messages.map((item) => item.id)).toEqual(['u1']);
    expect(result.current.streamDraft).toBe('Use corn close to the shelf.');
    expect(result.current.hasStreamPreview).toBe(true);
    expect(result.current.streamPreviewMessage.content).toBe('Use corn close to the shelf.');

    act(() => {
      emitStreamEvent?.({
        type: 'answer.citation',
        data: {
          citation: { sourceId: 'source-1', usedFor: 'bait choice' },
          evidence: {
            id: 'chunk-1',
            sourceId: 'source-1',
            sourceType: 'knowledge_page',
            title: 'Bait notes',
            quote: 'Bread was used.',
            score: 0.91,
            metadata: { headingPath: ['Bait notes'] },
          },
        },
      });
      emitStreamEvent?.({
        type: 'answer.citation',
        data: {
          citation: { sourceId: 'source-1', usedFor: 'bait choice duplicate' },
          evidence: {
            id: 'chunk-1',
            sourceId: 'source-1',
            sourceType: 'knowledge_page',
            title: 'Bait notes',
            quote: 'Bread was used.',
            score: 0.91,
            metadata: { headingPath: ['Bait notes'] },
          },
        },
      });
      emitStreamEvent?.({
        type: 'answer.missing_info',
        data: { missingInformation: ['flow speed'] },
      });
    });

    expect(result.current.streamCitations).toEqual([
      { sourceId: 'source-1', usedFor: 'bait choice' },
      { sourceId: 'source-1', usedFor: 'bait choice duplicate' },
    ]);
    expect(result.current.streamMissing).toEqual(['flow speed']);
    expect(result.current.streamPreviewMessage.citations).toEqual([
      { sourceId: 'source-1', usedFor: 'bait choice' },
      { sourceId: 'source-1', usedFor: 'bait choice duplicate' },
    ]);
    expect(result.current.streamPreviewMessage.retrieval?.evidence).toEqual([
      expect.objectContaining({ id: 'chunk-1', title: 'Bait notes' }),
    ]);
    expect(result.current.streamPreviewMessage.missingInformation).toEqual(['flow speed']);

    await act(async () => {
      emitStreamEvent?.({
        type: 'answer.final',
        data: message({
          id: 'a1',
          content: 'Use corn close to the shelf. [S1]',
          citations: [{ sourceId: 'source-1', usedFor: 'bait choice' }],
          missingInformation: ['flow speed'],
          streamStatus: 'completed',
        }),
      });
      stream.resolve();
      await stream.promise;
    });

    await waitFor(() => {
      expect(result.current.streaming).toBe(false);
    });
    expect(result.current.messages.map((item) => item.id)).toEqual(['u1', 'a1']);
    expect(result.current.messages[1]?.content).toBe('Use corn close to the shelf. [S1]');
    expect(result.current.streamDraft).toBe('');
    expect(result.current.streamCitations).toEqual([]);
    expect(result.current.streamMissing).toEqual([]);
    expect(result.current.hasStreamPreview).toBe(false);
  });

  it('attaches answer gap candidates to final answers and shares selected consent options', async () => {
    const stream = deferred();
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        emitStreamEvent = onEvent;
        await stream.promise;
      }
    );
    const shareAnswerGapCandidate = vi.fn(() =>
      Promise.resolve({
        created: true,
        candidate: answerGapCandidate({ status: 'shared' }),
      })
    );
    const withdrawAnswerGapCandidate = vi.fn(() =>
      Promise.resolve({
        candidate: answerGapCandidate({ status: 'withdrawn', missingInformation: [] }),
      })
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
          shareAnswerGapCandidate,
          withdrawAnswerGapCandidate,
        },
      })
    );

    act(() => {
      result.current.setComposer('Best bait?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalled();
    });

    await act(async () => {
      emitStreamEvent?.({
        type: 'answer.gap_candidate',
        data: { candidate: answerGapCandidate() },
      });
      emitStreamEvent?.({
        type: 'answer.final',
        data: message({
          id: 'a1',
          content: 'I do not have this in the knowledge base.',
          missingInformation: ['flow speed'],
          streamStatus: 'completed',
        }),
      });
      stream.resolve();
      await stream.promise;
    });

    expect(result.current.answerGapCandidatesByMessageId['a1']).toMatchObject({
      id: 'answer-gap-candidate-a1',
      status: 'pending_user_consent',
    });

    await act(async () => {
      await result.current.shareAnswerGapCandidateForMessage('a1', {
        includeContext: false,
        includeContact: true,
      });
    });

    expect(shareAnswerGapCandidate).toHaveBeenCalledWith('answer-gap-candidate-a1', {
      includeContext: false,
      includeContact: true,
    });
    expect(result.current.answerGapCandidatesByMessageId['a1']).toMatchObject({
      status: 'shared',
    });

    await act(async () => {
      await result.current.withdrawAnswerGapCandidateForMessage('a1');
    });

    expect(withdrawAnswerGapCandidate).toHaveBeenCalledWith('answer-gap-candidate-a1');
    expect(result.current.answerGapCandidatesByMessageId['a1']).toMatchObject({
      status: 'withdrawn',
    });
  });

  it('renders no-evidence final messages from stream events', async () => {
    const stream = deferred();
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        emitStreamEvent = onEvent;
        await stream.promise;
      }
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: undefined,
        ensureConversationId: () => Promise.resolve('c9'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Any notes?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalledWith(
        'c9',
        'Any notes?',
        expect.any(Function),
        expect.any(AbortSignal)
      );
    });

    act(() => {
      emitStreamEvent?.({
        type: 'message.created',
        data: message({
          id: 'u9',
          conversationId: 'c9',
          role: 'user',
          content: 'Any notes?',
          citations: [],
          missingInformation: [],
        }),
      });
      emitStreamEvent?.({
        type: 'retrieval.completed',
        data: {
          sourceCounts: [{ sourceId: 'knowledge', status: 'success', itemCount: 0 }],
          topEvidenceIds: [],
        },
      });
      emitStreamEvent?.({
        type: 'answer.missing_info',
        data: { missingInformation: ['No evidence about session notes.'] },
      });
    });

    expect(result.current.hasStreamPreview).toBe(true);
    expect(result.current.streamPreviewMessage.missingInformation).toEqual([
      'No evidence about session notes.',
    ]);

    await act(async () => {
      emitStreamEvent?.({
        type: 'answer.final',
        data: message({
          id: 'a9',
          conversationId: 'c9',
          content: 'I do not have indexed source material that answers this question yet.',
          citations: [],
          missingInformation: ['No evidence about session notes.'],
          streamStatus: 'completed',
        }),
      });
      emitStreamEvent?.({ type: 'done', data: { ok: true } });
      stream.resolve();
      await stream.promise;
    });

    await waitFor(() => {
      expect(result.current.streaming).toBe(false);
    });
    expect(result.current.messages.map((item) => item.id)).toEqual(['u9', 'a9']);
    expect(result.current.messages[1]).toMatchObject({
      content: 'I do not have indexed source material that answers this question yet.',
      citations: [],
      missingInformation: ['No evidence about session notes.'],
    });
    expect(result.current.hasStreamPreview).toBe(false);
  });

  it('preserves streamed messages when a new conversation load resolves late', async () => {
    const stream = deferred();
    const delayedMessages = deferred<ConversationMessage[]>();
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        emitStreamEvent = onEvent;
        await stream.promise;
      }
    );
    const listConversationMessages = vi.fn((conversationId: string) => {
      if (conversationId === 'c9') {
        return delayedMessages.promise;
      }

      return Promise.resolve([]);
    });

    const { result, rerender } = renderHook(
      ({ conversationId }: { conversationId: string | undefined }) =>
        useChatWorkflow({
          conversationId,
          ensureConversationId: () => Promise.resolve('c9'),
          services: {
            listConversationMessages,
            streamConversationMessage,
          },
        }),
      { initialProps: { conversationId: undefined as string | undefined } }
    );

    act(() => {
      result.current.setComposer('Any notes?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalledWith(
        'c9',
        'Any notes?',
        expect.any(Function),
        expect.any(AbortSignal)
      );
    });

    rerender({ conversationId: 'c9' });
    await waitFor(() => {
      expect(listConversationMessages).toHaveBeenCalledWith('c9');
    });

    act(() => {
      emitStreamEvent?.({
        type: 'message.created',
        data: message({
          id: 'u9',
          conversationId: 'c9',
          role: 'user',
          content: 'Any notes?',
          citations: [],
          missingInformation: [],
        }),
      });
      emitStreamEvent?.({
        type: 'answer.final',
        data: message({
          id: 'a9',
          conversationId: 'c9',
          content: 'I do not have indexed source material that answers this question yet.',
          citations: [],
          missingInformation: ['No evidence about session notes.'],
          streamStatus: 'completed',
        }),
      });
    });
    expect(result.current.messages.map((item) => item.id)).toEqual(['u9', 'a9']);

    await act(async () => {
      delayedMessages.resolve([]);
      await delayedMessages.promise;
    });

    expect(result.current.messages.map((item) => item.id)).toEqual(['u9', 'a9']);

    await act(async () => {
      stream.resolve();
      await stream.promise;
    });
  });

  it('dedupes message-created events when the loaded messages already include the user message', async () => {
    const stream = deferred();
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const loadedUserMessage = message({
      id: 'u9',
      conversationId: 'c9',
      role: 'user',
      content: 'Any notes?',
      citations: [],
      missingInformation: [],
    });
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        emitStreamEvent = onEvent;
        await stream.promise;
      }
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c9',
        ensureConversationId: () => Promise.resolve('c9'),
        services: {
          listConversationMessages: () => Promise.resolve([loadedUserMessage]),
          streamConversationMessage,
        },
      })
    );

    await waitFor(() => {
      expect(result.current.messages.map((item) => item.id)).toEqual(['u9']);
    });

    act(() => {
      result.current.setComposer('Any notes?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalled();
    });

    act(() => {
      emitStreamEvent?.({
        type: 'message.created',
        data: message({
          id: 'u9',
          conversationId: 'c9',
          role: 'user',
          content: 'Any notes?',
          createdAt: '2026-06-14T10:00:01.000Z',
          citations: [],
          missingInformation: [],
        }),
      });
    });

    expect(result.current.messages.map((item) => item.id)).toEqual(['u9']);

    await act(async () => {
      stream.resolve();
      await stream.promise;
    });
  });

  it('replaces loaded assistant messages when the final stream event has the same id', async () => {
    const stream = deferred();
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const loadedAssistantMessage = message({
      id: 'a9',
      conversationId: 'c9',
      content: 'Loaded placeholder content.',
      citations: [],
      missingInformation: [],
    });
    const finalAssistantMessage = message({
      id: 'a9',
      conversationId: 'c9',
      content: 'Final grounded answer.',
      citations: [{ sourceId: 'source-1', usedFor: 'final evidence' }],
      missingInformation: ['No evidence about water temperature.'],
      streamStatus: 'completed',
    });
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        emitStreamEvent = onEvent;
        await stream.promise;
      }
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c9',
        ensureConversationId: () => Promise.resolve('c9'),
        services: {
          listConversationMessages: () => Promise.resolve([loadedAssistantMessage]),
          streamConversationMessage,
        },
      })
    );

    await waitFor(() => {
      expect(result.current.messages.map((item) => item.id)).toEqual(['a9']);
    });

    act(() => {
      result.current.setComposer('Any notes?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalled();
    });

    act(() => {
      emitStreamEvent?.({
        type: 'answer.final',
        data: finalAssistantMessage,
      });
    });

    expect(result.current.messages.map((item) => item.id)).toEqual(['a9']);
    expect(result.current.messages[0]).toMatchObject({
      content: 'Final grounded answer.',
      citations: [{ sourceId: 'source-1', usedFor: 'final evidence' }],
      missingInformation: ['No evidence about water temperature.'],
    });

    await act(async () => {
      stream.resolve();
      await stream.promise;
    });
  });

  it('ignores stale stream messages for another selected conversation', async () => {
    const stream = deferred();
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        emitStreamEvent = onEvent;
        await stream.promise;
      }
    );

    const { result, rerender } = renderHook(
      ({ conversationId }: { conversationId: string | undefined }) =>
        useChatWorkflow({
          conversationId,
          ensureConversationId: () => Promise.resolve('c1'),
          services: {
            listConversationMessages: () => Promise.resolve([]),
            streamConversationMessage,
          },
        }),
      { initialProps: { conversationId: 'c1' } }
    );

    act(() => {
      result.current.setComposer('Old question?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalled();
    });

    rerender({ conversationId: 'c9' });
    await waitFor(() => {
      expect(result.current.messages).toEqual([]);
    });

    act(() => {
      emitStreamEvent?.({
        type: 'message.created',
        data: message({
          id: 'u1',
          conversationId: 'c1',
          role: 'user',
          content: 'Old question?',
          citations: [],
          missingInformation: [],
        }),
      });
      emitStreamEvent?.({
        type: 'answer.final',
        data: message({
          id: 'a1',
          conversationId: 'c1',
          content: 'Old answer.',
          citations: [],
          missingInformation: [],
          streamStatus: 'completed',
        }),
      });
    });

    expect(result.current.messages).toEqual([]);

    await act(async () => {
      stream.resolve();
      await stream.promise;
    });
  });

  it('hides stale stream preview state after navigating to another conversation', async () => {
    const stream = deferred();
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        emitStreamEvent = onEvent;
        await stream.promise;
      }
    );

    const { result, rerender } = renderHook(
      ({ conversationId }: { conversationId: string | undefined }) =>
        useChatWorkflow({
          conversationId,
          ensureConversationId: () => Promise.resolve('c1'),
          services: {
            listConversationMessages: () => Promise.resolve([]),
            streamConversationMessage,
          },
        }),
      { initialProps: { conversationId: 'c1' } }
    );

    act(() => {
      result.current.setComposer('Old question?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalled();
    });

    act(() => {
      emitStreamEvent?.({
        type: 'answer.citation',
        data: { citation: { sourceId: 'source-1', usedFor: 'old evidence' } },
      });
      emitStreamEvent?.({
        type: 'answer.missing_info',
        data: { missingInformation: ['Old missing info.'] },
      });
    });

    expect(result.current.hasStreamPreview).toBe(true);
    expect(result.current.streaming).toBe(true);
    expect(result.current.streamError).toBeNull();

    rerender({ conversationId: 'c9' });

    expect(result.current.hasStreamPreview).toBe(false);
    expect(result.current.streaming).toBe(false);
    expect(result.current.streamDraft).toBe('');
    expect(result.current.streamCitations).toEqual([]);
    expect(result.current.streamMissing).toEqual([]);
    expect(result.current.streamError).toBeNull();

    await act(async () => {
      stream.resolve();
      await stream.promise;
    });
  });

  it('clears stale stream preview state after navigating to the blank chat route', async () => {
    const stream = deferred();
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    let streamSignal: AbortSignal | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void,
        signal?: AbortSignal
      ) => {
        emitStreamEvent = onEvent;
        streamSignal = signal;
        await stream.promise;
      }
    );
    const initialProps: { conversationId: string | undefined } = { conversationId: 'c1' };

    const { result, rerender } = renderHook(
      ({ conversationId }: { conversationId: string | undefined }) =>
        useChatWorkflow({
          conversationId,
          ensureConversationId: () => Promise.resolve('c1'),
          services: {
            listConversationMessages: () => Promise.resolve([]),
            streamConversationMessage,
          },
        }),
      { initialProps }
    );

    act(() => {
      result.current.setComposer('Old question?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalled();
    });

    act(() => {
      emitStreamEvent?.({
        type: 'answer.citation',
        data: { citation: { sourceId: 'source-1', usedFor: 'old evidence' } },
      });
      emitStreamEvent?.({
        type: 'answer.missing_info',
        data: { missingInformation: ['Old missing info.'] },
      });
    });

    expect(result.current.hasStreamPreview).toBe(true);
    expect(result.current.streaming).toBe(true);

    rerender({ conversationId: undefined });

    expect(result.current.hasStreamPreview).toBe(false);
    expect(result.current.streaming).toBe(false);
    expect(result.current.streamDraft).toBe('');
    expect(result.current.streamCitations).toEqual([]);
    expect(result.current.streamMissing).toEqual([]);
    expect(result.current.streamError).toBeNull();
    expect(streamSignal?.aborted).toBe(true);

    await act(async () => {
      stream.resolve();
      await stream.promise;
    });
  });

  it('aborts an active stream when the chat workflow unmounts', async () => {
    const stream = deferred();
    let streamSignal: AbortSignal | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        _onEvent: (event: ChatStreamEvent) => void,
        signal?: AbortSignal
      ) => {
        streamSignal = signal;
        await stream.promise;
      }
    );

    const { result, unmount } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Old question?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalled();
    });

    unmount();

    expect(streamSignal?.aborted).toBe(true);

    await act(async () => {
      stream.resolve();
      await stream.promise;
    });
  });

  it('clears unsafe draft preview when a stream error arrives before final', async () => {
    const stream = deferred();
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        emitStreamEvent = onEvent;
        await stream.promise;
      }
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Will this fail?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalled();
    });

    act(() => {
      emitStreamEvent?.({
        type: 'answer.citation',
        data: { citation: { sourceId: 'source-1', usedFor: 'unsafe evidence' } },
      });
      emitStreamEvent?.({
        type: 'answer.missing_info',
        data: { missingInformation: ['Unsafe missing info.'] },
      });
      emitStreamEvent?.({ type: 'error', data: { message: 'Answer validation failed.' } });
    });

    expect(result.current.streamError).toBe('Answer validation failed.');
    expect(result.current.hasStreamPreview).toBe(false);
    expect(result.current.streamDraft).toBe('');
    expect(result.current.streamCitations).toEqual([]);
    expect(result.current.streamMissing).toEqual([]);

    await act(async () => {
      stream.resolve();
      await stream.promise;
    });
  });

  it('keeps the visible failed final answer after a stream error follows a failed final event', async () => {
    const stream = deferred();
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        emitStreamEvent = onEvent;
        await stream.promise;
      }
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Roach setup?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });
    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalled();
    });

    act(() => {
      emitStreamEvent?.({
        type: 'retrieval.completed',
        data: { sourceCounts: [], topEvidenceIds: [] },
      });
    });

    expect(result.current.streamPhase).toBe('writing');

    act(() => {
      emitStreamEvent?.({
        type: 'answer.final',
        data: message({
          id: 'a-failed',
          content: 'Use a sensitive float rig.',
          streamStatus: 'failed',
          errorMessage: 'Answer generation failed. Please try again.',
        }),
      });
    });

    expect(result.current.messages.at(-1)).toMatchObject({
      id: 'a-failed',
      content: 'Use a sensitive float rig.',
      streamStatus: 'failed',
    });
    expect(result.current.streamDraft).toBe('');
    expect(result.current.streamError).toBe('Answer generation failed. Please try again.');

    act(() => {
      emitStreamEvent?.({
        type: 'error',
        data: { message: 'Answer generation failed. Please try again.' },
      });
    });

    await act(async () => {
      stream.resolve();
      await stream.promise;
    });

    expect(result.current.messages.at(-1)).toMatchObject({
      id: 'a-failed',
      content: 'Use a sensitive float rig.',
      streamStatus: 'failed',
    });
    expect(result.current.streamDraft).toBe('');
    expect(result.current.streamError).toBe('Answer generation failed. Please try again.');
  });

  it('shows a friendly recovery error when the stream request rejects because the network fails', async () => {
    const streamConversationMessage = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Any bait?');
    });
    await act(async () => {
      await result.current.handleSendMessage();
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.streamError).toBe(
      'Connection interrupted. Check your network and try again.'
    );
    expect(result.current.composer).toBe('Any bait?');
  });

  it('loads a persisted failed draft when the transport drops after the user message is accepted', async () => {
    const persistedUserMessage = message({
      id: 'u-network',
      conversationId: 'c1',
      role: 'user',
      content: 'Rig parameters?',
      citations: [],
      missingInformation: [],
    });
    const persistedAssistantDraft = message({
      id: 'a-network',
      conversationId: 'c1',
      content: 'Saved draft answer with placeholder details.',
      citations: [],
      missingInformation: [],
      streamStatus: 'failed',
    });
    const listConversationMessages = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([persistedUserMessage, persistedAssistantDraft]);
    const streamConversationMessage = vi.fn(
      (_conversationId: string, _message: string, onEvent: (event: ChatStreamEvent) => void) => {
        onEvent({ type: 'message.created', data: persistedUserMessage });
        return Promise.reject(new TypeError('Failed to fetch'));
      }
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages,
          streamConversationMessage,
        },
      })
    );

    await waitFor(() => {
      expect(listConversationMessages).toHaveBeenCalledWith('c1');
    });

    act(() => {
      result.current.setComposer('Rig parameters?');
    });
    await act(async () => {
      await result.current.handleSendMessage();
    });

    expect(listConversationMessages).toHaveBeenCalledTimes(2);
    expect(result.current.messages.map((item) => item.id)).toEqual(['u-network', 'a-network']);
    expect(result.current.messages.at(-1)).toMatchObject({
      id: 'a-network',
      content: 'Saved draft answer with placeholder details.',
      streamStatus: 'failed',
    });
    expect(result.current.streamError).toBeNull();
    expect(result.current.composer).toBe('');
  });

  it('keeps the recovery error when refetch finds only older assistant messages', async () => {
    const oldUserMessage = message({
      id: 'u-old',
      conversationId: 'c1',
      role: 'user',
      content: 'Previous question',
      citations: [],
      missingInformation: [],
      createdAt: '2026-06-14T09:00:00.000Z',
    });
    const oldAssistantMessage = message({
      id: 'a-old',
      conversationId: 'c1',
      content: 'Previous answer.',
      citations: [],
      missingInformation: [],
      streamStatus: 'completed',
      createdAt: '2026-06-14T09:00:05.000Z',
    });
    const persistedUserMessage = message({
      id: 'u-network',
      conversationId: 'c1',
      role: 'user',
      content: 'Rig parameters?',
      citations: [],
      missingInformation: [],
      createdAt: '2026-06-14T10:00:00.000Z',
    });
    const listConversationMessages = vi
      .fn()
      .mockResolvedValueOnce([oldUserMessage, oldAssistantMessage])
      .mockResolvedValueOnce([oldUserMessage, oldAssistantMessage, persistedUserMessage]);
    const streamConversationMessage = vi.fn(
      (_conversationId: string, _message: string, onEvent: (event: ChatStreamEvent) => void) => {
        onEvent({ type: 'message.created', data: persistedUserMessage });
        return Promise.reject(new TypeError('Failed to fetch'));
      }
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages,
          streamConversationMessage,
        },
      })
    );

    await waitFor(() => {
      expect(result.current.messages.map((item) => item.id)).toEqual(['u-old', 'a-old']);
    });

    act(() => {
      result.current.setComposer('Rig parameters?');
    });
    await act(async () => {
      await result.current.handleSendMessage();
    });

    expect(listConversationMessages).toHaveBeenCalledTimes(2);
    expect(result.current.messages.map((item) => item.id)).toEqual(['u-old', 'a-old', 'u-network']);
    expect(result.current.streamError).toBe(
      'Connection interrupted. Check your network and try again.'
    );
    expect(result.current.composer).toBe('');
  });

  it('shows a friendly recovery error when the stream setup returns a gateway error', async () => {
    const streamConversationMessage = vi.fn(() =>
      Promise.reject(new ApiClientError('API request failed with status 502.', 502))
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Any bait?');
    });
    await act(async () => {
      await result.current.handleSendMessage();
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.streamError).toBe(
      'Connection interrupted. Check your network and try again.'
    );
    expect(result.current.composer).toBe('Any bait?');
  });

  it('shows a friendly recovery error when a stream error event contains raw gateway copy', async () => {
    const stream = deferred();
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        emitStreamEvent = onEvent;
        await stream.promise;
      }
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Any bait?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalled();
    });

    act(() => {
      emitStreamEvent?.({
        type: 'error',
        data: { message: 'API request failed with status 502.' },
      });
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.streamError).toBe(
      'Connection interrupted. Check your network and try again.'
    );

    await act(async () => {
      stream.resolve();
      await stream.promise;
    });
  });

  it('shows a friendly recovery error when a failed final answer contains raw gateway copy', async () => {
    const stream = deferred();
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        emitStreamEvent = onEvent;
        await stream.promise;
      }
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Any bait?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalled();
    });

    act(() => {
      emitStreamEvent?.({
        type: 'answer.final',
        data: message({
          id: 'a-gateway',
          content: '',
          streamStatus: 'failed',
          errorMessage: 'API request failed with status 502.',
        }),
      });
    });

    expect(result.current.streamError).toBe(
      'Connection interrupted. Check your network and try again.'
    );

    await act(async () => {
      stream.resolve();
      await stream.promise;
    });
  });

  it('does not restore the composer when the stream accepted the user message before failing', async () => {
    const stream = deferred();
    let sendPromise: Promise<void> | undefined;
    let emitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        emitStreamEvent = onEvent;
        await stream.promise;
      }
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Accepted question?');
    });
    act(() => {
      sendPromise = result.current.handleSendMessage();
    });
    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalled();
    });

    act(() => {
      emitStreamEvent?.({
        type: 'message.created',
        data: message({
          id: 'u-accepted',
          role: 'user',
          content: 'Accepted question?',
          citations: [],
          missingInformation: [],
        }),
      });
    });

    await act(async () => {
      stream.reject(new Error('Chat service unavailable'));
      await sendPromise;
    });

    expect(result.current.streamError).toBe('Chat service unavailable');
    expect(result.current.composer).toBe('');
  });

  it('ignores blank submissions without creating or streaming a message', async () => {
    const ensureConversationId = vi.fn(() => Promise.resolve('c1'));
    const streamConversationMessage = vi.fn();

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId,
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('   ');
    });
    await act(async () => {
      await result.current.handleSendMessage();
    });

    expect(ensureConversationId).not.toHaveBeenCalled();
    expect(streamConversationMessage).not.toHaveBeenCalled();
    expect(result.current.streaming).toBe(false);
  });

  it('notifies when conversation activity settles so the rail can refresh', async () => {
    const stream = deferred();
    const onConversationActivity = vi.fn();
    const streamConversationMessage = vi.fn(async () => {
      await stream.promise;
    });

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        onConversationActivity,
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Refresh the rail?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalled();
    });
    expect(onConversationActivity).not.toHaveBeenCalled();

    await act(async () => {
      stream.resolve();
      await stream.promise;
    });

    await waitFor(() => {
      expect(onConversationActivity).toHaveBeenCalledWith('c1');
    });
  });

  it('queues one follow-up while streaming and sends it after a successful final answer', async () => {
    const firstStream = deferred();
    const secondStream = deferred();
    let firstEmitStreamEvent: ((event: ChatStreamEvent) => void) | undefined;
    const streamConversationMessage = vi.fn(
      async (
        _conversationId: string,
        _message: string,
        onEvent: (event: ChatStreamEvent) => void
      ) => {
        if (streamConversationMessage.mock.calls.length === 1) {
          firstEmitStreamEvent = onEvent;
          await firstStream.promise;
          return;
        }

        await secondStream.promise;
      }
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('First question?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.setComposer('Follow-up question?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    expect(result.current.composer).toBe('');
    expect(result.current.queuedFollowUp).toBe('Follow-up question?');
    expect(streamConversationMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstEmitStreamEvent?.({
        type: 'answer.final',
        data: message({
          id: 'a-complete',
          content: 'First answer.',
          streamStatus: 'completed',
        }),
      });
      firstStream.resolve();
      await firstStream.promise;
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalledTimes(2);
    });
    expect(streamConversationMessage).toHaveBeenLastCalledWith(
      'c1',
      'Follow-up question?',
      expect.any(Function),
      expect.any(AbortSignal)
    );
    expect(result.current.queuedFollowUp).toBeNull();
    secondStream.resolve();
  });

  it('keeps a queued follow-up when the active stream is cancelled', async () => {
    const stream = deferred();
    const streamConversationMessage = vi.fn(async () => {
      await stream.promise;
    });

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('First question?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.setComposer('Follow-up question?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    act(() => {
      result.current.cancelStream();
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.queuedFollowUp).toBe('Follow-up question?');
    expect(streamConversationMessage).toHaveBeenCalledTimes(1);
    stream.resolve();
  });

  it('locks sending while creating a new conversation', async () => {
    const ensureConversation = deferred<string>();
    const stream = deferred();
    const ensureConversationId = vi.fn(() => ensureConversation.promise);
    const streamConversationMessage = vi.fn(async () => {
      await stream.promise;
    });

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: undefined,
        ensureConversationId,
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('New chat question?');
    });
    act(() => {
      void result.current.handleSendMessage();
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(result.current.streaming).toBe(true);
    });
    expect(ensureConversationId).toHaveBeenCalledTimes(1);
    expect(streamConversationMessage).not.toHaveBeenCalled();

    await act(async () => {
      ensureConversation.resolve('c1');
      await ensureConversation.promise;
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalledTimes(1);
    });
    expect(streamConversationMessage).toHaveBeenCalledWith(
      'c1',
      'New chat question?',
      expect.any(Function),
      expect.any(AbortSignal)
    );

    await act(async () => {
      stream.resolve();
      await stream.promise;
    });
  });

  it('continues a blank-chat send when creating the conversation navigates to it', async () => {
    const ensureConversation = deferred<string>();
    const routeChangeFlushed = deferred();
    const stream = deferred();
    const initialProps: { conversationId: string | undefined } = { conversationId: undefined };
    let rerenderRoute: (props: { conversationId: string | undefined }) => void = () => {
      throw new Error('rerender not ready');
    };
    const ensureConversationId = vi.fn(async () => {
      const createdConversationId = await ensureConversation.promise;
      rerenderRoute({ conversationId: createdConversationId });
      await routeChangeFlushed.promise;
      return createdConversationId;
    });
    const streamConversationMessage = vi.fn(async () => {
      await stream.promise;
    });

    const { result, rerender } = renderHook(
      ({ conversationId }: { conversationId: string | undefined }) =>
        useChatWorkflow({
          conversationId,
          ensureConversationId,
          services: {
            listConversationMessages: () => Promise.resolve([]),
            streamConversationMessage,
          },
        }),
      { initialProps }
    );
    rerenderRoute = rerender;

    act(() => {
      result.current.setComposer('New chat topic?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(result.current.streaming).toBe(true);
    });

    await act(async () => {
      ensureConversation.resolve('created-conversation');
      await ensureConversation.promise;
    });
    await act(async () => {
      routeChangeFlushed.resolve();
      await routeChangeFlushed.promise;
    });

    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalledWith(
        'created-conversation',
        'New chat topic?',
        expect.any(Function),
        expect.any(AbortSignal)
      );
    });

    await act(async () => {
      stream.resolve();
      await stream.promise;
    });
  });

  it('cancels pending blank-chat sends after navigating to another conversation', async () => {
    const ensureConversation = deferred<string>();
    const stream = deferred();
    let ensureCallCount = 0;
    const ensureConversationId = vi.fn(() => {
      ensureCallCount += 1;
      return ensureCallCount === 1 ? ensureConversation.promise : Promise.resolve('c9');
    });
    const streamConversationMessage = vi.fn(async () => {
      await stream.promise;
    });
    const initialProps: { conversationId: string | undefined } = { conversationId: undefined };

    const { result, rerender } = renderHook(
      ({ conversationId }: { conversationId: string | undefined }) =>
        useChatWorkflow({
          conversationId,
          ensureConversationId,
          services: {
            listConversationMessages: () => Promise.resolve([]),
            streamConversationMessage,
          },
        }),
      { initialProps }
    );

    act(() => {
      result.current.setComposer('Pending blank-chat question?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    await waitFor(() => {
      expect(result.current.streaming).toBe(true);
    });
    expect(ensureConversationId).toHaveBeenCalledTimes(1);

    rerender({ conversationId: 'c9' });

    expect(result.current.streaming).toBe(false);
    expect(streamConversationMessage).not.toHaveBeenCalled();

    await act(async () => {
      ensureConversation.resolve('created-old');
      await ensureConversation.promise;
    });

    expect(streamConversationMessage).not.toHaveBeenCalled();

    act(() => {
      result.current.setComposer('Current conversation question?');
    });
    act(() => {
      void result.current.handleSendMessage();
    });

    expect(ensureConversationId).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(streamConversationMessage).toHaveBeenCalledWith(
        'c9',
        'Current conversation question?',
        expect.any(Function),
        expect.any(AbortSignal)
      );
    });

    await act(async () => {
      stream.resolve();
      await stream.promise;
    });
  });

  it('reports conversation creation failures as stream errors', async () => {
    const ensureConversationId = vi.fn(() =>
      Promise.reject(new Error('Conversation create failed'))
    );
    const streamConversationMessage = vi.fn();

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: undefined,
        ensureConversationId,
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('New chat question?');
    });
    await act(async () => {
      await result.current.handleSendMessage();
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.streamError).toBe('Conversation create failed');
    expect(result.current.composer).toBe('New chat question?');
    expect(streamConversationMessage).not.toHaveBeenCalled();
  });

  it('shows a friendly recovery error when blank-chat conversation creation returns a gateway error', async () => {
    const ensureConversationId = vi.fn(() =>
      Promise.reject(new ApiClientError('API request failed with status 502.', 502))
    );
    const streamConversationMessage = vi.fn();

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: undefined,
        ensureConversationId,
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('New chat question?');
    });
    await act(async () => {
      await result.current.handleSendMessage();
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.streamError).toBe(
      'Connection interrupted. Check your network and try again.'
    );
    expect(result.current.composer).toBe('New chat question?');
    expect(streamConversationMessage).not.toHaveBeenCalled();
  });

  it('reports rejected stream requests as user-visible stream errors', async () => {
    const streamConversationMessage = vi.fn(() =>
      Promise.reject(new Error('Chat service unavailable'))
    );

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Will this fail?');
    });
    await act(async () => {
      await result.current.handleSendMessage();
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.streamError).toBe('Chat service unavailable');
  });

  it('uses a fallback stream error for non-Error rejections', async () => {
    const streamConversationMessage = vi.fn(() => nonErrorRejectedPromise('offline'));

    const { result } = renderHook(() =>
      useChatWorkflow({
        conversationId: 'c1',
        ensureConversationId: () => Promise.resolve('c1'),
        services: {
          listConversationMessages: () => Promise.resolve([]),
          streamConversationMessage,
        },
      })
    );

    act(() => {
      result.current.setComposer('Will this fail?');
    });
    await act(async () => {
      await result.current.handleSendMessage();
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.streamError).toBe('Request failed.');
  });
});
