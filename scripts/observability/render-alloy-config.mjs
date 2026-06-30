#!/usr/bin/env node
/* eslint-disable no-console */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);
const templateDir = resolve(scriptDir, 'templates');
const supportedEnvironments = new Set(['dev', 'prod']);

/**
 * @typedef {{ environment?: string; host?: string; sha?: string; pm2LogDir?: string; output?: string; help?: boolean }} RenderArgs
 * @typedef {{ environment: string; host: string; sha: string; pm2LogDir: string }} NormalizedRenderOptions
 */

/**
 * @returns {string}
 */
function usage() {
  return [
    'Usage:',
    '  node scripts/observability/render-alloy-config.mjs --environment dev --host dev-host --pm2-log-dir "$FA_PM2_LOG_DIR" --output /tmp/fa-dev.alloy',
    '  node scripts/observability/render-alloy-config.mjs --environment prod --host hetzner-prod --sha <sha> --output /tmp/fa-prod.alloy',
  ].join('\n');
}

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  throw new Error(`${message}\n\n${usage()}`);
}

/**
 * @param {string[]} args
 * @param {number} index
 * @param {string} flag
 * @returns {string}
 */
function readRequiredValue(args, index, flag) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    fail(`${flag} requires a value`);
  }
  return value;
}

/**
 * @param {string[]} argv
 * @returns {RenderArgs}
 */
export function parseArgs(argv) {
  const args = argv.slice(2);
  /** @type {RenderArgs} */
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--environment') {
      parsed.environment = readRequiredValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--host') {
      parsed.host = readRequiredValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--sha') {
      parsed.sha = readRequiredValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--pm2-log-dir') {
      parsed.pm2LogDir = readRequiredValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--output') {
      parsed.output = readRequiredValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
      continue;
    }

    fail(`Unknown argument: ${arg ?? ''}`);
  }

  return parsed;
}

/**
 * @param {RenderArgs} options
 * @returns {NormalizedRenderOptions}
 */
function normalizeRenderOptions(options) {
  const environment = options.environment;
  const host = options.host;

  if (typeof environment !== 'string' || !supportedEnvironments.has(environment)) {
    fail('--environment must be dev or prod');
  }

  if (typeof host !== 'string' || host.length === 0) {
    fail('--host is required');
  }

  return {
    environment,
    host,
    sha: typeof options.sha === 'string' && options.sha.length > 0 ? options.sha : 'unknown',
    pm2LogDir:
      typeof options.pm2LogDir === 'string' && options.pm2LogDir.length > 0
        ? options.pm2LogDir.replace(/\/+$/u, '')
        : '$HOME/.pm2-fa/logs',
  };
}

/**
 * @param {string} environment
 * @returns {string}
 */
function templatePathForEnvironment(environment) {
  return resolve(templateDir, `fa-${environment}.alloy.tmpl`);
}

/**
 * @param {RenderArgs} options
 * @returns {string}
 */
export function renderAlloyConfig(options) {
  const normalized = normalizeRenderOptions(options);
  const template = readFileSync(templatePathForEnvironment(normalized.environment), 'utf8');

  return template
    .replaceAll('{{ENVIRONMENT}}', normalized.environment)
    .replaceAll('{{HOST}}', normalized.host)
    .replaceAll('{{SHA}}', normalized.sha)
    .replaceAll('{{PM2_LOG_DIR}}', normalized.pm2LogDir);
}

function main() {
  try {
    const args = parseArgs(process.argv);

    if (args.help === true) {
      console.log(usage());
      return;
    }

    if (typeof args.output !== 'string' || args.output.length === 0) {
      fail('--output is required');
    }

    const rendered = renderAlloyConfig(args);
    writeFileSync(args.output, rendered);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Alloy config render failed: ${message}`);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  main();
}
