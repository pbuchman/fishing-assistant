import { describe, expect, it } from 'vitest';

import { ok, type Clock } from '@fa/common-core';
import type { AnswerGapRequesterSnapshot, CreateAnswerGapRequest } from '@fa/http-contracts';

import { MemoryAnswerGapCandidateRepository } from '../../infra/memory/memoryAnswerGapCandidateRepository.js';
import type { AnswerGapCandidate } from '../models/answerGapCandidate.js';
import type { ConversationMessage } from '../models/chat.js';
import {
  answerGapCandidateUseCaseInternals,
  answerGapShareSnapshotFromMessages,
  createPendingAnswerGapCandidate,
  declineAnswerGapCandidate,
  shareAnswerGapCandidate,
  withdrawAnswerGapCandidate,
} from './answerGapCandidates.js';

const clock: Clock = {
  now: () => new Date('2026-06-28T12:00:00.000Z'),
};

const requester: AnswerGapRequesterSnapshot = {
  userId: 'user-1',
  email: 'gap-user@example.com',
  firstName: 'River',
  lastName: 'Walker',
  role: 'user',
  effectiveLevel: 3,
};

function basePendingInput(
  overrides: Partial<Parameters<typeof createPendingAnswerGapCandidate>[1]> = {}
): Parameters<typeof createPendingAnswerGapCandidate>[1] {
  return {
    source: 'no_accessible_evidence',
    question: 'Jak łowić na koncentrat białkowy przy 6°C?',
    missingInformation: ['Brakuje informacji o koncentracie białkowym przy 6°C.'],
    requester,
    conversation: {
      conversationId: 'conversation-1',
      userMessageId: 'user-message-1',
      assistantMessageId: 'assistant/message-1',
      contextWindow: [
        { role: 'user', content: 'Łowię zimą na wodzie klubowej.' },
        { role: 'assistant', content: 'Nie mam materiału w Bazie Wiedzy.' },
      ],
    },
    coverageProbe: {
      classification: 'no_candidate_seen',
      minRequiredLevel: null,
      candidateCountBucket: '0',
      probeVersion: '1.0.0',
    },
    ...overrides,
  };
}

async function createCandidate(
  repository: MemoryAnswerGapCandidateRepository,
  overrides: Partial<Parameters<typeof createPendingAnswerGapCandidate>[1]> = {}
): Promise<AnswerGapCandidate> {
  const result = await createPendingAnswerGapCandidate(
    { repository, clock },
    basePendingInput(overrides)
  );
  if (!result.ok || result.value.candidate === null) {
    throw new Error('Expected a pending candidate to be created.');
  }
  return result.value.candidate;
}

class RecordingAnswerGapSink {
  readonly requests: CreateAnswerGapRequest[] = [];
  readonly withdrawals: { gapId: string; candidateId: string }[] = [];
  createError: Error | null = null;
  withdrawError: Error | null = null;

  create(request: CreateAnswerGapRequest): Promise<void> {
    if (this.createError !== null) {
      return Promise.reject(this.createError);
    }

    this.requests.push(request);
    return Promise.resolve();
  }

  withdrawConsent(request: { gapId: string; candidateId: string }): Promise<void> {
    if (this.withdrawError !== null) {
      return Promise.reject(this.withdrawError);
    }

    this.withdrawals.push(request);
    return Promise.resolve();
  }
}

function shareDeps(repository: MemoryAnswerGapCandidateRepository, sink: RecordingAnswerGapSink) {
  return {
    repository,
    clock,
    answerGapSink: sink,
    resolveShareSnapshot: ({ includeContext }: { includeContext: boolean }) =>
      Promise.resolve(
        ok({
          question: 'Jak łowić na koncentrat białkowy przy 6°C?',
          contextWindow: includeContext
            ? [
                { role: 'user' as const, content: 'Łowię zimą na wodzie klubowej.' },
                { role: 'assistant' as const, content: 'Nie mam materiału w Bazie Wiedzy.' },
              ]
            : [],
        })
      ),
  };
}

function conversationMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: 'message-1',
    userId: 'user-1',
    conversationId: 'conversation-1',
    role: 'user',
    content: 'Jak łowić na koncentrat białkowy przy 6°C?',
    createdAt: '2026-06-28T11:59:00.000Z',
    citations: [],
    missingInformation: [],
    ...overrides,
  };
}

