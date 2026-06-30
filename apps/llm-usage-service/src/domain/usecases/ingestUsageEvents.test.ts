import { describe, expect, it } from 'vitest';

import { err, fixedClock, FaError } from '@fa/common-core';

import { ingestUsageEvents } from './ingestUsageEvents.js';
import type { UsageEventInput } from '../models/usageEvent.js';
import {
  FakeUsageAggregateRepository,
  FakeUsageEventRepository,
  silentLogger,
} from '../../__tests__/fakes/usageRepositories.js';

function input(overrides: Partial<UsageEventInput> = {}): UsageEventInput {
  const base: UsageEventInput = {
    id: 'event-1',
    owner: { type: 'user', id: 'user-123' },
    source: {
      service: 'chat-service',
      component: 'rag-chat',
      operation: 'chat.completion',
      promptType: 'fishing-answer',
    },
    request: {
      provider: 'openrouter',
      model: 'google/gemini-3.5-flash',
      promptVersion: '1.0.0',
    },
    usage: {
      inputTokens: 1000,
      outputTokens: 100,
      totalTokens: 1100,
      estimated: false,
    },
    cost: { estimatedCostUsd: 0.00123, source: 'provider-reported' },
    correlation: {},
  };

  return { ...base, ...overrides };
}

function deps() {
  const usageEventRepository = new FakeUsageEventRepository();
  const usageAggregateRepository = new FakeUsageAggregateRepository();

  return {
    usageEventRepository,
    usageAggregateRepository,
    ingestDeps: {
      usageEventRepository,
      usageAggregateRepository,
      clock: fixedClock(new Date('2026-06-14T12:00:00.000Z')),
      logger: silentLogger,
    },
  };
}

describe('ingestUsageEvents', () => {
  it('stores valid events with provider-supplied cost and increments the daily aggregate', async () => {
    const { ingestDeps, usageEventRepository, usageAggregateRepository } = deps();

    await expect(ingestUsageEvents(ingestDeps, [input()])).resolves.toEqual({
      accepted: 1,
      duplicates: 0,
      rejected: [],
    });

    expect(usageEventRepository.events).toEqual([
      expect.objectContaining({
        id: 'event-1',
        cost: { estimatedCostUsd: 0.00123, source: 'provider-reported' },
        createdAt: '2026-06-14T12:00:00.000Z',
      }),
    ]);
    expect(usageAggregateRepository.increments).toHaveLength(1);
  });

  it('counts duplicate events and does not increment aggregates', async () => {
    const { ingestDeps, usageEventRepository, usageAggregateRepository } = deps();
    usageEventRepository.duplicateIds.add('event-1');

    await expect(ingestUsageEvents(ingestDeps, [input()])).resolves.toEqual({
      accepted: 0,
      duplicates: 1,
      rejected: [],
    });

    expect(usageAggregateRepository.increments).toHaveLength(0);
  });

  it('does not require pricing rows to ingest events for new models', async () => {
    const { ingestDeps, usageEventRepository } = deps();

    await expect(
      ingestUsageEvents(ingestDeps, [
        input({ id: 'new-model', request: { ...input().request, model: 'missing-model' } }),
        input({ id: 'valid' }),
      ])
    ).resolves.toEqual({
      accepted: 2,
      duplicates: 0,
      rejected: [],
    });

    expect(usageEventRepository.events.map((event) => event.id)).toEqual(['new-model', 'valid']);
  });

  it('rejects invalid token totals with zero-based index and event id', async () => {
    const { ingestDeps, usageEventRepository } = deps();

    await expect(
      ingestUsageEvents(ingestDeps, [
        input({ id: 'bad-total', usage: { ...input().usage, totalTokens: 999 } }),
      ])
    ).resolves.toEqual({
      accepted: 0,
      duplicates: 0,
      rejected: [
        {
          index: 0,
          id: 'bad-total',
          code: 'INVALID_USAGE_EVENT',
          message: 'totalTokens must equal inputTokens + outputTokens',
        },
      ],
    });

    expect(usageEventRepository.events).toHaveLength(0);
  });

  it('rejects aggregate failures without leaving raw duplicate-blocking events', async () => {
    const { ingestDeps, usageEventRepository, usageAggregateRepository } = deps();
    usageAggregateRepository.increment = () =>
      Promise.resolve(err(new FaError('INTERNAL_ERROR', 'aggregate failed')));

    await expect(ingestUsageEvents(ingestDeps, [input()])).resolves.toEqual({
      accepted: 0,
      duplicates: 0,
      rejected: [
        {
          index: 0,
          id: 'event-1',
          code: 'INTERNAL_ERROR',
          message: 'aggregate failed',
        },
      ],
    });

    expect(usageEventRepository.events).toHaveLength(0);
  });

  it.each([
    ['missing id', { ...input(), id: undefined }, 'INVALID_EVENT_ID', null],
    ['empty id', { ...input(), id: ' ' }, 'INVALID_EVENT_ID', null],
    [
      'missing owner id',
      { ...input(), id: 'bad-owner', owner: { type: 'user' } },
      'INVALID_OWNER',
      'bad-owner',
    ],
    [
      'empty owner id',
      { ...input(), id: 'bad-owner', owner: { type: 'user', id: ' ' } },
      'INVALID_OWNER',
      'bad-owner',
    ],
    [
      'retired ownerType',
      { ...input(), id: 'retired-owner', ownerType: 'user' },
      'RETIRED_USAGE_OWNER_FIELDS',
      'retired-owner',
    ],
    [
      'retired ownerId',
      { ...input(), id: 'retired-owner', ownerId: 'user-123' },
      'RETIRED_USAGE_OWNER_FIELDS',
      'retired-owner',
    ],
    [
      'workspace owner',
      { ...input(), id: 'workspace-owner', owner: { type: 'workspace', id: 'workspace-1' } },
      'INVALID_OWNER',
      'workspace-owner',
    ],
    [
      'system owner',
      { ...input(), id: 'system-owner', owner: { type: 'system', id: 'system' } },
      'INVALID_OWNER',
      'system-owner',
    ],
    [
      'anonymous owner',
      { ...input(), id: 'anonymous-owner', owner: { type: 'user', id: 'anonymous' } },
      'INVALID_OWNER',
      'anonymous-owner',
    ],
    [
      'missing prompt type',
      { ...input(), id: 'missing-prompt', source: { ...input().source, promptType: undefined } },
      'INVALID_PROMPT_TYPE',
      'missing-prompt',
    ],
    [
      'unknown prompt type',
      { ...input(), id: 'bad-prompt', source: { ...input().source, promptType: 'ad-hoc' } },
      'INVALID_PROMPT_TYPE',
      'bad-prompt',
    ],
    [
      'missing prompt version',
      {
        ...input(),
        id: 'missing-version',
        request: { ...input().request, promptVersion: undefined },
      },
      'INVALID_PROMPT_VERSION',
      'missing-version',
    ],
    [
      'retired correlation workspace',
      { ...input(), id: 'retired-correlation', correlation: { workspaceId: 'workspace-1' } },
      'RETIRED_USAGE_OWNER_FIELDS',
      'retired-correlation',
    ],
  ])('rejects %s', async (_name, event, code, id) => {
    const { ingestDeps, usageEventRepository } = deps();

    await expect(ingestUsageEvents(ingestDeps, [event as UsageEventInput])).resolves.toMatchObject({
      accepted: 0,
      duplicates: 0,
      rejected: [{ index: 0, id, code }],
    });

    expect(usageEventRepository.events).toHaveLength(0);
  });
});
