import type {
  KnowledgeRetrievalChunkCandidate,
  KnowledgeRetrievalPageMetadata,
} from '../repositories/knowledgeRepositories.js';

export type RetrievalBundleChunk = KnowledgeRetrievalChunkCandidate;
export type RetrievalBundlePage = KnowledgeRetrievalPageMetadata;
export type RetrievalBundleReason = 'centered_window' | 'named_page_window' | 'merged_overlap';

export interface RetrievalBundle {
  page: RetrievalBundlePage;
  contentChunk: RetrievalBundleChunk;
  citationChunk: RetrievalBundleChunk;
  chunks: RetrievalBundleChunk[];
  score: number;
  includedChunkIndexes: number[];
  includedChunkCount: number;
  truncatedBefore: boolean;
  truncatedAfter: boolean;
  reason: RetrievalBundleReason;
}

export interface BuildCenteredWindowBundleInput {
  page: RetrievalBundlePage;
  hitChunk: RetrievalBundleChunk;
  pageChunks: readonly RetrievalBundleChunk[];
  baseScore: number;
  terms: readonly string[];
  previousCount?: number;
  nextCount?: number;
  maxChars?: number;
}

export interface BuildNamedPageBundlesInput {
  page: RetrievalBundlePage;
  pageChunks: readonly RetrievalBundleChunk[];
  parentScore: number;
  terms: readonly string[];
  maxChars?: number;
  maxChunks?: number;
  maxBundlesPerPage?: number;
}

export interface RankAndPackBundlesInput {
  bundles: readonly RetrievalBundle[];
  reservedBundles?: readonly RetrievalBundle[];
  protectedBundles?: readonly RetrievalBundle[];
  maxBundles: number;
  globalMaxChars: number;
  maxCharsPerBundle?: number;
}

const defaultCenteredPreviousCount = 1;
const defaultCenteredNextCount = 3;
const defaultMaxCharsPerBundle = 4_000;
const defaultNamedPageWindowMaxChunks = 12;
const defaultNamedPageMaxBundlesPerPage = 3;
const bundleSiblingScoreStep = 0.03;
const bundleLexicalWeight = 3;

function compactText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase('pl-PL')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/gu, 'l');
}

function lexicalScoreText(text: string, terms: readonly string[]): number {
  if (terms.length === 0) {
    return 0;
  }

  const haystack = normalizeSearchText(text);
  const hits = terms.filter((term) => haystack.includes(term)).length;
  return hits / terms.length;
}

function chunkTextWithHeading(chunk: RetrievalBundleChunk): string {
  const heading = chunk.headingPath.at(-1);
  const text = compactText(chunk.text);
  if (heading === undefined || compactText(heading) === text) {
    return text;
  }
  return `${compactText(heading)}\n${text}`;
}

function orderedPageChunks(chunks: readonly RetrievalBundleChunk[]): RetrievalBundleChunk[] {
  return [...chunks].sort((left, right) => left.index - right.index);
}

function bundleText(chunks: readonly RetrievalBundleChunk[]): string {
  return chunks.map(chunkTextWithHeading).join('\n\n');
}

function commonHeadingPath(chunks: readonly RetrievalBundleChunk[]): string[] {
  const first = chunks[0];
  if (first === undefined) {
    return [];
  }

  const common: string[] = [];
  for (const [index, heading] of first.headingPath.entries()) {
    if (chunks.every((chunk) => chunk.headingPath[index] === heading)) {
      common.push(heading);
    } else {
      break;
    }
  }
  return common.length > 0 ? common : first.headingPath.slice(0, 1);
}

function bundleScore(input: {
  chunks: readonly RetrievalBundleChunk[];
  baseScore: number;
  terms: readonly string[];
}): number {
  const firstChunk = input.chunks[0];
  const structuralScore =
    input.baseScore - (firstChunk === undefined ? 0 : firstChunk.index * bundleSiblingScoreStep);
  const lexicalScore =
    lexicalScoreText(bundleText(input.chunks), input.terms) * bundleLexicalWeight;
  return Math.max(structuralScore, lexicalScore);
}

function makeBundle(input: {
  page: RetrievalBundlePage;
  chunks: readonly RetrievalBundleChunk[];
  citationChunk?: RetrievalBundleChunk;
  baseScore: number;
  terms: readonly string[];
  truncatedBefore: boolean;
  truncatedAfter: boolean;
  reason: RetrievalBundleReason;
}): RetrievalBundle | null {
  const orderedChunks = orderedPageChunks(input.chunks);
  const first = orderedChunks[0];
  const last = orderedChunks.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }

  const text = bundleText(orderedChunks);
  const contentChunk: RetrievalBundleChunk = {
    ...first,
    id: `${first.id}::bundle::${last.id}`,
    headingPath: commonHeadingPath(orderedChunks),
    text,
    searchableText: text,
  };

  return {
    page: input.page,
    contentChunk,
    citationChunk: input.citationChunk ?? first,
    chunks: orderedChunks,
    score: bundleScore({ chunks: orderedChunks, baseScore: input.baseScore, terms: input.terms }),
    includedChunkIndexes: orderedChunks.map((chunk) => chunk.index),
    includedChunkCount: orderedChunks.length,
    truncatedBefore: input.truncatedBefore,
    truncatedAfter: input.truncatedAfter,
    reason: input.reason,
  };
}

