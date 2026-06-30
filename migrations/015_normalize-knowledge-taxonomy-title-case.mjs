import { FRESHWATER_TAXONOMY_TITLE_TARGET } from './014_update-freshwater-taxonomy.mjs';

export const metadata = {
  id: '015',
  name: 'normalize-knowledge-taxonomy-title-case',
  description: 'Normalize active Knowledge taxonomy category and section title capitalization',
  createdAt: '2026-06-20',
};

export const TAXONOMY_TITLE_CASE_MIGRATION_USER_ID =
  'system:migration:015_normalize-knowledge-taxonomy-title-case';

const PRESERVED_UPPERCASE_TITLES = new Set(['TEST-ACRONYM']);

/**
 * @typedef {{ ref: { update: (value: Record<string, unknown>) => Promise<void> }; data: () => Record<string, unknown> }} MigrationDoc
 * @typedef {{ docs: MigrationDoc[] }} MigrationSnapshot
 * @typedef {{ firestore: { collection: (name: string) => { get: () => Promise<MigrationSnapshot> } } }} MigrationContext
 * @typedef {(data: Record<string, unknown>) => Record<string, unknown>} PatchBuilder
 */

/**
 * @param {string} value
 * @returns {string}
 */
function uppercaseFirstLetter(value) {
  const [first = '', ...rest] = value;
  return `${first.toLocaleUpperCase('pl-PL')}${rest.join('')}`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function sentenceCase(value) {
  const lower = value.toLocaleLowerCase('pl-PL');
  return uppercaseFirstLetter(lower);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isAllUppercaseTitle(value) {
  return /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(value) && value === value.toLocaleUpperCase('pl-PL');
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeTaxonomyTitle(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0 || PRESERVED_UPPERCASE_TITLES.has(trimmed)) {
    return value;
  }

  if (trimmed === FRESHWATER_TAXONOMY_TITLE_TARGET) {
    return FRESHWATER_TAXONOMY_TITLE_TARGET;
  }

  if (isAllUppercaseTitle(trimmed)) {
    return sentenceCase(trimmed);
  }

  return uppercaseFirstLetter(trimmed);
}

/**
 * @param {string} value
 * @returns {string}
 */
function slugify(value) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'untitled';
}

/**
 * @param {Record<string, unknown>} data
 * @returns {boolean}
 */
function isActiveDocument(data) {
  if (data['status'] === 'deleted') {
    return false;
  }
  return data['deletedAt'] === undefined || data['deletedAt'] === null;
}

/**
 * @param {Record<string, unknown>} data
 * @returns {boolean}
 */
function isTaxonomyNode(data) {
  return data['type'] === 'category' || data['type'] === 'section';
}

/**
 * @param {Map<string, string>} titleChanges
 * @param {unknown} value
 * @returns {{ value: string[]; changed: boolean }}
 */
function replaceTitleArray(titleChanges, value) {
  if (!Array.isArray(value)) {
    return { value: [], changed: false };
  }

  let changed = false;
  const next = value.map((entry) => {
    if (typeof entry !== 'string') {
      return entry;
    }

    const replacement = titleChanges.get(entry);
    if (replacement === undefined) {
      return entry;
    }

    changed = true;
    return replacement;
  });

  return { value: next, changed };
}

/**
 * @param {Map<string, string>} titleChanges
 * @param {unknown} value
 * @returns {{ value: Record<string, unknown>; changed: boolean }}
 */
function replaceHierarchy(titleChanges, value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { value: {}, changed: false };
  }

  let changed = false;
  const next = /** @type {Record<string, unknown>} */ ({ ...value });
  for (const key of ['category', 'section']) {
    const current = next[key];
    if (typeof current !== 'string') {
      continue;
    }

    const replacement = titleChanges.get(current);
    if (replacement !== undefined) {
      next[key] = replacement;
      changed = true;
    }
  }

  return { value: next, changed };
}

/**
 * @param {Map<string, string>} titleChanges
 * @param {unknown} value
 * @returns {{ value: string; changed: boolean }}
 */
function replaceSearchableText(titleChanges, value) {
  if (typeof value !== 'string') {
    return { value: '', changed: false };
  }

  let changed = false;
  let next = value;
  for (const [before, after] of titleChanges.entries()) {
    if (next.includes(before)) {
      next = next.replaceAll(before, after);
      changed = true;
    }
  }

  return { value: next, changed };
}

/**
 * @param {Array<{ data: () => Record<string, unknown> }>} nodeDocs
 * @returns {Map<string, string>}
 */
