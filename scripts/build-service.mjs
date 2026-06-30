#!/usr/bin/env node
// @ts-check

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ name?: string, version?: string, private?: boolean, type?: string, dependencies?: Record<string, string>, devDependencies?: Record<string, string>, optionalDependencies?: Record<string, string>, peerDependencies?: Record<string, string> }} PackageJson */

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(modulePath), '..');
const allowedServices = new Set([
  'chat-service',
  'knowledge-service',
  'llm-usage-service',
  'user-service',
]);
const workspaceScope = '@fa/';

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * @param {string} filePath
 * @returns {PackageJson}
 */
function readPackageJson(filePath) {
  return /** @type {PackageJson} */ (JSON.parse(readFileSync(filePath, 'utf8')));
}

/**
 * @returns {Map<string, string>}
 */
function readCatalogVersions() {
  const workspacePath = resolve(repoRoot, 'pnpm-workspace.yaml');
  if (!existsSync(workspacePath)) {
    return new Map();
  }

  const catalog = new Map();
  let inCatalog = false;

  for (const line of readFileSync(workspacePath, 'utf8').split('\n')) {
    if (!inCatalog) {
      inCatalog = line.trim() === 'catalog:';
      continue;
    }

    if (!line.startsWith('  ')) {
      break;
    }

    const match = line.match(/^\s{2}(?:'([^']+)'|([^:]+)):\s*(.+)$/);
    if (match === null) {
      continue;
    }

    const key = match[1] ?? match[2]?.trim();
    const value = match[3]?.trim();
    if (key !== undefined && value !== undefined && value !== '') {
      catalog.set(key, value);
    }
  }

  return catalog;
}

const catalogVersions = readCatalogVersions();

/**
 * @param {string} dep
 * @param {string} version
 * @returns {string}
 */
function resolveDependencyVersion(dep, version) {
  if (version === 'catalog:') {
    const resolved = catalogVersions.get(dep);
    if (resolved === undefined) {
      throw new Error(`Missing catalog version for dependency: ${dep}`);
    }
    return resolved;
  }

  return version;
}

/**
 * @param {string} packageName
 * @returns {string | undefined}
 */
function findWorkspacePackageJson(packageName) {
  if (!packageName.startsWith(workspaceScope)) {
    return undefined;
  }

  const shortName = packageName.slice(workspaceScope.length);
  const candidates = [
    resolve(repoRoot, 'apps', shortName, 'package.json'),
    resolve(repoRoot, 'packages', shortName, 'package.json'),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

/**
 * @param {PackageJson} pkg
 * @param {boolean} includeDev
 * @returns {Record<string, string>}
 */
function dependencyEntries(pkg, includeDev) {
  return {
    ...(pkg.dependencies ?? {}),
    ...(pkg.optionalDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
    ...(includeDev ? (pkg.devDependencies ?? {}) : {}),
  };
}

/**
 * @param {string} packageName
 * @param {Set<string>} visited
 * @returns {Set<string>}
 */
function collectExternalDependencies(packageName, visited = new Set()) {
  if (visited.has(packageName)) {
    return new Set();
  }
  visited.add(packageName);

  const packagePath = findWorkspacePackageJson(packageName);
  if (packagePath === undefined) {
    return new Set();
  }

  const pkg = readPackageJson(packagePath);
  const externals = new Set();

  for (const dep of Object.keys(dependencyEntries(pkg, false))) {
    if (dep.startsWith(workspaceScope)) {
      for (const transitiveDep of collectExternalDependencies(dep, visited)) {
        externals.add(transitiveDep);
      }
      continue;
    }

    externals.add(dep);
  }

  return externals;
}

/**
 * @param {string} packageName
 * @param {Set<string>} visited
 * @returns {Map<string, string>}
 */
function collectRuntimeDependencies(packageName, visited = new Set()) {
  if (visited.has(packageName)) {
    return new Map();
  }
  visited.add(packageName);

  const packagePath = findWorkspacePackageJson(packageName);
  if (packagePath === undefined) {
    return new Map();
  }

  const pkg = readPackageJson(packagePath);
  const runtimeDeps = new Map();

  for (const [dep, version] of Object.entries(dependencyEntries(pkg, false))) {
    if (dep.startsWith(workspaceScope)) {
      for (const [transitiveDep, transitiveVersion] of collectRuntimeDependencies(dep, visited)) {
        runtimeDeps.set(transitiveDep, transitiveVersion);
      }
      continue;
    }

    runtimeDeps.set(dep, resolveDependencyVersion(dep, version));
  }

  return runtimeDeps;
}

/**
 * @param {string} inputPath
 * @returns {string | undefined}
 */
function nodePackageNameFromInput(inputPath) {
  const match = inputPath.match(/^node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
  return match?.[1];
}

const service = process.argv[2];
if (service === undefined) {
  fail(
    'Usage: node scripts/build-service.mjs <chat-service|knowledge-service|llm-usage-service|user-service>'
  );
}

if (!allowedServices.has(service)) {
  fail(`Unsupported service: ${service}`);
}

const serviceDir = resolve(repoRoot, 'apps', service);
const entryPoint = resolve(serviceDir, 'src/index.ts');
const packagePath = resolve(serviceDir, 'package.json');

if (!existsSync(entryPoint)) {
  fail(`Service entry point not found: ${entryPoint}`);
}
if (!existsSync(packagePath)) {
  fail(`Service package.json not found: ${packagePath}`);
}

const servicePackageName = `${workspaceScope}${service}`;
const externalPackages = [...collectExternalDependencies(servicePackageName)].sort();
const runtimeDependencies = collectRuntimeDependencies(servicePackageName);
const outfile = resolve(serviceDir, 'dist/index.js');

process.stdout.write(`Building ${service}...\n`);

const result = await esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile,
  external: externalPackages,
  sourcemap: true,
  mainFields: ['module', 'main'],
  conditions: ['import', 'node'],
  absWorkingDir: repoRoot,
  metafile: true,
});

const bundledNpmPackages = new Set();
for (const inputPath of Object.keys(result.metafile.inputs)) {
  const packageName = nodePackageNameFromInput(inputPath);
  if (packageName !== undefined && !externalPackages.includes(packageName)) {
    bundledNpmPackages.add(packageName);
  }
}

if (bundledNpmPackages.size > 0) {
  process.stderr.write('\nERROR: npm packages were bundled instead of externalized:\n');
  for (const packageName of [...bundledNpmPackages].sort()) {
    process.stderr.write(`  - ${packageName}\n`);
  }
  process.stderr.write(`\nAdd missing runtime dependencies to apps/${service}/package.json.\n`);
  process.exit(1);
}

const productionPackage = {
  name: servicePackageName,
  private: true,
  type: 'module',
  main: './index.js',
  dependencies: Object.fromEntries([...runtimeDependencies.entries()].sort()),
};

mkdirSync(resolve(serviceDir, 'dist'), { recursive: true });
writeFileSync(
  resolve(serviceDir, 'dist/package.json'),
  `${JSON.stringify(productionPackage, null, 2)}\n`
);

process.stdout.write(`Built ${service}: ${outfile}\n`);
