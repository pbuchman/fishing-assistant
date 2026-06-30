import type {
  KnowledgeAccessInput,
  KnowledgeAccessSyncStatus,
  KnowledgeAdminTreeNode,
  KnowledgeIndexingStatus,
  KnowledgeSyncStatus,
} from '../../services/knowledgeApi.js';

export interface KnowledgeCategoryFilter {
  id: string;
  title: string;
}

export interface KnowledgeSubpageSummary {
  pageId: string;
  title: string;
}

export interface KnowledgePageListItem {
  pageId: string;
  title: string;
  categoryId: string;
  categoryTitle: string;
  sectionTitle: string | null;
  path: string[];
  sourceUrl: string | null;
  access: KnowledgeAccessInput;
  indexingStatus: KnowledgeIndexingStatus;
  syncStatus: KnowledgeSyncStatus;
  accessSyncStatus: KnowledgeAccessSyncStatus;
  chunkCount: number;
  updatedAt: string;
  subpageCount: number;
  subpages: KnowledgeSubpageSummary[];
}

function nearestCategory(path: readonly KnowledgeAdminTreeNode[]): KnowledgeAdminTreeNode | null {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const node = path[index];
    if (node?.type === 'category' && node.categoryId !== null) {
      return node;
    }
  }

  return null;
}

function nearestSection(path: readonly KnowledgeAdminTreeNode[]): KnowledgeAdminTreeNode | null {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const node = path[index];
    if (node?.type === 'section') {
      return node;
    }
  }

  return null;
}

function pageChildren(node: KnowledgeAdminTreeNode): KnowledgeSubpageSummary[] {
  return node.children.flatMap((child) => {
    if (child.type !== 'page' || child.pageId === null) {
      return [];
    }

    return [{ pageId: child.pageId, title: child.title }];
  });
}

function adminAccessInput(
  access: NonNullable<KnowledgeAdminTreeNode['pageSummary']>['effectiveAccess']
): KnowledgeAccessInput {
  if (access.gate === 'manual') {
    return { gate: 'excluded', requiredLevel: null };
  }

  return {
    gate: access.gate,
    requiredLevel: access.gate === 'level' ? access.requiredLevel : null,
  };
}

export function flattenKnowledgePages(root: KnowledgeAdminTreeNode): KnowledgePageListItem[] {
  const items: KnowledgePageListItem[] = [];

  function visit(node: KnowledgeAdminTreeNode, ancestors: KnowledgeAdminTreeNode[]): void {
    const path = [...ancestors, node];
    if (node.type === 'page' && node.pageId !== null && node.pageSummary !== null) {
      const category = nearestCategory(path);
      if (category !== null && category.categoryId !== null) {
        const section = nearestSection(path);
        const subpages = pageChildren(node);
        items.push({
          pageId: node.pageId,
          title: node.title,
          categoryId: category.categoryId,
          categoryTitle: category.title,
          sectionTitle: section?.title ?? null,
          path: node.path,
          sourceUrl: node.pageSummary.source.url,
          access: adminAccessInput(node.pageSummary.effectiveAccess),
          indexingStatus: node.pageSummary.indexingStatus,
          syncStatus: node.pageSummary.syncStatus,
          accessSyncStatus: node.pageSummary.accessSyncStatus,
          chunkCount: node.pageSummary.chunkCount,
          updatedAt: node.pageSummary.updatedAt,
          subpageCount: subpages.length,
          subpages,
        });
      }
    }

    for (const child of node.children) {
      visit(child, path);
    }
  }

  visit(root, []);
  return items;
}

export function knowledgeCategoryFilters(root: KnowledgeAdminTreeNode): KnowledgeCategoryFilter[] {
  return root.children.flatMap((node) => {
    if (node.type !== 'category' || node.categoryId === null) {
      return [];
    }

    return [{ id: node.categoryId, title: node.title }];
  });
}

export function filterKnowledgePagesByCategory(
  items: readonly KnowledgePageListItem[],
  categoryId: string | null
): KnowledgePageListItem[] {
  if (categoryId === null) {
    return [...items];
  }

  return items.filter((item) => item.categoryId === categoryId);
}
