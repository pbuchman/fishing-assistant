import { describe, expect, it } from 'vitest';

import { err, ok, type Clock } from '@fa/common-core';
import type { AnswerGapCoverageProbe } from '@fa/http-contracts';

import type { RetrievalTracePerformance } from '../models/chat.js';
import { aggregateRagEvidence, type RagEvidence, type RagSource } from './rag.js';
import {
  createKnowledgeServiceRagSource,
  createRagSources,
  type FetchLike,
} from '../../infra/http/knowledgeServiceRagSource.js';

const clock: Clock = {
  now: () => new Date('2026-06-14T12:00:00.000Z'),
};

function evidence(overrides: Partial<RagEvidence> = {}): RagEvidence {
  return {
    id: 'knowledge-page:public-1',
    sourceId: 'knowledge-service',
    sourceType: 'knowledge_page',
    title: 'Feeder Notes',
    quote: 'Use a light feeder mix in cold water.',
    content: 'Use a light feeder mix in cold water.',
    score: 0.9,
    metadata: {
      headingPath: ['Feeder Notes'],
    },
    ...overrides,
  };
}

function authorization(userId = 'user-1') {
  return {
    userId,
    role: 'user' as const,
    status: 'approved' as const,
    effectiveLevel: 6 as const,
  };
}

function coverageProbe(overrides: Partial<AnswerGapCoverageProbe> = {}): AnswerGapCoverageProbe {
  return {
    classification: 'no_candidate_seen',
    minRequiredLevel: null,
    candidateCountBucket: '0',
    probeVersion: '1.0.0',
    ...overrides,
  };
}

function source(input: {
  id: string;
  label?: string;
  items?: RagEvidence[] | undefined;
  fail?: boolean | undefined;
  coverageProbe?: AnswerGapCoverageProbe | undefined;
  diagnostics?: Record<string, unknown> | undefined;
  performance?: RetrievalTracePerformance | undefined;
}): RagSource {
  return {
    id: input.id,
    label: input.label ?? input.id,
    retrieve: () =>
      Promise.resolve(
        input.fail === true
          ? err({ code: 'DOWNSTREAM_ERROR', message: `${input.id} unavailable` })
          : ok({
              sourceId: input.id,
              items: input.items ?? [],
              ...(input.coverageProbe === undefined ? {} : { coverageProbe: input.coverageProbe }),
              diagnostics: input.diagnostics ?? { searched: input.items?.length ?? 0 },
              ...(input.performance === undefined ? {} : { performance: input.performance }),
            })
      ),
  };
}

function throwingSource(input: { id: string; message?: string | undefined }): RagSource {
  return {
    id: input.id,
    label: input.id,
    retrieve: () => Promise.reject(new Error(input.message ?? `${input.id} failed`)),
  };
}

