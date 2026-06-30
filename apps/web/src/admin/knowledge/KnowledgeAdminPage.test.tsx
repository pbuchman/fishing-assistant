import { createElement, type ComponentType } from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n/I18nProvider.js';
import { ApiClientError } from '../../services/apiClient.js';
import {
  AdminNavigationGuardProvider,
  type AdminNavigationGuardState,
} from '../navigationGuard.js';
import { KnowledgeCategorySettingsSheet } from './KnowledgeCategorySettingsSheet.js';
import { KnowledgePageList } from './KnowledgePageList.js';
import type { KnowledgePageListItem } from './knowledgeListModel.js';

const knowledgeAdminPageModulePath = './KnowledgeAdminPage.js';

const mocks = vi.hoisted(() => ({
  acknowledgeKnowledgePageContentQuality: vi.fn(),
  createKnowledgeCategory: vi.fn(),
  createKnowledgePage: vi.fn(),
  createKnowledgeSection: vi.fn(),
  deleteKnowledgePage: vi.fn(),
  getKnowledgePage: vi.fn(),
  listKnowledgeTree: vi.fn(),
  reindexKnowledgePage: vi.fn(),
  saveKnowledgePage: vi.fn(),
  syncAdminKnowledgeBase: vi.fn(),
  syncKnowledgePage: vi.fn(),
  updateKnowledgeCategoryAccess: vi.fn(),
}));

vi.mock('../../services/knowledgeApi.js', () => ({
  acknowledgeKnowledgePageContentQuality: mocks.acknowledgeKnowledgePageContentQuality,
  createKnowledgeCategory: mocks.createKnowledgeCategory,
  createKnowledgePage: mocks.createKnowledgePage,
  createKnowledgeSection: mocks.createKnowledgeSection,
  deleteKnowledgePage: mocks.deleteKnowledgePage,
  getKnowledgePage: mocks.getKnowledgePage,
  listKnowledgeTree: mocks.listKnowledgeTree,
  reindexKnowledgePage: mocks.reindexKnowledgePage,
  saveKnowledgePage: mocks.saveKnowledgePage,
  syncAdminKnowledgeBase: mocks.syncAdminKnowledgeBase,
  syncKnowledgePage: mocks.syncKnowledgePage,
  updateKnowledgeCategoryAccess: mocks.updateKnowledgeCategoryAccess,
}));

const page = {
  id: 'page-1',
  nodeId: 'page-node-1',
  title: 'Pellet choices',
  categoryId: 'category-1',
  sectionId: null,
  hierarchy: { category: 'Method Feeder' },
  path: ['Knowledge Base', 'Method Feeder', 'Pellet choices'],
  source: {
    type: 'external' as const,
    url: 'https://source.example/pellet-choices',
    label: 'Source',
  },
  access: {
    effective: {
      gate: 'approved' as const,
      requiredLevel: null,
      accessRevision: 'category-rev-1',
      retrievalReady: true,
    },
    inheritedFromCategoryId: 'category-1',
    overridePresent: false,
  },
  relations: { relatedTo: [], linksTo: [], supersedes: [] },
  markdown: '# Pellet choices\n\nUse soaked pellets.',
  markdownContentHash: 'hash-page-1',
  contentQualityAcknowledgements: [],
  indexingStatus: 'pending' as const,
  syncStatus: 'sync_required' as const,
  accessSyncStatus: 'current' as const,
  indexingError: null,
  syncError: null,
  accessSyncError: null,
  chunkCount: 0,
  createdAt: '2026-06-14T10:00:00.000Z',
  updatedAt: '2026-06-14T12:00:00.000Z',
  deletedAt: null,
};

const compactListItem: KnowledgePageListItem = {
  pageId: 'page-1',
  title: 'Pellet choices',
  categoryId: 'category-1',
  categoryTitle: 'Method Feeder',
  sectionTitle: null,
  path: ['Knowledge Base', 'Method Feeder', 'Pellet choices'],
  sourceUrl: 'https://source.example/pellet-choices',
  access: { gate: 'approved', requiredLevel: null },
  indexingStatus: 'ready',
  syncStatus: 'synced',
  accessSyncStatus: 'current',
  chunkCount: 4,
  updatedAt: '2026-06-14T12:00:00.000Z',
  subpageCount: 0,
  subpages: [],
};

const tree = {
  root: {
    id: 'root',
    type: 'root' as const,
    title: 'Knowledge Base',
    slug: 'knowledge-base',
    parentId: null,
    categoryId: null,
    sectionId: null,
    pageId: null,
    depth: 0 as const,
    sortIndex: 0,
    path: ['Knowledge Base'],
    status: 'active' as const,
    categoryAccess: null,
    accessRevision: null,
    pageSummary: null,
    children: [
      {
        id: 'category-1',
        type: 'category' as const,
        title: 'Method Feeder',
        slug: 'method-feeder',
        parentId: 'root',
        categoryId: 'category-1',
        sectionId: null,
        pageId: null,
        depth: 1 as const,
        sortIndex: 0,
        path: ['Knowledge Base', 'Method Feeder'],
        status: 'active' as const,
        categoryAccess: { gate: 'approved' as const, requiredLevel: null },
        accessRevision: 'category-rev-1',
        pageSummary: null,
        children: [
          {
            id: 'page-node-1',
            type: 'page' as const,
            title: 'Pellet choices',
            slug: 'pellet-choices',
            parentId: 'category-1',
            categoryId: 'category-1',
            sectionId: null,
            pageId: 'page-1',
            depth: 2 as const,
            sortIndex: 0,
            path: ['Knowledge Base', 'Method Feeder', 'Pellet choices'],
            status: 'active' as const,
            categoryAccess: null,
            accessRevision: null,
            pageSummary: {
              effectiveAccess: {
                gate: 'approved' as const,
                requiredLevel: null,
                accessRevision: 'category-rev-1',
                retrievalReady: true,
              },
              indexingStatus: 'pending' as const,
              syncStatus: 'sync_required' as const,
              accessSyncStatus: 'current' as const,
              source: {
                type: 'external' as const,
                url: 'https://source.example/pellet-choices',
                label: 'Source',
              },
              chunkCount: 0,
              updatedAt: '2026-06-14T12:00:00.000Z',
            },
            children: [],
          },
        ],
      },
    ],
  },
  accessRefresh: {
    pendingJobs: 0,
    runningJobs: 0,
    failedJobs: 0,
    staleChunkCount: 0,
    mismatchCount: 0,
  },
};

const treeWithSections = {
  ...tree,
  root: {
    ...tree.root,
    children: [
      {
        ...tree.root.children[0],
        children: [
          {
            id: 'section-node-1',
            type: 'section' as const,
            title: 'Hooks',
            slug: 'hooks',
            parentId: 'category-1',
            categoryId: 'category-1',
            sectionId: 'section-1',
            pageId: null,
            depth: 2 as const,
            sortIndex: 0,
            path: ['Knowledge Base', 'Method Feeder', 'Hooks'],
            status: 'active' as const,
            categoryAccess: null,
            accessRevision: null,
            pageSummary: null,
            children: [],
          },
          ...(tree.root.children.at(0)?.children ?? []),
        ],
      },
    ],
  },
};

