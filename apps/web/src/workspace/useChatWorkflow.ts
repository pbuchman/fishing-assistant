import { useEffect, useMemo, useRef, useState } from 'react';

import {
  declineAnswerGapCandidate,
  listConversationMessages,
  shareAnswerGapCandidate,
  streamConversationMessage,
  withdrawAnswerGapCandidate,
  type AnswerGapCandidate,
  type ChatStreamEvent,
  type Citation,
  type ConversationMessage,
  type RetrievalEvidenceSummary,
  type ShareAnswerGapCandidateInput,
} from '../services/chatApi.js';
import {
  normalizeRecoverableErrorCopy,
  recoverableNetworkFailureCopy,
} from './recoverableErrorCopy.js';

interface ChatWorkflowServices {
  listConversationMessages?: typeof listConversationMessages;
  streamConversationMessage?: typeof streamConversationMessage;
  shareAnswerGapCandidate?: typeof shareAnswerGapCandidate;
  declineAnswerGapCandidate?: typeof declineAnswerGapCandidate;
  withdrawAnswerGapCandidate?: typeof withdrawAnswerGapCandidate;
}

export interface UseChatWorkflowOptions {
  conversationId: string | undefined;
  ensureConversationId: () => Promise<string>;
  onConversationActivity?: (conversationId: string) => void | Promise<void>;
  services?: ChatWorkflowServices;
}

export type ChatStreamPhase = 'starting' | 'retrieving' | 'writing' | 'preparing_sources';

export interface UseChatWorkflowResult {
  messages: ConversationMessage[];
  messagesStatus: 'idle' | 'loading' | 'ready' | 'error';
  messagesError: string | null;
  composer: string;
  setComposer: (value: string) => void;
  streaming: boolean;
  streamPhase: ChatStreamPhase;
  streamLongRunning: boolean;
  streamDraft: string;
  streamCitations: Citation[];
  streamEvidence: RetrievalEvidenceSummary[];
  streamMissing: string[];
  streamError: string | null;
  answerGapCandidatesByMessageId: Record<string, AnswerGapCandidate>;
  answerGapActionBusyByMessageId: Record<string, boolean>;
  answerGapActionErrorByMessageId: Record<string, string | null>;
  hasStreamPreview: boolean;
  streamPreviewMessage: ConversationMessage;
  queuedFollowUp: string | null;
  handleSendMessage: () => Promise<void>;
  cancelStream: () => void;
  clearQueuedFollowUp: () => void;
  editQueuedFollowUp: () => void;
  retryLastMessage: () => Promise<void>;
  shareAnswerGapCandidateForMessage: (
    messageId: string,
    input: ShareAnswerGapCandidateInput
  ) => Promise<void>;
  declineAnswerGapCandidateForMessage: (messageId: string) => Promise<void>;
  withdrawAnswerGapCandidateForMessage: (messageId: string) => Promise<void>;
}

const streamLongRunningThresholdMs = 15_000;

function visibleErrorMessage(message: string): string {
  return normalizeRecoverableErrorCopy(message);
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Request failed.';
  }

  if (error instanceof TypeError) {
    return recoverableNetworkFailureCopy;
  }

  return visibleErrorMessage(error.message);
}

function mergeLoadedMessages(
  conversationId: string,
  loadedMessages: ConversationMessage[],
  currentMessages: ConversationMessage[]
): ConversationMessage[] {
  const loadedMessageIds = new Set(loadedMessages.map((message) => message.id));
  const currentConversationMessages = currentMessages.filter(
    (message) => message.conversationId === conversationId && !loadedMessageIds.has(message.id)
  );

  return [...loadedMessages, ...currentConversationMessages];
}

function hasAssistantAfterMessage(
  messages: ConversationMessage[],
  messageId: string | undefined
): boolean {
  if (messageId === undefined) {
    return false;
  }

  const userMessageIndex = messages.findIndex(
    (message) => message.id === messageId && message.role === 'user'
  );
  if (userMessageIndex === -1) {
    return false;
  }

  return messages.slice(userMessageIndex + 1).some((message) => message.role === 'assistant');
}

