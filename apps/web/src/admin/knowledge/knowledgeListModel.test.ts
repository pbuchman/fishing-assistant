import { describe, expect, it } from 'vitest';

import type { KnowledgeAdminTreeNode } from '../../services/knowledgeApi.js';
import {
  filterKnowledgePagesByCategory,
  flattenKnowledgePages,
  knowledgeCategoryFilters,
} from './knowledgeListModel.js';

function node(
  input: Partial<KnowledgeAdminTreeNode> & Pick<KnowledgeAdminTreeNode, 'id' | 'type' | 'title'>
): KnowledgeAdminTreeNode {
  return {
    slug: input.title.toLowerCase().replaceAll(' ', '-'),
    parentId: null,
    categoryId: null,
    sectionId: null,
    pageId: null,
    depth: 0,
    sortIndex: 0,
    path: [input.title],
    status: 'active',
    categoryAccess: null,
    accessRevision: null,
    pageSummary: null,
    children: [],
    ...input,
  };
}

function pageNode(input: {
  id: string;
  pageId: string;
  title: string;
  parentId: string;
  categoryId: string;
  sectionId?: string | null;
  depth?: 2 | 3;
  path: string[];
  children?: KnowledgeAdminTreeNode[];
}): KnowledgeAdminTreeNode {
  return node({
    id: input.id,
    type: 'page',
    title: input.title,
    parentId: input.parentId,
    categoryId: input.categoryId,
    sectionId: input.sectionId ?? null,
    pageId: input.pageId,
    depth: input.depth ?? 2,
    path: input.path,
    pageSummary: {
      effectiveAccess: {
        gate: 'level',
        requiredLevel: 4,
        accessRevision: 'rev-1',
        retrievalReady: true,
      },
      indexingStatus: 'ready',
      syncStatus: 'synced',
      accessSyncStatus: 'current',
      source: { type: 'external', url: 'https://source.example/pellet', label: 'Source' },
      chunkCount: 3,
      updatedAt: '2026-06-27T10:00:00.000Z',
    },
    children: input.children ?? [],
  });
}

describe('knowledgeListModel', () => {
  it('flattens tree into compact page list items with category, section, source URL, and subpages', () => {
    const childPage = pageNode({
      id: 'child-node',
      pageId: 'child-page',
      title: 'Podstrona',
      parentId: 'page-node',
      categoryId: 'category-1',
      sectionId: null,
      depth: 3,
      path: ['Przynęty', 'Pellet haczykowy', 'Podstrona'],
    });
    const root = node({
      id: 'root',
      type: 'root',
      title: 'Root',
      children: [
        node({
          id: 'category-1',
          type: 'category',
          title: 'Przynęty',
          categoryId: 'category-1',
          depth: 1,
          categoryAccess: { gate: 'level', requiredLevel: 4 },
          children: [
            node({
              id: 'section-1',
              type: 'section',
              title: 'Pellet',
              parentId: 'category-1',
              categoryId: 'category-1',
              sectionId: 'section-1',
              depth: 2,
              path: ['Przynęty', 'Pellet'],
              children: [
                pageNode({
                  id: 'page-node',
                  pageId: 'page-1',
                  title: 'Pellet haczykowy',
                  parentId: 'section-1',
                  categoryId: 'category-1',
                  sectionId: 'section-1',
                  depth: 3,
                  path: ['Przynęty', 'Pellet', 'Pellet haczykowy'],
                  children: [childPage],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    expect(flattenKnowledgePages(root)).toEqual([
      expect.objectContaining({
        pageId: 'page-1',
        title: 'Pellet haczykowy',
        categoryId: 'category-1',
        categoryTitle: 'Przynęty',
        sectionTitle: 'Pellet',
        sourceUrl: 'https://source.example/pellet',
        access: { gate: 'level', requiredLevel: 4 },
        subpageCount: 1,
        subpages: [{ pageId: 'child-page', title: 'Podstrona' }],
      }),
      expect.objectContaining({
        pageId: 'child-page',
        title: 'Podstrona',
        categoryId: 'category-1',
        categoryTitle: 'Przynęty',
      }),
    ]);
  });

  it('returns top-level category filters and filters pages by category only', () => {
    const root = node({
      id: 'root',
      type: 'root',
      title: 'Root',
      children: [
        node({
          id: 'category-1',
          type: 'category',
          title: 'Przynęty',
          categoryId: 'category-1',
          depth: 1,
          children: [
            pageNode({
              id: 'page-node-1',
              pageId: 'page-1',
              title: 'Pellet haczykowy',
              parentId: 'category-1',
              categoryId: 'category-1',
              path: ['Przynęty', 'Pellet haczykowy'],
            }),
          ],
        }),
        node({
          id: 'category-2',
          type: 'category',
          title: 'Zanęty',
          categoryId: 'category-2',
          depth: 1,
          children: [
            pageNode({
              id: 'page-node-2',
              pageId: 'page-2',
              title: 'Mix rzeczny',
              parentId: 'category-2',
              categoryId: 'category-2',
              path: ['Zanęty', 'Mix rzeczny'],
            }),
          ],
        }),
      ],
    });
    const pages = flattenKnowledgePages(root);

    expect(knowledgeCategoryFilters(root)).toEqual([
      { id: 'category-1', title: 'Przynęty' },
      { id: 'category-2', title: 'Zanęty' },
    ]);
    expect(filterKnowledgePagesByCategory(pages, null)).toHaveLength(2);
    expect(filterKnowledgePagesByCategory(pages, 'category-2')).toEqual([
      expect.objectContaining({ pageId: 'page-2', categoryTitle: 'Zanęty' }),
    ]);
  });
});
