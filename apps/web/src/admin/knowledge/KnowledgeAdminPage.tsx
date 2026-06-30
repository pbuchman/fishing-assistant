import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { BookOpen, FileText, FolderPlus, Plus, UploadCloud } from 'lucide-react';

import {
  acknowledgeKnowledgePageContentQuality,
  createKnowledgeCategory,
  createKnowledgeSection,
  createKnowledgePage,
  deleteKnowledgePage,
  getKnowledgePage,
  listKnowledgeTree,
  reindexKnowledgePage,
  saveKnowledgePage,
  syncAdminKnowledgeBase,
  syncKnowledgePage,
  updateKnowledgeCategoryAccess,
  type AdminKnowledgeBaseSyncResult,
  type AcknowledgeKnowledgePageContentQualityInput,
  type CreateKnowledgePageInput,
  type KnowledgeAccessInput,
  type KnowledgeAdminAccessGate,
  type KnowledgeAdminPage as KnowledgeAdminPageRecord,
  type KnowledgeAdminTreeNode,
  type KnowledgeAdminTreeResponse,
  type SaveKnowledgePageInput,
} from '../../services/knowledgeApi.js';
import { useI18n } from '../../i18n/useI18n.js';
import { ApiClientError } from '../../services/apiClient.js';
import { ActionMenu } from '../../ui/ActionMenu.js';
import { ConfirmDialog } from '../../ui/ConfirmDialog.js';
import { DetailSheet } from '../../ui/DetailSheet.js';
import { useAdminNavigationGuard } from '../navigationGuard.js';
import { KnowledgePageEditor, type KnowledgePageDraftSummary } from './KnowledgePageEditor.js';
import { KnowledgeCategorySettingsSheet } from './KnowledgeCategorySettingsSheet.js';
import { KnowledgePageList } from './KnowledgePageList.js';
import {
  filterKnowledgePagesByCategory,
  flattenKnowledgePages,
  knowledgeCategoryFilters,
} from './knowledgeListModel.js';

interface KnowledgeAdminPageProps {
  selectedPageId?: string | undefined;
}

const CREATE_PAGE_ROUTE_ID = 'new';
type KnowledgePublicationStatus = Pick<
  KnowledgeAdminPageRecord,
  'syncStatus' | 'indexingStatus' | 'accessSyncStatus'
>;

function KnowledgePageStatePanel({
  title,
  message,
}: {
  title: string;
  message: string;
}): ReactElement {
  return (
    <section className="knowledge-editor-panel" aria-labelledby="knowledge-editor-heading">
      <div className="panel-header">
        <div>
          <h2 id="knowledge-editor-heading">{title}</h2>
        </div>
      </div>
      <div className="knowledge-empty-editor">
        <p className="muted-copy">{message}</p>
      </div>
    </section>
  );
}

function KnowledgeMissingPageRecovery({ message }: { message: string }): ReactElement {
  const { messages } = useI18n();
  const copy = messages.app.adminKnowledge;

  return (
    <section aria-label={copy.missingPageRecovery} className="knowledge-editor-panel" role="region">
      <div className="panel-header">
        <div>
          <h2>{copy.pageUnavailable}</h2>
        </div>
      </div>
      <div className="knowledge-empty-editor">
        <p className="error-copy">{message}</p>
        <p className="muted-copy">{copy.missingPageMessage}</p>
        <div className="toolbar-actions">
          <a className="fa-secondary-button" href="#/admin/knowledge">
            {copy.backToKnowledgeBase}
          </a>
        </div>
      </div>
    </section>
  );
}

function navigateToAdminPage(pageId: string): void {
  window.history.pushState(null, '', `#/admin/knowledge/${encodeURIComponent(pageId)}`);
  window.dispatchEvent(new Event('hashchange'));
}

function assistantReadinessSummary(
  accessRefresh: KnowledgeAdminTreeResponse['accessRefresh'],
  copy: ReturnType<typeof useI18n>['messages']['app']['adminKnowledge']
): string {
  if (accessRefresh.failedJobs > 0 || accessRefresh.mismatchCount > 0) {
    return copy.assistantNeedsAttention;
  }

  if (
    accessRefresh.pendingJobs > 0 ||
    accessRefresh.runningJobs > 0 ||
    accessRefresh.staleChunkCount > 0
  ) {
    return copy.assistantUpdating;
  }

  return copy.assistantReady;
}

