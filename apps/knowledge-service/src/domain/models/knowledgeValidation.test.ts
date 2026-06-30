import { describe, expect, it } from 'vitest';

import type { KnowledgeNode, KnowledgePage, KnowledgePageChunk } from './knowledge.js';
import {
  validateKnowledgeAccess,
  validateKnowledgeNode,
  validateKnowledgePage,
  validateKnowledgePageChunks,
  validateKnowledgeSourceUrl,
} from './knowledgeValidation.js';

const timestamp = '2026-06-14T12:00:00.000Z';

function rootNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return {
    id: 'root',
    type: 'root',
    status: 'active',
    title: 'Knowledge Base',
    slug: 'knowledge-base',
    sortIndex: 0,
    parentId: null,
    categoryId: null,
    sectionId: null,
    pageId: null,
    depth: 0,
    pathIds: ['root'],
    pathTitles: ['Knowledge Base'],
    categoryAccess: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    createdByUserId: null,
    updatedByUserId: null,
    deletedByUserId: null,
    ...overrides,
  };
}

function categoryNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return rootNode({
    id: 'category-1',
    type: 'category',
    title: 'Category',
    slug: 'category',
    parentId: 'root',
    categoryId: 'category-1',
    depth: 1,
    pathIds: ['root', 'category-1'],
    pathTitles: ['Knowledge Base', 'Category'],
    categoryAccess: { gate: 'level', requiredLevel: 4, accessRevision: 'access-rev-1' },
    ...overrides,
  });
}

function sectionNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return rootNode({
    id: 'section-1',
    type: 'section',
    title: 'Section',
    slug: 'section',
    parentId: 'category-1',
    categoryId: 'category-1',
    sectionId: 'section-1',
    depth: 2,
    pathIds: ['root', 'category-1', 'section-1'],
    pathTitles: ['Knowledge Base', 'Category', 'Section'],
    ...overrides,
  });
}

function pageNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return rootNode({
    id: 'page-node-1',
    type: 'page',
    title: 'Page',
    slug: 'page',
    parentId: 'section-1',
    categoryId: 'category-1',
    sectionId: 'section-1',
    pageId: 'page-1',
    depth: 3,
    pathIds: ['root', 'category-1', 'section-1', 'page-node-1'],
    pathTitles: ['Knowledge Base', 'Category', 'Section', 'Page'],
    ...overrides,
  });
}

function page(overrides: Partial<KnowledgePage> = {}): KnowledgePage {
  return {
    id: 'page-1',
    nodeId: 'page-node-1',
    status: 'active',
    title: 'Page',
    slug: 'page',
    categoryId: 'category-1',
    sectionId: 'section-1',
    pathIds: ['root', 'category-1', 'section-1', 'page-node-1'],
    pathTitles: ['Knowledge Base', 'Category', 'Section', 'Page'],
    hierarchy: { category: 'Category', section: 'Section' },
    source: {
      type: 'external',
      url: 'https://example.com/page',
      label: 'Example',
      importer: null,
    },
    access: {
      inheritedFromCategoryId: 'category-1',
      categoryAccessRevision: 'access-rev-1',
      override: null,
      effective: { gate: 'level', requiredLevel: 4, accessRevision: 'access-rev-1' },
    },
    relations: { relatedTo: [], linksTo: [], supersedes: [] },
    markdown: '# Page\n\nBody',
    normalizedMarkdown: '# Page\n\nBody',
    markdownContentHash: 'hash-1',
    indexingStatus: 'ready',
    syncStatus: 'synced',
    accessSyncStatus: 'current',
    indexingError: null,
    syncError: null,
    accessSyncError: null,
    chunkCount: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    createdByUserId: 'admin-1',
    updatedByUserId: 'admin-1',
    deletedByUserId: null,
    ...overrides,
  };
}

