import { describe, expect, it } from 'vitest';

import { listUsageEvents } from './listUsageEvents.js';
import type { LlmUsageEvent } from '../models/usageEvent.js';
import { FakeUsageEventRepository } from '../../__tests__/fakes/usageRepositories.js';

function event(overrides: Partial<LlmUsageEvent>): LlmUsageEvent {
  const base: LlmUsageEvent = {
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
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimated: false },
    cost: { estimatedCostUsd: 0.00006 },
    createdAt: '2026-06-14T12:00:00.000Z',
    correlation: {},
  };
  return { ...base, ...overrides };
}

describe('listUsageEvents', () => {
  it('applies owner, time range, service, operation, and limit filters', async () => {
    const repo = new FakeUsageEventRepository([
      event({ id: 'wrong-owner', owner: { type: 'user', id: 'other' } }),
      event({
        id: 'wrong-service',
        source: { ...event({}).source, service: 'knowledge-service', operation: 'embedding' },
      }),
      event({ id: 'old', createdAt: '2026-06-01T00:00:00.000Z' }),
      event({
        id: 'first',
        source: { ...event({}).source, operation: 'chat.stream' },
        createdAt: '2026-06-14T13:00:00.000Z',
      }),
      event({
        id: 'second',
        source: { ...event({}).source, operation: 'chat.stream' },
        createdAt: '2026-06-14T12:00:00.000Z',
      }),
    ]);

    await expect(
      listUsageEvents(
        { usageEventRepository: repo },
        {
          from: '2026-06-14T00:00:00.000Z',
          to: '2026-06-15T00:00:00.000Z',
          ownerId: 'user-123',
          service: 'chat-service',
          operation: 'chat.stream',
          limit: 1,
        }
      )
    ).resolves.toEqual([expect.objectContaining({ id: 'first' })]);
  });
});
