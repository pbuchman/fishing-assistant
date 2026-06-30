import { err, getErrorMessage, ok, type Clock, type Result } from '@fa/common-core';
import type { AnswerGapCoverageProbe, RagAuthorizationContext } from '@fa/http-contracts';
import { isIP } from 'node:net';

import type {
  Citation,
  RetrievalTrace,
  RetrievalTracePerformance,
  RetrievalTraceSource,
} from '../models/chat.js';
import { sanitizePublicMarkdown } from '../text/publicMarkdown.js';
import { ragEvidenceKey } from './evidenceKeys.js';

export type RagEvidenceSourceType = 'knowledge_page';

export interface RagEvidenceMetadata {
  headingPath?: string[];
  path?: string[];
  sourceLabel?: string;
  documentId?: string;
  pageId?: string;
  chunkId?: string;
}

export interface ChatContextMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
}

export interface RagQuery {
  authorization: RagAuthorizationContext;
  query: string;
  conversationId?: string;
  messageId?: string;
  latestMessages: ChatContextMessage[];
  now: Date;
  limits: {
    maxEvidenceItems: number;
  };
  signal?: AbortSignal;
}

export interface RagEvidence {
  id: string;
  sourceId: string;
  sourceType: RagEvidenceSourceType;
  title: string;
  quote: string;
  content: string;
  score: number;
  url?: string;
  date?: string;
  metadata: RagEvidenceMetadata;
}

export interface RagSourceResult {
  sourceId: string;
  items: RagEvidence[];
  coverageProbe?: AnswerGapCoverageProbe;
  diagnostics: Record<string, unknown>;
  performance?: RetrievalTracePerformance;
}

export interface RagSourceError {
  code: 'DOWNSTREAM_ERROR' | 'INVALID_RESPONSE';
  message: string;
}

export interface RagSource {
  id: string;
  label: string;
  retrieve(input: RagQuery): Promise<Result<RagSourceResult, RagSourceError>>;
}

export interface AggregateRagEvidenceDeps {
  sources: readonly RagSource[];
  clock: Clock;
}

export interface AggregateRagEvidenceResult {
  evidence: RagEvidence[];
  coverageProbe?: AnswerGapCoverageProbe;
  trace: RetrievalTrace;
}

export interface AggregateRagEvidenceError {
  code: 'DOWNSTREAM_ERROR';
  message: string;
}

function sourceTrace(input: {
  source: RagSource;
  status: RetrievalTraceSource['status'];
  itemCount: number;
  diagnostics?: Record<string, unknown>;
  performance?: RetrievalTracePerformance;
  errorMessage?: string;
}): RetrievalTraceSource {
  return {
    sourceId: input.source.id,
    label: input.source.label,
    status: input.status,
    itemCount: input.itemCount,
    diagnostics: input.diagnostics ?? {},
    ...(input.performance === undefined ? {} : { performance: input.performance }),
    ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
  };
}

function dedupeBySourceEvidenceId(items: readonly RagEvidence[]): RagEvidence[] {
  const seen = new Set<string>();
  const indexesByKey = new Map<string, number>();
  const deduped: RagEvidence[] = [];
  for (const item of items) {
    const key = ragEvidenceKey(item);
    if (seen.has(key)) {
      const existingIndex = indexesByKey.get(key);
      if (
        existingIndex !== undefined &&
        (deduped[existingIndex]?.score ?? Number.NEGATIVE_INFINITY) < item.score
      ) {
        deduped[existingIndex] = item;
      }
      continue;
    }

    seen.add(key);
    indexesByKey.set(key, deduped.length);
    deduped.push(item);
  }

  return deduped;
}

function capRankedEvidence(input: {
  sourceIds: readonly string[];
  items: readonly RagEvidence[];
  maxEvidenceItems: number;
}): RagEvidence[] {
  const perSourceCap =
    input.sourceIds.length === 1 ? input.maxEvidenceItems : Math.min(12, input.maxEvidenceItems);
  const perSourceCounts = new Map<string, number>();
  const capped = dedupeBySourceEvidenceId(input.items).filter((item) => {
    const count = perSourceCounts.get(item.sourceId) ?? 0;
    if (count >= perSourceCap) {
      return false;
    }

    perSourceCounts.set(item.sourceId, count + 1);
    return true;
  });

  return capped.slice(0, input.maxEvidenceItems);
}

function coverageProbeRank(probe: AnswerGapCoverageProbe): number {
  switch (probe.classification) {
    case 'higher_level_candidate_seen':
      return 4;
    case 'accessible_candidate_seen':
      return 3;
    case 'restricted_or_invalid_candidate_seen':
      return 2;
    case 'no_candidate_seen':
      return 1;
  }
}

