import { err, ok, type Result } from '@fa/common-core';

import type {
  EffectiveKnowledgeAccessGate,
  KnowledgeAccessGate,
  KnowledgeNode,
  KnowledgePage,
  KnowledgePageChunk,
  KnowledgeSourceType,
} from './knowledge.js';
import type { KnowledgeRepositoryError } from '../repositories/knowledgeRepositories.js';

const authoringAccessGates = new Set<KnowledgeAccessGate>([
  'public',
  'approved',
  'level',
  'excluded',
  'manual',
]);
const effectiveAccessGates = new Set<EffectiveKnowledgeAccessGate>([
  'public',
  'approved',
  'level',
  'excluded',
]);

const appOrigins = new Set(['dev.fishing-assistant.online', 'fishing-assistant.online']);

export function validationError(message: string): Result<never, KnowledgeRepositoryError> {
  return err({ code: 'VALIDATION_ERROR', message });
}

export function validateKnowledgeAccess(
  access: { gate: string; requiredLevel: number | null },
  label: string,
  options: { allowManual: boolean }
): Result<void, KnowledgeRepositoryError> {
  const allowedGates = options.allowManual ? authoringAccessGates : effectiveAccessGates;
  if (!options.allowManual && access.gate === 'manual' && label === 'chunk') {
    return validationError('Active knowledge chunks cannot use manual access');
  }
  if (!allowedGates.has(access.gate as KnowledgeAccessGate)) {
    return validationError(`${label} access gate is invalid`);
  }

  if (access.gate === 'level') {
    if (
      !Number.isInteger(access.requiredLevel) ||
      access.requiredLevel === null ||
      access.requiredLevel < 1 ||
      access.requiredLevel > 10
    ) {
      return validationError(`${label} level access requires requiredLevel 1 through 10`);
    }
    return ok(undefined);
  }

  if (access.requiredLevel !== null) {
    return validationError(`${label} ${access.gate} access requires requiredLevel null`);
  }

  return ok(undefined);
}

export function validateKnowledgeNode(node: KnowledgeNode): Result<void, KnowledgeRepositoryError> {
  if (node.depth > 3) {
    return validationError(
      'Knowledge node depth cannot exceed root -> category -> section -> page'
    );
  }

  if (node.pathIds.at(-1) !== node.id || node.pathTitles.length !== node.pathIds.length) {
    return validationError('Knowledge node path must match node depth and identity');
  }

  if (node.type === 'root') {
    if (
      node.id !== 'root' ||
      node.depth !== 0 ||
      node.parentId !== null ||
      node.categoryId !== null ||
      node.sectionId !== null ||
      node.pageId !== null ||
      node.categoryAccess !== null ||
      node.pathIds.length !== 1
    ) {
      return validationError('Root node must be the singleton tree root');
    }
  }

  if (node.type === 'category') {
    if (
      node.parentId !== 'root' ||
      node.depth !== 1 ||
      node.categoryId !== node.id ||
      node.sectionId !== null ||
      node.pageId !== null ||
      node.categoryAccess === null ||
      node.pathIds.length !== 2 ||
      node.pathIds[0] !== 'root' ||
      node.pathIds[1] !== node.id
    ) {
      return validationError('Category nodes must be direct children of root with category access');
    }
    return validateKnowledgeAccess(node.categoryAccess, 'category', { allowManual: false });
  }

  if (node.type === 'section') {
    if (
      node.depth !== 2 ||
      node.parentId !== node.categoryId ||
      node.categoryId === null ||
      node.sectionId !== node.id ||
      node.pageId !== null ||
      node.categoryAccess !== null ||
      node.pathIds.length !== 3 ||
      node.pathIds[0] !== 'root' ||
      node.pathIds[1] !== node.categoryId ||
      node.pathIds[2] !== node.id
    ) {
      return validationError('Section nodes must be direct children of categories');
    }
  }

  if (node.type === 'page') {
    if (
      node.categoryId === null ||
      node.pageId === null ||
      node.pageId === '' ||
      node.categoryAccess !== null
    ) {
      return validationError('Page nodes must belong to a category or section and point to a page');
    }

    if (node.sectionId === null) {
      if (
        node.depth !== 2 ||
        node.parentId !== node.categoryId ||
        node.pathIds.length !== 3 ||
        node.pathIds[0] !== 'root' ||
        node.pathIds[1] !== node.categoryId ||
        node.pathIds[2] !== node.id
      ) {
        return validationError(
          'Direct category page nodes must have depth 2, parentId categoryId, and no sectionId'
        );
      }
    } else if (
      node.depth !== 3 ||
      node.parentId !== node.sectionId ||
      node.pathIds.length !== 4 ||
      node.pathIds[0] !== 'root' ||
      node.pathIds[1] !== node.categoryId ||
      node.pathIds[2] !== node.sectionId ||
      node.pathIds[3] !== node.id
    ) {
      return validationError(
        'Section page nodes must have depth 3, parentId sectionId, and a sectionId'
      );
    }
  }

  return ok(undefined);
}