const emptyTree = {
  ...tree,
  root: {
    ...tree.root,
    children: [],
  },
};

const pageWithRelations = {
  ...page,
  source: { type: 'external' as const, url: 'https://example.com/pellets', label: 'Pellet guide' },
  relations: {
    relatedTo: ['page-related'],
    linksTo: ['page-link-a'],
    supersedes: ['page-old'],
  },
  markdown: '# Pellet choices\n\nUpdated source notes.',
};

const pageTwo = {
  ...page,
  id: 'page-2',
  nodeId: 'page-node-2',
  title: 'Hook sizes',
  path: ['Knowledge Base', 'Method Feeder', 'Hook sizes'],
  markdown: '# Hook sizes\n\nUse lighter wire hooks.',
  updatedAt: '2026-06-14T13:00:00.000Z',
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function readWebStyles(): string {
  const candidates = [
    join(process.cwd(), 'src/styles.css'),
    join(process.cwd(), 'apps/web/src/styles.css'),
  ];
  const stylesPath = candidates.find((candidate) => existsSync(candidate));
  if (stylesPath === undefined) {
    throw new Error('Unable to locate apps/web/src/styles.css');
  }

  return readFileSync(stylesPath, 'utf8');
}

async function renderKnowledgeAdminPage(
  props: {
    selectedPageId?: string | undefined;
  } = {},
  options: {
    onGuardChange?: (guard: AdminNavigationGuardState | null) => void;
  } = {}
): Promise<ReturnType<typeof render>> {
  const { KnowledgeAdminPage } = (await import(knowledgeAdminPageModulePath)) as {
    KnowledgeAdminPage: ComponentType<{ selectedPageId?: string | undefined }>;
  };

  const pageElement = createElement(KnowledgeAdminPage, props);
  const content =
    options.onGuardChange === undefined
      ? pageElement
      : createElement(AdminNavigationGuardProvider, {
          children: pageElement,
          setGuard: options.onGuardChange,
        });

  return render(createElement(I18nProvider, null, content));
}

describe('KnowledgeAdminPage', () => {
  beforeEach(() => {
    window.localStorage.setItem('fa.locale', 'en');
    mocks.acknowledgeKnowledgePageContentQuality.mockReset();
    mocks.createKnowledgeCategory.mockReset();
    mocks.createKnowledgePage.mockReset();
    mocks.createKnowledgeSection.mockReset();
    mocks.deleteKnowledgePage.mockReset();
    mocks.getKnowledgePage.mockReset();
    mocks.listKnowledgeTree.mockReset();
    mocks.reindexKnowledgePage.mockReset();
    mocks.saveKnowledgePage.mockReset();
    mocks.syncAdminKnowledgeBase.mockReset();
    mocks.syncKnowledgePage.mockReset();
    mocks.updateKnowledgeCategoryAccess.mockReset();
    mocks.listKnowledgeTree.mockResolvedValue(tree);
    mocks.getKnowledgePage.mockResolvedValue(page);
    mocks.createKnowledgePage.mockResolvedValue(page);
    const category = tree.root.children[0];
    const section = treeWithSections.root.children[0]?.children[0];
    if (category === undefined || section === undefined) {
      throw new Error('Expected knowledge tree fixtures.');
    }
    mocks.createKnowledgeCategory.mockResolvedValue(category);
    mocks.createKnowledgeSection.mockResolvedValue(section);
    mocks.deleteKnowledgePage.mockResolvedValue({
      deleted: true,
      pageId: 'page-1',
      deletedChunkCount: 0,
    });
    mocks.saveKnowledgePage.mockResolvedValue(page);
    mocks.acknowledgeKnowledgePageContentQuality.mockResolvedValue({ page });
    mocks.syncAdminKnowledgeBase.mockResolvedValue({
      synced: 0,
      failed: 0,
      skipped: 1,
      queuedAccessRefreshJobs: 0,
    });
    mocks.syncKnowledgePage.mockResolvedValue({ page, syncedChunkCount: 0 });
    mocks.reindexKnowledgePage.mockResolvedValue({ page, replacedChunkCount: 0 });
    mocks.updateKnowledgeCategoryAccess.mockResolvedValue({
      category: {
        ...tree.root.children[0],
        categoryAccess: { gate: 'level', requiredLevel: 1 },
      },
      refreshJob: null,
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('covers compact Knowledge page list status and category branches', () => {
    const onCategoryChange = vi.fn();
    const onOpenCategorySettings = vi.fn();
    const pages: KnowledgePageListItem[] = [
      {
        ...compactListItem,
        pageId: 'ready-page',
        title: 'Ready page',
        sectionTitle: 'Recipes',
      },
      {
        ...compactListItem,
        pageId: 'failed-page',
        title: 'Failed page',
        indexingStatus: 'failed',
      },
      {
        ...compactListItem,
        pageId: 'invalid-access-page',
        title: 'Invalid access page',
        accessSyncStatus: 'invalid',
      },
      {
        ...compactListItem,
        pageId: 'needs-update-page',
        title: 'Needs update page',
        indexingStatus: 'pending',
        syncStatus: 'sync_required',
      },
    ];

    render(
      createElement(
        I18nProvider,
        null,
        createElement(KnowledgePageList, {
          categories: [{ id: 'category-1', title: 'Method Feeder' }],
          categoryId: 'category-1',
          pages,
          totalCount: pages.length,
          onCategoryChange,
          onOpenCategorySettings,
        })
      )
    );

    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getAllByText('Needs attention')).toHaveLength(2);
    expect(screen.getByText('Unpublished')).toBeInTheDocument();
    expect(screen.getByText('Method Feeder / Recipes')).toBeInTheDocument();
    expect(screen.queryByText('0 subpages')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Change category access' }));
    expect(onOpenCategorySettings).toHaveBeenCalledWith('category-1');

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: '' } });
    expect(onCategoryChange).toHaveBeenCalledWith(null);
  });

  it('keeps category settings empty without an editable category and saves level access', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const category = tree.root.children[0];
    if (category === undefined) {
      throw new Error('Expected category fixture.');
    }

    const { rerender } = render(
      createElement(
        I18nProvider,
        null,
        createElement(KnowledgeCategorySettingsSheet, {
          category: null,
          busy: false,
          open: true,
          onClose,
          onSave,
        })
      )
    );

    expect(screen.queryByRole('button', { name: 'Save access' })).toBeNull();

    rerender(
      createElement(
        I18nProvider,
        null,
        createElement(KnowledgeCategorySettingsSheet, {
          category: category,
          busy: false,
          open: true,
          onClose,
          onSave,
        })
      )
    );

    expect(screen.queryByText('public')).toBeNull();
    expect(screen.queryByRole('option', { name: /public/i })).toBeNull();
    expect(screen.getByRole('radio', { name: /Everyone approved/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Do not use in answers/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Users from tier/i }));
    fireEvent.click(screen.getByRole('button', { name: '8' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        'category-1',
        { gate: 'level', requiredLevel: 8 },
        'category-rev-1'
      );
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders a compact page list and edits category access from a settings sheet', async () => {
    await renderKnowledgeAdminPage();

    expect(await screen.findByRole('heading', { level: 2, name: 'Knowledge Base' })).not.toBeNull();
    expect(await screen.findByRole('table', { name: 'Pages' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pellet choices' })).toHaveAttribute(
      'href',
      '#/admin/knowledge/page-1'
    );
    expect(screen.queryByText('0 subpages')).toBeNull();
    expect(
      screen.getByText(
        'Showing pages from all categories. Choose a category to change access for its pages.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change category access' })).toBeNull();
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.getByText('Everything is current')).toBeInTheDocument();
    expect(screen.getByText('1 unpublished change')).toBeInTheDocument();
    expect(screen.getAllByText('Unpublished').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Showing 1 of 1 pages')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: 'category-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change category access' }));

    const dialog = await screen.findByRole('dialog', { name: 'Change category access' });
    expect(within(dialog).queryByText('public')).toBeNull();
    expect(
      within(dialog).getByText(
        'Changes apply to this category and all sections and pages inside it.'
      )
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Everyone approved/i })).toBeChecked();
    expect(
      within(dialog).getByRole('radio', { name: /Do not use in answers/i })
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '1' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('radio', { name: /Users from tier/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: '4' }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save access' }));

    await waitFor(() => {
      expect(mocks.updateKnowledgeCategoryAccess).toHaveBeenCalledWith(
        'category-1',
        {
          gate: 'level',
          requiredLevel: 4,
        },
        'category-rev-1'
      );
    });
    expect(
      await screen.findByText(
        'Access saved for the category. Publish changes for the assistant so the new access rules are used in answers.'
      )
    ).toBeInTheDocument();
  });

  it('loads additional Knowledge Base rows incrementally instead of rendering every page at once', async () => {
    const categoryNode = tree.root.children[0];
    const pageNode = categoryNode?.children[0];
    if (categoryNode === undefined || pageNode === undefined) {
      throw new Error('Expected knowledge tree fixtures.');
    }
    const manyPagesTree = {
      ...tree,
      root: {
        ...tree.root,
        children: [
          {
            ...categoryNode,
            children: Array.from({ length: 30 }, (_, index) => {
              const pageNumber = String(index + 1);

              return {
                ...pageNode,
                id: `page-node-${pageNumber}`,
                title: `Page ${pageNumber}`,
                slug: `page-${pageNumber}`,
                pageId: `page-${pageNumber}`,
                path: ['Knowledge Base', 'Method Feeder', `Page ${pageNumber}`],
              };
            }),
          },
        ],
      },
    };
    mocks.listKnowledgeTree.mockResolvedValue(manyPagesTree);

    await renderKnowledgeAdminPage();

    expect(await screen.findAllByText('Showing 25 of 30 pages')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: /Open Page/ })).toHaveLength(25);

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));

    expect(await screen.findByText('Showing 30 of 30 pages')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /Open Page/ })).toHaveLength(30);
    });
  });

  it('shows subpages above the full-page editor without rendering the old tree panel', async () => {
    const categoryNode = tree.root.children[0];
    const pageNode = categoryNode?.children[0];
    const pageSummary = pageNode?.pageSummary;
    if (categoryNode === undefined || pageNode === undefined || pageSummary === undefined) {
      throw new Error('Expected page node fixture.');
    }

    mocks.listKnowledgeTree.mockResolvedValue({
      ...tree,
      root: {
        ...tree.root,
        children: [
          {
            ...categoryNode,
            children: [
              {
                ...pageNode,
                children: [
                  {
                    ...pageNode,
                    id: 'page-node-child-1',
                    title: 'Winter pellets',
                    slug: 'winter-pellets',
                    parentId: 'page-node-1',
                    pageId: 'page-child-1',
                    depth: 3 as const,
                    sortIndex: 0,
                    path: ['Knowledge Base', 'Method Feeder', 'Pellet choices', 'Winter pellets'],
                    pageSummary: {
                      ...pageSummary,
                      source: {
                        type: 'external' as const,
                        url: 'https://source.example/winter-pellets',
                        label: 'Source',
                      },
                    },
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    await renderKnowledgeAdminPage({ selectedPageId: 'page-1' });

    expect(await screen.findByRole('heading', { level: 2, name: 'Edit Page' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 3, name: 'Subpages' })).toBeVisible();
    expect(screen.getByText('This page has 1 subpages.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Winter pellets' })).toHaveAttribute(
      'href',
      '#/admin/knowledge/page-child-1'
    );
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('marks unsaved page editor changes and registers a navigation guard', async () => {
    const guardUpdates: (AdminNavigationGuardState | null)[] = [];
    await renderKnowledgeAdminPage(
      { selectedPageId: 'page-1' },
      {
        onGuardChange: (guard) => {
          guardUpdates.push(guard);
        },
      }
    );

    fireEvent.change(await screen.findByLabelText('Page title'), {
      target: { value: 'Pellet choices QA UNSAVED' },
    });

    const dirtyStatus = screen.getByRole('status', { name: 'Unsaved page edits' });
    expect(dirtyStatus).not.toBeNull();
    expect(within(dirtyStatus).getByText('Changed fields: Page title')).not.toBeNull();
    expect(within(dirtyStatus).getByRole('button', { name: 'Save page edits' })).not.toBeDisabled();
    await waitFor(() => {
      expect(guardUpdates.at(-1)).toMatchObject({
        isDirty: true,
        confirmMessage: 'You have unsaved Knowledge page edits. Leave without saving?',
      });
    });

    const event = new Event('beforeunload', { cancelable: true });

    expect(window.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('surfaces saved unpublished page changes and publishes the selected page', async () => {
    const savedUnpublishedPage = {
      ...page,
      title: 'Pellet choices updated',
      markdown: '# Pellet choices\n\nUse soaked pellets and micro pellets.',
      syncStatus: 'sync_required' as const,
      indexingStatus: 'pending' as const,
      accessSyncStatus: 'stale' as const,
    };
    mocks.saveKnowledgePage.mockResolvedValueOnce(savedUnpublishedPage);

    await renderKnowledgeAdminPage({ selectedPageId: 'page-1' });

    fireEvent.change(await screen.findByLabelText('Page title'), {
      target: { value: 'Pellet choices updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByRole('status', {
        name: 'Saved unpublished assistant version',
      })
    ).toBeInTheDocument();
    expect(screen.getByText('Saved. The assistant is not using this version yet.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Publish page' }));

    await waitFor(() => {
      expect(mocks.syncKnowledgePage).toHaveBeenCalledWith('page-1');
    });
  });

  it('warns when leaving a saved but unpublished page without replacing the unsaved warning', async () => {
    const guardUpdates: (AdminNavigationGuardState | null)[] = [];
    await renderKnowledgeAdminPage(
      { selectedPageId: 'page-1' },
      {
        onGuardChange: (guard) => {
          guardUpdates.push(guard);
        },
      }
    );

    await waitFor(() => {
      expect(guardUpdates.at(-1)).toMatchObject({
        isDirty: true,
        confirmMessage:
          'This page is saved, but the assistant is still using the previous version.',
      });
    });

    fireEvent.change(await screen.findByLabelText('Page title'), {
      target: { value: 'Pellet choices QA UNSAVED' },
    });

    await waitFor(() => {
      expect(guardUpdates.at(-1)).toMatchObject({
        isDirty: true,
        confirmMessage: 'You have unsaved Knowledge page edits. Leave without saving?',
      });
    });
  });

  it('localizes the compact page list count in Polish', async () => {
    window.localStorage.setItem('fa.locale', 'pl');

    await renderKnowledgeAdminPage();

    expect(await screen.findByRole('table', { name: 'Strony' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pellet choices' })).toBeInTheDocument();
    expect(screen.getByText('Pokazano 1 z 1 stron')).toBeInTheDocument();
    expect(screen.queryByText('Showing 1 of 1 pages')).toBeNull();
  });

  it('uses Polish copy across the Knowledge page list, editor, and create sheet', async () => {
    window.localStorage.setItem('fa.locale', 'pl');

    await renderKnowledgeAdminPage({ selectedPageId: 'page-1' });

    expect(await screen.findByRole('heading', { level: 2, name: 'Baza Wiedzy' })).not.toBeNull();
    expect(
      screen.getByText('Edytuj treść i publikuj zmiany, żeby asystent używał ich w odpowiedziach.')
    ).toBeInTheDocument();
    expect(screen.getByText('1 nieopublikowana zmiana')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Opublikuj zmiany dla asystenta' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Edytuj stronę' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Akcje strony' })).toBeInTheDocument();
    expect(screen.getByLabelText('Wybrana strona wiedzy')).toBeInTheDocument();
    expect(screen.getByLabelText('Status treści asystenta')).toBeInTheDocument();
    expect(screen.getByLabelText('Status wybranej strony')).toBeInTheDocument();
    expect(screen.getByText('Dostęp: Wszyscy')).toBeInTheDocument();
    expect(screen.getByLabelText('Tytuł strony')).toBeInTheDocument();
    expect(screen.getByLabelText('Kategoria')).toBeInTheDocument();
    expect(screen.getByLabelText('Sekcja')).toBeInTheDocument();
    expect(screen.getByLabelText('Link źródłowy')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Szczegóły strony' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Markdown' })).toBeInTheDocument();
    expect(screen.getByTestId('knowledge-rich-markdown-editor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zapisz zmiany' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Akcje strony' }));
    expect(
      screen.getByRole('menuitem', { name: 'Opublikuj stronę Pellet choices' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Zindeksuj ponownie Pellet choices' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Usuń stronę Pellet choices' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dodaj' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Strona' }));

    expect(window.location.hash).toBe('#/admin/knowledge/new');

    cleanup();
    await renderKnowledgeAdminPage({ selectedPageId: 'new' });

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Nowa strona' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Dodaj stronę' })).toBeNull();
    expect(screen.getByLabelText('Tytuł strony')).toBeInTheDocument();
    expect(screen.getByLabelText('Kategoria')).toBeInTheDocument();
    expect(screen.getByLabelText('Sekcja')).toBeInTheDocument();
    expect(screen.getByLabelText('Link źródłowy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Utwórz szkic strony' })).toBeDisabled();
    expect(screen.queryByText('New Page')).toBeNull();
    expect(screen.queryByText('Create page')).toBeNull();

    expect(
      screen.queryByText(
        'Edit content, then publish changes so the assistant uses them in answers.'
      )
    ).toBeNull();
    expect(screen.queryByText('Knowledge Base')).toBeNull();
    expect(screen.queryByText('Page actions')).toBeNull();
    expect(screen.queryByText('Page details')).toBeNull();
    expect(screen.queryByText('Save page')).toBeNull();
  });

  it('filters compact Knowledge pages by top-level category only', async () => {
    const categoryNode = tree.root.children[0];
    const pageNode = categoryNode?.children[0];
    const pageSummary = pageNode?.pageSummary;
    if (categoryNode === undefined || pageNode === undefined || pageSummary === undefined) {
      throw new Error('Expected page node fixture.');
    }
    mocks.listKnowledgeTree.mockResolvedValue({
      ...tree,
      root: {
        ...tree.root,
        children: [
          categoryNode,
          {
            ...categoryNode,
            id: 'category-2',
            title: 'Spinning',
            slug: 'spinning',
            categoryId: 'category-2',
            sortIndex: 1,
            path: ['Knowledge Base', 'Spinning'],
            accessRevision: 'category-rev-2',
            children: [
              {
                ...pageNode,
                id: 'page-node-2',
                title: 'Spinner sizes',
                slug: 'spinner-sizes',
                parentId: 'category-2',
                categoryId: 'category-2',
                pageId: 'page-2',
                path: ['Knowledge Base', 'Spinning', 'Spinner sizes'],
                pageSummary: {
                  ...pageSummary,
                  source: {
                    type: 'external' as const,
                    url: 'https://source.example/spinner-sizes',
                    label: 'Source',
                  },
                },
                children: [],
              },
            ],
          },
        ],
      },
    });

    await renderKnowledgeAdminPage();

    expect(await screen.findByRole('link', { name: 'Pellet choices' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Spinner sizes' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: 'category-2' },
    });

    expect(screen.getByRole('link', { name: 'Spinner sizes' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Pellet choices' })).toBeNull();
    expect(screen.getByText('Showing 1 of 1 pages')).toBeInTheDocument();
  });

  it('keeps create forms hidden until the admin chooses an add action', async () => {
    await renderKnowledgeAdminPage();

    expect(await screen.findByRole('heading', { name: 'Knowledge Base' })).not.toBeNull();
    expect(screen.queryByLabelText('Category title')).toBeNull();
    expect(screen.queryByLabelText('Page title')).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Category' }));

    const dialog = screen.getByRole('dialog', { name: 'Add category' });
    expect(dialog).not.toBeNull();
    expect(within(dialog).getByLabelText('Category title')).not.toBeNull();
  });

  it('describes assistant readiness without exposing service implementation details', async () => {
    await renderKnowledgeAdminPage({ selectedPageId: 'page-1' });

    expect(await screen.findByLabelText('Assistant content status')).not.toBeNull();
    expect(
      screen.getAllByText('Saved. The assistant is not using this version yet.').length
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/microservice/i)).toBeNull();
    expect(screen.queryByText(/chunk/i)).toBeNull();
    expect(screen.queryByText(/Firestore/i)).toBeNull();
  });

  it('creates a first category from an empty knowledge tree', async () => {
    mocks.listKnowledgeTree.mockResolvedValue(emptyTree);

    await renderKnowledgeAdminPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Category' }));

    const dialog = await screen.findByRole('dialog', { name: 'Add category' });
    fireEvent.change(within(dialog).getByLabelText('Category title'), {
      target: { value: '  Synthetic fixture  ' },
    });
    fireEvent.change(within(dialog).getByLabelText('Category access'), {
      target: { value: 'level' },
    });
    fireEvent.change(within(dialog).getByLabelText('Category required tier'), {
      target: { value: '4' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create category' }));

    await waitFor(() => {
      expect(mocks.createKnowledgeCategory).toHaveBeenCalledWith({
        title: 'Synthetic fixture',
        access: { gate: 'level', requiredLevel: 4 },
      });
    });
    expect(mocks.listKnowledgeTree).toHaveBeenCalledTimes(2);
  });

  it('creates a section under an existing category', async () => {
    await renderKnowledgeAdminPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Section' }));

    const dialog = await screen.findByRole('dialog', { name: 'Add section' });
    fireEvent.change(within(dialog).getByLabelText('Section category'), {
      target: { value: 'category-1' },
    });
    fireEvent.change(within(dialog).getByLabelText('Section title'), {
      target: { value: '  Sekcja testowa  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create section' }));

    await waitFor(() => {
      expect(mocks.createKnowledgeSection).toHaveBeenCalledWith('category-1', {
        title: 'Sekcja testowa',
      });
    });
    expect(mocks.listKnowledgeTree).toHaveBeenCalledTimes(2);
  });

  it('keeps a routed page in a loading state until the page record resolves', async () => {
    const deferred = createDeferred<typeof page>();
    mocks.getKnowledgePage.mockReturnValueOnce(deferred.promise);

    await renderKnowledgeAdminPage({ selectedPageId: 'page-1' });

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Loading page' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Pages' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'New Page' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Edit Page' })).toBeNull();

    await act(async () => {
      deferred.resolve(page);
      await deferred.promise;
    });

    expect(await screen.findByRole('heading', { level: 2, name: 'Edit Page' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pellet choices')).toBeInTheDocument();
  });

  it('moves mobile routed page views to the selected page editor after loading', async () => {
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView'
    );
    const originalFocus = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'focus');
    const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    Object.defineProperty(HTMLElement.prototype, 'focus', {
      configurable: true,
      value: focus,
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        media: '(max-width: 860px)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });

    try {
      await renderKnowledgeAdminPage({ selectedPageId: 'page-1' });

      expect(await screen.findByRole('heading', { level: 2, name: 'Edit Page' })).toBeVisible();
      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
      });
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    } finally {
      if (originalScrollIntoView === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
      } else {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
      }
      if (originalFocus === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, 'focus');
      } else {
        Object.defineProperty(HTMLElement.prototype, 'focus', originalFocus);
      }
      if (originalMatchMedia === undefined) {
        Reflect.deleteProperty(window, 'matchMedia');
      } else {
        Object.defineProperty(window, 'matchMedia', originalMatchMedia);
      }
    }
  });

  it('keeps mobile knowledge page list and editor controls readable and at least 44px tall', () => {
    const styles = readWebStyles();

    expect(styles).toMatch(/\.knowledge-page-table-heading\s*{[^}]*min-height:\s*44px/s);
    expect(styles).toMatch(/\.knowledge-page-row\s*{[^}]*min-height:\s*78px/s);
    expect(styles).toMatch(/\.knowledge-page-open\s*{[^}]*min-height:\s*42px/s);
    expect(styles).toMatch(/\.knowledge-rich-editor \.w-md-editor\s*{[^}]*min-height:\s*560px/s);
    expect(styles).toMatch(
      /\.category-access-editor select,\s*\.category-access-editor input,\s*\.knowledge-structure-form input,\s*\.knowledge-structure-form select,\s*\.knowledge-editor-form input,\s*\.knowledge-editor-form select,\s*\.knowledge-editor-form textarea\s*{[^}]*min-height:\s*44px/s
    );
    expect(styles).toMatch(/\.icon-button-label,\s*\.upload-control\s*{[^}]*min-height:\s*44px/s);
    expect(styles).toMatch(/\.fa-detail-sheet-header button\s*{[^}]*min-height:\s*44px/s);
    expect(styles).toMatch(
      /@media \(max-width: 760px\)\s*{[\s\S]*\.knowledge-page-row\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
    );
  });

  it('uses a compact list first and gives the routed editor the full page width', () => {
    const styles = readWebStyles();

    expect(styles).toMatch(/\.admin-knowledge-grid\.knowledge-list-grid\s*{[^}]*display:\s*block/s);
    expect(styles).toMatch(
      /\.admin-knowledge-grid\.knowledge-editor-grid\s*{[^}]*display:\s*block/s
    );
    expect(styles).toMatch(
      /\.knowledge-editor-grid \.knowledge-editor-region,\s*\.knowledge-editor-grid \.knowledge-editor-panel\s*{[^}]*width:\s*100%/s
    );
  });

  it('aligns the routed page editor header with the status and form content', () => {
    const styles = readWebStyles();

    expect(styles).toMatch(
      /\.knowledge-editor-panel\s*{[^}]*--knowledge-editor-panel-gutter:\s*clamp\(16px,\s*2vw,\s*24px\)/s
    );
    expect(styles).toMatch(
      /\.knowledge-editor-panel > \.panel-header\s*{[^}]*padding:\s*clamp\(18px,\s*2\.4vw,\s*24px\)\s+var\(--knowledge-editor-panel-gutter\)\s+10px/s
    );
    expect(styles).toMatch(
      /\.knowledge-editor-readiness\s*{[^}]*padding:\s*0\s+var\(--knowledge-editor-panel-gutter\)/s
    );
    expect(styles).toMatch(
      /\.knowledge-editor-form\s*{[^}]*padding:\s*10px\s+var\(--knowledge-editor-panel-gutter\)\s+var\(--knowledge-editor-panel-gutter\)/s
    );
  });

  it('hides the previous page editor during a page-to-page route transition', async () => {
    const { KnowledgeAdminPage } = (await import(knowledgeAdminPageModulePath)) as {
      KnowledgeAdminPage: ComponentType<{ selectedPageId?: string | undefined }>;
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      flushSync(() => {
        root.render(
          createElement(
            I18nProvider,
            null,
            createElement(KnowledgeAdminPage, { selectedPageId: 'page-1' })
          )
        );
      });

      expect(await screen.findByDisplayValue('Pellet choices')).toBeInTheDocument();

      const deferred = createDeferred<typeof pageTwo>();
      mocks.getKnowledgePage.mockReturnValueOnce(deferred.promise);

      flushSync(() => {
        root.render(
          createElement(
            I18nProvider,
            null,
            createElement(KnowledgeAdminPage, { selectedPageId: 'page-2' })
          )
        );
      });

      expect(screen.queryByDisplayValue('Pellet choices')).toBeNull();
      expect(screen.getByRole('heading', { level: 2, name: 'Loading page' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 2, name: 'Edit Page' })).toBeNull();

      await act(async () => {
        deferred.resolve(pageTwo);
        await deferred.promise;
      });

      expect(
        await screen.findByRole('heading', { level: 2, name: 'Edit Page' })
      ).toBeInTheDocument();
      expect(screen.getByDisplayValue('Hook sizes')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('Pellet choices')).toBeNull();
    } finally {
      root.unmount();
      container.remove();
    }
  });

  it('clears the selected page editor when a routed page fails to load', async () => {
    const view = await renderKnowledgeAdminPage({ selectedPageId: 'page-1' });

    expect(await screen.findByDisplayValue('Pellet choices')).not.toBeNull();

    const { KnowledgeAdminPage } = (await import(knowledgeAdminPageModulePath)) as {
      KnowledgeAdminPage: ComponentType<{ selectedPageId?: string | undefined }>;
    };
    mocks.getKnowledgePage.mockRejectedValueOnce(new Error('Page unavailable.'));
    view.rerender(
      createElement(
        I18nProvider,
        null,
        createElement(KnowledgeAdminPage, { selectedPageId: 'missing-page' })
      )
    );

    expect(await screen.findByText('Page unavailable.')).not.toBeNull();
    expect(screen.queryByDisplayValue('Pellet choices')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Page actions' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'New Page' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Page unavailable' })).toBeInTheDocument();
  });

  it('keeps the knowledge shell visible when a cold deep-linked page is missing', async () => {
    mocks.getKnowledgePage.mockRejectedValueOnce(
      new ApiClientError('API request failed with status 404.', 404)
    );

    await renderKnowledgeAdminPage({ selectedPageId: 'missing-page' });

    expect((await screen.findAllByText('Page unavailable')).length).toBeGreaterThan(0);
    const recovery = screen.getByRole('region', { name: 'Missing Knowledge page recovery' });
    const pageTable = document.querySelector('.knowledge-page-table');
    if (!(pageTable instanceof HTMLElement)) {
      throw new Error('Expected the Knowledge page list to render.');
    }

    expect(recovery.compareDocumentPosition(pageTable) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(within(recovery).getByRole('link', { name: 'Back to Knowledge Base' })).toHaveAttribute(
      'href',
      '#/admin/knowledge'
    );
    expect(screen.queryByLabelText('Assistant content status')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open Pellet choices' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'New Page' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Page unavailable' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Page actions' })).toBeNull();
  });

  it('surfaces access refresh state and selected-page sync errors', async () => {
    const categoryNode = tree.root.children.at(0);
    const pageNode = categoryNode?.children.at(0);
    const pageSummary = pageNode?.pageSummary;
    if (categoryNode === undefined || pageNode === undefined || pageSummary === undefined) {
      throw new Error('Expected page node fixture.');
    }

    const failedTree = {
      ...tree,
      accessRefresh: {
        pendingJobs: 1,
        runningJobs: 2,
        failedJobs: 3,
        staleChunkCount: 4,
        mismatchCount: 5,
      },
      root: {
        ...tree.root,
        children: [
          {
            ...categoryNode,
            children: [
              {
                ...pageNode,
                pageSummary: {
                  ...pageSummary,
                  indexingStatus: 'ready' as const,
                  syncStatus: 'synced' as const,
                  accessSyncStatus: 'failed' as const,
                },
              },
            ],
          },
        ],
      },
    };
    mocks.listKnowledgeTree.mockResolvedValue(failedTree);
    mocks.getKnowledgePage.mockResolvedValue({
      ...page,
      access: {
        ...page.access,
        effective: { ...page.access.effective, retrievalReady: false },
      },
      indexingStatus: 'failed',
      syncStatus: 'failed',
      accessSyncStatus: 'failed',
      indexingError: 'Embedding failed.',
      syncError: 'Sync failed.',
      accessSyncError: 'Access chunks are stale.',
    });

    await renderKnowledgeAdminPage({ selectedPageId: 'page-1' });

    expect(await screen.findByText('Assistant materials need attention')).toBeInTheDocument();
    expect(screen.queryByText('1 unpublished change')).toBeNull();
    expect(screen.getAllByText('Needs attention').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Indexing error: Embedding failed.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sync error: Sync failed.').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('Access sync error: Access chunks are stale.').length
    ).toBeGreaterThan(0);
  });

  it('creates pages without workspace or page-level access fields', async () => {
    await renderKnowledgeAdminPage({ selectedPageId: 'new' });

    expect(screen.queryByRole('button', { name: 'Create page' })).toBeNull();
    expect(await screen.findByRole('heading', { level: 2, name: 'New Page' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Add page' })).toBeNull();

    const createPageDraftButton = screen.getByRole('button', { name: 'Create page draft' });
    expect(createPageDraftButton).toBeDisabled();
    expect(createPageDraftButton.querySelector('svg.lucide-file-plus2')).not.toBeNull();
    expect(
      screen.getByText('Complete the title, content, category, and source link.')
    ).toBeVisible();

    fireEvent.change(screen.getByLabelText('Page title'), {
      target: { value: 'Groundbait notes' },
    });
    expect(screen.getByRole('button', { name: 'Create page draft' })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown' }), {
      target: { value: '# Groundbait notes\n\nKeep it dark.' },
    });
    expect(screen.getByRole('button', { name: 'Create page draft' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Source link'), {
      target: { value: 'https://source.example/groundbait-notes' },
    });
    expect(screen.getByRole('button', { name: 'Create page draft' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create page draft' }));

    await waitFor(() => {
      expect(mocks.createKnowledgePage).toHaveBeenCalledWith({
        categoryId: 'category-1',
        sectionId: null,
        title: 'Groundbait notes',
        source: {
          type: 'external',
          url: 'https://source.example/groundbait-notes',
          label: null,
        },
        relations: { relatedTo: [], linksTo: [], supersedes: [] },
        markdown: '# Groundbait notes\n\nKeep it dark.',
      });
    });
    expect(JSON.stringify(mocks.createKnowledgePage.mock.calls[0]?.[0])).not.toContain(
      'workspaceId'
    );
    expect(JSON.stringify(mocks.createKnowledgePage.mock.calls[0]?.[0])).not.toContain('access');
  });

  it('navigates add page to the full-page create editor', async () => {
    await renderKnowledgeAdminPage();
    window.history.replaceState(null, '', '/#/admin/knowledge');

    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Page' }));

    expect(window.location.hash).toBe('#/admin/knowledge/new');
    expect(mocks.getKnowledgePage).not.toHaveBeenCalledWith('new');
  });

  it('keeps the mobile create-page editor full-width instead of modal-only', async () => {
    await renderKnowledgeAdminPage({ selectedPageId: 'new' });

    expect(await screen.findByRole('heading', { level: 2, name: 'New Page' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Add page' })).toBeNull();
    expect(screen.getByLabelText('Page title')).toBeInTheDocument();

    const styles = readWebStyles();
    expect(
      /@media \(max-width: 760px\)\s*{[\s\S]*\.knowledge-header-actions\s*{[^}]*width:\s*100%/s.test(
        styles
      )
    ).toBe(true);
    expect(
      /@media \(max-width: 760px\)\s*{[\s\S]*\.knowledge-editor-required-fields,[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s.test(
        styles
      )
    ).toBe(true);
  });

  it('creates pages with selected sections, source metadata, and split relations', async () => {
    mocks.listKnowledgeTree.mockResolvedValue(treeWithSections);
    await renderKnowledgeAdminPage({ selectedPageId: 'new' });

    expect(await screen.findByRole('heading', { level: 3, name: 'Source material' })).toBeVisible();
    expect(screen.getByText('Helps describe the source material in administration.')).toBeVisible();
    expect(screen.queryByText('Relationships')).toBeNull();
    expect(screen.queryByLabelText('Links to')).toBeNull();
    fireEvent.change(screen.getByLabelText('Page title'), {
      target: { value: '  Hook sizes  ' },
    });
    fireEvent.change(screen.getByLabelText('Section'), {
      target: { value: 'section-1' },
    });
    fireEvent.change(screen.getByLabelText('Source link'), {
      target: { value: '  https://example.com/hooks  ' },
    });
    fireEvent.change(screen.getByLabelText('Source name'), {
      target: { value: '  Hook reference  ' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown' }), {
      target: { value: '# Hook sizes' },
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Create page draft' }));
    });

    await waitFor(() => {
      expect(mocks.createKnowledgePage).toHaveBeenCalledWith({
        categoryId: 'category-1',
        sectionId: 'section-1',
        title: 'Hook sizes',
        source: {
          type: 'external',
          url: 'https://example.com/hooks',
          label: 'Hook reference',
        },
        relations: { relatedTo: [], linksTo: [], supersedes: [] },
        markdown: '# Hook sizes',
      });
    });
  });

  it('locks the category selector for existing pages while allowing section edits', async () => {
    await renderKnowledgeAdminPage({ selectedPageId: 'page-1' });

    expect(await screen.findByDisplayValue('Pellet choices')).not.toBeNull();
    const category = await screen.findByLabelText('Category');
    expect(category).toBeDisabled();

    const form = category.closest('form');
    expect(form).not.toBeNull();
    if (form === null) {
      throw new Error('Expected page editor form');
    }
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mocks.saveKnowledgePage).toHaveBeenCalledWith(
        'page-1',
        expect.objectContaining({
          sectionId: null,
          title: 'Pellet choices',
        })
      );
    });
    expect(JSON.stringify(mocks.saveKnowledgePage.mock.calls[0]?.[1])).not.toContain('categoryId');
  });

  it('saves existing page source metadata while preserving hidden relations', async () => {
    mocks.getKnowledgePage.mockResolvedValue(pageWithRelations);
    await renderKnowledgeAdminPage({ selectedPageId: 'page-1' });

    expect(await screen.findByDisplayValue('https://example.com/pellets')).not.toBeNull();
    expect(screen.queryByLabelText('Links to')).toBeNull();
    expect(screen.queryByText('Relationships')).toBeNull();

    fireEvent.change(screen.getByLabelText('Source link'), {
      target: { value: '  https://example.com/updated  ' },
    });
    fireEvent.change(screen.getByLabelText('Source name'), {
      target: { value: '  Updated label  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mocks.saveKnowledgePage).toHaveBeenCalledWith('page-1', {
        title: 'Pellet choices',
        sectionId: null,
        source: {
          type: 'external',
          url: 'https://example.com/updated',
          label: 'Updated label',
        },
        relations: {
          relatedTo: ['page-related'],
          linksTo: ['page-link-a'],
          supersedes: ['page-old'],
        },
        markdown: '# Pellet choices\n\nUpdated source notes.',
      });
    });
  });

  it('keeps the page save action reachable before long optional editor sections on mobile', async () => {
    await renderKnowledgeAdminPage({ selectedPageId: 'page-1' });

    const markdownField = await screen.findByRole('textbox', { name: 'Markdown' });
    const saveButton = screen.getByRole('button', { name: 'Save changes' });
    const sourceSection = screen.getByRole('heading', { level: 3, name: 'Source material' });

    expect(
      markdownField.compareDocumentPosition(saveButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      saveButton.compareDocumentPosition(sourceSection) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByText('Relationships')).toBeNull();

    const styles = readWebStyles();
    expect(
      /\.knowledge-editor-sticky-actions\s*{[^}]*position:\s*sticky[^}]*bottom:\s*calc\(8px \+ var\(--fa-safe-bottom\)\)/s.test(
        styles
      )
    ).toBe(true);
  });

  it('renders an accessible rich Markdown editor with live preview mode', async () => {
    mocks.getKnowledgePage.mockResolvedValue({
      ...page,
      markdown: '# Pellet choices\n\nUse **soaked** pellets.\n\n- Fish small.',
    });
    await renderKnowledgeAdminPage({ selectedPageId: 'page-1' });

    expect(await screen.findByRole('heading', { level: 3, name: 'Markdown' })).toBeVisible();
    expect(screen.getByTestId('knowledge-rich-markdown-editor')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Markdown' })).toBeVisible();

    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown' }), {
      target: { value: '# Updated preview\n\nFresh notes.' },
    });

    expect(screen.getByRole('textbox', { name: 'Markdown' })).toHaveValue(
      '# Updated preview\n\nFresh notes.'
    );
  });

  it('syncs, reindexes, and deletes the selected page while refreshing the tree', async () => {
    const syncedPage = {
      ...page,
      syncStatus: 'synced' as const,
      indexingStatus: 'ready' as const,
      chunkCount: 2,
    };
    const reindexedPage = {
      ...syncedPage,
      updatedAt: '2026-06-14T12:30:00.000Z',
      chunkCount: 3,
    };
    mocks.syncKnowledgePage.mockResolvedValueOnce({ page: syncedPage, syncedChunkCount: 2 });
    mocks.reindexKnowledgePage.mockResolvedValueOnce({
      page: reindexedPage,
      replacedChunkCount: 3,
    });

    await renderKnowledgeAdminPage({ selectedPageId: 'page-1' });

    expect(await screen.findByRole('button', { name: 'Page actions' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Publish page Pellet choices' }));

    await waitFor(() => {
      expect(mocks.syncKnowledgePage).toHaveBeenCalledWith('page-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reindex page Pellet choices' }));

    await waitFor(() => {
      expect(mocks.reindexKnowledgePage).toHaveBeenCalledWith('page-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete page Pellet choices' }));

    expect(mocks.deleteKnowledgePage).not.toHaveBeenCalled();
    const deleteDialog = await screen.findByRole('dialog', { name: 'Delete knowledge page?' });
    expect(within(deleteDialog).getByText('Pellet choices')).not.toBeNull();
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mocks.deleteKnowledgePage).toHaveBeenCalledWith('page-1');
      expect(window.location.hash).toBe('#/admin/knowledge');
    });
    expect(mocks.listKnowledgeTree).toHaveBeenCalled();
  });

  it('marks the admin grid busy while syncing changed knowledge and then reloads', async () => {
    const deferred = createDeferred<{
      synced: number;
      failed: number;
      skipped: number;
      queuedAccessRefreshJobs: number;
    }>();
    mocks.syncAdminKnowledgeBase.mockReturnValueOnce(deferred.promise);
    const view = await renderKnowledgeAdminPage();

    const publishAssistantButton = await screen.findByRole('button', {
      name: 'Publish changes for assistant',
    });
    expect(publishAssistantButton).not.toBeDisabled();
    expect(publishAssistantButton.querySelector('svg.lucide-cloud-upload')).not.toBeNull();
    expect(
      screen.getByText('Publishes saved Knowledge Base changes so future answers use them.')
    ).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Publish changes for assistant' }));

    expect(mocks.syncAdminKnowledgeBase).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', {
      name: 'Publish saved changes for assistant?',
    });
    expect(within(dialog).getByText('Pages to publish: 1')).not.toBeNull();
    expect(within(dialog).getByText('Queued access jobs: 0')).not.toBeNull();
    expect(
      within(dialog).getByText('Publishing may take from a few seconds to a few minutes.')
    ).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish all' }));

    await waitFor(() => {
      expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Publish changes for assistant' })).toBeDisabled();
      expect(screen.getByText('Publishing saved changes for the assistant.')).not.toBeNull();
    });

    await act(async () => {
      deferred.resolve({ synced: 1, failed: 0, skipped: 0, queuedAccessRefreshJobs: 1 });
      await deferred.promise;
    });

    await waitFor(() => {
      expect(mocks.syncAdminKnowledgeBase).toHaveBeenCalledWith({ mode: 'changed' });
      expect(view.container.querySelector('[aria-busy="false"]')).not.toBeNull();
      expect(
        screen.getByText('Last publish: published 1, skipped 0, errors 0, access jobs 1.')
      ).not.toBeNull();
    });
  });

  it('refreshes the selected page after syncing the whole knowledge base', async () => {
    const refreshedPage = {
      ...page,
      syncStatus: 'synced' as const,
      indexingStatus: 'ready' as const,
      accessSyncStatus: 'current' as const,
      chunkCount: 3,
    };
    mocks.getKnowledgePage.mockResolvedValueOnce(page);
    mocks.getKnowledgePage.mockResolvedValueOnce(refreshedPage);

    await renderKnowledgeAdminPage({ selectedPageId: 'page-1' });

    expect(await screen.findByText('1 unpublished change')).toBeInTheDocument();
    expect(
      screen.getAllByText('Saved. The assistant is not using this version yet.').length
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Publish changes for assistant' }));
    const syncDialog = await screen.findByRole('dialog', {
      name: 'Publish saved changes for assistant?',
    });
    fireEvent.click(within(syncDialog).getByRole('button', { name: 'Publish all' }));

    await waitFor(() => {
      expect(mocks.getKnowledgePage).toHaveBeenCalledTimes(2);
      expect(
        within(screen.getByLabelText('Selected page status')).getByText('Current')
      ).toBeVisible();
      expect(screen.queryByText(/chunk/i)).toBeNull();
    });
  });

  it('flags adjacent duplicate source lines before treating a page as answer-ready', async () => {
    mocks.getKnowledgePage.mockResolvedValueOnce({
      ...page,
      markdown: [
        '# Duplicate fixture heading',
        '',
        'Zadawaj pytania.',
        'Zadawaj pytania.',
        'Repeated fixture line.',
        'Repeated fixture line.',
      ].join('\n'),
      syncStatus: 'synced' as const,
      indexingStatus: 'ready' as const,
      accessSyncStatus: 'current' as const,
      chunkCount: 4,
    });

    await renderKnowledgeAdminPage({ selectedPageId: 'page-1' });

    expect(await screen.findByText('Content check needs attention')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The automatic check found repeated neighboring fragments. Repetition can reduce answer quality, so remove one copy before publishing.'
      )
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Zadawaj pytania\./).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Needs attention').length).toBeGreaterThanOrEqual(1);
    const selectedStatus = screen.getByLabelText('Selected page status');
    expect(within(selectedStatus).queryByText('Current')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    expect(screen.getByRole('menuitem', { name: 'Publish page Pellet choices' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Reindex page Pellet choices' })).toBeDisabled();
    expect(
      screen.getAllByText('Resolve the content check before publishing or reindexing.').length
    ).toBeGreaterThanOrEqual(1);
    expect(readWebStyles()).not.toMatch(
      /\.knowledge-content-warning\s*{[\s\S]*background:\s*#332814/s
    );
  });

  it('persists intentional duplicate acknowledgements and invalidates them after markdown edits', async () => {
    const duplicateMarkdown = [
      '# Duplicate fixture heading',
      '',
      'Zadawaj pytania.',
      'Zadawaj pytania.',
    ].join('\n');
    const duplicatePage = {
      ...page,
      markdown: duplicateMarkdown,
      markdownContentHash: 'duplicate-hash-1',
      syncStatus: 'synced' as const,
      indexingStatus: 'ready' as const,
      accessSyncStatus: 'current' as const,
      chunkCount: 4,
    };
    const acknowledgedPage = {
      ...duplicatePage,
      contentQualityAcknowledgements: [
        {
          issueType: 'adjacent_duplicate_content' as const,
          markdownContentHash: 'duplicate-hash-1',
          issueFingerprints: ['Zadawaj pytania.\u00003\u00004'],
          reason: 'This exact CTA is repeated intentionally.',
          acknowledgedAt: '2026-06-14T12:00:00.000Z',
          acknowledgedByUserId: 'admin-user-1',
        },
      ],
    };
    mocks.getKnowledgePage.mockResolvedValueOnce(duplicatePage);
    mocks.acknowledgeKnowledgePageContentQuality.mockResolvedValueOnce({ page: acknowledgedPage });

    await renderKnowledgeAdminPage({ selectedPageId: 'page-1' });

    expect(await screen.findByText('Content check needs attention')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'This repetition is intentional' }));
    fireEvent.change(screen.getByLabelText('Explanation (optional)'), {
      target: { value: 'This exact CTA is repeated intentionally.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm intentional repetition' }));

    await waitFor(() => {
      expect(mocks.acknowledgeKnowledgePageContentQuality).toHaveBeenCalledWith('page-1', {
        issueType: 'adjacent_duplicate_content',
        markdownContentHash: 'duplicate-hash-1',
        issueFingerprints: ['Zadawaj pytania.\u00003\u00004'],
        reason: 'This exact CTA is repeated intentionally.',
      });
    });
    expect(
      await screen.findByText('Repetition marked as intentional for this version.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    expect(
      screen.getByRole('menuitem', { name: 'Publish page Pellet choices' })
    ).not.toBeDisabled();
    expect(
      screen.getByRole('menuitem', { name: 'Reindex page Pellet choices' })
    ).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Page actions' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown' }), {
      target: { value: `${duplicateMarkdown}\n\nFresh note.` },
    });

    expect(screen.queryByText('Repetition marked as intentional for this version.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    expect(screen.getByRole('menuitem', { name: 'Publish page Pellet choices' })).toBeDisabled();
  });

  it('renders load and action errors without losing the existing tree', async () => {
    mocks.listKnowledgeTree.mockRejectedValueOnce(new Error('Tree unavailable.'));

    await renderKnowledgeAdminPage();

    expect(await screen.findByText('Tree unavailable.')).not.toBeNull();

    mocks.listKnowledgeTree.mockReset();
    mocks.listKnowledgeTree.mockResolvedValue(tree);
    mocks.syncAdminKnowledgeBase.mockRejectedValueOnce('offline');
    await renderKnowledgeAdminPage();

    expect(
      await screen.findByRole('button', { name: 'Publish changes for assistant' })
    ).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Publish changes for assistant' }));
    const syncDialog = await screen.findByRole('dialog', {
      name: 'Publish saved changes for assistant?',
    });
    fireEvent.click(within(syncDialog).getByRole('button', { name: 'Publish all' }));

    await waitFor(() => {
      expect(screen.getByText('Knowledge Base action failed.')).not.toBeNull();
    });
  });
});
