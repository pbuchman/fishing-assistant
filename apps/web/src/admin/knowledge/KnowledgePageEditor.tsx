import type { ChangeEvent, ComponentType, ReactElement, SyntheticEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, FilePlus2, RefreshCw, Save, Trash2, UploadCloud } from 'lucide-react';
import * as MDEditorModule from '@uiw/react-md-editor/nohighlight';

import { ActionMenu } from '../../ui/ActionMenu.js';
import { knowledgeAccessLabel } from '../../i18n/displayLabels.js';
import { useI18n } from '../../i18n/useI18n.js';
import type { AppMessages } from '@fa/i18n';
import type {
  AcknowledgeKnowledgePageContentQualityInput,
  CreateKnowledgePageInput,
  KnowledgeContentQualityAcknowledgement,
  KnowledgeAdminPage,
  KnowledgeAdminTreeNode,
  KnowledgePageRelations,
  SaveKnowledgePageInput,
} from '../../services/knowledgeApi.js';
import {
  analyzeKnowledgeContentQuality,
  duplicateContentIssueFingerprint,
  hasBlockingContentQualityIssues,
  type KnowledgeContentQuality,
} from './knowledgeContentQuality.js';

import '@uiw/react-markdown-preview/markdown.css';
import '@uiw/react-md-editor/markdown-editor.css';

interface MarkdownEditorProps {
  height: number;
  preview: 'live';
  textareaProps: { 'aria-label': string };
  value: string;
  onChange: (value?: string, event?: ChangeEvent<HTMLTextAreaElement>) => void;
}

const MarkdownEditor = (
  MDEditorModule as unknown as { default: ComponentType<MarkdownEditorProps> }
).default;

interface CategoryOption {
  id: string;
  title: string;
  sections: { id: string; title: string }[];
}

interface KnowledgePageEditorProps {
  root: KnowledgeAdminTreeNode;
  selectedPage: KnowledgeAdminPage | null;
  mode?: 'create' | 'edit' | 'idle';
  onDraftChange?: (summary: KnowledgePageDraftSummary) => void;
  onCreate: (input: CreateKnowledgePageInput) => Promise<void>;
  onSave: (pageId: string, input: SaveKnowledgePageInput) => Promise<void>;
  onDelete: (pageId: string) => Promise<void>;
  onSync: (pageId: string) => Promise<void>;
  onReindex: (pageId: string) => Promise<void>;
  onAcknowledgeContentQuality: (
    pageId: string,
    input: AcknowledgeKnowledgePageContentQualityInput
  ) => Promise<void>;
  subpages?: { pageId: string; title: string }[];
}

export interface KnowledgePageDraftSummary {
  isDirty: boolean;
  pageTitle: string | null;
  changedFields: string[];
}

function categoryOptions(root: KnowledgeAdminTreeNode): CategoryOption[] {
  return root.children
    .filter((node) => node.type === 'category' && node.categoryId !== null)
    .map((category) => ({
      id: category.categoryId ?? category.id,
      title: category.title,
      sections: category.children
        .filter((child) => child.type === 'section' && child.sectionId !== null)
        .map((section) => ({ id: section.sectionId ?? section.id, title: section.title })),
    }));
}

function joinRelations(values: string[]): string {
  return values.join('\n');
}