export function validateKnowledgePage(page: KnowledgePage): Result<void, KnowledgeRepositoryError> {
  const effectiveAccess = validateKnowledgeAccess(page.access.effective, 'page effective', {
    allowManual: true,
  });
  if (!effectiveAccess.ok) {
    return effectiveAccess;
  }

  if (page.access.override !== null) {
    const overrideAccess = validateKnowledgeAccess(page.access.override, 'page override', {
      allowManual: true,
    });
    if (!overrideAccess.ok) {
      return overrideAccess;
    }
  }

  const sourceValidation = validateKnowledgeSourceUrl(page.source, 'page source');
  if (!sourceValidation.ok) {
    return sourceValidation;
  }

  if (page.access.inheritedFromCategoryId !== page.categoryId) {
    return validationError('Knowledge pages must inherit access from their category');
  }

  if (page.markdown.length === 0 || page.normalizedMarkdown.length === 0) {
    return validationError('Knowledge pages must store ingestable markdown');
  }

  for (const acknowledgement of page.contentQualityAcknowledgements ?? []) {
    if (acknowledgement.markdownContentHash.length === 0) {
      return validationError('Knowledge page content quality acknowledgement hash is required');
    }
    if (
      acknowledgement.issueFingerprints.length === 0 ||
      acknowledgement.issueFingerprints.some((fingerprint) => fingerprint.length === 0)
    ) {
      return validationError(
        'Knowledge page content quality acknowledgement fingerprints are required'
      );
    }
    if (acknowledgement.reason !== null && acknowledgement.reason.trim().length === 0) {
      return validationError('Knowledge page content quality acknowledgement reason is invalid');
    }
    if (
      acknowledgement.acknowledgedAt.length === 0 ||
      acknowledgement.acknowledgedByUserId.length === 0
    ) {
      return validationError('Knowledge page content quality acknowledgement audit is required');
    }
  }

  return ok(undefined);
}

export function validateKnowledgePageChunks(input: {
  pageId: string;
  chunks: readonly KnowledgePageChunk[];
}): Result<void, KnowledgeRepositoryError> {
  for (const chunk of input.chunks) {
    if (chunk.pageId !== input.pageId) {
      return validationError('Replacement chunks must belong to the target page');
    }
    if (chunk.status !== 'active') {
      return validationError('Replacement chunks must be active');
    }
    if (chunk.accessSyncStatus !== 'current') {
      return validationError('Replacement chunks must have current access sync status');
    }
    const embeddingDimensions = (chunk as { embeddingDimensions: number }).embeddingDimensions;
    if (embeddingDimensions !== 2048) {
      return validationError('Replacement chunks must use 2048 embedding dimensions');
    }
    if (chunk.embedding.length !== 2048) {
      return validationError('Replacement chunks must include a 2048-length embedding');
    }

    const access = validateKnowledgeAccess(chunk.access, 'chunk', { allowManual: false });
    if (!access.ok) {
      return access;
    }

    const sourceValidation = validateKnowledgeSourceUrl(chunk.source, 'chunk source');
    if (!sourceValidation.ok) {
      return sourceValidation;
    }
  }

  return ok(undefined);
}

export function validateKnowledgeSourceUrl(
  source: { type: KnowledgeSourceType; url: string | null },
  label: string
): Result<void, KnowledgeRepositoryError> {
  const sourceType: string = source.type;
  if (sourceType !== 'manual' && sourceType !== 'external') {
    return validationError(`${label} type is invalid`);
  }

  if (source.url === null) {
    if (sourceType === 'manual') {
      return ok(undefined);
    }
    return validationError(`${label} external URL is required`);
  }

  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    return validationError(`${label} URL must be an absolute public https URL`);
  }

  if (url.protocol !== 'https:') {
    return validationError(`${label} URL must use https`);
  }

  if (url.hash.startsWith('#/')) {
    return validationError(`${label} URL must not be an app hash route`);
  }

  const hostname = normalizeHostname(url.hostname);
  const pathname = url.pathname.toLowerCase();
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/share') ||
    pathname.includes('/admin') ||
    pathname.includes('/editor')
  ) {
    return validationError(`${label} URL must not point to internal app routes`);
  }

  if (
    appOrigins.has(hostname) &&
    (pathname.startsWith('/api/') ||
      pathname.startsWith('/share') ||
      pathname.includes('/admin') ||
      pathname.includes('/editor') ||
      url.hash.startsWith('#/'))
  ) {
    return validationError(`${label} URL must not point to internal app routes`);
  }

  if (isPrivateHostname(hostname)) {
    return validationError(`${label} URL host must be public`);
  }

  return ok(undefined);
}

function isPrivateHostname(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal'
  ) {
    return true;
  }

  if (hostname === '::1' || hostname.startsWith('[')) {
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

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '');
}
