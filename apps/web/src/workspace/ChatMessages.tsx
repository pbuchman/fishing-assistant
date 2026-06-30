import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import type { AnswerGapCandidate, ConversationMessage } from '../services/chatApi.js';
import { formatDateTimePl } from '../ui/formatters.js';
import { CitationList, MissingInformation } from './RagAnswerPanels.js';
import {
  normalizeRecoverableErrorCopy,
  recoverableNetworkFailureCopy,
} from './recoverableErrorCopy.js';
import type { ChatStreamPhase } from './useChatWorkflow.js';

import '@uiw/react-markdown-preview/markdown.css';

const markdownRemarkPlugins = [remarkGfm];
const markdownRehypePlugins = [rehypeSanitize, rehypeHighlight];
const failedAnswerContentFallbacks = [
  'I could not complete this answer. Please try again.',
  'Nie udało mi się dokończyć odpowiedzi. Spróbuj ponownie.',
];
const failedAnswerErrorFallbacks = [
  'Answer generation failed. Please try again.',
  'Nie udało się wygenerować odpowiedzi. Spróbuj ponownie.',
];
const chatStreamTimedOutFallback = 'Chat stream timed out';
const streamNetworkFailureFallbacks = [
  recoverableNetworkFailureCopy,
  'Connection interrupted while reading the answer. Try again when the connection is stable.',
];
const providerAbortFailurePattern = /\b(?:openrouter|minimax)\b.+\brequest was aborted\b/i;
const followScrollThresholdPx = 48;
const imageFilenamePattern = /`?\b[\w.-]{1,160}\.(?:png|jpe?g|webp|gif|svg)\b`?/gi;

export function MarkdownContent({ markdown }: { markdown: string }): ReactElement {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={markdownRemarkPlugins}
      rehypePlugins={markdownRehypePlugins}
    >
      {markdown}
    </ReactMarkdown>
  );
}

function cleanAnswerMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*]\([^)]+\)/g, '[image hidden]')
    .replace(/\[([^\]]+)]\((?:https?:\/\/|www\.)[^)]+\)/gi, '$1')
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>(){}"']+/gi, '[link hidden]')
    .replace(imageFilenamePattern, '[image hidden]')
    .replace(/\s*\[(?:S\d+)(?:\s*,\s*S\d+)*\]/g, '')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/\[link hidden]\s*([.,;:!?])?/g, '[link hidden]')
    .replace(/\[link hidden](?=\S)/g, '[link hidden] ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function localizeKnownFailureCopy(
  value: string,
  failedAnswerContentLabel: string,
  failedAnswerErrorLabel: string,
  timedOutLabel: string
): string {
  const recoverableErrorCopy = normalizeRecoverableErrorCopy(value);
  if (recoverableErrorCopy !== value) {
    return failedAnswerErrorLabel;
  }

  if (failedAnswerContentFallbacks.includes(value)) {
    return failedAnswerContentLabel;
  }

  if (
    failedAnswerErrorFallbacks.includes(value) ||
    streamNetworkFailureFallbacks.includes(value) ||
    providerAbortFailurePattern.test(value)
  ) {
    return failedAnswerErrorLabel;
  }

  if (value === chatStreamTimedOutFallback) {
    return timedOutLabel;
  }

  return value;
}

function isPartialFailedDraftMessage(message: ConversationMessage): boolean {
  return (
    message.role === 'assistant' &&
    message.streamStatus === 'failed' &&
    !failedAnswerContentFallbacks.includes(message.content) &&
    message.content.trim().length > 0
  );
}

function isFailedAnswerFallbackMessage(message: ConversationMessage): boolean {
  return (
    message.role === 'assistant' &&
    message.streamStatus === 'failed' &&
    failedAnswerContentFallbacks.includes(message.content)
  );
}

function isKnownStreamFailureCopy(
  value: string,
  failedAnswerContentLabel: string,
  failedAnswerErrorLabel: string,
  timedOutLabel: string
): boolean {
  const localized = localizeKnownFailureCopy(
    value,
    failedAnswerContentLabel,
    failedAnswerErrorLabel,
    timedOutLabel
  );
  return (
    localized === failedAnswerContentLabel ||
    localized === failedAnswerErrorLabel ||
    localized === timedOutLabel
  );
}