function charsFor(chunks: readonly RetrievalBundleChunk[]): number {
  return bundleText(chunks).length;
}

function fitCenteredWindow(input: {
  chunks: RetrievalBundleChunk[];
  hitIndex: number;
  maxChars: number;
}): RetrievalBundleChunk[] {
  const fitted = [...input.chunks];
  while (fitted.length > 1 && charsFor(fitted) > input.maxChars) {
    const first = fitted[0];
    const last = fitted.at(-1);
    if (first === undefined || last === undefined) {
      break;
    }

    const firstDistance = Math.abs(first.index - input.hitIndex);
    const lastDistance = Math.abs(last.index - input.hitIndex);
    if (last.index !== input.hitIndex && lastDistance >= firstDistance) {
      fitted.pop();
      continue;
    }
    if (first.index !== input.hitIndex) {
      fitted.shift();
      continue;
    }
    fitted.pop();
  }
  return fitted;
}

export function buildCenteredWindowBundle(
  input: BuildCenteredWindowBundleInput
): RetrievalBundle | null {
  const maxChars = input.maxChars ?? defaultMaxCharsPerBundle;
  const previousCount = input.previousCount ?? defaultCenteredPreviousCount;
  const nextCount = input.nextCount ?? defaultCenteredNextCount;
  const chunks = orderedPageChunks(input.pageChunks);
  const hitPosition = chunks.findIndex((chunk) => chunk.id === input.hitChunk.id);
  if (hitPosition < 0) {
    return makeBundle({
      page: input.page,
      chunks: [input.hitChunk],
      citationChunk: input.hitChunk,
      baseScore: input.baseScore,
      terms: input.terms,
      truncatedBefore: false,
      truncatedAfter: false,
      reason: 'centered_window',
    });
  }

  const startPosition = Math.max(0, hitPosition - previousCount);
  const endPosition = Math.min(chunks.length - 1, hitPosition + nextCount);
  const windowChunks = fitCenteredWindow({
    chunks: chunks.slice(startPosition, endPosition + 1),
    hitIndex: input.hitChunk.index,
    maxChars,
  });

  const first = windowChunks[0] ?? input.hitChunk;
  const last = windowChunks.at(-1) ?? input.hitChunk;
  const startChunk = chunks[startPosition] ?? input.hitChunk;
  const endChunk = chunks[endPosition] ?? input.hitChunk;
  return makeBundle({
    page: input.page,
    chunks: windowChunks,
    citationChunk: input.hitChunk,
    baseScore: input.baseScore,
    terms: input.terms,
    truncatedBefore: startPosition > 0 || first.index > startChunk.index,
    truncatedAfter: endPosition < chunks.length - 1 || last.index < endChunk.index,
    reason: 'centered_window',
  });
}

export function buildNamedPageBundles(input: BuildNamedPageBundlesInput): RetrievalBundle[] {
  const maxChars = input.maxChars ?? defaultMaxCharsPerBundle;
  const maxChunks = input.maxChunks ?? defaultNamedPageWindowMaxChunks;
  const maxBundlesPerPage = input.maxBundlesPerPage ?? defaultNamedPageMaxBundlesPerPage;
  const chunks = orderedPageChunks(input.pageChunks);
  const windows: RetrievalBundle[] = [];
  let current: RetrievalBundleChunk[] = [];

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    const first = current[0];
    const last = current.at(-1);
    if (first === undefined || last === undefined) {
      current = [];
      return;
    }

    const bundle = makeBundle({
      page: input.page,
      chunks: current,
      citationChunk: first,
      baseScore: input.parentScore,
      terms: input.terms,
      truncatedBefore: first.index > (chunks[0]?.index ?? first.index),
      truncatedAfter: last.index < (chunks.at(-1)?.index ?? last.index),
      reason: 'named_page_window',
    });
    if (bundle !== null) {
      windows.push(bundle);
    }
    current = [];
  };

  for (const chunk of chunks) {
    const next = [...current, chunk];
    if (current.length > 0 && (current.length >= maxChunks || charsFor(next) > maxChars)) {
      flush();
    }
    current.push(chunk);
  }
  flush();

  return [...windows]
    .sort((left, right) => right.score - left.score)
    .slice(0, maxBundlesPerPage)
    .sort(
      (left, right) => (left.includedChunkIndexes[0] ?? 0) - (right.includedChunkIndexes[0] ?? 0)
    );
}

