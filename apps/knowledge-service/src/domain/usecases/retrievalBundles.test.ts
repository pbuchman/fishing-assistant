import { describe, expect, it } from 'vitest';

import type {
  KnowledgeRetrievalChunkCandidate,
  KnowledgeRetrievalPageMetadata,
} from '../repositories/knowledgeRepositories.js';
import {
  buildCenteredWindowBundle,
  buildNamedPageBundles,
  dedupeOverlappingBundles,
  rankAndPackBundles,
} from './retrievalBundles.js';

const page: KnowledgeRetrievalPageMetadata = {
  id: 'page-1',
  nodeId: 'node-1',
  status: 'active',
  categoryId: 'category-1',
  sectionId: 'section-1',
  title: 'Method Feeder Basics',
  slug: 'method-feeder-basics',
  pathIds: ['root', 'category-1', 'section-1', 'node-1'],
  pathTitles: ['Knowledge Base', 'Method feeder', 'Basics', 'Method Feeder Basics'],
  hierarchy: { category: 'Method feeder', section: 'Basics' },
  source: { type: 'external', url: 'https://example.com/method', label: 'Example', importer: null },
  access: {
    inheritedFromCategoryId: 'category-1',
    categoryAccessRevision: 'access-rev-1',
    override: null,
    effective: { gate: 'level', requiredLevel: 6, accessRevision: 'access-rev-1' },
  },
  relations: { relatedTo: [], linksTo: [], supersedes: [] },
  markdownContentHash: 'hash-1',
  indexingStatus: 'ready',
  syncStatus: 'synced',
  accessSyncStatus: 'current',
  indexingError: null,
  syncError: null,
  accessSyncError: null,
  chunkCount: 5,
  createdAt: '2026-06-14T12:00:00.000Z',
  updatedAt: '2026-06-14T12:00:00.000Z',
  deletedAt: null,
  createdByUserId: 'admin-1',
  updatedByUserId: 'admin-1',
  deletedByUserId: null,
};

function chunk(
  id: string,
  index: number,
  text: string,
  headingPath = ['Method Feeder Basics', `Section ${String(index)}`]
): KnowledgeRetrievalChunkCandidate {
  return {
    id,
    pageId: page.id,
    nodeId: page.nodeId,
    categoryId: page.categoryId,
    sectionId: page.sectionId,
    title: page.title,
    status: 'active',
    path: page.pathTitles,
    headingPath,
    index,
    text,
    searchableText: `${headingPath.join('\n')}\n\n${text}`,
    markdownContentHash: 'hash-1',
    source: page.source,
    access: { gate: 'level', requiredLevel: 6 },
    accessRevision: 'access-rev-1',
    accessSyncStatus: 'current',
    createdAt: '2026-06-14T12:00:00.000Z',
    deletedAt: null,
    createdByJobId: null,
    accessRefreshedAt: '2026-06-14T12:00:00.000Z',
    accessRefreshJobId: null,
  };
}