function distanceFromCurrentScrollBottom(thread: HTMLElement): number {
  return thread.scrollHeight - thread.clientHeight - thread.scrollTop;
}

function scrollCurrentTargetToBottom(thread: HTMLElement): void {
  thread.scrollTop = thread.scrollHeight;
}

export function MessageBubble({
  message,
  latest,
  assistantLabel,
  userLabel,
  missingHeading,
  sourcesHeading,
  showAllSourcesLabel,
  showAdditionalSourcesLabel,
  hideAdditionalSourcesLabel,
  failedAnswerContentLabel,
  failedAnswerErrorLabel,
  timedOutLabel,
  partialDraftNoticeLabel,
  sourceMode,
  showInlineErrorCopy,
  answerGapCandidate,
  answerGapActionBusy,
  answerGapActionError,
  answerGapShareTitleLabel,
  answerGapShareBodyLabel,
  answerGapShareContextLabel,
  answerGapShareContactLabel,
  answerGapShareButtonLabel,
  answerGapDeclineButtonLabel,
  answerGapWithdrawButtonLabel,
  answerGapSharedLabel,
  answerGapWithdrawnLabel,
  answerGapActionFailedLabel,
  onShareAnswerGapCandidate,
  onDeclineAnswerGapCandidate,
  onWithdrawAnswerGapCandidate,
}: {
  message: ConversationMessage;
  latest?: boolean | undefined;
  assistantLabel: string;
  userLabel: string;
  missingHeading: string;
  sourcesHeading: string;
  showAllSourcesLabel: string;
  showAdditionalSourcesLabel?: string | undefined;
  hideAdditionalSourcesLabel?: string | undefined;
  failedAnswerContentLabel: string;
  failedAnswerErrorLabel: string;
  timedOutLabel: string;
  partialDraftNoticeLabel: string;
  sourceMode?: 'admin' | 'user' | undefined;
  showInlineErrorCopy?: boolean | undefined;
  answerGapCandidate?: AnswerGapCandidate | undefined;
  answerGapActionBusy?: boolean | undefined;
  answerGapActionError?: string | null | undefined;
  answerGapShareTitleLabel: string;
  answerGapShareBodyLabel: string;
  answerGapShareContextLabel: string;
  answerGapShareContactLabel: string;
  answerGapShareButtonLabel: string;
  answerGapDeclineButtonLabel: string;
  answerGapWithdrawButtonLabel: string;
  answerGapSharedLabel: string;
  answerGapWithdrawnLabel: string;
  answerGapActionFailedLabel: string;
  onShareAnswerGapCandidate?:
    | ((
        messageId: string,
        input: { includeContext: boolean; includeContact: boolean }
      ) => void | Promise<void>)
    | undefined;
  onDeclineAnswerGapCandidate?: ((messageId: string) => void | Promise<void>) | undefined;
  onWithdrawAnswerGapCandidate?: ((messageId: string) => void | Promise<void>) | undefined;
}): ReactElement {
  const messageContent =
    message.role === 'assistant'
      ? localizeKnownFailureCopy(
          message.content,
          failedAnswerContentLabel,
          failedAnswerErrorLabel,
          timedOutLabel
        )
      : message.content;
  const errorMessage =
    message.errorMessage === undefined
      ? undefined
      : localizeKnownFailureCopy(
          message.errorMessage,
          failedAnswerContentLabel,
          failedAnswerErrorLabel,
          timedOutLabel
        );
  const displayMarkdown =
    message.role === 'assistant' ? cleanAnswerMarkdown(messageContent) : messageContent;
  const isPartialFailedDraft = isPartialFailedDraftMessage(message);

  return (
    <article
      className={`message-bubble ${message.role}`}
      data-latest-message={latest ? 'true' : undefined}
    >
      <div className="message-meta">
        <span>{message.role === 'assistant' ? assistantLabel : userLabel}</span>
        <span>{message.createdAt.length === 0 ? '' : formatDateTimePl(message.createdAt)}</span>
      </div>
      <div className="markdown-body">
        <MarkdownContent markdown={displayMarkdown} />
      </div>
      {isPartialFailedDraft && <p className="partial-draft-copy">{partialDraftNoticeLabel}</p>}
      {message.streamStatus === 'failed' &&
        errorMessage !== undefined &&
        !isPartialFailedDraft &&
        showInlineErrorCopy !== false && <p className="error-copy">{errorMessage}</p>}
      <MissingInformation heading={missingHeading} items={message.missingInformation} />
      {message.role === 'assistant' && answerGapCandidate !== undefined ? (
        <AnswerGapSharePanel
          actionBusy={answerGapActionBusy === true}
          actionError={answerGapActionError ?? null}
          actionFailedLabel={answerGapActionFailedLabel}
          bodyLabel={answerGapShareBodyLabel}
          candidate={answerGapCandidate}
          contextLabel={answerGapShareContextLabel}
          contactLabel={answerGapShareContactLabel}
          declineButtonLabel={answerGapDeclineButtonLabel}
          messageId={message.id}
          shareButtonLabel={answerGapShareButtonLabel}
          sharedLabel={answerGapSharedLabel}
          titleLabel={answerGapShareTitleLabel}
          withdrawButtonLabel={answerGapWithdrawButtonLabel}
          withdrawnLabel={answerGapWithdrawnLabel}
          onDecline={onDeclineAnswerGapCandidate}
          onShare={onShareAnswerGapCandidate}
          onWithdraw={onWithdrawAnswerGapCandidate}
        />
      ) : null}
      <CitationList
        heading={sourcesHeading}
        message={message}
        showAllLabel={showAllSourcesLabel}
        showAdditionalSourcesLabel={showAdditionalSourcesLabel}
        hideAdditionalSourcesLabel={hideAdditionalSourcesLabel}
        sourceMode={sourceMode}
      />
    </article>
  );
}

