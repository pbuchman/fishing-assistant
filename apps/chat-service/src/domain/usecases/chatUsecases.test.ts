import { describe, expect, it } from 'vitest';

import { err, type Clock, type Result } from '@fa/common-core';

import type { Conversation, ConversationMessage } from '../models/chat.js';
import type {
  ChatRepositoryError,
  ConversationMessageWriteRepository,
  ConversationRepository,
} from '../repositories/chatRepositories.js';
import {
  MemoryConversationMessageRepository,
  MemoryConversationMessageWriteRepository,
  MemoryConversationRepository,
} from '../../infra/memory/memoryChatRepositories.js';
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
} from './conversationUsecases.js';
import {
  listConversationMessages,
  persistAssistantMessage,
  persistUserMessage,
} from './messageUsecases.js';

const clock: Clock = {
  now: () => new Date('2026-06-14T12:00:00.000Z'),
};

function ids(values: string[]): () => string {
  const next = [...values];
  return () => next.shift() ?? 'extra-id';
}

class FailingConversationRepository
  extends MemoryConversationRepository
  implements ConversationRepository
{
  override getById(): Promise<Result<Conversation | null, ChatRepositoryError>> {
    return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'get failed' }));
  }

  override update(): Promise<Result<Conversation, ChatRepositoryError>> {
    return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'update failed' }));
  }
}

class FailingMessageWriteRepository implements ConversationMessageWriteRepository {
  appendToActiveConversation(): Promise<Result<ConversationMessage, ChatRepositoryError>> {
    return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'message create failed' }));
  }
}

function messageWriter(
  conversationRepository: MemoryConversationRepository,
  messageRepository: MemoryConversationMessageRepository
): MemoryConversationMessageWriteRepository {
  return new MemoryConversationMessageWriteRepository(conversationRepository, messageRepository);
}

