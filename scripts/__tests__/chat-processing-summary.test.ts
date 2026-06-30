import { describe, expect, it } from 'vitest';

import { summarizeConversationProcessing } from '../chat-processing-summary.mjs';

describe('chat processing summary helper', () => {
  it('reports per-pass timing without source titles or upstream URLs', () => {
    const summary = summarizeConversationProcessing({
      environment: 'local',
      directory: '/repo/fa',
      sha: 'abc123',
      activeModel: {
        modelId: 'google/gemma-4-31b-it',
        activeBecause: 'settings',
      },
      streamTimeoutMs: 120_000,
      edgeProxyReadTimeoutMs: null,
      conversation: {
        id: 'conversation-1',
        messageCount: 2,
      },
      messages: [
        {
          role: 'user',
          createdAt: '2026-06-22T05:06:17.244Z',
        },
        {
          role: 'assistant',
          createdAt: '2026-06-22T05:08:17.247Z',
          streamStatus: 'failed',
          errorMessage: 'Chat stream timed out',
          modelId: 'google/gemma-4-31b-it',
          citations: [],
          missingInformation: [],
          promptVersions: {
            answer: { name: 'fishing-answer', version: '2.2.0' },
            repair: { name: 'answer-repair', version: '1.1.0' },
          },
          retrieval: {
            startedAt: '2026-06-22T05:06:17.433Z',
            completedAt: '2026-06-22T05:06:45.709Z',
            sources: [
              {
                itemCount: 16,
                diagnostics: { expandedItemCount: 0 },
              },
            ],
            evidence: [
              {
                title: 'Sensitive source title',
                url: 'https://blocked.example.test/source',
              },
            ],
          },
        },
      ],
      usageEvents: [
        {
          createdAt: '2026-06-22T05:06:17.863Z',
          source: {
            component: 'query-embedding',
            operation: 'embedding',
            promptType: 'rag-query-embedding',
          },
          request: { model: 'qwen/qwen3-embedding-8b' },
          usage: { inputTokens: 44, outputTokens: 0, totalTokens: 44 },
        },
        {
          createdAt: '2026-06-22T05:07:52.856Z',
          source: {
            component: 'rag-chat',
            operation: 'chat.stream',
            promptType: 'fishing-answer',
          },
          request: { model: 'google/gemma-4-31b-it' },
          usage: { inputTokens: 7816, outputTokens: 1955, totalTokens: 9771 },
        },
      ],
    });

    expect(summary).toEqual({
      environment: 'local',
      directory: '/repo/fa',
      sha: 'abc123',
      conversationId: 'conversation-1',
      activeModel: {
        modelId: 'google/gemma-4-31b-it',
        activeBecause: 'settings',
      },
      streamTimeoutMs: 120_000,
      edgeProxyReadTimeoutMs: null,
      passes: {
        retrieval: {
          durationMs: 28_276,
          itemCount: 16,
          expandedItemCount: 0,
        },
        answerStream: {
          model: 'google/gemma-4-31b-it',
          inputTokens: 7816,
          outputTokens: 1955,
          totalTokens: 9771,
        },
        grounding: { status: 'skipped' },
        repair: { status: 'attempted' },
        persistence: {
          status: 'failed',
          errorMessage: 'Chat stream timed out',
          citationsCount: 0,
          missingInformationCount: 0,
        },
      },
    });
    expect(JSON.stringify(summary)).not.toContain('Sensitive source title');
    expect(JSON.stringify(summary)).not.toContain('blocked.example.test');
  });

  it('redacts URLs from persisted error messages', () => {
    const summary = summarizeConversationProcessing({
      conversationId: 'conversation-2',
      messages: [
        {
          role: 'assistant',
          streamStatus: 'failed',
          errorMessage:
            'Provider request failed for https://blocked.example.test/upstream/source?id=123',
        },
      ],
      usageEvents: [],
    });

    expect(summary.passes.persistence.errorMessage).toBe(
      'Provider request failed for [redacted-url]'
    );
    expect(JSON.stringify(summary)).not.toContain('blocked.example.test');
  });
});
