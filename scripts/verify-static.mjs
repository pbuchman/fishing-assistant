#!/usr/bin/env node
/* eslint-disable no-console */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findStaleGeneratedOutputs,
  generateServiceWiring,
  getGeneratedOutputs,
  loadServiceManifest,
} from './generate-service-wiring.mjs';
import { findForeignProductEnvReferences, findGenericProductEnvAliases } from './verify-env.mjs';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(modulePath), '..');
const ignoredDirectoryNames = new Set(['.git', 'node_modules', 'dist', 'coverage', '.worktrees']);
const sourceExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const appPackageNames = new Set([
  '@fa/chat-service',
  '@fa/knowledge-service',
  '@fa/llm-usage-service',
  '@fa/user-service',
  '@fa/web',
]);
const backendAppNames = ['chat-service', 'knowledge-service', 'llm-usage-service', 'user-service'];
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const requiredWorkspacePaths = [
  { path: 'AGENTS.md', type: 'file' },
  { path: '.codex/skills/deploy/SKILL.md', type: 'file' },
  { path: 'package.json', type: 'file' },
  { path: 'pnpm-workspace.yaml', type: 'file' },
  { path: 'apps/web/package.json', type: 'file' },
  { path: 'apps/chat-service/package.json', type: 'file' },
  { path: 'apps/knowledge-service/package.json', type: 'file' },
  { path: 'apps/llm-usage-service/package.json', type: 'file' },
  { path: 'apps/user-service/package.json', type: 'file' },
  { path: 'packages/common-core/package.json', type: 'file' },
  { path: 'packages/common-http/package.json', type: 'file' },
  { path: 'packages/http-contracts/package.json', type: 'file' },
  { path: 'packages/http-server/package.json', type: 'file' },
  { path: 'packages/infra-firestore/package.json', type: 'file' },
  { path: 'packages/infra-observability/package.json', type: 'file' },
  { path: 'packages/internal-clients/package.json', type: 'file' },
  { path: 'packages/llm-contract/package.json', type: 'file' },
  { path: 'packages/llm-factory/package.json', type: 'file' },
  { path: 'packages/llm-pricing/package.json', type: 'file' },
  { path: 'migrations', type: 'directory' },
  { path: 'scripts', type: 'directory' },
  { path: 'README.md', type: 'file' },
];
const requiredKnowledgeAccessCollections = [
  'fa_knowledge_access_refresh_jobs',
  'fa_knowledge_access_audits',
];
const knowledgeSyncUsecasePath = 'apps/knowledge-service/src/domain/usecases/syncDocument.ts';
const knowledgeAccessRefreshUsecasePath =
  'apps/knowledge-service/src/domain/usecases/accessRefresh.ts';
const forbiddenAccessRefreshIdentityFields = [
  'actorAdminUserId',
  'actorUserId',
  'auth0Subject',
  'authorization',
  'createdByUserId',
  'deletedByUserId',
  'effectiveLevel',
  'ownerId',
  'ownerType',
  'role',
  'status',
  'updatedByUserId',
  'userId',
  'workspaceId',
];

/**
 * @param {string} root
 * @param {string} filePath
 * @returns {string}
 */
function toRelativePath(root, filePath) {
  return relative(root, filePath).split(sep).join('/');
}

/**
 * @param {string} filePath
 * @returns {unknown}
 */
function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} packageJson
 * @returns {Set<string>}
 */
function declaredDependencyNames(packageJson) {
  const dependencies = new Set();

  for (const field of dependencyFields) {
    const entries = packageJson[field];
    if (!isRecord(entries)) {
      continue;
    }

    for (const name of Object.keys(entries)) {
      dependencies.add(name);
    }
  }

  return dependencies;
}

/**
 * @param {string} root
 * @param {string} relativePath
 * @returns {string | undefined}
 */
function readOptionalFile(root, relativePath) {
  const filePath = resolve(root, relativePath);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : undefined;
}

/**
 * @param {string} source
 * @param {string} exportName
 * @returns {string}
 */
function exportConstBlock(source, exportName) {
  const start = source.indexOf(`export const ${exportName}`);
  if (start === -1) {
    return '';
  }
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\nexport const\s+/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/**
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/**
 * @param {string} source
 * @param {string} functionName
 * @returns {string}
 */
function functionBody(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  if (start === -1) {
    return '';
  }
  const parameterStart = source.indexOf('(', start);
  if (parameterStart === -1) {
    return '';
  }
  let parameterDepth = 0;
  let cursor = parameterStart;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '(') {
      parameterDepth += 1;
    } else if (character === ')') {
      parameterDepth -= 1;
      if (parameterDepth === 0) {
        cursor += 1;
        break;
      }
    }
    cursor += 1;
  }
  if (parameterDepth !== 0) {
    return '';
  }
  let typeDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let nestedParameterDepth = 0;
  let openingBrace = -1;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '<') {
      typeDepth += 1;
    } else if (character === '>') {
      typeDepth = Math.max(0, typeDepth - 1);
    } else if (character === '[') {
      bracketDepth += 1;
    } else if (character === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (character === '(') {
      nestedParameterDepth += 1;
    } else if (character === ')') {
      nestedParameterDepth = Math.max(0, nestedParameterDepth - 1);
    } else if (character === '{') {
      if (typeDepth === 0 && braceDepth === 0 && bracketDepth === 0 && nestedParameterDepth === 0) {
        openingBrace = cursor;
        break;
      }
      braceDepth += 1;
    } else if (character === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
    }
    cursor += 1;
  }
  if (openingBrace === -1) {
    return '';
  }
  let depth = 1;
  let bodyCursor = openingBrace + 1;
  while (bodyCursor < source.length && depth > 0) {
    const character = source[bodyCursor];
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
    }
    bodyCursor += 1;
  }
  return depth === 0 ? source.slice(openingBrace + 1, bodyCursor - 1) : '';
}

/**
 * @param {string} root
 * @param {(relativePath: string) => boolean} predicate
 * @returns {string[]}
 */
