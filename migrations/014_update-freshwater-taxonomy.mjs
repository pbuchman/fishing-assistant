export const metadata = {
  id: '014',
  name: 'update-freshwater-taxonomy',
  description: 'Normalize a freshwater taxonomy title and dependent paths',
  createdAt: '2026-06-20',
};

export const FRESHWATER_TAXONOMY_TITLE_SOURCE = 'deprecated freshwater taxonomy label';
export const FRESHWATER_TAXONOMY_TITLE_TARGET = 'Freshwater taxonomy label';

const MIGRATION_USER_ID = 'system:migration:014_update-freshwater-taxonomy';

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
 * @param {unknown} value
 * @returns {{ value: string[]; changed: boolean }}
 */
function replaceTitleArray(value) {
  if (!Array.isArray(value)) {
    return { value: [], changed: false };
  }

  let changed = false;
  const next = value.map((entry) => {
    if (entry === FRESHWATER_TAXONOMY_TITLE_SOURCE) {
      changed = true;
      return FRESHWATER_TAXONOMY_TITLE_TARGET;
    }
    return entry;
  });

  return { value: next, changed };
}

/**
 * @param {unknown} value
 * @returns {{ value: Record<string, unknown>; changed: boolean }}
 */
function replaceHierarchy(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { value: {}, changed: false };
  }

  let changed = false;
  const next = /** @type {Record<string, unknown>} */ ({ ...value });
  if (next['category'] === FRESHWATER_TAXONOMY_TITLE_SOURCE) {
    next['category'] = FRESHWATER_TAXONOMY_TITLE_TARGET;
    changed = true;
  }
  if (next['section'] === FRESHWATER_TAXONOMY_TITLE_SOURCE) {
    next['section'] = FRESHWATER_TAXONOMY_TITLE_TARGET;
    changed = true;
  }

  return { value: next, changed };
}

/**
 * @param {unknown} value
 * @returns {{ value: string; changed: boolean }}
 */
function replaceSearchableText(value) {
  if (typeof value !== 'string' || !value.includes(FRESHWATER_TAXONOMY_TITLE_SOURCE)) {
    return { value: '', changed: false };
  }

  return {
    value: value.replaceAll(FRESHWATER_TAXONOMY_TITLE_SOURCE, FRESHWATER_TAXONOMY_TITLE_TARGET),
    changed: true,
  };
}

/**
 * @param {Record<string, unknown>} data
 * @param {string} updatedAt
 * @returns {Record<string, unknown>}
 */
function nodePatch(data, updatedAt) {
  /** @type {Record<string, unknown>} */
  const patch = {};
  if (data['title'] === FRESHWATER_TAXONOMY_TITLE_SOURCE) {
    patch['title'] = FRESHWATER_TAXONOMY_TITLE_TARGET;
    patch['slug'] = slugify(FRESHWATER_TAXONOMY_TITLE_TARGET);
  }

  const pathTitles = replaceTitleArray(data['pathTitles']);
  if (pathTitles.changed) {
    patch['pathTitles'] = pathTitles.value;
  }

  if (Object.keys(patch).length > 0) {
    patch['updatedAt'] = updatedAt;
    patch['updatedByUserId'] = MIGRATION_USER_ID;
  }

  return patch;
}

/**
 * @param {Record<string, unknown>} data
 * @param {string} updatedAt
 * @returns {Record<string, unknown>}
 */
function pagePatch(data, updatedAt) {
  /** @type {Record<string, unknown>} */
  const patch = {};
  if (data['title'] === FRESHWATER_TAXONOMY_TITLE_SOURCE) {
    patch['title'] = FRESHWATER_TAXONOMY_TITLE_TARGET;
    patch['slug'] = slugify(FRESHWATER_TAXONOMY_TITLE_TARGET);
  }

  const pathTitles = replaceTitleArray(data['pathTitles']);
  if (pathTitles.changed) {
    patch['pathTitles'] = pathTitles.value;
  }

  const hierarchy = replaceHierarchy(data['hierarchy']);
  if (hierarchy.changed) {
    patch['hierarchy'] = hierarchy.value;
  }

  if (Object.keys(patch).length > 0) {
    patch['updatedAt'] = updatedAt;
    patch['updatedByUserId'] = MIGRATION_USER_ID;
  }

  return patch;
}

/**
 * @param {Record<string, unknown>} data
 * @returns {Record<string, unknown>}
 */
function chunkPatch(data) {
  /** @type {Record<string, unknown>} */
  const patch = {};
  if (data['title'] === FRESHWATER_TAXONOMY_TITLE_SOURCE) {
    patch['title'] = FRESHWATER_TAXONOMY_TITLE_TARGET;
  }

  const path = replaceTitleArray(data['path']);
  if (path.changed) {
    patch['path'] = path.value;
  }

  const headingPath = replaceTitleArray(data['headingPath']);
  if (headingPath.changed) {
    patch['headingPath'] = headingPath.value;
  }

  const searchableText = replaceSearchableText(data['searchableText']);
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
  /** @type {Array<[string, PatchBuilder]>} */
  const collectionPatches = [
    ['fa_knowledge_nodes', (data) => nodePatch(data, updatedAt)],
    ['fa_knowledge_pages', (data) => pagePatch(data, updatedAt)],
    ['fa_knowledge_chunks', chunkPatch],
  ];

  for (const [collectionName, toPatch] of collectionPatches) {
    const snapshot = await context.firestore.collection(collectionName).get();
    for (const doc of snapshot.docs) {
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