describe('RAG aggregation', () => {
  it('calls every source, dedupes ranked evidence, caps per source, and records trace', async () => {
    const manyItems = Array.from({ length: 14 }, (_value, index) =>
      evidence({
        id: `knowledge-page:${String(index)}`,
        score: 1 - index / 100,
        metadata: {
          documentId: 'doc-1',
          chunkId: `chunk-${String(index)}`,
          headingPath: ['Feeder Notes'],
        },
      })
    );
    const result = await aggregateRagEvidence(
      {
        sources: [source({ id: 'knowledge-service', items: manyItems }), source({ id: 'future' })],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'cold water feeder mix',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }
    expect(result.value.evidence.map((item) => item.id)).toEqual(
      Array.from({ length: 12 }, (_value, index) => `knowledge-page:${String(index)}`)
    );
    expect(result.value.trace).toMatchObject({
      query: 'cold water feeder mix',
      startedAt: '2026-06-14T12:00:00.000Z',
      completedAt: '2026-06-14T12:00:00.000Z',
      sources: [
        expect.objectContaining({
          sourceId: 'knowledge-service',
          status: 'success',
          itemCount: 14,
        }),
        expect.objectContaining({ sourceId: 'future', status: 'success', itemCount: 0 }),
      ],
    });
    expect(result.value.evidence[0]).toMatchObject({
      title: 'Feeder Notes',
      metadata: { headingPath: ['Feeder Notes'], documentId: 'doc-1', chunkId: 'chunk-0' },
    });
    expect(result.value.trace.evidence[0]).toMatchObject({
      title: 'Feeder Notes',
      quote: 'Use a light feeder mix in cold water.',
      metadata: {},
    });
    expect(result.value.trace.evidence[0]?.metadata).not.toHaveProperty('documentId');
    expect(result.value.trace.evidence[0]?.metadata).not.toHaveProperty('chunkId');
  });

  it('preserves source retrieval order when capping a single source', async () => {
    const items = [
      evidence({
        id: 'knowledge-page:classic-feeder',
        title: 'Synthetic Classic Fixture',
        quote: 'Place component A in sequence, then add component B and component C.',
        content: 'Place component A in sequence, then add component B and component C.',
        score: 28,
      }),
      ...Array.from({ length: 20 }, (_value, index) =>
        evidence({
          id: `knowledge-page:method-feeder-${String(index)}`,
          title: 'Synthetic Method Fixture',
          quote: 'Synthetic method fixture keeps related elements close together.',
          content: 'Synthetic method fixture keeps related elements close together.',
          score: 36 - index / 100,
        })
      ),
    ];

    const result = await aggregateRagEvidence(
      {
        sources: [source({ id: 'knowledge-service', items })],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'classic feeder versus method feeder',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }
    expect(result.value.evidence).toHaveLength(16);
    expect(result.value.evidence[0]?.id).toBe('knowledge-page:classic-feeder');
    expect(result.value.evidence.map((item) => item.id)).toContain(
      'knowledge-page:method-feeder-0'
    );
  });

  it('keeps raw source identifiers out of the public retrieval trace', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:restricted-coupon',
                title: 'Restricted Source Title',
                quote:
                  'Restricted Source Title / Hidden heading / Image reference is sample-hidden.png and https://blocked.example.invalid/source.',
                url: 'https://blocked.example.invalid/source',
                metadata: {
                  headingPath: ['Restricted Source Title', 'Hidden heading'],
                  path: ['Knowledge Base', 'Restricted Source Title'],
                  sourceLabel: 'Hidden metadata label',
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'coupon code',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }
    expect(result.value.evidence[0]).toMatchObject({
      title: 'Restricted Source Title',
      url: 'https://blocked.example.invalid/source',
      metadata: {
        headingPath: ['Restricted Source Title', 'Hidden heading'],
        path: ['Knowledge Base', 'Restricted Source Title'],
        sourceLabel: 'Hidden metadata label',
      },
    });
    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    const publicEvidence = result.value.trace.evidence[0];
    expect(publicEvidence).toMatchObject({
      title: 'Restricted Source Title',
      metadata: {},
    });
    expect(publicEvidence?.quote).toContain('[image hidden]');
    expect(publicEvidence).not.toHaveProperty('url');
    expect(publicTracePayload).not.toContain('Hidden heading');
    expect(publicTracePayload).not.toContain('Hidden metadata label');
    expect(publicTracePayload).not.toContain('sample-hidden.png');
    expect(publicTracePayload).not.toContain('blocked.example.invalid');
  });

  it('redacts bare unsafe hostnames and raw metadata identifiers from public quotes', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:restricted-coupon',
                title: 'Restricted Source Title',
                quote:
                  'Restricted Source Title / Hidden heading / doc-1 / chunk-0 / blocked.example.invalid / sample-hidden.png',
                url: 'blocked.example.invalid',
                metadata: {
                  headingPath: ['Restricted Source Title', 'Hidden heading'],
                  path: ['Knowledge Base', 'Restricted Source Title'],
                  sourceLabel: 'Hidden metadata label',
                  documentId: 'doc-1',
                  chunkId: 'chunk-0',
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'coupon code',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    const publicEvidence = result.value.trace.evidence[0];
    expect(publicEvidence).toMatchObject({
      title: 'Restricted Source Title',
      metadata: {},
    });
    expect(publicEvidence?.quote).toContain('[image hidden]');
    expect(publicEvidence).not.toHaveProperty('url');
    expect(publicTracePayload).not.toContain('Hidden heading');
    expect(publicTracePayload).not.toContain('Hidden metadata label');
    expect(publicTracePayload).not.toContain('sample-hidden.png');
    expect(publicTracePayload).not.toContain('blocked.example.invalid');
    expect(publicTracePayload).not.toContain('doc-1');
    expect(publicTracePayload).not.toContain('chunk-0');
  });

  it('redacts non-image filenames from public quotes', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:filename-coupon',
                title: 'Restricted Source Title',
                quote:
                  'Restricted Source Title / report.pdf / notes.md / sample-hidden.png / Hidden heading',
                url: 'https://blocked.example.invalid/source',
                metadata: {
                  headingPath: ['Restricted Source Title', 'Hidden heading'],
                  path: ['Knowledge Base', 'Restricted Source Title'],
                  sourceLabel: 'Hidden metadata label',
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'coupon code',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    const publicEvidence = result.value.trace.evidence[0];
    expect(publicEvidence).toMatchObject({
      title: 'Restricted Source Title',
      metadata: {},
    });
    expect(publicEvidence?.quote).toContain('[image hidden]');
    expect(publicTracePayload).not.toContain('report.pdf');
    expect(publicTracePayload).not.toContain('notes.md');
    expect(publicTracePayload).not.toContain('sample-hidden.png');
  });

  it('redacts plain filename tokens in public quotes', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:filename-tokens',
                title: 'Restricted Source Title',
                quote: 'The source files are report.pdf and notes.md.',
                url: 'https://blocked.example.invalid/source',
                metadata: {
                  headingPath: ['Restricted Source Title', 'Hidden heading'],
                  path: ['Knowledge Base', 'Restricted Source Title'],
                  sourceLabel: 'Hidden metadata label',
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'coupon code',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    const publicEvidence = result.value.trace.evidence[0];
    expect(publicEvidence).toMatchObject({
      title: 'Restricted Source Title',
      metadata: {},
    });
    expect(publicTracePayload).not.toContain('report.pdf');
    expect(publicTracePayload).not.toContain('notes.md');
  });

  it('redacts bare hostnames from pathful unsafe source URLs in public quotes', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:restricted-hostname',
                title: 'Restricted Source Title',
                quote: 'The host blocked.example.invalid should not be visible.',
                url: 'https://blocked.example.invalid/source',
                metadata: {
                  headingPath: ['Restricted Source Title', 'Hidden heading'],
                  path: ['Knowledge Base', 'Restricted Source Title'],
                  sourceLabel: 'Hidden metadata label',
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'coupon code',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    expect(publicTracePayload).not.toContain('blocked.example.invalid');
  });

  it('redacts standalone unsafe hostnames and IPs from public quotes', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:unsafe-hosts',
                title: 'Restricted Source Title',
                quote:
                  'Unsafe hosts are localhost, 10.0.0.1, 192.168.0.2, blocked.example.invalid, and [::1]. Ordinary prose still says invalid rig, local bait shop, and internal pressure.',
                url: 'https://blocked.example.invalid/source',
                metadata: {
                  headingPath: ['Restricted Source Title', 'Hidden heading'],
                  path: ['Knowledge Base', 'Restricted Source Title'],
                  sourceLabel: 'Hidden metadata label',
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'coupon code',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    expect(publicTracePayload).not.toContain('localhost');
    expect(publicTracePayload).not.toContain('10.0.0.1');
    expect(publicTracePayload).not.toContain('192.168.0.2');
    expect(publicTracePayload).not.toContain('blocked.example.invalid');
    expect(publicTracePayload).not.toContain('[::1]');
    expect(publicTracePayload).toContain('invalid rig');
    expect(publicTracePayload).toContain('local bait shop');
    expect(publicTracePayload).toContain('internal pressure');
  });

  it('preserves public-looking hostnames that merely contain blocked suffixes', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:public-looking-hosts',
                title: 'Restricted Source Title',
                quote:
                  'Public-looking hosts like localhost.com and blocked.example.invalid.com should stay visible, even when blocked.example.invalid appears elsewhere.',
                url: 'https://blocked.example.invalid/source',
                metadata: {
                  headingPath: ['Restricted Source Title', 'Hidden heading'],
                  path: ['Knowledge Base', 'Restricted Source Title'],
                  sourceLabel: 'Hidden metadata label',
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'coupon code',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    expect(publicTracePayload).toContain('localhost.com');
    expect(publicTracePayload).toContain('blocked.example.invalid.com');
    expect(publicTracePayload).not.toContain('blocked.example.invalid appears');
  });

  it('redacts bare unsafe hostname labels without touching longer public-looking hostnames', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:bare-host-label',
                title: 'Restricted Source Title',
                quote:
                  'The bare host blocked.example.invalid should disappear, but blocked.example.invalid.com should stay visible.',
                url: 'blocked.example.invalid',
                metadata: {
                  headingPath: ['Restricted Source Title', 'Hidden heading'],
                  path: ['Knowledge Base', 'Restricted Source Title'],
                  sourceLabel: 'Hidden metadata label',
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'coupon code',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    expect(publicTracePayload).not.toContain('blocked.example.invalid should disappear');
    expect(publicTracePayload).toContain('blocked.example.invalid.com');
  });

  it('does not redact invalid inside a longer public-looking hostname', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:invalid-label',
                title: 'invalid',
                quote:
                  'The label invalid should disappear on its own, but blocked.example.invalid.com should stay visible.',
                url: 'blocked.example.invalid',
                metadata: {
                  headingPath: ['invalid'],
                  path: ['Knowledge Base', 'invalid'],
                  sourceLabel: 'invalid',
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'coupon code',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    expect(publicTracePayload).not.toContain('The label invalid should disappear');
    expect(publicTracePayload).toContain('blocked.example.invalid.com');
  });

  it('redacts filename-like .dev tokens without touching public-looking hostnames', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:dev-files',
                title: 'Restricted Source Title',
                quote:
                  'Secret artifacts secret.dev and category.dev should be hidden, while localhost.com and blocked.example.invalid.com stay visible.',
                url: 'blocked.example.invalid',
                metadata: {
                  headingPath: ['Restricted Source Title', 'Hidden heading'],
                  path: ['Knowledge Base', 'Restricted Source Title'],
                  sourceLabel: 'Hidden metadata label',
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'coupon code',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    expect(publicTracePayload).not.toContain('secret.dev');
    expect(publicTracePayload).not.toContain('category.dev');
    expect(publicTracePayload).toContain('localhost.com');
    expect(publicTracePayload).toContain('blocked.example.invalid.com');
  });

  it('redacts sentence-final unsafe host and filename tokens', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:sentence-final-tokens',
                title: 'Restricted Source Title',
                quote:
                  'Sentence-final unsafe tokens should disappear: localhost. 10.0.0.1. blocked.example.invalid. secret.dev.',
                url: 'blocked.example.invalid',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                  path: ['Knowledge Base', 'Restricted Source Title'],
                  sourceLabel: 'Hidden metadata label',
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'coupon code',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    expect(publicTracePayload).not.toContain('localhost.');
    expect(publicTracePayload).not.toContain('10.0.0.1.');
    expect(publicTracePayload).not.toContain('blocked.example.invalid.');
    expect(publicTracePayload).not.toContain('secret.dev.');
  });

  it('redacts compressed bracketed IPv6 literals in public quotes', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:ipv6',
                title: 'Restricted Source Title',
                quote: 'Brackets like [2001:db8::1] and [fe80::1] should not be visible.',
                url: 'https://blocked.example.invalid/source',
                metadata: {
                  headingPath: ['Restricted Source Title', 'Hidden heading'],
                  path: ['Knowledge Base', 'Restricted Source Title'],
                  sourceLabel: 'Hidden metadata label',
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'coupon code',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    expect(publicTracePayload).not.toContain('[2001:db8::1]');
    expect(publicTracePayload).not.toContain('[fe80::1]');
  });

  it('redacts bare compressed IPv6 literals in public quotes', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:bare-ipv6',
                title: 'Restricted Source Title',
                quote: 'Bare IPv6 literals like 2001:db8::1 and fe80::1 should not be visible.',
                url: 'https://blocked.example.invalid/source',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                  path: ['Knowledge Base', 'Restricted Source Title'],
                  sourceLabel: 'Hidden metadata label',
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'coupon code',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    expect(publicTracePayload).not.toContain('2001:db8::1');
    expect(publicTracePayload).not.toContain('fe80::1');
  });

  it('exposes only safe external public URLs in the public retrieval trace', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:external',
                title: 'Restricted Source Title',
                quote: 'A public guide about float basics.',
                url: 'https://example.com/fishing/float-basics',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                  path: ['Knowledge Base', 'Restricted Source Title'],
                  sourceLabel: 'Hidden metadata label',
                },
              }),
              evidence({
                id: 'knowledge-page:hash-route',
                title: 'Restricted Source Title',
                quote: 'A hash route should not be exposed.',
                url: 'https://example.com/app#/chat/c1',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:api-route',
                title: 'Restricted Source Title',
                quote: 'An API route should not be exposed.',
                url: 'https://example.com/api/users',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:local',
                title: 'Restricted Source Title',
                quote: 'A localhost URL should not be exposed.',
                url: 'https://localhost/fishing/float-basics',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:credentials',
                title: 'Restricted Source Title',
                quote: 'A credentialed URL should not be exposed.',
                url: 'https://user:pass@example.com/fishing',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:any-local',
                title: 'Restricted Source Title',
                quote: 'A 0.0.0.0 URL should not be exposed.',
                url: 'https://0.0.0.0/fishing/float-basics',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'float basics',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    expect(result.value.trace.evidence[0]).toMatchObject({
      title: 'Restricted Source Title',
      publicUrl: 'https://example.com/fishing/float-basics',
      metadata: {},
    });
    expect(result.value.trace.evidence[1]).toMatchObject({
      title: 'Restricted Source Title',
      metadata: {},
    });
    expect(result.value.trace.evidence[2]).toMatchObject({
      title: 'Restricted Source Title',
      metadata: {},
    });
    expect(result.value.trace.evidence[3]).toMatchObject({
      title: 'Restricted Source Title',
      metadata: {},
    });
    expect(result.value.trace.evidence[1]).not.toHaveProperty('publicUrl');
    expect(result.value.trace.evidence[2]).not.toHaveProperty('publicUrl');
    expect(result.value.trace.evidence[3]).not.toHaveProperty('publicUrl');
    expect(publicTracePayload).toContain('https://example.com/fishing/float-basics');
    expect(publicTracePayload).not.toContain('https://example.com/app#/chat/c1');
    expect(publicTracePayload).not.toContain('https://example.com/api/users');
    expect(publicTracePayload).not.toContain('https://localhost/fishing/float-basics');
    expect(publicTracePayload).not.toContain('https://user:pass@example.com/fishing');
    expect(publicTracePayload).not.toContain('https://0.0.0.0/fishing/float-basics');
    expect(publicTracePayload).not.toContain('Knowledge Base');
    expect(publicTracePayload).not.toContain('Hidden metadata label');
  });

  it('blocks non-empty hash fragments from emitting public URLs', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:hash-chat',
                title: 'Restricted Source Title',
                quote: 'A harmless quote for a hash route test.',
                url: 'https://example.com/fishing/float-basics#chat',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:hash-editor',
                title: 'Restricted Source Title',
                quote: 'A harmless quote for another hash route test.',
                url: 'https://example.com/fishing/float-basics#editor',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:allowed',
                title: 'Restricted Source Title',
                quote: 'A public guide about float basics.',
                url: 'https://example.com/fishing/float-basics',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'float basics',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const evidenceById = new Map(result.value.trace.evidence.map((item) => [item.id, item]));
    expect(evidenceById.get('knowledge-page:allowed')).toMatchObject({
      publicUrl: 'https://example.com/fishing/float-basics',
    });
    expect(evidenceById.get('knowledge-page:hash-chat')).not.toHaveProperty('publicUrl');
    expect(evidenceById.get('knowledge-page:hash-editor')).not.toHaveProperty('publicUrl');
  });

  it('blocks share-prefixed route segments from emitting public URLs', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:sharefoo',
                title: 'Restricted Source Title',
                quote: 'A share-prefixed route should not be exposed.',
                url: 'https://example.com/sharefoo',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:share-dash',
                title: 'Restricted Source Title',
                quote: 'A dashed share route should not be exposed.',
                url: 'https://example.com/share-abc',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:allowed',
                title: 'Restricted Source Title',
                quote: 'A public guide about float basics.',
                url: 'https://example.com/fishing/float-basics',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'float basics',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const evidenceById = new Map(result.value.trace.evidence.map((item) => [item.id, item]));
    expect(evidenceById.get('knowledge-page:allowed')).toMatchObject({
      publicUrl: 'https://example.com/fishing/float-basics',
    });
    expect(evidenceById.get('knowledge-page:sharefoo')).not.toHaveProperty('publicUrl');
    expect(evidenceById.get('knowledge-page:share-dash')).not.toHaveProperty('publicUrl');
  });

  it('blocks encoded internal routes, trailing-dot restricted hosts, and all IP literals from public URLs', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:allowed',
                title: 'Restricted Source Title',
                quote: 'A public guide about float basics.',
                url: 'https://example.com/fishing/float-basics',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:encoded-api',
                title: 'Restricted Source Title',
                quote: 'An encoded api path should not be exposed.',
                url: 'https://example.com/%61pi',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:encoded-admin',
                title: 'Restricted Source Title',
                quote: 'An encoded admin path should not be exposed.',
                url: 'https://example.com/%61dmin/settings',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:encoded-app',
                title: 'Restricted Source Title',
                quote: 'An encoded app path should not be exposed.',
                url: 'https://example.com/%61pp',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:encoded-share',
                title: 'Restricted Source Title',
                quote: 'An encoded share path should not be exposed.',
                url: 'https://example.com/%73hare/abc',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:bare-api',
                title: 'Restricted Source Title',
                quote: 'A bare api path should not be exposed.',
                url: 'https://example.com/api',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:trailing-localhost',
                title: 'Restricted Source Title',
                quote: 'A trailing-dot localhost should not be exposed.',
                url: 'https://localhost./fishing',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:trailing-local',
                title: 'Restricted Source Title',
                quote: 'A trailing-dot local host should not be exposed.',
                url: 'https://foo.local./fishing',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:ipv6-ip-literal',
                title: 'Restricted Source Title',
                quote: 'A public IPv6 literal should still be blocked for source cards.',
                url: 'https://[2001:db8::1]/fishing',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'float basics',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const evidenceById = new Map(result.value.trace.evidence.map((item) => [item.id, item]));
    expect(evidenceById.get('knowledge-page:allowed')).toMatchObject({
      title: 'Restricted Source Title',
      publicUrl: 'https://example.com/fishing/float-basics',
      metadata: {},
    });
    for (const id of [
      'knowledge-page:encoded-api',
      'knowledge-page:encoded-admin',
      'knowledge-page:encoded-app',
      'knowledge-page:encoded-share',
      'knowledge-page:bare-api',
      'knowledge-page:trailing-localhost',
      'knowledge-page:trailing-local',
      'knowledge-page:ipv6-ip-literal',
    ]) {
      expect(evidenceById.get(id)).toMatchObject({
        metadata: {},
      });
      expect(evidenceById.get(id)).not.toHaveProperty('publicUrl');
    }

    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    expect(publicTracePayload).toContain('https://example.com/fishing/float-basics');
    expect(publicTracePayload).not.toContain('https://example.com/%61pi');
    expect(publicTracePayload).not.toContain('https://example.com/%61dmin/settings');
    expect(publicTracePayload).not.toContain('https://example.com/%61pp');
    expect(publicTracePayload).not.toContain('https://example.com/%73hare/abc');
    expect(publicTracePayload).not.toContain('https://example.com/api');
    expect(publicTracePayload).not.toContain('https://localhost./fishing');
    expect(publicTracePayload).not.toContain('https://foo.local./fishing');
    expect(publicTracePayload).not.toContain('https://[2001:db8::1]/fishing');
  });

  it('blocks loopback aliases and double-encoded internal paths from public URLs', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:allowed',
                title: 'Restricted Source Title',
                quote: 'A public guide about float basics.',
                url: 'https://example.com/fishing/float-basics',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:loopback-alias',
                title: 'Restricted Source Title',
                quote: 'A localhost alias should not be exposed.',
                url: 'https://foo.localhost/fishing',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:double-encoded-api',
                title: 'Restricted Source Title',
                quote: 'A double-encoded api path should not be exposed.',
                url: 'https://example.com/%2561pi',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:double-encoded-admin',
                title: 'Restricted Source Title',
                quote: 'A double-encoded admin path should not be exposed.',
                url: 'https://example.com/%2561dmin/settings',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:double-encoded-app',
                title: 'Restricted Source Title',
                quote: 'A double-encoded app path should not be exposed.',
                url: 'https://example.com/%2561pp',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:double-encoded-share',
                title: 'Restricted Source Title',
                quote: 'A double-encoded share path should not be exposed.',
                url: 'https://example.com/%2573hare/abc',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'float basics',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const evidenceById = new Map(result.value.trace.evidence.map((item) => [item.id, item]));
    expect(evidenceById.get('knowledge-page:allowed')).toMatchObject({
      title: 'Restricted Source Title',
      publicUrl: 'https://example.com/fishing/float-basics',
      metadata: {},
    });
    for (const id of [
      'knowledge-page:loopback-alias',
      'knowledge-page:double-encoded-api',
      'knowledge-page:double-encoded-admin',
      'knowledge-page:double-encoded-app',
      'knowledge-page:double-encoded-share',
    ]) {
      expect(evidenceById.get(id)).toMatchObject({
        metadata: {},
      });
      expect(evidenceById.get(id)).not.toHaveProperty('publicUrl');
    }

    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    expect(publicTracePayload).toContain('https://example.com/fishing/float-basics');
    expect(publicTracePayload).not.toContain('https://foo.localhost/fishing');
    expect(publicTracePayload).not.toContain('https://example.com/%2561pi');
    expect(publicTracePayload).not.toContain('https://example.com/%2561dmin/settings');
    expect(publicTracePayload).not.toContain('https://example.com/%2561pp');
    expect(publicTracePayload).not.toContain('https://example.com/%2573hare/abc');
  });

  it('blocks encoded-slash internal route segments from public URLs', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({
                id: 'knowledge-page:allowed',
                title: 'Restricted Source Title',
                quote: 'A public guide about float basics.',
                url: 'https://example.com/fishing/float-basics',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:encoded-slash-api',
                title: 'Restricted Source Title',
                quote: 'An encoded slash api path should not be exposed.',
                url: 'https://example.com/%2Fapi',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:encoded-slash-app',
                title: 'Restricted Source Title',
                quote: 'An encoded slash app path should not be exposed.',
                url: 'https://example.com/%2Fapp',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:double-encoded-slash-api',
                title: 'Restricted Source Title',
                quote: 'A double-encoded slash api path should not be exposed.',
                url: 'https://example.com/%252Fapi',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:encoded-slash-share',
                title: 'Restricted Source Title',
                quote: 'An encoded slash share path should not be exposed.',
                url: 'https://example.com/foo/%2Fshare/abc',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
              evidence({
                id: 'knowledge-page:double-encoded-slash-share',
                title: 'Restricted Source Title',
                quote: 'A double-encoded slash share path should not be exposed.',
                url: 'https://example.com/foo/%252Fshare/abc',
                metadata: {
                  headingPath: ['Restricted Source Title'],
                },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'float basics',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected RAG aggregation to succeed');
    }

    const evidenceById = new Map(result.value.trace.evidence.map((item) => [item.id, item]));
    expect(evidenceById.get('knowledge-page:allowed')).toMatchObject({
      title: 'Restricted Source Title',
      publicUrl: 'https://example.com/fishing/float-basics',
      metadata: {},
    });
    for (const id of [
      'knowledge-page:encoded-slash-api',
      'knowledge-page:encoded-slash-app',
      'knowledge-page:double-encoded-slash-api',
      'knowledge-page:encoded-slash-share',
      'knowledge-page:double-encoded-slash-share',
    ]) {
      expect(evidenceById.get(id)).toMatchObject({
        metadata: {},
      });
      expect(evidenceById.get(id)).not.toHaveProperty('publicUrl');
    }

    const publicTracePayload = JSON.stringify(result.value.trace.evidence);
    expect(publicTracePayload).toContain('https://example.com/fishing/float-basics');
    expect(publicTracePayload).not.toContain('https://example.com/%2Fapi');
    expect(publicTracePayload).not.toContain('https://example.com/%2Fapp');
    expect(publicTracePayload).not.toContain('https://example.com/%252Fapi');
    expect(publicTracePayload).not.toContain('https://example.com/foo/%2Fshare/abc');
    expect(publicTracePayload).not.toContain('https://example.com/foo/%252Fshare/abc');
  });

  it('keeps source failures non-fatal when another source returns evidence', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({ id: 'future-source', fail: true }),
          source({ id: 'knowledge-service', items: [evidence()] }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'cold water feeder mix',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        evidence: [expect.objectContaining({ id: 'knowledge-page:public-1' })],
        trace: {
          sources: [
            expect.objectContaining({
              sourceId: 'future-source',
              status: 'failed',
              errorMessage: 'future-source unavailable',
            }),
            expect.objectContaining({ sourceId: 'knowledge-service', status: 'success' }),
          ],
        },
      },
    });
  });

  it('keeps thrown source failures non-fatal when another source returns evidence', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          throwingSource({ id: 'secondary-knowledge', message: 'secondary source timed out' }),
          source({ id: 'knowledge-service', items: [evidence()] }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'cold water feeder mix',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        evidence: [expect.objectContaining({ id: 'knowledge-page:public-1' })],
        trace: {
          sources: [
            expect.objectContaining({
              sourceId: 'secondary-knowledge',
              status: 'failed',
              errorMessage: 'secondary source timed out',
            }),
            expect.objectContaining({ sourceId: 'knowledge-service', status: 'success' }),
          ],
        },
      },
    });
  });

  it('returns a downstream error when every source fails', async () => {
    await expect(
      aggregateRagEvidence(
        { sources: [source({ id: 'knowledge-service', fail: true })], clock },
        {
          authorization: authorization('user-1'),
          query: 'cold water feeder mix',
          latestMessages: [],
          limits: { maxEvidenceItems: 16 },
        }
      )
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'DOWNSTREAM_ERROR',
        message: 'All RAG sources failed: knowledge-service unavailable',
      },
    });
  });

  it('returns a downstream error when every source throws', async () => {
    await expect(
      aggregateRagEvidence(
        { sources: [throwingSource({ id: 'knowledge-service', message: 'network down' })], clock },
        {
          authorization: authorization('user-1'),
          query: 'cold water feeder mix',
          latestMessages: [],
          limits: { maxEvidenceItems: 16 },
        }
      )
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'DOWNSTREAM_ERROR',
        message: 'All RAG sources failed: network down',
      },
    });
  });

  it('returns a downstream error when a source fails and successful sources return no evidence', async () => {
    await expect(
      aggregateRagEvidence(
        {
          sources: [source({ id: 'knowledge-service', fail: true }), source({ id: 'digests' })],
          clock,
        },
        {
          authorization: authorization('user-1'),
          query: 'cold water feeder mix',
          latestMessages: [],
          limits: { maxEvidenceItems: 16 },
        }
      )
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'DOWNSTREAM_ERROR',
        message: 'RAG sources failed and no evidence was retrieved: knowledge-service unavailable',
      },
    });
  });

  it('returns empty evidence and a retrieval trace when all sources succeed but return no evidence', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [source({ id: 'knowledge-service' }), source({ id: 'digests' })],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'cold water feeder mix',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result).toEqual({
      ok: true,
      value: {
        evidence: [],
        trace: {
          query: 'cold water feeder mix',
          startedAt: '2026-06-14T12:00:00.000Z',
          completedAt: '2026-06-14T12:00:00.000Z',
          sources: [
            {
              sourceId: 'knowledge-service',
              label: 'knowledge-service',
              status: 'success',
              itemCount: 0,
              diagnostics: { searched: 0 },
            },
            {
              sourceId: 'digests',
              label: 'digests',
              status: 'success',
              itemCount: 0,
              diagnostics: { searched: 0 },
            },
          ],
          evidence: [],
        },
      },
    });
  });

  it('dedupes repeated evidence and allows a single registered source to fill the prompt cap', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [
              evidence({ id: 'knowledge-page:duplicate', score: 0.3 }),
              evidence({ id: 'knowledge-page:duplicate', score: 0.9 }),
              ...Array.from({ length: 16 }, (_value, index) =>
                evidence({ id: `knowledge-page:single-${String(index)}`, score: 0.8 - index / 100 })
              ),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'cold water feeder mix',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected aggregation to succeed');
    }
    expect(result.value.evidence).toHaveLength(16);
    expect(result.value.evidence[0]?.id).toBe('knowledge-page:duplicate');
    expect(result.value.evidence[0]?.score).toBe(0.9);
    expect(
      result.value.evidence.filter((item) => item.id === 'knowledge-page:duplicate')
    ).toHaveLength(1);
  });

  it('dedupes evidence by source id and evidence id together', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [evidence({ id: 'same-id', sourceId: 'knowledge-service', score: 0.9 })],
          }),
          source({
            id: 'secondary-knowledge',
            items: [
              evidence({
                id: 'same-id',
                sourceId: 'secondary-knowledge',
                sourceType: 'knowledge_page',
                score: 0.8,
                metadata: { path: ['Secondary knowledge'] },
              }),
            ],
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'cold water feeder mix',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        evidence: [
          { id: 'same-id', sourceId: 'knowledge-service' },
          { id: 'same-id', sourceId: 'secondary-knowledge' },
        ],
      },
    });
  });

  it('returns the highest-precedence coverage probe without adding it to trace diagnostics', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [],
            coverageProbe: coverageProbe({ classification: 'accessible_candidate_seen' }),
          }),
          source({
            id: 'future-source',
            items: [],
            coverageProbe: coverageProbe({
              classification: 'higher_level_candidate_seen',
              minRequiredLevel: 8,
              candidateCountBucket: '1',
            }),
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'cold water feeder mix',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        coverageProbe: {
          classification: 'higher_level_candidate_seen',
          minRequiredLevel: 8,
          candidateCountBucket: '1',
          probeVersion: '1.0.0',
        },
      },
    });
    if (!result.ok) {
      throw new Error('Expected aggregation to succeed');
    }
    expect(result.value.trace.sources[0]?.diagnostics).not.toHaveProperty('coverageProbe');
    expect(result.value.trace.sources[1]?.diagnostics).not.toHaveProperty('coverageProbe');
  });
});

