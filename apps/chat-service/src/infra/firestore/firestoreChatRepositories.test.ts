import { describe, expect, it } from 'vitest';

import type { AnswerGapCandidate } from '../../domain/models/answerGapCandidate.js';
import type { Conversation, ConversationMessage } from '../../domain/models/chat.js';
import type { ChatModelSettings } from '../../domain/models/chatSettings.js';
import {
  ANSWER_GAP_CANDIDATES_COLLECTION,
  CHAT_RUNTIME_SETTINGS_COLLECTION,
  CONVERSATION_MESSAGES_COLLECTION,
  CONVERSATIONS_COLLECTION,
} from './collections.js';
import { FirestoreAnswerGapCandidateRepository } from './firestoreAnswerGapCandidateRepository.js';
import { FirestoreChatSettingsRepository } from './firestoreChatSettingsRepository.js';
import { FirestoreConversationMessageRepository } from './firestoreConversationMessageRepository.js';
import { FirestoreConversationMessageWriteRepository } from './firestoreConversationMessageWriteRepository.js';
import { FirestoreConversationRepository } from './firestoreConversationRepository.js';
import { isoFromTimestamp, timestampFromIso } from './firestoreMapping.js';

type Direction = 'asc' | 'desc';
type WhereOp = '==';

class FakeDocumentSnapshot {
  constructor(
    readonly id: string,
    private readonly value: Record<string, unknown> | undefined
  ) {}

  get exists(): boolean {
    return this.value !== undefined;
  }

  data(): Record<string, unknown> | undefined {
    return this.value;
  }
}

class FakeDocumentRef {
  constructor(
    private readonly collection: FakeCollectionRef,
    readonly id: string
  ) {}

  create(value: Record<string, unknown>): Promise<void> {
    if (this.collection.docs.has(this.id)) {
      const error = new Error('already exists') as Error & { code: number };
      error.code = 6;
      throw error;
    }

    this.collection.docs.set(this.id, value);
    return Promise.resolve();
  }

  set(value: Record<string, unknown>): Promise<void> {
    this.collection.docs.set(this.id, value);
    return Promise.resolve();
  }

  update(value: Record<string, unknown>): Promise<void> {
    const existing = this.collection.docs.get(this.id);
    if (existing === undefined) {
      throw new Error('not found');
    }

    this.collection.docs.set(this.id, applyPatch(existing, value));
    return Promise.resolve();
  }

  get(): Promise<FakeDocumentSnapshot> {
    return Promise.resolve(new FakeDocumentSnapshot(this.id, this.collection.docs.get(this.id)));
  }
}

class FakeQuery {
  private readonly filters: { field: string; op: WhereOp; value: unknown }[];
  private readonly orderings: { field: string; direction: Direction }[];

  constructor(
    private readonly collection: FakeCollectionRef,
    filters: { field: string; op: WhereOp; value: unknown }[] = [],
    orderings: { field: string; direction: Direction }[] = []
  ) {
    this.filters = filters;
    this.orderings = orderings;
  }

  where(field: string, op: WhereOp, value: unknown): FakeQuery {
    return new FakeQuery(this.collection, [...this.filters, { field, op, value }], this.orderings);
  }

  orderBy(field: string, direction: Direction): FakeQuery {
    return new FakeQuery(this.collection, this.filters, [...this.orderings, { field, direction }]);
  }

  get(): Promise<{ docs: FakeDocumentSnapshot[] }> {
    const rows = [...this.collection.docs.entries()]
      .map(([id, value]) => ({ id, value }))
      .filter(({ value }) => this.filters.every((filter) => value[filter.field] === filter.value))
      .sort((left, right) => compareRows(left.value, right.value, this.orderings));

    return Promise.resolve({
      docs: rows.map((row) => new FakeDocumentSnapshot(row.id, row.value)),
    });
  }
}

class FakeCollectionRef extends FakeQuery {
  readonly docs = new Map<string, Record<string, unknown>>();

  constructor(readonly name: string) {
    super(undefined as never);
    Object.defineProperty(this, 'collection', { value: this });
  }

