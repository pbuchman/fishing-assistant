import {
  knowledgeContentTypes,
  type KnowledgeChunkDraft,
  type KnowledgeContentType,
} from '../models/knowledge.js';

const MAX_CHUNKS_PER_DOCUMENT = 120;
const TARGET_CHUNK_CHARS = 4_000;
const MAX_CHUNK_CHARS = 7_200;
const headingPattern = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export interface ChunkMarkdownInput {
  markdown: string;
  title?: string | undefined;
  filename?: string | undefined;
  contentType?: KnowledgeContentType | undefined;
}

export interface ChunkMarkdownResult {
  title: string;
  normalizedMarkdown: string;
  contentType: KnowledgeContentType;
  chunks: KnowledgeChunkDraft[];
}

interface Section {
  headingPath: string[];
  blocks: string[];
}

function isKnowledgeContentType(value: unknown): value is KnowledgeContentType {
  return typeof value === 'string' && knowledgeContentTypes.includes(value as KnowledgeContentType);
}

export function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function titleFromFilename(filename: string | undefined): string | null {
  if (filename === undefined) {
    return null;
  }

  const basename = filename.split(/[\\/]/).at(-1) ?? filename;
  const withoutExtension = basename.replace(/\.md$/i, '').trim();
  return withoutExtension.length > 0 ? withoutExtension : null;
}

export function inferMarkdownTitle(markdown: string, filename?: string): string {
  const normalized = normalizeMarkdown(markdown);
  const headings = normalized
    .split('\n')
    .map((line) => headingPattern.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null);
  const h1 = headings.find((match) => match[1] === '#');
  const heading = h1 ?? headings[0];

  if (heading?.[2] !== undefined && heading[2].trim().length > 0) {
    return heading[2].trim();
  }

  return titleFromFilename(filename) ?? 'Untitled Document';
}

function inferContentType(
  markdown: string,
  provided: KnowledgeContentType | undefined
): KnowledgeContentType {
  if (isKnowledgeContentType(provided)) {
    return provided;
  }

  const haystack = markdown.toLowerCase();
  if (/\b(q:|question|answer|faq)\b/.test(haystack)) {
    return 'qna';
  }
  if (/\b(recipe|mix|groundbait|pellet|ingredient)\b/.test(haystack)) {
    return 'recipe';
  }
  if (/\b(carp|bream|roach|tench|barbel|perch|pike|zander|species)\b/.test(haystack)) {
    return 'species';
  }
  if (/\b(session|weather|venue|caught|catch|temperature)\b/.test(haystack)) {
    return 'session-notes';
  }
  if (/\b(how to|guide|steps|method|setup|rig)\b/.test(haystack)) {
    return 'guide';
  }

  return 'other';
}

function updateHeadingPath(path: readonly string[], depth: number, heading: string): string[] {
  const next = path.slice(0, Math.max(0, depth - 1));
  next[depth - 1] = heading;
  return next.filter(Boolean);
}

function splitBlocks(lines: readonly string[]): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let fenceMarker: string | null = null;

  const flush = (): void => {
    const block = current.join('\n').trim();
    if (block.length > 0) {
      blocks.push(block);
    }
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const fence = /^(?<marker>`{3,}|~{3,})/.exec(trimmed)?.groups?.['marker'];
    if (fence !== undefined) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[0] ?? null;
      } else if (fenceMarker !== null && fence.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = null;
      }
      current.push(line);
      continue;
    }

    if (!inFence && trimmed.length === 0) {
      flush();
      continue;
    }

    current.push(line);
  }

  flush();
  return blocks;
}

function markdownSections(normalizedMarkdown: string): Section[] {
  const sections: Section[] = [];
  let headingPath: string[] = [];
  let currentHeadingPath: string[] = [];
  let lines: string[] = [];
  let inFence = false;
  let fenceMarker: string | null = null;

  const flush = (): void => {
    const blocks = splitBlocks(lines);
    if (blocks.length > 0) {
      sections.push({ headingPath: currentHeadingPath, blocks });
    }
    lines = [];
  };

  for (const line of normalizedMarkdown.split('\n')) {
    const trimmed = line.trim();
    const fence = /^(?<marker>`{3,}|~{3,})/.exec(trimmed)?.groups?.['marker'];
    if (fence !== undefined) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[0] ?? null;
      } else if (fenceMarker !== null && fence.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = null;
      }
      lines.push(line);
      continue;
    }

    const heading = !inFence ? headingPattern.exec(trimmed) : null;
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      flush();
      headingPath = updateHeadingPath(headingPath, heading[1].length, heading[2].trim());
      currentHeadingPath = headingPath;
      continue;
    }

    lines.push(line);
  }

  flush();
  return sections;
}

