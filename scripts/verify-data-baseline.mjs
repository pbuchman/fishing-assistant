#!/usr/bin/env node
/* eslint-disable no-console */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pricingSeed } from '../migrations/002_seed-llm-pricing.mjs';
import { chatModelPricingSeed } from '../migrations/012_seed-chat-model-settings-and-pricing.mjs';
import { chatModelPricingSeed as updatedChatModelPricingSeed } from '../migrations/016_update-chat-model-catalog-pricing.mjs';
import { chatModelPricingSeed as gemmaChatModelPricingSeed } from '../migrations/018_set-gemma-chat-model-catalog.mjs';
import {
  removedKnowledgeCollections,
  resetCollectionNames,
} from '../migrations/009_runtime-data-baseline.mjs';

/**
 * @typedef {{ id: string; data: Record<string, unknown> }} CollectionDocument
 * @typedef {{
 *   collection: (name: string) => {
 *     get: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }>;
 *   };
 * }} ReadonlyFirestore
 * @typedef {{ provider: string; model: string }} PricingDocumentKey
 */

const modulePath = fileURLToPath(import.meta.url);

/**
 * @param {PricingDocumentKey} pricing
 * @returns {string}
 */
function pricingDocumentId(pricing) {
  return `${encodeURIComponent(pricing.provider)}__${encodeURIComponent(pricing.model)}`;
}

/**
 * @param {PricingDocumentKey[]} pricingRecords
 * @returns {Map<string, PricingDocumentKey>}
 */
function pricingMap(pricingRecords) {
  return new Map(pricingRecords.map((pricing) => [pricingDocumentId(pricing), pricing]));
}

const allowedPricingCatalogs = [
  pricingMap(pricingSeed),
  pricingMap([...pricingSeed, ...chatModelPricingSeed]),
  pricingMap([...pricingSeed, ...updatedChatModelPricingSeed]),
  pricingMap([...pricingSeed, ...gemmaChatModelPricingSeed]),
];

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
 * @param {ReadonlyFirestore} firestore
 * @param {string} collectionName
 * @returns {Promise<CollectionDocument[]>}
 */
async function collectionDocuments(firestore, collectionName) {
  const snapshot = await firestore.collection(collectionName).get();
  return snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function hasRetiredOwnershipFields(value) {
  return isRecord(value) && ('workspaceId' in value || 'ownerType' in value || 'ownerId' in value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isInvalidUsageOwnerId(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  return (
    normalized === 'anonymous' ||
    normalized === 'system' ||
    /^workspace(?:[-_:]|$)/i.test(normalized) ||
    /^anonymous[-_:]?workspace/i.test(normalized)
  );
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function hasValidRetainedUsageOwner(value) {
  if (!isRecord(value) || hasRetiredOwnershipFields(value)) {
    return false;
  }

  const owner = value['owner'];
  if (!isRecord(owner)) {
    return false;
  }

  return owner['type'] === 'user' && !isInvalidUsageOwnerId(owner['id']);
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function canonicalPricingPayload(value) {
  if (!isRecord(value)) {
    return null;
  }

  const payload = { ...value };
  delete payload['updatedAt'];
  return payload;
}

/**
 * @param {{ firestore: ReadonlyFirestore }} input
 * @returns {Promise<string[]>}
 */
export async function validateDataBaselineState({ firestore }) {
  const errors = /** @type {string[]} */ ([]);

  for (const collectionName of removedKnowledgeCollections) {
    const documents = await collectionDocuments(firestore, collectionName);
    if (documents.length > 0) {
      errors.push(
        `${collectionName} must be empty after runtime data baseline (found ${documents.length})`
      );
    }
  }

  const usageCollections = new Set(['llm_usage_events', 'llm_usage_daily_aggregates']);
  for (const collectionName of resetCollectionNames.filter(
    (name) => !removedKnowledgeCollections.includes(name)
  )) {
    const documents = await collectionDocuments(firestore, collectionName);
    if (documents.length === 0) {
      continue;
    }

    if (usageCollections.has(collectionName)) {
      if (!documents.every((document) => hasValidRetainedUsageOwner(document.data))) {
        errors.push(
          `${collectionName} retained rows must satisfy the current-schema nested user owner contract`
        );
      }
      continue;
    }

    const retiredFieldDocument = documents.find((document) =>
      hasRetiredOwnershipFields(document.data)
    );
    if (retiredFieldDocument !== undefined) {
      errors.push(
        `${collectionName} must not retain retired ownership fields after runtime data baseline`
      );
    }
  }

  const pricingDocuments = await collectionDocuments(firestore, 'llm_pricing');
  let payloadDrift = false;
  const pricingCatalogMatches = allowedPricingCatalogs.some((expectedPricing) => {
    if (pricingDocuments.length !== expectedPricing.size) {
      return false;
    }

    let allDocumentIdsMatch = true;
    let allPayloadsMatch = true;
    for (const document of pricingDocuments) {
      const expected = expectedPricing.get(document.id);
      if (expected === undefined) {
        allDocumentIdsMatch = false;
        allPayloadsMatch = false;
        break;
      }

      if (
        JSON.stringify(canonicalPricingPayload(document.data)) !==
        JSON.stringify(canonicalPricingPayload(expected))
      ) {
        allPayloadsMatch = false;
      }
    }

    if (allDocumentIdsMatch && !allPayloadsMatch) {
      payloadDrift = true;
    }

    return allDocumentIdsMatch && allPayloadsMatch;
  });

  if (!pricingCatalogMatches) {
    errors.push(
      payloadDrift
        ? 'llm_pricing must preserve the complete approved pricing payload after runtime data baseline'
        : 'llm_pricing must contain only the approved pricing records after runtime data baseline'
    );
  }

  return errors;
}

async function main() {
  const firestore = await initFirestore(projectId());
  const errors = await validateDataBaselineState({ firestore });

  if (errors.length > 0) {
    console.error('Runtime data baseline verification failed:');
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log('Runtime data baseline verification passed.');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Runtime data baseline verification failed: ${message}`);
    process.exit(1);
  });
}
