#!/usr/bin/env node
// @ts-check

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const githubRepo = process.env['FA_GITHUB_REPOSITORY'] ?? 'pbuchman/fishing-assistant';
const gcpProject = process.env['FA_GCP_PROJECT_ID'] ?? 'replace-with-gcp-project-id';

const githubVariableBindings = [
  { sourceName: 'FA_DEV_AUTH0_DOMAIN', targetName: 'FA_AUTH0_DOMAIN' },
  { sourceName: 'FA_DEV_AUTH0_CLIENT_ID', targetName: 'FA_AUTH0_CLIENT_ID' },
  { sourceName: 'FA_DEV_AUTH0_AUDIENCE', targetName: 'FA_AUTH0_AUDIENCE' },
];

const requiredSecretBindings = [
  { sourceName: 'FA_AUTH0_ISSUER', targetName: 'FA_AUTH0_ISSUER', required: true },
  { sourceName: 'FA_AUTH0_JWKS_URI', targetName: 'FA_AUTH0_JWKS_URI', required: true },
  {
    sourceName: 'FA_BOOTSTRAP_ADMIN_EMAILS',
    targetName: 'FA_BOOTSTRAP_ADMIN_EMAILS',
    required: true,
  },
  {
    sourceName: 'FA_SIGNUP_ALLOWED_EMAIL_PATTERN',
    targetName: 'FA_SIGNUP_ALLOWED_EMAIL_PATTERN',
    required: true,
  },
  { sourceName: 'FA_INTERNAL_AUTH_TOKEN', targetName: 'FA_INTERNAL_AUTH_TOKEN', required: true },
  {
    sourceName: 'FA_DEV_OPENROUTER_APP_API_KEY',
    targetName: 'FA_OPENROUTER_APP_API_KEY',
    required: true,
  },
  {
    sourceName: 'FA_DEV_MINIMAX_APP_API_KEY',
    targetName: 'FA_MINIMAX_APP_API_KEY',
    required: true,
  },
];

const optionalSecretNames = [
  'FA_INTERNAL_AUTH_TOKEN_PREVIOUS',
  'FA_SITE_BASIC_AUTH_USER',
  'FA_SITE_BASIC_AUTH_HTPASSWD',
  'FA_SITE_BASIC_AUTH_CADDY_HASH',
  'FA_SITE_BASIC_AUTH_CHECK_HEADER',
  'FA_OPENAI_APP_API_KEY',
  'FA_GEMINI_APP_API_KEY',
  'FA_GRAFANA_LOKI_URL',
  'FA_GRAFANA_LOKI_USERNAME',
  'FA_GRAFANA_LOKI_TOKEN',
  'FA_GRAFANA_LOKI_READ_URL',
  'FA_GRAFANA_LOKI_READ_USERNAME',
  'FA_GRAFANA_LOKI_READ_TOKEN',
  'FA_ALERT_ROUTER_WEBHOOK_SECRET',
  'FA_ALERT_ROUTER_GITHUB_TOKEN',
];

/**
 * @param {string} value
 * @returns {string}
 */