function overlaps(left: RetrievalBundle, right: RetrievalBundle): boolean {
  if (left.page.id !== right.page.id) {
    return false;
  }
  const rightIndexes = new Set(right.includedChunkIndexes);
  return left.includedChunkIndexes.some((index) => rightIndexes.has(index));
}

function mergeBundles(
  left: RetrievalBundle,
  right: RetrievalBundle,
  maxChars: number
): RetrievalBundle | null {
  if (left.page.id !== right.page.id) {
    return null;
  }

  const chunksByIndex = new Map<number, RetrievalBundleChunk>();
  for (const chunk of [...left.chunks, ...right.chunks]) {
    chunksByIndex.set(chunk.index, chunk);
  }
  const chunks = [...chunksByIndex.values()].sort((a, b) => a.index - b.index);
  if (charsFor(chunks) > maxChars) {
    return null;
  }

  return makeBundle({
    page: left.page,
    chunks,
    citationChunk: left.score >= right.score ? left.citationChunk : right.citationChunk,
    baseScore: Math.max(left.score, right.score),
    terms: [],
    truncatedBefore: left.truncatedBefore || right.truncatedBefore,
    truncatedAfter: left.truncatedAfter || right.truncatedAfter,
    reason: 'merged_overlap',
  });
}

interface DedupeOverlappingBundlesInput {
  protectedBundles: readonly RetrievalBundle[];
  bundles: readonly RetrievalBundle[];
  maxChars: number;
}

export function dedupeOverlappingBundles(input: DedupeOverlappingBundlesInput): RetrievalBundle[] {
  const accepted: RetrievalBundle[] = [];
  const protectedCitationIds = new Set(
    input.protectedBundles.map((bundle) => bundle.citationChunk.id)
  );
  const isProtected = (bundle: RetrievalBundle): boolean =>
    protectedCitationIds.has(bundle.citationChunk.id);

  const candidates = [...input.protectedBundles, ...input.bundles];

  for (const candidate of candidates) {
    const overlapIndex = accepted.findIndex((bundle) => overlaps(bundle, candidate));
    if (overlapIndex < 0) {
      accepted.push(candidate);
      continue;
    }

    const existing = accepted[overlapIndex];
    if (existing === undefined) {
      accepted.push(candidate);
      continue;
    }

    const merged = mergeBundles(existing, candidate, input.maxChars);
    if (merged !== null) {
      accepted[overlapIndex] =
        isProtected(existing) || isProtected(candidate)
          ? {
              ...merged,
              citationChunk: isProtected(existing)
                ? existing.citationChunk
                : candidate.citationChunk,
            }
          : merged;
      continue;
    }

    if (isProtected(existing)) {
      continue;
    }

    if (isProtected(candidate) || candidate.score > existing.score) {
      accepted[overlapIndex] = candidate;
    }
  }
  return accepted;
}

export function rankAndPackBundles(input: RankAndPackBundlesInput): RetrievalBundle[] {
  const maxCharsPerBundle = input.maxCharsPerBundle ?? defaultMaxCharsPerBundle;
  const reservedBundles = input.reservedBundles ?? [];
  const protectedBundles = input.protectedBundles ?? [];
  const reservedCitationIds = new Set(reservedBundles.map((bundle) => bundle.citationChunk.id));
  const protectedCitationIds = new Set(
    [...reservedBundles, ...protectedBundles].map((bundle) => bundle.citationChunk.id)
  );
  const bundles = dedupeOverlappingBundles({
    protectedBundles: [...reservedBundles, ...protectedBundles],
    bundles: input.bundles,
    maxChars: maxCharsPerBundle,
  }).sort((left, right) => {
    const leftProtected = protectedCitationIds.has(left.citationChunk.id);
    const rightProtected = protectedCitationIds.has(right.citationChunk.id);
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (leftProtected !== rightProtected) {
      return leftProtected ? -1 : 1;
    }
    if (left.page.id === right.page.id) {
      return (left.includedChunkIndexes[0] ?? 0) - (right.includedChunkIndexes[0] ?? 0);
    }
    return left.page.title.localeCompare(right.page.title, 'pl');
  });

  const packed: RetrievalBundle[] = [];
  let totalChars = 0;
  const prioritizedBundles = [
    ...bundles.filter((bundle) => reservedCitationIds.has(bundle.citationChunk.id)),
    ...bundles.filter((bundle) => !reservedCitationIds.has(bundle.citationChunk.id)),
  ];

  for (const bundle of prioritizedBundles) {
    if (packed.length >= input.maxBundles) {
      break;
    }
    const chars = bundle.contentChunk.text.length;
    if (packed.length > 0 && totalChars + chars > input.globalMaxChars) {
      continue;
    }

    packed.push(bundle);
    totalChars += chars;
  }
  return packed;
}