describe('chat conversation use cases', () => {
  it('creates, lists, gets, and soft-deletes conversations by userId', async () => {
    const conversationRepository = new MemoryConversationRepository();
    const deps = {
      conversationRepository,
      clock,
      generateId: ids(['conversation-1', 'conversation-2']),
    };

    const first = await createConversation(deps, { userId: 'user-1' });
    await createConversation(
      { ...deps, clock: { now: () => new Date('2026-06-14T12:01:00.000Z') } },
      { userId: 'user-1' }
    );

    await expect(
      listConversations({ conversationRepository }, { userId: 'user-1' })
    ).resolves.toMatchObject({
      ok: true,
      value: [{ id: 'conversation-2' }, { id: 'conversation-1' }],
    });
    await expect(
      getConversation(
        { conversationRepository },
        {
          userId: 'user-1',
          conversationId: 'conversation-1',
        }
      )
    ).resolves.toMatchObject({ ok: true, value: { id: 'conversation-1', status: 'active' } });

    await expect(
      deleteConversation(
        { conversationRepository, clock },
        {
          userId: 'user-1',
          conversationId: 'conversation-1',
        }
      )
    ).resolves.toEqual({ ok: true, value: { deleted: true } });

    expect(first).toMatchObject({
      ok: true,
      value: {
        userId: 'user-1',
        messageCount: 0,
        lastMessagePreview: '',
        deletedAt: null,
      },
    });
  });

  it('treats another users conversation as not found', async () => {
    const conversationRepository = new MemoryConversationRepository();
    await createConversation(
      { conversationRepository, clock, generateId: ids(['conversation-1']) },
      { userId: 'user-1' }
    );

    await expect(
      getConversation(
        { conversationRepository },
        {
          userId: 'user-2',
          conversationId: 'conversation-1',
        }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation conversation-1 not found' },
    });
    await expect(
      deleteConversation(
        { conversationRepository, clock },
        {
          userId: 'user-2',
          conversationId: 'conversation-1',
        }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation conversation-1 not found' },
    });
  });

  it('creates, lists, gets, and soft-deletes user-owned conversations', async () => {
    const conversationRepository = new MemoryConversationRepository();
    const deps = {
      conversationRepository,
      clock,
      generateId: ids(['conversation-1', 'conversation-2']),
    };

    const first = await createConversation(deps, { userId: 'user-1' });
    await createConversation(
      { ...deps, clock: { now: () => new Date('2026-06-14T12:01:00.000Z') } },
      { userId: 'user-1' }
    );

    await expect(
      listConversations({ conversationRepository }, { userId: 'user-1' })
    ).resolves.toMatchObject({
      ok: true,
      value: [{ id: 'conversation-2' }, { id: 'conversation-1' }],
    });
    await expect(
      getConversation(
        { conversationRepository },
        { userId: 'user-1', conversationId: 'conversation-1' }
      )
    ).resolves.toMatchObject({ ok: true, value: { id: 'conversation-1', status: 'active' } });

    await expect(
      deleteConversation(
        { conversationRepository, clock },
        { userId: 'user-1', conversationId: 'conversation-1' }
      )
    ).resolves.toEqual({ ok: true, value: { deleted: true } });
    await expect(
      getConversation(
        { conversationRepository },
        { userId: 'user-1', conversationId: 'conversation-1' }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation conversation-1 not found' },
    });
    await expect(
      listConversations({ conversationRepository }, { userId: 'user-1' })
    ).resolves.toMatchObject({
      ok: true,
      value: [{ id: 'conversation-2' }],
    });

    expect(first).toMatchObject({
      ok: true,
      value: {
        title: 'New Chat',
        userId: 'user-1',
        messageCount: 0,
        lastMessagePreview: '',
        deletedAt: null,
      },
    });
  });

  it('persists user messages, updates first-message title, and lists messages chronologically', async () => {
    const conversationRepository = new MemoryConversationRepository();
    const messageRepository = new MemoryConversationMessageRepository();
    await createConversation(
      { conversationRepository, clock, generateId: ids(['conversation-1']) },
      { userId: 'user-1' }
    );

    const longMessage = `  What should I change in cold conditions?

      Please include fixture detail if the notes mention it, but avoid guessing. ${'x'.repeat(140)} `;
    const firstMessage = await persistUserMessage(
      {
        conversationRepository,
        messageRepository,
        messageWriteRepository: messageWriter(conversationRepository, messageRepository),
        clock: { now: () => new Date('2026-06-14T12:02:00.000Z') },
        generateId: ids(['message-1']),
      },
      { userId: 'user-1', conversationId: 'conversation-1', content: longMessage }
    );
    const secondMessage = await persistUserMessage(
      {
        conversationRepository,
        messageRepository,
        messageWriteRepository: messageWriter(conversationRepository, messageRepository),
        clock: { now: () => new Date('2026-06-14T12:03:00.000Z') },
        generateId: ids(['message-2']),
      },
      { userId: 'user-1', conversationId: 'conversation-1', content: 'Thanks' }
    );
    const failedAssistantMessage = await persistAssistantMessage(
      {
        conversationRepository,
        messageRepository,
        messageWriteRepository: messageWriter(conversationRepository, messageRepository),
        clock: { now: () => new Date('2026-06-14T12:04:00.000Z') },
        generateId: ids(['message-3']),
      },
      {
        id: 'message-3',
        userId: 'user-1',
        conversationId: 'conversation-1',
        role: 'assistant',
        content: 'I could not complete this answer. Please try again.',
        createdAt: '2026-06-14T12:04:00.000Z',
        citations: [],
        missingInformation: [],
        streamStatus: 'failed',
        errorMessage: 'Answer generation failed. Please try again.',
      }
    );

    const messagesResult = await listConversationMessages(
      { conversationRepository, messageRepository },
      { userId: 'user-1', conversationId: 'conversation-1' }
    );
    expect(messagesResult).toMatchObject({
      ok: true,
      value: [
        { id: 'message-1', role: 'user' },
        { id: 'message-2', role: 'user', content: 'Thanks' },
        { id: 'message-3', role: 'assistant', streamStatus: 'failed' },
      ],
    });
    if (!messagesResult.ok) {
      throw new Error('Expected message list to succeed');
    }
    expect(messagesResult.value[0]?.content).toContain('cold conditions');
    const conversationResult = await getConversation(
      { conversationRepository },
      { userId: 'user-1', conversationId: 'conversation-1' }
    );
    expect(conversationResult).toMatchObject({
      ok: true,
      value: {
        lastMessageAt: '2026-06-14T12:04:00.000Z',
        lastMessagePreview: 'I could not complete this answer. Please try again.',
        lastMessageRole: 'assistant',
        lastAssistantStreamStatus: 'failed',
        messageCount: 3,
      },
    });
    if (!conversationResult.ok) {
      throw new Error('Expected conversation to exist');
    }
    expect(conversationResult.value.title).toHaveLength(120);
    expect(conversationResult.value.title).toBe(
      'What should I change in cold conditions? Please include fixture detail if the notes mention it, but avoid guessing. x...'
    );
    await expect(
      getConversation(
        { conversationRepository },
        { userId: 'user-1', conversationId: 'conversation-1' }
      )
    ).resolves.toEqual(conversationResult);
    expect(firstMessage).toMatchObject({
      ok: true,
      value: {
        id: 'message-1',
        userId: 'user-1',
        conversationId: 'conversation-1',
        role: 'user',
        citations: [],
        missingInformation: [],
      },
    });
    expect(secondMessage).toMatchObject({ ok: true, value: { id: 'message-2' } });
    expect(failedAssistantMessage).toMatchObject({
      ok: true,
      value: { id: 'message-3', streamStatus: 'failed' },
    });
  });

  it('returns validation and repository errors without hiding them', async () => {
    const conversationRepository = new MemoryConversationRepository();
    const messageRepository = new MemoryConversationMessageRepository();

    await expect(
      persistUserMessage(
        {
          conversationRepository,
          messageRepository,
          messageWriteRepository: messageWriter(conversationRepository, messageRepository),
          clock,
          generateId: ids(['message-1']),
        },
        { userId: 'user-1', conversationId: 'missing', content: '   ' }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'message must not be empty' },
    });
    await expect(
      listConversationMessages(
        { conversationRepository, messageRepository },
        { userId: 'user-1', conversationId: 'missing' }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation missing not found' },
    });
    await expect(
      getConversation(
        { conversationRepository: new FailingConversationRepository() },
        { userId: 'user-1', conversationId: 'conversation-1' }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'get failed' },
    });
  });

  it('returns append failures before persistence and refuses deleted conversations', async () => {
    const conversationRepository = new MemoryConversationRepository();
    const messageRepository = new MemoryConversationMessageRepository();
    await createConversation(
      { conversationRepository, clock, generateId: ids(['conversation-1']) },
      { userId: 'user-1' }
    );

    await expect(
      persistUserMessage(
        {
          conversationRepository,
          messageRepository,
          messageWriteRepository: new FailingMessageWriteRepository(),
          clock,
          generateId: ids(['message-1']),
        },
        { userId: 'user-1', conversationId: 'conversation-1', content: 'Hello' }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'message create failed' },
    });

    await expect(
      persistAssistantMessage(
        {
          conversationRepository,
          messageRepository,
          messageWriteRepository: new FailingMessageWriteRepository(),
          clock,
          generateId: ids([]),
        },
        {
          id: 'assistant-message-1',
          userId: 'user-1',
          conversationId: 'conversation-1',
          role: 'assistant',
          content: 'Answer',
          createdAt: '2026-06-14T12:00:00.000Z',
          citations: [],
          missingInformation: [],
        }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'message create failed' },
    });

    await expect(
      messageRepository.listByConversation({
        userId: 'user-1',
        conversationId: 'conversation-1',
      })
    ).resolves.toEqual({ ok: true, value: [] });

    const missingConversationRepository = new MemoryConversationRepository();
    const missingMessageRepository = new MemoryConversationMessageRepository();
    await expect(
      persistAssistantMessage(
        {
          conversationRepository: missingConversationRepository,
          messageRepository: missingMessageRepository,
          messageWriteRepository: messageWriter(
            missingConversationRepository,
            missingMessageRepository
          ),
          clock,
          generateId: ids([]),
        },
        {
          id: 'assistant-message-1',
          userId: 'user-1',
          conversationId: 'missing',
          role: 'assistant',
          content: 'Answer',
          createdAt: '2026-06-14T12:00:00.000Z',
          citations: [],
          missingInformation: [],
        }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation missing not found' },
    });

    const deletedConversationRepository = new MemoryConversationRepository();
    const deletedMessageRepository = new MemoryConversationMessageRepository();
    await createConversation(
      {
        conversationRepository: deletedConversationRepository,
        clock,
        generateId: ids(['conversation-1']),
      },
      { userId: 'user-1' }
    );
    await deleteConversation(
      { conversationRepository: deletedConversationRepository, clock },
      { userId: 'user-1', conversationId: 'conversation-1' }
    );
    await expect(
      persistUserMessage(
        {
          conversationRepository: deletedConversationRepository,
          messageRepository: deletedMessageRepository,
          messageWriteRepository: messageWriter(
            deletedConversationRepository,
            deletedMessageRepository
          ),
          clock,
          generateId: ids(['message-1']),
        },
        { userId: 'user-1', conversationId: 'conversation-1', content: 'Hello' }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation conversation-1 not found' },
    });
    await expect(
      deletedMessageRepository.listByConversation({
        userId: 'user-1',
        conversationId: 'conversation-1',
      })
    ).resolves.toEqual({ ok: true, value: [] });
    await expect(
      getConversation(
        { conversationRepository: deletedConversationRepository },
        { userId: 'user-1', conversationId: 'conversation-1' }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation conversation-1 not found' },
    });

    await expect(
      deleteConversation(
        { conversationRepository: new FailingConversationRepository(), clock },
        { userId: 'user-1', conversationId: 'conversation-1' }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'get failed' },
    });

    const deleteUpdateFailingRepository = new MemoryConversationRepository();
    await createConversation(
      {
        conversationRepository: deleteUpdateFailingRepository,
        clock,
        generateId: ids(['conversation-1']),
      },
      { userId: 'user-1' }
    );
    deleteUpdateFailingRepository.update = () =>
      Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'delete update failed' }));
    await expect(
      deleteConversation(
        { conversationRepository: deleteUpdateFailingRepository, clock },
        { userId: 'user-1', conversationId: 'conversation-1' }
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'delete update failed' },
    });
  });

  it('keeps memory repositories workspace-scoped, conflict-aware, and cloned', async () => {
    const conversationRepository = new MemoryConversationRepository();
    const created = await createConversation(
      { conversationRepository, clock, generateId: ids(['conversation-1']) },
      { userId: 'user-1' }
    );
    if (!created.ok) {
      throw new Error('Expected conversation creation to succeed');
    }

    await expect(conversationRepository.create(created.value)).resolves.toEqual({
      ok: false,
      error: { code: 'CONFLICT', message: 'Conversation conversation-1 already exists' },
    });
    await expect(
      conversationRepository.getById({
        userId: 'other-workspace',
        conversationId: 'conversation-1',
      })
    ).resolves.toEqual({ ok: true, value: null });
    await expect(
      conversationRepository.update({ ...created.value, userId: 'other-workspace' })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation conversation-1 not found' },
    });

    const messageRepository = new MemoryConversationMessageRepository();
    const assistantMessage: ConversationMessage = {
      id: 'assistant-message-1',
      userId: 'user-1',
      conversationId: 'conversation-1',
      role: 'assistant',
      content: 'Answer',
      createdAt: '2026-06-14T12:00:00.000Z',
      citations: [{ sourceId: 'knowledge-page:public-1', usedFor: 'test' }],
      missingInformation: ['No weather data.'],
      retrieval: {
        query: 'method feeder',
        startedAt: '2026-06-14T12:00:00.000Z',
        completedAt: '2026-06-14T12:00:00.000Z',
        sources: [
          {
            sourceId: 'knowledge-service',
            label: 'Knowledge Base',
            status: 'success',
            itemCount: 1,
            diagnostics: { searched: 1 },
          },
        ],
        evidence: [
          {
            id: 'knowledge-page:public-1',
            sourceId: 'knowledge-service',
            sourceType: 'knowledge_page',
            title: 'Feeder Notes',
            quote: 'Use a light feeder mix.',
            score: 0.9,
            metadata: { headingPath: ['Feeder Notes'] },
          },
        ],
      },
    };
    await messageRepository.create(assistantMessage);
    await expect(messageRepository.create(assistantMessage)).resolves.toEqual({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: 'Conversation message assistant-message-1 already exists',
      },
    });

    const listed = await messageRepository.listByConversation({
      userId: 'user-1',
      conversationId: 'conversation-1',
    });
    if (!listed.ok || listed.value[0] === undefined) {
      throw new Error('Expected cloned message list');
    }
    listed.value[0].citations[0] = { sourceId: 'mutated', usedFor: 'mutated' };
    listed.value[0].retrieval?.sources.splice(0, 1);

    await expect(
      messageRepository.listByConversation({
        userId: 'user-1',
        conversationId: 'conversation-1',
      })
    ).resolves.toMatchObject({
      ok: true,
      value: [
        {
          citations: [{ sourceId: 'knowledge-page:public-1', usedFor: 'test' }],
          retrieval: {
            sources: [expect.objectContaining({ sourceId: 'knowledge-service' })],
          },
        },
      ],
    });
  });
});
