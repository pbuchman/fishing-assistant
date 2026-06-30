#!/usr/bin/env node
/* eslint-disable no-console */
import { readFileSync } from 'node:fs';

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const usage = `Usage: node .codex/skills/debug-chat-conversation/scripts/fetch-conversation.mjs <chat-url-or-conversation-id> [--include-content]`;

function printUsageAndExit() {
  console.error(usage);
  process.exit(1);
}

function extractConversationId(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const exact = trimmed.match(new RegExp(`^${uuidPattern.source}$`, 'i'));
  if (exact !== null) {
    return exact[0].toLowerCase();
  }

  const chatRoute = trimmed.match(new RegExp(`/chat/(${uuidPattern.source})`, 'i'));
  if (chatRoute !== null) {
    return chatRoute[1].toLowerCase();
  }

  return null;
}

function assertConversationId(value) {
  const conversationId = extractConversationId(value);
  if (conversationId === null) {
    console.error(
      'Invalid conversation ID. Expected a raw UUID or /app#/chat/<conversationId> URL.'
    );
    process.exit(1);
  }

  return conversationId;
}

function parseArgs(argv) {
  const includeContent = argv.includes('--include-content');
  const positional = argv.filter((value) => value !== '--include-content');
  if (positional.length !== 1 || positional[0] === '--help' || positional[0] === '-h') {
    printUsageAndExit();
  }

  return {
    conversationId: assertConversationId(positional[0]),
    includeContent,
  };
}

function readFaAdminCredential() {
  const keyFile = process.env.FA_GCP_ADMIN_KEY_FILE;
  if (keyFile === undefined || keyFile.trim().length === 0) {
    throw new Error(
      'FA_GCP_ADMIN_KEY_FILE must point to the local FA admin service-account key before fetching conversation evidence.'
    );
  }

  return cert(JSON.parse(readFileSync(keyFile, 'utf8')));
}

function timestampMillis(value) {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value === 'string') {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : 0;
  }
  if (typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (typeof value._seconds === 'number') {
    return value._seconds * 1000 + Math.floor((value._nanoseconds ?? 0) / 1_000_000);
  }

  return 0;
}

function timestampIso(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (typeof value._seconds === 'number') {
    return new Date(timestampMillis(value)).toISOString();
  }

  return String(value);
}

function sortMessagesByCreatedAt(left, right) {
  const leftMillis = timestampMillis(left.createdAt);
  const rightMillis = timestampMillis(right.createdAt);
  if (leftMillis !== rightMillis) {
    return leftMillis - rightMillis;
  }

  return String(left.id).localeCompare(String(right.id));
}

function sortUsageEventsByCreatedAt(left, right) {
  const leftMillis = timestampMillis(left.createdAt);
  const rightMillis = timestampMillis(right.createdAt);
  if (leftMillis !== rightMillis) {
    return leftMillis - rightMillis;
  }

  return String(left.id).localeCompare(String(right.id));
}

function preview(value, maxChars = 700) {
  if (typeof value !== 'string') {
    return null;
  }
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxChars ? `${compact.slice(0, maxChars)}...` : compact;
}

function contentPreview(value, includeContent, maxChars = 700) {
  if (!includeContent) {
    return { contentRedacted: true };
  }

  return { contentPreview: preview(value, maxChars) };
}

function publicMissingInformation(value, includeContent) {
  const items = Array.isArray(value) ? value : [];
  if (includeContent) {
    return { missingInformation: items };
  }

  return {
    missingInformationRedacted: true,
    missingInformationCount: items.length,
  };
}

function publicRetrieval(retrieval, options) {
  if (retrieval === undefined || retrieval === null || typeof retrieval !== 'object') {
    return null;
  }

  return {
    ...(options.includeContent ? { query: retrieval.query ?? null } : { queryRedacted: true }),
    startedAt: timestampIso(retrieval.startedAt),
    completedAt: timestampIso(retrieval.completedAt),
    coverageProbe: retrieval.coverageProbe ?? null,
    sources: Array.isArray(retrieval.sources)
      ? retrieval.sources.map((source) => ({
          sourceId: source.sourceId ?? null,
          label: source.label ?? null,
          status: source.status ?? null,
          itemCount: source.itemCount ?? null,
          diagnostics: source.diagnostics ?? {},
          errorMessage: source.errorMessage ?? null,
        }))
      : [],
    evidence: Array.isArray(retrieval.evidence)
      ? retrieval.evidence.map((item) => ({
          id: item.id ?? null,
          sourceId: item.sourceId ?? null,
          sourceType: item.sourceType ?? null,
          title: item.title ?? null,
          score: item.score ?? null,
          ...(options.includeContent ? { quote: preview(item.quote, 350) } : {}),
          metadata: item.metadata ?? {},
          url: item.url ?? null,
        }))
      : [],
  };
}

function publicMessage(doc, options) {
  const data = doc.data();
  return {
    id: doc.id,
    role: data.role ?? null,
    createdAt: timestampIso(data.createdAt),
    streamStatus: data.streamStatus ?? null,
    errorMessage: data.errorMessage ?? null,
    modelId: data.modelId ?? null,
    promptVersions: data.promptVersions ?? null,
    ...contentPreview(data.content, options.includeContent),
    citations: Array.isArray(data.citations) ? data.citations : [],
    ...publicMissingInformation(data.missingInformation, options.includeContent),
    retrieval: publicRetrieval(data.retrieval, options),
  };
}

function publicConversation(doc, options) {
  if (!doc.exists) {
    return null;
  }

  const data = doc.data();
  return {
    id: doc.id,
    ...(options.includeContent ? { userId: data.userId ?? null } : { userIdRedacted: true }),
    status: data.status ?? null,
    ...(options.includeContent ? { title: data.title ?? null } : { titleRedacted: true }),
    createdAt: timestampIso(data.createdAt),
    updatedAt: timestampIso(data.updatedAt),
    lastMessageAt: timestampIso(data.lastMessageAt),
    messageCount: data.messageCount ?? null,
  };
}

function publicUsageEvent(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    createdAt: timestampIso(data.createdAt),
    source: data.source ?? null,
    request: data.request ?? null,
    usage: data.usage ?? null,
    correlation: data.correlation ?? null,
    error: data.error ?? null,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { conversationId } = options;
  if (getApps().length === 0) {
    initializeApp({
      credential: readFaAdminCredential(),
      projectId: process.env.FA_GCP_PROJECT_ID ?? 'fishing-assistant',
    });
  }

  const db = getFirestore();
  const conversationDoc = await db.collection('fishing_conversations').doc(conversationId).get();
  const messageDocs = await db
    .collection('fishing_conversation_messages')
    .where('conversationId', '==', conversationId)
    .get();

  let usageEvents = [];
  let usageEventsError = null;
  try {
    const usageDocs = await db
      .collection('llm_usage_events')
      .where('correlation.conversationId', '==', conversationId)
      .get();
    usageEvents = usageDocs.docs.map(publicUsageEvent).sort(sortUsageEventsByCreatedAt);
  } catch (error) {
    usageEventsError = error instanceof Error ? error.message : String(error);
  }

  const messages = messageDocs.docs
    .map((doc) => publicMessage(doc, options))
    .sort(sortMessagesByCreatedAt);
  const report = {
    conversationId,
    generatedAt: new Date().toISOString(),
    contentIncluded: options.includeContent,
    collections: {
      conversation: 'fishing_conversations',
      messages: 'fishing_conversation_messages',
      usageEvents: 'llm_usage_events',
    },
    conversation: publicConversation(conversationDoc, options),
    messages,
    usageEvents,
    usageEventsError,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