function splitRelations(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function relationsInput(input: {
  relatedTo: string;
  linksTo: string;
  supersedes: string;
}): KnowledgePageRelations {
  return {
    relatedTo: splitRelations(input.relatedTo),
    linksTo: splitRelations(input.linksTo),
    supersedes: splitRelations(input.supersedes),
  };
}

function nullableTrimmed(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function arraysMatch(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stringSetsMatch(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  if (leftSet.size !== right.length) {
    return false;
  }
  return right.every((value) => leftSet.has(value));
}

function effectiveAccessLabel(page: KnowledgeAdminPage, app: AppMessages): string {
  const { effective } = page.access;
  return knowledgeAccessLabel(effective.gate, effective.requiredLevel, app);
}

function pageReadinessLabel(
  page: KnowledgeAdminPage,
  quality: KnowledgeContentQuality,
  copy: AppMessages['adminKnowledge']
): string {
  if (hasBlockingContentQualityIssues(quality)) {
    return copy.statusNeedsAttention;
  }

  if (
    page.access.effective.retrievalReady &&
    page.indexingStatus === 'ready' &&
    page.syncStatus === 'synced' &&
    page.accessSyncStatus === 'current'
  ) {
    return copy.statusReadyForAnswers;
  }

  if (
    page.indexingStatus === 'failed' ||
    page.syncStatus === 'failed' ||
    page.accessSyncStatus === 'failed' ||
    page.accessSyncStatus === 'invalid'
  ) {
    return copy.statusNeedsAttention;
  }

  return copy.statusNeedsUpdate;
}

function pageIsCurrentForAssistant(
  page: KnowledgeAdminPage,
  quality: KnowledgeContentQuality
): boolean {
  return (
    !hasBlockingContentQualityIssues(quality) &&
    page.access.effective.retrievalReady &&
    page.indexingStatus === 'ready' &&
    page.syncStatus === 'synced' &&
    page.accessSyncStatus === 'current'
  );
}

function hasSavedUnpublishedChanges(page: KnowledgeAdminPage): boolean {
  return (
    page.syncStatus === 'sync_required' ||
    page.indexingStatus === 'pending' ||
    page.accessSyncStatus === 'stale'
  );
}

function DuplicateContentWarning({
  acknowledgement,
  commonActions,
  quality,
  copy,
  onAcknowledge,
}: {
  acknowledgement: KnowledgeContentQualityAcknowledgement | null;
  commonActions: AppMessages['commonActions'];
  quality: KnowledgeContentQuality;
  copy: AppMessages['adminKnowledge'];
  onAcknowledge: ((reason: string | null) => Promise<void>) | null;
}): ReactElement | null {
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!hasBlockingContentQualityIssues(quality)) {
    return null;
  }

  async function handleAcknowledge(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (onAcknowledge === null) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onAcknowledge(reason.trim().length === 0 ? null : reason.trim());
      setIsAcknowledging(false);
      setReason('');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="knowledge-content-warning" role="alert">
      <div className="knowledge-content-warning-heading">
        <strong>{copy.duplicateContentTitle}</strong>
        <span>{copy.statusNeedsAttention}</span>
      </div>
      <p>{copy.duplicateContentDescription}</p>
      <p className="knowledge-content-warning-list-title">{copy.duplicateContentItemsTitle}</p>
      <ul>
        {quality.duplicateIssues.slice(0, 4).map((issue) => (
          <li key={`${String(issue.firstLine)}:${String(issue.repeatedLine)}:${issue.text}`}>
            "{issue.text}" {copy.duplicateContentLines} {String(issue.firstLine)}{' '}
            {copy.duplicateContentLineJoiner} {String(issue.repeatedLine)}
          </li>
        ))}
      </ul>
      <p>{copy.duplicateContentIntentionalHint}</p>
      {acknowledgement !== null ? (
        <p className="knowledge-content-acknowledged" role="status">
          <CheckCircle2 aria-hidden="true" />
          <span>{copy.duplicateAcknowledgedMessage}</span>
        </p>
      ) : isAcknowledging ? (
        <form
          className="knowledge-content-ack-form"
          onSubmit={(event) => void handleAcknowledge(event)}
        >
          <label>
            <span>{copy.duplicateAcknowledgementReasonLabel}</span>
            <textarea
              rows={3}
              value={reason}
              onChange={(event) => {
                setReason(event.currentTarget.value);
              }}
            />
          </label>
          <p>{copy.duplicateAcknowledgementHelp}</p>
          {submitError !== null ? <p className="error-copy">{submitError}</p> : null}
          <div className="knowledge-content-warning-actions">
            <button
              className="fa-secondary-button"
              disabled={isSubmitting}
              type="button"
              onClick={() => {
                setIsAcknowledging(false);
                setReason('');
                setSubmitError(null);
              }}
            >
              {commonActions.cancel}
            </button>
            <button className="icon-button-label" disabled={isSubmitting} type="submit">
              <CheckCircle2 aria-hidden="true" />
              <span>{copy.confirmDuplicateAcknowledgement}</span>
            </button>
          </div>
        </form>
      ) : (
        <div className="knowledge-content-warning-actions">
          <button
            className="fa-secondary-button"
            disabled={onAcknowledge === null}
            type="button"
            onClick={() => {
              setIsAcknowledging(true);
            }}
          >
            {copy.acknowledgeDuplicateContent}
          </button>
        </div>
      )}
    </div>
  );
}

export function KnowledgePageEditor({
  root,
  selectedPage,
  mode,
  onDraftChange,
  onCreate,
  onSave,
  onDelete,
  onSync,
  onReindex,
  onAcknowledgeContentQuality,
  subpages = [],
}: KnowledgePageEditorProps): ReactElement {
  const { messages } = useI18n();
  const app = messages.app;
  const admin = messages.app.admin;
  const copy = messages.app.adminKnowledge;
  const editorMode = mode ?? (selectedPage === null ? ('create' as const) : ('edit' as const));
  const categories = useMemo(() => categoryOptions(root), [root]);
  const defaultCategoryId = categories[0]?.id ?? '';
  const [title, setTitle] = useState(() => selectedPage?.title ?? '');
  const [categoryId, setCategoryId] = useState(() => selectedPage?.categoryId ?? defaultCategoryId);
  const [sectionId, setSectionId] = useState(() => selectedPage?.sectionId ?? '');
  const [sourceUrl, setSourceUrl] = useState(() => selectedPage?.source.url ?? '');
  const [sourceLabel, setSourceLabel] = useState(() => selectedPage?.source.label ?? '');
  const [relatedTo, setRelatedTo] = useState(() =>
    selectedPage === null ? '' : joinRelations(selectedPage.relations.relatedTo)
  );
  const [linksTo, setLinksTo] = useState(() =>
    selectedPage === null ? '' : joinRelations(selectedPage.relations.linksTo)
  );
  const [supersedes, setSupersedes] = useState(() =>
    selectedPage === null ? '' : joinRelations(selectedPage.relations.supersedes)
  );
  const [markdown, setMarkdown] = useState(() => selectedPage?.markdown ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);
  const firstFormSync = useRef(true);
  const contentQuality = useMemo(() => analyzeKnowledgeContentQuality(markdown), [markdown]);
  const hasContentQualityBlocker = hasBlockingContentQualityIssues(contentQuality);
  const duplicateIssueFingerprints = useMemo(
    () => contentQuality.duplicateIssues.map(duplicateContentIssueFingerprint),
    [contentQuality]
  );
  const duplicateAcknowledgement = useMemo(() => {
    if (markdown !== selectedPage?.markdown || duplicateIssueFingerprints.length === 0) {
      return null;
    }

    return (
      selectedPage.contentQualityAcknowledgements.find(
        (acknowledgement) =>
          acknowledgement.markdownContentHash === selectedPage.markdownContentHash &&
          stringSetsMatch(duplicateIssueFingerprints, acknowledgement.issueFingerprints)
      ) ?? null
    );
  }, [duplicateIssueFingerprints, markdown, selectedPage]);
  const canAcknowledgeDuplicateContent =
    selectedPage !== null &&
    markdown === selectedPage.markdown &&
    duplicateIssueFingerprints.length > 0 &&
    selectedPage.markdownContentHash.length > 0;
  const hasContentQualityPublicationBlocker =
    hasContentQualityBlocker && duplicateAcknowledgement === null;

  useEffect(() => {
    if (firstFormSync.current) {
      firstFormSync.current = false;
      return;
    }

    if (selectedPage === null) {
      setTitle('');
      setCategoryId(defaultCategoryId);
      setSectionId('');
      setSourceUrl('');
      setSourceLabel('');
      setRelatedTo('');
      setLinksTo('');
      setSupersedes('');
      setMarkdown('');
      return;
    }

    setTitle(selectedPage.title);
    setCategoryId(selectedPage.categoryId);
    setSectionId(selectedPage.sectionId ?? '');
    setSourceUrl(selectedPage.source.url ?? '');
    setSourceLabel(selectedPage.source.label ?? '');
    setRelatedTo(joinRelations(selectedPage.relations.relatedTo));
    setLinksTo(joinRelations(selectedPage.relations.linksTo));
    setSupersedes(joinRelations(selectedPage.relations.supersedes));
    setMarkdown(selectedPage.markdown);
  }, [defaultCategoryId, selectedPage]);

  const selectedCategory = categories.find((category) => category.id === categoryId);
  const canSubmit =
    editorMode !== 'idle' &&
    title.trim().length > 0 &&
    markdown.trim().length > 0 &&
    sourceUrl.trim().length > 0 &&
    categoryId.length > 0;
  const formId =
    selectedPage === null
      ? 'knowledge-page-create-form'
      : `knowledge-page-edit-form-${selectedPage.id}`;
  const changedFields = useMemo(() => {
    if (editorMode !== 'edit' || selectedPage === null) {
      return [];
    }

    const nextRelations = relationsInput({ relatedTo, linksTo, supersedes });
    const fields: string[] = [];

    if (title.trim() !== selectedPage.title) {
      fields.push(copy.pageTitle);
    }

    if (sectionId !== (selectedPage.sectionId ?? '')) {
      fields.push(copy.section);
    }

    if (
      sourceUrl.trim() !== (selectedPage.source.url ?? '') ||
      nullableTrimmed(sourceLabel) !== selectedPage.source.label
    ) {
      fields.push(copy.source);
    }

    if (
      !arraysMatch(nextRelations.relatedTo, selectedPage.relations.relatedTo) ||
      !arraysMatch(nextRelations.linksTo, selectedPage.relations.linksTo) ||
      !arraysMatch(nextRelations.supersedes, selectedPage.relations.supersedes)
    ) {
      fields.push(copy.relationships);
    }

    if (markdown !== selectedPage.markdown) {
      fields.push('Markdown');
    }

    return fields;
  }, [
    editorMode,
    linksTo,
    markdown,
    relatedTo,
    sectionId,
    selectedPage,
    sourceLabel,
    sourceUrl,
    supersedes,
    title,
    copy.pageTitle,
    copy.relationships,
    copy.section,
    copy.source,
  ]);
  const pageDraftSummary = useMemo<KnowledgePageDraftSummary>(
    () => ({
      isDirty: changedFields.length > 0,
      pageTitle: selectedPage?.title ?? null,
      changedFields,
    }),
    [changedFields, selectedPage?.title]
  );
  const savedUnpublishedPage =
    selectedPage !== null && !pageDraftSummary.isDirty && hasSavedUnpublishedChanges(selectedPage)
      ? selectedPage
      : null;
  const selectedPageIsCurrent =
    selectedPage !== null && pageIsCurrentForAssistant(selectedPage, contentQuality);
  const contentQualityBlockedDescription = hasContentQualityPublicationBlocker
    ? copy.contentQualityBlockerDescription
    : undefined;

  useEffect(() => {
    onDraftChange?.(pageDraftSummary);
  }, [onDraftChange, pageDraftSummary]);

  useEffect(() => {
    return () => {
      onDraftChange?.({ isDirty: false, pageTitle: null, changedFields: [] });
    };
  }, [onDraftChange]);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const sourceLink = sourceUrl.trim();
    if (sourceLink.length === 0) {
      setValidationError(copy.sourceUrlRequired);
      return;
    }
    setValidationError(null);
    const source = {
      type: 'external' as const,
      url: sourceLink,
      label: sourceLabel.trim().length === 0 ? null : sourceLabel.trim(),
    };
    const relations = relationsInput({ relatedTo, linksTo, supersedes });

    if (editorMode === 'create') {
      await onCreate({
        categoryId,
        sectionId: sectionId.length === 0 ? null : sectionId,
        title: title.trim(),
        source,
        relations,
        markdown,
      });
      return;
    }

    if (selectedPage === null) {
      return;
    }

    await onSave(selectedPage.id, {
      title: title.trim(),
      sectionId: sectionId.length === 0 ? null : sectionId,
      source,
      relations,
      markdown,
    });
  }

  if (editorMode === 'idle') {
    return (
      <section className="knowledge-editor-panel" aria-labelledby="knowledge-editor-heading">
        <div className="panel-header">
          <div>
            <h2 id="knowledge-editor-heading">{copy.pageEditor}</h2>
          </div>
        </div>
        <div className="knowledge-empty-editor">
          <p className="muted-copy">{copy.pageEditorEmpty}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="knowledge-editor-panel" aria-labelledby="knowledge-editor-heading">
      <div className="panel-header">
        <div>
          <h2 id="knowledge-editor-heading">
            {editorMode === 'create' ? copy.newPage : copy.editPage}
          </h2>
        </div>
        {editorMode === 'edit' && selectedPage !== null ? (
          <ActionMenu
            label={copy.pageActions}
            items={[
              {
                label: copy.syncPage,
                ariaLabel: `${copy.syncPage} ${selectedPage.title}`,
                title: `${copy.syncPage} ${selectedPage.title}`,
                description:
                  contentQualityBlockedDescription ??
                  (selectedPageIsCurrent
                    ? copy.pageAlreadyPublishedDescription
                    : copy.publishPageDescription),
                disabled: hasContentQualityPublicationBlocker || selectedPageIsCurrent,
                icon: UploadCloud,
                onSelect: () => void onSync(selectedPage.id),
              },
              {
                label: copy.reindexPage,
                ariaLabel: `${copy.reindexPage} ${selectedPage.title}`,
                title: `${copy.reindexPage} ${selectedPage.title}`,
                description: contentQualityBlockedDescription ?? copy.reindexPageDescription,
                disabled: hasContentQualityPublicationBlocker,
                icon: RefreshCw,
                onSelect: () => void onReindex(selectedPage.id),
              },
              {
                label: copy.deletePage,
                ariaLabel: `${copy.deletePage} ${selectedPage.title}`,
                title: `${copy.deletePage} ${selectedPage.title}`,
                description: copy.deletePageDescription,
                sectionLabel: copy.pageDangerZone,
                icon: Trash2,
                tone: 'danger',
                onSelect: () => void onDelete(selectedPage.id),
              },
            ]}
          />
        ) : null}
      </div>

      {pageDraftSummary.isDirty ? (
        <div
          aria-label={admin.unsavedKnowledgePageTitle}
          className="knowledge-editor-dirty-banner"
          role="status"
        >
          <div>
            <strong>{admin.unsavedKnowledgePageTitle}</strong>
            <p>{admin.unsavedKnowledgePageDescription}</p>
            <p>
              {admin.unsavedKnowledgePageChangedFields}: {pageDraftSummary.changedFields.join(', ')}
            </p>
          </div>
          <button
            aria-label={copy.savePageEdits}
            className="fa-secondary-button"
            disabled={!canSubmit}
            form={formId}
            type="submit"
          >
            {copy.savePage}
          </button>
        </div>
      ) : null}

      {savedUnpublishedPage !== null ? (
        <div
          aria-label={copy.savedUnpublishedTitle}
          className="knowledge-editor-publish-banner"
          role="status"
        >
          <div>
            <strong>{copy.savedUnpublishedMessage}</strong>
            <p>{copy.statusNeedsUpdate}</p>
          </div>
          <button
            className="icon-button-label"
            disabled={hasContentQualityPublicationBlocker}
            type="button"
            onClick={() => void onSync(savedUnpublishedPage.id)}
          >
            <UploadCloud aria-hidden="true" />
            <span>{copy.syncPage}</span>
          </button>
        </div>
      ) : null}

      {selectedPage !== null ? (
        <>
          <div
            className="document-status-strip knowledge-editor-readiness"
            aria-label={copy.selectedPageStatus}
          >
            <span>{pageReadinessLabel(selectedPage, contentQuality, copy)}</span>
            <span>
              {copy.access}: {effectiveAccessLabel(selectedPage, app)}
            </span>
          </div>
          <DuplicateContentWarning
            acknowledgement={duplicateAcknowledgement}
            commonActions={app.commonActions}
            copy={copy}
            quality={contentQuality}
            onAcknowledge={
              !canAcknowledgeDuplicateContent
                ? null
                : async (reason) => {
                    await onAcknowledgeContentQuality(selectedPage.id, {
                      issueType: 'adjacent_duplicate_content',
                      markdownContentHash: selectedPage.markdownContentHash,
                      issueFingerprints: duplicateIssueFingerprints,
                      reason,
                    });
                  }
            }
          />
          {subpages.length > 0 ? (
            <section
              className="knowledge-subpages-panel"
              aria-labelledby="knowledge-subpages-heading"
            >
              <div>
                <h3 id="knowledge-subpages-heading">{copy.subpagesTitle}</h3>
                <p>{copy.pageHasSubpages.replace('{count}', String(subpages.length))}</p>
              </div>
              <div className="knowledge-subpage-list">
                {subpages.slice(0, 6).map((subpage) => (
                  <a
                    className="status-pill"
                    href={`#/admin/knowledge/${encodeURIComponent(subpage.pageId)}`}
                    key={subpage.pageId}
                  >
                    {subpage.title}
                  </a>
                ))}
              </div>
            </section>
          ) : null}
          {selectedPage.indexingError !== null ? (
            <p className="error-copy">
              {copy.indexingError}: {selectedPage.indexingError}
            </p>
          ) : null}
          {selectedPage.syncError !== null ? (
            <p className="error-copy">
              {copy.syncError}: {selectedPage.syncError}
            </p>
          ) : null}
          {selectedPage.accessSyncError !== null ? (
            <p className="error-copy">
              {copy.accessSyncError}: {selectedPage.accessSyncError}
            </p>
          ) : null}
        </>
      ) : null}

      <form
        className="knowledge-editor-form"
        id={formId}
        onSubmit={(event) => void handleSubmit(event)}
      >
        <section className="knowledge-editor-section" aria-labelledby="knowledge-page-details">
          <h3 id="knowledge-page-details">{copy.pageDetails}</h3>
          <div className="form-grid knowledge-details-grid knowledge-editor-required-fields">
            <label>
              <span>{copy.pageTitle}</span>
              <input
                value={title}
                onChange={(event) => {
                  setTitle(event.currentTarget.value);
                }}
              />
            </label>
            <label>
              <span>{copy.category}</span>
              <select
                value={categoryId}
                disabled={selectedPage !== null}
                onChange={(event) => {
                  setCategoryId(event.currentTarget.value);
                  setSectionId('');
                }}
              >
                {categories.length === 0 ? <option value="">{copy.noCategories}</option> : null}
                {categories.map((category) => (
                  <option value={category.id} key={category.id}>
                    {category.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{copy.section}</span>
              <select
                value={sectionId}
                onChange={(event) => {
                  setSectionId(event.currentTarget.value);
                }}
              >
                <option value="">{copy.noSection}</option>
                {(selectedCategory?.sections ?? []).map((section) => (
                  <option value={section.id} key={section.id}>
                    {section.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{copy.sourceUrl}</span>
              <input
                aria-label={copy.sourceUrl}
                required
                type="url"
                value={sourceUrl}
                onChange={(event) => {
                  setSourceUrl(event.currentTarget.value);
                  setValidationError(null);
                }}
              />
            </label>
          </div>
        </section>

        {validationError !== null ? <p className="error-copy">{validationError}</p> : null}

        <section
          className="knowledge-editor-section knowledge-markdown-section"
          aria-labelledby="knowledge-markdown-heading"
        >
          <h3 id="knowledge-markdown-heading">Markdown</h3>
          <div
            className="knowledge-rich-editor"
            data-testid="knowledge-rich-markdown-editor"
            data-color-mode="light"
          >
            <MarkdownEditor
              height={560}
              preview="live"
              textareaProps={{ 'aria-label': 'Markdown' }}
              value={markdown}
              onChange={(value?: string) => {
                setMarkdown(value ?? '');
              }}
            />
          </div>
        </section>

        <div className="toolbar-actions editor-actions knowledge-editor-sticky-actions">
          <button className="icon-button-label" disabled={!canSubmit} type="submit">
            {selectedPage === null ? <FilePlus2 aria-hidden="true" /> : <Save aria-hidden="true" />}
            <span>{selectedPage === null ? copy.createPage : copy.savePage}</span>
          </button>
          {!canSubmit ? (
            <p className="knowledge-submit-help">{copy.pageSubmitDisabledHelp}</p>
          ) : null}
        </div>

        <section className="knowledge-editor-section" aria-labelledby="knowledge-source-material">
          <div className="knowledge-editor-section-header">
            <h3 id="knowledge-source-material">{copy.source}</h3>
            <p>{copy.sourceLabelHelp}</p>
          </div>
          <div className="form-grid knowledge-source-material-grid">
            <label>
              <span>{copy.sourceLabel}</span>
              <input
                value={sourceLabel}
                onChange={(event) => {
                  setSourceLabel(event.currentTarget.value);
                }}
              />
            </label>
          </div>
        </section>
      </form>
    </section>
  );
}