describe('Knowledge Service RAG source', () => {
  it('posts retrieval requests to the internal Knowledge Service route with internal auth', async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const fetchImpl: FetchLike = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ input: url, ...(init !== undefined ? { init } : {}) });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              items: [evidence()],
              coverageProbe: coverageProbe({
                classification: 'accessible_candidate_seen',
                candidateCountBucket: '1',
              }),
              diagnostics: { embeddingModel: 'qwen/qwen3-embedding-8b' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    };
    const ragSource = createKnowledgeServiceRagSource({
      baseUrl: 'http://knowledge-service.test///',
      internalAuthToken: 'internal-token',
      fetch: fetchImpl,
    });
    const abortController = new AbortController();

    const result = await ragSource.retrieve({
      authorization: authorization('user-123'),
      query: 'method feeder',
      conversationId: 'conversation-1',
      messageId: 'user-message-1',
      latestMessages: [{ role: 'assistant', content: 'Earlier answer', citations: [] }],
      now: new Date('2026-06-14T12:00:00.000Z'),
      limits: { maxEvidenceItems: 6 },
      signal: abortController.signal,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        sourceId: 'knowledge-service',
        items: [evidence()],
        coverageProbe: coverageProbe({
          classification: 'accessible_candidate_seen',
          candidateCountBucket: '1',
        }),
        diagnostics: { embeddingModel: 'qwen/qwen3-embedding-8b' },
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe('http://knowledge-service.test/internal/retrieve');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Internal-Auth': 'internal-token',
    });
    expect(calls[0]?.init?.signal).toBe(abortController.signal);
    const requestBody = calls[0]?.init?.body;
    if (typeof requestBody !== 'string') {
      throw new Error('Expected JSON request body');
    }
    expect(JSON.parse(requestBody)).toEqual({
      authorization: authorization('user-123'),
      query: 'method feeder',
      conversationContext: {
        latestMessages: [{ role: 'assistant', content: 'Earlier answer', citations: [] }],
      },
      usageCorrelation: {
        conversationId: 'conversation-1',
        messageId: 'user-message-1',
      },
      options: { topK: 6 },
    });
  });

  it('creates the static V1 registry with Knowledge Service as the only source', () => {
    expect(
      createRagSources({
        knowledgeServiceUrl: 'http://knowledge-service.test',
        internalAuthToken: 'internal-token',
      }).map((ragSource) => ({ id: ragSource.id, label: ragSource.label }))
    ).toEqual([{ id: 'knowledge-service', label: 'Baza Wiedzy' }]);
  });

  it('sanitizes Knowledge Service diagnostics before they enter chat RAG traces', async () => {
    const ragSource = createKnowledgeServiceRagSource({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              data: {
                items: [evidence()],
                coverageProbe: coverageProbe({
                  classification: 'accessible_candidate_seen',
                  candidateCountBucket: '1',
                }),
                diagnostics: {
                  searchedChunkCount: 1,
                  expandedItemCount: 0,
                  performance: {
                    totalMs: 18,
                    embeddingMs: 4,
                    vectorSearchMs: 3,
                    lexicalFetchMs: 2,
                    lexicalScoringMs: 2,
                    lexicalCandidatesMs: 4,
                    candidateMergeMs: 1,
                    pageLookupMs: 1,
                    rankingMs: 1,
                    expansionMs: 0,
                  },
                  rawCandidateCount: 9,
                  inaccessibleTitle: 'Restricted Spot Notes',
                  inaccessibleLevel: 8,
                  evidenceIds: ['restricted-chunk'],
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        ),
    });

    const result = await ragSource.retrieve({
      authorization: authorization('user-123'),
      query: 'method feeder',
      latestMessages: [],
      now: new Date('2026-06-14T12:00:00.000Z'),
      limits: { maxEvidenceItems: 6 },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        sourceId: 'knowledge-service',
        items: [evidence()],
        coverageProbe: coverageProbe({
          classification: 'accessible_candidate_seen',
          candidateCountBucket: '1',
        }),
        diagnostics: {
          searchedChunkCount: 1,
          expandedItemCount: 0,
        },
        performance: {
          totalMs: 18,
          embeddingMs: 4,
          vectorSearchMs: 3,
          lexicalFetchMs: 2,
          lexicalScoringMs: 2,
          lexicalCandidatesMs: 4,
          candidateMergeMs: 1,
          pageLookupMs: 1,
          rankingMs: 1,
          expansionMs: 0,
        },
      },
    });
  });

  it('keeps Knowledge Service performance timings in trace-only fields', async () => {
    const result = await aggregateRagEvidence(
      {
        sources: [
          source({
            id: 'knowledge-service',
            items: [evidence()],
            diagnostics: {
              embeddingModel: 'qwen/qwen3-embedding-8b',
              searchedChunkCount: 1,
            },
            performance: {
              totalMs: 18,
              embeddingMs: 4,
              vectorSearchMs: 3,
              lexicalFetchMs: 2,
              lexicalScoringMs: 2,
              lexicalCandidatesMs: 4,
              candidateMergeMs: 1,
              pageLookupMs: 1,
              rankingMs: 1,
              expansionMs: 0,
            },
          }),
        ],
        clock,
      },
      {
        authorization: authorization('user-1'),
        query: 'cold water feeder mix',
        latestMessages: [],
        limits: { maxEvidenceItems: 16 },
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected aggregation to succeed');
    }
    expect(result.value.trace.sources[0]).toMatchObject({
      diagnostics: {
        embeddingModel: 'qwen/qwen3-embedding-8b',
        searchedChunkCount: 1,
      },
      performance: {
        totalMs: 18,
        embeddingMs: 4,
        vectorSearchMs: 3,
        lexicalFetchMs: 2,
        lexicalScoringMs: 2,
        lexicalCandidatesMs: 4,
        candidateMergeMs: 1,
        pageLookupMs: 1,
        rankingMs: 1,
        expansionMs: 0,
      },
    });
    expect(result.value.trace.sources[0]?.diagnostics).not.toHaveProperty('performance');
  });

  it('maps Knowledge Service HTTP and envelope failures', async () => {
    const rejectedFetch = createKnowledgeServiceRagSource({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: () => Promise.reject(new Error('fetch down')),
    });
    await expect(
      rejectedFetch.retrieve({
        authorization: authorization('user-123'),
        query: 'method feeder',
        latestMessages: [],
        now: new Date('2026-06-14T12:00:00.000Z'),
        limits: { maxEvidenceItems: 6 },
      })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'DOWNSTREAM_ERROR', message: 'fetch down' },
    });

    const nonOk = createKnowledgeServiceRagSource({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: () => Promise.resolve(new Response('nope', { status: 503 })),
    });
    await expect(
      nonOk.retrieve({
        authorization: authorization('user-1'),
        query: 'method feeder',
        latestMessages: [],
        now: new Date('2026-06-14T12:00:00.000Z'),
        limits: { maxEvidenceItems: 6 },
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'DOWNSTREAM_ERROR',
        message: 'Knowledge Service retrieval failed with status 503',
      },
    });

    const errorEnvelope = createKnowledgeServiceRagSource({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ ok: false, error: { code: 'DOWNSTREAM_ERROR', message: 'offline' } })
          )
        ),
    });
    await expect(
      errorEnvelope.retrieve({
        authorization: authorization('user-1'),
        query: 'method feeder',
        latestMessages: [],
        now: new Date('2026-06-14T12:00:00.000Z'),
        limits: { maxEvidenceItems: 6 },
      })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'DOWNSTREAM_ERROR', message: 'offline' },
    });

    const errorEnvelopeWithoutMessage = createKnowledgeServiceRagSource({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: false, error: { code: 'DOWNSTREAM_ERROR' } }))
        ),
    });
    await expect(
      errorEnvelopeWithoutMessage.retrieve({
        authorization: authorization('user-1'),
        query: 'method feeder',
        latestMessages: [],
        now: new Date('2026-06-14T12:00:00.000Z'),
        limits: { maxEvidenceItems: 6 },
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'DOWNSTREAM_ERROR',
        message: 'Knowledge Service retrieval failed',
      },
    });

    const invalidJson = createKnowledgeServiceRagSource({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: () => Promise.resolve(new Response('not json')),
    });
    await expect(
      invalidJson.retrieve({
        authorization: authorization('user-1'),
        query: 'method feeder',
        latestMessages: [],
        now: new Date('2026-06-14T12:00:00.000Z'),
        limits: { maxEvidenceItems: 6 },
      })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_RESPONSE', message: 'Knowledge Service response was not valid JSON' },
    });

    const nonObject = createKnowledgeServiceRagSource({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: () => Promise.resolve(new Response(JSON.stringify([]))),
    });
    await expect(
      nonObject.retrieve({
        authorization: authorization('user-1'),
        query: 'method feeder',
        latestMessages: [],
        now: new Date('2026-06-14T12:00:00.000Z'),
        limits: { maxEvidenceItems: 6 },
      })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_RESPONSE', message: 'Knowledge Service response was not an object' },
    });

    const malformed = createKnowledgeServiceRagSource({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: () => Promise.resolve(new Response(JSON.stringify({ ok: true, data: {} }))),
    });
    await expect(
      malformed.retrieve({
        authorization: authorization('user-1'),
        query: 'method feeder',
        latestMessages: [],
        now: new Date('2026-06-14T12:00:00.000Z'),
        limits: { maxEvidenceItems: 6 },
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'INVALID_RESPONSE',
        message: 'Knowledge Service response did not include retrieval data',
      },
    });

    const malformedItem = createKnowledgeServiceRagSource({
      baseUrl: 'http://knowledge-service.test',
      internalAuthToken: 'internal-token',
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              data: {
                items: [{ id: 'knowledge-page:malformed', sourceId: 'knowledge-service' }],
                coverageProbe: coverageProbe(),
                diagnostics: {},
              },
            })
          )
        ),
    });
    await expect(
      malformedItem.retrieve({
        authorization: authorization('user-1'),
        query: 'method feeder',
        latestMessages: [],
        now: new Date('2026-06-14T12:00:00.000Z'),
        limits: { maxEvidenceItems: 6 },
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'INVALID_RESPONSE',
        message: 'Knowledge Service retrieval item 0 was malformed',
      },
    });
  });
});
