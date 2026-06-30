import type { ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createConversation,
  deleteConversation,
  listConversations,
  type Conversation,
} from '../services/chatApi.js';
import { getKnowledgeSource, type KnowledgeSource } from '../services/knowledgeApi.js';
import { useI18n } from '../i18n/useI18n.js';
import { useOnlineStatus } from '../pwa/offline.js';
import { useFaAuth } from '../auth/useFaAuth.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { workspaceUserSummary } from '../ui/accountSummary.js';
import { formatDateTime } from '../ui/formatters.js';
import type { AppNavigationRole } from '../ui/appNavigation.js';
import { useDocumentTitle } from '../ui/useDocumentTitle.js';
import { ChatComposer } from './ChatComposer.js';
import { ChatMessages, MarkdownContent } from './ChatMessages.js';
import { EmptyChatStart } from './EmptyChatStart.js';
import { normalizeRecoverableErrorCopy } from './recoverableErrorCopy.js';
import { useChatWorkflow } from './useChatWorkflow.js';
import { WorkspaceShell } from './WorkspaceShell.js';

interface Route {
  key: 'chat' | 'source';
  conversationId?: string;
  starterPrompt?: string;
  sourceRef?: string;
}

function starterPromptFromParams(params: URLSearchParams): string | undefined {
  const prompt = params.get('prompt')?.trim();
  return prompt === undefined || prompt.length === 0 ? undefined : prompt;
}

function chatRoute(conversationId?: string, starterPrompt?: string): Route {
  const route: Route = { key: 'chat' };
  if (conversationId !== undefined) {
    route.conversationId = conversationId;
  }
  if (starterPrompt !== undefined) {
    route.starterPrompt = starterPrompt;
  }
  return route;
}

function sourceRoute(sourceRef: string): Route {
  return { key: 'source', sourceRef };
}

function parseHash(hash: string): Route {
  const cleanHash = hash.trim();
  const normalizedHash = cleanHash.replace(/^#\/?/, '');
  const queryIndex = normalizedHash.indexOf('?');
  const routePath = queryIndex === -1 ? normalizedHash : normalizedHash.slice(0, queryIndex);
  const params = new URLSearchParams(queryIndex === -1 ? '' : normalizedHash.slice(queryIndex + 1));
  const starterPrompt = starterPromptFromParams(params);
  const parts = routePath.split('/').filter(Boolean);
  const [section, first, second] = parts;

  if (section === 'chat') {
    if (first === 'source' && second !== undefined) {
      return sourceRoute(decodeURIComponent(second));
    }

    return first === undefined
      ? chatRoute(undefined, starterPrompt)
      : chatRoute(decodeURIComponent(first), starterPrompt);
  }

  return { key: 'chat' };
}

function routeHash(route: Route): string {
  if (route.key === 'source') {
    return `#/chat/source/${encodeURIComponent(route.sourceRef ?? '')}`;
  }

  return route.conversationId === undefined
    ? '#/chat'
    : `#/chat/${encodeURIComponent(route.conversationId)}`;
}

function navigateTo(hash: string, options: { deferHashChange?: boolean } = {}): void {
  window.history.pushState(null, '', hash);
  const dispatchHashChange = (): void => {
    window.dispatchEvent(new Event('hashchange'));
  };
  if (options.deferHashChange === true) {
    window.setTimeout(dispatchHashChange, 0);
    return;
  }

  dispatchHashChange();
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const handleHashChange = (): void => {
      const nextRoute = parseHash(window.location.hash);
      const normalizedHash = window.location.hash.trim().replace(/^#\/?/, '');
      const queryIndex = normalizedHash.indexOf('?');
      const routePath = queryIndex === -1 ? normalizedHash : normalizedHash.slice(0, queryIndex);
      if (window.location.hash === '' || routePath === 'usage') {
        window.history.replaceState(null, '', routeHash({ key: 'chat' }));
      }
      setRoute(nextRoute);
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  return route;
}

function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((left, right) =>
    right.lastMessageAt.localeCompare(left.lastMessageAt)
  );
}

function isMissingConversationError(
  error: string | null,
  conversationId: string | undefined
): boolean {
  if (error === null || conversationId === undefined) {
    return false;
  }

  return error.toLowerCase().includes('not found') && error.includes(conversationId);
}

function focusComposer(): void {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLTextAreaElement>('.fa-prompt-bar textarea')?.focus();
  });
}