describe('answer gap candidates', () => {
  it('creates a pending candidate for a global Knowledge Base gap', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();

    const result = await createPendingAnswerGapCandidate({ repository, clock }, basePendingInput());

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.candidate : null).toMatchObject({
      id: 'answer-gap-candidate-assistant_message-1',
      status: 'pending_user_consent',
      userId: 'user-1',
      question: '',
      requester: {
        email: null,
        firstName: null,
        lastName: null,
      },
      conversation: {
        contextWindow: [],
      },
      coverageKind: 'global_no_candidate_seen',
      expiresAt: '2026-07-28T12:00:00.000Z',
    });
  });

  it('creates a pending candidate for unsupported accessible evidence', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();

    const result = await createPendingAnswerGapCandidate(
      { repository, clock },
      basePendingInput({
        source: 'unsupported_by_retrieved_evidence',
        coverageProbe: {
          classification: 'accessible_candidate_seen',
          minRequiredLevel: null,
          candidateCountBucket: '2-5',
          probeVersion: '1.0.0',
        },
      })
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.candidate?.coverageKind : null).toBe(
      'unsupported_by_accessible_evidence'
    );
  });

  it('does not create a candidate when the assistant produced no missing-information items', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();

    const result = await createPendingAnswerGapCandidate(
      { repository, clock },
      basePendingInput({ missingInformation: [' ', ''] })
    );

    expect(result).toEqual({ ok: true, value: { candidate: null } });
  });

  it('maps ambiguous coverage probes to coverage_unknown for non-shareable candidates', () => {
    expect(
      answerGapCandidateUseCaseInternals.coverageKindFromProbe({
        source: 'no_accessible_evidence',
        coverageProbe: undefined,
      })
    ).toBe('coverage_unknown');
    expect(
      answerGapCandidateUseCaseInternals.coverageKindFromProbe({
        source: 'no_accessible_evidence',
        coverageProbe: {
          classification: 'accessible_candidate_seen',
          minRequiredLevel: null,
          candidateCountBucket: '1',
          probeVersion: '1.0.0',
        },
      })
    ).toBe('coverage_unknown');
  });

  it.each(['higher_level_candidate_seen', 'restricted_or_invalid_candidate_seen'] as const)(
    'does not create a shareable candidate for %s',
    async (classification) => {
      const repository = new MemoryAnswerGapCandidateRepository();

      const result = await createPendingAnswerGapCandidate(
        { repository, clock },
        basePendingInput({
          coverageProbe: {
            classification,
            minRequiredLevel: classification === 'higher_level_candidate_seen' ? 7 : null,
            candidateCountBucket: '1',
            probeVersion: '1.0.0',
          },
        })
      );

      expect(result.ok).toBe(true);
      expect(result.ok ? result.value.candidate : 'unexpected error').toBeNull();
    }
  );

  it('reconstructs a share snapshot from persisted messages and trims context to the assistant answer', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();
    const candidate = await createCandidate(repository);
    const messages = [
      conversationMessage({ id: 'old-1', content: 'Starsza wiadomość 1' }),
      conversationMessage({ id: 'old-2', content: 'Starsza wiadomość 2' }),
      conversationMessage({ id: 'old-3', content: 'Starsza wiadomość 3' }),
      conversationMessage({ id: 'old-4', content: 'Starsza wiadomość 4' }),
      conversationMessage({ id: 'old-5', content: 'Starsza wiadomość 5' }),
      conversationMessage({ id: 'old-6', content: 'Starsza wiadomość 6' }),
      conversationMessage({ id: 'old-7', content: 'Starsza wiadomość 7' }),
      conversationMessage({ id: 'old-8', content: 'Starsza wiadomość 8' }),
      conversationMessage({ id: 'old-9', content: 'Starsza wiadomość 9' }),
      conversationMessage({
        id: 'user-message-1',
        content: '  Jak łowić na koncentrat białkowy przy 6°C?  ',
      }),
      conversationMessage({
        id: 'assistant/message-1',
        role: 'assistant',
        content: 'Nie mam materiału w Bazie Wiedzy.',
      }),
      conversationMessage({ id: 'later', content: 'Nie powinno wejść do kontekstu.' }),
    ];

    const result = answerGapShareSnapshotFromMessages({
      candidate,
      messages,
      includeContext: true,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.question : null).toBe(
      'Jak łowić na koncentrat białkowy przy 6°C?'
    );
    expect(result.ok ? result.value.contextWindow : []).toHaveLength(8);
    expect(result.ok ? result.value.contextWindow[0]?.content : null).toBe('Starsza wiadomość 3');
    expect(result.ok ? result.value.contextWindow.at(-1)?.content : null).toBe(
      '  Jak łowić na koncentrat białkowy przy 6°C?  '
    );
  });

  it('rejects share snapshots when the original user question is unavailable', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();
    const candidate = await createCandidate(repository);

    const result = answerGapShareSnapshotFromMessages({
      candidate,
      messages: [
        conversationMessage({
          id: 'user-message-1',
          role: 'assistant',
          content: 'Wrong role',
        }),
      ],
      includeContext: false,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('INVALID_REQUEST');
  });

  it.each([
    [false, false, 0, null],
    [true, false, 2, null],
    [false, true, 0, requester.email],
    [true, true, 2, requester.email],
  ] as const)(
    'shares a candidate with includeContext=%s and includeContact=%s',
    async (includeContext, includeContact, expectedContextCount, expectedEmail) => {
      const repository = new MemoryAnswerGapCandidateRepository();
      const candidate = await createCandidate(repository);
      const sink = new RecordingAnswerGapSink();

      const result = await shareAnswerGapCandidate(shareDeps(repository, sink), {
        candidateId: candidate.id,
        userId: 'user-1',
        requester,
        includeContext,
        includeContact,
      });

      expect(result.ok).toBe(true);
      expect(sink.requests).toHaveLength(1);
      expect(sink.requests[0]).toMatchObject({
        coverageKind: 'global_no_candidate_seen',
        consent: {
          status: 'user_shared',
          sharedAt: '2026-06-28T12:00:00.000Z',
          includeContext,
          includeContact,
          candidateId: candidate.id,
        },
      });
      expect(sink.requests[0]?.conversation.contextWindow).toHaveLength(expectedContextCount);
      expect(sink.requests[0]?.requester.email).toBe(expectedEmail);
    }
  );

  it('rejects sharing by a different user', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();
    const candidate = await createCandidate(repository);
    const sink = new RecordingAnswerGapSink();

    const result = await shareAnswerGapCandidate(shareDeps(repository, sink), {
      candidateId: candidate.id,
      userId: 'user-2',
      requester,
      includeContext: true,
      includeContact: true,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('NOT_FOUND');
    expect(sink.requests).toHaveLength(0);
  });

  it('rejects expired candidates before sending anything to Knowledge Service', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();
    const candidate = await createCandidate(repository, {
      expiresAt: '2026-06-28T11:59:59.000Z',
    });
    const sink = new RecordingAnswerGapSink();

    const result = await shareAnswerGapCandidate(shareDeps(repository, sink), {
      candidateId: candidate.id,
      userId: 'user-1',
      requester,
      includeContext: true,
      includeContact: true,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('EXPIRED');
    expect(sink.requests).toHaveLength(0);
  });

  it('returns a downstream error when Knowledge Service rejects a share', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();
    const candidate = await createCandidate(repository);
    const sink = new RecordingAnswerGapSink();
    sink.createError = new Error('knowledge unavailable');

    const result = await shareAnswerGapCandidate(shareDeps(repository, sink), {
      candidateId: candidate.id,
      userId: 'user-1',
      requester,
      includeContext: true,
      includeContact: true,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toEqual({
      code: 'DOWNSTREAM_ERROR',
      message: 'knowledge unavailable',
    });
  });

  it('does not send duplicate Knowledge Service requests after a candidate has been shared', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();
    const candidate = await createCandidate(repository);
    const sink = new RecordingAnswerGapSink();

    const first = await shareAnswerGapCandidate(shareDeps(repository, sink), {
      candidateId: candidate.id,
      userId: 'user-1',
      requester,
      includeContext: true,
      includeContact: true,
    });
    const second = await shareAnswerGapCandidate(shareDeps(repository, sink), {
      candidateId: candidate.id,
      userId: 'user-1',
      requester,
      includeContext: true,
      includeContact: true,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(sink.requests).toHaveLength(1);
    expect(second.ok ? second.value.created : true).toBe(false);
  });

  it('rejects sharing a candidate that has already been declined', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();
    const candidate = await createCandidate(repository);
    const sink = new RecordingAnswerGapSink();
    const declined = await declineAnswerGapCandidate(
      { repository, clock },
      { candidateId: candidate.id, userId: 'user-1' }
    );
    expect(declined.ok).toBe(true);

    const result = await shareAnswerGapCandidate(shareDeps(repository, sink), {
      candidateId: candidate.id,
      userId: 'user-1',
      requester,
      includeContext: true,
      includeContact: true,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('INVALID_REQUEST');
    expect(sink.requests).toHaveLength(0);
  });

  it('declines a pending candidate owned by the current user', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();
    const candidate = await createCandidate(repository);

    const result = await declineAnswerGapCandidate(
      { repository, clock },
      { candidateId: candidate.id, userId: 'user-1' }
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.candidate.status : null).toBe('declined');
    expect(result.ok ? result.value.candidate.declinedAt : null).toBe('2026-06-28T12:00:00.000Z');
    expect(result.ok ? result.value.candidate.missingInformation : []).toEqual([]);
  });

  it('is idempotent when declining an already declined candidate', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();
    const candidate = await createCandidate(repository);

    await declineAnswerGapCandidate(
      { repository, clock },
      { candidateId: candidate.id, userId: 'user-1' }
    );
    const result = await declineAnswerGapCandidate(
      { repository, clock },
      { candidateId: candidate.id, userId: 'user-1' }
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.candidate.status : null).toBe('declined');
  });

  it('rejects declining a candidate owned by a different user', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();
    const candidate = await createCandidate(repository);

    const result = await declineAnswerGapCandidate(
      { repository, clock },
      { candidateId: candidate.id, userId: 'user-2' }
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('NOT_FOUND');
  });

  it('rejects declining a candidate that has already been shared', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();
    const candidate = await createCandidate(repository);
    const sink = new RecordingAnswerGapSink();
    const shared = await shareAnswerGapCandidate(shareDeps(repository, sink), {
      candidateId: candidate.id,
      userId: 'user-1',
      requester,
      includeContext: true,
      includeContact: true,
    });
    expect(shared.ok).toBe(true);

    const result = await declineAnswerGapCandidate(
      { repository, clock },
      { candidateId: candidate.id, userId: 'user-1' }
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('INVALID_REQUEST');
  });

  it('withdraws a shared candidate and redacts retained candidate payload', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();
    const candidate = await createCandidate(repository);
    const sink = new RecordingAnswerGapSink();
    const shared = await shareAnswerGapCandidate(shareDeps(repository, sink), {
      candidateId: candidate.id,
      userId: 'user-1',
      requester,
      includeContext: true,
      includeContact: true,
    });
    if (!shared.ok) {
      throw new Error(shared.error.message);
    }

    const result = await withdrawAnswerGapCandidate(
      { repository, clock, answerGapSink: sink },
      { candidateId: candidate.id, userId: 'user-1' }
    );

    expect(result.ok).toBe(true);
    expect(sink.withdrawals).toEqual([
      {
        gapId: 'answer-gap-assistant_message-1',
        candidateId: candidate.id,
      },
    ]);
    expect(result.ok ? result.value.candidate : null).toMatchObject({
      status: 'withdrawn',
      withdrawnAt: '2026-06-28T12:00:00.000Z',
      missingInformation: [],
      requester: { email: null, firstName: null, lastName: null },
      conversation: { contextWindow: [] },
    });
  });

  it('is idempotent when withdrawing an already withdrawn candidate', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();
    const candidate = await createCandidate(repository);
    const sink = new RecordingAnswerGapSink();
    const shared = await shareAnswerGapCandidate(shareDeps(repository, sink), {
      candidateId: candidate.id,
      userId: 'user-1',
      requester,
      includeContext: true,
      includeContact: true,
    });
    if (!shared.ok) {
      throw new Error(shared.error.message);
    }
    await withdrawAnswerGapCandidate(
      { repository, clock, answerGapSink: sink },
      { candidateId: candidate.id, userId: 'user-1' }
    );

    const result = await withdrawAnswerGapCandidate(
      { repository, clock, answerGapSink: sink },
      { candidateId: candidate.id, userId: 'user-1' }
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.candidate.status : null).toBe('withdrawn');
    expect(sink.withdrawals).toHaveLength(1);
  });

  it('rejects withdrawing a candidate owned by a different user', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();
    const candidate = await createCandidate(repository);

    const result = await withdrawAnswerGapCandidate(
      { repository, clock, answerGapSink: new RecordingAnswerGapSink() },
      { candidateId: candidate.id, userId: 'user-2' }
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('NOT_FOUND');
  });

  it('rejects withdrawing a candidate that has not been shared', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();
    const candidate = await createCandidate(repository);

    const result = await withdrawAnswerGapCandidate(
      { repository, clock, answerGapSink: new RecordingAnswerGapSink() },
      { candidateId: candidate.id, userId: 'user-1' }
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('INVALID_REQUEST');
  });

  it('returns a downstream error when Knowledge Service rejects a withdrawal', async () => {
    const repository = new MemoryAnswerGapCandidateRepository();
    const candidate = await createCandidate(repository);
    const sink = new RecordingAnswerGapSink();
    const shared = await shareAnswerGapCandidate(shareDeps(repository, sink), {
      candidateId: candidate.id,
      userId: 'user-1',
      requester,
      includeContext: true,
      includeContact: true,
    });
    if (!shared.ok) {
      throw new Error(shared.error.message);
    }
    sink.withdrawError = new Error('withdrawal unavailable');

    const result = await withdrawAnswerGapCandidate(
      { repository, clock, answerGapSink: sink },
      { candidateId: candidate.id, userId: 'user-1' }
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toEqual({
      code: 'DOWNSTREAM_ERROR',
      message: 'withdrawal unavailable',
    });
  });
});
