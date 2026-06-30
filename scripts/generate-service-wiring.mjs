#!/usr/bin/env node
/* eslint-disable no-console */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME_REGEX = /^[a-z][a-z0-9-]+$/;
const ENV_SUFFIX_REGEX = /^[A-Z][A-Z0-9_]+$/;
const API_PATH_REGEX = /^\/api\/[a-z0-9-]+$/;
const URL_REGEX = /^https?:\/\/\S+$/;

/** @typedef {{ name: string, envSuffix: string, apiPath: string, proxyTarget: string, serviceUrl: string }} ServiceManifestEntry */
/** @typedef {{ description?: string, services: ServiceManifestEntry[] }} ServiceManifest */
/** @typedef {ServiceManifestEntry & { envVar: string }} ServiceWiringEntry */
/** @typedef {{ services: ServiceWiringEntry[], serviceUrls: { envVar: string, apiPath: string }[] }} ServiceWiring */
/** @typedef {{ root: string, check: boolean, stdout: boolean }} GeneratorArgs */
/** @typedef {{ path: string, contents: string }} GeneratedOutput */

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(modulePath), '..');

/**
 * @param {string[]} argv
 * @returns {GeneratorArgs}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  let root = repoRoot;
  let check = false;
  let stdout = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--root') {
      const next = args[index + 1];
      if (typeof next !== 'string' || next.length === 0 || next.startsWith('--')) {
        throw new Error('--root requires a directory argument');
      }
      root = resolve(next);
      index += 1;
      continue;
    }

    if (arg === '--check') {
      check = true;
      continue;
    }

    if (arg === '--stdout') {
      stdout = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg ?? ''}`);
  }

  return { root, check, stdout };
}

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
 * @param {unknown} value
 * @returns {ServiceManifest}
 */
function validateServiceManifest(value) {
  if (value === null || typeof value !== 'object') {
    throw new Error('service-manifest.json must have a "services" array');
  }

  const candidate = /** @type {{ services?: unknown }} */ (value);
  if (!Array.isArray(candidate.services)) {
    throw new Error('service-manifest.json must have a "services" array');
  }

  const services = /** @type {unknown[]} */ (candidate.services);
  const seenNames = new Set();
  const seenEnvSuffixes = new Set();
  const seenApiPaths = new Set();

  for (const [index, entry] of services.entries()) {
    if (entry === null || typeof entry !== 'object') {
      throw new Error(`services[${String(index)}] is not an object`);
    }

    const service = /** @type {Partial<ServiceManifestEntry>} */ (entry);

    if (typeof service.name !== 'string' || !NAME_REGEX.test(service.name)) {
      throw new Error(`services[${String(index)}].name must match ${String(NAME_REGEX)}`);
    }
    if (typeof service.envSuffix !== 'string' || !ENV_SUFFIX_REGEX.test(service.envSuffix)) {
      throw new Error(
        `services[${String(index)}].envSuffix must match ${String(ENV_SUFFIX_REGEX)}`
      );
    }
    if (typeof service.apiPath !== 'string' || !API_PATH_REGEX.test(service.apiPath)) {
      throw new Error(`services[${String(index)}].apiPath must match ${String(API_PATH_REGEX)}`);
    }
    if (typeof service.proxyTarget !== 'string' || !URL_REGEX.test(service.proxyTarget)) {
      throw new Error(`services[${String(index)}].proxyTarget must be an absolute http(s) URL`);
    }
    if (typeof service.serviceUrl !== 'string' || !URL_REGEX.test(service.serviceUrl)) {
      throw new Error(`services[${String(index)}].serviceUrl must be an absolute http(s) URL`);
    }

    if (seenNames.has(service.name)) {
      throw new Error(`Duplicate service name in manifest: ${service.name}`);
    }
    if (seenEnvSuffixes.has(service.envSuffix)) {
      throw new Error(`Duplicate envSuffix in manifest: ${service.envSuffix}`);
    }
    if (seenApiPaths.has(service.apiPath)) {
      throw new Error(`Duplicate apiPath in manifest: ${service.apiPath}`);
    }

    seenNames.add(service.name);
    seenEnvSuffixes.add(service.envSuffix);
    seenApiPaths.add(service.apiPath);
  }

  return /** @type {ServiceManifest} */ (value);
}

/**
 * @param {string} manifestPath
 * @returns {ServiceManifest}
 */