function preferredCoverageProbe(
  left: AnswerGapCoverageProbe | undefined,
  right: AnswerGapCoverageProbe | undefined
): AnswerGapCoverageProbe | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  if (coverageProbeRank(right) > coverageProbeRank(left)) {
    return right;
  }
  if (
    right.classification === 'higher_level_candidate_seen' &&
    left.classification === 'higher_level_candidate_seen' &&
    right.minRequiredLevel !== null &&
    (left.minRequiredLevel === null || right.minRequiredLevel < left.minRequiredLevel)
  ) {
    return right;
  }
  return left;
}

function publicEvidenceTitle(item: RagEvidence, index: number): string {
  const title = sanitizePublicMarkdown(redactUnsafeHostTokens(item.title))
    .replace(/\s{2,}/gu, ' ')
    .trim();
  return title.length > 0 ? title : `Source ${String(index + 1)}`;
}

function publicEvidenceMetadata(): Record<string, unknown> {
  return {};
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/u, '');
}

function isPrivateHostname(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.invalid') ||
    hostname === 'metadata.google.internal' ||
    hostname === '0.0.0.0'
  ) {
    return true;
  }

  const octets = hostname.split('.').map((entry) => Number.parseInt(entry, 10));
  if (octets.length !== 4 || octets.some((entry) => !Number.isInteger(entry))) {
    return false;
  }

  const [first = 0, second = 0] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function decodePathnameForPolicy(pathname: string, maxRounds: number): string | undefined {
  let decoded = pathname;
  for (let round = 0; round < maxRounds; round += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        return decoded.toLowerCase();
      }
      decoded = next;
    } catch {
      return undefined;
    }
  }

  return decoded.toLowerCase();
}

function hasInternalRouteSegment(pathname: string): boolean {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  return segments.some(
    (segment) => segment === 'api' || segment === 'app' || segment.startsWith('share')
  );
}

function isIpLiteralHostname(hostname: string): boolean {
  const strippedHostname =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return isIP(strippedHostname) !== 0;
}

function publicEvidenceUrl(item: RagEvidence): string | undefined {
  const url = item.url?.trim();
  if (url === undefined || url.length === 0) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'https:') {
    return undefined;
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return undefined;
  }

  if (parsed.hash.length > 0) {
    return undefined;
  }

  const normalizedHostname = normalizeHostname(parsed.hostname);
  if (normalizedHostname.length === 0) {
    return undefined;
  }

  if (isIpLiteralHostname(normalizedHostname)) {
    return undefined;
  }

  if (isPrivateHostname(normalizedHostname)) {
    return undefined;
  }

  const pathname = decodePathnameForPolicy(parsed.pathname, 2);
  if (pathname === undefined) {
    return undefined;
  }

  if (
    hasInternalRouteSegment(pathname) ||
    pathname.includes('/admin') ||
    pathname.includes('/editor')
  ) {
    return undefined;
  }

  return parsed.toString();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function privateEvidenceLabels(item: RagEvidence): string[] {
  return [
    item.title,
    ...(item.metadata.headingPath ?? []),
    ...(item.metadata.path ?? []),
    item.metadata.sourceLabel ?? '',
    item.metadata.documentId ?? '',
    item.metadata.chunkId ?? '',
    item.metadata.pageId ?? '',
  ]
    .map((label) => label.trim())
    .filter((label, index, labels) => label.length > 0 && labels.indexOf(label) === index);
}

function isTokenBoundaryChar(character: string | undefined): boolean {
  return character === undefined || !/[\w-]/u.test(character);
}

function isStandaloneLabelMatch(text: string, start: number, end: number): boolean {
  const before = text[start - 1];
  const after = text[end];
  const beforeBefore = text[start - 2];
  const afterAfter = text[end + 1];

  if (!isTokenBoundaryChar(before) && before !== '.') {
    return false;
  }
  if (before === '.' && !isTokenBoundaryChar(beforeBefore)) {
    return false;
  }

  if (!isTokenBoundaryChar(after) && after !== '.') {
    return false;
  }
  if (after === '.' && !isTokenBoundaryChar(afterAfter)) {
    return false;
  }

  return true;
}

function redactPrivateLabels(markdown: string, labels: readonly string[]): string {
  let redacted = markdown;
  for (const label of labels) {
    const labelPattern = new RegExp(escapeRegExp(label), 'gu');
    redacted = redacted.replace(labelPattern, (match, offset: number) => {
      return isStandaloneLabelMatch(redacted, offset, offset + match.length) ? '' : match;
    });
  }

  return redacted;
}

