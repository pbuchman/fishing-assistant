#!/usr/bin/env node
/* eslint-disable no-console */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * @param {any} value
 * @returns {Date | null}
 */
function toDate(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'object' && typeof value._seconds === 'number') {
    return new Date(value._seconds * 1000 + Math.floor((value._nanoseconds ?? 0) / 1_000_000));
  }
  if (typeof value.toDate === 'function') {
    return value.toDate();
  }
  return null;
}

/**
 * @param {any} start
 * @param {any} end
 * @returns {number | null}
 */
function durationMs(start, end) {
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (startDate === null || endDate === null) {
    return null;
  }
  return Math.max(0, endDate.getTime() - startDate.getTime());
}

/**
 * @param {any[]} messages
 * @returns {any | null}
 */
function lastAssistantMessage(messages) {
  return [...messages].reverse().find((message) => message?.role === 'assistant') ?? null;
}

/**
 * @param {any[]} events
 * @returns {any | null}
 */
function answerUsageEvent(events) {
  return (
    events.find(
      (event) =>
        event?.source?.component === 'rag-chat' &&
        event?.source?.operation === 'chat.stream' &&
        event?.source?.promptType === 'fishing-answer'
    ) ?? null
  );
}

/**
 * @param {any | null} assistant
 * @param {any[]} events
 * @param {'grounding' | 'repair'} kind
 * @returns {{ status: 'attempted' | 'skipped' }}
 */
function processingStatus(assistant, events, kind) {
  const promptVersion = assistant?.promptVersions?.[kind];
  if (promptVersion !== undefined) {
    return { status: 'attempted' };
  }

  const component = kind === 'grounding' ? 'answer-grounding-check' : 'answer-repair';
  const event = events.find((usageEvent) => usageEvent?.source?.component === component);
  return { status: event === undefined ? 'skipped' : 'attempted' };
}

/**
 * @param {any | null} assistant
 */
function summarizeRetrieval(assistant) {
  const retrieval = assistant?.retrieval ?? {};
  const firstSource = retrieval.sources?.[0] ?? {};
  return {
    durationMs: durationMs(retrieval.startedAt, retrieval.completedAt),
    itemCount: firstSource.itemCount ?? 0,
    expandedItemCount: firstSource.diagnostics?.expandedItemCount ?? 0,
  };
}

/**
 * @param {any | null} assistant
 * @param {any | null} usageEvent
 */
function summarizeAnswerStream(assistant, usageEvent) {
  const usage = usageEvent?.usage ?? {};
  return {
    model: usageEvent?.request?.model ?? assistant?.modelId ?? null,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
  };
}

/**
 * @param {any} value
 * @returns {string | null}
 */
function redactErrorMessage(value) {
  if (typeof value !== 'string') {
    return null;
  }
  return value.replace(/https?:\/\/\S+/g, '[redacted-url]');
}

/**
 * @param {any | null} assistant
 */
function summarizePersistence(assistant) {
  return {
    status: assistant?.streamStatus ?? 'unknown',
    errorMessage: redactErrorMessage(assistant?.errorMessage),
    citationsCount: assistant?.citations?.length ?? 0,
    missingInformationCount: assistant?.missingInformation?.length ?? 0,
  };
}

/**
 * @param {any} input
 */
export function summarizeConversationProcessing(input) {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const usageEvents = Array.isArray(input.usageEvents) ? input.usageEvents : [];
  const assistant = lastAssistantMessage(messages);
  const usageEvent = answerUsageEvent(usageEvents);

  return {
    environment: input.environment ?? null,
    directory: input.directory ?? null,
    sha: input.sha ?? null,
    conversationId: input.conversation?.id ?? input.conversationId ?? null,
    activeModel: {
      modelId: input.activeModel?.modelId ?? assistant?.modelId ?? null,
      activeBecause: input.activeModel?.activeBecause ?? null,
    },
    streamTimeoutMs: input.streamTimeoutMs ?? null,
    edgeProxyReadTimeoutMs: input.edgeProxyReadTimeoutMs ?? null,
    passes: {
      retrieval: summarizeRetrieval(assistant),
      answerStream: summarizeAnswerStream(assistant, usageEvent),
      grounding: processingStatus(assistant, usageEvents, 'grounding'),
      repair: processingStatus(assistant, usageEvents, 'repair'),
      persistence: summarizePersistence(assistant),
    },
  };
}

function readStdin() {
  return readFileSync(0, 'utf8');
}

function runCli() {
  const sources = process.argv.slice(2);
  const inputs =
    sources.length === 0
      ? [JSON.parse(readStdin())]
      : sources.map((source) => JSON.parse(readFileSync(source, 'utf8')));
  const summaries = inputs.map((input) => summarizeConversationProcessing(input));
  console.log(JSON.stringify(summaries.length === 1 ? summaries[0] : summaries, null, 2));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