function formatEnvValue(value) {
  if (/^[A-Za-z0-9_./:@%+=,${}-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

/**
 * @param {string} template
 * @param {{ homeExpression: string, githubVariables: Map<string, string>, secretValues: Map<string, string> }} values
 * @returns {string}
 */
function renderLocalEnv(template, values) {
  const secretOverrides = new Map();
  for (const binding of secretBindingsForLocalEnv()) {
    const value =
      values.secretValues.get(binding.sourceName) ?? values.secretValues.get(binding.targetName);
    if (value !== undefined) {
      secretOverrides.set(binding.targetName, value);
    }
  }
  for (const [name, value] of values.secretValues) {
    if (!secretOverrides.has(name)) {
      secretOverrides.set(name, value);
    }
  }

  const overrides = new Map([
    ['FA_GCP_ADMIN_KEY_FILE', `${values.homeExpression}/.config/gcloud/fa-admin-key.json`],
    ...values.githubVariables,
    ...secretOverrides,
  ]);

  return `${template
    .split(/\r?\n/)
    .map((line) => {
      const match = /^(?<key>[A-Z][A-Z0-9_]+)=/.exec(line);
      const key = match?.groups?.['key'];
      if (key === undefined || !overrides.has(key)) {
        return line;
      }

      return `${key}=${formatEnvValue(overrides.get(key) ?? '')}`;
    })
    .join('\n')
    .replace(/\n*$/, '')}\n`;
}

function githubVariableBindingsForLocalEnv() {
  return githubVariableBindings.map((binding) => ({ ...binding }));
}

function secretBindingsForLocalEnv() {
  return requiredSecretBindings.map((binding) => ({ ...binding }));
}

/**
 * @param {string[]} argv
 * @returns {{ force: boolean }}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  let force = false;

  for (const arg of args) {
    if (arg === '--force') {
      force = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { force };
}

/**
 * @param {string} name
 * @returns {string}
 */
function readGithubVariable(name) {
  return execFileSync('gh', ['variable', 'get', name, '--repo', githubRepo], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * @param {string} name
 * @param {{ required: boolean, env: NodeJS.ProcessEnv }} options
 * @returns {string | undefined}
 */
function readSecret(name, { required, env }) {
  try {
    return execFileSync(
      'gcloud',
      ['--project', gcpProject, 'secrets', 'versions', 'access', 'latest', `--secret=${name}`],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    ).trim();
  } catch (error) {
    if (!required) {
      return undefined;
    }
    throw error;
  }
}

/**
 * @returns {{ githubVariables: Map<string, string>, secretValues: Map<string, string> }}
 */
function readExternalValues() {
  const githubVariables = new Map();
  const secretValues = new Map();
  const credentialOverride =
    process.env['CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE'] ??
    resolve(process.env['HOME'] ?? '.', '.config/gcloud/fa-admin-key.json');
  const gcloudEnv = {
    ...process.env,
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: credentialOverride,
  };

  for (const binding of githubVariableBindingsForLocalEnv()) {
    githubVariables.set(binding.targetName, readGithubVariable(binding.sourceName));
  }

  for (const binding of secretBindingsForLocalEnv()) {
    secretValues.set(
      binding.sourceName,
      readSecret(binding.sourceName, { required: binding.required, env: gcloudEnv }) ?? ''
    );
  }

  for (const name of optionalSecretNames) {
    const value = readSecret(name, { required: false, env: gcloudEnv });
    if (value !== undefined) {
      secretValues.set(name, value);
    }
  }

  return { githubVariables, secretValues };
}

function main() {
  try {
    const { force } = parseArgs(process.argv);
    const envPath = resolve(repoRoot, '.env.dev.local');
    const envrcPath = resolve(repoRoot, '.envrc');
    const envTemplatePath = resolve(repoRoot, '.env.dev.example');
    const envrcTemplatePath = resolve(repoRoot, '.envrc.example');

    if (existsSync(envPath) && !force) {
      throw new Error('.env.dev.local already exists; rerun with --force to overwrite it');
    }

    const template = readFileSync(envTemplatePath, 'utf8');
    const values = readExternalValues();
    const rendered = renderLocalEnv(template, {
      homeExpression: '$HOME',
      githubVariables: values.githubVariables,
      secretValues: values.secretValues,
    });

    writeFileSync(envPath, rendered, { mode: 0o600 });

    const createdEnvrc = !existsSync(envrcPath);
    if (createdEnvrc) {
      copyFileSync(envrcTemplatePath, envrcPath);
    }

    process.stdout.write(
      `Wrote .env.dev.local with ${String(values.githubVariables.size)} GitHub variables and ${String(
        values.secretValues.size
      )} Secret Manager values.\n`
    );
    if (createdEnvrc) {
      process.stdout.write('Wrote .envrc from .envrc.example.\n');
    } else {
      process.stdout.write('.envrc already exists; left it unchanged.\n');
    }
    process.stdout.write('Run direnv allow, then pnpm run dev.\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Failed to pull local env: ${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main();
}

export {
  formatEnvValue,
  githubVariableBindingsForLocalEnv,
  renderLocalEnv,
  secretBindingsForLocalEnv,
};
