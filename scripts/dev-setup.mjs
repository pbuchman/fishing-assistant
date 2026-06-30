#!/usr/bin/env node
// @ts-check

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const forbiddenEmulatorVars = [
  'FIRESTORE_EMULATOR_HOST',
  'STORAGE_EMULATOR_HOST',
  'PUBSUB_EMULATOR_HOST',
];

const requiredRealValues = [
  'FA_INTERNAL_AUTH_TOKEN',
  'FA_AUTH0_DOMAIN',
  'FA_AUTH0_CLIENT_ID',
  'FA_AUTH0_AUDIENCE',
  'FA_AUTH0_ISSUER',
  'FA_AUTH0_JWKS_URI',
  'FA_BOOTSTRAP_ADMIN_EMAILS',
  'FA_SIGNUP_ALLOWED_EMAIL_PATTERN',
];

/**
 * @param {string} source
 * @returns {Map<string, string>}
 */
function parseEnvFile(source) {
  const env = new Map();

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex);
    const value = normalized.slice(separatorIndex + 1).replace(/^['"]|['"]$/g, '');
    env.set(key, value);
  }

  return env;
}

/**
 * @param {string | undefined} value
 * @returns {boolean}
 */
function isUnsetOrPlaceholder(value) {
  const normalized = value?.trim() ?? '';
  return (
    normalized.length === 0 ||
    normalized.startsWith('replace-with-') ||
    normalized === 'admin@example.com'
  );
}

/**
 * @param {string} value
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {string}
 */
function expandHome(value, env) {
  const home = env['HOME'] ?? '';
  return value.replace(/^\$HOME(?=\/|$)/, home).replace(/^\$\{HOME\}(?=\/|$)/, home);
}

/**
 * @param {Map<string, string>} envFile
 * @returns {string[]}
 */
function configuredProviderKeyEnvNames(envFile) {
  const providers = new Set([
    'openrouter',
    'minimax',
    envFile.get('FA_EMBEDDING_PROVIDER') ?? 'openrouter',
  ]);
  const keys = new Set();

  if (providers.has('openrouter')) {
    keys.add('FA_OPENROUTER_APP_API_KEY');
  }
  if (providers.has('minimax')) {
    keys.add('FA_MINIMAX_APP_API_KEY');
  }
  if (providers.has('openai')) {
    keys.add('FA_OPENAI_APP_API_KEY');
  }
  if (providers.has('gemini')) {
    keys.add('FA_GEMINI_APP_API_KEY');
  }
  if (keys.size === 0) {
    keys.add('FA_OPENROUTER_APP_API_KEY');
  }
  return [...keys];
}

/**
 * @param {string} root
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [liveEnv]
 * @returns {string[]}
 */
function validateLocalSetup(root = repoRoot, liveEnv = process.env) {
  const errors = [];
  const envFilePath = resolve(root, '.env.dev.local');
  const envrcPath = resolve(root, '.envrc');

  if (!existsSync(envFilePath)) {
    errors.push('.env.dev.local is missing');
  }
  if (!existsSync(envrcPath)) {
    errors.push('.envrc is missing');
  }

  for (const key of forbiddenEmulatorVars) {
    if (liveEnv[key] !== undefined && liveEnv[key] !== '') {
      errors.push(`Local runtime must not set ${key}`);
    }
  }

  if (!existsSync(envFilePath)) {
    return errors;
  }

  const envFile = parseEnvFile(readFileSync(envFilePath, 'utf8'));

  if (envFile.get('FA_ENVIRONMENT') !== 'dev') {
    errors.push('.env.dev.local must set FA_ENVIRONMENT=dev');
  }
  if (envFile.get('FA_DATA_PLANE') !== 'gcp') {
    errors.push('.env.dev.local must set FA_DATA_PLANE=gcp');
  }
  if (isUnsetOrPlaceholder(envFile.get('FA_GCP_PROJECT_ID'))) {
    errors.push('.env.dev.local must set a real FA_GCP_PROJECT_ID');
  }

  const rawKeyFile = envFile.get('FA_GCP_ADMIN_KEY_FILE');
  if (isUnsetOrPlaceholder(rawKeyFile)) {
    errors.push('.env.dev.local must set FA_GCP_ADMIN_KEY_FILE to the local FA admin key');
  } else if (!existsSync(expandHome(rawKeyFile ?? '', liveEnv))) {
    errors.push('.env.dev.local FA_GCP_ADMIN_KEY_FILE must point to a readable local key file');
  }

  for (const key of requiredRealValues) {
    if (isUnsetOrPlaceholder(envFile.get(key))) {
      errors.push(`.env.dev.local must set a real ${key}`);
    }
  }

  for (const providerKeyEnv of configuredProviderKeyEnvNames(envFile)) {
    if (isUnsetOrPlaceholder(envFile.get(providerKeyEnv))) {
      errors.push(`.env.dev.local must set ${providerKeyEnv} for the configured providers`);
    }
  }

  return errors;
}

function main() {
  const errors = validateLocalSetup();
  if (errors.length > 0) {
    process.stderr.write('Local FA runtime setup is incomplete:\n');
    for (const error of errors) {
      process.stderr.write(`  - ${error}\n`);
    }
    process.stderr.write('\nCreate ignored local files without committing secrets:\n');
    process.stderr.write('  cp .env.dev.example .env.dev.local\n');
    process.stderr.write('  cp .envrc.example .envrc\n');
    process.stderr.write('  direnv allow\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write('Local FA runtime setup verified.\n');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main();
}

export { parseEnvFile, validateLocalSetup };
