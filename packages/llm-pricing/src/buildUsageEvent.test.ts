import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { buildUsageEvent } from '@fa/llm-pricing';
import type { BuildUsageEventParams } from '@fa/llm-pricing';

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(),
}));

const mockedRandomUUID = vi.mocked(randomUUID);

function params(overrides: Partial<BuildUsageEventParams> = {}): BuildUsageEventParams {
  return {
    id: 'event-1',
    owner: { type: 'user', id: 'user-123' },
    service: 'chat-service',
    component: 'rag-chat',
    provider: 'openrouter',
    model: 'google/gemini-3.5-flash',
    operation: 'chat.completion',
    promptType: 'fishing-answer',
    promptVersion: '1.0.0',
    inputTokens: 1000,
    outputTokens: 250,
    cost: { estimatedCostUsd: 0.0018, source: 'provider-reported' },
    ...overrides,
  };
}

describe('buildUsageEvent', () => {
  it('creates a user-owned usage event with generated id and required prompt metadata', () => {
    mockedRandomUUID.mockReturnValue('00000000-0000-4000-8000-000000000001');

    const event = buildUsageEvent({
      owner: { type: 'user', id: 'user-123' },
      service: 'chat-service',
      component: 'rag-chat',
      provider: 'openrouter',
      model: 'google/gemini-3.5-flash',
      operation: 'chat.completion',
      promptType: 'fishing-answer',
      promptVersion: '1.0.0',
      inputTokens: 1000,
      outputTokens: 250,
      cost: { estimatedCostUsd: 0.0018, source: 'provider-reported' },
    });

    expect(event).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
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
        outputTokens: 250,
        totalTokens: 1250,
        estimated: false,
      },
      cost: {
        estimatedCostUsd: 0.0018,
        source: 'provider-reported',
      },
      correlation: {},
    });
  });

  it('allows embedding callers to omit output tokens', () => {
    const event = buildUsageEvent({
      id: 'embedding-event',
      owner: { type: 'user', id: 'user-123' },
      service: 'knowledge-service',
      component: 'knowledge-embedding',
      provider: 'openrouter',
      model: 'qwen/qwen3-embedding-8b',
      operation: 'embedding',
      promptType: 'rag-query-embedding',
      promptVersion: '1.0.0',
      inputTokens: 2048,
      cost: { estimatedCostUsd: 0.00002, source: 'provider-reported' },
    });

    expect(event.usage.outputTokens).toBe(0);
    expect(event.usage.totalTokens).toBe(2048);
    expect(event.cost).toEqual({ estimatedCostUsd: 0.00002, source: 'provider-reported' });
  });

  it('creates no-charge error usage events for failed chat attempts', () => {
    const event = buildUsageEvent({
      id: 'failed-chat-event',
      owner: { type: 'user', id: 'user-123' },
      service: 'chat-service',
      component: 'rag-chat',
      provider: 'openrouter',
      model: 'google/gemini-3.5-flash',
      operation: 'chat.stream',
      promptType: 'fishing-answer',
      promptVersion: '2.2.0',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      tokenUsageEstimated: true,
      cost: { estimatedCostUsd: 0, source: 'provider-estimated' },
      correlation: {
        conversationId: 'conversation-1',
        messageId: 'failed-assistant-message-1',
      },
      error: {
        code: 'ANSWER_GENERATION_FAILED',
        message: 'Answer generation failed. Please try again.',
      },
    });

    expect(event).toMatchObject({
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimated: true,
      },
      cost: { estimatedCostUsd: 0, source: 'provider-estimated' },
      correlation: {
        conversationId: 'conversation-1',
        messageId: 'failed-assistant-message-1',
      },
      error: {
        code: 'ANSWER_GENERATION_FAILED',
        message: 'Answer generation failed. Please try again.',
      },
    });
  });

  it('preserves explicit ownership, prompt type, and correlation fields', () => {
    const event = buildUsageEvent(
      params({
        owner: { type: 'user', id: 'user-123' },
        promptType: 'answer-repair',
        promptVersion: '2.3.4',
        tokenUsageEstimated: true,
        correlation: {
          conversationId: 'conversation-1',
          messageId: 'message-1',
          knowledgePageId: 'page-1',
          chunkId: 'chunk-1',
          requestId: 'request-1',
        },
      })
    );

    expect(event).toMatchObject({
      owner: { type: 'user', id: 'user-123' },
      source: { promptType: 'answer-repair' },
      request: { promptVersion: '2.3.4' },
      usage: { estimated: true },
      correlation: {
        conversationId: 'conversation-1',
        messageId: 'message-1',
        knowledgePageId: 'page-1',
        chunkId: 'chunk-1',
        requestId: 'request-1',
      },
    });
  });

  it('throws before returning unsupported or negative token input', () => {
    expect(() =>
      buildUsageEvent({
        owner: { type: 'user', id: 'user-123' },
        service: 'chat-service',
        component: 'rag-chat',
        provider: 'openrouter',
        model: 'google/gemini-3.5-flash',
        operation: 'chat.stream',
        promptType: 'fishing-answer',
        promptVersion: '1.0.0',
        inputTokens: -1,
        outputTokens: 0,
        cost: { estimatedCostUsd: 0, source: 'provider-reported' },
      })
    ).toThrow('inputTokens must be a non-negative safe integer');

    expect(() =>
      buildUsageEvent(
        params({ operation: 'chat.stream', inputTokens: 1, outputTokens: 1, totalTokens: 3 })
      )
    ).toThrow('totalTokens must equal inputTokens + outputTokens');
  });

  it.each<[string, Partial<BuildUsageEventParams>, string]>([
    ['blank id', { id: ' ' }, 'id must be a non-empty string'],
    ['blank owner id', { owner: { type: 'user', id: '' } }, 'owner.id must be a non-empty string'],
    ['blank component', { component: '' }, 'component must be a non-empty string'],
    ['blank provider', { provider: '' }, 'provider must be a non-empty string'],
    ['blank model', { model: '' }, 'model must be a non-empty string'],
    ['blank prompt type', { promptType: '' }, 'promptType must be a non-empty string'],
    [
      'invalid owner type',
      { owner: { type: 'admin' as never, id: 'user-123' } },
      'owner.type must be user',
    ],
    ['invalid service', { service: 'web' as never }, 'service must be one of'],
    ['invalid operation', { operation: 'chat' as never }, 'operation must be one of'],
    [
      'blank correlation field',
      { correlation: { requestId: '' } },
      'correlation.requestId must be a non-empty string',
    ],
  ])('rejects %s', (_name, overrides, message) => {
    expect(() => buildUsageEvent(params(overrides))).toThrow(message);
  });

  it('rejects missing owner id, prompt type, and prompt version via omitted fields', () => {
    const missingOwnerId = params();
    delete missingOwnerId.owner;
    expect(() => buildUsageEvent(missingOwnerId)).toThrow('owner is required');

    const missingPromptType = params();
    delete missingPromptType.promptType;
    expect(() => buildUsageEvent(missingPromptType)).toThrow(
      'promptType must be a non-empty string'
    );

    const missingPromptVersion = params();
    delete missingPromptVersion.promptVersion;
    expect(() => buildUsageEvent(missingPromptVersion)).toThrow(
      'promptVersion must be a non-empty string'
    );
  });

  it('rejects missing or invalid usage cost', () => {
    const missingCost = params();
    delete missingCost.cost;
    expect(() => buildUsageEvent(missingCost)).toThrow('cost is required');
    expect(() =>
      buildUsageEvent(params({ cost: { estimatedCostUsd: -1, source: 'provider-reported' } }))
    ).toThrow('cost.estimatedCostUsd must be a non-negative finite number');
    expect(() =>
      buildUsageEvent(
        params({ cost: { estimatedCostUsd: 1, source: 'catalog' as 'provider-reported' } })
      )
    ).toThrow('cost.source must be provider-reported or provider-estimated');
  });

  it('rejects system, workspace, and anonymous ownership', () => {
    expect(() =>
      buildUsageEvent(params({ owner: { type: 'system' as never, id: 'system' } }))
    ).toThrow('owner.type must be user');
    expect(() =>
      buildUsageEvent(params({ owner: { type: 'workspace' as never, id: 'workspace-1' } }))
    ).toThrow('owner.type must be user');
    expect(() => buildUsageEvent(params({ owner: { type: 'user', id: 'anonymous' } }))).toThrow(
      'owner.id must be a real user id'
    );
  });

  it.each([
    'anonymous-workspace-1',
    'angler@example.com',
    '+15551234567',
    'auth0|abc123',
    'workspace-123',
  ])('rejects non-FA user owner id %s', (ownerId) => {
    expect(() => buildUsageEvent(params({ owner: { type: 'user', id: ownerId } }))).toThrow(
      'owner.id must be a real user id'
    );
  });
});
