import type { RagEvidence } from './rag.js';

export function ragEvidenceKey(item: Pick<RagEvidence, 'sourceId' | 'id'>): string {
  return `${item.sourceId}\u0000${item.id}`;
}