describe('retrieval bundles', () => {
  const chunks = [
    chunk('chunk-0', 0, 'Intro about rods.'),
    chunk('chunk-1', 1, 'Use example-weight tools in fixture water.'),
    chunk('chunk-2', 2, 'Use example-range line in fixture setup.'),
    chunk('chunk-3', 3, 'Use example-length connectors near fixture items.'),
    chunk('chunk-4', 4, 'Keep casts repeatable.'),
  ];

  function mustChunk(index: number): KnowledgeRetrievalChunkCandidate {
    const selected = chunks[index];
    if (selected === undefined) {
      throw new Error(`Expected chunk ${String(index)}`);
    }
    return selected;
  }

  it('builds a centered window around the matched hit and preserves the citation chunk', () => {
    const bundle = buildCenteredWindowBundle({
      page,
      hitChunk: mustChunk(2),
      pageChunks: chunks,
      baseScore: 7,
      terms: ['line', 'pellets'],
      previousCount: 1,
      nextCount: 1,
      maxChars: 2_000,
    });

    expect(bundle).not.toBeNull();
    expect(bundle?.citationChunk.id).toBe('chunk-2');
    expect(bundle?.includedChunkIndexes).toEqual([1, 2, 3]);
    expect(bundle?.contentChunk.text).toContain('Use example-weight tools');
    expect(bundle?.contentChunk.text).toContain('Use example-length connectors');
    expect(bundle?.truncatedBefore).toBe(true);
    expect(bundle?.truncatedAfter).toBe(true);
  });

  it('falls back to the hit chunk when page ordering does not contain the hit', () => {
    const foreignHit = chunk('foreign-hit', 9, 'Foreign direct hit.');
    const bundle = buildCenteredWindowBundle({
      page,
      hitChunk: foreignHit,
      pageChunks: chunks,
      baseScore: 3,
      terms: [],
    });

    expect(bundle?.includedChunkIndexes).toEqual([9]);
    expect(bundle?.contentChunk.text).toContain('Foreign direct hit.');
    expect(bundle?.truncatedBefore).toBe(false);
    expect(bundle?.truncatedAfter).toBe(false);
  });

  it('splits named-page expansion into ranked windows under chunk and character limits', () => {
    const bundles = buildNamedPageBundles({
      page,
      pageChunks: chunks,
      parentScore: 4,
      terms: ['fixture', 'items'],
      maxChars: 140,
      maxChunks: 2,
      maxBundlesPerPage: 3,
    });

    expect(bundles).toHaveLength(3);
    expect(bundles.flatMap((bundle) => bundle.includedChunkIndexes)).toEqual([0, 1, 2, 3, 4]);
    expect(bundles.some((bundle) => bundle.contentChunk.text.includes('fixture items'))).toBe(true);
  });

  it('merges expanded bundles that share a protected citation chunk', () => {
    const protectedHit = buildCenteredWindowBundle({
      page,
      hitChunk: mustChunk(0),
      pageChunks: chunks,
      baseScore: 5,
      terms: ['method'],
      previousCount: 0,
      nextCount: 0,
    });
    const expanded = buildNamedPageBundles({
      page,
      pageChunks: chunks,
      parentScore: 6,
      terms: ['hooklengths'],
      maxChars: 10_000,
      maxChunks: 5,
      maxBundlesPerPage: 1,
    })[0];

    if (protectedHit === null || expanded === undefined) {
      throw new Error('expected bundles');
    }

    const packed = rankAndPackBundles({
      protectedBundles: [protectedHit],
      bundles: [expanded],
      maxBundles: 2,
      globalMaxChars: 10_000,
    });

    expect(packed).toHaveLength(1);
    expect(packed[0]?.citationChunk.id).toBe('chunk-0');
    expect(packed[0]?.contentChunk.text).toContain('Keep casts repeatable.');
  });

  it('deduplicates overlapping bundles without dropping a protected citation hit', () => {
    const protectedBundle = buildCenteredWindowBundle({
      page,
      hitChunk: mustChunk(1),
      pageChunks: chunks,
      baseScore: 2,
      terms: ['feeders'],
      previousCount: 0,
      nextCount: 0,
    });
    const competingBundle = buildCenteredWindowBundle({
      page,
      hitChunk: mustChunk(2),
      pageChunks: chunks,
      baseScore: 9,
      terms: ['line'],
      previousCount: 1,
      nextCount: 0,
    });

    if (protectedBundle === null || competingBundle === null) {
      throw new Error('expected bundles');
    }
    const result = dedupeOverlappingBundles({
      protectedBundles: [protectedBundle],
      bundles: [competingBundle],
      maxChars: 2_000,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.citationChunk.id).toBe('chunk-1');
    expect(result[0]?.contentChunk.text).toContain('Use example-range line in fixture setup.');
  });

  it('replaces an overlapping unprotected bundle when the candidate scores higher', () => {
    const existing = buildCenteredWindowBundle({
      page,
      hitChunk: mustChunk(1),
      pageChunks: chunks,
      baseScore: 1,
      terms: [],
      previousCount: 0,
      nextCount: 0,
    });
    const stronger = buildCenteredWindowBundle({
      page,
      hitChunk: mustChunk(2),
      pageChunks: chunks,
      baseScore: 8,
      terms: ['line'],
      previousCount: 1,
      nextCount: 0,
      maxChars: 200,
    });

    if (existing === null || stronger === null) {
      throw new Error('expected bundles');
    }
    const result = dedupeOverlappingBundles({
      protectedBundles: [],
      bundles: [existing, stronger],
      maxChars: 20,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.citationChunk.id).toBe('chunk-2');
  });

  it('ranks by score while using protected status only as a tie breaker', () => {
    const lowProtected = buildCenteredWindowBundle({
      page,
      hitChunk: mustChunk(0),
      pageChunks: chunks,
      baseScore: 1,
      terms: [],
      previousCount: 0,
      nextCount: 0,
    });
    const highScored = buildCenteredWindowBundle({
      page: { ...page, id: 'page-2', nodeId: 'node-2', title: 'Pellet Details' },
      hitChunk: {
        ...chunk('chunk-high', 0, 'Pellet details with strong match.'),
        pageId: 'page-2',
        nodeId: 'node-2',
        title: 'Pellet Details',
      },
      pageChunks: [
        {
          ...chunk('chunk-high', 0, 'Pellet details with strong match.'),
          pageId: 'page-2',
          nodeId: 'node-2',
          title: 'Pellet Details',
        },
      ],
      baseScore: 10,
      terms: ['pellet'],
      previousCount: 0,
      nextCount: 0,
    });

    if (lowProtected === null || highScored === null) {
      throw new Error('expected bundles');
    }
    const packed = rankAndPackBundles({
      protectedBundles: [lowProtected],
      bundles: [highScored],
      maxBundles: 1,
      globalMaxChars: 10_000,
    });

    expect(packed).toHaveLength(1);
    expect(packed[0]?.page.title).toBe('Pellet Details');
  });

  it('uses protected status and page order as score tie breakers', () => {
    const tiedUnprotected = buildCenteredWindowBundle({
      page,
      hitChunk: mustChunk(2),
      pageChunks: chunks,
      baseScore: 5,
      terms: [],
      previousCount: 0,
      nextCount: 0,
    });
    const tiedProtected = buildCenteredWindowBundle({
      page: { ...page, id: 'page-2', nodeId: 'node-2', title: 'Protected Tie' },
      hitChunk: {
        ...chunk('protected-tie', 0, 'Protected tie.'),
        pageId: 'page-2',
        nodeId: 'node-2',
        title: 'Protected Tie',
      },
      pageChunks: [
        {
          ...chunk('protected-tie', 0, 'Protected tie.'),
          pageId: 'page-2',
          nodeId: 'node-2',
          title: 'Protected Tie',
        },
      ],
      baseScore: 5,
      terms: [],
      previousCount: 0,
      nextCount: 0,
    });
    const samePageLater = buildCenteredWindowBundle({
      page,
      hitChunk: mustChunk(3),
      pageChunks: chunks,
      baseScore: 5,
      terms: [],
      previousCount: 0,
      nextCount: 0,
    });

    if (tiedUnprotected === null || tiedProtected === null || samePageLater === null) {
      throw new Error('expected bundles');
    }
    const packed = rankAndPackBundles({
      protectedBundles: [tiedProtected],
      bundles: [samePageLater, tiedUnprotected],
      maxBundles: 3,
      globalMaxChars: 10_000,
    });

    expect(packed.map((bundle) => bundle.citationChunk.id)).toEqual([
      'protected-tie',
      'chunk-2',
      'chunk-3',
    ]);
  });

  it('respects the global character budget after the first packed bundle', () => {
    const first = buildCenteredWindowBundle({
      page,
      hitChunk: mustChunk(1),
      pageChunks: chunks,
      baseScore: 10,
      terms: ['feeders'],
      previousCount: 0,
      nextCount: 0,
    });
    const second = buildCenteredWindowBundle({
      page: { ...page, id: 'page-3', nodeId: 'node-3', title: 'Long Context' },
      hitChunk: {
        ...chunk('long-hit', 0, 'Long context '.repeat(100)),
        pageId: 'page-3',
        nodeId: 'node-3',
        title: 'Long Context',
      },
      pageChunks: [
        {
          ...chunk('long-hit', 0, 'Long context '.repeat(100)),
          pageId: 'page-3',
          nodeId: 'node-3',
          title: 'Long Context',
        },
      ],
      baseScore: 9,
      terms: ['long'],
      previousCount: 0,
      nextCount: 0,
    });

    if (first === null || second === null) {
      throw new Error('expected bundles');
    }
    expect(
      rankAndPackBundles({
        bundles: [first, second],
        maxBundles: 3,
        globalMaxChars: first.contentChunk.text.length + 10,
      }).map((bundle) => bundle.page.title)
    ).toEqual(['Method Feeder Basics']);
  });
});
