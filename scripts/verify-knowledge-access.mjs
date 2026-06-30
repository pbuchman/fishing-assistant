#!/usr/bin/env node
/* eslint-disable no-console */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(modulePath), '..');

const accessRefreshPath = 'apps/knowledge-service/src/domain/usecases/accessRefresh.ts';
const knowledgeRoutesPath = 'apps/knowledge-service/src/routes/knowledgeRoutes.ts';
const knowledgeServerPath = 'apps/knowledge-service/src/server.ts';
const routeSchemasPath = 'packages/http-contracts/src/routeSchemas.ts';
const firestoreCollectionsPath = 'firestore-collections.json';

const forbiddenClientIdentityFields = [
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

const forbiddenPublicStatusFields = [
  'auditId',
  'chunkId',
  'failedJobs',
  'jobId',
  'mismatchCount',
  'openCritical',
  'pendingJobs',
  'recentFailures',
  'runningJobs',
  'staleChunkCount',
];
/** @type {[string, string][]} */
const requiredKnowledgeAccessLogEventProperties = [
  ['chunkMarkedStale', 'knowledge_access_chunk_marked_stale'],
  ['mismatchDetected', 'knowledge_access_mismatch_detected'],
  ['sourceUrlRejected', 'knowledge_source_url_rejected'],
  ['ragCandidateExcluded', 'knowledge_rag_candidate_excluded'],
];

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
 * @param {string} root
 * @param {string} relativePath
 * @returns {unknown | undefined}
 */
function readOptionalJson(root, relativePath) {
  const source = readOptionalFile(root, relativePath);
  return source === undefined ? undefined : JSON.parse(source);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
  const next = rest.slice(1).search(/\nexport\s+(?:const|function|class)\s+/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/**
 * @param {string} source
 * @param {string} startNeedle
 * @param {string | undefined} endNeedle
 * @returns {string}
 */
function sourceSlice(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  if (start === -1) {
    return '';
  }
  const end = endNeedle === undefined ? -1 : source.indexOf(endNeedle, start + startNeedle.length);
  return end === -1 ? source.slice(start) : source.slice(start, end);
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
 * @param {string} source
 * @returns {string[]}
 */
function createSuccessEnvelopeBodies(source) {
  return [...source.matchAll(/createSuccessEnvelope\s*\(\s*{(?<body>[\s\S]*?)}\s*\)/g)]
    .map((match) => match.groups?.['body'])
    .filter((body) => typeof body === 'string');
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function publicKnowledgeAccessReturnBodies(source) {
  return [
    ...source.matchAll(/return\s*{(?<body>[\s\S]*?knowledgeAccess[\s\S]*?)}/g),
    ...source.matchAll(
      /createSuccessEnvelope\s*\(\s*{(?<body>[\s\S]*?knowledgeAccess[\s\S]*?)}\s*\)/g
    ),
  ]
    .map((match) => match.groups?.['body'] ?? match[0])
    .filter((body) => typeof body === 'string');
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function publicStatusLeaksDetails(source) {
  const bodies = [
    ...createSuccessEnvelopeBodies(source),
    ...publicKnowledgeAccessReturnBodies(source),
  ];
  return bodies.some((body) => forbiddenPublicStatusFields.some((field) => body.includes(field)));
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function validateAccessRefreshGuard(source) {
  /** @type {string[]} */
  const errors = [];
  if (!source.includes('isKnowledgePageChunkRetrievalEligible')) {
    return [`${accessRefreshPath} must define isKnowledgePageChunkRetrievalEligible`];
  }
  const guardBody = stripComments(functionBody(source, 'isKnowledgePageChunkRetrievalEligible'));
  if (guardBody.length === 0) {
    return [`${accessRefreshPath} must define isKnowledgePageChunkRetrievalEligible`];
  }
  if (!/(?:chunk\.access|chunkAccess)\s*={2,3}\s*undefined|!\s*chunk\.access/.test(guardBody)) {
    errors.push(`${accessRefreshPath} must require active chunks to have access metadata`);
  }
  if (!/(?:chunk\.access\.gate|chunkGate)\s*={2,3}\s*['"]manual['"]/.test(guardBody)) {
    errors.push(`${accessRefreshPath} must reject manual chunk access`);
  }
  if (!/chunk\.accessSyncStatus\s*!={1,2}\s*['"]current['"]/.test(guardBody)) {
    errors.push(`${accessRefreshPath} must reject stale, failed, or invalid chunk access status`);
  }
  if (
    !/chunk\.accessRevision\s*!={1,2}\s*page\.access\.effective\.accessRevision/.test(guardBody)
  ) {
    errors.push(`${accessRefreshPath} must reject page/chunk access revision mismatches`);
  }
  if (
    !guardBody.includes('validateKnowledgeSourceUrl') ||
    !guardBody.includes('chunk.source.url')
  ) {
    errors.push(`${accessRefreshPath} must reject forbidden source URLs`);
  }
  if (!/page\.accessSyncStatus\s*!={1,2}\s*['"]current['"]/.test(guardBody)) {
    errors.push(`${accessRefreshPath} must reject pages whose access refresh is not current`);
  }
  return errors;
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function validateAccessRefreshRoutes(source) {
  /** @type {string[]} */
  const errors = [];
  const statusBlock = sourceSlice(
    source,
    "app.get('/admin/access-refresh/status'",
    "app.post('/admin/access-refresh/jobs/:jobId/retry'"
  );
  const retryBlock = sourceSlice(
    source,
    "app.post('/admin/access-refresh/jobs/:jobId/retry'",
    "app.post('/admin/categories'"
  );
  if (
    statusBlock.length === 0 ||
    !statusBlock.includes('preValidation') ||
    !statusBlock.includes('requireApprovedAdminAuth')
  ) {
    errors.push(
      `${knowledgeRoutesPath} admin access-refresh status route must require admin auth before schema validation`
    );
  }
  if (
    retryBlock.length === 0 ||
    !retryBlock.includes('preValidation') ||
    !retryBlock.includes('requireApprovedAdminAuth')
  ) {
    errors.push(
      `${knowledgeRoutesPath} admin access-refresh retry route must require admin auth before schema validation`
    );
  }
  return errors;
}

/**
 * @param {string} accessRefreshSource
 * @param {string} routesSource
 * @returns {string[]}
 */
function validateKnowledgeAccessLogEventProducers(accessRefreshSource, routesSource) {
  /** @type {string[]} */
  const errors = [];
  const declarationBlock = exportConstBlock(accessRefreshSource, 'accessRefreshLogEvents');
  const producerSource = `${accessRefreshSource.replace(declarationBlock, '')}\n${routesSource}`;
  for (const [propertyName, eventName] of requiredKnowledgeAccessLogEventProperties) {
    if (
      !producerSource.includes(`accessRefreshLogEvents.${propertyName}`) &&
      !producerSource.includes(eventName)
    ) {
      errors.push(`knowledge access observability must produce ${eventName}`);
    }
  }
  return errors;
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function validateAccessRefreshSchemas(source) {
  /** @type {string[]} */
  const errors = [];
  const paramsBlock = exportConstBlock(source, 'knowledgeAdminAccessRefreshJobParamsSchema');
  const retryBodyBlock = exportConstBlock(source, 'knowledgeAdminAccessRefreshRetryBodySchema');
  if (paramsBlock.length === 0 || !paramsBlock.includes('additionalProperties: false')) {
    errors.push(`${routeSchemasPath} access-refresh job params schema must reject extra fields`);
  }
  if (retryBodyBlock.length === 0 || !retryBodyBlock.includes('strictEmptyObjectSchema')) {
    errors.push(
      `${routeSchemasPath} access-refresh retry body schema must be a strict empty object`
    );
  }
  const combined = `${paramsBlock}\n${retryBodyBlock}`;
  for (const field of forbiddenClientIdentityFields) {
    if (combined.includes(field)) {
      errors.push(`${routeSchemasPath} access-refresh route schemas must not accept ${field}`);
    }
  }
  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateKnowledgeAccessRepository(root = repoRoot) {
  /** @type {string[]} */
  const errors = [];
  const packageJson = readOptionalJson(root, 'package.json');
  const packageScripts =
    isRecord(packageJson) && isRecord(packageJson['scripts']) ? packageJson['scripts'] : {};
  if (packageScripts['verify:knowledge-access'] !== 'node scripts/verify-knowledge-access.mjs') {
    errors.push('package.json scripts must define verify:knowledge-access');
  }

  const collectionsJson = readOptionalJson(root, firestoreCollectionsPath);
  const collections =
    isRecord(collectionsJson) && isRecord(collectionsJson['collections'])
      ? collectionsJson['collections']
      : {};
  for (const name of ['fa_knowledge_access_refresh_jobs', 'fa_knowledge_access_audits']) {
    const collection = collections[name];
    if (!isRecord(collection) || collection['owner'] !== 'knowledge-service') {
      errors.push(`${firestoreCollectionsPath} must register ${name} with owner knowledge-service`);
    }
  }

  const accessRefreshSource = readOptionalFile(root, accessRefreshPath);
  if (accessRefreshSource === undefined) {
    errors.push(`Missing ${accessRefreshPath}`);
  } else {
    errors.push(...validateAccessRefreshGuard(accessRefreshSource));
  }

  const routesSource = readOptionalFile(root, knowledgeRoutesPath);
  if (routesSource === undefined) {
    errors.push(`Missing ${knowledgeRoutesPath}`);
  } else {
    errors.push(...validateAccessRefreshRoutes(routesSource));
  }

  const routeSchemasSource = readOptionalFile(root, routeSchemasPath);
  if (routeSchemasSource === undefined) {
    errors.push(`Missing ${routeSchemasPath}`);
  } else {
    errors.push(...validateAccessRefreshSchemas(routeSchemasSource));
  }

  const publicStatusSource = `${readOptionalFile(root, knowledgeServerPath) ?? ''}\n${routesSource ?? ''}`;
  if (!publicStatusSource.includes('knowledgeAccess')) {
    errors.push(`${knowledgeServerPath} public status must expose only coarse knowledgeAccess`);
  }
  if (publicStatusLeaksDetails(publicStatusSource)) {
    errors.push(
      `${knowledgeServerPath} public knowledge access status must not expose detailed counts or IDs`
    );
  }

  const searchSource = `${accessRefreshSource ?? ''}\n${routesSource ?? ''}`;
  if (accessRefreshSource !== undefined && routesSource !== undefined) {
    errors.push(...validateKnowledgeAccessLogEventProducers(accessRefreshSource, routesSource));
  }
  if (/\b(?:retiredCitationFallback|citationFallback|fallbackCitations)\b/.test(searchSource)) {
    errors.push('retired citation fallback must remain absent');
  }

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
    const errors = validateKnowledgeAccessRepository(root);
    if (errors.length > 0) {
      console.error('Knowledge access verification failed:');
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }
    console.log('Knowledge access checks verified.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Knowledge access verification failed: ${message}`);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main();
}

export { validateKnowledgeAccessRepository };