function AnswerGapSharePanel({
  actionBusy,
  actionError,
  actionFailedLabel,
  bodyLabel,
  candidate,
  contextLabel,
  contactLabel,
  declineButtonLabel,
  messageId,
  shareButtonLabel,
  sharedLabel,
  titleLabel,
  withdrawButtonLabel,
  withdrawnLabel,
  onDecline,
  onShare,
  onWithdraw,
}: {
  actionBusy: boolean;
  actionError: string | null;
  actionFailedLabel: string;
  bodyLabel: string;
  candidate: AnswerGapCandidate;
  contextLabel: string;
  contactLabel: string;
  declineButtonLabel: string;
  messageId: string;
  shareButtonLabel: string;
  sharedLabel: string;
  titleLabel: string;
  withdrawButtonLabel: string;
  withdrawnLabel: string;
  onDecline?: ((messageId: string) => void | Promise<void>) | undefined;
  onShare?:
    | ((
        messageId: string,
        input: { includeContext: boolean; includeContact: boolean }
      ) => void | Promise<void>)
    | undefined;
  onWithdraw?: ((messageId: string) => void | Promise<void>) | undefined;
}): ReactElement | null {
  const [includeContext, setIncludeContext] = useState(false);
  const [includeContact, setIncludeContact] = useState(false);

  if (candidate.status === 'shared') {
    return (
      <section className="answer-gap-share-panel resolved" aria-label={titleLabel}>
        <p>{sharedLabel}</p>
        {actionError === null ? null : <p className="error-copy">{actionFailedLabel}</p>}
        <button
          className="fa-secondary-button"
          disabled={actionBusy || onWithdraw === undefined}
          type="button"
          onClick={() => {
            void onWithdraw?.(messageId);
          }}
        >
          {withdrawButtonLabel}
        </button>
      </section>
    );
  }

  if (candidate.status === 'withdrawn') {
    return <p className="answer-gap-share-panel resolved">{withdrawnLabel}</p>;
  }

  if (candidate.status !== 'pending_user_consent') {
    return null;
  }

  return (
    <section className="answer-gap-share-panel" aria-label={titleLabel}>
      <div>
        <h3>{titleLabel}</h3>
        <p>{bodyLabel}</p>
      </div>
      <div className="answer-gap-share-options">
        <label>
          <input
            checked={includeContext}
            disabled={actionBusy}
            type="checkbox"
            onChange={(event) => {
              setIncludeContext(event.currentTarget.checked);
            }}
          />
          <span>{contextLabel}</span>
        </label>
        <label>
          <input
            checked={includeContact}
            disabled={actionBusy}
            type="checkbox"
            onChange={(event) => {
              setIncludeContact(event.currentTarget.checked);
            }}
          />
          <span>{contactLabel}</span>
        </label>
      </div>
      {actionError === null ? null : <p className="error-copy">{actionFailedLabel}</p>}
      <div className="answer-gap-share-actions">
        <button
          className="fa-primary-button"
          disabled={actionBusy || onShare === undefined}
          type="button"
          onClick={() => {
            void onShare?.(messageId, { includeContext, includeContact });
          }}
        >
          {shareButtonLabel}
        </button>
        <button
          className="fa-secondary-button"
          disabled={actionBusy || onDecline === undefined}
          type="button"
          onClick={() => {
            void onDecline?.(messageId);
          }}
        >
          {declineButtonLabel}
        </button>
      </div>
    </section>
  );
}

