import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { FileText } from 'lucide-react';

import { knowledgeAccessLabel } from '../../i18n/displayLabels.js';
import { useI18n } from '../../i18n/useI18n.js';
import type { KnowledgeCategoryFilter, KnowledgePageListItem } from './knowledgeListModel.js';

interface KnowledgePageListProps {
  categories: KnowledgeCategoryFilter[];
  categoryId: string | null;
  pages: KnowledgePageListItem[];
  totalCount: number;
  onCategoryChange: (categoryId: string | null) => void;
  onOpenCategorySettings: (categoryId: string) => void;
}

const INITIAL_VISIBLE_PAGE_COUNT = 25;
const VISIBLE_PAGE_STEP = 25;

function statusLabel(
  page: KnowledgePageListItem,
  copy: ReturnType<typeof useI18n>['messages']['app']['adminKnowledge']
): string {
  if (
    page.indexingStatus === 'ready' &&
    page.syncStatus === 'synced' &&
    page.accessSyncStatus === 'current'
  ) {
    return copy.statusReady;
  }

  if (
    page.indexingStatus === 'failed' ||
    page.syncStatus === 'failed' ||
    page.accessSyncStatus === 'failed' ||
    page.accessSyncStatus === 'invalid'
  ) {
    return copy.statusNeedsAttention;
  }

  return copy.unpublishedChange;
}

export function KnowledgePageList({
  categories,
  categoryId,
  pages,
  totalCount,
  onCategoryChange,
  onOpenCategorySettings,
}: KnowledgePageListProps): ReactElement {
  const { messages } = useI18n();
  const app = messages.app;
  const copy = app.adminKnowledge;
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_PAGE_COUNT);
  const activeCategory = categories.find((category) => category.id === categoryId) ?? null;
  const visiblePages = useMemo(() => pages.slice(0, visibleCount), [pages, visibleCount]);
  const hasMorePages = visiblePages.length < pages.length;

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_PAGE_COUNT);
  }, [categoryId, pages]);

  return (
    <section className="knowledge-list-stack" aria-labelledby="knowledge-pages-heading">
      <div className="toolbar-actions admin-users-filters knowledge-pages-filters fa-surface">
        <label className="admin-inline-control knowledge-pages-category-filter">
          <span>{copy.category}</span>
          <select
            aria-label={copy.category}
            value={categoryId ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onCategoryChange(value.length === 0 ? null : value);
            }}
          >
            <option value="">{copy.allCategories}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.title}
              </option>
            ))}
          </select>
        </label>
        {activeCategory !== null ? (
          <button
            className="fa-secondary-button"
            type="button"
            onClick={() => {
              onOpenCategorySettings(activeCategory.id);
            }}
          >
            {copy.categorySettings}
          </button>
        ) : null}
        <p className="admin-users-result-note">
          {copy.loadedPages
            .replace('{shown}', String(visiblePages.length))
            .replace('{total}', String(totalCount))}
        </p>
        {activeCategory === null ? (
          <p className="knowledge-pages-filter-help">{copy.allCategoriesHelp}</p>
        ) : null}
      </div>

      <div className="table-shell knowledge-page-table" role="table" aria-label={copy.pages}>
        <div className="knowledge-page-table-heading" role="row">
          <span id="knowledge-pages-heading" role="columnheader">
            {copy.pages}
          </span>
          <span role="columnheader">{copy.access}</span>
          <span role="columnheader">{copy.status}</span>
          <span role="columnheader">{copy.pageActions}</span>
        </div>
        {visiblePages.length === 0 ? (
          <div className="table-row knowledge-page-empty-row" role="row">
            <span>{copy.noPagesInCategory}</span>
          </div>
        ) : (
          visiblePages.map((page) => (
            <div className="table-row knowledge-page-row" role="row" key={page.pageId}>
              <span className="knowledge-page-identity" role="cell">
                <span className="knowledge-page-icon">
                  <FileText aria-hidden="true" />
                </span>
                <span className="knowledge-page-copy">
                  <a
                    className="knowledge-page-title-link"
                    href={`#/admin/knowledge/${encodeURIComponent(page.pageId)}`}
                    title={page.title}
                  >
                    {page.title}
                  </a>
                  <span title={page.path.join(' / ')}>
                    {page.categoryTitle}
                    {page.sectionTitle === null ? '' : ` / ${page.sectionTitle}`}
                  </span>
                </span>
              </span>
              <span className="knowledge-page-meta" role="cell">
                <span className="status-pill">
                  {knowledgeAccessLabel(page.access.gate, page.access.requiredLevel, app)}
                </span>
                {page.subpageCount > 0 ? (
                  <span className="status-pill">
                    {page.subpageCount} {copy.subpages}
                  </span>
                ) : null}
              </span>
              <span className="knowledge-page-status" role="cell">
                <span className="status-pill">{statusLabel(page, copy)}</span>
              </span>
              <span className="knowledge-page-actions" role="cell">
                <a
                  className="fa-secondary-button knowledge-page-open"
                  href={`#/admin/knowledge/${encodeURIComponent(page.pageId)}`}
                  aria-label={`${copy.openPage} ${page.title}`}
                >
                  {copy.openPage}
                </a>
              </span>
            </div>
          ))
        )}
      </div>
      {hasMorePages ? (
        <div className="admin-infinite-scroll knowledge-page-load-more" role="presentation">
          <p className="admin-meta-text">
            {copy.loadedPages
              .replace('{shown}', String(visiblePages.length))
              .replace('{total}', String(totalCount))}
          </p>
          <button
            className="fa-secondary-button"
            type="button"
            onClick={() => {
              setVisibleCount((current) => Math.min(current + VISIBLE_PAGE_STEP, pages.length));
            }}
          >
            {copy.showMorePages}
          </button>
        </div>
      ) : null}
    </section>
  );
}
