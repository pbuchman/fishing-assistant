import { err, getErrorMessage, ok, type Result } from '@fa/common-core';
import type {
  AnswerGapCandidateCountBucket,
  AnswerGapCoverageProbe,
  RagAuthorizationContext,
} from '@fa/http-contracts';
import type { LlmEmbeddingProvider } from '@fa/llm-contract';

import type { KnowledgePage, KnowledgePageChunk } from '../models/knowledge.js';
import { validateKnowledgeSourceUrl } from '../models/knowledgeValidation.js';
import type {
  KnowledgePageChunkMatch,
  KnowledgePageChunkRepository,
  KnowledgePageRepository,
  KnowledgeRepositoryError,
  KnowledgeRetrievalChunkCandidate,
  KnowledgeRetrievalPageMetadata,
} from '../repositories/knowledgeRepositories.js';
import { isKnowledgePageChunkRetrievalEligible } from './accessRefresh.js';
import {
  buildCenteredWindowBundle,
  buildNamedPageBundles,
  rankAndPackBundles,
  type RetrievalBundle,
} from './retrievalBundles.js';
import { publicEvidenceId } from './sourceRefs.js';
import { embeddingResponseMismatchMessage, type EmbeddingConfig } from './syncDocument.js';

export interface Citation {
  sourceId: string;
  usedFor: string;
}

export interface RetrieveRequest {
  authorization: RagAuthorizationContext;
  query: string;
  usageCorrelation?: {
    conversationId?: string;
    messageId?: string;
    requestId?: string;
  };
  conversationContext: {
    latestMessages: {
      role: 'user' | 'assistant';
      content: string;
      citations?: Citation[] | undefined;
    }[];
  };
  options?: {
    topK?: number | undefined;
    expandParentDocuments?: boolean | undefined;
  };
}

export interface RagEvidence {
  id: string;
  sourceId: string;
  sourceType: 'knowledge_page';
  title: string;
  quote: string;
  content: string;
  score: number;
  url?: string;
  metadata: {
    headingPath: string[];
    path: string[];
    sourceLabel?: string;
  };
}

export interface RetrieveResponse {
  items: RagEvidence[];
  coverageProbe: AnswerGapCoverageProbe;
  diagnostics: {
    embeddingModel: string;
    embeddingProvider: string;
    embeddingDimensions: number;
    searchedChunkCount: number;
    expandedItemCount: number;
    vectorCandidateLimit: number;
    vectorReturnedCount: number;
    vectorReturnedEmbeddingsIncluded: boolean;
    lexicalScannedCount: number;
    lexicalLimitHit: boolean;
    activeCurrentChunkCount?: number;
    performance: {
      totalMs: number;
      embeddingMs: number;
      vectorSearchMs: number;
      lexicalFetchMs: number;
      lexicalScoringMs: number;
      lexicalCandidatesMs: number;
      candidateMergeMs: number;
      pageLookupMs: number;
      rankingMs: number;
      expansionMs: number;
    };
  };
}

export type RetrieveError =
  | KnowledgeRepositoryError
  | { code: 'INVALID_REQUEST' | 'DOWNSTREAM_ERROR'; message: string };

export interface RetrieveKnowledgeDeps {
  pageRepository: KnowledgePageRepository;
  pageChunkRepository: KnowledgePageChunkRepository;
  embeddingProvider: LlmEmbeddingProvider;
  embeddingConfig: EmbeddingConfig;
}

export const queryEmbeddingInputBuilder = {
  version: '2.0.0',
} as const;

type RetrievalChunk = KnowledgeRetrievalChunkCandidate;
type RetrievalChunkMatch = RetrievalChunk & { vectorScore: number };
type RetrievalPageMetadata = KnowledgeRetrievalPageMetadata;
type AccessibleRetrievalChunkMatch = RetrievalChunkMatch & { page: RetrievalPageMetadata };
interface PageExpansion {
  page: RetrievalPageMetadata;
  parentScore: number;
  isNamedPage: boolean;
}

interface NamedPageCoverageCandidate {
  chunk: AccessibleRetrievalChunkMatch;
  coverageKey: string;
  matchScore: number;
  parentScore: number;
}

const maxConversationContextMessages = 6;
const maxQueryEmbeddingChars = 2_000;
const maxConversationMessageChars = 1_200;
const maxLexicalCandidateChunks = 5_000;
const lexicalCandidateWeight = 3;
const titlePathWeight = 2;
const lexicalCandidateLimitMultiplier = 16;
const lexicalGuidanceCandidateLimit = 1_000;
const rankedCandidateLimitMultiplier = 4;
const minRankedCandidateLimit = 24;
const pageExpansionThreshold = 0.3;
const namedPageExpansionLimit = 6;
const namedPageExpansionThreshold = 0.75;
const namedPageExpansionBonus = 6;
const namedPageCoverageLimit = 10;
const directNamedPageCandidateLimit = 120;
const bundleMaxChars = 4_000;
const bundleGlobalMaxChars = 32_000;
const namedPageMaxBundles = 2;
const namedPageMaxChunksPerBundle = 12;
const companionGuidanceLimit = 2;
const companionGuidanceBonus = 3;
const companionCategoryCoverageBonus = 2;
const companionSpecificIdentityPenalty = 1.2;

function monotonicNow(): number {
  return globalThis.performance.now();
}

function elapsedMs(startedAt: number, endedAt: number): number {
  return Math.max(0, endedAt - startedAt);
}

function compactText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function clipText(value: string, maxChars: number): string {
  const compacted = compactText(value);
  if (compacted.length <= maxChars) {
    return compacted;
  }
  return `${compacted.slice(0, maxChars - 3).trimEnd()}...`;
}

function recentConversationMessages(
  request: RetrieveRequest
): RetrieveRequest['conversationContext']['latestMessages'] {
  return request.conversationContext.latestMessages
    .filter((message) => compactText(message.content).length > 0)
    .slice(-maxConversationContextMessages);
}

function conversationContextForRetrieval(
  request: RetrieveRequest
): RetrieveRequest['conversationContext']['latestMessages'] {
  if (!isReferentialFollowUpQuery(request.query)) {
    return [];
  }

  return recentConversationMessages(request);
}

function queryEmbeddingInput(request: RetrieveRequest): string {
  const query = clipText(request.query, maxQueryEmbeddingChars);
  const recentMessages = conversationContextForRetrieval(request);
  if (recentMessages.length === 0) {
    return query;
  }

  const context = recentMessages
    .map((message) => {
      const label = message.role === 'user' ? 'USER' : 'ASSISTANT';
      return `${label}: ${clipText(message.content, maxConversationMessageChars)}`;
    })
    .join('\n');

  return `Current question:\n${query}\n\nRecent conversation:\n${context}`;
}