function pageChunk(overrides: Partial<KnowledgePageChunk> = {}): KnowledgePageChunk {
  return {
    id: 'chunk-1',
    status: 'active',
    pageId: 'page-1',
    nodeId: 'page-node-1',
    categoryId: 'category-1',
    sectionId: 'section-1',
    title: 'Page',
    path: ['Knowledge Base', 'Category', 'Section', 'Page'],
    headingPath: ['Page'],
    index: 0,
    text: 'Chunk text',
    searchableText: 'Page\n\nChunk text',
    markdownContentHash: 'hash-1',
    access: { gate: 'level', requiredLevel: 4 },
    accessRevision: 'access-rev-1',
    accessSyncStatus: 'current',
    source: { type: 'external', url: 'https://example.com/page', label: 'Example' },
    embedding: Array.from({ length: 2048 }, () => 0.1),
    embeddingModel: 'qwen/qwen3-embedding-8b',
    embeddingProvider: 'openrouter',
    embeddingDimensions: 2048,
    createdAt: timestamp,
    deletedAt: null,
    createdByJobId: null,
    accessRefreshedAt: timestamp,
    accessRefreshJobId: null,
    ...overrides,
  };
}

describe('knowledge validation', () => {
  it.each([
    { access: { gate: 'public', requiredLevel: null }, allowManual: false, ok: true },
    { access: { gate: 'approved', requiredLevel: null }, allowManual: false, ok: true },
    { access: { gate: 'excluded', requiredLevel: null }, allowManual: false, ok: true },
    { access: { gate: 'manual', requiredLevel: null }, allowManual: true, ok: true },
    { access: { gate: 'manual', requiredLevel: null }, allowManual: false, ok: false },
    { access: { gate: 'unknown', requiredLevel: null }, allowManual: true, ok: false },
    { access: { gate: 'level', requiredLevel: 1 }, allowManual: false, ok: true },
    { access: { gate: 'level', requiredLevel: 10 }, allowManual: false, ok: true },
    { access: { gate: 'level', requiredLevel: null }, allowManual: false, ok: false },
    { access: { gate: 'level', requiredLevel: 0 }, allowManual: false, ok: false },
    { access: { gate: 'level', requiredLevel: 11 }, allowManual: false, ok: false },
    { access: { gate: 'level', requiredLevel: 4.5 }, allowManual: false, ok: false },
    { access: { gate: 'public', requiredLevel: 1 }, allowManual: false, ok: false },
  ])('validates access %#', ({ access, allowManual, ok }) => {
    expect(validateKnowledgeAccess(access, 'chunk', { allowManual }).ok).toBe(ok);
  });

  it.each([
    { source: { type: 'manual' as const, url: null }, ok: true },
    { source: { type: 'external' as const, url: 'https://example.com/page' }, ok: true },
    { source: { type: 'other' as never, url: 'https://example.com/page' }, ok: false },
    { source: { type: 'external' as const, url: null }, ok: false },
    { source: { type: 'external' as const, url: 'not-a-url' }, ok: false },
    { source: { type: 'external' as const, url: 'http://example.com/page' }, ok: false },
    { source: { type: 'external' as const, url: 'https://example.com/#/admin' }, ok: false },
    { source: { type: 'external' as const, url: 'https://example.com/api/pages' }, ok: false },
    { source: { type: 'external' as const, url: 'https://example.com/share/test' }, ok: false },
    { source: { type: 'external' as const, url: 'https://example.com/admin/pages' }, ok: false },
    { source: { type: 'external' as const, url: 'https://example.com/editor/pages' }, ok: false },
    {
      source: { type: 'external' as const, url: 'https://dev.fishing-assistant.online/#/chat' },
      ok: false,
    },
    { source: { type: 'external' as const, url: 'https://localhost/page' }, ok: false },
    { source: { type: 'external' as const, url: 'https://service.local/page' }, ok: false },
    { source: { type: 'external' as const, url: 'https://service.internal/page' }, ok: false },
    {
      source: { type: 'external' as const, url: 'https://metadata.google.internal/page' },
      ok: false,
    },
    { source: { type: 'external' as const, url: 'https://[::1]/page' }, ok: false },
    { source: { type: 'external' as const, url: 'https://10.0.0.1/page' }, ok: false },
    { source: { type: 'external' as const, url: 'https://127.0.0.1/page' }, ok: false },
    { source: { type: 'external' as const, url: 'https://172.16.0.1/page' }, ok: false },
    { source: { type: 'external' as const, url: 'https://172.31.255.1/page' }, ok: false },
    { source: { type: 'external' as const, url: 'https://172.32.0.1/page' }, ok: true },
    { source: { type: 'external' as const, url: 'https://192.168.0.1/page' }, ok: false },
    { source: { type: 'external' as const, url: 'https://169.254.1.1/page' }, ok: false },
    { source: { type: 'external' as const, url: 'https://example.com./page' }, ok: true },
  ])('validates source url %#', ({ source, ok }) => {
    expect(validateKnowledgeSourceUrl(source, 'source').ok).toBe(ok);
  });

  it.each([
    { node: rootNode(), ok: true },
    { node: categoryNode(), ok: true },
    { node: sectionNode(), ok: true },
    {
      node: pageNode({
        parentId: 'category-1',
        sectionId: null,
        depth: 2,
        pathIds: ['root', 'category-1', 'page-node-1'],
        pathTitles: ['Knowledge Base', 'Category', 'Page'],
      }),
      ok: true,
    },
    { node: pageNode(), ok: true },
    { node: pageNode({ depth: 4 as never }), ok: false },
    { node: pageNode({ pathIds: ['root'], pathTitles: ['Knowledge Base'] }), ok: false },
    { node: rootNode({ id: 'not-root' }), ok: false },
    { node: categoryNode({ parentId: 'category-0' }), ok: false },
    {
      node: categoryNode({
        categoryAccess: { gate: 'level', requiredLevel: 11, accessRevision: 'access-rev-1' },
      }),
      ok: false,
    },
    { node: sectionNode({ parentId: 'root' }), ok: false },
    { node: pageNode({ pageId: '' }), ok: false },
    { node: pageNode({ sectionId: null, depth: 3 }), ok: false },
    { node: pageNode({ parentId: 'category-1' }), ok: false },
  ])('validates knowledge node %#', ({ node, ok }) => {
    expect(validateKnowledgeNode(node).ok).toBe(ok);
  });

  it.each([
    { input: page(), ok: true },
    {
      input: page({
        access: {
          ...page().access,
          effective: { gate: 'public', requiredLevel: 4, accessRevision: 'access-rev-1' },
        },
      }),
      ok: false,
    },
    {
      input: page({
        access: {
          ...page().access,
          override: {
            gate: 'level',
            requiredLevel: 12,
            source: 'storage',
            recordedAt: timestamp,
            recordedByUserId: 'admin-1',
          },
        },
      }),
      ok: false,
    },
    { input: page({ source: { ...page().source, url: 'http://example.com/page' } }), ok: false },
    {
      input: page({
        access: { ...page().access, inheritedFromCategoryId: 'category-2' },
      }),
      ok: false,
    },
    { input: page({ markdown: '' }), ok: false },
    { input: page({ normalizedMarkdown: '' }), ok: false },
  ])('validates knowledge page %#', ({ input, ok }) => {
    expect(validateKnowledgePage(input).ok).toBe(ok);
  });

  it.each([
    { chunks: [pageChunk()], ok: true },
    { chunks: [pageChunk({ pageId: 'other-page' })], ok: false },
    { chunks: [pageChunk({ status: 'deleted' })], ok: false },
    { chunks: [pageChunk({ accessSyncStatus: 'stale' })], ok: false },
    { chunks: [pageChunk({ embeddingDimensions: 1024 as never })], ok: false },
    { chunks: [pageChunk({ embedding: [0.1] })], ok: false },
    {
      chunks: [pageChunk({ access: { gate: 'manual' as never, requiredLevel: null } })],
      ok: false,
    },
    {
      chunks: [
        pageChunk({ source: { type: 'external', url: 'https://localhost/page', label: null } }),
      ],
      ok: false,
    },
  ])('validates replacement chunks %#', ({ chunks, ok }) => {
    expect(validateKnowledgePageChunks({ pageId: 'page-1', chunks }).ok).toBe(ok);
  });
});