const localLongRunningAnswerThresholdMs = 15_000;

function KnowledgeSourcePage({ sourceRef }: { sourceRef: string }): ReactElement {
  const { locale, messages } = useI18n();
  const copy = messages.app.chat;
  const [source, setSource] = useState<KnowledgeSource | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setError(null);
    setBusy(true);

    getKnowledgeSource(sourceRef)
      .then((nextSource) => {
        if (!cancelled) {
          setSource(nextSource);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(copy.sourceViewerLoadFailed);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [copy.sourceViewerLoadFailed, sourceRef]);

  const title = source?.title ?? copy.sourceViewerTitle;

  return (
    <section className="chat-view source-route-view" aria-labelledby="source-route-heading">
      <div className="knowledge-source-page">
        <a className="source-route-back" href="#/chat">
          {copy.sourceViewerBack}
        </a>
        <header className="knowledge-source-page-header">
          <h2 id="source-route-heading">{title}</h2>
          {source === null ? null : (
            <dl className="knowledge-source-meta">
              <div>
                <dt>{copy.sourceViewerUpdated}</dt>
                <dd>{formatDateTime(source.updatedAt, locale)}</dd>
              </div>
            </dl>
          )}
        </header>
        {busy ? (
          <p role="status" className="chat-state-panel-inline">
            {copy.sourceViewerLoading}
          </p>
        ) : null}
        {error === null ? null : (
          <p className="error-copy" role="alert">
            {error}
          </p>
        )}
        {source === null ? null : (
          <div className="markdown-body knowledge-source-content">
            <MarkdownContent markdown={source.content} />
          </div>
        )}
      </div>
    </section>
  );
}

function ChatPage({
  conversationId,
  newChatRequest,
  onConversationActivity,
  onConversationCreated,
  onNewChat,
  sourceMode,
  starterPrompt,
}: {
  conversationId: string | undefined;
  newChatRequest: number;
  onConversationActivity: () => Promise<void>;
  onConversationCreated: (conversation: Conversation) => void;
  onNewChat: () => void;
  sourceMode: 'admin' | 'user';
  starterPrompt: string | undefined;
}): ReactElement {
  const { messages } = useI18n();
  const copy = messages.app.chat;
  const online = useOnlineStatus();
  const [localStreamLongRunning, setLocalStreamLongRunning] = useState(false);
  const consumedStarterPromptRef = useRef<string | null>(null);
  const lastNewChatRequestRef = useRef(newChatRequest);

  const {
    messages: chatMessages,
    messagesStatus,
    messagesError,
    composer,
    setComposer,
    streaming,
    streamPhase,
    streamLongRunning,
    streamError,
    answerGapCandidatesByMessageId,
    answerGapActionBusyByMessageId,
    answerGapActionErrorByMessageId,
    hasStreamPreview,
    streamPreviewMessage,
    queuedFollowUp,
    handleSendMessage,
    cancelStream,
    clearQueuedFollowUp,
    editQueuedFollowUp,
    retryLastMessage,
    shareAnswerGapCandidateForMessage,
    declineAnswerGapCandidateForMessage,
    withdrawAnswerGapCandidateForMessage,
  } = useChatWorkflow({
    conversationId,
    ensureConversationId: selectedConversationId,
    onConversationActivity,
  });
  const streamPreview = hasStreamPreview
    ? streamPreviewMessage
    : streaming
      ? {
          id: streamPreviewMessage.id,
          userId: streamPreviewMessage.userId,
          conversationId: streamPreviewMessage.conversationId,
          role: streamPreviewMessage.role,
          content: '',
          createdAt: streamPreviewMessage.createdAt,
          citations: [],
          missingInformation: [],
        }
      : null;
  const visibleStreamError =
    streamError === null ? null : normalizeRecoverableErrorCopy(streamError);
  const routeHasConversation = conversationId !== undefined;
  const threadMessages =
    conversationId === undefined
      ? chatMessages
      : chatMessages.filter((message) => message.conversationId === conversationId);
  const hasOptimisticMessage = threadMessages.some((message) =>
    message.id.startsWith('optimistic-user-')
  );
  const hasActiveSendContent = hasOptimisticMessage || streamPreview !== null;
  const showStarter =
    !routeHasConversation && threadMessages.length === 0 && streamPreview === null;
  const showConversationLoading =
    routeHasConversation && messagesStatus === 'loading' && !hasActiveSendContent;
  const showConversationError =
    routeHasConversation && messagesStatus === 'error' && !hasActiveSendContent;
  const showConversationEmpty =
    routeHasConversation &&
    messagesStatus === 'ready' &&
    threadMessages.length === 0 &&
    streamPreview === null;
  const showMessageThread =
    !showStarter && !showConversationLoading && !showConversationError && !showConversationEmpty;
  const showMissingConversationRecovery = isMissingConversationError(messagesError, conversationId);
  const hasQueuedFollowUp = queuedFollowUp !== null;
  const composerHasDraft = composer.trim().length > 0;
  const composerPlaceholder = hasQueuedFollowUp
    ? copy.queuedFollowUpPlaceholder
    : routeHasConversation
      ? copy.followUpPlaceholder
      : copy.composerPlaceholder;
  const composerActionMode =
    !online || hasQueuedFollowUp
      ? 'disabled'
      : streaming
        ? composerHasDraft
          ? 'queue'
          : 'stop'
        : 'send';
  const showStreamCancel = streaming && composerActionMode !== 'stop';

  useEffect(() => {
    if (!streaming) {
      setLocalStreamLongRunning(false);
      return undefined;
    }

    setLocalStreamLongRunning(false);
    const timeoutId = window.setTimeout(() => {
      setLocalStreamLongRunning(true);
    }, localLongRunningAnswerThresholdMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [streaming]);

  useEffect(() => {
    if (lastNewChatRequestRef.current === newChatRequest) {
      return;
    }

    lastNewChatRequestRef.current = newChatRequest;
    setComposer('');
    focusComposer();
  }, [newChatRequest, setComposer]);

  useEffect(() => {
    if (starterPrompt === undefined) {
      return;
    }

    const nextHash = routeHash(chatRoute(conversationId));
    if (consumedStarterPromptRef.current === starterPrompt) {
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, '', nextHash);
      }
      return;
    }

    consumedStarterPromptRef.current = starterPrompt;
    if (composer.trim().length === 0) {
      setComposer(starterPrompt);
    }
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash);
    }
    focusComposer();
  }, [composer, conversationId, setComposer, starterPrompt]);

  async function selectedConversationId(): Promise<string> {
    if (conversationId !== undefined) {
      return conversationId;
    }

    const created = await createConversation();
    onConversationCreated(created);
    navigateTo(routeHash({ key: 'chat', conversationId: created.id }), { deferHashChange: true });
    return created.id;
  }

  function handleStarterPrompt(prompt: string): void {
    if (composer.trim().length === 0) {
      setComposer(prompt);
    }
    focusComposer();
  }

  return (
    <section
      className={showStarter ? 'chat-view chat-view-empty' : 'chat-view'}
      aria-labelledby="chat-heading"
    >
      <h2 className="sr-only" id="chat-heading">
        {copy.navLabel}
      </h2>
      {showStarter ? (
        <EmptyChatStart
          body={copy.startBody}
          composerDisabled={streaming || !online}
          composerLabel={copy.composerLabel}
          composerPlaceholder={copy.composerPlaceholder}
          composerValue={composer}
          heading={copy.startHeading}
          offlineMessage={!online ? messages.app.errors.offlineSend : undefined}
          prompts={copy.starterPrompts}
          sendLabel={copy.sendMessage}
          suggestionsLabel={copy.suggestionsLabel}
          onComposerChange={setComposer}
          onSelectPrompt={handleStarterPrompt}
          onSubmit={handleSendMessage}
        />
      ) : (
        <section className="chat-panel fa-surface">
          {showConversationLoading ? (
            <div className="chat-state-panel" role="status" aria-label={copy.conversationLoading}>
              <span>{copy.conversationLoading}</span>
            </div>
          ) : showConversationError ? (
            <div className="chat-state-panel" role="alert" aria-label={copy.conversationLoadFailed}>
              <strong>{copy.conversationLoadFailed}</strong>
              {showMissingConversationRecovery ? (
                <>
                  <span>{copy.conversationUnavailable}</span>
                  <span>{copy.conversationRecoveryHint}</span>
                  <div className="toolbar-actions">
                    <button
                      className="icon-button-label"
                      type="button"
                      onClick={() => {
                        onNewChat();
                      }}
                    >
                      {copy.newChat}
                    </button>
                  </div>
                </>
              ) : (
                <span>{messagesError ?? copy.conversationRefreshHint}</span>
              )}
            </div>
          ) : showConversationEmpty ? (
            <div
              className="chat-state-panel"
              role="status"
              aria-label={copy.conversationEmptyTitle}
            >
              <strong>{copy.conversationEmptyTitle}</strong>
              <span>{copy.conversationEmptyBody}</span>
            </div>
          ) : showMessageThread ? (
            <ChatMessages
              assistantLabel={copy.assistantName}
              draftLabel={copy.draftAnswer}
              messages={threadMessages}
              missingHeading={copy.whatIsMissing}
              longRunningLabel={copy.longRunningAnswer}
              preparingSourcesLabel={copy.preparingSources}
              cancelAnswerLabel={copy.cancelAnswer}
              failedAnswerContentLabel={copy.answerGenerationFailedBody}
              failedAnswerErrorLabel={copy.answerGenerationFailed}
              findingSourcesLabel={copy.findingSources}
              onRetryLastMessage={retryLastMessage}
              answerGapCandidatesByMessageId={answerGapCandidatesByMessageId}
              answerGapActionBusyByMessageId={answerGapActionBusyByMessageId}
              answerGapActionErrorByMessageId={answerGapActionErrorByMessageId}
              answerGapShareTitleLabel={copy.answerGapShareTitle}
              answerGapShareBodyLabel={copy.answerGapShareBody}
              answerGapShareContextLabel={copy.answerGapShareContext}
              answerGapShareContactLabel={copy.answerGapShareContact}
              answerGapShareButtonLabel={copy.answerGapShareButton}
              answerGapDeclineButtonLabel={copy.answerGapDeclineButton}
              answerGapWithdrawButtonLabel={copy.answerGapWithdrawButton}
              answerGapSharedLabel={copy.answerGapShared}
              answerGapWithdrawnLabel={copy.answerGapWithdrawn}
              answerGapActionFailedLabel={copy.answerGapActionFailed}
              onShareAnswerGapCandidate={shareAnswerGapCandidateForMessage}
              onDeclineAnswerGapCandidate={declineAnswerGapCandidateForMessage}
              onWithdrawAnswerGapCandidate={withdrawAnswerGapCandidateForMessage}
              partialDraftNoticeLabel={copy.partialDraftNotice}
              retryAnswerLabel={copy.retryAnswer}
              showAllSourcesLabel={copy.showAllSources}
              showAdditionalSourcesLabel={copy.showAdditionalSources}
              hideAdditionalSourcesLabel={copy.hideAdditionalSources}
              sourcesHeading={copy.sourcesUsed}
              sourceMode={sourceMode}
              streamError={visibleStreamError}
              streamPhase={streamPhase}
              streamLongRunning={streamLongRunning || localStreamLongRunning}
              streamPreview={streamPreview}
              showStreamCancel={showStreamCancel}
              timedOutLabel={copy.answerGenerationTimedOut}
              userLabel={copy.userName}
              writingAnswerLabel={copy.writingAnswer}
              onCancelStream={cancelStream}
            />
          ) : (
            <></>
          )}
          {!online ? <p className="offline-status">{messages.app.errors.offlineSend}</p> : null}
          <ChatComposer
            actionMode={composerActionMode}
            disabled={!online || hasQueuedFollowUp}
            label={copy.composerLabel}
            placeholder={composerPlaceholder}
            queueLabel={copy.queueFollowUp}
            queuedFollowUp={queuedFollowUp}
            editQueuedFollowUpLabel={copy.editQueuedFollowUp}
            removeQueuedFollowUpLabel={copy.removeQueuedFollowUp}
            sendLabel={copy.sendMessage}
            value={composer}
            onChange={setComposer}
            onEditQueuedFollowUp={editQueuedFollowUp}
            onRemoveQueuedFollowUp={clearQueuedFollowUp}
            onSubmit={handleSendMessage}
            {...(streaming ? { stopLabel: copy.cancelAnswer, onStop: cancelStream } : {})}
          />
        </section>
      )}
    </section>
  );
}