function countPagesForAssistantSync(node: KnowledgeAdminTreeNode): number {
  const pageNeedsSync =
    node.pageSummary !== null &&
    (node.pageSummary.syncStatus !== 'synced' ||
      node.pageSummary.indexingStatus !== 'ready' ||
      node.pageSummary.accessSyncStatus !== 'current');

  return (
    (pageNeedsSync ? 1 : 0) +
    node.children.reduce((count, child) => count + countPagesForAssistantSync(child), 0)
  );
}

function assistantSyncPreflight(tree: KnowledgeAdminTreeResponse): {
  changedPages: number;
  queuedAccessJobs: number;
} {
  return {
    changedPages: countPagesForAssistantSync(tree.root),
    queuedAccessJobs:
      tree.accessRefresh.pendingJobs +
      tree.accessRefresh.runningJobs +
      tree.accessRefresh.failedJobs +
      tree.accessRefresh.mismatchCount,
  };
}

function countPagesWithSavedUnpublishedChanges(node: KnowledgeAdminTreeNode): number {
  const pageHasUnpublishedChanges =
    node.pageSummary !== null && pageHasSavedUnpublishedChanges(node.pageSummary);

  return (
    (pageHasUnpublishedChanges ? 1 : 0) +
    node.children.reduce((count, child) => count + countPagesWithSavedUnpublishedChanges(child), 0)
  );
}

function formatUnpublishedChangeCount(
  count: number,
  copy: ReturnType<typeof useI18n>['messages']['app']['adminKnowledge']
): string {
  return (count === 1 ? copy.unpublishedChangeCountOne : copy.unpublishedChangeCountMany).replace(
    '{count}',
    String(count)
  );
}

function pageHasSavedUnpublishedChanges(page: KnowledgePublicationStatus): boolean {
  return (
    page.syncStatus === 'sync_required' ||
    page.indexingStatus === 'pending' ||
    page.accessSyncStatus === 'stale'
  );
}

function pageLoadErrorMessage(
  caught: unknown,
  copy: ReturnType<typeof useI18n>['messages']['app']['adminKnowledge']
): string {
  if (caught instanceof ApiClientError && caught.status === 404) {
    return copy.pageUnavailable;
  }

  return caught instanceof Error ? caught.message : copy.pageUnavailable;
}

function categoryOptions(root: KnowledgeAdminTreeNode): { id: string; title: string }[] {
  return root.children
    .filter((node) => node.type === 'category' && node.categoryId !== null)
    .map((node) => ({ id: node.categoryId ?? node.id, title: node.title }));
}

function accessInput(gate: KnowledgeAdminAccessGate, requiredLevel: number): KnowledgeAccessInput {
  return {
    gate,
    requiredLevel: gate === 'level' ? requiredLevel : null,
  };
}