function collectTitleChanges(nodeDocs) {
  /** @type {Map<string, string>} */
  const titleChanges = new Map();
  for (const doc of nodeDocs) {
    const data = doc.data();
    if (!isActiveDocument(data) || !isTaxonomyNode(data) || typeof data['title'] !== 'string') {
      continue;
    }

    const normalized = normalizeTaxonomyTitle(data['title']);
    if (normalized !== data['title']) {
      titleChanges.set(data['title'], normalized);
    }
  }
  return titleChanges;
}

/**
 * @param {Record<string, unknown>} data
 * @param {Map<string, string>} titleChanges
 * @param {string} updatedAt
 * @returns {Record<string, unknown>}
 */
function nodePatch(data, titleChanges, updatedAt) {
  /** @type {Record<string, unknown>} */
  const patch = {};
  if (isTaxonomyNode(data) && typeof data['title'] === 'string') {
    const replacement = titleChanges.get(data['title']);
    if (replacement !== undefined) {
      patch['title'] = replacement;
      patch['slug'] = slugify(replacement);
    }
  }

  const pathTitles = replaceTitleArray(titleChanges, data['pathTitles']);
  if (pathTitles.changed) {
    patch['pathTitles'] = pathTitles.value;
  }

  if (Object.keys(patch).length > 0) {
    patch['updatedAt'] = updatedAt;
    patch['updatedByUserId'] = TAXONOMY_TITLE_CASE_MIGRATION_USER_ID;
  }

  return patch;
}

/**
 * @param {Record<string, unknown>} data
 * @param {Map<string, string>} titleChanges
 * @param {string} updatedAt
 * @returns {Record<string, unknown>}
 */
function pagePatch(data, titleChanges, updatedAt) {
  /** @type {Record<string, unknown>} */
  const patch = {};
  const pathTitles = replaceTitleArray(titleChanges, data['pathTitles']);
  if (pathTitles.changed) {
    patch['pathTitles'] = pathTitles.value;
  }

  const hierarchy = replaceHierarchy(titleChanges, data['hierarchy']);
  if (hierarchy.changed) {
    patch['hierarchy'] = hierarchy.value;
  }

  if (Object.keys(patch).length > 0) {
    patch['updatedAt'] = updatedAt;
    patch['updatedByUserId'] = TAXONOMY_TITLE_CASE_MIGRATION_USER_ID;
  }

  return patch;
}

/**
 * @param {Record<string, unknown>} data
 * @param {Map<string, string>} titleChanges
 * @returns {Record<string, unknown>}
 */
function chunkPatch(data, titleChanges) {
  /** @type {Record<string, unknown>} */
  const patch = {};
  const path = replaceTitleArray(titleChanges, data['path']);
  if (path.changed) {
    patch['path'] = path.value;
  }

  const headingPath = replaceTitleArray(titleChanges, data['headingPath']);
  if (headingPath.changed) {
    patch['headingPath'] = headingPath.value;
  }

  const searchableText = replaceSearchableText(titleChanges, data['searchableText']);
  if (searchableText.changed) {
    patch['searchableText'] = searchableText.value;
  }

  return patch;
}

/**
 * @param {MigrationContext} context
 * @returns {Promise<void>}
 */
export async function up(context) {
  const updatedAt = new Date().toISOString();
  const nodeSnapshot = await context.firestore.collection('fa_knowledge_nodes').get();
  const titleChanges = collectTitleChanges(nodeSnapshot.docs);
  if (titleChanges.size === 0) {
    return;
  }

  /** @type {Array<[string, MigrationDoc[], PatchBuilder]>} */
  const collectionPatches = [
    ['fa_knowledge_nodes', nodeSnapshot.docs, (data) => nodePatch(data, titleChanges, updatedAt)],
    [
      'fa_knowledge_pages',
      (await context.firestore.collection('fa_knowledge_pages').get()).docs,
      (data) => pagePatch(data, titleChanges, updatedAt),
    ],
    [
      'fa_knowledge_chunks',
      (await context.firestore.collection('fa_knowledge_chunks').get()).docs,
      (data) => chunkPatch(data, titleChanges),
    ],
  ];

  for (const [, docs, toPatch] of collectionPatches) {
    for (const doc of docs) {
      const data = doc.data();
      if (!isActiveDocument(data)) {
        continue;
      }

      const patch = toPatch(data);
      if (Object.keys(patch).length > 0) {
        await doc.ref.update(patch);
      }
    }
  }
}
