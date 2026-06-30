#!/usr/bin/env node
/* eslint-disable no-console */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);

export const FORBIDDEN_KNOWLEDGE_TAXONOMY_TERMS = ['deprecated freshwater taxonomy label'];

const knowledgeTaxonomyContentCollections = [
  {
    name: 'fa_knowledge_nodes',
    fields: ['title', 'pathTitles'],
  },
  {
    name: 'fa_knowledge_pages',
    fields: ['title', 'pathTitles', 'hierarchy'],
  },
  {
    name: 'fa_knowledge_chunks',
    fields: ['title', 'path', 'headingPath', 'searchableText'],
  },
];

/**
 * @typedef {{
 *   collection: (name: string) => {
 *     get: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }>;
 *   };
 * }} ReadonlyFirestore
 *
 * @typedef {{
 *   id: string;
 *   fields: string[];
 * }} TaxonomyViolationSample
 */

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
function projectId(env = process.env) {
  const configured =
    env['FA_GCP_PROJECT_ID'] ?? env['GOOGLE_CLOUD_PROJECT'] ?? env['GCLOUD_PROJECT'];
  if (configured === undefined || configured.length === 0) {
    throw new Error('Missing FA_GCP_PROJECT_ID, GOOGLE_CLOUD_PROJECT, or GCLOUD_PROJECT');
  }

  return configured;
}

/**
 * @param {string} configuredProjectId
 * @returns {Promise<ReadonlyFirestore>}
 */
async function initFirestore(configuredProjectId) {
  const [{ applicationDefault, getApps, initializeApp }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
  ]);

  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId: configuredProjectId });
  }

  return getFirestore();
}

/**
 * @param {Record<string, unknown>} data
 * @returns {boolean}
 */
function isActiveDocument(data) {
  return (
    data['status'] !== 'deleted' && (data['deletedAt'] === undefined || data['deletedAt'] === null)
  );
}

/**
 * @param {unknown} value
 * @param {string} term
 * @returns {boolean}
 */
function containsForbiddenTerm(value, term) {
  if (typeof value === 'string') {
    return value.includes(term);
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenTerm(entry, term));
  }

  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((entry) => containsForbiddenTerm(entry, term));
  }

  return false;
}

/**
 * @param {Record<string, unknown>} data
 * @param {string[]} fields
 * @param {string} term
 * @returns {string[]}
 */
function matchingFields(data, fields, term) {
  return fields.filter((field) => containsForbiddenTerm(data[field], term));
}

/**
 * @param {TaxonomyViolationSample[]} samples
 * @returns {string}
 */
function formatSamples(samples) {
  return samples.map((sample) => `${sample.id} fields: ${sample.fields.join(', ')}`).join('; ');
}

/**
 * @param {{ firestore: ReadonlyFirestore; forbiddenTerms?: string[] }} input
 * @returns {Promise<string[]>}
 */
export async function validateKnowledgeTaxonomyContent({
  firestore,
  forbiddenTerms = FORBIDDEN_KNOWLEDGE_TAXONOMY_TERMS,
}) {
  /** @type {string[]} */
  const errors = [];

  for (const collection of knowledgeTaxonomyContentCollections) {
    const snapshot = await firestore.collection(collection.name).get();
    for (const term of forbiddenTerms) {
      let violationCount = 0;
      /** @type {TaxonomyViolationSample[]} */
      const samples = [];

      for (const document of snapshot.docs) {
        const data = document.data();
        if (!isActiveDocument(data)) {
          continue;
        }

        const fields = matchingFields(data, collection.fields, term);
        if (fields.length === 0) {
          continue;
        }

        violationCount += 1;
        if (samples.length < 5) {
          samples.push({ id: document.id, fields });
        }
      }

      if (violationCount > 0) {
        errors.push(
          `${collection.name} has ${String(
            violationCount
          )} active document containing forbidden taxonomy text "${term}" (samples: ${formatSamples(
            samples
          )})`
        );
      }
    }
  }

  return errors;
}

async function main() {
  const firestore = await initFirestore(projectId());
  const errors = await validateKnowledgeTaxonomyContent({ firestore });
  if (errors.length > 0) {
    console.error('Knowledge taxonomy content verification failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('Knowledge taxonomy content verification passed.');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Knowledge taxonomy content verification failed: ${message}`);
    process.exit(1);
  });
}