  doc(id: string): FakeDocumentRef {
    return new FakeDocumentRef(this, id);
  }
}

class FakeFirestore {
  readonly collections = new Map<string, FakeCollectionRef>();

  collection(name: string): FakeCollectionRef {
    const existing = this.collections.get(name);
    if (existing !== undefined) {
      return existing;
    }

    const created = new FakeCollectionRef(name);
    this.collections.set(name, created);
    return created;
  }

  runTransaction<T>(handler: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
    return handler(new FakeTransaction());
  }
}

class FakeTransaction {
  get(ref: FakeDocumentRef): Promise<FakeDocumentSnapshot> {
    return ref.get();
  }

  create(ref: FakeDocumentRef, value: Record<string, unknown>): this {
    void ref.create(value);
    return this;
  }

  update(ref: FakeDocumentRef, value: Record<string, unknown>): this {
    void ref.update(value);
    return this;
  }

  set(ref: FakeDocumentRef, value: Record<string, unknown>): this {
    void ref.set(value);
    return this;
  }
}

class ThrowingDocumentRef {
  create(): Promise<never> {
    return Promise.reject(new Error('firestore exploded'));
  }

  set(): Promise<never> {
    return Promise.reject(new Error('firestore exploded'));
  }

  get(): Promise<never> {
    return Promise.reject(new Error('firestore exploded'));
  }
}

class ThrowingCollectionRef {
  doc(): ThrowingDocumentRef {
    return new ThrowingDocumentRef();
  }

  where(): this {
    return this;
  }

  orderBy(): this {
    return this;
  }

  get(): Promise<never> {
    return Promise.reject(new Error('firestore exploded'));
  }
}

class ThrowingFirestore {
  collection(): ThrowingCollectionRef {
    return new ThrowingCollectionRef();
  }
}

function applyPatch(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      'operand' in value &&
      typeof (value as { operand?: unknown }).operand === 'number'
    ) {
      const operand = (value as { operand: number }).operand;
      next[key] = (typeof next[key] === 'number' ? next[key] : 0) + operand;
      continue;
    }

    next[key] = value;
  }

  return next;
}

function compareValue(value: unknown): string | number {
  if (value !== null && typeof value === 'object' && 'toDate' in value) {
    const date = (value as { toDate: () => Date }).toDate();
    return date.getTime();
  }

  return typeof value === 'string' || typeof value === 'number' ? value : '';
}

function compareRows(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  orderings: readonly { field: string; direction: Direction }[]
): number {
  for (const ordering of orderings) {
    const leftValue = compareValue(left[ordering.field]);
    const rightValue = compareValue(right[ordering.field]);
    if (leftValue === rightValue) {
      continue;
    }

    const result = leftValue < rightValue ? -1 : 1;
    return ordering.direction === 'asc' ? result : -result;
  }

  return 0;
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    userId: 'user-1',
    title: 'New Chat',
    status: 'active',
    createdAt: '2026-06-14T12:00:00.000Z',
    updatedAt: '2026-06-14T12:00:00.000Z',
    lastMessageAt: '2026-06-14T12:00:00.000Z',
    lastMessagePreview: '',
    messageCount: 0,
    deletedAt: null,
    ...overrides,
  };
}

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: 'message-1',
    userId: 'user-1',
    conversationId: 'conversation-1',
    role: 'user',
    content: 'Hello',
    createdAt: '2026-06-14T12:00:00.000Z',
    citations: [],
    missingInformation: [],
    ...overrides,
  };
}