function splitLongParagraph(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > MAX_CHUNK_CHARS) {
    const window = remaining.slice(0, MAX_CHUNK_CHARS + 1);
    const splitIndex =
      Math.max(
        window.lastIndexOf('\n', MAX_CHUNK_CHARS),
        window.lastIndexOf('. ', MAX_CHUNK_CHARS),
        window.lastIndexOf('! ', MAX_CHUNK_CHARS),
        window.lastIndexOf('? ', MAX_CHUNK_CHARS),
        window.lastIndexOf(' ', MAX_CHUNK_CHARS)
      ) || MAX_CHUNK_CHARS;
    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function splitOversizedBlock(block: string): string[] {
  if (/^(`{3,}|~{3,})/.test(block.trim())) {
    return [block];
  }

  if (block.length <= MAX_CHUNK_CHARS) {
    return [block];
  }

  return splitLongParagraph(block);
}

function searchableText(input: {
  title: string;
  headingPath: readonly string[];
  text: string;
}): string {
  return [input.title, ...input.headingPath.slice(1), input.text]
    .filter((part) => part.trim().length > 0)
    .join('\n\n');
}

function buildChunks(input: {
  title: string;
  contentType: KnowledgeContentType;
  sections: readonly Section[];
}): KnowledgeChunkDraft[] {
  const chunks: KnowledgeChunkDraft[] = [];

  for (const section of input.sections) {
    let currentBlocks: string[] = [];
    let currentLength = 0;

    const flush = (): void => {
      const text = currentBlocks.join('\n\n').trim();
      if (text.length === 0) {
        currentBlocks = [];
        currentLength = 0;
        return;
      }

      chunks.push({
        index: chunks.length,
        headingPath: section.headingPath,
        text,
        searchableText: searchableText({
          title: input.title,
          headingPath: section.headingPath,
          text,
        }),
        contentType: input.contentType,
      });
      currentBlocks = [];
      currentLength = 0;
    };

    for (const block of section.blocks.flatMap(splitOversizedBlock)) {
      const nextLength = currentLength + block.length + (currentBlocks.length > 0 ? 2 : 0);
      if (currentBlocks.length > 0 && nextLength > TARGET_CHUNK_CHARS) {
        flush();
      }
      currentBlocks.push(block);
      currentLength += block.length;
    }

    flush();
  }

  return chunks;
}

export function chunkMarkdown(input: ChunkMarkdownInput): ChunkMarkdownResult {
  const normalizedMarkdown = normalizeMarkdown(input.markdown);
  const explicitTitle = input.title?.trim();
  const title =
    explicitTitle !== undefined && explicitTitle.length > 0
      ? explicitTitle
      : inferMarkdownTitle(normalizedMarkdown, input.filename);
  const contentType = inferContentType(normalizedMarkdown, input.contentType);
  const chunks = buildChunks({
    title,
    contentType,
    sections: markdownSections(normalizedMarkdown),
  });

  if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
    throw new Error(
      `Markdown document creates ${String(chunks.length)} chunks; maximum is ${String(
        MAX_CHUNKS_PER_DOCUMENT
      )}.`
    );
  }

  return {
    title,
    normalizedMarkdown,
    contentType,
    chunks,
  };
}