function listFiles(root, predicate) {
  /** @type {string[]} */
  const files = [];

  /**
   * @param {string} directory
   * @returns {void}
   */
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (ignoredDirectoryNames.has(entry.name)) {
        continue;
      }

      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }

      if (!entry.isFile() || statSync(entryPath).size > 2_000_000) {
        continue;
      }

      const relativePath = toRelativePath(root, entryPath);
      if (predicate(relativePath)) {
        files.push(relativePath);
      }
    }
  }

  visit(root);
  return files;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function findPackageJsonFiles(root) {
  return listFiles(
    root,
    (relativePath) =>
      relativePath === 'package.json' ||
      /^apps\/[^/]+\/package\.json$/.test(relativePath) ||
      /^packages\/[^/]+\/package\.json$/.test(relativePath)
  );
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateWorkspaceShape(root) {
  const errors = [];

  for (const requiredPath of requiredWorkspacePaths) {
    const fullPath = resolve(root, requiredPath.path);
    if (!existsSync(fullPath)) {
      errors.push(`Missing required workspace path: ${requiredPath.path}`);
      continue;
    }

    const stats = statSync(fullPath);
    if (requiredPath.type === 'directory' && !stats.isDirectory()) {
      errors.push(`Required workspace path must be a directory: ${requiredPath.path}`);
    }

    if (requiredPath.type === 'file' && !stats.isFile()) {
      errors.push(`Required workspace path must be a file: ${requiredPath.path}`);
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateWorkspacePackages(root) {
  const errors = [];

  for (const relativePath of findPackageJsonFiles(root)) {
    const packageJson = readJsonFile(resolve(root, relativePath));
    if (!isRecord(packageJson) || typeof packageJson['name'] !== 'string') {
      errors.push(`${relativePath} must have a package name`);
      continue;
    }

    if (!packageJson['name'].startsWith('@fa/')) {
      errors.push(`${relativePath} package name must start with @fa/`);
    }

    if (
      relativePath.startsWith('packages/') &&
      (!isRecord(packageJson['exports']) || packageJson['exports']['.'] !== './src/index.ts')
    ) {
      errors.push(`${relativePath} must export "." as ./src/index.ts`);
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function listSourceFiles(root) {
  return listFiles(root, (relativePath) => {
    const basename = relativePath.split('/').at(-1) ?? '';
    const extension = basename.includes('.') ? `.${basename.split('.').at(-1) ?? ''}` : '';
    return sourceExtensions.has(extension);
  });
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function findImportSources(source) {
  const imports = [];
  const importPattern =
    /\bfrom\s+['"](?<source>[^'"]+)['"]|import\s+['"](?<bare>[^'"]+)['"]|import\s*\(\s*['"](?<dynamic>[^'"]+)['"]\s*\)/g;

  for (const match of source.matchAll(importPattern)) {
    const importSource =
      match.groups?.['source'] ?? match.groups?.['bare'] ?? match.groups?.['dynamic'];
    if (importSource !== undefined) {
      imports.push(importSource);
    }
  }

  return imports;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateNoAppImportsApp(root) {
  const errors = [];
  const appSourceFiles = listSourceFiles(root).filter((relativePath) =>
    relativePath.startsWith('apps/')
  );
  const importPattern = /\bfrom\s+['"](?<source>[^'"]+)['"]|import\s+['"](?<bare>[^'"]+)['"]/g;

  for (const relativePath of appSourceFiles) {
    const source = readFileSync(resolve(root, relativePath), 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const importSource = match.groups?.['source'] ?? match.groups?.['bare'];
      if (importSource !== undefined && appPackageNames.has(importSource)) {
        const currentAppPackage = `@fa/${relativePath.split('/')[1] ?? ''}`;
        if (importSource !== currentAppPackage) {
          errors.push(`${relativePath} must not import app package ${importSource}`);
        }
      }
    }
  }

  return errors;
}

/**
 * @param {string} importSource
 * @returns {boolean}
 */
function isAppPathImport(importSource) {
  return /(^|\/)apps\//.test(importSource);
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateCommonCoreIsLeaf(root) {
  /** @type {string[]} */
  const errors = [];
  const packagePath = resolve(root, 'packages/common-core/package.json');
  if (!existsSync(packagePath)) {
    return errors;
  }

  const packageJson = readJsonFile(packagePath);
  if (!isRecord(packageJson)) {
    return errors;
  }

  for (const dependency of declaredDependencyNames(packageJson)) {
    if (dependency.startsWith('@fa/')) {
      errors.push(`packages/common-core/package.json common-core must not depend on ${dependency}`);
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validatePackageImportBoundaries(root) {
  /** @type {string[]} */
  const errors = [];
  const packageSourceFiles = listSourceFiles(root).filter((relativePath) =>
    relativePath.startsWith('packages/')
  );

  for (const relativePath of packageSourceFiles) {
    const source = readFileSync(resolve(root, relativePath), 'utf8');
    for (const importSource of findImportSources(source)) {
      if (isAppPathImport(importSource)) {
        errors.push(`${relativePath} must not import from apps/*`);
      }

      if (appPackageNames.has(importSource)) {
        errors.push(`${relativePath} must not import app package ${importSource}`);
      }

      if (
        relativePath.startsWith('packages/infra-firestore/') &&
        importSource === '@fa/http-server'
      ) {
        errors.push(`${relativePath} must not import @fa/http-server`);
      }
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateBackendSharedDependencies(root) {
  /** @type {string[]} */
  const errors = [];

  for (const appName of backendAppNames) {
    const packageRelativePath = `apps/${appName}/package.json`;
    const packagePath = resolve(root, packageRelativePath);
    if (!existsSync(packagePath)) {
      continue;
    }

    const packageJson = readJsonFile(packagePath);
    if (!isRecord(packageJson)) {
      continue;
    }

    const declared = declaredDependencyNames(packageJson);
    const sourceFiles = listSourceFiles(root).filter((relativePath) =>
      relativePath.startsWith(`apps/${appName}/src/`)
    );

    for (const relativePath of sourceFiles) {
      const source = readFileSync(resolve(root, relativePath), 'utf8');
      for (const importSource of findImportSources(source)) {
        if (!importSource.startsWith('@fa/')) {
          continue;
        }

        if (!declared.has(importSource)) {
          errors.push(
            `${packageRelativePath} must declare dependency ${importSource} imported by ${relativePath}`
          );
        }
      }
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateKnowledgeDomainDoesNotImportLlmFactory(root) {
  /** @type {string[]} */
  const errors = [];
  const domainSourceFiles = listSourceFiles(root).filter((relativePath) =>
    relativePath.startsWith('apps/knowledge-service/src/domain/')
  );

  for (const relativePath of domainSourceFiles) {
    const source = readFileSync(resolve(root, relativePath), 'utf8');
    for (const importSource of findImportSources(source)) {
      if (importSource === '@fa/llm-factory') {
        errors.push(
          `${relativePath} must not import @fa/llm-factory from knowledge-service domain code`
        );
      }
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateNoRawFetch(root) {
  const errors = [];
  const allowedPath = 'apps/web/src/services/apiClient.ts';
  const webSourceFiles = listSourceFiles(root).filter((relativePath) =>
    relativePath.startsWith('apps/web/src/')
  );

  for (const relativePath of webSourceFiles) {
    if (relativePath === allowedPath) {
      continue;
    }

    const source = readFileSync(resolve(root, relativePath), 'utf8');
    if (/\bfetch\s*\(/.test(source)) {
      errors.push(`Raw fetch is only allowed in ${allowedPath}: ${relativePath}`);
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateFirestoreCollections(root) {
  const errors = [];
  const registryPath = resolve(root, 'firestore-collections.json');
  if (!existsSync(registryPath)) {
    return ['Missing firestore-collections.json'];
  }

  const registry = readJsonFile(registryPath);
  if (!isRecord(registry)) {
    return ['firestore-collections.json must be an object'];
  }

  if (typeof registry['$schema'] !== 'string' || registry['$schema'].length === 0) {
    errors.push('firestore-collections.json must declare a $schema string');
  }

  if (typeof registry['description'] !== 'string' || registry['description'].length === 0) {
    errors.push('firestore-collections.json must declare a description string');
  }

  if (!isRecord(registry['collections'])) {
    errors.push('firestore-collections.json must contain a collections object keyed by name');
    return errors;
  }

  const seen = new Set();
  for (const [name, collection] of Object.entries(registry['collections'])) {
    if (name.length === 0) {
      errors.push('firestore-collections.json collection keys must be non-empty');
      continue;
    }

    if (seen.has(name)) {
      errors.push(`Duplicate Firestore collection name: ${name}`);
    } else {
      seen.add(name);
    }

    if (!isRecord(collection)) {
      errors.push(`firestore-collections.json collections.${name} must be an object`);
      continue;
    }

    if (collection['name'] !== undefined && collection['name'] !== name) {
      errors.push(
        `firestore-collections.json collections.${name}.name must match the collection key when present`
      );
    }

    if (typeof collection['owner'] !== 'string' || collection['owner'].length === 0) {
      errors.push(
        `firestore-collections.json collections.${name}.owner must be a non-empty string`
      );
    }

    if (typeof collection['description'] !== 'string' || collection['description'].length === 0) {
      errors.push(
        `firestore-collections.json collections.${name}.description must be a non-empty string`
      );
    }
  }

  if (!Object.hasOwn(registry['collections'], '_migrations')) {
    errors.push('firestore-collections.json must register _migrations');
  }

  const requiredUsageCollections = [
    'llm_usage_events',
    'llm_usage_daily_aggregates',
    'llm_pricing',
  ];
  for (const name of requiredUsageCollections) {
    const collection = registry['collections'][name];
    const owner = isRecord(collection) ? collection['owner'] : undefined;
    if (owner !== 'llm-usage-service') {
      errors.push(`firestore-collections.json must register ${name} with owner llm-usage-service`);
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateDataBaselineStaticRequirements(root) {
  /** @type {string[]} */
  const errors = [];

  const packageJsonPath = resolve(root, 'package.json');
  if (!existsSync(packageJsonPath)) {
    errors.push('package.json scripts must define verify:data-baseline');
  } else {
    const packageJson = readJsonFile(packageJsonPath);
    const scripts = isRecord(packageJson) ? packageJson['scripts'] : undefined;
    if (
      !isRecord(scripts) ||
      scripts['verify:data-baseline'] !== 'node scripts/verify-data-baseline.mjs'
    ) {
      errors.push('package.json scripts must define verify:data-baseline');
    }
  }

  if (!existsSync(resolve(root, 'scripts/verify-data-baseline.mjs'))) {
    errors.push('Missing scripts/verify-data-baseline.mjs');
  }

  const registryPath = resolve(root, 'firestore-collections.json');
  if (existsSync(registryPath)) {
    const registry = readJsonFile(registryPath);
    const collections =
      isRecord(registry) && isRecord(registry['collections']) ? registry['collections'] : {};

    for (const removedCollection of ['fishing_knowledge_documents', 'fishing_knowledge_chunks']) {
      if (Object.hasOwn(collections, removedCollection)) {
        errors.push(
          `firestore-collections.json must not register ${removedCollection} after runtime data baseline cleanup`
        );
      }
    }
  }

  const indexesPath = resolve(root, 'firestore.indexes.json');
  if (!existsSync(indexesPath)) {
    errors.push('Missing firestore.indexes.json');
    return errors;
  }

  const artifact = readJsonFile(indexesPath);
  const indexes =
    isRecord(artifact) && Array.isArray(artifact['indexes']) ? artifact['indexes'] : [];
  const indexStrings = indexes.map((index) => JSON.stringify(index));

  if (
    indexStrings.some(
      (index) =>
        index.includes('"collectionGroup":"fishing_knowledge_documents"') ||
        index.includes('"collectionGroup":"fishing_knowledge_chunks"')
    )
  ) {
    errors.push(
      'firestore.indexes.json must not contain removed Knowledge Base indexes for fishing_knowledge_documents or fishing_knowledge_chunks'
    );
  }

  const requiredIndexes = [
    JSON.stringify({
      collectionGroup: 'fa_users',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'auth0Subject', order: 'ASCENDING' },
        { fieldPath: 'deletedAt', order: 'ASCENDING' },
      ],
    }),
    JSON.stringify({
      collectionGroup: 'fa_knowledge_access_refresh_jobs',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'nextRunAt', order: 'ASCENDING' },
        { fieldPath: 'priority', order: 'DESCENDING' },
      ],
    }),
    JSON.stringify({
      collectionGroup: 'fa_knowledge_chunks',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
        { fieldPath: 'embedding', vectorConfig: { dimension: 2048, flat: {} } },
      ],
    }),
    JSON.stringify({
      collectionGroup: 'fa_knowledge_chunks',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'pageId', order: 'ASCENDING' },
        { fieldPath: 'index', order: 'ASCENDING' },
      ],
    }),
    JSON.stringify({
      collectionGroup: 'llm_usage_daily_aggregates',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'owner.id', order: 'ASCENDING' },
        { fieldPath: 'bucket.day', order: 'ASCENDING' },
      ],
    }),
  ];

  if (!requiredIndexes.every((index) => indexStrings.includes(index))) {
    errors.push(
      'firestore.indexes.json must include runtime data baseline indexes for user auth, knowledge access refresh, knowledge vector retrieval, and usage aggregation'
    );
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateKnowledgeAccessStaticRequirements(root) {
  /** @type {string[]} */
  const errors = [];
  const packageJsonPath = resolve(root, 'package.json');
  if (!existsSync(packageJsonPath)) {
    errors.push('package.json scripts must define verify:knowledge-access');
  } else {
    const packageJson = readJsonFile(packageJsonPath);
    const scripts = isRecord(packageJson) ? packageJson['scripts'] : undefined;
    if (
      !isRecord(scripts) ||
      scripts['verify:knowledge-access'] !== 'node scripts/verify-knowledge-access.mjs'
    ) {
      errors.push('package.json scripts must define verify:knowledge-access');
    }
  }

  if (!existsSync(resolve(root, 'scripts/verify-knowledge-access.mjs'))) {
    errors.push('Missing scripts/verify-knowledge-access.mjs');
  }

  const knowledgeSyncSource = readOptionalFile(root, knowledgeSyncUsecasePath);
  if (knowledgeSyncSource === undefined) {
    errors.push(`Missing ${knowledgeSyncUsecasePath}`);
  } else {
    const buildPageChunksBody = stripComments(functionBody(knowledgeSyncSource, 'buildPageChunks'));
    if (buildPageChunksBody.length === 0) {
      errors.push(
        `${knowledgeSyncUsecasePath} current-schema chunk generation must define buildPageChunks`
      );
    }
    if (!/title\s*:\s*input\.page\.title/.test(buildPageChunksBody)) {
      errors.push(
        `${knowledgeSyncUsecasePath} current-schema chunk generation must copy page title into active chunks`
      );
    }
    if (!/path\s*:\s*\[\s*\.\.\.\s*input\.page\.pathTitles\s*\]/.test(buildPageChunksBody)) {
      errors.push(
        `${knowledgeSyncUsecasePath} current-schema chunk generation must copy page pathTitles into active chunks`
      );
    }
    if (
      !/gate\s*:\s*(?:pageAccess|input\.page\.access\.effective)\.gate/.test(buildPageChunksBody) ||
      !/requiredLevel\s*:\s*(?:pageAccess|input\.page\.access\.effective)\.requiredLevel/.test(
        buildPageChunksBody
      )
    ) {
      errors.push(
        `${knowledgeSyncUsecasePath} current-schema chunk generation must copy page effective access gate and requiredLevel into active chunks`
      );
    }
    if (
      !/accessRevision\s*:\s*(?:pageAccess|input\.page\.access\.effective)\.accessRevision/.test(
        buildPageChunksBody
      ) ||
      !/accessSyncStatus\s*:\s*['"]current['"]/.test(buildPageChunksBody)
    ) {
      errors.push(
        `${knowledgeSyncUsecasePath} current-schema chunk generation must copy page access revision and current access sync status into active chunks`
      );
    }
    if (
      !/source\s*:\s*{[\s\S]*url\s*:\s*input\.page\.source\.url[\s\S]*label\s*:\s*input\.page\.source\.label[\s\S]*}/.test(
        buildPageChunksBody
      )
    ) {
      errors.push(
        `${knowledgeSyncUsecasePath} current-schema chunk generation must copy page source URL metadata into active chunks when available`
      );
    }
  }

  const knowledgeAccessRefreshSource = readOptionalFile(root, knowledgeAccessRefreshUsecasePath);
  if (knowledgeAccessRefreshSource === undefined) {
    errors.push(`Missing ${knowledgeAccessRefreshUsecasePath}`);
  } else {
    const auditPageAccessStateBody = stripComments(
      functionBody(knowledgeAccessRefreshSource, 'openAccessAuditsForPage')
    );
    if (auditPageAccessStateBody.length === 0) {
      errors.push(
        `${knowledgeAccessRefreshUsecasePath} chunk/page access monitoring must define openAccessAuditsForPage`
      );
    }
    if (
      !/accessPresent\s*:\s*chunkAccess\s*!==\s*undefined/.test(auditPageAccessStateBody) ||
      !auditPageAccessStateBody.includes("kind: 'missing_chunk_access'")
    ) {
      errors.push(
        `${knowledgeAccessRefreshUsecasePath} chunk/page access monitoring must flag missing chunk access metadata with accessPresent details`
      );
    }
    if (
      !/chunkAccess\.gate\s*!==\s*input\.page\.access\.effective\.gate/.test(
        auditPageAccessStateBody
      ) ||
      !/chunkAccess\.requiredLevel\s*!==\s*input\.page\.access\.effective\.requiredLevel/.test(
        auditPageAccessStateBody
      ) ||
      !/chunk\.accessRevision\s*!==\s*input\.page\.access\.effective\.accessRevision/.test(
        auditPageAccessStateBody
      ) ||
      !/chunkSourceUrl\s*!==\s*input\.page\.source\.url/.test(auditPageAccessStateBody) ||
      !auditPageAccessStateBody.includes("kind: 'chunk_page_access_mismatch'")
    ) {
      errors.push(
        `${knowledgeAccessRefreshUsecasePath} chunk/page access monitoring must compare chunk gate, requiredLevel, revision, and source URL against the page`
      );
    }
  }

  const registryPath = resolve(root, 'firestore-collections.json');
  if (existsSync(registryPath)) {
    const registry = readJsonFile(registryPath);
    const collections =
      isRecord(registry) && isRecord(registry['collections']) ? registry['collections'] : {};
    for (const name of requiredKnowledgeAccessCollections) {
      const collection = collections[name];
      const owner = isRecord(collection) ? collection['owner'] : undefined;
      if (owner !== 'knowledge-service') {
        errors.push(
          `firestore-collections.json must register ${name} with owner knowledge-service`
        );
      }
    }
  }

  const schemasPath = 'packages/http-contracts/src/routeSchemas.ts';
  const schemasSource = readOptionalFile(root, schemasPath);
  if (schemasSource === undefined) {
    errors.push(`${schemasPath} must define strict access-refresh route schemas`);
  } else {
    const paramsBlock = exportConstBlock(
      schemasSource,
      'knowledgeAdminAccessRefreshJobParamsSchema'
    );
    const retryBodyBlock = exportConstBlock(
      schemasSource,
      'knowledgeAdminAccessRefreshRetryBodySchema'
    );
    if (paramsBlock.length === 0 || !paramsBlock.includes('additionalProperties: false')) {
      errors.push(`${schemasPath} access-refresh job params schema must reject extra fields`);
    }
    if (retryBodyBlock.length === 0 || !retryBodyBlock.includes('strictEmptyObjectSchema')) {
      errors.push(`${schemasPath} access-refresh retry body schema must be a strict empty object`);
    }
    const combined = `${paramsBlock}\n${retryBodyBlock}`;
    for (const field of forbiddenAccessRefreshIdentityFields) {
      if (combined.includes(field)) {
        errors.push(`${schemasPath} access-refresh route schemas must not accept ${field}`);
      }
    }
  }

  const deprecatedCitationFallbackFiles = [
    'apps/knowledge-service/src/domain/usecases/retrieveKnowledge.ts',
    'apps/knowledge-service/src/routes/knowledgeRoutes.ts',
    'apps/chat-service/src/domain/usecases/streamChatMessage.ts',
    'apps/web/src/workspace/WorkspaceApp.tsx',
  ];
  for (const relativePath of deprecatedCitationFallbackFiles) {
    const source = readOptionalFile(root, relativePath);
    if (
      source !== undefined &&
      (/\b(?:deprecatedCitationFallback|citationFallback|fallbackCitations)\b/.test(source) ||
        (relativePath === 'apps/web/src/workspace/WorkspaceApp.tsx' &&
          source.includes('#/knowledge/documents/')))
    ) {
      errors.push('deprecated citation fallback must remain absent');
      break;
    }
  }

  const webAppShellPath = 'apps/web/src/App.tsx';
  const webAppShellSource = readOptionalFile(root, webAppShellPath);
  if (
    webAppShellSource !== undefined &&
    /lazy\s*\(\s*\(\s*\)\s*=>\s*import\s*\(\s*['"]\.\/workspace\/WorkspaceApp\.js['"]\s*\)\s*\)/.test(
      stripComments(webAppShellSource)
    )
  ) {
    errors.push(
      `${webAppShellPath} must statically import WorkspaceApp so protected routes do not blank after deploy-pruned lazy chunks`
    );
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validatePublicRagEvidenceContract(root) {
  /** @type {string[]} */
  const errors = [];
  const retrievePath = 'apps/knowledge-service/src/domain/usecases/retrieveKnowledge.ts';
  const sourceRefsPath = 'apps/knowledge-service/src/domain/usecases/sourceRefs.ts';
  const ragPath = 'apps/chat-service/src/domain/rag/rag.ts';
  const ragSourcePath = 'apps/chat-service/src/infra/http/knowledgeServiceRagSource.ts';

  const retrieveSource = readOptionalFile(root, retrievePath);
  const sourceRefsSource = readOptionalFile(root, sourceRefsPath);
  if (retrieveSource === undefined) {
    errors.push(`Missing ${retrievePath}`);
  } else {
    const evidenceBody = stripComments(functionBody(retrieveSource, 'evidenceFromChunk'));
    const publicEvidenceIdBody = stripComments(
      functionBody(retrieveSource, 'publicEvidenceId') ||
        (sourceRefsSource === undefined ? '' : functionBody(sourceRefsSource, 'publicEvidenceId'))
    );
    const safeIdSource = `${retrieveSource}\n${sourceRefsSource ?? ''}`;
    const overfetchBody = stripComments(functionBody(retrieveSource, 'overfetchLimit'));
    if (evidenceBody.includes('knowledge_document') || !evidenceBody.includes("'knowledge_page'")) {
      errors.push(
        `${retrievePath} public RAG evidence must use knowledge_page, not removed knowledge_document`
      );
    }
    if (
      /knowledge:\$\{|\bknowledge:\b|input\.chunk\.id/.test(
        `${evidenceBody}\n${publicEvidenceIdBody}`
      ) ||
      !/id:\s*publicEvidenceId\(input\)/.test(evidenceBody) ||
      !safeIdSource.includes('knowledge-page:')
    ) {
      errors.push(
        `${retrievePath} public RAG evidence ids must use knowledge-page: safe ids instead of raw knowledge: chunk ids`
      );
    }
    if (/\b(?:documentId|chunkId)\b/.test(evidenceBody)) {
      errors.push(
        `${retrievePath} public RAG evidence metadata must not expose documentId or chunkId`
      );
    }
    if (
      !/limit\s*\*\s*8/.test(overfetchBody) ||
      !/Math\.max\([\s\S]*40/.test(overfetchBody) ||
      !/Math\.min\([\s\S]*120/.test(overfetchBody)
    ) {
      errors.push(
        `${retrievePath} retrieval must overfetch at least min(max(topK * 8, 40), 120) before authorization filtering`
      );
    }
  }

  const ragSource = readOptionalFile(root, ragPath);
  if (ragSource === undefined) {
    errors.push(`Missing ${ragPath}`);
  } else {
    const traceBody = stripComments(functionBody(ragSource, 'retrievalTrace'));
    if (
      /metadata\s*:\s*{\s*\.\.\.\s*item\.metadata\s*}/.test(traceBody) ||
      !ragSource.includes('publicEvidenceMetadata')
    ) {
      errors.push(
        `${ragPath} public retrieval traces must sanitize evidence metadata instead of copying item.metadata`
      );
    }
  }

  const parserSource = readOptionalFile(root, ragSourcePath);
  if (parserSource === undefined) {
    errors.push(`Missing ${ragSourcePath}`);
  } else {
    const metadataBody = stripComments(functionBody(parserSource, 'isRagEvidenceMetadata'));
    if (
      !parserSource.includes("'knowledge_page'") ||
      parserSource.includes("'knowledge_document'")
    ) {
      errors.push(
        `${ragSourcePath} Knowledge Service RAG parser must accept knowledge_page evidence`
      );
    }
    if (
      !metadataBody.includes('documentId') ||
      !metadataBody.includes('pageId') ||
      !metadataBody.includes('chunkId') ||
      /optionalString\(\s*value(?:\[['"]documentId['"]\]|\.\s*documentId)/.test(metadataBody) ||
      /optionalString\(\s*value(?:\[['"]chunkId['"]\]|\.\s*chunkId)/.test(metadataBody)
    ) {
      errors.push(
        `${ragSourcePath} Knowledge Service RAG parser must reject internal documentId/pageId/chunkId metadata`
      );
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateServiceWiringCurrent(root) {
  const manifestPath = resolve(root, 'apps/web/service-manifest.json');
  if (!existsSync(manifestPath)) {
    return ['Missing apps/web/service-manifest.json'];
  }

  const manifest = loadServiceManifest(manifestPath);
  const wiring = generateServiceWiring(manifest);
  return findStaleGeneratedOutputs(getGeneratedOutputs(root, wiring)).map(
    (filePath) => `Generated service wiring is stale: ${toRelativePath(root, filePath)}`
  );
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateViteProxy(root) {
  const source = readOptionalFile(root, 'apps/web/vite.config.ts');
  if (source === undefined) {
    return ['Missing apps/web/vite.config.ts'];
  }

  const errors = [];
  if (!source.includes("envPrefix: 'FA_'") && !source.includes('envPrefix: "FA_"')) {
    errors.push('apps/web/vite.config.ts must set envPrefix to FA_');
  }

  if (!/envDir:\s*false/.test(source)) {
    errors.push(
      'apps/web/vite.config.ts must set envDir: false so Vite cannot load backend-only FA values from web .env files'
    );
  }

  if (!source.includes('rewrite') || !/replace\([^)]*api/i.test(source)) {
    errors.push('apps/web/vite.config.ts must strip API prefixes in the Vite proxy rewrite');
  }

  if (!source.includes('bypass') || !source.includes('/internal') || !source.includes('false')) {
    errors.push(
      'apps/web/vite.config.ts must return 404 for public /api/*/internal/* routes before proxying'
    );
  }

  if (!source.includes('dev.fishing-assistant.online')) {
    errors.push('apps/web/vite.config.ts must allow the DEV public hostname');
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateWebViteEnvironment(root) {
  const errors = [];
  const runWebViteSource = readOptionalFile(root, 'scripts/run-web-vite.mjs');
  const webPackagePath = resolve(root, 'apps/web/package.json');
  const ecosystemSource = readOptionalFile(root, 'ecosystem.config.cjs');

  if (runWebViteSource === undefined) {
    errors.push('Missing scripts/run-web-vite.mjs');
  } else {
    for (const requiredFragment of [
      'WEB_SAFE_FA_ENV_NAMES',
      'createSanitizedWebEnv',
      "key.startsWith('FA_')",
      '!WEB_SAFE_FA_ENV_NAMES.has(key)',
    ]) {
      if (!runWebViteSource.includes(requiredFragment)) {
        errors.push(
          'scripts/run-web-vite.mjs must strip non-browser-safe FA env before running Vite'
        );
        break;
      }
    }
  }

  if (existsSync(webPackagePath)) {
    const packageJson = readJsonFile(webPackagePath);
    const scripts =
      isRecord(packageJson) && isRecord(packageJson['scripts']) ? packageJson['scripts'] : {};
    for (const scriptName of ['dev', 'build', 'preview']) {
      const script = scripts[scriptName];
      if (typeof script !== 'string' || !script.includes('scripts/run-web-vite.mjs')) {
        errors.push('apps/web/package.json scripts must run Vite through scripts/run-web-vite.mjs');
        break;
      }
    }
  }

  if (ecosystemSource === undefined) {
    errors.push('Missing ecosystem.config.cjs');
  } else if (!ecosystemSource.includes('run-web-vite.mjs')) {
    errors.push('ecosystem.config.cjs fa-web must run through scripts/run-web-vite.mjs');
  } else {
    if (!ecosystemSource.includes("'preview'")) {
      errors.push('ecosystem.config.cjs fa-web must serve the built web bundle with Vite preview');
    }
    if (!ecosystemSource.includes('filter_env') || !ecosystemSource.includes("'FA_'")) {
      errors.push('ecosystem.config.cjs fa-web must filter inherited FA env before starting');
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateMigrationShape(root) {
  const migrationsDirectory = resolve(root, 'migrations');
  if (!existsSync(migrationsDirectory)) {
    return [];
  }

  return listFiles(root, (relativePath) => /^migrations\/[^/]+\.mjs$/.test(relativePath)).flatMap(
    (relativePath) => {
      const basename = relativePath.split('/').at(-1) ?? '';
      const errors = [];
      if (!/^\d{3}[_-].+\.mjs$/.test(basename)) {
        errors.push(`Migration file must start with a numeric prefix: ${relativePath}`);
        return errors;
      }

      const testBasename = basename.replace(/\.mjs$/, '.test.ts').replace(/^(\d{3})[_-]/, '$1-');
      const testPath = `migrations/__tests__/${testBasename}`;
      if (!existsSync(resolve(root, testPath))) {
        errors.push(`Missing migration test for ${relativePath}: ${testPath}`);
      }

      return errors;
    }
  );
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateLlmUsageServiceRequirements(root) {
  /** @type {string[]} */
  const errors = [];
  const packagePath = resolve(root, 'apps/llm-usage-service/package.json');
  if (existsSync(packagePath)) {
    const packageJson = readJsonFile(packagePath);
    const declared = isRecord(packageJson) ? declaredDependencyNames(packageJson) : new Set();
    if (!declared.has('@fa/infra-firestore')) {
      errors.push(
        'apps/llm-usage-service/package.json must declare dependency @fa/infra-firestore'
      );
    }
  }

  const internalRoutesPath = 'apps/llm-usage-service/src/routes/internalUsageRoutes.ts';
  const internalRoutesSource = readOptionalFile(root, internalRoutesPath);
  if (internalRoutesSource === undefined) {
    errors.push(`${internalRoutesPath} must define POST /internal/usage-events`);
    return errors;
  }

  if (!internalRoutesSource.includes('/internal/usage-events')) {
    errors.push(`${internalRoutesPath} must define POST /internal/usage-events`);
  }

  if (!internalRoutesSource.includes('validateInternalAuth')) {
    errors.push(
      `${internalRoutesPath} must validate internal auth for POST /internal/usage-events`
    );
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validatePm2Scripts(root) {
  const packageJsonPath = resolve(root, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return ['Missing package.json'];
  }

  const packageJson = readJsonFile(packageJsonPath);
  if (!isRecord(packageJson) || !isRecord(packageJson['scripts'])) {
    return ['package.json must contain scripts'];
  }

  const errors = [];
  for (const [name, command] of Object.entries(packageJson['scripts'])) {
    if (typeof command !== 'string') {
      continue;
    }

    if (/\bpm2\s+(?:stop|delete|restart|reload|logs)\s+all\b/.test(command)) {
      errors.push(`package.json script ${name} must target FA PM2 processes instead of all`);
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateCiPipeline(root) {
  /** @type {string[]} */
  const errors = [];

  const packageJsonPath = resolve(root, 'package.json');
  if (existsSync(packageJsonPath)) {
    const packageJson = readJsonFile(packageJsonPath);
    const scripts = isRecord(packageJson) ? packageJson['scripts'] : undefined;
    if (
      !isRecord(scripts) ||
      typeof scripts['verify:observability'] !== 'string' ||
      scripts['verify:observability'].length === 0
    ) {
      errors.push('package.json scripts must define verify:observability');
    }

    const verifyScript = isRecord(scripts) ? scripts['verify'] : undefined;
    if (typeof verifyScript === 'string') {
      if (
        verifyScript.includes('verify:data-baseline') ||
        !verifyScript.includes('scripts/__tests__/verify-data-baseline.test.ts')
      ) {
        errors.push(
          'package.json verify must run CI-safe runtime data baseline verifier tests instead of live Firestore verification'
        );
      }
    }
  }

  const source = readOptionalFile(root, 'scripts/ci.mjs');
  if (source === undefined) {
    errors.push('scripts/ci.mjs must run verify:observability after verify:static');
    return errors;
  }

  if (source.includes('generate:service-wiring')) {
    errors.push(
      'scripts/ci.mjs must verify generated service wiring without running generate:service-wiring'
    );
  }

  if (
    source.includes('verify:data-baseline') ||
    !source.includes('scripts/__tests__/verify-data-baseline.test.ts')
  ) {
    errors.push(
      'scripts/ci.mjs must run CI-safe runtime data baseline verifier tests instead of live Firestore verification'
    );
  }

  const staticIndex = source.indexOf('verify:static');
  const knowledgeAccessIndex = source.indexOf('verify:knowledge-access');
  const observabilityIndex = source.indexOf('verify:observability');
  if (staticIndex === -1 || knowledgeAccessIndex === -1 || knowledgeAccessIndex < staticIndex) {
    errors.push('scripts/ci.mjs must run verify:knowledge-access after verify:static');
  }
  if (staticIndex === -1 || observabilityIndex === -1 || observabilityIndex < staticIndex) {
    errors.push('scripts/ci.mjs must run verify:observability after verify:static');
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateRuntimeRequestLogging(root) {
  /** @type {string[]} */
  const errors = [];
  const createServiceAppPath = 'packages/http-server/src/createServiceApp.ts';
  const createServiceAppSource = readOptionalFile(root, createServiceAppPath);

  if (createServiceAppSource !== undefined) {
    if (
      !createServiceAppSource.includes('serverOptions') ||
      !/\.\.\.\s*options\.serverOptions/.test(createServiceAppSource)
    ) {
      errors.push(
        `${createServiceAppPath} must forward caller serverOptions into Fastify for runtime logging`
      );
    }

    if (/\blogger\s*:\s*false\b/.test(createServiceAppSource)) {
      errors.push(`${createServiceAppPath} must not hard-code logger: false`);
    }
  }

  for (const appName of backendAppNames) {
    const indexPath = `apps/${appName}/src/index.ts`;
    const indexSource = readOptionalFile(root, indexPath);
    if (indexSource === undefined) {
      continue;
    }

    if (
      !indexSource.includes('createAppLogger') ||
      !indexSource.includes('@fa/infra-observability') ||
      !indexSource.includes('serverOptions') ||
      !/\bloggerInstance\s*:\s*logger\b/.test(indexSource)
    ) {
      errors.push(
        `${indexPath} must enable structured runtime logging with createAppLogger and serverOptions.loggerInstance`
      );
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validatePromptVersions(root) {
  const promptFiles = listFiles(root, (relativePath) =>
    /^apps\/[^/]+\/src\/domain\/prompts\/[^/]+Prompt\.ts$/.test(relativePath)
  );
  const errors = [];

  for (const relativePath of promptFiles) {
    const source = readFileSync(resolve(root, relativePath), 'utf8');
    if (!/\bversion\s*:\s*['"]\d+\.\d+\.\d+['"]/.test(source)) {
      errors.push(`${relativePath} must declare a semver prompt version`);
    }

    if (!source.includes('Prompt version:')) {
      errors.push(`${relativePath} must include Prompt version in generated prompt content`);
    }
  }

  return errors;
}

/**
 * @param {string} source
 * @param {string} interfaceName
 * @returns {boolean}
 */
function interfaceDeclaresOptionalPromptVersions(source, interfaceName) {
  const match = source.match(
    new RegExp(`\\binterface\\s+${interfaceName}\\s*{(?<body>[\\s\\S]*?)}`)
  );
  const body = match?.groups?.['body'];
  return typeof body === 'string' && /\bpromptVersions\?\s*:/.test(body);
}

/**
 * @param {string} source
 * @param {string} propertyName
 * @param {string} versionReference
 * @returns {boolean}
 */
function streamPersistsPromptVersion(source, propertyName, versionReference) {
  const escapedVersionReference = versionReference.replaceAll('.', '\\.');
  const promptVersionsToVersion = new RegExp(
    `\\bpromptVersions\\b[\\s\\S]*\\b${propertyName}\\b[\\s\\S]*\\b${escapedVersionReference}\\b`
  );
  const versionToPromptVersions = new RegExp(
    `\\b${escapedVersionReference}\\b[\\s\\S]*\\b${propertyName}\\b[\\s\\S]*\\bpromptVersions\\b`
  );
  return promptVersionsToVersion.test(source) || versionToPromptVersions.test(source);
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validatePromptPersistence(root) {
  const promptFiles = listFiles(root, (relativePath) =>
    /^apps\/chat-service\/src\/domain\/prompts\/[^/]+Prompt\.ts$/.test(relativePath)
  );
  if (promptFiles.length === 0) {
    return [];
  }

  const errors = [];
  const chatAssistantPromptPath = 'apps/chat-service/src/domain/prompts/chatAssistantPrompt.ts';
  const answerGroundingPromptPath = 'apps/chat-service/src/domain/prompts/answerGroundingPrompt.ts';
  const answerRepairPromptPath = 'apps/chat-service/src/domain/prompts/answerRepairPrompt.ts';
  const answerPromptVersionReference = promptFiles.includes(chatAssistantPromptPath)
    ? 'chatAssistantPrompt.version'
    : 'fishingAnswerPrompt.version';
  const hasAnswerGroundingPrompt = promptFiles.includes(answerGroundingPromptPath);
  const hasAnswerRepairPrompt = promptFiles.includes(answerRepairPromptPath);
  const modelPath = 'apps/chat-service/src/domain/models/chat.ts';
  const streamContractPath = 'packages/http-contracts/src/chatStream.ts';
  const streamUseCasePath = 'apps/chat-service/src/domain/usecases/streamChatMessage.ts';
  const firestorePath =
    'apps/chat-service/src/infra/firestore/firestoreConversationMessageRepository.ts';
  const modelSource = readOptionalFile(root, modelPath);
  const streamContractSource = readOptionalFile(root, streamContractPath);
  const streamUseCaseSource = readOptionalFile(root, streamUseCasePath);
  const firestoreSource = readOptionalFile(root, firestorePath);

  if (
    modelSource === undefined ||
    !interfaceDeclaresOptionalPromptVersions(modelSource, 'ConversationMessage')
  ) {
    errors.push(`${modelPath} ConversationMessage must expose optional promptVersions metadata`);
  }

  if (
    streamContractSource === undefined ||
    !interfaceDeclaresOptionalPromptVersions(streamContractSource, 'ChatStreamConversationMessage')
  ) {
    errors.push(
      `${streamContractPath} ChatStreamConversationMessage must expose optional promptVersions metadata`
    );
  }

  if (
    streamUseCaseSource === undefined ||
    !streamPersistsPromptVersion(streamUseCaseSource, 'answer', answerPromptVersionReference)
  ) {
    errors.push(
      `${streamUseCasePath} must persist ${answerPromptVersionReference} in assistant promptVersions.answer`
    );
  }

  if (
    hasAnswerGroundingPrompt &&
    (streamUseCaseSource === undefined ||
      !streamPersistsPromptVersion(
        streamUseCaseSource,
        'grounding',
        'answerGroundingPrompt.version'
      ))
  ) {
    errors.push(
      `${streamUseCasePath} must persist answerGroundingPrompt.version in assistant promptVersions.grounding`
    );
  }

  if (
    hasAnswerRepairPrompt &&
    (streamUseCaseSource === undefined ||
      !streamPersistsPromptVersion(streamUseCaseSource, 'repair', 'answerRepairPrompt.version'))
  ) {
    errors.push(
      `${streamUseCasePath} must persist answerRepairPrompt.version in assistant promptVersions.repair when answerRepairPrompt exists`
    );
  }

  if (firestoreSource === undefined || !/\bmessage\.promptVersions\b/.test(firestoreSource)) {
    errors.push(`${firestorePath} messageToDoc must write promptVersions`);
  }

  if (
    firestoreSource === undefined ||
    !/data\s*(?:\.\s*promptVersions|\[\s*['"]promptVersions['"]\s*\])/.test(firestoreSource)
  ) {
    errors.push(`${firestorePath} messageFromDoc must read promptVersions`);
  }

  return errors;
}

const requiredDeploymentArtifacts = [
  'scripts/bootstrap/bootstrap-gcp-data-plane.sh',
  'scripts/deploy/deploy-dev.sh',
  'scripts/dev-host/fa-pm2.service',
  'scripts/dev-host/webhook-handler.mjs',
  'scripts/dev-host/webhook-handler.service',
  'scripts/dev-host/caddy/fishing-assistant.Caddyfile',
  'scripts/hetzner/provision.sh',
  'scripts/hetzner/load-secrets.sh',
  'scripts/hetzner/load-observability-env.sh',
  'scripts/hetzner/install-nginx-and-cert.sh',
  'scripts/hetzner/deploy-nginx.sh',
  'scripts/hetzner/deploy-web.sh',
  'scripts/hetzner/build-services-image.sh',
  'scripts/hetzner/reload-services-container.sh',
  'scripts/hetzner/github-actions-deploy.sh',
  'scripts/hetzner/nginx/fishing-assistant.conf',
  'scripts/hetzner/nginx/fishing-assistant.origin-http.conf',
  'scripts/observability/fa-alloy.service',
  'scripts/observability/install-alloy.sh',
  'scripts/dev-host/caddy/fishing-assistant-observability.Caddyfile',
  'scripts/dev-host/fa-alert-router.service',
  'scripts/hetzner/fa-alert-router.service',
  'scripts/hetzner/install-observability.sh',
  'scripts/smoke/auth0-authorize-preflight.mjs',
  'scripts/smoke/e2e-dev.mjs',
  'scripts/ops/export-firestore-backup.sh',
  'docker/prod/Dockerfile',
  'terraform/gcp-data-plane/main.tf',
  'terraform/gcp-data-plane/versions.tf',
  'terraform/hetzner-prod/cloud-init.yaml.tftpl',
  'terraform/hetzner-prod/hetzner.tf',
  'terraform/hetzner-prod/versions.tf',
  'terraform/hetzner-prod/cloud-init.yaml.tftpl',
  '.github/workflows/deploy.yml',
  'docs/operations/fa-mvp-runbook.md',
  'docs/operations/fa-observability-runbook.md',
];

const requiredProdSudoWrappers = [
  '/usr/local/sbin/fa-load-secrets',
  '/usr/local/sbin/fa-deploy-nginx',
  '/usr/local/sbin/fa-load-observability-env',
  '/usr/local/sbin/fa-install-observability',
];
const cloudflareDnsApiTokenName = 'FA_CLOUDFLARE_DNS_API_TOKEN';
const browserSafeAuth0RuntimeConfigNames = [
  'FA_AUTH0_DOMAIN',
  'FA_AUTH0_CLIENT_ID',
  'FA_AUTH0_AUDIENCE',
];
const devOpenRouterSecretName = 'FA_DEV_OPENROUTER_APP_API_KEY';
const prodOpenRouterSecretName = 'FA_PROD_OPENROUTER_APP_API_KEY';
const runtimeOpenRouterEnvName = 'FA_OPENROUTER_APP_API_KEY';
const devMiniMaxSecretName = 'FA_DEV_MINIMAX_APP_API_KEY';
const prodMiniMaxSecretName = 'FA_PROD_MINIMAX_APP_API_KEY';
const runtimeMiniMaxEnvName = 'FA_MINIMAX_APP_API_KEY';
const cloudflareRuntimeForbiddenFiles = [
  {
    path: '.env.example',
    message: `${cloudflareDnsApiTokenName}; DNS token is provisioning-only`,
    verb: 'define',
  },
  {
    path: '.env.prod.example',
    message: `${cloudflareDnsApiTokenName}; DNS token is provisioning-only`,
    verb: 'define',
  },
  {
    path: 'scripts/hetzner/load-secrets.sh',
    message: `${cloudflareDnsApiTokenName} in runtime env generation`,
    verb: 'include',
  },
  {
    path: 'scripts/hetzner/reload-services-container.sh',
    message: `${cloudflareDnsApiTokenName} to runtime containers`,
    verb: 'expose',
  },
  {
    path: 'ecosystem.config.prod.cjs',
    message: `${cloudflareDnsApiTokenName} to production PM2 env`,
    verb: 'expose',
  },
  {
    path: 'docker/prod/Dockerfile',
    message: `${cloudflareDnsApiTokenName} to production image env`,
    verb: 'expose',
  },
  {
    path: 'apps/web/src/config.generated.ts',
    message: `${cloudflareDnsApiTokenName} to browser/runtime config`,
    verb: 'expose',
  },
  {
    path: 'ecosystem.generated.cjs',
    message: `${cloudflareDnsApiTokenName} to generated runtime config`,
    verb: 'expose',
  },
  {
    path: 'terraform/hetzner-prod/service-urls.auto.tfvars.json',
    message: `${cloudflareDnsApiTokenName} to Terraform runtime wiring`,
    verb: 'expose',
  },
];
const adminCredentialForbiddenFiles = [
  '.env.prod.example',
  'ecosystem.config.prod.cjs',
  'docker/prod/Dockerfile',
  'apps/web/src/config.generated.ts',
  'ecosystem.generated.cjs',
  'terraform/hetzner-prod/service-urls.auto.tfvars.json',
];
const expectedGcpServiceAccounts = ['fa-admin', 'fa-hetzner-provisioner', 'fa-hetzner-runtime'];
const expectedGcpServiceAccountSet = new Set(expectedGcpServiceAccounts);
const serviceAccountPatterns = {
  runtime: [
    'google_service_account.hetzner_runtime.email',
    'google_service_account.hetzner_runtime.member',
    'fa-hetzner-runtime',
  ],
  provisioner: [
    'google_service_account.hetzner_provisioner.email',
    'google_service_account.hetzner_provisioner.member',
    'fa-hetzner-provisioner',
  ],
};
const exactForbiddenIamRoles = new Set([
  'roles/owner',
  'roles/editor',
  'roles/iam.serviceAccountKeyAdmin',
  'roles/iam.serviceAccountAdmin',
]);
const runtimeFirestoreRoles = new Set(['roles/datastore.user']);
const provisionerFirestoreRoles = new Set(['roles/datastore.user', 'roles/datastore.owner']);
const allowedProvisionerBackupBucketRole = 'roles/storage.objectAdmin';
const credentialMatrixDocs = [
  {
    path: 'docs/operations/fa-mvp-runbook.md',
    message: 'must document the admin/provisioner/runtime credential matrix and operator checklist',
  },
];
const terraformGcpDataPlaneRoot = 'terraform/gcp-data-plane';

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasHomeDirectoryPath(source) {
  return /\/home\/[^/\s"'`]+/.test(source);
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasSystemdVariableExecutable(source) {
  return /^ExecStart=\s*\$/m.test(source);
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasStrictObservabilityEnvMode(source) {
  if (!source.includes('/etc/fa/observability.env')) {
    return false;
  }

  return (
    /chmod\s+0?6[04]0\s+\/etc\/fa\/observability\.env/.test(source) ||
    /install\b[^\n]*\s-m\s+0?6[04]0[^\n]*\/etc\/fa\/observability\.env/.test(source)
  );
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function extractWorkflowStepBlocks(source) {
  /** @type {string[]} */
  const blocks = [];
  /** @type {string[]} */
  let currentBlock = [];

  for (const line of source.split(/\r?\n/)) {
    if (/^\s{6}-\s/.test(line)) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
      }
      currentBlock = [line];
      continue;
    }

    if (currentBlock.length > 0) {
      currentBlock.push(line);
    }
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join('\n'));
  }

  return blocks;
}

/**
 * @param {string} block
 * @returns {string}
 */
function stripCommentLines(block) {
  return block
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExpLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} source
 * @returns {string}
 */
function stripTerraformCommentLines(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('#') && !trimmed.startsWith('//');
    })
    .join('\n');
}

/**
 * @param {string} source
 * @returns {{ type: string, name: string, body: string, block: string }[]}
 */
function extractTerraformResourceBlocks(source) {
  // Supported static Terraform style: literal role/account_id attributes and direct resource references.
  const executableSource = stripTerraformCommentLines(source);
  const resources = [];
  const resourcePattern = /resource\s+"(?<type>[^"]+)"\s+"(?<name>[^"]+)"\s*\{/g;
  let match = resourcePattern.exec(executableSource);

  while (match !== null) {
    const start = match.index;
    const bodyStart = resourcePattern.lastIndex;
    let depth = 1;
    let cursor = bodyStart;

    while (cursor < executableSource.length && depth > 0) {
      const character = executableSource[cursor];
      if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
      }
      cursor += 1;
    }

    const block = executableSource.slice(start, cursor);
    resources.push({
      type: match.groups?.['type'] ?? '',
      name: match.groups?.['name'] ?? '',
      body: executableSource.slice(bodyStart, cursor - 1),
      block,
    });

    resourcePattern.lastIndex = cursor;
    match = resourcePattern.exec(executableSource);
  }

  return resources;
}

/**
 * @param {string} root
 * @returns {string | undefined}
 */
function readTerraformGcpDataPlaneRoot(root) {
  const terraformFiles = listFiles(root, (relativePath) =>
    /^terraform\/gcp-data-plane\/[^/]+\.tf$/.test(relativePath)
  ).sort();

  if (terraformFiles.length === 0) {
    return undefined;
  }

  return terraformFiles
    .map(
      (relativePath) => `\n# ${relativePath}\n${readFileSync(resolve(root, relativePath), 'utf8')}`
    )
    .join('\n');
}

/**
 * @param {string} block
 * @param {string} attribute
 * @returns {string | undefined}
 */
function extractTerraformStringAttribute(block, attribute) {
  const attributePattern = new RegExp(
    `\\b${escapeRegExpLiteral(attribute)}\\s*=\\s*"(?<value>[^"]+)"`
  );
  return attributePattern.exec(block)?.groups?.['value'];
}

/**
 * @param {string} resourceType
 * @returns {boolean}
 */
function isTerraformIamResource(resourceType) {
  return /^google_(?:project|secret_manager_secret|storage_bucket|service_account)_iam_(?:member|binding)$/.test(
    resourceType
  );
}

/**
 * @param {string} source
 * @param {'runtime' | 'provisioner'} identity
 * @returns {boolean}
 */
function terraformBlockReferencesIdentity(source, identity) {
  return serviceAccountPatterns[identity].some((pattern) => source.includes(pattern));
}

/**
 * @param {string} role
 * @returns {boolean}
 */
function isBroadProjectAdminRole(role) {
  return /roles\/[^"'\s]*admin/i.test(role);
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasAdminCredentialReference(source) {
  const executableSource = stripCommentLines(source);
  if (
    containsIdentifier(executableSource, 'FA_GCP_ADMIN_KEY_FILE') ||
    executableSource.includes('fa-admin-key.json')
  ) {
    return true;
  }

  return executableSource
    .split(/\r?\n/)
    .some(
      (line) =>
        /\bGOOGLE_APPLICATION_CREDENTIALS\b/.test(line) &&
        /(?:admin|FA_GCP_ADMIN_KEY_FILE|fa-admin-key\.json)/i.test(line)
    );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function secretManagerReadsRequireProvisionerKey(source) {
  const executableSource = stripCommentLines(source);
  if (!/\bgcloud\s+secrets\s+versions\s+access\b/.test(executableSource)) {
    return true;
  }

  return analyzeSecretManagerCredentialOrder(executableSource);
}

/**
 * @param {string} source
 * @returns {{ topLevelLines: string[], functions: Map<string, string[]> }}
 */
function splitShellFunctions(source) {
  const topLevelLines = [];
  const functions = new Map();
  const lines = source.split(/\r?\n/);
  /** @type {{ name: string, lines: string[] } | undefined} */
  let currentFunction;

  for (const line of lines) {
    const functionStart = /^\s*(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{\s*$/.exec(line);
    if (currentFunction === undefined && functionStart?.groups?.['name'] !== undefined) {
      currentFunction = { name: functionStart.groups['name'], lines: [] };
      continue;
    }

    if (currentFunction !== undefined) {
      if (/^\s*}\s*$/.test(line)) {
        functions.set(currentFunction.name, currentFunction.lines);
        currentFunction = undefined;
      } else {
        currentFunction.lines.push(line);
      }
      continue;
    }

    topLevelLines.push(line);
  }

  return { topLevelLines, functions };
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function lineHasOptionalProvisionerKeyFallback(line) {
  return /\bif\s+\[\[\s+-r\s+["']?\$\{?FA_HETZNER_PROVISIONER_KEY_FILE/.test(line);
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function lineHasHardProvisionerKeyCheck(line) {
  return (
    /\[\[\s+-r\s+["']?\$\{?FA_HETZNER_PROVISIONER_KEY_FILE/.test(line) &&
    !lineHasOptionalProvisionerKeyFallback(line)
  );
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function lineExportsProvisionerKey(line) {
  return /\bexport\s+CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE\s*=/.test(line);
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function lineResetsProvisionerKeyCredential(line) {
  return (
    /\bunset\s+CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE\b/.test(line) ||
    /\bCLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE\s*=\s*(?:""|''|$)/.test(line)
  );
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function lineReadsSecretManager(line) {
  return /\bgcloud\s+secrets\s+versions\s+access\b/.test(line);
}

/**
 * @param {string} line
 * @param {string} functionName
 * @returns {boolean}
 */
function lineCallsFunction(line, functionName) {
  return new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExpLiteral(functionName)}(?=\\s|["'$);&|])`).test(
    line
  );
}

/**
 * @param {string[]} lines
 * @param {Map<string, boolean>} functionRequiresReady
 * @param {boolean} canUseCallerReady
 * @returns {{ invalid: boolean, requiresReady: boolean }}
 */
function analyzeSecretManagerCredentialLines(lines, functionRequiresReady, canUseCallerReady) {
  let sawHardCheck = false;
  let credentialsReady = false;
  let callerReadyStillValid = canUseCallerReady;
  let requiresReady = false;

  for (const line of lines) {
    if (lineHasOptionalProvisionerKeyFallback(line)) {
      return { invalid: true, requiresReady };
    }

    if (lineResetsProvisionerKeyCredential(line)) {
      credentialsReady = false;
      callerReadyStillValid = false;
      sawHardCheck = false;
    }

    if (lineHasHardProvisionerKeyCheck(line)) {
      sawHardCheck = true;
    }

    if (lineExportsProvisionerKey(line) && sawHardCheck) {
      credentialsReady = true;
      callerReadyStillValid = false;
    }

    const callsCredentialReader = [...functionRequiresReady.entries()].some(
      ([functionName, needed]) => needed && lineCallsFunction(line, functionName)
    );

    if (!lineReadsSecretManager(line) && !callsCredentialReader) {
      continue;
    }

    if (credentialsReady) {
      continue;
    }

    if (callerReadyStillValid) {
      requiresReady = true;
    } else {
      return { invalid: true, requiresReady };
    }
  }

  return { invalid: false, requiresReady };
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function analyzeSecretManagerCredentialOrder(source) {
  const { topLevelLines, functions } = splitShellFunctions(source);
  const functionRequiresReady = new Map([...functions.keys()].map((name) => [name, false]));

  for (let pass = 0; pass < functions.size + 1; pass += 1) {
    let changed = false;

    for (const [functionName, lines] of functions.entries()) {
      const result = analyzeSecretManagerCredentialLines(lines, functionRequiresReady, true);
      if (result.invalid) {
        return false;
      }

      if (functionRequiresReady.get(functionName) !== result.requiresReady) {
        functionRequiresReady.set(functionName, result.requiresReady);
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return !analyzeSecretManagerCredentialLines(topLevelLines, functionRequiresReady, false).invalid;
}

/**
 * @param {string} source
 * @param {string} identifier
 * @returns {boolean}
 */
function containsIdentifier(source, identifier) {
  const escapedIdentifier = escapeRegExpLiteral(identifier);
  return new RegExp(`(^|[^A-Z0-9_])${escapedIdentifier}([^A-Z0-9_]|$)`).test(source);
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function referencesCloudflareDnsApiToken(source) {
  return containsIdentifier(stripCommentLines(source), cloudflareDnsApiTokenName);
}

/**
 * @param {string} source
 * @param {string} arrayName
 * @param {string} item
 * @returns {boolean}
 */
function shellArrayIncludes(source, arrayName, item) {
  const executableSource = stripCommentLines(source);
  const arrayPattern = new RegExp(
    `\\b${escapeRegExpLiteral(arrayName)}\\s*=\\s*\\(([\\s\\S]*?)\\)`,
    'g'
  );
  let match = arrayPattern.exec(executableSource);

  while (match !== null) {
    if (containsIdentifier(match[1] ?? '', item)) {
      return true;
    }
    match = arrayPattern.exec(executableSource);
  }

  return false;
}

/**
 * @param {string} source
 * @param {string} localName
 * @param {string} item
 * @returns {boolean}
 */
function terraformLocalListIncludes(source, localName, item) {
  const executableSource = stripTerraformCommentLines(source);
  const escapedLocalName = escapeRegExpLiteral(localName);
  const listPatterns = [
    new RegExp(`\\b${escapedLocalName}\\s*=\\s*toset\\s*\\(\\s*\\[([\\s\\S]*?)\\]\\s*\\)`, 'g'),
    new RegExp(`\\b${escapedLocalName}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'g'),
  ];

  for (const listPattern of listPatterns) {
    let match = listPattern.exec(executableSource);
    while (match !== null) {
      if (containsIdentifier(match[1] ?? '', item)) {
        return true;
      }
      match = listPattern.exec(executableSource);
    }
  }

  return false;
}

/**
 * @param {string} block
 * @returns {boolean}
 */
function hasProdWorkflowConditionWithUnmergedRefOverride(block) {
  return (
    /if:\s*\$\{\{[\s\S]*inputs\.environment\s*==\s*['"]prod['"][\s\S]*\}\}/.test(block) &&
    /inputs\.allow_unmerged_prod_ref\s*!=\s*true/.test(block)
  );
}

/**
 * @param {string} block
 * @returns {boolean}
 */
function isProdDeployStep(block) {
  return /name:\s*Deploy PROD to Hetzner\b/.test(block) || /github-actions-deploy\.sh/.test(block);
}

/**
 * @param {string} block
 * @returns {boolean}
 */
function hasFailingMainAncestryRunBlock(block) {
  const executableBlock = stripCommentLines(block);

  return (
    /\brun:\s*\|/.test(executableBlock) &&
    /\bdeploy_sha\s*=\s*"\$\(git\s+rev-parse\s+HEAD\)"/.test(executableBlock) &&
    /\bgit\s+fetch\b[^\n]*(?:refs\/heads\/main|origin\s+main)/.test(executableBlock) &&
    /\bmain_sha\s*=\s*"\$\(git\s+rev-parse\b[^\n]*(?:refs\/remotes\/origin\/main|origin\/main)[^)]*\)"/.test(
      executableBlock
    ) &&
    /\bif\s+!\s+git\s+merge-base\s+--is-ancestor\s+"\$deploy_sha"\s+"\$main_sha";\s*then\b/.test(
      executableBlock
    ) &&
    /\bexit\s+1\b/.test(executableBlock)
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasProdMainAncestryCheck(source) {
  const stepBlocks = extractWorkflowStepBlocks(source);
  const prodDeployStepIndex = stepBlocks.findIndex(isProdDeployStep);

  if (prodDeployStepIndex <= 0) {
    return false;
  }

  return stepBlocks
    .slice(0, prodDeployStepIndex)
    .some(
      (block) =>
        hasProdWorkflowConditionWithUnmergedRefOverride(block) &&
        hasFailingMainAncestryRunBlock(block)
    );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasUnmergedProdRefWorkflowInput(source) {
  const executableSource = stripCommentLines(source);
  return /allow_unmerged_prod_ref:\s*[\s\S]*?type:\s*boolean[\s\S]*?default:\s*false/.test(
    executableSource
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasProdHostKeyFingerprintWorkflowEnv(source) {
  const prodDeployStep = extractWorkflowStepBlocks(source).find(isProdDeployStep);
  if (prodDeployStep === undefined) {
    return false;
  }

  const executableBlock = stripCommentLines(prodDeployStep);
  return /FA_HETZNER_PROD_HOST_KEY_SHA256\s*:\s*\$\{\{\s*secrets\.FA_HETZNER_PROD_HOST_KEY_SHA256\s*\}\}/.test(
    executableBlock
  );
}

/**
 * @param {string} source
 * @param {string} configName
 * @returns {boolean}
 */
function hasProdPublicRuntimeWorkflowEnv(source, configName) {
  const prodDeployStep = extractWorkflowStepBlocks(source).find(isProdDeployStep);
  if (prodDeployStep === undefined) {
    return false;
  }

  const executableBlock = stripCommentLines(prodDeployStep);
  return new RegExp(
    `${escapeRegExpLiteral(configName)}\\s*:\\s*\\$\\{\\{\\s*vars\\.${escapeRegExpLiteral(configName)}\\s*\\}\\}`
  ).test(executableBlock);
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasBootstrapOriginWorkflowInput(source) {
  const executableSource = stripCommentLines(source);
  return /bootstrap_origin_http_only:\s*[\s\S]*?type:\s*boolean[\s\S]*?default:\s*false/.test(
    executableSource
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasBootstrapOriginWorkflowFlagWiring(source) {
  const prodDeployStep = extractWorkflowStepBlocks(source).find(isProdDeployStep);
  if (prodDeployStep === undefined) {
    return false;
  }

  const executableBlock = stripCommentLines(prodDeployStep);
  return (
    /inputs\.bootstrap_origin_http_only/.test(executableBlock) &&
    /--bootstrap-origin-http-only/.test(executableBlock) &&
    /==\s*["']?true["']?/.test(executableBlock)
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasDeployUserAuthorizedKey(source) {
  return (
    /name:\s*deploy/.test(source) &&
    /ssh_authorized_keys:\s*\n\s*-\s*\$\{deploy_ssh_public_key\}/.test(source)
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function passesDeploySshPublicKeyToCloudInit(source) {
  return /templatefile\([^)]*cloud-init\.yaml\.tftpl[^)]*\{[^}]*deploy_ssh_public_key\s*=\s*var\.deploy_ssh_public_key/s.test(
    source
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasHardCodedObservabilitySecret(source) {
  return /\bFA_(?:GRAFANA_LOKI_TOKEN|ALERT_ROUTER_(?:WEBHOOK_SECRET|GITHUB_TOKEN))\s*=/.test(
    source
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasAlloyInstallSteps(source) {
  return (
    source.includes('/etc/fa/alloy') &&
    source.includes('render-alloy-config.mjs') &&
    source.includes('/etc/systemd/system/fa-alloy.service') &&
    source.includes('systemctl daemon-reload') &&
    /systemctl\s+(?:enable\s+--now|enable\b[\s\S]*?(?:restart|start))\s+fa-alloy/.test(source)
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasAlloyDockerGroupAccess(source) {
  return source.includes('docker') && /\busermod\s+-aG\b[\s\S]*\balloy\b/.test(source);
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasAlertRouterInstallSteps(source) {
  return (
    source.includes('--with-alert-router') &&
    source.includes('/etc/systemd/system/fa-alert-router.service') &&
    /systemctl\s+(?:enable\s+--now|enable\b[\s\S]*?(?:restart|start))\s+fa-alert-router/.test(
      source
    )
  );
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function lineWritesKeyscanToKnownHosts(line) {
  return (
    /\bssh-keyscan\b/.test(line) &&
    /(?:>>|>)\s*(?:"[^"]*(?:KNOWN_HOSTS_FILE|known_hosts)[^"]*"|'[^']*(?:KNOWN_HOSTS_FILE|known_hosts)[^']*'|\$\{?KNOWN_HOSTS_FILE\}?|[^\n#]*known_hosts)/.test(
      line
    )
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasAlertRouterEntrypointGuard(source) {
  return (
    source.includes('--with-alert-router') &&
    (source.includes('-f "${REPO_ROOT}/scripts/observability/alert-router.mjs"') ||
      source.includes('-f "${repo_root}/scripts/observability/alert-router.mjs"') ||
      source.includes('-f scripts/observability/alert-router.mjs')) &&
    /\b(?:fail|exit\s+1)\b/.test(source)
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasSafeAlloyUser(source) {
  const userMatch = /^User=(?<user>[^\n]+)$/m.exec(source);
  if (userMatch === null) {
    return true;
  }

  const user = userMatch.groups?.['user']?.trim();
  if (user === 'root') {
    return true;
  }

  if (user !== 'alloy') {
    return false;
  }

  return (
    /^SupplementaryGroups=.*\bdocker\b.*\bsystemd-journal\b/m.test(source) ||
    /^SupplementaryGroups=.*\bsystemd-journal\b.*\bdocker\b/m.test(source)
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasFaAlloyExecStart(source) {
  return source.includes(
    'ExecStart=/usr/bin/alloy run --server.http.listen-addr=127.0.0.1:12346 /etc/fa/alloy/fa.alloy'
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasAlertRouterServiceWiring(source) {
  return (
    source.includes('Environment=FA_ALERT_ROUTER_BIND_HOST=127.0.0.1') &&
    source.includes('Environment=PORT=9002') &&
    source.includes('EnvironmentFile=-/etc/fa/observability.env') &&
    source.includes('/usr/bin/node') &&
    source.includes('scripts/observability/alert-router.mjs') &&
    source.includes('StandardOutput=journal') &&
    source.includes('StandardError=journal') &&
    source.includes('SyslogIdentifier=fa-alert-router')
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasHomeDevAlertRouterDeployRoot(source) {
  return (
    !/%h\/deploy\/fishing-assistant/.test(source) &&
    !/\/home\/[^/\s]+\/deploy\/fishing-assistant/.test(source) &&
    source.includes('FA_DEV_DEPLOY_ROOT') &&
    source.includes('/usr/bin/env bash -lc') &&
    source.includes('cd "${FA_DEV_DEPLOY_ROOT:?}"') &&
    source.includes('exec /usr/bin/node scripts/observability/alert-router.mjs')
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasAlertRouterServiceHardening(source) {
  return source.includes('NoNewPrivileges=true') && source.includes('PrivateTmp=true');
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasRawSshKeyscanKnownHostsWrite(source) {
  return stripCommentLines(source).split(/\r?\n/).some(lineWritesKeyscanToKnownHosts);
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateObservabilityDeploymentArtifacts(root) {
  /** @type {string[]} */
  const errors = [];

  const alloyService = readOptionalFile(root, 'scripts/observability/fa-alloy.service');
  if (alloyService !== undefined) {
    if (!alloyService.includes('EnvironmentFile=-/etc/fa/observability.env')) {
      errors.push(
        'scripts/observability/fa-alloy.service must use EnvironmentFile=-/etc/fa/observability.env'
      );
    }

    if (
      !alloyService.includes('/usr/bin/alloy run') ||
      !alloyService.includes('/etc/fa/alloy/fa.alloy')
    ) {
      errors.push(
        'scripts/observability/fa-alloy.service must run /usr/bin/alloy against /etc/fa/alloy/fa.alloy'
      );
    }

    if (!hasFaAlloyExecStart(alloyService)) {
      errors.push(
        'scripts/observability/fa-alloy.service must run Alloy with --server.http.listen-addr=127.0.0.1:12346 so it does not conflict with the host alloy.service'
      );
    }

    if (!hasSafeAlloyUser(alloyService)) {
      errors.push(
        'scripts/observability/fa-alloy.service must run as root for journal/docker access or use a dedicated alloy user'
      );
    }
  }

  const sharedInstall = readOptionalFile(root, 'scripts/observability/install-alloy.sh');
  if (sharedInstall !== undefined) {
    if (!hasAlloyInstallSteps(sharedInstall)) {
      errors.push(
        'scripts/observability/install-alloy.sh must create /etc/fa/alloy, render config, install the fa-alloy unit, reload systemd, and enable/restart fa-alloy'
      );
    }

    if (!hasAlloyDockerGroupAccess(sharedInstall)) {
      errors.push(
        'scripts/observability/install-alloy.sh must add the alloy user to the docker group before restarting fa-alloy'
      );
    }

    if (hasHardCodedObservabilitySecret(sharedInstall)) {
      errors.push(
        'scripts/observability/install-alloy.sh must not hard-code Grafana Loki tokens or alert-router secrets'
      );
    }

    if (!hasAlertRouterEntrypointGuard(sharedInstall)) {
      errors.push(
        'scripts/observability/install-alloy.sh must fail --with-alert-router when scripts/observability/alert-router.mjs is missing'
      );
    }
  }

  const devCaddy = readOptionalFile(
    root,
    'scripts/dev-host/caddy/fishing-assistant-observability.Caddyfile'
  );
  if (devCaddy !== undefined) {
    const hasHealthzRoute =
      /handle\s+\/healthz\s*\{[\s\S]*?respond\s+"ok(?:\\n)?"\s+200[\s\S]*?\}/.test(devCaddy);
    const hasAlertWebhookRoute =
      /handle\s+\/alerts\/grafana\s*\{[\s\S]*?reverse_proxy\s+127\.0\.0\.1:9002[\s\S]*?\}/.test(
        devCaddy
      );

    if (!hasHealthzRoute) {
      errors.push(
        'scripts/dev-host/caddy/fishing-assistant-observability.Caddyfile must respond ok on /healthz'
      );
    }

    if (!hasAlertWebhookRoute) {
      errors.push(
        'scripts/dev-host/caddy/fishing-assistant-observability.Caddyfile must proxy /alerts/grafana to 127.0.0.1:9002'
      );
    }
  }

  for (const relativePath of [
    'scripts/dev-host/fa-alert-router.service',
    'scripts/hetzner/fa-alert-router.service',
  ]) {
    const source = readOptionalFile(root, relativePath);
    if (source !== undefined) {
      if (!hasAlertRouterServiceWiring(source)) {
        errors.push(
          `${relativePath} must bind fa-alert-router to 127.0.0.1:9002, use /etc/fa/observability.env, and log to journald`
        );
      }

      if (relativePath.startsWith('scripts/dev-host/') && !/^User=fa-deploy$/m.test(source)) {
        errors.push(
          `${relativePath} must run as User=fa-deploy for DEV deploy ownership and env access`
        );
      }

      if (
        relativePath.startsWith('scripts/dev-host/') &&
        !hasHomeDevAlertRouterDeployRoot(source)
      ) {
        errors.push(
          `${relativePath} must use FA_DEV_DEPLOY_ROOT from /etc/fa/observability.env instead of checked-in home-directory deploy paths`
        );
      }

      if (
        (relativePath.startsWith('scripts/hetzner/') &&
          (!/^User=deploy$/m.test(source) || !/^Group=deploy$/m.test(source))) ||
        !hasAlertRouterServiceHardening(source)
      ) {
        errors.push(
          `${relativePath} must run fa-alert-router as an unprivileged user with basic systemd hardening`
        );
      }
    }
  }

  const prodInstall = readOptionalFile(root, 'scripts/hetzner/install-observability.sh');
  if (prodInstall !== undefined) {
    if (!hasAlloyInstallSteps(prodInstall)) {
      errors.push(
        'scripts/hetzner/install-observability.sh must create /etc/fa/alloy, render config, install the fa-alloy unit, reload systemd, and enable/restart fa-alloy'
      );
    }

    if (!hasAlloyDockerGroupAccess(prodInstall)) {
      errors.push(
        'scripts/hetzner/install-observability.sh must add the alloy user to the docker group before restarting fa-alloy'
      );
    }

    if (!hasAlertRouterInstallSteps(prodInstall)) {
      errors.push(
        'scripts/hetzner/install-observability.sh must install and enable fa-alert-router when --with-alert-router is passed'
      );
    }

    if (!hasAlertRouterEntrypointGuard(prodInstall)) {
      errors.push(
        'scripts/hetzner/install-observability.sh must fail --with-alert-router when scripts/observability/alert-router.mjs is missing'
      );
    }

    if (hasHardCodedObservabilitySecret(prodInstall)) {
      errors.push(
        'scripts/hetzner/install-observability.sh must not hard-code Grafana Loki tokens or alert-router secrets'
      );
    }
  }

  const runbook = readOptionalFile(root, 'docs/operations/fa-mvp-runbook.md');
  if (
    runbook !== undefined &&
    (!runbook.includes('scripts/dev-host/caddy/fishing-assistant-observability.Caddyfile') ||
      !/host-level\s+FA\s+Caddy\s+site/i.test(runbook))
  ) {
    errors.push(
      'docs/operations/fa-mvp-runbook.md must explain copying the DEV observability Caddy snippet into the host-level Caddy site'
    );
  }

  const prodProvision = readOptionalFile(root, 'scripts/hetzner/provision.sh');
  if (prodProvision !== undefined && !hasStrictObservabilityEnvMode(prodProvision)) {
    errors.push(
      'scripts/hetzner/provision.sh must create /etc/fa/observability.env with mode 0640 or stricter'
    );
  }

  const cloudInit = readOptionalFile(root, 'terraform/hetzner-prod/cloud-init.yaml.tftpl');
  if (cloudInit !== undefined && !hasStrictObservabilityEnvMode(cloudInit)) {
    errors.push(
      'terraform/hetzner-prod/cloud-init.yaml.tftpl must create /etc/fa/observability.env with mode 0640 or stricter'
    );
  }

  if (cloudInit !== undefined && !hasDeployUserAuthorizedKey(cloudInit)) {
    errors.push(
      'terraform/hetzner-prod/cloud-init.yaml.tftpl must install deploy_ssh_public_key for the deploy user'
    );
  }

  const hetznerTerraform = readOptionalFile(root, 'terraform/hetzner-prod/hetzner.tf');
  if (hetznerTerraform !== undefined && !passesDeploySshPublicKeyToCloudInit(hetznerTerraform)) {
    errors.push(
      'terraform/hetzner-prod/hetzner.tf must pass var.deploy_ssh_public_key into the cloud-init template'
    );
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateProdSshHostTrust(root) {
  const errors = [];
  const deployScriptPath = 'scripts/hetzner/github-actions-deploy.sh';
  const deployScript = readOptionalFile(root, deployScriptPath);

  if (deployScript !== undefined) {
    const executableScript = stripCommentLines(deployScript);

    if (!executableScript.includes('FA_HETZNER_PROD_HOST_KEY_SHA256')) {
      errors.push(`${deployScriptPath} must require FA_HETZNER_PROD_HOST_KEY_SHA256`);
    }

    if (!/\brequire_command\s+ssh-keygen\b/.test(executableScript)) {
      errors.push(`${deployScriptPath} must require ssh-keygen before deploying`);
    }

    if (!/\bssh-keygen\s+-lf\s+-/.test(executableScript)) {
      errors.push(`${deployScriptPath} must validate ssh-keyscan output with ssh-keygen -lf -`);
    }

    if (hasRawSshKeyscanKnownHostsWrite(executableScript)) {
      errors.push(`${deployScriptPath} must not append ssh-keyscan output directly to known_hosts`);
    }

    if (/\bStrictHostKeyChecking\s*=\s*(?:no|accept-new)\b/i.test(executableScript)) {
      errors.push(`${deployScriptPath} must not disable StrictHostKeyChecking or use accept-new`);
    }

    if (
      !/\bStrictHostKeyChecking\s*=\s*yes\b/.test(executableScript) ||
      !/\bUserKnownHostsFile\s*=/.test(executableScript)
    ) {
      errors.push(
        `${deployScriptPath} must pin SSH and rsync to StrictHostKeyChecking=yes with UserKnownHostsFile`
      );
    }
  }

  const deployWorkflow = readOptionalFile(root, '.github/workflows/deploy.yml');
  if (deployWorkflow !== undefined && !hasProdHostKeyFingerprintWorkflowEnv(deployWorkflow)) {
    errors.push(
      '.github/workflows/deploy.yml must pass FA_HETZNER_PROD_HOST_KEY_SHA256 from GitHub secrets to the PROD deploy step'
    );
  }

  return errors;
}

/**
 * @param {string} source
 * @param {string} functionName
 * @returns {string}
 */
function extractShellFunctionBody(source, functionName) {
  const executableSource = stripCommentLines(source);
  const functionPattern = new RegExp(
    `\\b${escapeRegExpLiteral(functionName)}\\s*\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}`,
    'm'
  );
  return functionPattern.exec(executableSource)?.[1] ?? '';
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasBootstrapOriginScriptFlagSupport(source) {
  const executableSource = stripCommentLines(source);
  return (
    /(?:^|\n)\s*deploy_bootstrap_origin_http_only=false(?:\n|$)/.test(executableSource) &&
    !/deploy_bootstrap_origin_http_only="\$\{FA_DEPLOY_BOOTSTRAP_ORIGIN_HTTP_ONLY:-false\}"/.test(
      executableSource
    ) &&
    /--bootstrap-origin-http-only\)/.test(executableSource) &&
    /deploy_bootstrap_origin_http_only=true/.test(executableSource) &&
    /case\s+"\$\{deploy_bootstrap_origin_http_only\}"\s+in\s+true\|false\)/.test(executableSource)
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasLocalOriginHealthChecks(source) {
  const executableSource = stripCommentLines(source);
  const localOriginBody = extractShellFunctionBody(executableSource, 'verify_local_origin_health');
  const verifyDeploymentBody = extractShellFunctionBody(executableSource, 'verify_deployment');

  return (
    /\bverify_local_origin_health\b/.test(verifyDeploymentBody) &&
    /\bdeploy_bootstrap_origin_http_only\b/.test(localOriginBody) &&
    localOriginBody.includes('http://127.0.0.1/healthz') &&
    localOriginBody.includes('http://127.0.0.1/') &&
    localOriginBody.includes('http://127.0.0.1/index.html') &&
    localOriginBody.includes('http://127.0.0.1/api/chat/health') &&
    localOriginBody.includes('http://127.0.0.1/api/knowledge/health') &&
    localOriginBody.includes('http://127.0.0.1/api/llm-usage/health') &&
    localOriginBody.includes('http://127.0.0.1/api/users/health') &&
    localOriginBody.includes('assert_remote_https_origin_http_200 /healthz') &&
    localOriginBody.includes('verify_local_origin_public_entrypoints')
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasHttpsEdgeHealthChecks(source) {
  const executableSource = stripCommentLines(source);
  const edgeBody = extractShellFunctionBody(executableSource, 'verify_https_edge_health');

  return (
    edgeBody.includes('assert_https_edge_http_200 /healthz') &&
    edgeBody.includes('verify_https_edge_public_entrypoints')
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasLocalOriginHttp200Assertions(source) {
  const waitHttpHelperBody = extractShellFunctionBody(source, 'wait_for_remote_http_status');
  const waitHttpsOriginHelperBody = extractShellFunctionBody(
    source,
    'wait_for_remote_https_origin_http_status'
  );
  const httpHelperBody =
    waitHttpHelperBody.length > 0
      ? waitHttpHelperBody
      : extractShellFunctionBody(source, 'assert_remote_http_status');
  const httpsOriginHelperBody =
    waitHttpsOriginHelperBody.length > 0
      ? waitHttpsOriginHelperBody
      : extractShellFunctionBody(source, 'assert_remote_https_origin_http_status');

  return (
    httpHelperBody.includes('--write-out') &&
    httpHelperBody.includes('%{http_code}') &&
    httpHelperBody.includes('--output /dev/null') &&
    httpHelperBody.includes('${status}') &&
    httpHelperBody.includes('[[') &&
    httpHelperBody.includes('expected_status') &&
    httpsOriginHelperBody.includes('--write-out') &&
    httpsOriginHelperBody.includes('%{http_code}') &&
    httpsOriginHelperBody.includes('--output /dev/null') &&
    httpsOriginHelperBody.includes('--resolve') &&
    httpsOriginHelperBody.includes(':443:127.0.0.1') &&
    httpsOriginHelperBody.includes('https://${FA_PROD_DOMAIN}${path}') &&
    httpsOriginHelperBody.includes('${status}') &&
    httpsOriginHelperBody.includes('[[') &&
    httpsOriginHelperBody.includes('expected_status')
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasHttpsEdgeHttp200Assertions(source) {
  const waitHelperBody = extractShellFunctionBody(source, 'wait_for_https_edge_http_status');
  const helperBody =
    waitHelperBody.length > 0
      ? waitHelperBody
      : extractShellFunctionBody(source, 'assert_https_edge_http_status');

  return (
    helperBody.includes('--write-out') &&
    helperBody.includes('%{http_code}') &&
    helperBody.includes('--output /dev/null') &&
    helperBody.includes('--resolve') &&
    helperBody.includes(':443:') &&
    helperBody.includes('https://${FA_PROD_DOMAIN}${path}') &&
    helperBody.includes('${status}') &&
    helperBody.includes('[[') &&
    helperBody.includes('expected_status')
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasDeployNginxGatedHttpsEdgeHealth(source) {
  const verifyDeploymentBody = extractShellFunctionBody(source, 'verify_deployment');
  return (
    /\b(?:DEPLOY_NGINX|deploy_nginx)\b[\s\S]{0,250}\bverify_(?:https_)?edge_health\b/.test(
      verifyDeploymentBody
    ) ||
    /\bverify_(?:https_)?edge_health\b[\s\S]{0,250}\b(?:DEPLOY_NGINX|deploy_nginx)\b/.test(
      verifyDeploymentBody
    )
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasDefaultHttpsEdgeHealthWithBootstrapEscape(source) {
  const verifyDeploymentBody = extractShellFunctionBody(source, 'verify_deployment');
  return (
    /\bverify_service_health\b/.test(verifyDeploymentBody) &&
    /\bverify_local_origin_health\b/.test(verifyDeploymentBody) &&
    /\bdeploy_bootstrap_origin_http_only\b/.test(verifyDeploymentBody) &&
    /\bverify_https_edge_health\b/.test(verifyDeploymentBody) &&
    !hasDeployNginxGatedHttpsEdgeHealth(source)
  );
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateProdEdgeHealthChecks(root) {
  const errors = [];
  const deployScriptPath = 'scripts/hetzner/github-actions-deploy.sh';
  const deployWorkflowPath = '.github/workflows/deploy.yml';
  const deployScript = readOptionalFile(root, deployScriptPath);
  const deployWorkflow = readOptionalFile(root, deployWorkflowPath);

  if (deployWorkflow !== undefined) {
    if (!hasBootstrapOriginWorkflowInput(deployWorkflow)) {
      errors.push(
        `${deployWorkflowPath} must define bootstrap_origin_http_only workflow_dispatch input with default false`
      );
    }

    if (!hasBootstrapOriginWorkflowFlagWiring(deployWorkflow)) {
      errors.push(
        `${deployWorkflowPath} must pass --bootstrap-origin-http-only to the PROD deploy script only when bootstrap_origin_http_only is true`
      );
    }
  }

  if (deployScript !== undefined) {
    if (!hasBootstrapOriginScriptFlagSupport(deployScript)) {
      errors.push(
        `${deployScriptPath} must initialize deploy_bootstrap_origin_http_only=false and set it only from --bootstrap-origin-http-only`
      );
    }

    if (!hasLocalOriginHealthChecks(deployScript)) {
      errors.push(
        `${deployScriptPath} must run local origin health checks for /healthz and /api/{chat,knowledge,llm-usage,users}/health in every deployment`
      );
    }

    if (!hasLocalOriginHttp200Assertions(deployScript)) {
      errors.push(
        `${deployScriptPath} must assert HTTP 200 for local origin health checks instead of accepting curl --fail redirects`
      );
    }

    if (!hasHttpsEdgeHttp200Assertions(deployScript)) {
      errors.push(`${deployScriptPath} must assert HTTP 200 for HTTPS edge health checks`);
    }

    if (
      !hasHttpsEdgeHealthChecks(deployScript) ||
      !hasDefaultHttpsEdgeHealthWithBootstrapEscape(deployScript)
    ) {
      errors.push(
        `${deployScriptPath} must run HTTPS edge health checks by default; deploy_nginx may only control nginx publish/reload`
      );
    }
  }

  return errors;
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasBroadDeploySudoGrant(source) {
  return /\bNOPASSWD\s*:\s*ALL\b/.test(stripCommentLines(source));
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasRelativeSudoBashScriptCall(source) {
  return /\bsudo\s+(?:-[^\s]+\s+)*(?:(?:[A-Z][A-Z0-9_]*=[^\s]+\s+)*)bash\s+scripts\/hetzner\/[^/\s]+\.sh\b/.test(
    stripCommentLines(source)
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasAllRequiredProdSudoWrappers(source) {
  return requiredProdSudoWrappers.every((wrapperPath) => source.includes(wrapperPath));
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasProdSudoWrapperCanonicalization(source) {
  const executableSource = stripCommentLines(source);
  const hasCurrentPath =
    executableSource.includes('/opt/fishing-assistant/current') ||
    executableSource.includes('$APP_ROOT/current') ||
    executableSource.includes('${APP_ROOT}/current') ||
    executableSource.includes('$app_root/current') ||
    executableSource.includes('${app_root}/current');
  const hasReleasesPath =
    executableSource.includes('/opt/fishing-assistant/releases/') ||
    executableSource.includes('$APP_ROOT/releases/') ||
    executableSource.includes('${APP_ROOT}/releases/') ||
    executableSource.includes('$app_root/releases/') ||
    executableSource.includes('${app_root}/releases/');

  return (
    hasAllRequiredProdSudoWrappers(executableSource) &&
    /\brealpath\s+-e\b/.test(executableSource) &&
    executableSource.includes('/opt/fishing-assistant') &&
    hasCurrentPath &&
    hasReleasesPath
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasRootWrapperReleaseScriptExecution(source) {
  return /\b(?:exec\s+)?bash\s+scripts\/hetzner\/(?:load-secrets|deploy-nginx|install-nginx-and-cert)\.sh\b/.test(
    stripCommentLines(source)
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasProdNginxConfigCanonicalization(source) {
  const executableSource = stripCommentLines(source);

  return (
    /\brealpath\s+-e\s+["']?\$\{?(?:nginx_source|config_source|source_path)/.test(
      executableSource
    ) &&
    /\bdirname\s+["']?\$\{?real_(?:nginx_)?source/.test(executableSource) &&
    /\bbasename\s+["']?\$\{?real_(?:nginx_)?source/.test(executableSource) &&
    executableSource.includes('scripts/hetzner/nginx') &&
    executableSource.includes('fishing-assistant.conf') &&
    executableSource.includes('fishing-assistant.origin-http.conf')
  );
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateProdDeploySudoScope(root) {
  const errors = [];
  const provisionPath = 'scripts/hetzner/provision.sh';
  const cloudInitPath = 'terraform/hetzner-prod/cloud-init.yaml.tftpl';
  const deployScriptPath = 'scripts/hetzner/github-actions-deploy.sh';
  const provisionScript = readOptionalFile(root, provisionPath);
  const cloudInit = readOptionalFile(root, cloudInitPath);
  const deployScript = readOptionalFile(root, deployScriptPath);

  if (provisionScript !== undefined) {
    if (hasBroadDeploySudoGrant(provisionScript)) {
      errors.push(`${provisionPath} must not grant deploy user NOPASSWD:ALL`);
    }

    if (!hasAllRequiredProdSudoWrappers(provisionScript)) {
      errors.push(`${provisionPath} must install all required fixed sudo wrapper commands`);
    }

    if (!hasProdSudoWrapperCanonicalization(provisionScript)) {
      errors.push(
        `${provisionPath} must install sudo wrappers that canonicalize release paths with realpath -e`
      );
    }

    if (hasRootWrapperReleaseScriptExecution(provisionScript)) {
      errors.push(
        `${provisionPath} sudo wrappers must not execute deploy-owned scripts/hetzner/*.sh as root`
      );
    }

    if (!hasProdNginxConfigCanonicalization(provisionScript)) {
      errors.push(
        `${provisionPath} fa-deploy-nginx wrapper must canonicalize nginx config sources with realpath -e`
      );
    }
  }

  if (cloudInit !== undefined) {
    if (hasBroadDeploySudoGrant(cloudInit)) {
      errors.push(`${cloudInitPath} must not grant deploy user NOPASSWD:ALL`);
    }

    if (!hasAllRequiredProdSudoWrappers(cloudInit)) {
      errors.push(`${cloudInitPath} must install all required fixed sudo wrapper commands`);
    }

    if (!hasProdSudoWrapperCanonicalization(cloudInit)) {
      errors.push(
        `${cloudInitPath} must install sudo wrappers that canonicalize release paths with realpath -e`
      );
    }

    if (hasRootWrapperReleaseScriptExecution(cloudInit)) {
      errors.push(
        `${cloudInitPath} sudo wrappers must not execute deploy-owned scripts/hetzner/*.sh as root`
      );
    }

    if (!hasProdNginxConfigCanonicalization(cloudInit)) {
      errors.push(
        `${cloudInitPath} fa-deploy-nginx wrapper must canonicalize nginx config sources with realpath -e`
      );
    }
  }

  if (deployScript !== undefined) {
    if (hasRelativeSudoBashScriptCall(deployScript)) {
      errors.push(
        `${deployScriptPath} must use fixed sudo wrapper paths instead of relative sudo bash scripts`
      );
    }

    for (const wrapperPath of requiredProdSudoWrappers) {
      if (!stripCommentLines(deployScript).includes(wrapperPath)) {
        errors.push(`${deployScriptPath} must call ${wrapperPath}`);
      }
    }
  }

  return errors;
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasRuntimeSecretManagerAccess(source) {
  const executableSource = stripTerraformCommentLines(source);
  const resourceBlocks = executableSource.split(
    /\n(?=resource\s+"(?:google_secret_manager_secret_iam|google_project_iam)_(?:member|binding)"\s+")/
  );

  return resourceBlocks.some(
    (block) =>
      block.includes('roles/secretmanager.secretAccessor') &&
      block.includes('google_service_account.hetzner_runtime.email')
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasWritableRuntimeKeyDockerMount(source) {
  const runtimeKeyContainerPath = '/run/secrets/fa-runtime-sa-key.json';
  const executableSource = stripCommentLines(source);
  const volumePattern =
    /(?:^|\s)(?:-v|--volume)(?:=|\s+)(?:"(?<doubleQuoted>[^"\s]*:\/run\/secrets\/fa-runtime-sa-key\.json(?::[^"\s]*)?)"|'(?<singleQuoted>[^'\s]*:\/run\/secrets\/fa-runtime-sa-key\.json(?::[^'\s]*)?)'|(?<unquoted>[^\s"']*:\/run\/secrets\/fa-runtime-sa-key\.json(?::[^\s"']*)?))/g;

  for (const match of executableSource.matchAll(volumePattern)) {
    const spec =
      match.groups?.['doubleQuoted'] ??
      match.groups?.['singleQuoted'] ??
      match.groups?.['unquoted'];
    if (spec === undefined) {
      continue;
    }

    const options = spec.slice(
      spec.indexOf(runtimeKeyContainerPath) + runtimeKeyContainerPath.length
    );
    const optionParts = options.startsWith(':') ? options.slice(1).split(',') : [];
    if (!optionParts.includes('ro')) {
      return true;
    }
  }

  return false;
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function validateTerraformCredentialBoundaries(source) {
  const errors = [];
  const resourceBlocks = extractTerraformResourceBlocks(source);
  const serviceAccountIds = new Set(
    resourceBlocks
      .filter((resource) => resource.type === 'google_service_account')
      .map((resource) => extractTerraformStringAttribute(resource.block, 'account_id'))
      .filter((value) => typeof value === 'string')
  );

  if (resourceBlocks.some((resource) => resource.type === 'google_service_account_key')) {
    errors.push(
      `${terraformGcpDataPlaneRoot} must not manage service-account private keys with google_service_account_key`
    );
  }

  for (const accountId of expectedGcpServiceAccounts) {
    if (!serviceAccountIds.has(accountId)) {
      errors.push(`${terraformGcpDataPlaneRoot} must define service account ${accountId}`);
    }
  }

  for (const accountId of serviceAccountIds) {
    if (!expectedGcpServiceAccountSet.has(accountId)) {
      errors.push(
        `${terraformGcpDataPlaneRoot} must not define unexpected service account ${accountId}`
      );
    }
  }

  let runtimeHasFirestoreAccess = false;
  let provisionerRuntimeSecretAccess = false;
  let provisionerProvisioningSecretAccess = false;

  for (const resource of resourceBlocks) {
    if (!isTerraformIamResource(resource.type)) {
      continue;
    }

    const role = extractTerraformStringAttribute(resource.block, 'role');
    if (role === undefined) {
      continue;
    }

    const referencesRuntime = terraformBlockReferencesIdentity(resource.block, 'runtime');
    const referencesProvisioner = terraformBlockReferencesIdentity(resource.block, 'provisioner');
    const isProjectIam = resource.type.startsWith('google_project_iam_');

    if (referencesRuntime && runtimeFirestoreRoles.has(role)) {
      runtimeHasFirestoreAccess = true;
    }

    if (referencesRuntime && role === 'roles/secretmanager.secretAccessor') {
      errors.push(
        `${terraformGcpDataPlaneRoot} must not grant Secret Manager access to fa-hetzner-runtime`
      );
    }

    if (referencesRuntime && exactForbiddenIamRoles.has(role)) {
      errors.push(`${terraformGcpDataPlaneRoot} must not grant ${role} to fa-hetzner-runtime`);
    }

    if (referencesRuntime && isProjectIam && isBroadProjectAdminRole(role)) {
      errors.push(
        `${terraformGcpDataPlaneRoot} must not grant broad project admin role ${role} to fa-hetzner-runtime`
      );
    }

    if (referencesProvisioner && provisionerFirestoreRoles.has(role)) {
      errors.push(
        `${terraformGcpDataPlaneRoot} must not grant Firestore role ${role} to fa-hetzner-provisioner`
      );
    }

    if (referencesProvisioner && exactForbiddenIamRoles.has(role)) {
      errors.push(`${terraformGcpDataPlaneRoot} must not grant ${role} to fa-hetzner-provisioner`);
    }

    if (referencesProvisioner && isProjectIam && isBroadProjectAdminRole(role)) {
      errors.push(
        `${terraformGcpDataPlaneRoot} must not grant broad project admin role ${role} to fa-hetzner-provisioner`
      );
    }

    if (
      referencesProvisioner &&
      resource.type.startsWith('google_storage_bucket_iam_') &&
      !resource.block.includes('google_storage_bucket.firestore_backups')
    ) {
      errors.push(
        `${terraformGcpDataPlaneRoot} must scope fa-hetzner-provisioner storage bucket IAM grants to google_storage_bucket.firestore_backups`
      );
    }

    if (
      referencesProvisioner &&
      resource.type.startsWith('google_storage_bucket_iam_') &&
      resource.block.includes('google_storage_bucket.firestore_backups') &&
      role !== allowedProvisionerBackupBucketRole
    ) {
      errors.push(
        `${terraformGcpDataPlaneRoot} must grant fa-hetzner-provisioner backup bucket access with ${allowedProvisionerBackupBucketRole} only`
      );
    }

    if (referencesProvisioner && role === 'roles/secretmanager.secretAccessor' && isProjectIam) {
      errors.push(
        `${terraformGcpDataPlaneRoot} must scope fa-hetzner-provisioner Secret Manager access to explicit runtime and provisioning secrets, not project-level IAM`
      );
    }

    if (
      referencesProvisioner &&
      role === 'roles/secretmanager.secretAccessor' &&
      resource.type.startsWith('google_secret_manager_secret_iam_')
    ) {
      if (resource.block.includes('google_secret_manager_secret.runtime')) {
        provisionerRuntimeSecretAccess = true;
      } else if (resource.block.includes('google_secret_manager_secret.provisioning')) {
        provisionerProvisioningSecretAccess = true;
      } else {
        errors.push(
          `${terraformGcpDataPlaneRoot} must not grant fa-hetzner-provisioner Secret Manager access outside explicit runtime and provisioning secret resources`
        );
      }
    }
  }

  if (!runtimeHasFirestoreAccess) {
    errors.push(`${terraformGcpDataPlaneRoot} must grant Firestore access to fa-hetzner-runtime`);
  }

  if (!provisionerRuntimeSecretAccess || !provisionerProvisioningSecretAccess) {
    errors.push(
      `${terraformGcpDataPlaneRoot} must grant fa-hetzner-provisioner Secret Manager access to explicit runtime and provisioning secret resources`
    );
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateCredentialBlastRadius(root) {
  const errors = [];
  const terraformGcp = readTerraformGcpDataPlaneRoot(root);

  if (terraformGcp !== undefined) {
    errors.push(...validateTerraformCredentialBoundaries(terraformGcp));
  }

  const adminCredentialFiles = new Set([
    ...adminCredentialForbiddenFiles,
    ...listFiles(root, (path) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)),
    ...listFiles(root, (path) => /^scripts\/hetzner\/[^/]+\.sh$/.test(path)),
  ]);

  for (const relativePath of adminCredentialFiles) {
    const source = readOptionalFile(root, relativePath);
    if (source !== undefined && hasAdminCredentialReference(source)) {
      errors.push(`${relativePath} must not reference admin service-account credentials`);
    }
  }

  for (const relativePath of [
    ...listFiles(root, (path) => /^scripts\/hetzner\/[^/]+\.sh$/.test(path)),
    'terraform/hetzner-prod/cloud-init.yaml.tftpl',
  ]) {
    const source = readOptionalFile(root, relativePath);
    if (source !== undefined && !secretManagerReadsRequireProvisionerKey(source)) {
      errors.push(
        `${relativePath} Secret Manager reads must require FA_HETZNER_PROVISIONER_KEY_FILE and export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE before each read`
      );
    }
  }

  const reloadScriptPath = 'scripts/hetzner/reload-services-container.sh';
  const reloadScript = readOptionalFile(root, reloadScriptPath);
  if (reloadScript !== undefined && hasWritableRuntimeKeyDockerMount(reloadScript)) {
    errors.push(`${reloadScriptPath} must mount the runtime service-account key read-only`);
  }

  for (const { path, message } of credentialMatrixDocs) {
    const source = readOptionalFile(root, path);
    if (source === undefined || !hasCredentialMatrixDocumentation(source, path)) {
      errors.push(`${path} ${message}`);
    }
  }

  return errors;
}

/**
 * @param {string} source
 * @param {string} relativePath
 * @returns {boolean}
 */
function hasCredentialMatrixDocumentation(source, relativePath) {
  const lowerSource = source.toLowerCase();
  const requiredTerms = [
    'credential matrix',
    'fa-admin',
    'fa-hetzner-provisioner',
    'fa-hetzner-runtime',
    'purpose',
    'key location',
    'permissions',
    'ownership',
    'allowed roles',
    'forbidden',
    'out-of-band',
    'read-only',
    'rotation',
    'revoke',
  ];

  if (!requiredTerms.every((term) => lowerSource.includes(term))) {
    return false;
  }

  return (
    relativePath !== 'docs/operations/fa-mvp-runbook.md' ||
    (lowerSource.includes('operator-facing checklist') &&
      lowerSource.includes('production key installation'))
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function certProvisioningRequiresProvisionerKey(source) {
  return secretManagerReadsRequireProvisionerKey(source);
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateCloudflareDnsTokenScope(root) {
  const errors = [];
  const provisionPath = 'scripts/hetzner/provision.sh';
  const cloudInitPath = 'terraform/hetzner-prod/cloud-init.yaml.tftpl';
  const certProvisioningPath = 'scripts/hetzner/install-nginx-and-cert.sh';
  const terraformGcpPath = 'terraform/gcp-data-plane/main.tf';
  const provisionScript = readOptionalFile(root, provisionPath);
  const cloudInit = readOptionalFile(root, cloudInitPath);
  const certProvisioning = readOptionalFile(root, certProvisioningPath);
  const terraformGcp = readOptionalFile(root, terraformGcpPath);

  for (const { path, message, verb } of cloudflareRuntimeForbiddenFiles) {
    const source = readOptionalFile(root, path);
    if (source !== undefined && referencesCloudflareDnsApiToken(source)) {
      errors.push(`${path} must not ${verb} ${message}`);
    }
  }

  if (
    provisionScript !== undefined &&
    shellArrayIncludes(provisionScript, 'FA_RUNTIME_SECRETS', cloudflareDnsApiTokenName)
  ) {
    errors.push(
      `${provisionPath} fa-load-secrets wrapper must not include ${cloudflareDnsApiTokenName} in FA_RUNTIME_SECRETS`
    );
  }

  if (
    cloudInit !== undefined &&
    shellArrayIncludes(cloudInit, 'FA_RUNTIME_SECRETS', cloudflareDnsApiTokenName)
  ) {
    errors.push(
      `${cloudInitPath} fa-load-secrets wrapper must not include ${cloudflareDnsApiTokenName} in FA_RUNTIME_SECRETS`
    );
  }

  if (
    certProvisioning !== undefined &&
    referencesCloudflareDnsApiToken(certProvisioning) &&
    !certProvisioningRequiresProvisionerKey(certProvisioning)
  ) {
    errors.push(
      `${certProvisioningPath} must require the provisioner service-account key before reading ${cloudflareDnsApiTokenName}`
    );
  }

  if (terraformGcp !== undefined) {
    const dnsTokenInRuntimeSecrets =
      terraformLocalListIncludes(terraformGcp, 'runtime_secret_names', cloudflareDnsApiTokenName) ||
      terraformLocalListIncludes(terraformGcp, 'secret_names', cloudflareDnsApiTokenName);
    const dnsTokenInProvisioningSecrets = terraformLocalListIncludes(
      terraformGcp,
      'provisioning_secret_names',
      cloudflareDnsApiTokenName
    );

    if (
      dnsTokenInRuntimeSecrets ||
      (terraformGcp.includes(cloudflareDnsApiTokenName) && !dnsTokenInProvisioningSecrets)
    ) {
      errors.push(
        `${terraformGcpPath} must define ${cloudflareDnsApiTokenName} in provisioning_secret_names, not runtime secret_names`
      );
    }

    if (hasRuntimeSecretManagerAccess(terraformGcp)) {
      errors.push(`${terraformGcpPath} must not grant Secret Manager access to fa-hetzner-runtime`);
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateBrowserSafeAuth0SecretScope(root) {
  const errors = [];
  const loadSecretsPath = 'scripts/hetzner/load-secrets.sh';
  const provisionPath = 'scripts/hetzner/provision.sh';
  const cloudInitPath = 'terraform/hetzner-prod/cloud-init.yaml.tftpl';
  const terraformGcpPath = 'terraform/gcp-data-plane/main.tf';
  const deployScriptPath = 'scripts/hetzner/github-actions-deploy.sh';
  const deployWorkflowPath = '.github/workflows/deploy.yml';
  const loadSecrets = readOptionalFile(root, loadSecretsPath);
  const provisionScript = readOptionalFile(root, provisionPath);
  const cloudInit = readOptionalFile(root, cloudInitPath);
  const terraformGcp = readOptionalFile(root, terraformGcpPath);
  const deployScript = readOptionalFile(root, deployScriptPath);
  const deployWorkflow = readOptionalFile(root, deployWorkflowPath);

  for (const configName of browserSafeAuth0RuntimeConfigNames) {
    if (
      loadSecrets !== undefined &&
      shellArrayIncludes(loadSecrets, 'FA_RUNTIME_SECRETS', configName)
    ) {
      errors.push(
        `${loadSecretsPath} must not include browser-safe Auth0 runtime config in FA_RUNTIME_SECRETS: ${configName}`
      );
    }

    if (
      provisionScript !== undefined &&
      shellArrayIncludes(provisionScript, 'FA_RUNTIME_SECRETS', configName)
    ) {
      errors.push(
        `${provisionPath} fa-load-secrets wrapper must not include browser-safe Auth0 runtime config in FA_RUNTIME_SECRETS: ${configName}`
      );
    }

    if (
      cloudInit !== undefined &&
      shellArrayIncludes(cloudInit, 'FA_RUNTIME_SECRETS', configName)
    ) {
      errors.push(
        `${cloudInitPath} fa-load-secrets wrapper must not include browser-safe Auth0 runtime config in FA_RUNTIME_SECRETS: ${configName}`
      );
    }

    if (
      terraformGcp !== undefined &&
      (terraformLocalListIncludes(terraformGcp, 'runtime_secret_names', configName) ||
        terraformLocalListIncludes(terraformGcp, 'secret_names', configName))
    ) {
      errors.push(
        `${terraformGcpPath} must not define browser-safe Auth0 runtime config as Secret Manager runtime secrets: ${configName}`
      );
    }

    if (
      deployWorkflow !== undefined &&
      !hasProdPublicRuntimeWorkflowEnv(deployWorkflow, configName)
    ) {
      errors.push(
        `${deployWorkflowPath} must pass browser-safe ${configName} from GitHub vars to the PROD deploy step`
      );
    }
  }

  if (
    deployScript !== undefined &&
    (!deployScript.includes('--auth0-domain') ||
      !deployScript.includes('--auth0-client-id') ||
      !deployScript.includes('--auth0-audience') ||
      !deployScript.includes('FA_AUTH0_DOMAIN is required') ||
      !deployScript.includes('FA_AUTH0_CLIENT_ID is required') ||
      !deployScript.includes('FA_AUTH0_AUDIENCE is required'))
  ) {
    errors.push(
      `${deployScriptPath} must pass browser-safe Auth0 runtime config to fa-load-secrets through explicit wrapper arguments`
    );
  }

  if (
    deployScript !== undefined &&
    !deployScript.includes('scripts/smoke/auth0-authorize-preflight.mjs')
  ) {
    errors.push(`${deployScriptPath} must run Auth0 authorize preflight before PROD deployment`);
  }

  return errors;
}

/**
 * @param {string} source
 * @param {string} devSecretName
 * @param {string} runtimeEnvName
 * @returns {boolean}
 */
function hasLocalProviderSecretBinding(source, devSecretName, runtimeEnvName) {
  return new RegExp(
    `sourceName:\\s*['"]${escapeRegExpLiteral(devSecretName)}['"][\\s\\S]*?targetName:\\s*['"]${escapeRegExpLiteral(runtimeEnvName)}['"]`,
    'u'
  ).test(source);
}

/**
 * @param {string} source
 * @param {string} prodSecretName
 * @param {string} runtimeEnvName
 * @returns {boolean}
 */
function hasProdProviderSecretBinding(source, prodSecretName, runtimeEnvName) {
  return source.includes(`${prodSecretName}=${runtimeEnvName}`);
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateProviderSecretSourceScope(root) {
  const errors = [];
  const localPullPath = 'scripts/pull-local-env.mjs';
  const loadSecretsPath = 'scripts/hetzner/load-secrets.sh';
  const provisionPath = 'scripts/hetzner/provision.sh';
  const cloudInitPath = 'terraform/hetzner-prod/cloud-init.yaml.tftpl';
  const terraformGcpPath = 'terraform/gcp-data-plane/main.tf';
  const localPull = readOptionalFile(root, localPullPath);
  const loadSecrets = readOptionalFile(root, loadSecretsPath);
  const provisionScript = readOptionalFile(root, provisionPath);
  const cloudInit = readOptionalFile(root, cloudInitPath);
  const terraformGcp = readOptionalFile(root, terraformGcpPath);

  /** @type {Array<[string, string, string | undefined]>} */
  const prodSourceRenderers = [
    [loadSecretsPath, loadSecretsPath, loadSecrets],
    [provisionPath, `${provisionPath} fa-load-secrets wrapper`, provisionScript],
    [cloudInitPath, `${cloudInitPath} fa-load-secrets wrapper`, cloudInit],
  ];

  const providerSecretScopes = [
    {
      devSecretName: devOpenRouterSecretName,
      prodSecretName: prodOpenRouterSecretName,
      runtimeEnvName: runtimeOpenRouterEnvName,
    },
    {
      devSecretName: devMiniMaxSecretName,
      prodSecretName: prodMiniMaxSecretName,
      runtimeEnvName: runtimeMiniMaxEnvName,
    },
  ];

  for (const { devSecretName, prodSecretName, runtimeEnvName } of providerSecretScopes) {
    if (
      localPull !== undefined &&
      !hasLocalProviderSecretBinding(localPull, devSecretName, runtimeEnvName)
    ) {
      errors.push(`${localPullPath} must read ${devSecretName} into local ${runtimeEnvName}`);
    }

    for (const [, label, source] of prodSourceRenderers) {
      if (
        source !== undefined &&
        !hasProdProviderSecretBinding(source, prodSecretName, runtimeEnvName)
      ) {
        errors.push(`${label} must read ${prodSecretName} into runtime ${runtimeEnvName}`);
      }
    }

    if (
      terraformGcp !== undefined &&
      (!terraformLocalListIncludes(terraformGcp, 'runtime_secret_names', devSecretName) ||
        !terraformLocalListIncludes(terraformGcp, 'runtime_secret_names', prodSecretName))
    ) {
      errors.push(
        `${terraformGcpPath} must define ${devSecretName} and ${prodSecretName} as runtime Secret Manager secrets`
      );
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateDeploymentArtifacts(root) {
  /** @type {string[]} */
  const errors = [];

  for (const relativePath of requiredDeploymentArtifacts) {
    if (!existsSync(resolve(root, relativePath))) {
      errors.push(`Missing deployment artifact: ${relativePath}`);
    }
  }

  const reloadScript = readOptionalFile(root, 'scripts/hetzner/reload-services-container.sh');
  if (
    reloadScript !== undefined &&
    /(^|\s)-p\s+(?!127\.0\.0\.1:)\d{2,5}:\d{2,5}/.test(reloadScript)
  ) {
    errors.push(
      'scripts/hetzner/reload-services-container.sh must publish service ports on 127.0.0.1 only'
    );
  }

  const deployDevScript = readOptionalFile(root, 'scripts/deploy/deploy-dev.sh');
  if (
    deployDevScript !== undefined &&
    (!deployDevScript.includes('FA_PM2_HOME') ||
      hasHomeDirectoryPath(deployDevScript) ||
      !deployDevScript.includes('PM2_HOME="${FA_PM2_HOME}"'))
  ) {
    errors.push('scripts/deploy/deploy-dev.sh must run DEV PM2 with isolated FA_PM2_HOME');
  }
  if (
    deployDevScript !== undefined &&
    (!deployDevScript.includes('ensure_dev_env_files()') ||
      !deployDevScript.includes('.envrc') ||
      !deployDevScript.includes('.env.dev.local'))
  ) {
    errors.push('scripts/deploy/deploy-dev.sh must fail fast when DEV local env files are missing');
  }
  if (
    deployDevScript !== undefined &&
    !deployDevScript.includes('scripts/smoke/auth0-authorize-preflight.mjs')
  ) {
    errors.push(
      'scripts/deploy/deploy-dev.sh must run Auth0 authorize preflight during DEV deploy'
    );
  }
  if (deployDevScript !== undefined && !deployDevScript.includes('scripts/smoke/e2e-dev.mjs')) {
    errors.push(
      'scripts/deploy/deploy-dev.sh must run DEV public-origin smoke checks after reload'
    );
  }

  const devFaCaddy = readOptionalFile(root, 'scripts/dev-host/caddy/fishing-assistant.Caddyfile');
  if (devFaCaddy !== undefined) {
    if (
      /basic_auth\b/.test(devFaCaddy) ||
      /FA_SITE_BASIC_AUTH/.test(devFaCaddy) ||
      !/handle\s+\/\s*\{[\s\S]*?reverse_proxy\s+localhost:3100/.test(devFaCaddy)
    ) {
      errors.push(
        'scripts/dev-host/caddy/fishing-assistant.Caddyfile must serve the public homepage without an edge auth gate'
      );
    }

    if (
      !/handle_path\s+\/api\/users\/\*\s*\{[\s\S]*?reverse_proxy\s+localhost:3204/.test(devFaCaddy)
    ) {
      errors.push(
        'scripts/dev-host/caddy/fishing-assistant.Caddyfile must route /api/users to localhost:3204'
      );
    }
  }

  const webhookService = readOptionalFile(root, 'scripts/dev-host/webhook-handler.service');
  if (
    webhookService !== undefined &&
    (!webhookService.includes('Environment=FA_PM2_HOME=') ||
      !webhookService.includes('Environment=PM2_HOME=') ||
      !webhookService.includes('Environment=PATH=@PATH@') ||
      !webhookService.includes('ExecStart=/usr/bin/flock --no-fork --nonblock') ||
      webhookService.includes('%h') ||
      !webhookService.includes('webhook-handler.mjs') ||
      hasSystemdVariableExecutable(webhookService) ||
      hasHomeDirectoryPath(webhookService))
  ) {
    errors.push(
      'scripts/dev-host/webhook-handler.service must export portable FA PM2 and Node wiring'
    );
  }

  const faPm2Service = readOptionalFile(root, 'scripts/dev-host/fa-pm2.service');
  if (
    faPm2Service !== undefined &&
    (!faPm2Service.includes('Environment=PM2_HOME=') ||
      !faPm2Service.includes('fishing-assistant') ||
      hasHomeDirectoryPath(faPm2Service) ||
      /\bpm2\s+(?:stop|delete|restart|reload|logs)\s+all\b/.test(faPm2Service))
  ) {
    errors.push(
      'scripts/dev-host/fa-pm2.service must isolate FA PM2 without host-wide PM2 commands'
    );
  }

  const deployWorkflow = readOptionalFile(root, '.github/workflows/deploy.yml');
  if (deployWorkflow !== undefined) {
    if (!hasUnmergedProdRefWorkflowInput(deployWorkflow)) {
      errors.push(
        '.github/workflows/deploy.yml must define allow_unmerged_prod_ref workflow_dispatch input with default false'
      );
    }

    if (!hasProdMainAncestryCheck(deployWorkflow)) {
      errors.push(
        '.github/workflows/deploy.yml must require PROD deploy refs to be ancestors of origin/main unless allow_unmerged_prod_ref is explicitly true'
      );
    }
  }

  errors.push(...validateProdSshHostTrust(root));
  errors.push(...validateProdDeploySudoScope(root));
  errors.push(...validateProdEdgeHealthChecks(root));

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateStaticRepository(root = repoRoot) {
  const errors = [
    ...validateWorkspaceShape(root),
    ...validateWorkspacePackages(root),
    ...validateNoAppImportsApp(root),
    ...validateCommonCoreIsLeaf(root),
    ...validatePackageImportBoundaries(root),
    ...validateBackendSharedDependencies(root),
    ...validateKnowledgeDomainDoesNotImportLlmFactory(root),
    ...findForeignProductEnvReferences(root),
    ...findGenericProductEnvAliases(root),
    ...validateNoRawFetch(root),
    ...validateFirestoreCollections(root),
    ...validateDataBaselineStaticRequirements(root),
    ...validateKnowledgeAccessStaticRequirements(root),
    ...validatePublicRagEvidenceContract(root),
    ...validateServiceWiringCurrent(root),
    ...validateViteProxy(root),
    ...validateWebViteEnvironment(root),
    ...validateMigrationShape(root),
    ...validatePm2Scripts(root),
    ...validateCiPipeline(root),
    ...validateRuntimeRequestLogging(root),
    ...validateLlmUsageServiceRequirements(root),
    ...validatePromptVersions(root),
    ...validatePromptPersistence(root),
    ...validateDeploymentArtifacts(root),
    ...validateObservabilityDeploymentArtifacts(root),
    ...validateCloudflareDnsTokenScope(root),
    ...validateBrowserSafeAuth0SecretScope(root),
    ...validateProviderSecretSourceScope(root),
    ...validateCredentialBlastRadius(root),
  ];

  return errors;
}

/**
 * @param {string[]} argv
 * @returns {{ root: string }}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  let root = repoRoot;

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

    throw new Error(`Unknown argument: ${arg ?? ''}`);
  }

  return { root };
}

function main() {
  try {
    const { root } = parseArgs(process.argv);
    const errors = validateStaticRepository(root);

    if (errors.length > 0) {
      console.error('Static verification failed:');
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }

    console.log('Static repository checks verified.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Static verification failed: ${message}`);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main();
}

export {
  validateFirestoreCollections,
  validateBackendSharedDependencies,
  validateCommonCoreIsLeaf,
  validateNoAppImportsApp,
  validateNoRawFetch,
  validateDeploymentArtifacts,
  validatePackageImportBoundaries,
  validatePromptPersistence,
  validatePromptVersions,
  validateRuntimeRequestLogging,
  validateStaticRepository,
  validateViteProxy,
  validateWorkspaceShape,
  validateWorkspacePackages,
};