function answerGapCandidate(overrides: Partial<AnswerGapCandidate> = {}): AnswerGapCandidate {
  return {
    id: 'answer-gap-candidate-message-1',
    status: 'pending_user_consent',
    userId: 'user-1',
    source: 'no_accessible_evidence',
    question: 'Jak łowić na koncentrat białkowy przy 6°C?',
    missingInformation: ['Brakuje informacji o koncentracie białkowym przy 6°C.'],
    requester: {
      userId: 'user-1',
      email: null,
      firstName: null,
      lastName: null,
      role: 'user',
      effectiveLevel: 3,
    },
    conversation: {
      conversationId: 'conversation-1',
      userMessageId: 'user-message-1',
      assistantMessageId: 'assistant-message-1',
      contextWindow: [{ role: 'user', content: 'Jak łowić na koncentrat białkowy przy 6°C?' }],
    },
    coverageProbe: {
      classification: 'no_candidate_seen',
      minRequiredLevel: null,
      candidateCountBucket: '0',
      probeVersion: '1.0.0',
    },
    coverageKind: 'global_no_candidate_seen',
    createdAt: '2026-06-28T12:00:00.000Z',
    updatedAt: '2026-06-28T12:00:00.000Z',
    expiresAt: '2026-07-28T12:00:00.000Z',
    sharedAt: null,
    declinedAt: null,
    withdrawnAt: null,
    sharedGapId: null,
    ...overrides,
  };
}

function chatModelSetting(overrides: Partial<ChatModelSettings> = {}): ChatModelSettings {
  return {
    id: 'chat-model',
    provider: 'openrouter',
    modelId: 'google/gemini-3.5-flash',
    revision: 1,
    updatedAt: '2026-06-19T12:00:00.000Z',
    updatedByUserId: 'admin-user-1',
    ...overrides,
  };
}

const promptVersions = {
  answer: { name: 'fishing-answer', version: '2.0.0' },
} satisfies NonNullable<ConversationMessage['promptVersions']>;