function loadServiceManifest(manifestPath) {
  let parsed;

  try {
    parsed = JSON.parse(readRequiredFile(manifestPath, 'Manifest'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`service-manifest.json is not valid JSON: ${message}`);
  }

  return validateServiceManifest(parsed);
}

/**
 * @param {ServiceManifest} manifest
 * @returns {ServiceWiring}
 */
function generateServiceWiring(manifest) {
  const validated = validateServiceManifest(manifest);
  const services = validated.services.map((service) => ({
    ...service,
    envVar: `FA_${service.envSuffix}_URL`,
  }));

  return {
    services,
    serviceUrls: services.map(({ envVar, apiPath }) => ({ envVar, apiPath })),
  };
}

/**
 * @param {ServiceWiring} wiring
 * @returns {string}
 */
function renderConfigGenerated(wiring) {
  const serviceUrlRows = wiring.services
    .map(({ envSuffix, apiPath }) => `  ${envSuffix}: '${apiPath}',`)
    .join('\n');

  const envNameRows = wiring.services
    .map(({ envSuffix, envVar }) => `  ${envSuffix}: '${envVar}',`)
    .join('\n');

  return `// GENERATED FILE - DO NOT EDIT\n\nexport const WEB_SERVICE_URLS = {\n${serviceUrlRows}\n} as const;\n\nexport const WEB_SERVICE_ENV_NAMES = {\n${envNameRows}\n} as const;\n`;
}

/**
 * @param {ServiceWiring} wiring
 * @returns {string}
 */
function renderEcosystemGenerated(wiring) {
  const rows = wiring.serviceUrls
    .map(({ envVar, apiPath }) => `  ${envVar}: '${apiPath}',`)
    .join('\n');

  return `// GENERATED FILE - DO NOT EDIT\n\nconst COMMON_SERVICE_URLS_GENERATED = {\n${rows}\n};\n\nmodule.exports = { COMMON_SERVICE_URLS_GENERATED };\n`;
}

/**
 * @param {ServiceWiring} wiring
 * @returns {string}
 */
function renderTerraformServiceUrls(wiring) {
  const serviceUrls = Object.fromEntries(
    wiring.serviceUrls.map(({ envVar, apiPath }) => [envVar, apiPath])
  );

  return `${JSON.stringify(
    {
      generated_file_notice: 'GENERATED FILE - DO NOT EDIT',
      service_urls: serviceUrls,
    },
    null,
    2
  )}\n`;
}

/**
 * @param {string} root
 * @param {ServiceWiring} wiring
 * @returns {GeneratedOutput[]}
 */
function getGeneratedOutputs(root, wiring) {
  return [
    {
      path: resolve(root, 'apps/web/src/config.generated.ts'),
      contents: renderConfigGenerated(wiring),
    },
    {
      path: resolve(root, 'ecosystem.generated.cjs'),
      contents: renderEcosystemGenerated(wiring),
    },
    {
      path: resolve(root, 'terraform/hetzner-prod/service-urls.auto.tfvars.json'),
      contents: renderTerraformServiceUrls(wiring),
    },
  ];
}

/**
 * @param {string} filePath
 * @param {string} contents
 * @returns {void}
 */
function writeGeneratedFile(filePath, contents) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

/**
 * @param {string} root
 * @param {ServiceWiring} wiring
 * @returns {GeneratedOutput[]}
 */
function writeServiceWiringArtifacts(root, wiring) {
  const outputs = getGeneratedOutputs(root, wiring);

  for (const output of outputs) {
    writeGeneratedFile(output.path, output.contents);
  }

  return outputs;
}

/**
 * @param {GeneratedOutput[]} outputs
 * @returns {string[]}
 */
function findStaleGeneratedOutputs(outputs) {
  return outputs
    .filter(
      (output) => !existsSync(output.path) || readFileSync(output.path, 'utf8') !== output.contents
    )
    .map((output) => output.path);
}

function main() {
  try {
    const { root, check, stdout } = parseArgs(process.argv);
    const manifest = loadServiceManifest(resolve(root, 'apps/web/service-manifest.json'));
    const wiring = generateServiceWiring(manifest);

    if (stdout) {
      process.stdout.write(`${JSON.stringify(wiring, null, 2)}\n`);
      return;
    }

    if (check) {
      const stale = findStaleGeneratedOutputs(getGeneratedOutputs(root, wiring));
      if (stale.length > 0) {
        console.error('Generated service wiring is stale:');
        for (const filePath of stale) {
          console.error(`  - ${filePath}`);
        }
        process.exit(1);
      }
      console.log(`Service wiring is up to date (${String(wiring.services.length)} services).`);
      return;
    }

    const outputs = writeServiceWiringArtifacts(root, wiring);
    console.log(
      `Generated service wiring artifacts:\n${outputs.map((output) => `- ${output.path}`).join('\n')}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Service wiring generation failed: ${message}`);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main();
}

export {
  findStaleGeneratedOutputs,
  generateServiceWiring,
  getGeneratedOutputs,
  loadServiceManifest,
  parseArgs,
  renderConfigGenerated,
  renderEcosystemGenerated,
  renderTerraformServiceUrls,
  validateServiceManifest,
  writeServiceWiringArtifacts,
};
