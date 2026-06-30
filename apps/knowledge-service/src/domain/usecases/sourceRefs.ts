import { createHash } from 'node:crypto';

import type { KnowledgePage, KnowledgePageChunk } from '../models/knowledge.js';

const knowledgePageSourcePrefix = 'knowledge-page:';

export interface KnowledgePageSourceRef {
  ref: string;
  key: string;
}

export function knowledgePageSourceRef(pageId: string): string {
  return `${knowledgePageSourcePrefix}${pageId}`;
}

export function normalizeKnowledgePageSourceRef(sourceRef: string): KnowledgePageSourceRef | null {
  const normalized = sourceRef.includes('\u0000')
    ? sourceRef.slice(sourceRef.lastIndexOf('\u0000') + 1)
    : sourceRef;

  if (!normalized.startsWith(knowledgePageSourcePrefix)) {
    return null;
  }

  const key = normalized.slice(knowledgePageSourcePrefix.length).trim();
  return key.length === 0 ? null : { ref: knowledgePageSourceRef(key), key };
}

export function isPublicEvidenceDigestKey(key: string): boolean {
  return /^[a-f0-9]{24}$/u.test(key);
}

type PublicEvidencePageFields = Pick<KnowledgePage, 'source' | 'title'>;
type PublicEvidenceChunkFields = Pick<
  KnowledgePageChunk,
  'path' | 'headingPath' | 'index' | 'text'
>;

export function publicEvidenceId(input: {
  page: PublicEvidencePageFields;
  chunk: PublicEvidenceChunkFields;
}): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        sourceUrl: input.page.source.url,
        sourceType: input.page.source.type,
        sourceLabel: input.page.source.label,
        title: input.page.title,
        path: input.chunk.path,
        headingPath: input.chunk.headingPath,
        index: input.chunk.index,
        text: input.chunk.text,
      })
    )
    .digest('hex')
    .slice(0, 24);

  return knowledgePageSourceRef(digest);
}
