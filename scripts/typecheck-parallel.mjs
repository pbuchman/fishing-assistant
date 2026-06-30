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
 * @returns {WorkspaceWithScript[]}
 */
function discoverTypecheckWorkspaces() {
  return ['apps', 'packages']
    .flatMap((parent) => packageJsonFiles(parent))
    .map((packagePath) => ({ packagePath, pkg: readPackageJson(packagePath) }))
    .filter(({ pkg }) => pkg.name !== undefined && pkg.scripts?.['typecheck'] !== undefined)
    .map(({ packagePath, pkg }) => ({ packagePath, name: /** @type {string} */ (pkg.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

const workspaces = discoverTypecheckWorkspaces();
if (workspaces.length === 0) {
  process.stderr.write('No apps/* or packages/* workspaces with typecheck scripts were found.\n');
  process.exit(1);
}

for (const workspace of workspaces) {
  process.stdout.write(`Typechecking ${workspace.name}...\n`);
  const result = spawnSync('pnpm', ['--filter', workspace.name, 'run', 'typecheck'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.stdout.write('Typecheck completed.\n');