function latestFailedAssistantPrompt(messages: ConversationMessage[]): string | undefined {
  const latestMessage = messages[messages.length - 1];
  if (latestMessage?.role !== 'assistant' || latestMessage.streamStatus !== 'failed') {
    return undefined;
  }

  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user' && message.content.trim().length > 0) {
      return message.content;
    }
  }

  return undefined;
}

function appendOrReplaceMessageById(
  currentMessages: ConversationMessage[],
  message: ConversationMessage,
  activeConversationId: string | undefined
): ConversationMessage[] {
  if (activeConversationId !== undefined && message.conversationId !== activeConversationId) {
    return currentMessages;
  }

  const existingMessageIndex = currentMessages.findIndex(
    (currentMessage) => currentMessage.id === message.id
  );
  if (existingMessageIndex === -1) {
    return [...currentMessages, message];
  }

  const nextMessages = [...currentMessages];
  nextMessages[existingMessageIndex] = message;
  return nextMessages;
}

function appendEvidenceByKey(
  currentEvidence: RetrievalEvidenceSummary[],
  evidence: RetrievalEvidenceSummary | undefined
): RetrievalEvidenceSummary[] {
  if (evidence === undefined) {
    return currentEvidence;
  }

  const evidenceKey = `${evidence.sourceId}\u0000${evidence.id}`;
  if (currentEvidence.some((current) => `${current.sourceId}\u0000${current.id}` === evidenceKey)) {
    return currentEvidence;
  }

  return [...currentEvidence, evidence];
}

