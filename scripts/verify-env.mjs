#!/usr/bin/env node
/* eslint-disable no-console */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(new URL('..', import.meta.url).pathname);

const requiredCommonVars = [
  'FA_ENVIRONMENT',
  'FA_DATA_PLANE',
  'FA_GCP_PROJECT_ID',
  'FA_GCP_REGION',
  'FA_BIND_HOST',
  'FA_INTERNAL_AUTH_TOKEN',
  'FA_WEB_APP_URL',
  'FA_PUBLIC_ORIGIN',
  'FA_CHAT_SERVICE_URL',
  'FA_KNOWLEDGE_SERVICE_URL',
  'FA_LLM_USAGE_SERVICE_URL',
  'FA_USER_SERVICE_URL',
  'FA_CHAT_SERVICE_INTERNAL_URL',
  'FA_KNOWLEDGE_SERVICE_INTERNAL_URL',
  'FA_LLM_USAGE_SERVICE_INTERNAL_URL',
  'FA_USER_SERVICE_INTERNAL_URL',
  'FA_AUTH0_DOMAIN',
  'FA_AUTH0_CLIENT_ID',
  'FA_AUTH0_AUDIENCE',
  'FA_AUTH0_ISSUER',
  'FA_AUTH0_JWKS_URI',
  'FA_BOOTSTRAP_ADMIN_EMAILS',
  'FA_SIGNUP_ALLOWED_EMAIL_PATTERN',
];

const catalogVars = [
  ...requiredCommonVars,
  'FA_INTERNAL_AUTH_TOKEN_PREVIOUS',
  'FA_SITE_BASIC_AUTH_USER',
  'FA_SITE_BASIC_AUTH_HTPASSWD',
  'FA_SITE_BASIC_AUTH_CADDY_HASH',
  'FA_SITE_BASIC_AUTH_CHECK_HEADER',
  'FA_GCP_PROJECT_NUMBER',
  'FA_EMBEDDING_PROVIDER',
  'FA_EMBEDDING_MODEL',
  'FA_EMBEDDING_DIMENSIONS',
  'FA_OPENROUTER_APP_API_KEY',
  'FA_MINIMAX_APP_API_KEY',
  'FA_OPENAI_APP_API_KEY',
  'FA_GEMINI_APP_API_KEY',
  'FA_GRAFANA_LOKI_URL',
  'FA_GRAFANA_LOKI_USERNAME',
  'FA_GRAFANA_LOKI_TOKEN',
  'FA_GRAFANA_LOKI_DATASOURCE_UID',
  'FA_GRAFANA_INSTANCE_URL',
  'FA_ALERT_ROUTER_WEBHOOK_URL',
  'FA_ALERT_ROUTER_WEBHOOK_SECRET',
  'FA_ALERT_ROUTER_GITHUB_REPOSITORY',
  'FA_ALERT_ROUTER_GITHUB_TOKEN',
  'FA_LOG_LEVEL',
];

const localAdminVars = ['FA_GCP_ADMIN_SERVICE_ACCOUNT', 'FA_GCP_ADMIN_KEY_FILE'];
const canonicalCatalogVars = [...catalogVars, ...localAdminVars];

const forbiddenBrowserVars = new Set([
  'FA_INTERNAL_AUTH_TOKEN',
  'FA_INTERNAL_AUTH_TOKEN_PREVIOUS',
  'FA_AUTH0_ISSUER',
  'FA_AUTH0_JWKS_URI',
  'FA_BOOTSTRAP_ADMIN_EMAILS',
  'FA_USER_SERVICE_INTERNAL_URL',
  'FA_SITE_BASIC_AUTH_USER',
  'FA_SITE_BASIC_AUTH_HTPASSWD',
  'FA_SITE_BASIC_AUTH_CADDY_HASH',
  'FA_SITE_BASIC_AUTH_CHECK_HEADER',
  'FA_OPENROUTER_APP_API_KEY',
  'FA_MINIMAX_APP_API_KEY',
  'FA_OPENAI_APP_API_KEY',
  'FA_GEMINI_APP_API_KEY',
]);