export function ChatMessages({
  messages,
  streamPreview,
  streamError,
  assistantLabel,
  userLabel,
  missingHeading,
  sourcesHeading,
  showAllSourcesLabel,
  showAdditionalSourcesLabel,
  hideAdditionalSourcesLabel,
  draftLabel,
  streamPhase,
  findingSourcesLabel,
  writingAnswerLabel,
  preparingSourcesLabel,
  streamLongRunning,
  longRunningLabel,
  cancelAnswerLabel,
  showStreamCancel = false,
  failedAnswerContentLabel,
  failedAnswerErrorLabel,
  timedOutLabel,
  partialDraftNoticeLabel,
  retryAnswerLabel,
  onRetryLastMessage,
  onCancelStream,
  sourceMode,
  answerGapCandidatesByMessageId = {},
  answerGapActionBusyByMessageId = {},
  answerGapActionErrorByMessageId = {},
  answerGapShareTitleLabel,
  answerGapShareBodyLabel,
  answerGapShareContextLabel,
  answerGapShareContactLabel,
  answerGapShareButtonLabel,
  answerGapDeclineButtonLabel,
  answerGapWithdrawButtonLabel,
  answerGapSharedLabel,
  answerGapWithdrawnLabel,
  answerGapActionFailedLabel,
  onShareAnswerGapCandidate,
  onDeclineAnswerGapCandidate,
  onWithdrawAnswerGapCandidate,
}: {
  messages: ConversationMessage[];
  streamPreview: ConversationMessage | null;
  streamError: string | null;
  assistantLabel: string;
  userLabel: string;
  missingHeading: string;
  sourcesHeading: string;
  showAllSourcesLabel: string;
  showAdditionalSourcesLabel?: string | undefined;
  hideAdditionalSourcesLabel?: string | undefined;
  draftLabel: string;
  streamPhase: ChatStreamPhase;
  findingSourcesLabel: string;
  writingAnswerLabel: string;
  preparingSourcesLabel: string;
  streamLongRunning: boolean;
  longRunningLabel: string;
  cancelAnswerLabel?: string | undefined;
  showStreamCancel?: boolean | undefined;
  failedAnswerContentLabel: string;
  failedAnswerErrorLabel: string;
  timedOutLabel: string;
  partialDraftNoticeLabel: string;
  retryAnswerLabel: string;
  onRetryLastMessage?: (() => void | Promise<void>) | undefined;
  onCancelStream?: (() => void) | undefined;
  sourceMode?: 'admin' | 'user' | undefined;
  answerGapCandidatesByMessageId?: Record<string, AnswerGapCandidate> | undefined;
  answerGapActionBusyByMessageId?: Record<string, boolean> | undefined;
  answerGapActionErrorByMessageId?: Record<string, string | null> | undefined;
  answerGapShareTitleLabel: string;
  answerGapShareBodyLabel: string;
  answerGapShareContextLabel: string;
  answerGapShareContactLabel: string;
  answerGapShareButtonLabel: string;
  answerGapDeclineButtonLabel: string;
  answerGapWithdrawButtonLabel: string;
  answerGapSharedLabel: string;
  answerGapWithdrawnLabel: string;
  answerGapActionFailedLabel: string;
  onShareAnswerGapCandidate?:
    | ((
        messageId: string,
        input: { includeContext: boolean; includeContact: boolean }
      ) => void | Promise<void>)
    | undefined;
  onDeclineAnswerGapCandidate?: ((messageId: string) => void | Promise<void>) | undefined;
  onWithdrawAnswerGapCandidate?: ((messageId: string) => void | Promise<void>) | undefined;
}): ReactElement {
  const threadRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowOutputRef = useRef(true);
  const streamHasContent = streamPreview !== null && streamPreview.content.trim().length > 0;
  const localizedStreamError =
    streamError === null
      ? null
      : localizeKnownFailureCopy(
          streamError,
          failedAnswerContentLabel,
          failedAnswerErrorLabel,
          timedOutLabel
        );
  const latestMessage = messages.length === 0 ? undefined : messages[messages.length - 1];
  const latestFailedFallbackMessage =
    latestMessage !== undefined && isFailedAnswerFallbackMessage(latestMessage)
      ? latestMessage
      : null;
  const latestFailedFallbackError =
    latestFailedFallbackMessage?.errorMessage === undefined
      ? null
      : localizeKnownFailureCopy(
          latestFailedFallbackMessage.errorMessage,
          failedAnswerContentLabel,
          failedAnswerErrorLabel,
          timedOutLabel
        );
  const suppressGenericStreamError =
    streamError !== null &&
    latestMessage !== undefined &&
    isPartialFailedDraftMessage(latestMessage) &&
    isKnownStreamFailureCopy(
      streamError,
      failedAnswerContentLabel,
      failedAnswerErrorLabel,
      timedOutLabel
    );
  const displayedStreamError = suppressGenericStreamError
    ? null
    : (localizedStreamError ?? latestFailedFallbackError);
  const conversationKey = useMemo(() => {
    const latestConversationId =
      streamPreview?.conversationId ?? messages[messages.length - 1]?.conversationId;

    return latestConversationId ?? 'blank';
  }, [messages, streamPreview?.conversationId]);
  const updateFollowScrollState = useCallback(() => {
    const thread = threadRef.current;
    if (thread === null) {
      return;
    }

    const distanceFromBottom = distanceFromCurrentScrollBottom(thread);
    shouldFollowOutputRef.current = distanceFromBottom <= followScrollThresholdPx;
  }, []);

  useLayoutEffect(() => {
    shouldFollowOutputRef.current = true;
  }, [conversationKey]);

  useLayoutEffect(() => {
    const thread = threadRef.current;
    if (thread === null || !shouldFollowOutputRef.current) {
      return;
    }

    scrollCurrentTargetToBottom(thread);
  }, [
    displayedStreamError,
    messages.length,
    streamPreview?.content,
    streamPreview?.missingInformation.length,
    streamPreview?.citations.length,
  ]);

  const streamStatusLabel =
    streamPhase === 'preparing_sources'
      ? preparingSourcesLabel
      : streamLongRunning
        ? longRunningLabel
        : streamPhase === 'retrieving' || streamPhase === 'starting'
          ? findingSourcesLabel
          : writingAnswerLabel;
  const showStreamStatus = !streamHasContent || streamPhase === 'preparing_sources';
  const streamStatus = (
    <div className="stream-thinking" role="status" aria-label={streamStatusLabel}>
      <span className="stream-status-pulse" aria-hidden="true" />
      <span className="stream-status-copy">{streamStatusLabel}</span>
      {showStreamCancel && onCancelStream !== undefined && cancelAnswerLabel !== undefined ? (
        <button className="stream-cancel-button" type="button" onClick={onCancelStream}>
          {cancelAnswerLabel}
        </button>
      ) : null}
    </div>
  );

  return (
    <div
      className="message-thread"
      aria-live={streamPreview !== null ? 'polite' : undefined}
      onScroll={updateFollowScrollState}
      ref={threadRef}
    >
      {messages.map((message, index) => (
        <MessageBubble
          assistantLabel={assistantLabel}
          key={message.id}
          latest={index === messages.length - 1}
          message={message}
          missingHeading={missingHeading}
          failedAnswerContentLabel={failedAnswerContentLabel}
          failedAnswerErrorLabel={failedAnswerErrorLabel}
          timedOutLabel={timedOutLabel}
          partialDraftNoticeLabel={partialDraftNoticeLabel}
          showInlineErrorCopy={message.id !== latestFailedFallbackMessage?.id}
          answerGapCandidate={answerGapCandidatesByMessageId[message.id]}
          answerGapActionBusy={answerGapActionBusyByMessageId[message.id]}
          answerGapActionError={answerGapActionErrorByMessageId[message.id]}
          answerGapShareTitleLabel={answerGapShareTitleLabel}
          answerGapShareBodyLabel={answerGapShareBodyLabel}
          answerGapShareContextLabel={answerGapShareContextLabel}
          answerGapShareContactLabel={answerGapShareContactLabel}
          answerGapShareButtonLabel={answerGapShareButtonLabel}
          answerGapDeclineButtonLabel={answerGapDeclineButtonLabel}
          answerGapWithdrawButtonLabel={answerGapWithdrawButtonLabel}
          answerGapSharedLabel={answerGapSharedLabel}
          answerGapWithdrawnLabel={answerGapWithdrawnLabel}
          answerGapActionFailedLabel={answerGapActionFailedLabel}
          onShareAnswerGapCandidate={onShareAnswerGapCandidate}
          onDeclineAnswerGapCandidate={onDeclineAnswerGapCandidate}
          onWithdrawAnswerGapCandidate={onWithdrawAnswerGapCandidate}
          showAllSourcesLabel={showAllSourcesLabel}
          showAdditionalSourcesLabel={showAdditionalSourcesLabel}
          hideAdditionalSourcesLabel={hideAdditionalSourcesLabel}
          sourcesHeading={sourcesHeading}
          userLabel={userLabel}
          sourceMode={sourceMode}
        />
      ))}
      {streamPreview !== null && (
        <article className="message-bubble assistant streaming">
          <div className="message-meta">
            <span>{assistantLabel}</span>
            <span>{draftLabel}</span>
          </div>
          {streamHasContent ? (
            <>
              <div className="markdown-body">
                <MarkdownContent markdown={cleanAnswerMarkdown(streamPreview.content)} />
              </div>
              {showStreamStatus ? streamStatus : null}
            </>
          ) : (
            streamStatus
          )}
          <MissingInformation heading={missingHeading} items={streamPreview.missingInformation} />
          <CitationList
            heading={sourcesHeading}
            message={streamPreview}
            showAllLabel={showAllSourcesLabel}
            showAdditionalSourcesLabel={showAdditionalSourcesLabel}
            hideAdditionalSourcesLabel={hideAdditionalSourcesLabel}
            sourceMode={sourceMode}
          />
        </article>
      )}
      {displayedStreamError !== null && (
        <div className="stream-error-panel" role="alert" aria-label={failedAnswerErrorLabel}>
          <strong>{failedAnswerErrorLabel}</strong>
          {displayedStreamError === failedAnswerErrorLabel ? null : <p>{displayedStreamError}</p>}
          {onRetryLastMessage === undefined ? null : (
            <button
              className="fa-secondary-button"
              type="button"
              onClick={() => {
                void onRetryLastMessage();
              }}
            >
              {retryAnswerLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
