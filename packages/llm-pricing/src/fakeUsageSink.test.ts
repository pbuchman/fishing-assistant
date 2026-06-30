import { describe, expect, it } from 'vitest';

import { FakeUsageSink } from '@fa/llm-pricing';
import type { UsageSinkRecordParams } from '@fa/llm-pricing';

function embeddingRecord(overrides: Partial<UsageSinkRecordParams> = {}): UsageSinkRecordParams {
  return {
    id: 'fake-event',
    owner: { type: 'user', id: 'user-123' },
    provider: 'openrouter',
    model: 'qwen/qwen3-embedding-8b',
    operation: 'embedding',
    promptType: 'knowledge-document-sync-embedding',
    promptVersion: '1.0.0',
    inputTokens: 40,
    cost: { estimatedCostUsd: 0.00004, source: 'provider-reported' },
    ...overrides,
  };
}

describe('FakeUsageSink', () => {
  it('records built usage events for future provider tests', async () => {
    const sink = new FakeUsageSink();

    await sink.record(embeddingRecord());
    await sink.flush();

    expect(sink.events).toEqual([
      expect.objectContaining({
        id: 'fake-event',
        owner: { type: 'user', id: 'user-123' },
        source: {
          service: 'chat-service',
          component: 'test',
          operation: 'embedding',
          promptType: 'knowledge-document-sync-embedding',
        },
        request: {
          provider: 'openrouter',
          model: 'qwen/qwen3-embedding-8b',
          promptVersion: '1.0.0',
        },
        usage: { inputTokens: 40, outputTokens: 0, totalTokens: 40, estimated: false },
        cost: { estimatedCostUsd: 0.00004, source: 'provider-reported' },
      }),
    ]);
  });

  it('can clear recorded events between assertions', async () => {
    const sink = new FakeUsageSink({ service: 'knowledge-service', component: 'query-embedding' });

    await sink.record(embeddingRecord());
    sink.clear();

    expect(sink.events).toEqual([]);
  });
});
