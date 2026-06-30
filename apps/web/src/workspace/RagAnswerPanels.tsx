import type { ReactElement } from 'react';
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

import type {
  Citation,
  ConversationMessage,
  RetrievalEvidenceSummary,
} from '../services/chatApi.js';

function citationKey(evidence: Pick<RetrievalEvidenceSummary, 'id' | 'sourceId'>): string {
  return `${evidence.sourceId}\u0000${evidence.id}`;
}

function findCitationEvidence(
  message: ConversationMessage,
  citation: Citation
): RetrievalEvidenceSummary | undefined {
  return message.retrieval?.evidence.find(
    (evidence) => citation.sourceId === citationKey(evidence) || citation.sourceId === evidence.id
  );
}

const imageFilenamePattern = /`?\b[\w.-]{1,160}\.(?:png|jpe?g|webp|gif|svg)\b`?/gi;
const knowledgePageSourcePrefix = 'knowledge-page:';
const genericSourceTitlePattern = /^(?:source|źródło)\s+\d+$/iu;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

function internalKnowledgePageSourceId(
  citation: Citation,
  evidence: RetrievalEvidenceSummary | undefined
): string | undefined {
  const candidates = [evidence?.id, citation.sourceId];

  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue;
    }

    for (const part of candidate.split('\u0000')) {
      if (!part.startsWith(knowledgePageSourcePrefix)) {
        continue;
      }

      const pageId = part.slice(knowledgePageSourcePrefix.length).trim();
      if (pageId.length > 0 && pageId.length <= 512 && !hasControlCharacter(pageId)) {
        return `${knowledgePageSourcePrefix}${pageId}`;
      }
    }
  }

  return undefined;
}

function pageIdFromKnowledgeSourceId(sourceId: string): string | undefined {
  if (!sourceId.startsWith(knowledgePageSourcePrefix)) {
    return undefined;
  }

  const pageId = sourceId.slice(knowledgePageSourcePrefix.length).trim();
  return pageId.length > 0 ? pageId : undefined;
}

