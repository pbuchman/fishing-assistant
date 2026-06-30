import type { ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnswerGap } from '@fa/http-contracts';

import { useI18n } from '../../i18n/useI18n.js';
import { formatDateTime } from '../../ui/formatters.js';
import { DetailSheet } from '../../ui/DetailSheet.js';
import {
  listAnswerGaps,
  markAnswerGapDone,
  type AnswerGapStatusFilter,
} from '../../services/knowledgeApi.js';

type LoadingMode = 'replace' | 'append';

function requesterName(gap: AnswerGap, app: ReturnType<typeof useI18n>['messages']['app']): string {
  const fullName = [gap.requester.firstName, gap.requester.lastName].filter(Boolean).join(' ');
  if (fullName.length > 0) {
    return fullName;
  }

  return gap.requester.email ?? app.admin.requesterContactHidden;
}

function requesterInitials(gap: AnswerGap): string {
  const nameInitials = [gap.requester.firstName, gap.requester.lastName]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().at(0)?.toUpperCase() ?? '')
    .join('');
  if (nameInitials.length > 0) {
    return nameInitials.slice(0, 2);
  }

  const emailName = gap.requester.email?.split('@')[0] ?? '';
  const pieces = emailName
    .split(/[.+_-]+/)
    .filter((piece) => piece.length > 0)
    .slice(0, 2);
  const initials = pieces.map((piece) => piece.at(0)?.toUpperCase() ?? '').join('');
  return initials.length > 0 ? initials : 'U';
}

function gapOriginText(gap: AnswerGap, app: ReturnType<typeof useI18n>['messages']['app']): string {
  const reason = gap.origin?.reason ?? gap.source;
  if (reason === 'no_accessible_evidence') {
    return app.admin.gapOriginNoAccessibleEvidence;
  }

  return app.admin.gapOriginUnsupportedEvidence;
}

function coverageKindText(
  gap: AnswerGap,
  app: ReturnType<typeof useI18n>['messages']['app']
): string {
  switch (gap.coverageKind) {
    case 'global_no_candidate_seen':
      return app.admin.answerGapCoverageGlobalMissing;
    case 'unsupported_by_accessible_evidence':
      return app.admin.answerGapCoverageUnsupportedAccessible;
    default:
      return app.admin.answerGapCoverageUnknown;
  }
}

function accessLevelText(
  gap: AnswerGap,
  app: ReturnType<typeof useI18n>['messages']['app']
): string {
  return Number.isInteger(gap.requester.effectiveLevel) && gap.requester.effectiveLevel > 0
    ? `${app.admin.userLevel} ${String(gap.requester.effectiveLevel)}`
    : app.admin.answerGapAccessLevelUnknown;
}

function consentLabels(
  gap: AnswerGap,
  app: ReturnType<typeof useI18n>['messages']['app']
): string[] {
  const consent = gap.consent;
  if (consent === undefined || consent.status === 'system_imported') {
    return [app.admin.answerGapConsentSystemImported];
  }

  const labels = [
    consent.includeContext
      ? app.admin.answerGapConsentContextShared
      : app.admin.answerGapConsentContextHidden,
    consent.includeContact
      ? app.admin.answerGapConsentContactShared
      : app.admin.answerGapConsentContactHidden,
  ];
  return consent.status === 'user_withdrew'
    ? [app.admin.answerGapConsentWithdrawn, ...labels]
    : labels;
}

function reportScopeLabels(
  gap: AnswerGap,
  app: ReturnType<typeof useI18n>['messages']['app']
): string[] {
  const labels = consentLabels(gap, app);
  return Number.isInteger(gap.requester.effectiveLevel) && gap.requester.effectiveLevel > 0
    ? [app.admin.answerGapAccessLevelIncluded, ...labels]
    : labels;
}

function contextRoleLabel(
  role: AnswerGap['conversation']['contextWindow'][number]['role'],
  app: ReturnType<typeof useI18n>['messages']['app']
): string {
  return role === 'user'
    ? app.admin.conversationPreviewUserRole
    : app.admin.conversationPreviewAssistantRole;
}