const defaultBrowserSafeVars = [
  'FA_ENVIRONMENT',
  'FA_PUBLIC_ORIGIN',
  'FA_WEB_APP_URL',
  'FA_CHAT_SERVICE_URL',
  'FA_KNOWLEDGE_SERVICE_URL',
  'FA_LLM_USAGE_SERVICE_URL',
  'FA_USER_SERVICE_URL',
  'FA_AUTH0_DOMAIN',
  'FA_AUTH0_CLIENT_ID',
  'FA_AUTH0_AUDIENCE',
];

const localSecretPathPatterns = [
  /^\.env$/,
  /^\.env\..*\.local$/,
  /^\.envrc$/,
  /^\.envrc\.local$/,
  /(^|\/).*service-account.*\.json$/,
  /(^|\/)gcp-.*\.json$/,
  /(^|\/).*-key\.json$/,
];

const ignoredDirectoryNames = new Set(['.git', 'node_modules', 'dist', 'coverage', '.worktrees']);
const forbiddenLiveEnvVars = [
  'FIRESTORE_EMULATOR_HOST',
  'STORAGE_EMULATOR_HOST',
  'PUBSUB_EMULATOR_HOST',
];
const googleProjectEnvVars = ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT'];
const productEnvSurfacePrefixes = [
  'scripts/deploy/',
  'scripts/dev-host/',
  'scripts/hetzner/',
  'scripts/observability/',
  '.github/workflows/',
  'terraform/hetzner-prod/',
];
const productEnvSurfaceFiles = new Set(['ecosystem.config.cjs', 'ecosystem.config.prod.cjs']);
const genericProductEnvAliases = new Set([
  'APP_ROOT',
  'DEPLOY_SCRIPT',
  'DEPLOY_USER',
  'ENV_FILE',
  'OUTPUT_FILE',
  'PROVISIONER_SA_KEY_FILE',
  'REMOTE_URL',
  'REPO_DIR',
  'REMOTE_CURRENT_DIR',
  'REMOTE_RELEASES_DIR',
  'REMOTE_USER',
  'REPO_PATH',
  'RUNTIME_SA_KEY_FILE',
  'RUNTIME_KEY_FILE',
  'SITE_ENABLED',
  'SITE_TARGET',
  'SOURCE_REPO',
  'SWAP_FILE',
  'SWAP_SIZE',
  'TEMP_ENV_FILE',
  'WEB_CURRENT',
  'WEB_RELEASES_DIR',
  'WEB_ROOT',
]);
const genericProductEnvAliasPrefixes = [
  'APP_',
  'DEPLOY_',
  'REMOTE_',
  'REPO_',
  'RUNTIME_',
  'SITE_',
  'SOURCE_',
  'SWAP_',
  'TEMP_',
  'WEB_',
];
const scanExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.mts',
  '.service',
  '.sh',
  '.ts',
  '.tsx',
  '.tf',
  '.tftpl',
  '.yaml',
  '.yml',
]);
const scanBasenames = new Set([
  'Dockerfile',
  '.env.example',
  '.env.dev.example',
  '.env.prod.example',
  '.envrc.example',
  '.gitignore',
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'tsconfig.base.json',
  'tsconfig.eslint.json',
  'tsconfig.tests-check.json',
  'ecosystem.config.cjs',
  'ecosystem.config.prod.cjs',
]);
const allowedEnvNames = new Set([
  'BASH_SOURCE',
  'CI',
  'DEBIAN_FRONTEND',
  'GCLOUD_PROJECT',
  'GITHUB_OUTPUT',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'HOME',
  'NODE_ENV',
  'PATH',
  'PM2_HOME',
  'PORT',
  'PWD',
  'REMOTE_USER',
  'SHELL',
  'USER',
]);
const allowedEnvPrefixes = [
  'CLOUDSDK_',
  'FIRESTORE_',
  'FA_',
  'GCLOUD_',
  'GOOGLE_',
  'NODE_',
  'npm_',
  'PM2_',
  'PNPM_',
  'PUBSUB_',
  'STORAGE_',
  'VITE_',
];
const localShellEnvPrefixes = [
  'APP_',
  'CERTBOT_',
  'CLOUDFLARE_',
  'CONTAINER_',
  'DEPLOY_',
  'ENV_',
  'HCLOUD_',
  'KEY_',
  'KNOWN_',
  'LOG_',
  'NGINX_',
  'ORIGIN_',
  'OUTPUT_',
  'PACKAGE_',
  'PROJECT_',
  'PROVISIONER_',
  'RELOAD_',
  'REQUIRED_',
  'REMOTE_',
  'REPO_',
  'RUNTIME_',
  'RUN_',
  'SCRIPT_',
  'SOURCE_',
  'SITE_',
  'SKIP_',
  'SSH_',
  'SWAP_',
  'TEMP_',
  'TERRAFORM_',
  'TEST_',
  'TF_',
  'WEB_',
  'WEBHOOK_',
  'WORKSPACE_',
];
const processEnvDotPattern = /process\.env\.([A-Z][A-Z0-9_]+)/g;
const processEnvBracketPattern = /process\.env\[['"]([A-Z][A-Z0-9_]+)['"]\]/g;
const envAssignmentPattern = /(?:^|[;&\s(])(?:export\s+)?([A-Z][A-Z0-9]*_[A-Z0-9_]+)=/gm;
const systemdEnvironmentPattern = /Environment=([A-Z][A-Z0-9]*_[A-Z0-9_]+)=/g;
const forbiddenSentryEnvPattern = /\bFA_SENTRY_DSN(?:_WEB)?\b/g;

/**
 * @param {string} root
 * @param {string} filePath
 * @returns {string}
 */
function toRelativePath(root, filePath) {
  return relative(root, filePath).split(sep).join('/');
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
 * @returns {Map<string, string>}
 */
function parseEnvTemplate(source) {
  const env = new Map();

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const match = /^(?<key>[A-Za-z_][A-Za-z0-9_]*)=(?<value>.*)$/.exec(normalized);
    if (match?.groups === undefined) {
      continue;
    }

    const key = match.groups['key'];
    const value = match.groups['value'];
    if (key === undefined || value === undefined) {
      continue;
    }

    env.set(key, value.replace(/^['"]|['"]$/g, ''));
  }

  return env;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function getGitTrackedFiles(root) {
  try {
    return execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\0')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * @param {string} relativePath
 * @returns {boolean}
 */
function isForbiddenTrackedSecretPath(relativePath) {
  return localSecretPathPatterns.some((pattern) => pattern.test(relativePath));
}

/**
 * @param {string} relativePath
 * @returns {boolean}
 */
function isSkippedEnvReferencePath(relativePath) {
  void relativePath;
  return false;
}

/**
 * @param {string} relativePath
 * @returns {boolean}
 */
function shouldScanTextFile(relativePath) {
  if (isSkippedEnvReferencePath(relativePath)) {
    return false;
  }

  if (relativePath.startsWith('docs/operations/')) {
    return true;
  }

  const basename = relativePath.split('/').at(-1) ?? relativePath;
  if (scanBasenames.has(basename)) {
    return true;
  }

  const extension = basename.includes('.') ? `.${basename.split('.').at(-1) ?? ''}` : '';
  return scanExtensions.has(extension);
}

/**
 * @param {string} relativePath
 * @returns {boolean}
 */
function isRuntimeEnvSurfacePath(relativePath) {
  return (
    relativePath === 'ecosystem.config.cjs' ||
    relativePath === 'ecosystem.config.prod.cjs' ||
    relativePath.startsWith('scripts/hetzner/') ||
    relativePath.startsWith('scripts/dev-host/') ||
    relativePath.startsWith('scripts/deploy/') ||
    relativePath.startsWith('.github/workflows/') ||
    relativePath.startsWith('docs/operations/')
  );
}

/**
 * @param {string} relativePath
 * @returns {boolean}
 */
function isProductEnvSurfacePath(relativePath) {
  return (
    productEnvSurfaceFiles.has(relativePath) ||
    productEnvSurfacePrefixes.some((prefix) => relativePath.startsWith(prefix))
  );
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function listRepositoryTextFiles(root) {
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

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = toRelativePath(root, entryPath);
      if (shouldScanTextFile(relativePath) && statSync(entryPath).size <= 2_000_000) {
        files.push(relativePath);
      }
    }
  }

  visit(root);
  return files;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function isAllowedEnvName(name) {
  return (
    allowedEnvNames.has(name) ||
    allowedEnvPrefixes.some((prefix) => name.startsWith(prefix)) ||
    localShellEnvPrefixes.some((prefix) => name.startsWith(prefix))
  );
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function isGenericProductEnvAlias(name) {
  return (
    genericProductEnvAliases.has(name) ||
    (!name.startsWith('FA_') &&
      genericProductEnvAliasPrefixes.some((prefix) => name.startsWith(prefix)))
  );
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function findYamlEnvNames(source) {
  const names = new Set();
  const lines = source.split(/\r?\n/);
  let envIndent = undefined;

  for (const line of lines) {
    if (/^\s*$/.test(line)) {
      continue;
    }

    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (envIndent !== undefined && indent <= envIndent) {
      envIndent = undefined;
    }

    if (envIndent !== undefined) {
      const envKey = /^\s+([A-Z][A-Z0-9_]+):/.exec(line)?.[1];
      if (envKey !== undefined) {
        names.add(envKey);
      }
      continue;
    }

    if (/^\s*env:\s*(?:#.*)?$/.test(line)) {
      envIndent = indent;
    }
  }

  return [...names];
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function findEnvNames(source) {
  /** @type {Set<string>} */
  const names = new Set();
  const patterns = [
    processEnvDotPattern,
    processEnvBracketPattern,
    envAssignmentPattern,
    systemdEnvironmentPattern,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) {
        names.add(match[1]);
      }
    }
  }

  for (const name of findYamlEnvNames(source)) {
    names.add(name);
  }

  return [...names].sort();
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function findForeignProductEnvReferences(root) {
  const errors = [];

  for (const relativePath of listRepositoryTextFiles(root)) {
    const source = readFileSync(resolve(root, relativePath), 'utf8');
    const foreignNames = findEnvNames(source).filter((name) => !isAllowedEnvName(name));
    if (foreignNames.length > 0) {
      errors.push(
        `Forbidden non-FA product env reference in ${relativePath}: ${foreignNames.join(', ')}`
      );
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function findGenericProductEnvAliases(root) {
  const errors = [];

  for (const relativePath of listRepositoryTextFiles(root)) {
    if (!isProductEnvSurfacePath(relativePath)) {
      continue;
    }

    const source = readFileSync(resolve(root, relativePath), 'utf8');
    const aliases = findEnvNames(source).filter((name) => isGenericProductEnvAlias(name));
    if (aliases.length > 0) {
      errors.push(`Forbidden generic product env alias in ${relativePath}: ${aliases.join(', ')}`);
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function findForbiddenSentryEnvReferences(root) {
  const errors = [];

  for (const relativePath of listRepositoryTextFiles(root)) {
    if (!isRuntimeEnvSurfacePath(relativePath)) {
      continue;
    }

    const source = readFileSync(resolve(root, relativePath), 'utf8');
    const names = [...new Set(source.match(forbiddenSentryEnvPattern) ?? [])].sort();
    if (names.length > 0) {
      errors.push(`Forbidden Sentry env reference in ${relativePath}: ${names.join(', ')}`);
    }
  }

  return errors;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} liveEnv
 * @returns {string[]}
 */
function validateLiveEnvironment(liveEnv = process.env) {
  const errors = [];

  for (const key of forbiddenLiveEnvVars) {
    if (liveEnv[key] !== undefined && liveEnv[key] !== '') {
      errors.push(`Live environment must not set ${key}`);
    }
  }

  const liveCredentials = liveEnv['GOOGLE_APPLICATION_CREDENTIALS'];
  const liveFaAdminKeyFile = liveEnv['FA_GCP_ADMIN_KEY_FILE'];
  if (
    liveCredentials !== undefined &&
    liveCredentials !== '' &&
    liveFaAdminKeyFile !== undefined &&
    liveFaAdminKeyFile !== '' &&
    liveCredentials !== liveFaAdminKeyFile
  ) {
    errors.push('Live GOOGLE_APPLICATION_CREDENTIALS must match FA_GCP_ADMIN_KEY_FILE');
  }

  const liveFaProjectId = liveEnv['FA_GCP_PROJECT_ID'];

  for (const key of googleProjectEnvVars) {
    const liveProject = liveEnv[key];
    if (
      liveFaProjectId !== undefined &&
      liveFaProjectId !== '' &&
      liveProject !== undefined &&
      liveProject !== '' &&
      liveProject !== liveFaProjectId
    ) {
      errors.push(`Live ${key} must match FA_GCP_PROJECT_ID`);
    }
  }

  return errors;
}

/**
 * @param {string} root
 * @param {{ trackedFiles?: string[], browserSafeVars?: string[], liveEnv?: NodeJS.ProcessEnv | Record<string, string | undefined> }} [options]
 * @returns {string[]}
 */
function validateEnvRepository(root = repoRoot, options = {}) {
  const errors = [];
  const templatePaths = ['.env.example', '.env.dev.example', '.env.prod.example'];

  for (const templatePath of templatePaths) {
    const source = readOptionalFile(root, templatePath);
    if (source === undefined) {
      errors.push(`Missing committed env template: ${templatePath}`);
      continue;
    }

    const env = parseEnvTemplate(source);
    const requiredVars =
      templatePath === '.env.example'
        ? canonicalCatalogVars
        : templatePath === '.env.dev.example'
          ? [...catalogVars, ...localAdminVars]
          : catalogVars;

    for (const requiredVar of requiredVars) {
      if (requiredVar === 'FA_INTERNAL_AUTH_TOKEN_PREVIOUS') {
        continue;
      }
      if (!env.has(requiredVar)) {
        errors.push(`${templatePath} is missing ${requiredVar}`);
      }
    }

    if (env.get('FA_DATA_PLANE') !== 'gcp') {
      errors.push(`${templatePath} must set FA_DATA_PLANE=gcp`);
    }
  }

  const envrc = readOptionalFile(root, '.envrc.example');
  if (envrc === undefined) {
    errors.push('Missing committed env template: .envrc.example');
  } else {
    for (const requiredSnippet of [
      'GOOGLE_APPLICATION_CREDENTIALS',
      'FA_GCP_ADMIN_KEY_FILE',
      'GOOGLE_CLOUD_PROJECT',
      'FA_GCP_PROJECT_ID',
      'unset FIRESTORE_EMULATOR_HOST',
      'unset STORAGE_EMULATOR_HOST',
      'unset PUBSUB_EMULATOR_HOST',
    ]) {
      if (!envrc.includes(requiredSnippet)) {
        errors.push(`.envrc.example must include ${requiredSnippet}`);
      }
    }
  }

  const gitignore = readOptionalFile(root, '.gitignore');
  if (gitignore === undefined) {
    errors.push('Missing .gitignore');
  } else {
    for (const ignoredPattern of [
      '.env',
      '.env.*',
      '!.env.example',
      '!.env.*.example',
      '.envrc',
      '.envrc.local',
      '*-key.json',
      '*service-account*.json',
      'gcp-*.json',
    ]) {
      if (!gitignore.includes(ignoredPattern)) {
        errors.push(`.gitignore must include ${ignoredPattern}`);
      }
    }
  }

  const trackedFiles = options.trackedFiles ?? getGitTrackedFiles(root);
  for (const trackedFile of trackedFiles) {
    if (isForbiddenTrackedSecretPath(trackedFile)) {
      errors.push(`Tracked local secret file is forbidden: ${trackedFile}`);
    }
  }

  const browserSafeVars = options.browserSafeVars ?? defaultBrowserSafeVars;
  for (const envVar of browserSafeVars) {
    if (forbiddenBrowserVars.has(envVar)) {
      errors.push(`Browser-safe env must not expose ${envVar}`);
    }
  }

  errors.push(...findForeignProductEnvReferences(root));
  errors.push(...findGenericProductEnvAliases(root));
  errors.push(...findForbiddenSentryEnvReferences(root));
  errors.push(...validateLiveEnvironment(options.liveEnv ?? process.env));

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
    const errors = validateEnvRepository(root);

    if (errors.length > 0) {
      console.error('Environment verification failed:');
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }

    console.log('Environment templates verified.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Environment verification failed: ${message}`);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main();
}

export {
  defaultBrowserSafeVars,
  findForbiddenSentryEnvReferences,
  findForeignProductEnvReferences,
  findGenericProductEnvAliases,
  parseEnvTemplate,
  validateEnvRepository,
  validateLiveEnvironment,
};