function stripMarkdownInline(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\\([\\`*_[\]{}()#+\-.!>])/g, '$1');
}

function redactBareUrls(value: string): string {
  return value.replace(/\b(?:https?:\/\/|www\.)[^\s<>(){}"']+/gi, '[link hidden]');
}

function redactImageFilenames(value: string): string {
  return value.replace(imageFilenamePattern, '[image hidden]');
}

function cleanCitationContext(value: string): string {
  return cleanUserVisibleText(stripMarkdownInline(value)).replace(/\s+/g, ' ').trim();
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
    hostname === 'metadata.google.internal'
  ) {
    return true;
  }

  const octets = hostname.split('.');
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/u.test(octet))) {
    return false;
  }

  return octets.every((octet) => {
    const value = Number(octet);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

function isIpLiteralHostname(hostname: string): boolean {
  const strippedHostname =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return strippedHostname.includes(':') || isPrivateHostname(strippedHostname);
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
    (segment) =>
      segment === 'api' ||
      segment === 'app' ||
      segment.startsWith('share') ||
      segment === 'admin' ||
      segment === 'editor'
  );
}

function safePublicUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
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

    if (isIpLiteralHostname(normalizedHostname) || isPrivateHostname(normalizedHostname)) {
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
  } catch {
    return undefined;
  }
}

function cleanUserVisibleText(value: string): string {
  return redactImageFilenames(redactBareUrls(value))
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/\[link hidden]\s*([.,;:!?])?/g, '[link hidden]')
    .replace(/\[link hidden](?=\S)/g, '[link hidden] ')
    .trim();
}

function cleanSourceTitle(value: string | undefined): string {
  if (value === undefined) {
    return '';
  }

  return cleanCitationContext(value)
    .replace(/\[image hidden]/gi, ' ')
    .replace(/\*{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericSourceTitle(value: string): boolean {
  return genericSourceTitlePattern.test(value.trim());
}

function cleanHeadingPathValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => (typeof item === 'string' ? [cleanCitationContext(item)] : []))
      .filter((item) => item.length > 0)
      .join(' / ');
  }

  if (typeof value !== 'string') {
    return '';
  }

  return cleanCitationContext(value);
}

function sourceHeadingPath(evidence: RetrievalEvidenceSummary | undefined): string {
  const metadata = evidence?.metadata;
  if (metadata === undefined) {
    return '';
  }

  const headingPath = cleanHeadingPathValue(metadata['headingPath']);
  if (headingPath.length > 0) {
    return headingPath;
  }

  return cleanHeadingPathValue(metadata['path']);
}

function sourceDisplayTitle(evidence: RetrievalEvidenceSummary | undefined): string {
  const cleanedEvidenceTitle = cleanSourceTitle(evidence?.title);
  if (cleanedEvidenceTitle.length > 0 && !isGenericSourceTitle(cleanedEvidenceTitle)) {
    return cleanedEvidenceTitle;
  }

  const headingPath = sourceHeadingPath(evidence);
  if (headingPath.length > 0) {
    return headingPath;
  }

  return '';
}

function countedSourceLabel(label: string | undefined, count: number, fallback: string): string {
  return (label ?? fallback).replace('{count}', String(count));
}

function dedupeTextKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function sourceItemKey(input: {
  publicUrl: string | undefined;
  sourceTitle: string;
  internalHref: string | undefined;
}): string {
  if (input.publicUrl !== undefined) {
    return `url:${input.publicUrl}`;
  }

  if (input.internalHref !== undefined) {
    return `title:${dedupeTextKey(input.sourceTitle)}`;
  }

  return `static:${dedupeTextKey(input.sourceTitle)}`;
}

export function MissingInformation({
  items,
  heading,
}: {
  items: string[];
  heading: string;
}): ReactElement | null {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="missing-block">
      <h3>{heading}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{cleanUserVisibleText(stripMarkdownInline(item))}</li>
        ))}
      </ul>
    </div>
  );
}

export function CitationList({
  message,
  heading,
  showAllLabel,
  showAdditionalSourcesLabel,
  hideAdditionalSourcesLabel,
  sourceMode = 'user',
}: {
  message: ConversationMessage;
  heading: string;
  showAllLabel: string;
  showAdditionalSourcesLabel?: string | undefined;
  hideAdditionalSourcesLabel?: string | undefined;
  sourceMode?: 'admin' | 'user' | undefined;
}): ReactElement | null {
  const [expanded, setExpanded] = useState(false);

  if (message.citations.length === 0) {
    return null;
  }

  const citationItems = message.citations.flatMap((citation) => {
    const evidence = findCitationEvidence(message, citation);
    const sourceTitle = sourceDisplayTitle(evidence);
    if (sourceTitle.length === 0) {
      return [];
    }

    const publicUrl = safePublicUrl(evidence?.publicUrl);
    const knowledgeSourceId = internalKnowledgePageSourceId(citation, evidence);
    const pageId =
      knowledgeSourceId === undefined ? undefined : pageIdFromKnowledgeSourceId(knowledgeSourceId);
    const internalHref =
      knowledgeSourceId === undefined || pageId === undefined
        ? undefined
        : sourceMode === 'admin'
          ? `#/admin/knowledge/${encodeURIComponent(pageId)}`
          : `#/chat/source/${encodeURIComponent(knowledgeSourceId)}`;

    return [
      {
        citation,
        itemKey: sourceItemKey({ publicUrl, sourceTitle, internalHref }),
        publicUrl,
        sourceTitle,
        internalHref,
      },
    ];
  });
  const dedupedCitationItems = citationItems.filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.itemKey === item.itemKey) === index
  );

  if (dedupedCitationItems.length === 0) {
    return null;
  }

  const visibleCitationItems = expanded ? dedupedCitationItems : dedupedCitationItems.slice(0, 3);
  const hiddenCount = dedupedCitationItems.length - visibleCitationItems.length;
  const additionalSourcesCount = Math.max(dedupedCitationItems.length - 3, 0);
  const hasExpandableSources = dedupedCitationItems.length > 3;

  return (
    <div className="citation-list" aria-label={heading}>
      <h3 className="citation-list-heading">{heading}</h3>
      {visibleCitationItems.map(({ itemKey, publicUrl, sourceTitle, internalHref }) => {
        const sourceRow = <strong title={sourceTitle}>{sourceTitle}</strong>;

        return (
          <article className="citation-item" key={itemKey}>
            {publicUrl !== undefined ? (
              <a className="citation-row-link" href={publicUrl} rel="noreferrer" target="_blank">
                {sourceRow}
              </a>
            ) : internalHref !== undefined ? (
              <a className="citation-row-link" href={internalHref}>
                {sourceRow}
              </a>
            ) : (
              <div className="citation-row-link is-static">{sourceRow}</div>
            )}
          </article>
        );
      })}
      {hasExpandableSources ? (
        <button
          aria-expanded={expanded}
          className="fa-chip citation-expand-button"
          type="button"
          onClick={() => {
            setExpanded((current) => !current);
          }}
        >
          {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          <span>
            {expanded
              ? countedSourceLabel(hideAdditionalSourcesLabel, additionalSourcesCount, showAllLabel)
              : countedSourceLabel(showAdditionalSourcesLabel, hiddenCount, showAllLabel)}
          </span>
        </button>
      ) : null}
    </div>
  );
}
