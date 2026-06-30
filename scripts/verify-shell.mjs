#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(modulePath), '..');

/**
 * @typedef {{ cwd: string, stdio?: import('node:child_process').StdioOptions }} CommandOptions
 * @typedef {{ status: number | null, error?: Error }} CommandResult
 * @typedef {(command: string, args: string[], options: CommandOptions) => CommandResult} RunCommand
 * @typedef {(command: string) => boolean} CommandExists
 * @typedef {(message: string) => void} Write
 * @typedef {{
 *   trackedFiles?: string[],
 *   runCommand?: RunCommand,
 *   commandExists?: CommandExists,
 *   write?: Write,
 * }} VerifyShellOptions
 * @typedef {{ checkedFiles: number, shellcheck: 'passed' | 'skipped' }} VerifyShellResult
 */

/** @param {string} command */
function defaultCommandExists(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return result.error === undefined;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {CommandOptions} options
 * @returns {CommandResult}
 */
function defaultRunCommand(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    stdio: options.stdio ?? 'inherit',
  });

  if (result.error instanceof Error) {
    return { status: result.status, error: result.error };
  }

  return { status: result.status };
}

/** @param {string} root */
function getGitTrackedFiles(root) {
  const result = spawnSync('git', ['-C', root, 'ls-files', '-z', 'scripts'], {
    encoding: 'utf8',
  });

  if (result.error) {
    throw new Error(`Unable to list tracked scripts: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error('Unable to list tracked scripts with git ls-files.');
  }

  return result.stdout.split('\0').filter(Boolean);
}

/** @param {string[]} trackedFiles */
function filterTrackedShellScripts(trackedFiles) {
  return trackedFiles
    .filter((file) => file.startsWith('scripts/') && file.endsWith('.sh'))
    .sort((left, right) => left.localeCompare(right));
}

/**
 * @param {string} file
 * @param {CommandResult} result
 */
function assertShellCommandSucceeded(file, result) {
  if (result.error instanceof Error) {
    throw new Error(`Unable to run shell syntax check for ${file}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`Shell syntax check failed for ${file}`);
  }
}

/**
 * @param {string[]} files
 * @param {CommandResult} result
 */
function assertShellcheckSucceeded(files, result) {
  if (result.error instanceof Error) {
    throw new Error(`Unable to run shellcheck: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`shellcheck failed for ${files.length.toString()} shell script(s).`);
  }
}

/**
 * @param {string} root
 * @param {VerifyShellOptions} [options]
 * @returns {VerifyShellResult}
 */
function verifyShellScripts(root, options = {}) {
  const trackedFiles = options.trackedFiles ?? getGitTrackedFiles(root);
  const shellScripts = filterTrackedShellScripts(trackedFiles);
  const runCommand = options.runCommand ?? defaultRunCommand;
  const commandExists = options.commandExists ?? defaultCommandExists;
  const write = options.write ?? ((message) => process.stdout.write(message));

  if (!commandExists('bash')) {
    throw new Error('bash is not installed or not on PATH.');
  }

  for (const file of shellScripts) {
    assertShellCommandSucceeded(file, runCommand('bash', ['-n', file], { cwd: root }));
  }

  if (shellScripts.length === 0) {
    write('No tracked shell scripts under scripts/ to verify.\n');
    return { checkedFiles: 0, shellcheck: 'skipped' };
  }

  if (!commandExists('shellcheck')) {
    write('shellcheck not found; skipping shellcheck.\n');
    return { checkedFiles: shellScripts.length, shellcheck: 'skipped' };
  }

  assertShellcheckSucceeded(
    shellScripts,
    runCommand('shellcheck', shellScripts, { cwd: root, stdio: 'inherit' })
  );

  return { checkedFiles: shellScripts.length, shellcheck: 'passed' };
}

function main() {
  try {
    const result = verifyShellScripts(repoRoot);
    process.stdout.write(
      `Shell syntax verified for ${result.checkedFiles.toString()} tracked shell script(s).\n`
    );
    if (result.shellcheck === 'passed') {
      process.stdout.write('shellcheck completed.\n');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Shell verification failed: ${message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main();
}

export { filterTrackedShellScripts, verifyShellScripts };