function queryRerankInput(request: RetrieveRequest): string {
  const recentMessages = conversationContextForRetrieval(request);
  return [
    request.query,
    ...recentMessages.map((message) =>
      [message.content, ...(message.citations ?? []).map((citation) => citation.usedFor)].join(' ')
    ),
  ].join('\n');
}

function quoteFor(chunk: RetrievalChunk): string {
  const trimmed = chunk.text.trim();
  return trimmed.length <= 320 ? trimmed : `${trimmed.slice(0, 317).trimEnd()}...`;
}

function evidenceFromChunk(bundle: RetrievalBundle): RagEvidence {
  const input = { page: bundle.page, chunk: bundle.citationChunk };
  return {
    id: publicEvidenceId(input),
    sourceId: 'knowledge-service',
    sourceType: 'knowledge_page',
    title: bundle.page.title,
    quote: quoteFor(bundle.citationChunk),
    content: bundle.contentChunk.text,
    score: bundle.score,
    ...(bundle.page.source.url === null ? {} : { url: bundle.page.source.url }),
    metadata: {
      headingPath: [...bundle.contentChunk.headingPath],
      path: [...bundle.contentChunk.path],
      ...(bundle.page.source.label === null ? {} : { sourceLabel: bundle.page.source.label }),
    },
  };
}

function topK(value: number | undefined): number {
  if (value === undefined) {
    return 8;
  }

  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 24) : 8;
}

function overfetchLimit(limit: number): number {
  return Math.min(Math.max(limit * 8, 40), 120);
}

function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase('pl-PL')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/gu, 'l');
}

function searchRoot(term: string): string {
  const suffixes = [
    'owego',
    'owej',
    'owymi',
    'owym',
    'ymi',
    'iem',
    'ych',
    'ami',
    'ego',
    'emu',
    'ach',
    'nie',
    'ie',
    'ej',
    'ze',
    'em',
    'ym',
    'im',
    'om',
    'ow',
    'a',
    'y',
    'i',
    'e',
    'u',
  ];
  for (const suffix of suffixes) {
    if (term.endsWith(suffix) && term.length - suffix.length >= 3) {
      return term.slice(0, -suffix.length);
    }
  }
  return term;
}

function queryTerms(query: string): string[] {
  return [
    ...new Set(
      (normalizeSearchText(query).match(/[\p{L}\p{N}]+/gu) ?? [])
        .map((term) => term.trim())
        .map(searchRoot)
        .filter((term) => term.length >= 3)
    ),
  ];
}

const directQuerySubjectStopwords = [
  'about',
  'answer',
  'baza',
  'bazie',
  'bazy',
  'bez',
  'czy',
  'czyli',
  'dane',
  'danych',
  'dla',
  'gdzie',
  'how',
  'jak',
  'jest',
  'kiedy',
  'moge',
  'mozna',
  'nie',
  'oraz',
  'pod',
  'praktyczna',
  'praktycznie',
  'powiedz',
  'question',
  'ryba',
  'ryby',
  'skutecznie',
  'skuteczny',
  'szukac',
  'szukaj',
  'tego',
  'tej',
  'the',
  'this',
  'tylko',
  'what',
  'where',
  'with',
  'krotka',
  'krotko',
] as const;
const directQueryTermStopRoots = new Set(directQuerySubjectStopwords.flatMap(queryTerms));

function directQueryTerms(query: string): string[] {
  return queryTerms(query).filter((term) => !directQueryTermStopRoots.has(term));
}

function currentQuestionForDirectTerms(query: string): string {
  const currentQuestionPattern =
    /(?:^|\n)\s*(?:Bieżące pytanie|Biezace pytanie|Current question)\s*:\s*(.+?)(?=\n\s*(?:Wcześniejsze pytania|Wczesniejsze pytania|Recent conversation|Previous questions)\s*:|\n\s*Użytkownik\s*:|\n\s*USER\s*:|$)/isu;
  const match = currentQuestionPattern.exec(query);
  return match?.[1]?.trim() ?? query;
}

function lexicalScoreText(text: string, terms: readonly string[]): number {
  if (terms.length === 0) {
    return 0;
  }

  const haystack = normalizeSearchText(text);
  const hits = terms.filter((term) => haystack.includes(term)).length;
  return hits / terms.length;
}

function lexicalScore(chunk: RetrievalChunk, terms: readonly string[]): number {
  return lexicalScoreText(
    `${chunk.title} ${chunk.path.join(' ')} ${chunk.headingPath.join(' ')} ${
      chunk.searchableText
    } ${chunk.text}`,
    terms
  );
}

function titlePathScore(chunk: RetrievalChunk, terms: readonly string[]): number {
  return lexicalScoreText(
    `${chunk.title} ${chunk.path.join(' ')} ${chunk.headingPath.join(' ')}`,
    terms
  );
}

function combinedScore(
  chunk: RetrievalChunkMatch,
  terms: readonly string[],
  directTerms: readonly string[]
) {
  return (
    chunk.vectorScore +
    lexicalScore(chunk, terms) * lexicalCandidateWeight +
    titlePathScore(chunk, directTerms) * titlePathWeight
  );
}

function lexicalCandidateSelectionScore(
  chunk: RetrievalChunk,
  input: {
    terms: readonly string[];
    directTerms: readonly string[];
  }
): number {
  return (
    lexicalScore(chunk, input.terms) * lexicalCandidateWeight +
    titlePathScore(chunk, input.directTerms) * titlePathWeight
  );
}

function guidanceCandidateSelectionScore(
  chunk: RetrievalChunk,
  guidanceTerms: readonly string[]
): number {
  if (guidanceTerms.length < 2) {
    return 0;
  }

  return (
    lexicalScore(chunk, guidanceTerms) * lexicalCandidateWeight +
    titlePathScore(chunk, guidanceTerms) * titlePathWeight
  );
}

function lexicalCandidateLimit(limit: number): number {
  return Math.min(Math.max(limit * lexicalCandidateLimitMultiplier, 24), 240);
}

interface LexicalCandidateResult {
  candidates: RetrievalChunkMatch[];
  scannedCount: number;
  limitHit: boolean;
  activeCurrentChunkCount?: number;
  performance: {
    fetchMs: number;
    scoringMs: number;
    totalMs: number;
  };
}