describe('Firestore chat repositories', () => {
  it('stores, reads, and updates answer gap candidates', async () => {
    const firestore = new FakeFirestore();
    const repo = new FirestoreAnswerGapCandidateRepository(firestore as never);
    const candidate = answerGapCandidate();

    await expect(repo.create(candidate)).resolves.toEqual({ ok: true, value: candidate });
    const storedCandidate = firestore
      .collection(ANSWER_GAP_CANDIDATES_COLLECTION)
      .docs.get(candidate.id);
    expect(storedCandidate).toMatchObject({
      status: 'pending_user_consent',
      userId: 'user-1',
      requester: { email: null },
    });
    expect(storedCandidate).toHaveProperty('createdAt');
    expect(storedCandidate).toHaveProperty('expiresAt');

    await expect(repo.getById(candidate.id)).resolves.toEqual({ ok: true, value: candidate });

    const shared = {
      ...candidate,
      status: 'shared' as const,
      updatedAt: '2026-06-28T12:03:00.000Z',
      sharedAt: '2026-06-28T12:03:00.000Z',
      sharedGapId: 'answer-gap-assistant-message-1',
    };
    await expect(repo.update(shared)).resolves.toEqual({ ok: true, value: shared });
    await expect(repo.getById(candidate.id)).resolves.toEqual({ ok: true, value: shared });
  });

  it('handles answer gap candidate missing, duplicate, and retired documents', async () => {
    const firestore = new FakeFirestore();
    const repo = new FirestoreAnswerGapCandidateRepository(firestore as never);
    const candidate = answerGapCandidate();

    await expect(repo.getById('missing-candidate')).resolves.toEqual({ ok: true, value: null });
    await expect(repo.update(candidate)).resolves.toEqual({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Answer gap candidate answer-gap-candidate-message-1 not found',
      },
    });

    await repo.create(candidate);
    await expect(repo.create(candidate)).resolves.toEqual({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: 'Answer gap candidate answer-gap-candidate-message-1 already exists',
      },
    });

    firestore.collection(ANSWER_GAP_CANDIDATES_COLLECTION).docs.set('retired-candidate', {
      status: 'pending_user_consent',
      userId: 'user-1',
      source: 'no_accessible_evidence',
      question: 42,
      missingInformation: ['Kept', 12],
      requester: {
        userId: 'user-1',
        email: 'retired@example.com',
        role: 'admin',
      },
      conversation: {
        conversationId: 'conversation-1',
        userMessageId: 'user-message-1',
        assistantMessageId: 'assistant-message-1',
        contextWindow: [
          null,
          { role: 'assistant', content: 'Assistant context' },
          { role: 'system', content: 'Fallback role' },
        ],
      },
      coverageProbe: {
        classification: 'no_candidate_seen',
        minRequiredLevel: 5,
        candidateCountBucket: '1',
      },
      coverageKind: 'global_no_candidate_seen',
      createdAt: timestampFromIso('2026-06-28T12:00:00.000Z'),
      updatedAt: timestampFromIso('2026-06-28T12:01:00.000Z'),
      expiresAt: timestampFromIso('2026-07-28T12:00:00.000Z'),
    });

    const retired = await repo.getById('retired-candidate');
    if (!retired.ok || retired.value === null) {
      throw new Error('Expected retired candidate to be readable.');
    }
    expect(retired.value.id).toBe('retired-candidate');
    expect(retired.value.question).toBe('');
    expect(retired.value.missingInformation).toEqual(['Kept']);
    expect(retired.value.requester).toEqual({
      userId: 'user-1',
      email: 'retired@example.com',
      firstName: null,
      lastName: null,
      role: 'admin',
      effectiveLevel: 0,
    });
    expect(retired.value.conversation.contextWindow).toEqual([
      { role: 'assistant', content: 'Assistant context' },
      { role: 'user', content: 'Fallback role' },
    ]);
    expect(retired.value.coverageProbe).toEqual({
      classification: 'no_candidate_seen',
      minRequiredLevel: 5,
      candidateCountBucket: '1',
      probeVersion: '1.0.0',
    });
    expect(retired.value.sharedAt).toBeNull();
    expect(retired.value.declinedAt).toBeNull();
    expect(retired.value.withdrawnAt).toBeNull();
    expect(retired.value.sharedGapId).toBeNull();
  });

  it('stores, reads, and updates chat model settings with revision checks', async () => {
    const firestore = new FakeFirestore();
    const repo = new FirestoreChatSettingsRepository(firestore as never);

    await expect(repo.getChatModelSettings()).resolves.toEqual({ ok: true, value: null });
    await expect(
      repo.saveChatModelSettings({
        provider: 'openrouter',
        modelId: 'google/gemma-4-31b-it',
        expectedRevision: 0,
        updatedAt: '2026-06-19T12:01:00.000Z',
        updatedByUserId: 'admin-user-1',
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        modelId: 'google/gemma-4-31b-it',
        revision: 1,
      },
    });
    await expect(repo.getChatModelSettings()).resolves.toMatchObject({
      ok: true,
      value: {
        id: 'chat-model',
        provider: 'openrouter',
        modelId: 'google/gemma-4-31b-it',
        revision: 1,
        updatedAt: '2026-06-19T12:01:00.000Z',
      },
    });

    const storedSettings = firestore
      .collection(CHAT_RUNTIME_SETTINGS_COLLECTION)
      .docs.get('chat-model');
    if (storedSettings === undefined) {
      throw new Error('Expected chat model settings to be stored.');
    }
    const updatedAt = storedSettings['updatedAt'];
    if (updatedAt === null || typeof updatedAt !== 'object' || !('toDate' in updatedAt)) {
      throw new Error('Expected updatedAt to be stored as a Firestore timestamp.');
    }
    expect(typeof updatedAt.toDate).toBe('function');
  });

  it('reads retired chat model settings without provider as OpenRouter settings', async () => {
    const firestore = new FakeFirestore();
    firestore.collection(CHAT_RUNTIME_SETTINGS_COLLECTION).docs.set('chat-model', {
      id: 'chat-model',
      modelId: 'google/gemma-4-31b-it',
      revision: 1,
      updatedAt: timestampFromIso('2026-06-19T12:01:00.000Z'),
      updatedByUserId: 'admin-user-1',
    });
    const repo = new FirestoreChatSettingsRepository(firestore as never);

    await expect(repo.getChatModelSettings()).resolves.toMatchObject({
      ok: true,
      value: {
        provider: 'openrouter',
        modelId: 'google/gemma-4-31b-it',
      },
    });
  });

  it('rejects stale chat model setting revisions', async () => {
    const firestore = new FakeFirestore();
    firestore
      .collection(CHAT_RUNTIME_SETTINGS_COLLECTION)
      .docs.set('chat-model', { ...chatModelSetting({ revision: 2 }) });
    const repo = new FirestoreChatSettingsRepository(firestore as never);

    await expect(
      repo.saveChatModelSettings({
        provider: 'openrouter',
        modelId: 'openai/gpt-4o-mini',
        expectedRevision: 1,
        updatedAt: '2026-06-19T12:01:00.000Z',
        updatedByUserId: 'admin-user-1',
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: 'Chat model setting revision 1 is stale',
      },
    });
  });

  it('stores and queries conversations by userId without userId fallback', async () => {
    const firestore = new FakeFirestore();
    const repo = new FirestoreConversationRepository(firestore as never);

    await repo.create({
      id: 'owned',
      userId: 'user-1',
      title: 'New Chat',
      status: 'active',
      createdAt: '2026-06-14T12:00:00.000Z',
      updatedAt: '2026-06-14T12:00:00.000Z',
      lastMessageAt: '2026-06-14T12:00:00.000Z',
      lastMessagePreview: '',
      messageCount: 0,
      deletedAt: null,
    });
    firestore.collection(CONVERSATIONS_COLLECTION).docs.set('retired-workspace', {
      workspaceId: 'user-1',
      title: 'Retired',
      status: 'active',
      createdAt: new Date('2026-06-14T12:00:00.000Z'),
      updatedAt: new Date('2026-06-14T12:00:00.000Z'),
      lastMessageAt: new Date('2026-06-14T12:00:00.000Z'),
      lastMessagePreview: '',
      messageCount: 0,
      deletedAt: null,
    });

    expect(firestore.collection(CONVERSATIONS_COLLECTION).docs.get('owned')).toMatchObject({
      userId: 'user-1',
    });
    await expect(repo.listActive({ userId: 'user-1' })).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          id: 'owned',
          userId: 'user-1',
        }),
      ],
    });
    await expect(repo.getById({ userId: 'user-2', conversationId: 'owned' })).resolves.toEqual({
      ok: true,
      value: null,
    });
    await expect(
      repo.getById({ userId: 'user-1', conversationId: 'retired-workspace' })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it('filters message reads and append writes by userId', async () => {
    const firestore = new FakeFirestore();
    const reader = new FirestoreConversationMessageRepository(firestore as never);
    const writer = new FirestoreConversationMessageWriteRepository(firestore as never);

    firestore.collection(CONVERSATIONS_COLLECTION).docs.set('conversation-1', {
      userId: 'user-1',
      title: 'New Chat',
      status: 'active',
      createdAt: new Date('2026-06-14T12:00:00.000Z'),
      updatedAt: new Date('2026-06-14T12:00:00.000Z'),
      lastMessageAt: new Date('2026-06-14T12:00:00.000Z'),
      lastMessagePreview: '',
      messageCount: 0,
      deletedAt: null,
    });
    firestore.collection(CONVERSATION_MESSAGES_COLLECTION).docs.set('user-1-message', {
      userId: 'user-1',
      conversationId: 'conversation-1',
      role: 'user',
      content: 'Visible',
      createdAt: new Date('2026-06-14T12:00:00.000Z'),
      citations: [],
      missingInformation: [],
    });
    firestore.collection(CONVERSATION_MESSAGES_COLLECTION).docs.set('user-2-message', {
      userId: 'user-2',
      conversationId: 'conversation-1',
      role: 'user',
      content: 'Filtered',
      createdAt: new Date('2026-06-14T12:01:00.000Z'),
      citations: [],
      missingInformation: [],
    });

    await expect(
      reader.listByConversation({ userId: 'user-1', conversationId: 'conversation-1' })
    ).resolves.toEqual({
      ok: true,
      value: [expect.objectContaining({ id: 'user-1-message', userId: 'user-1' })],
    });
    await expect(
      writer.appendToActiveConversation({
        message: {
          id: 'new-message',
          userId: 'user-2',
          conversationId: 'conversation-1',
          role: 'user',
          content: 'Blocked',
          createdAt: '2026-06-14T12:02:00.000Z',
          citations: [],
          missingInformation: [],
        },
        metadata: {
          updatedAt: '2026-06-14T12:02:00.000Z',
          lastMessageAt: '2026-06-14T12:02:00.000Z',
          lastMessagePreview: 'Blocked',
          titleIfFirstMessage: 'Blocked',
        },
      })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation conversation-1 not found' },
    });
  });

  it('maps timestamps and rejects invalid timestamp fields', () => {
    const timestamp = timestampFromIso('2026-06-14T12:00:00.000Z');

    expect(isoFromTimestamp(timestamp, 'createdAt')).toBe('2026-06-14T12:00:00.000Z');
    expect(isoFromTimestamp('2026-06-14T12:01:00.000Z', 'createdAt')).toBe(
      '2026-06-14T12:01:00.000Z'
    );
    expect(isoFromTimestamp(new Date('2026-06-14T12:02:00.000Z'), 'createdAt')).toBe(
      '2026-06-14T12:02:00.000Z'
    );
    expect(() => isoFromTimestamp(42, 'createdAt')).toThrow(
      'createdAt must be a Firestore Timestamp, Date, or ISO string'
    );
  });

  it('creates, lists, gets, and updates conversations with workspace and soft-delete guards', async () => {
    const repo = new FirestoreConversationRepository(new FakeFirestore() as never);
    await repo.create(conversation({ id: 'old', lastMessageAt: '2026-06-14T12:00:00.000Z' }));
    await repo.create(conversation({ id: 'new', lastMessageAt: '2026-06-14T12:05:00.000Z' }));
    await repo.create(
      conversation({
        id: 'deleted',
        status: 'deleted',
        deletedAt: '2026-06-14T12:06:00.000Z',
      })
    );

    await expect(repo.listActive({ userId: 'user-1' })).resolves.toMatchObject({
      ok: true,
      value: [{ id: 'new' }, { id: 'old' }],
    });
    await expect(
      repo.getById({ userId: 'other-workspace', conversationId: 'old' })
    ).resolves.toEqual({ ok: true, value: null });
    await expect(repo.getById({ userId: 'user-1', conversationId: 'missing' })).resolves.toEqual({
      ok: true,
      value: null,
    });
    await expect(repo.update(conversation({ id: 'missing' }))).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation missing not found' },
    });
    await expect(
      repo.update(conversation({ id: 'old', userId: 'other-workspace' }))
    ).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation old not found' },
    });
    await expect(repo.update(conversation({ id: 'old', title: 'Updated' }))).resolves.toMatchObject(
      {
        ok: true,
        value: { id: 'old', title: 'Updated' },
      }
    );
  });

  it('falls back for malformed optional conversation fields from Firestore', async () => {
    const firestore = new FakeFirestore();
    firestore.collection(CONVERSATIONS_COLLECTION).docs.set('malformed', {
      userId: 'user-1',
      title: 42,
      status: 'active',
      createdAt: new Date('2026-06-14T12:00:00.000Z'),
      updatedAt: new Date('2026-06-14T12:01:00.000Z'),
      lastMessageAt: new Date('2026-06-14T12:02:00.000Z'),
      lastMessagePreview: null,
      messageCount: 'two',
      deletedAt: new Date('2026-06-14T12:03:00.000Z'),
    });
    const repo = new FirestoreConversationRepository(firestore as never);

    await expect(repo.getById({ userId: 'user-1', conversationId: 'malformed' })).resolves.toEqual({
      ok: true,
      value: {
        id: 'malformed',
        userId: 'user-1',
        title: '',
        status: 'active',
        createdAt: '2026-06-14T12:00:00.000Z',
        updatedAt: '2026-06-14T12:01:00.000Z',
        lastMessageAt: '2026-06-14T12:02:00.000Z',
        lastMessagePreview: '',
        messageCount: 0,
        deletedAt: '2026-06-14T12:03:00.000Z',
      },
    });
  });

  it('creates and lists messages chronologically with assistant metadata', async () => {
    const firestore = new FakeFirestore();
    const repo = new FirestoreConversationMessageRepository(firestore as never);
    await repo.create(message({ id: 'second', createdAt: '2026-06-14T12:02:00.000Z' }));
    await repo.create(
      message({
        id: 'first',
        role: 'assistant',
        content: 'Answer',
        createdAt: '2026-06-14T12:01:00.000Z',
        modelId: 'google/gemini-3.5-flash',
        confidence: 'medium',
        citations: [{ sourceId: 'knowledge-page:public-1', usedFor: 'test' }],
        missingInformation: ['No weather data.'],
        promptVersions,
        streamStatus: 'completed',
      })
    );

    expect(firestore.collection(CONVERSATION_MESSAGES_COLLECTION).docs.get('first')).toMatchObject({
      promptVersions,
    });
    await expect(
      repo.listByConversation({ userId: 'user-1', conversationId: 'conversation-1' })
    ).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          id: 'first',
          role: 'assistant',
          citations: [{ sourceId: 'knowledge-page:public-1', usedFor: 'test' }],
          missingInformation: ['No weather data.'],
          promptVersions,
          streamStatus: 'completed',
        }),
        expect.objectContaining({ id: 'second', role: 'user' }),
      ],
    });
  });

  it('filters malformed message metadata and preserves retrieval and error fields', async () => {
    const firestore = new FakeFirestore();
    firestore.collection(CONVERSATION_MESSAGES_COLLECTION).docs.set('malformed-message', {
      userId: 'user-1',
      conversationId: 'conversation-1',
      role: 'assistant',
      content: 'Failed answer',
      createdAt: new Date('2026-06-14T12:00:00.000Z'),
      modelId: 'google/gemini-3.5-flash',
      confidence: 'low',
      citations: [
        null,
        { sourceId: 42, usedFor: 'bad source' },
        { sourceId: 'knowledge-page:public-1', usedFor: 'supported answer' },
        { sourceId: 'knowledge-page:public-2', usedFor: 42 },
      ],
      missingInformation: ['No weather data.', 42],
      promptVersions: {
        answer: { name: 'fishing-answer', version: 42 },
      },
      retrieval: {
        query: 'method feeder',
        startedAt: '2026-06-14T12:00:00.000Z',
        completedAt: '2026-06-14T12:00:00.000Z',
        sources: [],
        evidence: [],
      },
      streamStatus: 'failed',
      errorMessage: 'Assistant answer was not valid JSON',
    });
    firestore.collection(CONVERSATION_MESSAGES_COLLECTION).docs.set('other-workspace', {
      userId: 'other-workspace',
      conversationId: 'conversation-1',
      role: 'user',
      content: 'Filtered',
      createdAt: new Date('2026-06-14T12:01:00.000Z'),
      citations: [],
      missingInformation: [],
    });
    const repo = new FirestoreConversationMessageRepository(firestore as never);

    await expect(
      repo.listByConversation({ userId: 'user-1', conversationId: 'conversation-1' })
    ).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          id: 'malformed-message',
          citations: [{ sourceId: 'knowledge-page:public-1', usedFor: 'supported answer' }],
          missingInformation: ['No weather data.'],
          retrieval: {
            query: 'method feeder',
            startedAt: '2026-06-14T12:00:00.000Z',
            completedAt: '2026-06-14T12:00:00.000Z',
            sources: [],
            evidence: [],
          },
          streamStatus: 'failed',
          errorMessage: 'Assistant answer was not valid JSON',
        }),
      ],
    });
    const result = await repo.listByConversation({
      userId: 'user-1',
      conversationId: 'conversation-1',
    });
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value[0]).not.toHaveProperty('promptVersions');
  });

  it('returns conflicts for duplicate creates', async () => {
    const conversations = new FirestoreConversationRepository(new FakeFirestore() as never);
    await conversations.create(conversation());

    await expect(conversations.create(conversation())).resolves.toEqual({
      ok: false,
      error: { code: 'CONFLICT', message: 'Conversation conversation-1 already exists' },
    });

    const messages = new FirestoreConversationMessageRepository(new FakeFirestore() as never);
    await messages.create(message());
    await expect(messages.create(message())).resolves.toEqual({
      ok: false,
      error: { code: 'CONFLICT', message: 'Conversation message message-1 already exists' },
    });
  });

  it('atomically appends messages to active conversations with partial metadata patches', async () => {
    const firestore = new FakeFirestore();
    const conversations = new FirestoreConversationRepository(firestore as never);
    const writer = new FirestoreConversationMessageWriteRepository(firestore as never);
    await conversations.create(conversation());

    await expect(
      writer.appendToActiveConversation({
        message: message({ id: 'message-1', content: 'First user question' }),
        metadata: {
          updatedAt: '2026-06-14T12:01:00.000Z',
          lastMessageAt: '2026-06-14T12:01:00.000Z',
          lastMessagePreview: 'First user question',
          titleIfFirstMessage: 'First user question',
        },
      })
    ).resolves.toMatchObject({ ok: true, value: { id: 'message-1' } });

    const storedConversation = firestore
      .collection(CONVERSATIONS_COLLECTION)
      .docs.get('conversation-1');
    expect(storedConversation).toMatchObject({
      userId: 'user-1',
      title: 'First user question',
      status: 'active',
      lastMessagePreview: 'First user question',
      lastMessageRole: 'user',
      messageCount: 1,
      deletedAt: null,
    });
    expect(storedConversation?.['createdAt']).toBeDefined();
    expect(storedConversation?.['updatedAt']).not.toBe('2026-06-14T12:00:00.000Z');
    expect(firestore.collection(CONVERSATION_MESSAGES_COLLECTION).docs.get('message-1')).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        conversationId: 'conversation-1',
        content: 'First user question',
      })
    );

    await expect(
      writer.appendToActiveConversation({
        message: message({ id: 'message-1' }),
        metadata: {
          updatedAt: '2026-06-14T12:02:00.000Z',
          lastMessageAt: '2026-06-14T12:02:00.000Z',
          lastMessagePreview: 'Duplicate',
        },
      })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'CONFLICT', message: 'Conversation message message-1 already exists' },
    });

    await conversations.update(
      conversation({
        status: 'deleted',
        deletedAt: '2026-06-14T12:03:00.000Z',
        messageCount: 1,
      })
    );
    await expect(
      writer.appendToActiveConversation({
        message: message({ id: 'message-2' }),
        metadata: {
          updatedAt: '2026-06-14T12:04:00.000Z',
          lastMessageAt: '2026-06-14T12:04:00.000Z',
          lastMessagePreview: 'After delete',
        },
      })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation conversation-1 not found' },
    });
    expect(firestore.collection(CONVERSATION_MESSAGES_COLLECTION).docs.has('message-2')).toBe(
      false
    );
  });

  it('maps Firestore failures to internal repository errors', async () => {
    const answerGapCandidates = new FirestoreAnswerGapCandidateRepository(
      new ThrowingFirestore() as never
    );
    await expect(answerGapCandidates.create(answerGapCandidate())).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'firestore exploded' },
    });
    await expect(answerGapCandidates.getById('answer-gap-candidate-message-1')).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'firestore exploded' },
    });
    await expect(answerGapCandidates.update(answerGapCandidate())).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'firestore exploded' },
    });

    const conversations = new FirestoreConversationRepository(new ThrowingFirestore() as never);
    await expect(conversations.create(conversation())).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'firestore exploded' },
    });
    await expect(
      conversations.getById({ userId: 'user-1', conversationId: 'conversation-1' })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'firestore exploded' },
    });
    await expect(conversations.listActive({ userId: 'user-1' })).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'firestore exploded' },
    });
    await expect(conversations.update(conversation())).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'firestore exploded' },
    });

    const messages = new FirestoreConversationMessageRepository(new ThrowingFirestore() as never);
    await expect(messages.create(message())).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'firestore exploded' },
    });
    await expect(
      messages.listByConversation({
        userId: 'user-1',
        conversationId: 'conversation-1',
      })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'firestore exploded' },
    });
  });
});