export function useChatWorkflow({
  conversationId,
  ensureConversationId,
  onConversationActivity,
  services,
}: UseChatWorkflowOptions): UseChatWorkflowResult {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messagesStatus, setMessagesStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    conversationId === undefined ? 'idle' : 'loading'
  );
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [composer, setComposer] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<ChatStreamPhase>('starting');
  const [streamLongRunning, setStreamLongRunning] = useState(false);
  const [streamDraft, setStreamDraft] = useState('');
  const [streamCitations, setStreamCitations] = useState<Citation[]>([]);
  const [streamEvidence, setStreamEvidence] = useState<RetrievalEvidenceSummary[]>([]);
  const [streamMissing, setStreamMissing] = useState<string[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [answerGapCandidatesByMessageId, setAnswerGapCandidatesByMessageId] = useState<
    Record<string, AnswerGapCandidate>
  >({});
  const [answerGapActionBusyByMessageId, setAnswerGapActionBusyByMessageId] = useState<
    Record<string, boolean>
  >({});
  const [answerGapActionErrorByMessageId, setAnswerGapActionErrorByMessageId] = useState<
    Record<string, string | null>
  >({});
  const [queuedFollowUp, setQueuedFollowUp] = useState<string | null>(null);
  const [streamConversationId, setStreamConversationId] = useState<string | undefined>(undefined);
  const [streamStartedFromBlankRoute, setStreamStartedFromBlankRoute] = useState(false);
  const [optimisticUserMessage, setOptimisticUserMessage] = useState<ConversationMessage | null>(
    null
  );
  const servicesRef = useRef({
    listConversationMessages,
    streamConversationMessage,
    shareAnswerGapCandidate,
    declineAnswerGapCandidate,
    withdrawAnswerGapCandidate,
  });
  const ensureConversationIdRef = useRef(ensureConversationId);
  const onConversationActivityRef = useRef(onConversationActivity);
  const activeConversationIdRef = useRef(conversationId);
  const streamRunIdRef = useRef(0);
  const streamInFlightRef = useRef(false);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const lastSubmittedMessageRef = useRef<string | null>(null);
  const queuedFollowUpRef = useRef<string | null>(null);
  const pendingAnswerGapCandidateRef = useRef<AnswerGapCandidate | null>(null);

  servicesRef.current = {
    listConversationMessages: services?.listConversationMessages ?? listConversationMessages,
    streamConversationMessage: services?.streamConversationMessage ?? streamConversationMessage,
    shareAnswerGapCandidate: services?.shareAnswerGapCandidate ?? shareAnswerGapCandidate,
    declineAnswerGapCandidate: services?.declineAnswerGapCandidate ?? declineAnswerGapCandidate,
    withdrawAnswerGapCandidate: services?.withdrawAnswerGapCandidate ?? withdrawAnswerGapCandidate,
  };
  ensureConversationIdRef.current = ensureConversationId;
  onConversationActivityRef.current = onConversationActivity;
  activeConversationIdRef.current = conversationId;

  const pendingBlankStreamVisible =
    streamConversationId === undefined &&
    conversationId === undefined &&
    streamStartedFromBlankRoute;
  const streamVisible =
    streamConversationId !== undefined &&
    (conversationId === streamConversationId ||
      (conversationId === undefined && streamStartedFromBlankRoute));
  const streamDisplayVisible = pendingBlankStreamVisible || streamVisible;
  const streamOperationVisible = streaming && (pendingBlankStreamVisible || streamVisible);
  const streamErrorVisible = streamError !== null && (pendingBlankStreamVisible || streamVisible);

  function setQueuedFollowUpValue(value: string | null): void {
    queuedFollowUpRef.current = value;
    setQueuedFollowUp(value);
  }

  useEffect(() => {
    let active = true;

    if (conversationId === undefined) {
      setMessages([]);
      setMessagesStatus('idle');
      setMessagesError(null);
      return () => {
        active = false;
      };
    }

    setMessagesStatus('loading');
    setMessagesError(null);

    void servicesRef.current
      .listConversationMessages(conversationId)
      .then((loadedMessages) => {
        if (active) {
          setMessages((currentMessages) =>
            mergeLoadedMessages(conversationId, loadedMessages, currentMessages)
          );
          setMessagesStatus('ready');
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setMessagesError(errorMessage(error));
          setMessagesStatus('error');
        }
      });

    return () => {
      active = false;
    };
  }, [conversationId]);

  useEffect(() => {
    if (streamConversationId === undefined) {
      if (streamStartedFromBlankRoute && conversationId !== undefined) {
        if (streamInFlightRef.current) {
          return;
        }
        streamRunIdRef.current += 1;
        streamInFlightRef.current = false;
        streamAbortControllerRef.current?.abort();
        streamAbortControllerRef.current = null;
        setStreaming(false);
        setStreamPhase('starting');
        setStreamLongRunning(false);
        setStreamStartedFromBlankRoute(false);
        setStreamDraft('');
        setStreamCitations([]);
        setStreamEvidence([]);
        setStreamMissing([]);
        setStreamError(null);
        pendingAnswerGapCandidateRef.current = null;
        setOptimisticUserMessage(null);
      }
      return;
    }

    if (conversationId === streamConversationId) {
      if (streamStartedFromBlankRoute) {
        setStreamStartedFromBlankRoute(false);
      }
      return;
    }

    if (conversationId === undefined && streamStartedFromBlankRoute) {
      return;
    }

    streamRunIdRef.current += 1;
    streamInFlightRef.current = false;
    streamAbortControllerRef.current?.abort();
    streamAbortControllerRef.current = null;
    setStreaming(false);
    setStreamPhase('starting');
    setStreamLongRunning(false);
    setStreamConversationId(undefined);
    setStreamStartedFromBlankRoute(false);
    setStreamDraft('');
    setStreamCitations([]);
    setStreamEvidence([]);
    setStreamMissing([]);
    setStreamError(null);
    pendingAnswerGapCandidateRef.current = null;
    setOptimisticUserMessage(null);
  }, [conversationId, streamConversationId, streamStartedFromBlankRoute]);

  useEffect(
    () => () => {
      streamRunIdRef.current += 1;
      streamInFlightRef.current = false;
      streamAbortControllerRef.current?.abort();
      streamAbortControllerRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (!streaming) {
      setStreamLongRunning(false);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setStreamLongRunning(true);
    }, streamLongRunningThresholdMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [streaming]);

  function applyStreamEvent(event: ChatStreamEvent): void {
    if (event.type === 'message.created') {
      if (event.data.role === 'user') {
        setOptimisticUserMessage((current) =>
          current !== null && current.content === event.data.content ? null : current
        );
        setStreamPhase('retrieving');
      }
      setMessages((currentMessages) =>
        appendOrReplaceMessageById(currentMessages, event.data, activeConversationIdRef.current)
      );
      return;
    }

    if (event.type === 'retrieval.started') {
      setStreamPhase('retrieving');
      return;
    }

    if (event.type === 'retrieval.completed') {
      setStreamPhase('writing');
      return;
    }

    if (event.type === 'answer.started') {
      setStreamPhase('writing');
      setStreamDraft('');
      return;
    }

    if (event.type === 'answer.delta') {
      setStreamPhase('writing');
      setStreamLongRunning(false);
      setStreamDraft((current) => `${current}${event.data.text}`);
      return;
    }

    if (event.type === 'answer.progress') {
      if (event.data.status === 'preparing_sources') {
        setStreamPhase('preparing_sources');
        setStreamLongRunning(false);
        return;
      }

      setStreamLongRunning(true);
      return;
    }

    if (event.type === 'answer.citation') {
      setStreamCitations((current) => [...current, event.data.citation]);
      setStreamEvidence((current) => appendEvidenceByKey(current, event.data.evidence));
      return;
    }

    if (event.type === 'answer.missing_info') {
      setStreamMissing(event.data.missingInformation);
      return;
    }

    if (event.type === 'answer.gap_candidate') {
      pendingAnswerGapCandidateRef.current = event.data.candidate;
      return;
    }

    if (event.type === 'answer.final') {
      const pendingAnswerGapCandidate = pendingAnswerGapCandidateRef.current;
      if (pendingAnswerGapCandidate !== null && event.data.streamStatus === 'completed') {
        setAnswerGapCandidatesByMessageId((current) => ({
          ...current,
          [event.data.id]: pendingAnswerGapCandidate,
        }));
      }
      pendingAnswerGapCandidateRef.current = null;
      setMessages((currentMessages) =>
        appendOrReplaceMessageById(currentMessages, event.data, activeConversationIdRef.current)
      );
      setOptimisticUserMessage(null);
      setStreamPhase('starting');
      setStreamLongRunning(false);
      setStreamDraft('');
      setStreamCitations([]);
      setStreamEvidence([]);
      setStreamMissing([]);
      setStreamError(
        event.data.streamStatus === 'failed' && event.data.errorMessage !== undefined
          ? visibleErrorMessage(event.data.errorMessage)
          : null
      );
      setStreamStartedFromBlankRoute(false);
      return;
    }

    if (event.type === 'error') {
      setStreaming(false);
      streamInFlightRef.current = false;
      setStreamPhase('starting');
      setStreamLongRunning(false);
      setStreamDraft('');
      setStreamCitations([]);
      setStreamEvidence([]);
      setStreamMissing([]);
      pendingAnswerGapCandidateRef.current = null;
      setStreamError(visibleErrorMessage(event.data.message));
    }
  }

  async function submitMessageText(
    submittedMessage: string,
    options: { conversationIdOverride?: string } = {}
  ): Promise<void> {
    if (submittedMessage.length === 0 || streamInFlightRef.current) {
      return;
    }

    lastSubmittedMessageRef.current = submittedMessage;
    let targetConversationId: string | undefined;
    const streamResult = { completedSuccessfully: false };
    const streamAcceptedUserMessage = { current: false, id: undefined as string | undefined };
    const runId = streamRunIdRef.current + 1;
    const abortController = new AbortController();
    const startedConversationId = options.conversationIdOverride ?? activeConversationIdRef.current;
    const startedFromBlankRoute =
      options.conversationIdOverride === undefined && startedConversationId === undefined;
    streamInFlightRef.current = true;
    streamRunIdRef.current = runId;
    streamAbortControllerRef.current?.abort();
    streamAbortControllerRef.current = abortController;

    setComposer('');
    setStreaming(true);
    setStreamPhase('starting');
    setStreamLongRunning(false);
    setStreamConversationId(startedConversationId);
    setStreamStartedFromBlankRoute(startedFromBlankRoute);
    setStreamDraft('');
    setStreamCitations([]);
    setStreamEvidence([]);
    setStreamMissing([]);
    setStreamError(null);
    pendingAnswerGapCandidateRef.current = null;
    setOptimisticUserMessage({
      id: `optimistic-user-${String(runId)}`,
      userId: 'user-preview',
      conversationId: startedConversationId ?? 'pending',
      role: 'user',
      content: submittedMessage,
      createdAt: new Date().toISOString(),
      citations: [],
      missingInformation: [],
    });

    try {
      const ensuredConversationId =
        options.conversationIdOverride ?? (await ensureConversationIdRef.current());
      if (
        startedFromBlankRoute &&
        activeConversationIdRef.current !== undefined &&
        activeConversationIdRef.current !== ensuredConversationId
      ) {
        streamRunIdRef.current += 1;
        streamInFlightRef.current = false;
        streamAbortControllerRef.current.abort();
        streamAbortControllerRef.current = null;
        setStreaming(false);
        setStreamPhase('starting');
        setStreamLongRunning(false);
        setStreamStartedFromBlankRoute(false);
        setStreamDraft('');
        setStreamCitations([]);
        setStreamEvidence([]);
        setStreamMissing([]);
        setStreamError(null);
        pendingAnswerGapCandidateRef.current = null;
        setOptimisticUserMessage(null);
        return;
      }
      targetConversationId = ensuredConversationId;
      if (streamRunIdRef.current !== runId) {
        return;
      }

      setOptimisticUserMessage((current) =>
        current === null ? current : { ...current, conversationId: ensuredConversationId }
      );
      setStreamConversationId(ensuredConversationId);

      await servicesRef.current.streamConversationMessage(
        ensuredConversationId,
        submittedMessage,
        (event) => {
          if (streamRunIdRef.current !== runId) {
            return;
          }

          if (
            event.type === 'message.created' &&
            event.data.role === 'user' &&
            event.data.conversationId === ensuredConversationId &&
            event.data.content === submittedMessage
          ) {
            streamAcceptedUserMessage.current = true;
            streamAcceptedUserMessage.id = event.data.id;
          }

          if (event.type === 'answer.final' && event.data.streamStatus === 'completed') {
            streamResult.completedSuccessfully = true;
          }

          applyStreamEvent(event);
        },
        abortController.signal
      );
    } catch (error) {
      if (streamRunIdRef.current === runId) {
        let recoveredPersistedAssistant = false;
        if (targetConversationId !== undefined && streamAcceptedUserMessage.current) {
          const recoveryConversationId = targetConversationId;
          try {
            const loadedMessages =
              await servicesRef.current.listConversationMessages(recoveryConversationId);
            if (streamRunIdRef.current === runId) {
              setMessages((currentMessages) =>
                mergeLoadedMessages(recoveryConversationId, loadedMessages, currentMessages)
              );
              setOptimisticUserMessage(null);
              recoveredPersistedAssistant = hasAssistantAfterMessage(
                loadedMessages,
                streamAcceptedUserMessage.id
              );
            }
          } catch {
            recoveredPersistedAssistant = false;
          }
        }

        if (!streamAcceptedUserMessage.current) {
          setComposer(submittedMessage);
        }
        setStreamPhase('starting');
        setStreamLongRunning(false);
        setStreamDraft('');
        setStreamCitations([]);
        setStreamEvidence([]);
        setStreamMissing([]);
        setStreamError(recoveredPersistedAssistant ? null : errorMessage(error));
        pendingAnswerGapCandidateRef.current = null;
      }
    } finally {
      if (streamRunIdRef.current === runId) {
        setStreaming(false);
        streamInFlightRef.current = false;
        streamAbortControllerRef.current = null;
        if (targetConversationId !== undefined) {
          void Promise.resolve(onConversationActivityRef.current?.(targetConversationId)).catch(
            () => undefined
          );
        }
        const nextQueuedFollowUp = queuedFollowUpRef.current;
        if (nextQueuedFollowUp !== null) {
          if (streamResult.completedSuccessfully) {
            const nextOptions =
              targetConversationId === undefined
                ? {}
                : { conversationIdOverride: targetConversationId };
            setQueuedFollowUpValue(null);
            void submitMessageText(nextQueuedFollowUp, nextOptions);
          }
        }
      }
    }
  }

  async function handleSendMessage(): Promise<void> {
    const submittedMessage = composer.trim();
    if (submittedMessage.length === 0) {
      return;
    }

    if (streamInFlightRef.current) {
      if (queuedFollowUpRef.current !== null) {
        return;
      }
      setQueuedFollowUpValue(submittedMessage);
      setComposer('');
      return;
    }

    await submitMessageText(submittedMessage);
  }

  async function retryLastMessage(): Promise<void> {
    await submitMessageText(
      latestFailedAssistantPrompt(messages) ?? lastSubmittedMessageRef.current ?? composer.trim()
    );
  }

  function clearQueuedFollowUp(): void {
    setQueuedFollowUpValue(null);
  }

  function editQueuedFollowUp(): void {
    const currentQueuedFollowUp = queuedFollowUpRef.current;
    if (currentQueuedFollowUp === null) {
      return;
    }

    setComposer(currentQueuedFollowUp);
    setQueuedFollowUpValue(null);
  }

  function cancelStream(): void {
    streamRunIdRef.current += 1;
    streamInFlightRef.current = false;
    streamAbortControllerRef.current?.abort();
    streamAbortControllerRef.current = null;
    setStreaming(false);
    setStreamPhase('starting');
    setStreamLongRunning(false);
    setStreamConversationId(undefined);
    setStreamStartedFromBlankRoute(false);
    setStreamDraft('');
    setStreamCitations([]);
    setStreamEvidence([]);
    setStreamMissing([]);
    setStreamError(null);
    pendingAnswerGapCandidateRef.current = null;
    setOptimisticUserMessage(null);
  }

  async function shareAnswerGapCandidateForMessage(
    messageId: string,
    input: ShareAnswerGapCandidateInput
  ): Promise<void> {
    const candidate = answerGapCandidatesByMessageId[messageId];
    if (candidate?.status !== 'pending_user_consent') {
      return;
    }

    setAnswerGapActionBusyByMessageId((current) => ({ ...current, [messageId]: true }));
    setAnswerGapActionErrorByMessageId((current) => ({ ...current, [messageId]: null }));
    try {
      const response = await servicesRef.current.shareAnswerGapCandidate(candidate.id, input);
      setAnswerGapCandidatesByMessageId((current) => ({
        ...current,
        [messageId]: response.candidate,
      }));
    } catch {
      setAnswerGapActionErrorByMessageId((current) => ({ ...current, [messageId]: 'failed' }));
    } finally {
      setAnswerGapActionBusyByMessageId((current) => ({ ...current, [messageId]: false }));
    }
  }

  async function declineAnswerGapCandidateForMessage(messageId: string): Promise<void> {
    const candidate = answerGapCandidatesByMessageId[messageId];
    if (candidate?.status !== 'pending_user_consent') {
      return;
    }

    setAnswerGapActionBusyByMessageId((current) => ({ ...current, [messageId]: true }));
    setAnswerGapActionErrorByMessageId((current) => ({ ...current, [messageId]: null }));
    try {
      const response = await servicesRef.current.declineAnswerGapCandidate(candidate.id);
      setAnswerGapCandidatesByMessageId((current) => ({
        ...current,
        [messageId]: response.candidate,
      }));
    } catch {
      setAnswerGapActionErrorByMessageId((current) => ({ ...current, [messageId]: 'failed' }));
    } finally {
      setAnswerGapActionBusyByMessageId((current) => ({ ...current, [messageId]: false }));
    }
  }

  async function withdrawAnswerGapCandidateForMessage(messageId: string): Promise<void> {
    const candidate = answerGapCandidatesByMessageId[messageId];
    if (candidate?.status !== 'shared') {
      return;
    }

    setAnswerGapActionBusyByMessageId((current) => ({ ...current, [messageId]: true }));
    setAnswerGapActionErrorByMessageId((current) => ({ ...current, [messageId]: null }));
    try {
      const response = await servicesRef.current.withdrawAnswerGapCandidate(candidate.id);
      setAnswerGapCandidatesByMessageId((current) => ({
        ...current,
        [messageId]: response.candidate,
      }));
    } catch {
      setAnswerGapActionErrorByMessageId((current) => ({ ...current, [messageId]: 'failed' }));
    } finally {
      setAnswerGapActionBusyByMessageId((current) => ({ ...current, [messageId]: false }));
    }
  }

  const hasStreamPreview =
    streamDisplayVisible &&
    (streamOperationVisible ||
      streamDraft.length > 0 ||
      streamCitations.length > 0 ||
      streamMissing.length > 0);
  const streamPreviewMessage = useMemo<ConversationMessage>(
    () => ({
      id: 'stream-draft',
      userId: 'user-preview',
      conversationId: streamConversationId ?? conversationId ?? 'pending',
      role: 'assistant',
      content: streamDisplayVisible ? streamDraft : '',
      createdAt: '',
      citations: streamDisplayVisible ? streamCitations : [],
      missingInformation: streamDisplayVisible ? streamMissing : [],
      ...(streamDisplayVisible && streamEvidence.length > 0
        ? {
            retrieval: {
              query: '',
              startedAt: '',
              completedAt: '',
              sources: [],
              evidence: streamEvidence,
            },
          }
        : {}),
    }),
    [
      conversationId,
      streamCitations,
      streamConversationId,
      streamDraft,
      streamEvidence,
      streamMissing,
      streamDisplayVisible,
    ]
  );
  const visibleMessages = useMemo(() => {
    if (optimisticUserMessage === null) {
      return messages;
    }

    if (
      !streamOperationVisible &&
      !streamErrorVisible &&
      conversationId !== optimisticUserMessage.conversationId
    ) {
      return messages;
    }

    if (messages.some((message) => message.id === optimisticUserMessage.id)) {
      return messages;
    }

    return [...messages, optimisticUserMessage];
  }, [conversationId, messages, optimisticUserMessage, streamErrorVisible, streamOperationVisible]);

  return {
    messages: visibleMessages,
    messagesStatus,
    messagesError,
    composer,
    setComposer,
    streaming: streamOperationVisible,
    streamPhase: streamDisplayVisible ? streamPhase : 'starting',
    streamLongRunning: streamDisplayVisible && streamOperationVisible ? streamLongRunning : false,
    streamDraft: streamDisplayVisible ? streamDraft : '',
    streamCitations: streamDisplayVisible ? streamCitations : [],
    streamEvidence: streamDisplayVisible ? streamEvidence : [],
    streamMissing: streamDisplayVisible ? streamMissing : [],
    streamError: streamErrorVisible ? streamError : null,
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
  };
}