function shouldAutoRevealKnowledgeEditor(): boolean {
  if (typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(max-width: 860px)').matches;
}

export function KnowledgeAdminPage({ selectedPageId }: KnowledgeAdminPageProps): ReactElement {
  const { messages } = useI18n();
  const app = messages.app;
  const copy = messages.app.adminKnowledge;
  const [tree, setTree] = useState<KnowledgeAdminTreeResponse | null>(null);
  const [selectedPage, setSelectedPage] = useState<KnowledgeAdminPageRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assistantSyncOpen, setAssistantSyncOpen] = useState(false);
  const [assistantSyncResult, setAssistantSyncResult] =
    useState<AdminKnowledgeBaseSyncResult | null>(null);
  const [knowledgeAddMode, setKnowledgeAddMode] = useState<'category' | 'section' | null>(null);
  const [pagePendingDelete, setPagePendingDelete] = useState<KnowledgeAdminPageRecord | null>(null);
  const [categoryTitle, setCategoryTitle] = useState('');
  const [categoryAccessGate, setCategoryAccessGate] = useState<'approved' | 'level' | 'excluded'>(
    'approved'
  );
  const [categoryRequiredLevel, setCategoryRequiredLevel] = useState(1);
  const [sectionCategoryId, setSectionCategoryId] = useState('');
  const [sectionTitle, setSectionTitle] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [categorySettingsCategoryId, setCategorySettingsCategoryId] = useState<string | null>(null);
  const [pageDraftSummary, setPageDraftSummary] = useState<KnowledgePageDraftSummary>({
    isDirty: false,
    pageTitle: null,
    changedFields: [],
  });
  const editorRegionRef = useRef<HTMLDivElement | null>(null);
  const loadRequestIdRef = useRef(0);

  const reloadTree = useCallback(async (): Promise<KnowledgeAdminTreeResponse> => {
    const nextTree = await listKnowledgeTree();
    setTree(nextTree);
    return nextTree;
  }, []);

  useEffect(() => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    const isCurrentLoad = (): boolean => loadRequestIdRef.current === requestId;

    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      setSelectedPage(null);
      let nextTree: KnowledgeAdminTreeResponse;
      try {
        nextTree = await listKnowledgeTree();
        if (!isCurrentLoad()) {
          return;
        }
        setTree(nextTree);
      } catch (caught) {
        if (isCurrentLoad()) {
          setSelectedPage(null);
          setError(caught instanceof Error ? caught.message : 'Failed to load Knowledge Base.');
          setLoading(false);
        }
        return;
      }

      if (
        selectedPageId === undefined ||
        selectedPageId.length === 0 ||
        selectedPageId === CREATE_PAGE_ROUTE_ID
      ) {
        setLoading(false);
        return;
      }

      try {
        const nextPage = await getKnowledgePage(selectedPageId);
        if (!isCurrentLoad()) {
          return;
        }
        setSelectedPage(nextPage);
      } catch (caught) {
        if (isCurrentLoad()) {
          setSelectedPage(null);
          setError(pageLoadErrorMessage(caught, copy));
        }
      } finally {
        if (isCurrentLoad()) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      if (loadRequestIdRef.current === requestId) {
        loadRequestIdRef.current += 1;
      }
    };
  }, [copy, selectedPageId]);

  async function runAction(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function handleCategoryAccessChange(
    categoryId: string,
    access: KnowledgeAccessInput,
    expectedAccessRevision?: string
  ): Promise<void> {
    await runAction(async () => {
      await updateKnowledgeCategoryAccess(categoryId, access, expectedAccessRevision);
      await reloadTree();
      if (selectedPageId !== undefined) {
        setSelectedPage(await getKnowledgePage(selectedPageId));
      }
      setNotice(copy.accessSaveSuccess);
    });
  }

  async function handleCreateCategory(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const title = categoryTitle.trim();
    if (title.length === 0) {
      return;
    }

    await runAction(async () => {
      const category = await createKnowledgeCategory({
        title,
        access: accessInput(categoryAccessGate, categoryRequiredLevel),
      });
      setCategoryTitle('');
      setSectionCategoryId(category.categoryId ?? category.id);
      setKnowledgeAddMode(null);
      await reloadTree();
    });
  }

  async function handleCreateSection(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const title = sectionTitle.trim();
    const targetCategoryId = sectionCategoryId.length > 0 ? sectionCategoryId : categoryList[0]?.id;
    if (title.length === 0 || targetCategoryId === undefined) {
      return;
    }

    await runAction(async () => {
      await createKnowledgeSection(targetCategoryId, { title });
      setSectionTitle('');
      setKnowledgeAddMode(null);
      await reloadTree();
    });
  }

  async function handleCreatePage(input: CreateKnowledgePageInput): Promise<void> {
    await runAction(async () => {
      const page = await createKnowledgePage(input);
      setKnowledgeAddMode(null);
      setSelectedPage(page);
      await reloadTree();
      navigateToAdminPage(page.id);
    });
  }

  const categoryList = useMemo(() => (tree === null ? [] : categoryOptions(tree.root)), [tree]);
  const categoryFilters = useMemo(
    () => (tree === null ? [] : knowledgeCategoryFilters(tree.root)),
    [tree]
  );
  const knowledgePages = useMemo(
    () => (tree === null ? [] : flattenKnowledgePages(tree.root)),
    [tree]
  );
  const visibleKnowledgePages = useMemo(
    () => filterKnowledgePagesByCategory(knowledgePages, categoryFilter),
    [categoryFilter, knowledgePages]
  );
  const selectedPageListItem = useMemo(
    () => knowledgePages.find((page) => page.pageId === selectedPageId) ?? null,
    [knowledgePages, selectedPageId]
  );
  const selectedCategoryNode = useMemo(() => {
    if (tree === null || categorySettingsCategoryId === null) {
      return null;
    }

    return (
      tree.root.children.find(
        (node) => node.type === 'category' && node.categoryId === categorySettingsCategoryId
      ) ?? null
    );
  }, [categorySettingsCategoryId, tree]);
  const selectedSectionCategoryId =
    sectionCategoryId.length > 0 ? sectionCategoryId : (categoryList[0]?.id ?? '');
  const canCreateCategory = categoryTitle.trim().length > 0;
  const canCreateSection = selectedSectionCategoryId.length > 0 && sectionTitle.trim().length > 0;
  const isCreatePageRoute = selectedPageId === CREATE_PAGE_ROUTE_ID;
  const hasRequestedPage = selectedPageId !== undefined && selectedPageId.length > 0;
  const activeSelectedPage =
    hasRequestedPage && !isCreatePageRoute && selectedPage?.id === selectedPageId
      ? selectedPage
      : null;
  const isRouteTransitionLoading =
    hasRequestedPage &&
    !isCreatePageRoute &&
    (loading || (selectedPage !== null && selectedPage.id !== selectedPageId));
  const shouldRevealEditor =
    hasRequestedPage &&
    !isRouteTransitionLoading &&
    (isCreatePageRoute || activeSelectedPage !== null || error !== null);
  const missingRequestedPage =
    hasRequestedPage &&
    !isCreatePageRoute &&
    !isRouteTransitionLoading &&
    activeSelectedPage === null &&
    error !== null;
  const hasUnsavedPageChanges = pageDraftSummary.isDirty;
  const selectedPageHasSavedUnpublishedChanges =
    activeSelectedPage !== null && pageHasSavedUnpublishedChanges(activeSelectedPage);
  const knowledgeNavigationGuard = useMemo(() => {
    if (hasUnsavedPageChanges) {
      return {
        isDirty: true,
        confirmMessage: app.admin.unsavedKnowledgePageConfirm,
      };
    }

    if (selectedPageHasSavedUnpublishedChanges) {
      return {
        isDirty: true,
        confirmMessage: copy.savedUnpublishedNavigationConfirm,
      };
    }

    return null;
  }, [
    app.admin.unsavedKnowledgePageConfirm,
    copy.savedUnpublishedNavigationConfirm,
    hasUnsavedPageChanges,
    selectedPageHasSavedUnpublishedChanges,
  ]);
  useAdminNavigationGuard(knowledgeNavigationGuard);

  useEffect(() => {
    if (!hasUnsavedPageChanges) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedPageChanges]);

  useEffect(() => {
    if (!shouldRevealEditor || !shouldAutoRevealKnowledgeEditor()) {
      return;
    }

    const editorRegion = editorRegionRef.current;
    if (editorRegion === null) {
      return;
    }

    if (typeof editorRegion.scrollIntoView !== 'function') {
      return;
    }

    editorRegion.scrollIntoView({ block: 'start', behavior: 'smooth' });
    editorRegion.focus({ preventScroll: true });
  }, [activeSelectedPage?.id, error, shouldRevealEditor]);

  async function handleSavePage(pageId: string, input: SaveKnowledgePageInput): Promise<void> {
    await runAction(async () => {
      const page = await saveKnowledgePage(pageId, input);
      setSelectedPage(page);
      await reloadTree();
    });
  }

  function handleDeletePage(pageId: string): Promise<void> {
    const targetPage = selectedPage?.id === pageId ? selectedPage : activeSelectedPage;
    if (targetPage?.id !== pageId) {
      return Promise.resolve();
    }

    setPagePendingDelete(targetPage);
    return Promise.resolve();
  }

  async function confirmDeletePage(): Promise<void> {
    const targetPage = pagePendingDelete;
    if (targetPage === null) {
      return;
    }

    await runAction(async () => {
      await deleteKnowledgePage(targetPage.id);
      setSelectedPage(null);
      setPagePendingDelete(null);
      await reloadTree();
      window.history.pushState(null, '', '#/admin/knowledge');
      window.dispatchEvent(new Event('hashchange'));
    });
  }

  async function handleSyncPage(pageId: string): Promise<void> {
    await runAction(async () => {
      const result = await syncKnowledgePage(pageId);
      setSelectedPage(result.page);
      await reloadTree();
    });
  }

  async function handleReindexPage(pageId: string): Promise<void> {
    await runAction(async () => {
      const result = await reindexKnowledgePage(pageId);
      setSelectedPage(result.page);
      await reloadTree();
    });
  }

  async function handleAcknowledgeContentQuality(
    pageId: string,
    input: AcknowledgeKnowledgePageContentQualityInput
  ): Promise<void> {
    await runAction(async () => {
      const result = await acknowledgeKnowledgePageContentQuality(pageId, input);
      setSelectedPage(result.page);
      await reloadTree();
    });
  }

  async function handleSyncAll(): Promise<void> {
    setAssistantSyncOpen(false);
    await runAction(async () => {
      const result = await syncAdminKnowledgeBase({ mode: 'changed' });
      setAssistantSyncResult(result);
      await reloadTree();
      if (selectedPageId !== undefined && selectedPageId.length > 0) {
        try {
          setSelectedPage(await getKnowledgePage(selectedPageId));
        } catch (caught) {
          setSelectedPage(null);
          setError(pageLoadErrorMessage(caught, copy));
        }
      }
    });
  }

  if (loading && tree === null) {
    return (
      <section className="view-stack" aria-labelledby="knowledge-admin-heading">
        <div className="panel-header">
          <h2 id="knowledge-admin-heading">{app.admin.knowledgeBase}</h2>
        </div>
        <p className="muted-copy">{copy.loading}</p>
      </section>
    );
  }

  if (tree === null) {
    return (
      <section className="view-stack" aria-labelledby="knowledge-admin-heading">
        <div className="panel-header">
          <h2 id="knowledge-admin-heading">{app.admin.knowledgeBase}</h2>
        </div>
        {error !== null ? <p className="error-copy">{error}</p> : null}
      </section>
    );
  }

  const assistantPreflight = assistantSyncPreflight(tree);
  const unpublishedChangeCount = countPagesWithSavedUnpublishedChanges(tree.root);

  return (
    <section className="view-stack" aria-labelledby="knowledge-admin-heading">
      <div className="panel-header knowledge-admin-header">
        <div>
          <h2 id="knowledge-admin-heading">{app.admin.knowledgeBase}</h2>
          <p className="panel-subtitle">{copy.subtitle}</p>
        </div>
        <div className="toolbar-actions knowledge-header-actions">
          <ActionMenu
            icon={Plus}
            label={copy.add}
            items={[
              {
                label: copy.category,
                ariaLabel: copy.category,
                sectionLabel: copy.addMenuCreateManually,
                description: copy.addCategoryDescription,
                icon: BookOpen,
                onSelect: () => {
                  setKnowledgeAddMode('category');
                },
              },
              {
                label: copy.section,
                ariaLabel: copy.section,
                sectionLabel: copy.addMenuCreateManually,
                description: copy.addSectionDescription,
                icon: FolderPlus,
                onSelect: () => {
                  setKnowledgeAddMode('section');
                },
              },
              {
                label: copy.page,
                ariaLabel: copy.page,
                sectionLabel: copy.addMenuCreateManually,
                description: copy.addPageDescription,
                icon: FileText,
                onSelect: () => {
                  navigateToAdminPage(CREATE_PAGE_ROUTE_ID);
                },
              },
            ]}
          />
          <div className="assistant-refresh-action">
            {unpublishedChangeCount > 0 ? (
              <span className="status-pill knowledge-unpublished-count">
                {formatUnpublishedChangeCount(unpublishedChangeCount, copy)}
              </span>
            ) : null}
            <button
              className="icon-button-label"
              disabled={busy}
              type="button"
              onClick={() => {
                setAssistantSyncResult(null);
                setAssistantSyncOpen(true);
              }}
            >
              <UploadCloud aria-hidden="true" />
              <span>{copy.updateAssistant}</span>
            </button>
            <p className="assistant-refresh-action-copy">{copy.updateAssistantDescription}</p>
          </div>
        </div>
      </div>
      {missingRequestedPage ? <KnowledgeMissingPageRecovery message={error} /> : null}
      {error !== null && !missingRequestedPage ? <p className="error-copy">{error}</p> : null}
      {notice !== null && !missingRequestedPage ? (
        <p className="success-copy" role="status">
          {notice}
        </p>
      ) : null}
      {!missingRequestedPage ? (
        <div className="document-status-strip" aria-label={copy.assistantContentStatus}>
          <span>{assistantReadinessSummary(tree.accessRefresh, copy)}</span>
          {busy ? <span>{copy.assistantSyncBusy}</span> : null}
          {assistantSyncResult !== null && !busy ? (
            <span>
              {copy.assistantSyncResultPrefix}: {copy.synced} {assistantSyncResult.synced},{' '}
              {copy.skipped} {assistantSyncResult.skipped}, {copy.failed}{' '}
              {assistantSyncResult.failed}, {copy.accessJobs}{' '}
              {assistantSyncResult.queuedAccessRefreshJobs}.
            </span>
          ) : null}
        </div>
      ) : null}
      <DetailSheet
        closeLabel={app.commonActions.close}
        title={copy.addCategory}
        open={knowledgeAddMode === 'category'}
        onClose={() => {
          setKnowledgeAddMode(null);
        }}
      >
        <div className="knowledge-sheet-body">
          <form
            className="knowledge-structure-form knowledge-sheet-form"
            onSubmit={(event) => void handleCreateCategory(event)}
          >
            <div className="form-grid">
              <label>
                <span>{copy.categoryTitle}</span>
                <input
                  value={categoryTitle}
                  onChange={(event) => {
                    setCategoryTitle(event.currentTarget.value);
                  }}
                />
              </label>
              <label>
                <span>{copy.categoryAccess}</span>
                <select
                  value={categoryAccessGate}
                  onChange={(event) => {
                    setCategoryAccessGate(
                      event.currentTarget.value as 'approved' | 'level' | 'excluded'
                    );
                  }}
                >
                  <option value="approved">{app.knowledgeAccess.approved}</option>
                  <option value="level">{app.knowledgeAccess.level}</option>
                  <option value="excluded">{app.knowledgeAccess.excluded}</option>
                </select>
              </label>
              {categoryAccessGate === 'level' ? (
                <label>
                  <span>{copy.categoryRequiredLevel}</span>
                  <input
                    min={1}
                    max={10}
                    type="number"
                    value={categoryRequiredLevel}
                    onChange={(event) => {
                      const nextLevel = Number.parseInt(event.currentTarget.value, 10);
                      setCategoryRequiredLevel(Number.isFinite(nextLevel) ? nextLevel : 1);
                    }}
                  />
                </label>
              ) : null}
            </div>
            <div className="toolbar-actions editor-actions">
              <button
                className="icon-button-label"
                disabled={!canCreateCategory || busy}
                type="submit"
              >
                <Plus aria-hidden="true" />
                <span>{copy.createCategory}</span>
              </button>
            </div>
          </form>
        </div>
      </DetailSheet>
      <DetailSheet
        closeLabel={app.commonActions.close}
        title={copy.addSection}
        open={knowledgeAddMode === 'section'}
        onClose={() => {
          setKnowledgeAddMode(null);
        }}
      >
        <div className="knowledge-sheet-body">
          <form
            className="knowledge-structure-form knowledge-sheet-form"
            onSubmit={(event) => void handleCreateSection(event)}
          >
            <div className="form-grid">
              <label>
                <span>{copy.sectionCategory}</span>
                <select
                  value={selectedSectionCategoryId}
                  disabled={categoryList.length === 0}
                  onChange={(event) => {
                    setSectionCategoryId(event.currentTarget.value);
                  }}
                >
                  {categoryList.length === 0 ? <option value="">{copy.noCategories}</option> : null}
                  {categoryList.map((category) => (
                    <option value={category.id} key={category.id}>
                      {category.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{copy.sectionTitle}</span>
                <input
                  value={sectionTitle}
                  onChange={(event) => {
                    setSectionTitle(event.currentTarget.value);
                  }}
                />
              </label>
            </div>
            <div className="toolbar-actions editor-actions">
              <button
                className="icon-button-label"
                disabled={!canCreateSection || busy}
                type="submit"
              >
                <Plus aria-hidden="true" />
                <span>{copy.createSection}</span>
              </button>
            </div>
          </form>
        </div>
      </DetailSheet>
      <ConfirmDialog
        cancelLabel={app.commonActions.cancel}
        confirmLabel={app.commonActions.delete}
        open={pagePendingDelete !== null}
        title={copy.deletePageTitle}
        onCancel={() => {
          setPagePendingDelete(null);
        }}
        onConfirm={() => {
          void confirmDeletePage();
        }}
      >
        <p>
          {copy.deletePageMessagePrefix} <strong>{pagePendingDelete?.title}</strong>{' '}
          {copy.deletePageMessageSuffix}
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        cancelLabel={app.commonActions.cancel}
        confirmLabel={copy.publishAll}
        open={assistantSyncOpen}
        title={copy.updateAssistantTitle}
        onCancel={() => {
          setAssistantSyncOpen(false);
        }}
        onConfirm={() => {
          void handleSyncAll();
        }}
      >
        <p>{copy.updateAssistantConfirmation}</p>
        <ul className="confirmation-list">
          <li>
            {copy.pagesToSync}: {assistantPreflight.changedPages}
          </li>
          <li>
            {copy.queuedAccessJobs}: {assistantPreflight.queuedAccessJobs}
          </li>
          <li>{copy.embeddingCostNotice}</li>
        </ul>
      </ConfirmDialog>
      <KnowledgeCategorySettingsSheet
        busy={busy}
        category={selectedCategoryNode}
        open={selectedCategoryNode !== null}
        onClose={() => {
          setCategorySettingsCategoryId(null);
        }}
        onSave={handleCategoryAccessChange}
      />
      <div
        className={[
          'admin-knowledge-grid',
          !hasRequestedPage || missingRequestedPage
            ? 'knowledge-list-grid'
            : 'knowledge-editor-grid',
        ].join(' ')}
        aria-busy={busy}
      >
        {!hasRequestedPage || missingRequestedPage ? (
          <KnowledgePageList
            categories={categoryFilters}
            categoryId={categoryFilter}
            pages={visibleKnowledgePages}
            totalCount={visibleKnowledgePages.length}
            onCategoryChange={setCategoryFilter}
            onOpenCategorySettings={setCategorySettingsCategoryId}
          />
        ) : null}
        {hasRequestedPage && !missingRequestedPage ? (
          <div
            aria-label={copy.selectedKnowledgePage}
            className="knowledge-editor-region"
            ref={editorRegionRef}
            role="region"
            tabIndex={-1}
          >
            {isRouteTransitionLoading ? (
              <KnowledgePageStatePanel title={copy.loadingPage} message={copy.loadingPageMessage} />
            ) : isCreatePageRoute ? (
              <KnowledgePageEditor
                root={tree.root}
                mode="create"
                selectedPage={null}
                onDraftChange={setPageDraftSummary}
                onCreate={handleCreatePage}
                onSave={handleSavePage}
                onDelete={handleDeletePage}
                onSync={handleSyncPage}
                onReindex={handleReindexPage}
                onAcknowledgeContentQuality={handleAcknowledgeContentQuality}
              />
            ) : activeSelectedPage !== null ? (
              <KnowledgePageEditor
                root={tree.root}
                mode="edit"
                selectedPage={activeSelectedPage}
                subpages={selectedPageListItem?.subpages ?? []}
                onDraftChange={setPageDraftSummary}
                onCreate={handleCreatePage}
                onSave={handleSavePage}
                onDelete={handleDeletePage}
                onSync={handleSyncPage}
                onReindex={handleReindexPage}
                onAcknowledgeContentQuality={handleAcknowledgeContentQuality}
              />
            ) : (
              <KnowledgePageStatePanel title={copy.choosePage} message={copy.choosePageMessage} />
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