export function WorkspaceApp({ role = 'user' }: { role?: AppNavigationRole }): ReactElement {
  const route = useHashRoute();
  const auth = useFaAuth();
  const { messages } = useI18n();
  const shell = messages.app.shell;
  const copy = messages.app;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationPendingDelete, setConversationPendingDelete] = useState<Conversation | null>(
    null
  );
  const [newChatRequest, setNewChatRequest] = useState(0);
  const pageTitle = route.key === 'source' ? copy.chat.sourceViewerTitle : copy.chat.navLabel;

  const refreshConversations = useCallback(async (): Promise<void> => {
    const items = await listConversations();
    setConversations(sortConversations(items));
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  function handleNewChat(): void {
    setNewChatRequest((current) => current + 1);
    navigateTo(routeHash({ key: 'chat' }));
    focusComposer();
  }

  function handleConversationCreated(conversation: Conversation): void {
    setConversations((current) => sortConversations([conversation, ...current]));
  }

  function handleDeleteConversation(targetId: string): void {
    const targetConversation = conversations.find((conversation) => conversation.id === targetId);
    if (targetConversation === undefined) {
      return;
    }

    setConversationPendingDelete(targetConversation);
  }

  async function confirmDeleteConversation(): Promise<void> {
    const targetConversation = conversationPendingDelete;
    if (targetConversation === null) {
      return;
    }

    const targetId = targetConversation.id;
    await deleteConversation(targetId);
    const remaining = conversations.filter((conversation) => conversation.id !== targetId);
    setConversations(remaining);
    setConversationPendingDelete(null);

    if (targetId === route.conversationId) {
      const nextConversation = remaining[0];
      navigateTo(
        nextConversation === undefined
          ? routeHash({ key: 'chat' })
          : routeHash({ key: 'chat', conversationId: nextConversation.id })
      );
    }
  }

  const currentView =
    route.key === 'source' && route.sourceRef !== undefined ? (
      <KnowledgeSourcePage sourceRef={route.sourceRef} />
    ) : (
      <ChatPage
        conversationId={route.conversationId}
        newChatRequest={newChatRequest}
        sourceMode={role === 'admin' ? 'admin' : 'user'}
        starterPrompt={route.starterPrompt}
        onConversationActivity={refreshConversations}
        onConversationCreated={handleConversationCreated}
        onNewChat={handleNewChat}
      />
    );
  const userSummary = workspaceUserSummary(auth.accountState);
  useDocumentTitle(pageTitle);

  return (
    <WorkspaceShell
      conversations={conversations}
      deleteConversationLabel={copy.commonActions.delete}
      emptyConversationLabel={copy.chat.noConversations}
      newChatLabel={copy.chat.newChat}
      role={role}
      selectedConversationId={route.conversationId}
      skipToContentLabel={shell.skipToContent}
      untitledConversationLabel={copy.chat.untitledConversation}
      user={userSummary}
      routeForConversation={(targetConversationId) =>
        routeHash({ key: 'chat', conversationId: targetConversationId })
      }
      onDeleteConversation={handleDeleteConversation}
      onLogout={() => {
        void auth.logout();
      }}
      onNewChat={handleNewChat}
      onOpenProfile={() => {
        navigateTo('#/profile');
      }}
    >
      {currentView}
      <ConfirmDialog
        cancelLabel={copy.commonActions.cancel}
        confirmLabel={copy.commonActions.delete}
        open={conversationPendingDelete !== null}
        title={copy.chat.conversationDeleteTitle}
        onCancel={() => {
          setConversationPendingDelete(null);
        }}
        onConfirm={() => {
          void confirmDeleteConversation();
        }}
      >
        <p>
          {copy.chat.conversationDeleteBody.replace(
            '{title}',
            conversationPendingDelete?.title ?? ''
          )}
        </p>
      </ConfirmDialog>
    </WorkspaceShell>
  );
}

export default WorkspaceApp;
