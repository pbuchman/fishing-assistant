#!/usr/bin/env node
/* eslint-disable no-console */

import { existsSync, readFileSync } from 'node:fs';

import { createDedupeStore } from './alert-router/dedupe-store.mjs';
import { createGitHubIssuesClient } from './alert-router/github-issues.mjs';
import { createAlertRouterServer } from './alert-router/server.mjs';

const defaultPort = 9002;

/**
 * @param {string} source
 * @returns {Record<string, string>}
 */
function parseEnvFile(source) {
  /** @type {Record<string, string>} */
  const values = {};

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

    values[key] = value.replace(/^['"]|['"]$/g, '');
  }

  return values;
}

function loadEnvFile() {
  const envFile = process.env['FA_ENV_FILE'];
  if (envFile === undefined || envFile.length === 0 || !existsSync(envFile)) {
    return;
  }

  const parsed = parseEnvFile(readFileSync(envFile, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] ??= value;
  }
}

/**
 * @param {string} name
 * @returns {string}
 */
function requiredEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function main() {
  loadEnvFile();

  const bindHost = process.env['FA_ALERT_ROUTER_BIND_HOST'] ?? '127.0.0.1';
  const port = Number.parseInt(process.env['PORT'] ?? String(defaultPort), 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT must be a positive integer');
  }

  const releaseSha = process.env['FA_RELEASE_SHA'];
  /** @type {Parameters<typeof createAlertRouterServer>[0]} */
  const serverOptions = {
    secret: requiredEnv('FA_ALERT_ROUTER_WEBHOOK_SECRET'),
    repository: requiredEnv('FA_ALERT_ROUTER_GITHUB_REPOSITORY'),
    grafanaInstanceUrl: requiredEnv('FA_GRAFANA_INSTANCE_URL'),
    dedupeStore: createDedupeStore(),
    githubClient: createGitHubIssuesClient({
      repository: requiredEnv('FA_ALERT_ROUTER_GITHUB_REPOSITORY'),
      token: requiredEnv('FA_ALERT_ROUTER_GITHUB_TOKEN'),
    }),
  };
  if (releaseSha !== undefined && releaseSha.length > 0) {
    serverOptions.releaseSha = releaseSha;
  }

  const server = createAlertRouterServer(serverOptions);

  server.listen(port, bindHost, () => {
    console.log(`fa-alert-router listening on ${bindHost}:${String(port)}`);
  });
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`fa-alert-router startup failed: ${message}`);
  process.exitCode = 1;
}
