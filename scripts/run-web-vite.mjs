#!/usr/bin/env node
/* eslint-disable no-console */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(modulePath), '..');
const webRoot = resolve(repoRoot, 'apps/web');
const viteCli = resolve(repoRoot, 'node_modules/vite/bin/vite.js');

const WEB_SAFE_FA_ENV_NAMES = new Set([
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
]);

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} sourceEnv
 * @returns {NodeJS.ProcessEnv}
 */
function createSanitizedWebEnv(sourceEnv = process.env) {
  /** @type {NodeJS.ProcessEnv} */
  const sanitized = {};

  for (const [key, value] of Object.entries(sourceEnv)) {
    if (value === undefined) {
      continue;
    }
    if (key.startsWith('FA_') && !WEB_SAFE_FA_ENV_NAMES.has(key)) {
      continue;
    }
    sanitized[key] = value;
  }

  return sanitized;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} targetEnv
 */
function stripUnsafeFaEnvFromProcessEnv(targetEnv = process.env) {
  for (const key of Object.keys(targetEnv)) {
    if (key.startsWith('FA_') && !WEB_SAFE_FA_ENV_NAMES.has(key)) {
      delete targetEnv[key];
    }
  }
}

/**
 * PM2 loads ESM apps through ProcessContainerFork.js, so process.argv[1] is not
 * the app module even though process.env.pm_exec_path points at it.
 *
 * @param {string} currentModulePath
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {boolean}
 */
function isWebViteCliEntrypoint(
  currentModulePath = modulePath,
  argv = process.argv,
  env = process.env
) {
  const normalizedModulePath = resolve(currentModulePath);
  const directEntrypoint =
    argv[1] === undefined ? false : resolve(argv[1]) === normalizedModulePath;
  if (directEntrypoint) {
    return true;
  }

  const pm2Entrypoint = env['pm_exec_path'] ?? env['script'];
  const hasPm2Marker =
    env['PM2_HOME'] !== undefined ||
    env['pm_id'] !== undefined ||
    env['NODE_APP_INSTANCE'] !== undefined ||
    env['pm_exec_path'] !== undefined;

  return (
    hasPm2Marker && pm2Entrypoint !== undefined && resolve(pm2Entrypoint) === normalizedModulePath
  );
}

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} sourceEnv
 * @returns {Promise<number>}
 */
function runWebVite(args = process.argv.slice(2), sourceEnv = process.env) {
  stripUnsafeFaEnvFromProcessEnv(sourceEnv);

  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [viteCli, ...args], {
      cwd: webRoot,
      env: createSanitizedWebEnv(sourceEnv),
      stdio: 'inherit',
    });

    /** @param {NodeJS.Signals} signal */
    const forwardSignal = (signal) => {
      if (!child.killed) {
        child.kill(signal);
      }
    };

    process.once('SIGINT', forwardSignal);
    process.once('SIGTERM', forwardSignal);

    child.once('error', (error) => {
      process.off('SIGINT', forwardSignal);
      process.off('SIGTERM', forwardSignal);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      process.off('SIGINT', forwardSignal);
      process.off('SIGTERM', forwardSignal);
      if (signal !== null) {
        resolvePromise(1);
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
}

if (isWebViteCliEntrypoint()) {
  try {
    process.exitCode = await runWebVite();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to run Vite with sanitized web env: ${message}`);
    process.exitCode = 1;
  }
}

export {
  WEB_SAFE_FA_ENV_NAMES,
  createSanitizedWebEnv,
  isWebViteCliEntrypoint,
  runWebVite,
  stripUnsafeFaEnvFromProcessEnv,
};