function redactUnsafeHostTokens(markdown: string): string {
  const bracketedRedacted = markdown.replace(/\[[^\]]+\]/g, (token) => {
    const candidate = token.slice(1, -1).trim();
    return isIP(candidate) !== 0 ? '[host hidden]' : token;
  });

  const bareIpRedacted = bracketedRedacted.replace(/\b[0-9A-Fa-f.]*:[0-9A-Fa-f:.]+\b/g, (token) => {
    return isIP(token) !== 0 ? '[host hidden]' : token;
  });

  return bareIpRedacted.replace(
    /(?<![\w/.-])(?:(?:[a-z0-9-]+\.)*localhost|(?:[a-z0-9-]+\.)+(?:local|internal|invalid)|(?:\d{1,3}\.){3}\d{1,3})(?:\.(?=[^\w-]|$))?(?![\w.-])/gi,
    '[host hidden]'
  );
}

function redactPublicTraceFilenameTokens(markdown: string): string {
  return markdown.replace(/(?<![\w/.-])`?\b[\w-]{2,160}\.dev\b`?(?![\w.-])/gi, '[file hidden]');
}

function publicEvidenceQuote(item: RagEvidence): string {
  let quote = redactUnsafeHostTokens(item.quote);
  quote = redactPublicTraceFilenameTokens(quote);
  quote = sanitizePublicMarkdown(quote);
  quote = redactPrivateLabels(quote, privateEvidenceLabels(item));

  return quote
    .replace(/^\s*(?:[/|>:-]+)\s*/u, '')
    .replace(/\s*(?:[/|>:-]+)\s*$/u, '')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}

function retrievalTrace(input: {
  query: string;
  startedAt: string;
  completedAt: string;
  coverageProbe?: AnswerGapCoverageProbe;
  sourceTraces: RetrievalTraceSource[];
  evidence: readonly RagEvidence[];
}): RetrievalTrace {
  return {
    query: input.query,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    ...(input.coverageProbe === undefined ? {} : { coverageProbe: input.coverageProbe }),
    sources: input.sourceTraces,
    evidence: input.evidence.map((item, index) => {
      const publicUrl = publicEvidenceUrl(item);
      return {
        id: item.id,
        sourceId: item.sourceId,
        sourceType: item.sourceType,
        title: publicEvidenceTitle(item, index),
        quote: publicEvidenceQuote(item),
        score: item.score,
        ...(publicUrl === undefined ? {} : { publicUrl }),
        metadata: publicEvidenceMetadata(),
      };
    }),
  };
}

export async function aggregateRagEvidence(
  deps: AggregateRagEvidenceDeps,
  query: Omit<RagQuery, 'now'>
): Promise<Result<AggregateRagEvidenceResult, AggregateRagEvidenceError>> {
  const startedAt = deps.clock.now().toISOString();
  const sourceTraces: RetrievalTraceSource[] = [];
  const evidence: RagEvidence[] = [];
  const failures: string[] = [];
  let successfulSources = 0;
  let coverageProbe: AnswerGapCoverageProbe | undefined;

  for (const source of deps.sources) {
    let result: Result<RagSourceResult, RagSourceError>;
    try {
      result = await source.retrieve({
        ...query,
        now: deps.clock.now(),
      });
    } catch (error) {
      const message = getErrorMessage(error);
      failures.push(message);
      sourceTraces.push(
        sourceTrace({
          source,
          status: 'failed',
          itemCount: 0,
          errorMessage: message,
        })
      );
      continue;
    }

    if (!result.ok) {
      failures.push(result.error.message);
      sourceTraces.push(
        sourceTrace({
          source,
          status: 'failed',
          itemCount: 0,
          errorMessage: result.error.message,
        })
      );
      continue;
    }

    successfulSources += 1;
    evidence.push(...result.value.items);
    coverageProbe = preferredCoverageProbe(coverageProbe, result.value.coverageProbe);
    sourceTraces.push(
      sourceTrace({
        source,
        status: 'success',
        itemCount: result.value.items.length,
        diagnostics: result.value.diagnostics,
        ...(result.value.performance === undefined
          ? {}
          : { performance: result.value.performance }),
      })
    );
  }

  if (successfulSources === 0 && failures.length > 0) {
    return err({
      code: 'DOWNSTREAM_ERROR',
      message: `All RAG sources failed: ${failures.join('; ')}`,
    });
  }

  const rankedEvidence = capRankedEvidence({
    sourceIds: deps.sources.map((source) => source.id),
    items: evidence,
    maxEvidenceItems: query.limits.maxEvidenceItems,
  });
  const completedAt = deps.clock.now().toISOString();
  if (rankedEvidence.length === 0 && failures.length > 0) {
    return err({
      code: 'DOWNSTREAM_ERROR',
      message: `RAG sources failed and no evidence was retrieved: ${failures.join('; ')}`,
    });
  }

  return ok({
    evidence: rankedEvidence,
    ...(coverageProbe === undefined ? {} : { coverageProbe }),
    trace: retrievalTrace({
      query: query.query,
      startedAt,
      completedAt,
      ...(coverageProbe === undefined ? {} : { coverageProbe }),
      sourceTraces,
      evidence: rankedEvidence,
    }),
  });
}