async function lexicalCandidates(
  deps: RetrieveKnowledgeDeps,
  input: {
    terms: readonly string[];
    directTerms: readonly string[];
  },
  limit: number
): Promise<Result<LexicalCandidateResult, KnowledgeRepositoryError>> {
  if (input.terms.length === 0) {
    return ok({
      candidates: [],
      scannedCount: 0,
      limitHit: false,
      performance: {
        fetchMs: 0,
        scoringMs: 0,
        totalMs: 0,
      },
    });
  }

  const lexicalStartedAt = monotonicNow();
  const chunksResult = await deps.pageChunkRepository.listRetrievableActiveLexicalCandidates({
    limit: maxLexicalCandidateChunks,
  });
  if (!chunksResult.ok) {
    return chunksResult;
  }
  const afterFetchAt = monotonicNow();

  const candidates = chunksResult.value.chunks
    .map((chunk) => ({ chunk, score: lexicalCandidateSelectionScore(chunk, input) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  const directNamedCandidates = chunksResult.value.chunks
    .map((chunk) => ({
      chunk,
      namedScore: namedPageMatchScore(chunk, input.directTerms),
      lexicalScore: lexicalCandidateSelectionScore(chunk, input),
    }))
    .filter((candidate) => candidate.namedScore >= namedPageExpansionThreshold)
    .sort(
      (left, right) => right.namedScore - left.namedScore || right.lexicalScore - left.lexicalScore
    )
    .slice(0, directNamedPageCandidateLimit);
  const limitCap = lexicalCandidateLimit(limit);
  const guidanceTerms = companionGuidanceTerms(input.terms);
  const selectedCandidateIds = new Set<string>();
  const selectedCandidateChunks: RetrievalChunkMatch[] = [];
  const addCandidate = (chunk: RetrievalChunk) => {
    if (selectedCandidateIds.has(chunk.id)) {
      return;
    }
    selectedCandidateIds.add(chunk.id);
    selectedCandidateChunks.push({ ...chunk, vectorScore: 0 });
  };
  for (const { chunk } of candidates.slice(0, limitCap)) {
    addCandidate(chunk);
  }
  for (const { chunk } of directNamedCandidates) {
    addCandidate(chunk);
  }
  if (guidanceTerms.length >= 2) {
    const guidanceCandidates = chunksResult.value.chunks
      .map((chunk) => ({ chunk, score: guidanceCandidateSelectionScore(chunk, guidanceTerms) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, lexicalGuidanceCandidateLimit);
    for (const { chunk } of guidanceCandidates) {
      addCandidate(chunk);
    }
  }
  const afterScoringAt = monotonicNow();

  return ok({
    candidates: selectedCandidateChunks,
    scannedCount: chunksResult.value.scannedCount,
    limitHit: chunksResult.value.limitHit || candidates.length > limitCap,
    ...(chunksResult.value.activeCurrentChunkCount === undefined
      ? {}
      : { activeCurrentChunkCount: chunksResult.value.activeCurrentChunkCount }),
    performance: {
      fetchMs: elapsedMs(lexicalStartedAt, afterFetchAt),
      scoringMs: elapsedMs(afterFetchAt, afterScoringAt),
      totalMs: elapsedMs(lexicalStartedAt, afterScoringAt),
    },
  });
}

function mergeCandidates(
  vectorCandidates: readonly KnowledgePageChunkMatch[],
  lexicalCandidateChunks: readonly RetrievalChunkMatch[]
): RetrievalChunkMatch[] {
  const candidatesById = new Map<string, RetrievalChunkMatch>();

  for (const chunk of vectorCandidates) {
    candidatesById.set(chunk.id, chunk);
  }

  for (const chunk of lexicalCandidateChunks) {
    if (!candidatesById.has(chunk.id)) {
      candidatesById.set(chunk.id, chunk);
    }
  }

  return [...candidatesById.values()];
}

function normalizedConversationContext(request: RetrieveRequest): string {
  return normalizeSearchText(
    conversationContextForRetrieval(request)
      .map((message) =>
        [message.content, ...(message.citations ?? []).map((citation) => citation.usedFor)].join(
          ' '
        )
      )
      .join('\n')
  );
}

function isReferentialFollowUpQuery(query: string): boolean {
  const normalized = normalizeSearchText(query);
  return [
    'tym samym',
    'tym dokumencie',
    'tym artykule',
    'same document',
    'that document',
    'this document',
    'same topic',
    'that topic',
    'this topic',
    'krok po kroku',
    'jak wyglada',
  ].some((phrase) => normalized.includes(phrase));
}

function conversationMentionsChunkPage(input: {
  chunk: RetrievalChunk;
  normalizedContext: string;
}): boolean {
  const contextTerms = new Set(queryTerms(input.normalizedContext));
  const aliases = [input.chunk.title, input.chunk.path.at(-1), input.chunk.headingPath.at(0)];

  return aliases.some((alias) => {
    const normalizedAlias = normalizeSearchText(alias ?? '');
    if (normalizedAlias.length < 3) {
      return false;
    }
    if (input.normalizedContext.includes(normalizedAlias)) {
      return true;
    }

    const aliasTerms = queryTerms(normalizedAlias);
    return aliasTerms.length >= 2 && aliasTerms.every((term) => contextTerms.has(term));
  });
}

function pageIdentityScore(chunk: RetrievalChunk, terms: readonly string[]): number {
  return lexicalScoreText(
    `${chunk.title} ${chunk.path.join(' ')} ${chunk.headingPath.slice(0, 1).join(' ')}`,
    terms
  );
}

const namedPageStopwords = [
  'base',
  'classroom',
  'ciepla',
  'cieple',
  'cieply',
  'czym',
  'dodatki',
  'feeder',
  'gatunek',
  'gatunki',
  'jest',
  'jak',
  'knowledge',
  'lowic',
  'lowienie',
  'lowienia',
  'lowiska',
  'lowisko',
  'metoda',
  'metody',
  'method',
  'naprawde',
  'ogolne',
  'ogolny',
  'plan',
  'plany',
  'plynne',
  'plytka',
  'plytkie',
  'plytki',
  'przepis',
  'przepisy',
  'roslin',
  'roslinnosc',
  'roslinnosci',
  'wedkarski',
  'fishing',
  'wedkarstwo',
  'woda',
  'wodzie',
  'wody',
  'zaneta',
  'zanety',
  'zatoka',
  'zatoki',
] as const;
const namedPageStopRoots = new Set(namedPageStopwords.flatMap(queryTerms));

function aliasLooksLikeNamedIdentity(alias: string): boolean {
  const normalized = normalizeSearchText(alias).trim();
  if (normalized.length === 0) {
    return false;
  }

  return !/^(?:co|czym|dlaczego|gdzie|how|jak|kiedy|what|when|where|why)\b/u.test(normalized);
}

function namedPageAliasVariants(alias: string | undefined): string[] {
  if (alias === undefined || !aliasLooksLikeNamedIdentity(alias)) {
    return [];
  }

  const variants = [alias];
  const prefix = alias.split(/\s[-–—:]\s|\(/u)[0]?.trim();
  if (prefix !== undefined && prefix.length >= 3 && prefix !== alias) {
    variants.push(prefix);
  }
  return [...new Set(variants)];
}

function directTermMatchesAliasTerm(input: {
  aliasTerm: string;
  directTermSet: ReadonlySet<string>;
}): boolean {
  if (input.directTermSet.has(input.aliasTerm)) {
    return true;
  }

  if (input.aliasTerm.length < 4) {
    return false;
  }

  for (const directTerm of input.directTermSet) {
    if (
      directTerm.startsWith(input.aliasTerm) &&
      directTerm.length > input.aliasTerm.length &&
      directTerm.length <= input.aliasTerm.length + 2
    ) {
      return true;
    }
  }

  return false;
}

function namedPageMatch(
  chunk: RetrievalChunk,
  directTerms: readonly string[]
): { score: number; coverageKey: string | null } {
  if (directTerms.length === 0) {
    return { score: 0, coverageKey: null };
  }

  const directTermSet = new Set(directTerms);
  const aliases = [chunk.title, chunk.path.at(-1)].flatMap(namedPageAliasVariants);
  let bestScore = 0;
  let bestCoverageKey: string | null = null;
  for (const alias of aliases) {
    const aliasTerms = queryTerms(alias).filter((term) => !namedPageStopRoots.has(term));
    if (aliasTerms.length === 0) {
      continue;
    }

    const hitTerms = aliasTerms.filter((term) =>
      directTermMatchesAliasTerm({ aliasTerm: term, directTermSet })
    );
    const hitCount = hitTerms.length;
    if (hitCount === 0) {
      continue;
    }

    const ratio = hitCount / aliasTerms.length;
    const firstAliasTerm = aliasTerms[0];
    const firstTermHit = firstAliasTerm !== undefined && directTermSet.has(firstAliasTerm);
    const strongPartialScore =
      hitCount >= 2 ||
      (hitCount === 1 && (aliasTerms.length <= 3 || firstTermHit) && hitTerms[0] !== undefined)
        ? 0.85
        : 0;
    const score = Math.max(ratio, strongPartialScore);
    if (score > bestScore) {
      bestScore = score;
      bestCoverageKey = hitTerms.join('\u0000') || null;
    }
  }

  return { score: bestScore, coverageKey: bestCoverageKey };
}

function namedPageMatchScore(chunk: RetrievalChunk, directTerms: readonly string[]): number {
  return namedPageMatch(chunk, directTerms).score;
}

const companionGuidanceIntentWords = [
  'amount',
  'amounts',
  'aroma',
  'aromas',
  'caution',
  'cautions',
  'choose',
  'dose',
  'doses',
  'dosage',
  'extract',
  'extracts',
  'intensity',
  'oil',
  'oils',
  'risk',
  'risks',
  'season',
  'seasonal',
  'scent',
  'scents',
  'smell',
  'smells',
  'stimulus',
  'stimuli',
  'subtle',
  'subtlety',
  'temperature',
  'temperatures',
  'water',
  'waters',
  'when',
  'avoid',
  'cold',
  'warm',
  'aromat',
  'aromaty',
  'bodziec',
  'bodzce',
  'bodzcow',
  'dawkowanie',
  'dawka',
  'dawki',
  'dawkowac',
  'ekstrakt',
  'ekstrakty',
  'ilosc',
  'ilosci',
  'intensywnosc',
  'kiedy',
  'laczyc',
  'mieszac',
  'odpuscic',
  'olej',
  'oleje',
  'ostroznie',
  'pora',
  'pory',
  'przebodzcowanie',
  'przebodzcowania',
  'przesycenie',
  'przesyca',
  'ryzyko',
  'ryzyka',
  'sezon',
  'sezonowy',
  'subtelnie',
  'subtelnosc',
  'temperatura',
  'temperatury',
  'unikac',
  'woda',
  'wody',
  'wodzie',
  'wiosna',
  'zapach',
  'zapachem',
  'zapachow',
  'zapachy',
  'jesien',
  'lato',
  'zima',
  'zimna',
  'zimnej',
  'ciepla',
  'cieplej',
] as const;
const companionGuidanceIntentRoots = new Set(companionGuidanceIntentWords.flatMap(queryTerms));

const categoryContextStopwords = [
  'base',
  'fragment',
  'knowledge',
  'method',
  'ogolne',
  'ogolny',
  'page',
  'section',
  'strona',
  'wedkarski',
  'fishing',
  'wedkarstwo',
  'zanecie',
  'zaneta',
  'zanety',
  'zanetowy',
] as const;
const categoryContextStopRoots = new Set(categoryContextStopwords.flatMap(queryTerms));

function companionGuidanceTerms(terms: readonly string[]): string[] {
  return terms.filter((term) => companionGuidanceIntentRoots.has(term));
}

function chunkIdentityTerms(chunk: RetrievalChunk): string[] {
  return queryTerms(`${chunk.title} ${chunk.path.join(' ')}`).filter(
    (term) => !categoryContextStopRoots.has(term)
  );
}

function sharedCategoryTerms(chunks: readonly AccessibleRetrievalChunkMatch[]): Set<string> {
  const counts = new Map<string, number>();
  const topChunks = chunks.slice(0, 12);
  for (const chunk of topChunks) {
    for (const term of new Set(chunkIdentityTerms(chunk))) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }

  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([term]) => term)
      .filter((term) => term.length >= 4)
  );
}

function companionGuidanceScore(input: {
  chunk: AccessibleRetrievalChunkMatch;
  terms: readonly string[];
  directTerms: readonly string[];
  guidanceTerms: readonly string[];
  sharedCategoryTerms: ReadonlySet<string>;
}): number {
  if (input.guidanceTerms.length === 0 || input.sharedCategoryTerms.size === 0) {
    return 0;
  }

  const namedMatchScore = namedPageMatchScore(input.chunk, input.directTerms);
  if (namedMatchScore >= namedPageExpansionThreshold) {
    return 0;
  }

  const identityTerms = chunkIdentityTerms(input.chunk);
  const categoryHitCount = identityTerms.filter((term) =>
    input.sharedCategoryTerms.has(term)
  ).length;
  const requiredCategoryHits = input.sharedCategoryTerms.size >= 2 ? 2 : 1;
  if (categoryHitCount < requiredCategoryHits) {
    return 0;
  }
  const categoryCoverage = categoryHitCount / Math.max(identityTerms.length, 1);
  const specificIdentityTermCount = identityTerms.filter(
    (term) => !input.sharedCategoryTerms.has(term)
  ).length;

  const guidanceScore = lexicalScoreText(
    `${input.chunk.title} ${input.chunk.path.join(' ')} ${input.chunk.headingPath.join(' ')} ${
      input.chunk.searchableText
    } ${input.chunk.text}`,
    input.guidanceTerms
  );
  if (guidanceScore <= 0) {
    return 0;
  }
  const guidanceConceptHitCount = companionGuidanceConceptHitCount(input.chunk);

  return (
    combinedScore(input.chunk, input.terms, input.directTerms) +
    guidanceScore * lexicalCandidateWeight +
    Math.min(guidanceConceptHitCount, 6) * 0.35 +
    categoryHitCount * 0.5 +
    categoryCoverage * companionCategoryCoverageBonus +
    companionGuidanceBonus -
    specificIdentityTermCount * companionSpecificIdentityPenalty
  );
}

function companionGuidanceConceptHitCount(chunk: RetrievalChunk): number {
  const haystack = normalizeSearchText(
    `${chunk.title} ${chunk.path.join(' ')} ${chunk.headingPath.join(' ')} ${chunk.searchableText} ${
      chunk.text
    }`
  );
  let hitCount = 0;
  for (const term of companionGuidanceIntentRoots) {
    if (haystack.includes(term)) {
      hitCount += 1;
    }
  }
  return hitCount;
}

function companionGuidanceCategoryCoverage(input: {
  chunk: AccessibleRetrievalChunkMatch;
  sharedCategoryTerms: ReadonlySet<string>;
}): number {
  const identityTerms = chunkIdentityTerms(input.chunk);
  if (identityTerms.length === 0) {
    return 0;
  }

  const categoryHitCount = identityTerms.filter((term) =>
    input.sharedCategoryTerms.has(term)
  ).length;
  return categoryHitCount / identityTerms.length;
}

function selectCompanionGuidanceChunks(input: {
  chunks: readonly AccessibleRetrievalChunkMatch[];
  rankedChunks: readonly AccessibleRetrievalChunkMatch[];
  terms: readonly string[];
  directTerms: readonly string[];
  query: string;
}): { chunk: AccessibleRetrievalChunkMatch; score: number }[] {
  if (!isDetailOrComparisonQuery(input.query)) {
    return [];
  }

  const guidanceTerms = companionGuidanceTerms(input.terms);
  if (guidanceTerms.length === 0) {
    return [];
  }

  const categoryTerms = sharedCategoryTerms(input.rankedChunks);
  if (categoryTerms.size === 0) {
    return [];
  }

  const rankedPageIds = new Set(input.rankedChunks.map((chunk) => chunk.page.id));
  const candidatesByPage = new Map<
    string,
    { chunk: AccessibleRetrievalChunkMatch; score: number; categoryCoverage: number }
  >();
  for (const chunk of input.chunks) {
    const score = companionGuidanceScore({
      chunk,
      terms: input.terms,
      directTerms: input.directTerms,
      guidanceTerms,
      sharedCategoryTerms: categoryTerms,
    });
    if (score <= 0) {
      continue;
    }

    const categoryCoverage = companionGuidanceCategoryCoverage({
      chunk,
      sharedCategoryTerms: categoryTerms,
    });
    const existing = candidatesByPage.get(chunk.page.id);
    if (existing === undefined || score > existing.score) {
      candidatesByPage.set(chunk.page.id, { chunk, score, categoryCoverage });
    }
  }

  const candidates = [...candidatesByPage.values()].sort((left, right) => right.score - left.score);
  const selected: typeof candidates = [];
  const pureCategoryCandidate = candidates.find((candidate) => candidate.categoryCoverage >= 0.9);
  if (pureCategoryCandidate !== undefined) {
    selected.push(pureCategoryCandidate);
  }

  for (const candidate of candidates) {
    if (
      selected.some(
        (selectedCandidate) => selectedCandidate.chunk.page.id === candidate.chunk.page.id
      )
    ) {
      continue;
    }
    if (rankedPageIds.has(candidate.chunk.page.id)) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= companionGuidanceLimit) {
      return selected;
    }
  }

  for (const candidate of candidates) {
    if (
      selected.some(
        (selectedCandidate) => selectedCandidate.chunk.page.id === candidate.chunk.page.id
      )
    ) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= companionGuidanceLimit) {
      return selected;
    }
  }

  return selected;
}

function isDetailOrComparisonQuery(query: string): boolean {
  const normalized = normalizeSearchText(query);
  return /\b(?:amounts?|assemble|balance|behavior|behaviors|behaviour|behaviours|biological|biology|build|compare|comparison|configure|configuration|different|differences|ecological|ecology|exact|habitat|habitats|ingredient|ingredients|life|plan|practical|quantities|quantity|recipe|rig|season|seasonal|setup|species|spawn|spawning|strategy|tactic|tactics|technique|techniques|balans\w*|biologi\w*|budow\w*|cykl\w*|doklad\w*|drapieznik\w*|ekolog\w*|gatunk\w*|gram\w*|ilosc\w*|konfigur\w*|konstru\w*|montaz\w*|plan\w*|porown\w*|praktycz\w*|proporcj\w*|przepis\w*|receptur\w*|rozn\w*|sezon\w*|siedlisk\w*|sklad\w*|skladnik\w*|strateg\w*|taktyk\w*|tarl\w*|technik\w*|ustaw\w*|wywaz\w*|zachowan\w*|zbud\w*|zerowan\w*|zloz\w*|zwyczaj\w*)\b/iu.test(
    normalized
  );
}

function isSummaryStyleQuery(query: string): boolean {
  return /\b(summary|summarize|overview)\b|\b(?:whole|entire)\s+document\b|\ball\s+notes\b|\bfull\s+notes\b/iu.test(
    query
  );
}

function shouldExpandParentPage(
  chunk: RetrievalChunk,
  terms: readonly string[],
  query: string,
  context: { referentialFollowUp: boolean; normalizedConversation: string }
): boolean {
  const detailOrComparison = isDetailOrComparisonQuery(query);
  return (
    isSummaryStyleQuery(query) ||
    (!detailOrComparison && pageIdentityScore(chunk, terms) >= pageExpansionThreshold) ||
    (context.referentialFollowUp &&
      conversationMentionsChunkPage({
        chunk,
        normalizedContext: context.normalizedConversation,
      }))
  );
}

function pageAndChunkMetadataMatch(input: {
  page: RetrievalPageMetadata;
  chunk: RetrievalChunk;
}): boolean {
  const { page, chunk } = input;
  if (
    chunk.pageId !== page.id ||
    chunk.nodeId !== page.nodeId ||
    chunk.categoryId !== page.categoryId ||
    chunk.sectionId !== page.sectionId
  ) {
    return false;
  }

  if (
    chunk.access.gate !== page.access.effective.gate ||
    chunk.access.requiredLevel !== page.access.effective.requiredLevel
  ) {
    return false;
  }

  return (
    chunk.source.type === page.source.type &&
    chunk.source.url === page.source.url &&
    chunk.source.label === page.source.label
  );
}

function isAuthorizedForRag(input: {
  authorization: RagAuthorizationContext;
  chunk: RetrievalChunk;
}): boolean {
  switch (input.chunk.access.gate) {
    case 'public':
    case 'approved':
      return true;
    case 'level':
      return input.authorization.effectiveLevel >= (input.chunk.access.requiredLevel ?? 11);
    case 'excluded':
      return false;
  }
}

function isRetrievable(input: {
  authorization: RagAuthorizationContext;
  page: RetrievalPageMetadata;
  chunk: RetrievalChunk;
}): boolean {
  if (
    !isKnowledgePageChunkRetrievalEligible({
      page: input.page as KnowledgePage,
      chunk: input.chunk as KnowledgePageChunk,
    })
  ) {
    return false;
  }
  if (
    input.page.source.url !== null &&
    !validateKnowledgeSourceUrl(input.page.source, 'page source').ok
  ) {
    return false;
  }
  if (!pageAndChunkMetadataMatch({ page: input.page, chunk: input.chunk })) {
    return false;
  }
  return isAuthorizedForRag({ authorization: input.authorization, chunk: input.chunk });
}

function bucketCandidateCount(count: number): AnswerGapCandidateCountBucket {
  if (count <= 0) {
    return '0';
  }
  if (count === 1) {
    return '1';
  }
  if (count <= 5) {
    return '2-5';
  }
  return '6+';
}

function higherLevelRequiredLevel(input: {
  authorization: RagAuthorizationContext;
  page: RetrievalPageMetadata | null;
  chunk: RetrievalChunk;
}): number | null {
  if (
    !isKnowledgePageChunkRetrievalEligible({
      page: input.page as KnowledgePage | null,
      chunk: input.chunk as KnowledgePageChunk,
    }) ||
    input.page === null ||
    input.chunk.access.gate !== 'level'
  ) {
    return null;
  }

  const requiredLevel = input.chunk.access.requiredLevel;
  if (requiredLevel === null || requiredLevel <= input.authorization.effectiveLevel) {
    return null;
  }
  return requiredLevel;
}

function coverageProbeFromCandidates(input: {
  authorization: RagAuthorizationContext;
  candidates: readonly (RetrievalChunkMatch & { page: RetrievalPageMetadata | null })[];
}): AnswerGapCoverageProbe {
  if (input.candidates.length === 0) {
    return {
      classification: 'no_candidate_seen',
      minRequiredLevel: null,
      candidateCountBucket: '0',
      probeVersion: '1.0.0',
    };
  }

  const accessibleCandidateCount = input.candidates.filter(
    (candidate) =>
      candidate.page !== null &&
      isRetrievable({
        authorization: input.authorization,
        page: candidate.page,
        chunk: candidate,
      })
  ).length;
  if (accessibleCandidateCount > 0) {
    return {
      classification: 'accessible_candidate_seen',
      minRequiredLevel: null,
      candidateCountBucket: bucketCandidateCount(accessibleCandidateCount),
      probeVersion: '1.0.0',
    };
  }

  const higherLevelRequiredLevels = input.candidates
    .map((candidate) =>
      higherLevelRequiredLevel({
        authorization: input.authorization,
        page: candidate.page,
        chunk: candidate,
      })
    )
    .filter((requiredLevel): requiredLevel is number => requiredLevel !== null);
  if (higherLevelRequiredLevels.length > 0) {
    return {
      classification: 'higher_level_candidate_seen',
      minRequiredLevel: Math.min(...higherLevelRequiredLevels),
      candidateCountBucket: bucketCandidateCount(higherLevelRequiredLevels.length),
      probeVersion: '1.0.0',
    };
  }

  return {
    classification: 'restricted_or_invalid_candidate_seen',
    minRequiredLevel: null,
    candidateCountBucket: bucketCandidateCount(input.candidates.length),
    probeVersion: '1.0.0',
  };
}

function uniquePageIdsForChunks(chunks: readonly RetrievalChunk[]): string[] {
  const seenPageIds = new Set<string>();
  const pageIds: string[] = [];
  for (const chunk of chunks) {
    if (seenPageIds.has(chunk.pageId)) {
      continue;
    }
    seenPageIds.add(chunk.pageId);
    pageIds.push(chunk.pageId);
  }
  return pageIds;
}

function rankedAccessibleChunks(input: {
  chunks: readonly AccessibleRetrievalChunkMatch[];
  terms: readonly string[];
  directTerms: readonly string[];
  limit: number;
}): AccessibleRetrievalChunkMatch[] {
  return [...input.chunks]
    .sort(
      (left, right) =>
        combinedScore(right, input.terms, input.directTerms) -
        combinedScore(left, input.terms, input.directTerms)
    )
    .slice(0, input.limit);
}

function selectNamedPageCoverageChunks(input: {
  chunks: readonly AccessibleRetrievalChunkMatch[];
  terms: readonly string[];
  directTerms: readonly string[];
  limit: number;
  excludedCoverageKeys?: ReadonlySet<string>;
}): NamedPageCoverageCandidate[] {
  if (input.directTerms.length === 0) {
    return [];
  }

  const excludedCoverageKeys = input.excludedCoverageKeys ?? new Set<string>();
  const candidatesByCoverageKey = new Map<string, NamedPageCoverageCandidate>();
  for (const chunk of input.chunks) {
    const match = namedPageMatch(chunk, input.directTerms);
    if (
      match.score < namedPageExpansionThreshold ||
      match.coverageKey === null ||
      excludedCoverageKeys.has(match.coverageKey)
    ) {
      continue;
    }

    const candidate: NamedPageCoverageCandidate = {
      chunk,
      coverageKey: match.coverageKey,
      matchScore: match.score,
      parentScore:
        combinedScore(chunk, input.terms, input.directTerms) +
        match.score * namedPageExpansionBonus,
    };
    const existing = candidatesByCoverageKey.get(match.coverageKey);
    if (existing === undefined || candidate.parentScore > existing.parentScore) {
      candidatesByCoverageKey.set(match.coverageKey, candidate);
    }
  }

  return [...candidatesByCoverageKey.values()]
    .sort((left, right) => right.parentScore - left.parentScore)
    .slice(0, input.limit);
}

function selectPrioritizedNamedPageCoverageChunks(input: {
  chunks: readonly AccessibleRetrievalChunkMatch[];
  terms: readonly string[];
  primaryDirectTerms: readonly string[];
  secondaryDirectTerms: readonly string[];
  limit: number;
}): NamedPageCoverageCandidate[] {
  const primary = selectNamedPageCoverageChunks({
    chunks: input.chunks,
    terms: input.terms,
    directTerms: input.primaryDirectTerms,
    limit: input.limit,
  });
  const usedCoverageKeys = new Set(primary.map((candidate) => candidate.coverageKey));
  if (primary.length >= input.limit) {
    return primary;
  }

  const secondary = selectNamedPageCoverageChunks({
    chunks: input.chunks,
    terms: input.terms,
    directTerms: input.secondaryDirectTerms,
    limit: input.limit - primary.length,
    excludedCoverageKeys: usedCoverageKeys,
  });
  return [...primary, ...secondary];
}

export async function retrieveKnowledge(
  deps: RetrieveKnowledgeDeps,
  request: RetrieveRequest
): Promise<Result<RetrieveResponse, RetrieveError>> {
  if (request.query.trim().length === 0) {
    return err({ code: 'INVALID_REQUEST', message: 'query must not be empty' });
  }

  try {
    const retrievalStartedAt = monotonicNow();
    const limit = topK(request.options?.topK);
    const terms = queryTerms(queryRerankInput(request));
    const directTerms = directQueryTerms(request.query);
    const currentQuestionDirectTerms = directQueryTerms(
      currentQuestionForDirectTerms(request.query)
    );
    const vectorCandidateLimit = overfetchLimit(limit);
    const lexicalResultPromise = lexicalCandidates(deps, { terms, directTerms }, limit).catch(
      (error: unknown) =>
        err({ code: 'DOWNSTREAM_ERROR' as const, message: getErrorMessage(error) })
    );

    const embeddingInput = queryEmbeddingInput(request);
    const embeddingResponse = await deps.embeddingProvider.embed({
      input: embeddingInput,
      model: deps.embeddingConfig.model,
      dimensions: deps.embeddingConfig.dimensions,
      owner: { type: 'user', id: request.authorization.userId },
      promptType: 'rag-query-embedding',
      promptVersion: queryEmbeddingInputBuilder.version,
      ...(request.usageCorrelation !== undefined ? { correlation: request.usageCorrelation } : {}),
    });
    const afterEmbeddingAt = monotonicNow();
    const mismatchMessage = embeddingResponseMismatchMessage(deps.embeddingConfig, {
      provider: embeddingResponse.provider,
      model: embeddingResponse.model,
      dimensions: embeddingResponse.dimensions,
    });
    if (mismatchMessage !== null) {
      return err({ code: 'DOWNSTREAM_ERROR', message: mismatchMessage });
    }

    const queryVector = embeddingResponse.vectors[0];
    if (queryVector === undefined) {
      return err({
        code: 'DOWNSTREAM_ERROR',
        message: 'Embedding provider did not return a query vector.',
      });
    }

    const nearestResult = await deps.pageChunkRepository.findNearestPageChunks({
      embedding: queryVector,
      limit: vectorCandidateLimit,
    });
    if (!nearestResult.ok) {
      return nearestResult;
    }
    const afterVectorSearchAt = monotonicNow();

    const lexicalResult = await lexicalResultPromise;
    if (!lexicalResult.ok) {
      return lexicalResult;
    }
    const afterLexicalCandidatesAt = monotonicNow();

    const candidateChunks = mergeCandidates(nearestResult.value, lexicalResult.value.candidates);
    const afterCandidateMergeAt = monotonicNow();
    const pagesResult = await deps.pageRepository.getRetrievalMetadataByIds(
      uniquePageIdsForChunks(candidateChunks)
    );
    if (!pagesResult.ok) {
      return pagesResult;
    }
    const pagesById = pagesResult.value;
    const candidatesWithPages: (RetrievalChunkMatch & { page: RetrievalPageMetadata | null })[] =
      [];
    const accessibleNearest: AccessibleRetrievalChunkMatch[] = [];

    for (const chunk of candidateChunks) {
      const page = pagesById.get(chunk.pageId) ?? null;
      candidatesWithPages.push({ ...chunk, page });
      if (page !== null && isRetrievable({ authorization: request.authorization, page, chunk })) {
        accessibleNearest.push({ ...chunk, page });
      }
    }
    const afterPageLookupAt = monotonicNow();
    const coverageProbe = coverageProbeFromCandidates({
      authorization: request.authorization,
      candidates: candidatesWithPages,
    });

    const rankedChunks = rankedAccessibleChunks({
      chunks: accessibleNearest,
      terms,
      directTerms,
      limit: Math.max(limit * rankedCandidateLimitMultiplier, minRankedCandidateLimit),
    });
    const namedPageCoverageChunks = selectPrioritizedNamedPageCoverageChunks({
      chunks: accessibleNearest,
      terms,
      primaryDirectTerms: currentQuestionDirectTerms,
      secondaryDirectTerms: directTerms,
      limit: Math.min(limit, namedPageCoverageLimit),
    });
    const companionGuidanceChunks = selectCompanionGuidanceChunks({
      chunks: accessibleNearest,
      rankedChunks,
      terms,
      directTerms,
      query: request.query,
    });
    const namedPageCoverageScores = new Map(
      namedPageCoverageChunks.map(({ chunk, parentScore }) => [chunk.id, parentScore])
    );
    const companionGuidanceScores = new Map(
      companionGuidanceChunks.map(({ chunk, score }) => [chunk.id, score])
    );
    const rankedChunkIds = new Set(rankedChunks.map((chunk) => chunk.id));
    const namedCoverageChunkIds = new Set(namedPageCoverageChunks.map(({ chunk }) => chunk.id));
    const bundleInputChunks = [
      ...rankedChunks,
      ...namedPageCoverageChunks
        .filter(({ chunk }) => !rankedChunkIds.has(chunk.id))
        .map(({ chunk }) => chunk),
      ...companionGuidanceChunks
        .filter(
          ({ chunk }) => !rankedChunkIds.has(chunk.id) && !namedCoverageChunkIds.has(chunk.id)
        )
        .map(({ chunk }) => chunk),
    ];
    const afterRankingAt = monotonicNow();

    const expansionContext = {
      referentialFollowUp: isReferentialFollowUpQuery(request.query),
      normalizedConversation: normalizedConversationContext(request),
    };
    const detailOrComparison = isDetailOrComparisonQuery(request.query);
    const pagesToExpand = new Map<string, PageExpansion>();
    const setPageToExpand = (input: {
      chunk: AccessibleRetrievalChunkMatch;
      parentScore: number;
      isNamedPage: boolean;
    }) => {
      const existing = pagesToExpand.get(input.chunk.page.id);
      if (existing === undefined || input.parentScore > existing.parentScore) {
        pagesToExpand.set(input.chunk.page.id, {
          page: input.chunk.page,
          parentScore: input.parentScore,
          isNamedPage: input.isNamedPage,
        });
        return;
      }

      if (input.isNamedPage && !existing.isNamedPage) {
        pagesToExpand.set(input.chunk.page.id, { ...existing, isNamedPage: true });
      }
    };
    for (const chunk of rankedChunks) {
      if (
        request.options?.expandParentDocuments !== false &&
        shouldExpandParentPage(chunk, terms, request.query, expansionContext)
      ) {
        setPageToExpand({
          chunk,
          parentScore: combinedScore(chunk, terms, directTerms),
          isNamedPage: false,
        });
      }
    }

    if (detailOrComparison && request.options?.expandParentDocuments !== false) {
      for (const candidate of namedPageCoverageChunks.slice(0, namedPageExpansionLimit)) {
        setPageToExpand({
          chunk: candidate.chunk,
          parentScore: candidate.parentScore,
          isNamedPage: true,
        });
      }
    }

    const hitCenteredBundles: RetrievalBundle[] = [];
    const namedPageCoverageBundles: RetrievalBundle[] = [];
    const expandedBundles: RetrievalBundle[] = [];
    const pageChunksById = new Map<string, RetrievalChunk[]>();
    const getRetrievablePageChunks = async (
      page: RetrievalPageMetadata
    ): Promise<Result<RetrievalChunk[], KnowledgeRepositoryError>> => {
      const cached = pageChunksById.get(page.id);
      if (cached !== undefined) {
        return ok(cached);
      }

      const chunksResult = await deps.pageChunkRepository.listRetrievableActiveForPage({
        pageId: page.id,
      });
      if (!chunksResult.ok) {
        return chunksResult;
      }

      const chunks = chunksResult.value.filter((chunk) =>
        isRetrievable({ authorization: request.authorization, page, chunk })
      );
      pageChunksById.set(page.id, chunks);
      return ok(chunks);
    };

    for (const chunk of bundleInputChunks) {
      const expansion = pagesToExpand.get(chunk.page.id);
      const baseScore = Math.max(
        combinedScore(chunk, terms, directTerms),
        namedPageCoverageScores.get(chunk.id) ?? 0,
        companionGuidanceScores.get(chunk.id) ?? 0
      );

      const chunksResult = await getRetrievablePageChunks(chunk.page);
      if (!chunksResult.ok) {
        return chunksResult;
      }

      const bundle = buildCenteredWindowBundle({
        page: chunk.page,
        hitChunk: chunk,
        pageChunks: chunksResult.value,
        baseScore: expansion === undefined ? baseScore : Math.max(baseScore, expansion.parentScore),
        terms,
        maxChars: bundleMaxChars,
      });
      if (bundle !== null) {
        hitCenteredBundles.push(bundle);
        if (namedCoverageChunkIds.has(chunk.id)) {
          namedPageCoverageBundles.push(bundle);
        }
      }
    }

    let expandedItemCount = 0;
    if (pagesToExpand.size > 0) {
      for (const { page, parentScore, isNamedPage } of pagesToExpand.values()) {
        const chunksResult = await getRetrievablePageChunks(page);
        if (!chunksResult.ok) {
          return chunksResult;
        }

        const pageBundles = buildNamedPageBundles({
          page,
          pageChunks: chunksResult.value,
          parentScore,
          terms,
          maxChars: bundleMaxChars,
          maxChunks: namedPageMaxChunksPerBundle,
          maxBundlesPerPage: isNamedPage ? namedPageMaxBundles : 1,
        });
        expandedItemCount += pageBundles.length;
        expandedBundles.push(...pageBundles);
      }
    }
    const afterExpansionAt = monotonicNow();
    const orderedBundles = rankAndPackBundles({
      reservedBundles: namedPageCoverageBundles,
      protectedBundles: hitCenteredBundles,
      bundles: expandedBundles,
      maxBundles: limit,
      globalMaxChars: bundleGlobalMaxChars,
      maxCharsPerBundle: bundleMaxChars,
    });

    return ok({
      items: orderedBundles.map(evidenceFromChunk),
      coverageProbe,
      diagnostics: {
        embeddingModel: embeddingResponse.model,
        embeddingProvider: embeddingResponse.provider,
        embeddingDimensions: embeddingResponse.dimensions,
        searchedChunkCount: bundleInputChunks.length,
        expandedItemCount,
        vectorCandidateLimit,
        vectorReturnedCount: nearestResult.value.length,
        vectorReturnedEmbeddingsIncluded: nearestResult.value.every((chunk) =>
          Array.isArray(chunk.embedding)
        ),
        lexicalScannedCount: lexicalResult.value.scannedCount,
        lexicalLimitHit: lexicalResult.value.limitHit,
        ...(lexicalResult.value.activeCurrentChunkCount === undefined
          ? {}
          : { activeCurrentChunkCount: lexicalResult.value.activeCurrentChunkCount }),
        performance: {
          totalMs: elapsedMs(retrievalStartedAt, afterExpansionAt),
          embeddingMs: elapsedMs(retrievalStartedAt, afterEmbeddingAt),
          vectorSearchMs: elapsedMs(afterEmbeddingAt, afterVectorSearchAt),
          lexicalFetchMs: lexicalResult.value.performance.fetchMs,
          lexicalScoringMs: lexicalResult.value.performance.scoringMs,
          lexicalCandidatesMs: lexicalResult.value.performance.totalMs,
          candidateMergeMs: elapsedMs(afterLexicalCandidatesAt, afterCandidateMergeAt),
          pageLookupMs: elapsedMs(afterCandidateMergeAt, afterPageLookupAt),
          rankingMs: elapsedMs(afterPageLookupAt, afterRankingAt),
          expansionMs: elapsedMs(afterRankingAt, afterExpansionAt),
        },
      },
    });
  } catch (error) {
    return err({ code: 'DOWNSTREAM_ERROR', message: getErrorMessage(error) });
  }
}
