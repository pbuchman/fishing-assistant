#!/usr/bin/env node
/* eslint-disable no-console */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findStaleGeneratedOutputs,
  generateServiceWiring,
  getGeneratedOutputs,
  loadServiceManifest,
  parseArgs as parseGeneratorArgs,
} from './generate-service-wiring.mjs';

const modulePath = fileURLToPath(import.meta.url);
const forbiddenGeneratedWebConfigNeedles = [
  'FA_AUTH0_ISSUER',
  'FA_AUTH0_JWKS_URI',
  'FA_BOOTSTRAP_ADMIN_EMAILS',
  'FA_USER_SERVICE_INTERNAL_URL',
  'FA_INTERNAL_AUTH_TOKEN',
  'FA_INTERNAL_AUTH_TOKEN_PREVIOUS',
];

/**
 * @param {string} filePath
 * @param {string} label
 * @returns {string}
 */
function readRequiredFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }

  return readFileSync(filePath, 'utf8');
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function findBrowserLocalhostUrls(source) {
  const errors = [];
  if (source.includes('localhost')) {
    errors.push('apps/web/src/config.generated.ts must not contain localhost URLs');
  }
  if (source.includes('127.0.0.1')) {
    errors.push('apps/web/src/config.generated.ts must not contain 127.0.0.1 URLs');
  }
  return errors;
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function findBackendOnlyBrowserConfigValues(source) {
  return forbiddenGeneratedWebConfigNeedles
    .filter((needle) => source.includes(needle))
    .map((needle) => `apps/web/src/config.generated.ts must not expose ${needle}`);
}

function main() {
  try {
    const { root } = parseGeneratorArgs(process.argv);
    const manifest = loadServiceManifest(resolve(root, 'apps/web/service-manifest.json'));
    const wiring = generateServiceWiring(manifest);
    const outputs = getGeneratedOutputs(root, wiring);
    const generatedConfigPath = resolve(root, 'apps/web/src/config.generated.ts');
    const stale = findStaleGeneratedOutputs(outputs);
    const generatedConfig = readRequiredFile(
      generatedConfigPath,
      'apps/web/src/config.generated.ts'
    );
    const errors = [
      ...stale.map((filePath) => `${filePath} is stale; run pnpm run generate:service-wiring`),
      ...findBrowserLocalhostUrls(generatedConfig),
      ...findBackendOnlyBrowserConfigValues(generatedConfig),
    ];

    if (errors.length > 0) {
      console.error('Service wiring verification failed:');
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }

    console.log(`Service wiring verified (${String(wiring.services.length)} services).`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Service wiring verification failed: ${message}`);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main();
}

export { findBackendOnlyBrowserConfigValues, findBrowserLocalhostUrls };