function loadedGapsCopy(
  count: number,
  totalCount: number | null,
  app: ReturnType<typeof useI18n>['messages']['app']
): string {
  if (totalCount === null) {
    return `${app.admin.loadedGapsPrefix} ${String(count)}`;
  }

  return `${app.admin.loadedGapsPrefix} ${String(count)} ${app.admin.loadedGapsOf} ${String(totalCount)}`;
}

export function AnswerGapsPage(): ReactElement {
  const { locale, messages } = useI18n();
  const app = messages.app;
  const [status, setStatus] = useState<AnswerGapStatusFilter>('needs_answer');
  const [gaps, setGaps] = useState<AnswerGap[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingDone, setMarkingDone] = useState<Record<string, boolean>>({});
  const [previewGap, setPreviewGap] = useState<AnswerGap | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const loadGaps = useCallback(
    async (mode: LoadingMode, cursor?: string): Promise<void> => {
      setError(null);
      if (mode === 'append') {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const response = await listAnswerGaps({
          status,
          ...(cursor === undefined ? {} : { cursor }),
        });
        setGaps((current) => (mode === 'append' ? [...current, ...response.gaps] : response.gaps));
        setNextCursor(response.nextCursor);
        setTotalCount(typeof response.totalCount === 'number' ? response.totalCount : null);
      } catch (_error) {
        setError(app.errors.generic);
      } finally {
        if (mode === 'append') {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    },
    [app.errors.generic, status]
  );

  useEffect(() => {
    void loadGaps('replace');
  }, [loadGaps]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (node === null || nextCursor === null || loading || loadingMore) {
      return;
    }

    if (!('IntersectionObserver' in window)) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadGaps('append', nextCursor);
      }
    });

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [loadGaps, loading, loadingMore, nextCursor]);

  async function handleMarkDone(gapId: string): Promise<void> {
    setError(null);
    setMarkingDone((current) => ({ ...current, [gapId]: true }));
    try {
      const response = await markAnswerGapDone(gapId);
      setGaps((current) =>
        status === 'needs_answer'
          ? current.filter((gap) => gap.id !== gapId)
          : current.map((gap) => (gap.id === gapId ? response.gap : gap))
      );
    } catch (_error) {
      setError(app.errors.generic);
    } finally {
      setMarkingDone((current) => {
        const { [gapId]: _completed, ...next } = current;
        return next;
      });
    }
  }

  const emptyState =
    status === 'needs_answer'
      ? app.admin.noAnswerGapsRequireAttention
      : app.admin.noAnswerGapsRecorded;

  return (
    <section className="view-stack" aria-labelledby="answer-gaps-heading">
      <div className="panel-header answer-gaps-header">
        <div>
          <h2 id="answer-gaps-heading">{app.admin.answerGaps}</h2>
          <p className="panel-subtitle">{app.admin.answerGapsSubtitle}</p>
        </div>
        <div className="fa-segmented-control" role="group" aria-label={app.admin.answerGaps}>
          {(
            [
              ['needs_answer', app.admin.answerGapsRequiresAnswer],
              ['all', app.admin.answerGapsAll],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-pressed={status === value}
              className={status === value ? 'selected' : undefined}
              key={value}
              type="button"
              onClick={() => {
                setStatus(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error === null ? null : <p className="error-copy">{error}</p>}

      <div className="answer-gap-list" aria-busy={loading || loadingMore}>
        {!loading && gaps.length === 0 ? (
          <div className="fa-surface admin-empty-state">{emptyState}</div>
        ) : null}
        {gaps.map((gap) => (
          <article className="fa-surface answer-gap-row" aria-label={gap.question} key={gap.id}>
            <div className="answer-gap-main">
              <div className="answer-gap-question">
                <span>{app.admin.gapQuestion}</span>
                <h3>{gap.question}</h3>
              </div>
              <div className="answer-gap-body-grid">
                <section className="answer-gap-info-panel">
                  <h4>{app.admin.missingInformation}</h4>
                  <ul>
                    {gap.missingInformation.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
                <section className="answer-gap-info-panel answer-gap-origin">
                  <h4>{app.admin.gapOrigin}</h4>
                  <p>{gapOriginText(gap, app)}</p>
                </section>
                <section className="answer-gap-info-panel answer-gap-origin">
                  <h4>{app.admin.coverage}</h4>
                  <p>{coverageKindText(gap, app)}</p>
                </section>
              </div>
            </div>

            <aside className="answer-gap-side">
              <div className="answer-gap-meta-stack">
                <div className="requester-pill">
                  <span className="person-avatar blue">{requesterInitials(gap)}</span>
                  <span className="person-copy">
                    <strong>{requesterName(gap, app)}</strong>
                    <span>{accessLevelText(gap, app)}</span>
                  </span>
                </div>
                <div className="level-chip-row">
                  {gap.status === 'needs_answer' ? (
                    <span className="mini-chip strong">{app.admin.answerGapsRequiresAnswer}</span>
                  ) : null}
                  {reportScopeLabels(gap, app).map((label) => (
                    <span className="mini-chip" key={label}>
                      {label}
                    </span>
                  ))}
                  <span className="mini-chip">{formatDateTime(gap.createdAt, locale)}</span>
                </div>
              </div>
              <div className="answer-gap-actions">
                {gap.status === 'needs_answer' ? (
                  <button
                    className="fa-primary-button"
                    disabled={markingDone[gap.id] === true}
                    type="button"
                    onClick={() => {
                      void handleMarkDone(gap.id);
                    }}
                  >
                    {app.admin.markAnswerGapDone}
                  </button>
                ) : null}
                <button
                  className="fa-secondary-button"
                  type="button"
                  onClick={() => {
                    setPreviewGap(gap);
                  }}
                >
                  {app.admin.previewConversation}
                </button>
              </div>
            </aside>
          </article>
        ))}
      </div>

      <DetailSheet
        className="answer-gap-preview-sheet"
        closeLabel={app.commonActions.close}
        closePresentation="icon"
        initialFocus="close"
        open={previewGap !== null}
        title={app.admin.previewConversation}
        onClose={() => {
          setPreviewGap(null);
        }}
      >
        {previewGap === null ? null : (
          <div className="answer-gap-preview">
            <p className="answer-gap-preview-note">{app.admin.conversationPreviewSnapshotNote}</p>

            <section className="answer-gap-preview-section">
              <h3>{app.admin.gapQuestion}</h3>
              <p className="answer-gap-preview-question">{previewGap.question}</p>
            </section>

            <section className="answer-gap-preview-section">
              <h3>{app.admin.conversationPreviewContext}</h3>
              {previewGap.conversation.contextWindow.length > 0 ? (
                <ol className="answer-gap-context-list">
                  {previewGap.conversation.contextWindow.map((message, index) => (
                    <li className={`answer-gap-context-message ${message.role}`} key={index}>
                      <span>{contextRoleLabel(message.role, app)}</span>
                      <p>{message.content}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="answer-gap-empty-context">{app.admin.conversationPreviewNoContext}</p>
              )}
            </section>

            <section className="answer-gap-preview-section answer-gap-preview-missing">
              <h3>{app.admin.missingInformation}</h3>
              <div className="answer-gap-info-panel">
                <ul>
                  {previewGap.missingInformation.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="answer-gap-preview-meta-grid">
              <div className="answer-gap-info-panel answer-gap-origin">
                <h4>{app.admin.gapOrigin}</h4>
                <p>{gapOriginText(previewGap, app)}</p>
              </div>
              <div className="answer-gap-info-panel answer-gap-origin">
                <h4>{app.admin.coverage}</h4>
                <p>{coverageKindText(previewGap, app)}</p>
                <p>{accessLevelText(previewGap, app)}</p>
                <div className="level-chip-row">
                  {reportScopeLabels(previewGap, app).map((label) => (
                    <span className="mini-chip" key={label}>
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}
      </DetailSheet>

      {nextCursor === null && !loadingMore ? null : (
        <div
          aria-label={app.admin.loadingMoreGaps}
          className="admin-infinite-scroll"
          ref={loadMoreRef}
          role="status"
        >
          <p className="admin-meta-text">{loadedGapsCopy(gaps.length, totalCount, app)}</p>
          <div className="admin-continuation-rows" aria-hidden="true">
            <span />
            <span />
          </div>
          <div className="admin-load-sentinel">
            <span className="admin-spinner" aria-hidden="true" />
            <span>{app.admin.loadingMoreGaps}</span>
          </div>
        </div>
      )}
    </section>
  );
}
