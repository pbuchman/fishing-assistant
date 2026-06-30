#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const MAX_TEXT_FILE_BYTES = 1024 * 1024;

/** @type {ReadonlySet<string>} */
const SKIPPED_TRACKED_PATHS = new Set(['pnpm-lock.yaml']);

/** @type {ReadonlyArray<RegExp>} */
const SKIPPED_PATH_PATTERNS = [
  /(^|\/)__fixtures__\//,
  /(^|\/)fixtures?\//,
  /\.snap$/,
  /\.(?:gif|jpe?g|png|webp|ico|pdf|zip|gz|tgz|woff2?)$/,
];

/** @type {ReadonlyArray<{ name: string, pattern: RegExp }>} */
const LINE_PATTERNS = [
  {
    name: 'github-token',
    pattern: /\bgh[oprsu]_[A-Za-z0-9_]{36,}\b/g,
  },
  {
    name: 'openai-api-key',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g,
  },
  {
    name: 'google-api-key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    name: 'aws-access-key-id',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    name: 'service-account-private-key-field',
    pattern: /"private_key"\s*:\s*"-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
];

const PRIVATE_KEY_BLOCK = /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/;
const SECRET_ASSIGNMENT =
  /(?:^|[\s"'`{,(])['"]?([A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*)['"]?\s*(?:=|:)\s*(['"]?)([^'"\s,;#}]{32,})\2/gm;

const PLACEHOLDER_FRAGMENTS = [
  'changeme',
  'dummy',
  'example',
  'fake',
  'fixture',
  'placeholder',
  'replace-me',
  'replace-with',
  'sample',
  'test-secret',
  'test-token',
];

/** @returns {string[]} */
function trackedFiles() {
  const result = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });

  if (result.error) {
    throw new Error(`Unable to list tracked files: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error('Unable to list tracked files with git ls-files.');
  }

  return result.stdout.split('\0').filter(Boolean);
}

/** @param {string} path */
function shouldSkipPath(path) {
  return (
    SKIPPED_TRACKED_PATHS.has(path) || SKIPPED_PATH_PATTERNS.some((pattern) => pattern.test(path))
  );
}

/** @param {Buffer} buffer */
function isBinary(buffer) {
  return buffer.includes(0);
}

/** @param {string} value */
function isAllowedPlaceholder(value) {
  const normalized = value.toLowerCase();

  if (normalized.startsWith('$') || normalized.startsWith('${')) {
    return true;
  }

  if (/^<[^>]+>$/.test(value)) {
    return true;
  }

  if (/^(?:FA|GOOGLE|GCLOUD|CLOUDSDK|NODE|CI|PORT)_[A-Z0-9_]+$/.test(value)) {
    return true;
  }

  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(value)) {
    return true;
  }

  return PLACEHOLDER_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/** @param {string} text */
function linesWithNumbers(text) {
  return text.split(/\r?\n/).map((line, index) => ({ line, lineNumber: index + 1 }));
}

/** @param {string} line */
function lineHasPrivateKeyBlock(line) {
  return PRIVATE_KEY_BLOCK.test(line);
}

/**
 * @param {string} path
 * @param {number} lineNumber
 * @param {string} patternName
 */
function finding(path, lineNumber, patternName) {
  return { path, lineNumber, patternName };
}

/** @param {string} line */
function matchingLinePatterns(line) {
  /** @type {string[]} */
  const patternNames = [];

  for (const { name, pattern } of LINE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(line)) {
      patternNames.push(name);
    }
  }

  return patternNames;
}

/**
 * @param {string} path
 * @param {string} text
 */
function scanText(path, text) {
  /** @type {Array<{ path: string, lineNumber: number, patternName: string }>} */
  const findings = [];

  for (const { line, lineNumber } of linesWithNumbers(text)) {
    if (lineHasPrivateKeyBlock(line)) {
      findings.push(finding(path, lineNumber, 'private-key-block'));
    }

    for (const patternName of matchingLinePatterns(line)) {
      findings.push(finding(path, lineNumber, patternName));
    }

    SECRET_ASSIGNMENT.lastIndex = 0;
    for (const match of line.matchAll(SECRET_ASSIGNMENT)) {
      const value = match[3] ?? '';
      if (!isAllowedPlaceholder(value)) {
        findings.push(finding(path, lineNumber, 'long-secret-assignment'));
      }
    }
  }

  return findings;
}

/**
 * @param {string[]} files
 * @returns {{ findings: Array<{ path: string, lineNumber: number, patternName: string }>, scannedFiles: number }}
 */
function scanTrackedFiles(files) {
  /** @type {Array<{ path: string, lineNumber: number, patternName: string }>} */
  const findings = [];
  let scannedFiles = 0;

  for (const path of files) {
    if (shouldSkipPath(path)) {
      continue;
    }

    if (!existsSync(path)) {
      continue;
    }

    const buffer = readFileSync(path);

    if (buffer.length > MAX_TEXT_FILE_BYTES || isBinary(buffer)) {
      continue;
    }

    scannedFiles += 1;
    findings.push(...scanText(path, buffer.toString('utf8')));
  }

  return { findings, scannedFiles };
}

function main() {
  const { findings, scannedFiles } = scanTrackedFiles(trackedFiles());

  if (findings.length > 0) {
    process.stderr.write(
      'Secret scan found suspected secrets. Values are intentionally omitted.\n'
    );
    for (const { path, lineNumber, patternName } of findings) {
      process.stderr.write(`- ${path}:${String(lineNumber)} ${patternName}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(`Secret scan passed. Scanned ${String(scannedFiles)} tracked text files.\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { isAllowedPlaceholder, scanText, scanTrackedFiles, shouldSkipPath };
