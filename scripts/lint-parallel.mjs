#!/usr/bin/env node
// @ts-check

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** @typedef {{ name?: string, scripts?: Record<string, string> }} PackageJson */
/** @typedef {{ name: string, packagePath: string }} WorkspaceWithScript */

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(modulePath), '..');

/**
 * @param {string} filePath
 * @returns {PackageJson}
 */
function readPackageJson(filePath) {
  return /** @type {PackageJson} */ (JSON.parse(readFileSync(filePath, 'utf8')));
}

/**
 * @param {string} parent
 * @returns {string[]}
 */
function packageJsonFiles(parent) {
  const parentPath = resolve(repoRoot, parent);
  if (!existsSync(parentPath)) {
    return [];
  }

  return readdirSync(parentPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(parentPath, entry.name, 'package.json'))
    .filter((filePath) => existsSync(filePath));
}

/**
 * @param {string} scriptName
 * @returns {WorkspaceWithScript[]}
 */
function discoverWorkspacesWithScript(scriptName) {
  return ['apps', 'packages']
    .flatMap((parent) => packageJsonFiles(parent))
    .map((packagePath) => ({ packagePath, pkg: readPackageJson(packagePath) }))
    .filter(({ pkg }) => pkg.name !== undefined && pkg.scripts?.[scriptName] !== undefined)
    .map(({ packagePath, pkg }) => ({ packagePath, name: /** @type {string} */ (pkg.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * @param {string} command
 * @param {string[]} args
 */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.stdout.write('Linting root configs, scripts, apps, and packages...\n');
run('pnpm', ['exec', 'eslint', '.']);

const workspaceLintScripts = discoverWorkspacesWithScript('lint');
for (const workspace of workspaceLintScripts) {
  process.stdout.write(`Linting ${workspace.name}...\n`);
  run('pnpm', ['--filter', workspace.name, 'run', 'lint']);
}

process.stdout.write('Lint checks completed.\n');
