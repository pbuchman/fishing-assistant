#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { globSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{dependencies?: Record<string, string>, devDependencies?: Record<string, string>, pnpm?: {overrides?: Record<string, string>}}} Manifest */
// Reviewed minimums for the November 2026 findings. No arbitrary audit recommendations are executed.
const direct = {
  fastify: '5.12.8',
  'firebase-tools': '15.35.0',
  vite: '8.1.7',
  vitest: '4.1.12',
  '@vitest/coverage-v8': '4.1.12',
};
const overrides = {
  'brace-expansion@1': '1.1.21',
  'brace-expansion@2': '2.1.7',
  'brace-expansion@5': '5.0.12',
  'fast-uri@3': '3.1.9',
  'ip-address@10': '10.7.4',
  'postcss@8': '8.5.23',
  undici: '6.29.1',
  vite: '8.1.7',
  'follow-redirects@1': '1.16.2',
  'systeminformation@5': '5.33.16',
  '@fastify/busboy@3': '3.2.2',
  'source-map-js@1': '1.2.2',
  '@modelcontextprotocol/sdk@1': '1.32.2',
  '@grpc/grpc-js@1': '1.14.5',
  'proxy-addr@2': '2.0.8',
  'compression@1': '1.8.2',
  'body-parser@2': '2.4.0',
  'hono@4': '4.13.17',
  're2@1': '1.26.1',
  'protobufjs@7': '7.6.6',
  'qs@6': '6.16.1',
  'morgan@1': '1.12.1',
};
/** @param {string} current @param {string} target */
function minimum(current, target) {
  const parsed = /^([~^]?)(\d+)\.(\d+)\.(\d+)$/.exec(current);
  const next = target.split('.').map(Number);
  const major = next[0] ?? -1,
    minor = next[1] ?? -1,
    patch = next[2] ?? -1;
  if (!parsed || Number(parsed[2]) !== major)
    throw new Error(`Unsupported major/range: ${current} -> ${target}; review required.`);
  return Number(parsed[3]) > minor || (Number(parsed[3]) === minor && Number(parsed[4]) >= patch)
    ? current
    : `${parsed[1]}${target}`;
}
/** @template {Manifest} T @param {T} original @param {boolean} [root] @param {boolean} [bootstrap] */
export function planRepairs(original, root = true, bootstrap = false) {
  const manifest = structuredClone(original);
  /** @type {string[]} */ const changes = [];
  for (const section of ['dependencies', 'devDependencies']) {
    const deps = /** @type {Record<string, string> | undefined} */ (
      manifest[/** @type {'dependencies' | 'devDependencies'} */ (section)]
    );
    if (!deps) continue;
    for (const [name, target] of Object.entries(direct)) {
      if (!deps[name]) continue;
      const updated = minimum(deps[name], target);
      if (updated !== deps[name]) {
        changes.push(`${section}.${name}: ${deps[name]} -> ${updated}`);
        deps[name] = updated;
      }
    }
  }
  if (root && bootstrap) {
    const zod = manifest.dependencies?.['zod'];
    if (zod) {
      if (!['^3.24.1', '3.25.76'].includes(zod))
        throw new Error('Zod declaration differs from reviewed unused bootstrap dependency.');
      delete manifest.dependencies?.['zod'];
      changes.push(`dependencies.zod: ${zod} -> removed (reviewed unused dependency)`);
    }
    const pm2 = manifest.devDependencies?.['pm2'];
    if (pm2 && manifest.devDependencies) {
      const target = /^[~^]?6\.0\.14$/.test(pm2)
        ? '7.1.2'
        : /^([~^]?)7\./.test(pm2)
          ? minimum(pm2, '7.1.2')
          : undefined;
      if (!target)
        throw new Error(
          'PM2 declaration differs from reviewed 6.0.14 to 7.1.2 bootstrap migration.'
        );
      if (target !== pm2) {
        manifest.devDependencies['pm2'] = target;
        changes.push(`devDependencies.pm2: ${pm2} -> ${target} (reviewed major migration)`);
      }
    }
  }
  if (root) {
    manifest.pnpm ??= {};
    manifest.pnpm.overrides ??= {};
    for (const [name, target] of Object.entries(overrides)) {
      const current = manifest.pnpm.overrides[name];
      const updated = current ? minimum(current, target) : target;
      if (updated !== current) {
        changes.push(`pnpm.overrides.${name}: ${current ?? '(none)'} -> ${updated}`);
        manifest.pnpm.overrides[name] = updated;
      }
    }
  }
  return { manifest, changes };
}

/** @typedef {{advisories?: Record<string, {module_name?: string, severity?: string, github_advisory_id?: string, patched_versions?: string, findings?: {paths?: string[]}[]}>}} Audit */
/** @param {Audit} audit */
export function blockedAdvisories(audit) {
  return Object.values(audit.advisories ?? {})
    .filter((item) => ['high', 'critical'].includes(item.severity ?? ''))
    .map((item) => ({
      package: item.module_name,
      severity: item.severity,
      advisory: item.github_advisory_id,
      patched: item.patched_versions,
      paths: item.findings?.flatMap((finding) => finding.paths ?? []) ?? [],
    }));
}
/** @param {string[]} args */
function pnpm(args) {
  const result = spawnSync('pnpm', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}

/** @param {string} root */
export function assertUnusedZod(root) {
  for (const file of globSync(
    [
      '*.{ts,tsx,js,mjs,cjs}',
      'apps/**/*.{ts,tsx,js,mjs,cjs}',
      'packages/**/*.{ts,tsx,js,mjs,cjs}',
      'migrations/**/*.{ts,js,mjs}',
      'scripts/**/*.{mjs,js,cjs,ts}',
    ],
    { cwd: root, exclude: ['**/node_modules/**', '**/dist/**'] }
  )) {
    if (
      /(?:from\s*|(?:import|require)\s*\()\s*['"]zod(?:\/|['"])/.test(
        readFileSync(path.join(root, file), 'utf8')
      )
    ) {
      throw new Error(`Zod is used in ${file}; bootstrap removal requires review.`);
    }
  }
}

export function main() {
  if (process.argv.slice(2).some((arg) => !['--apply', '--bootstrap'].includes(arg)))
    throw new Error('Usage: pnpm run security:repair [--apply] [--bootstrap]');
  const root = path.resolve(import.meta.dirname, '../..');
  process.chdir(root);
  const apply = process.argv.includes('--apply');
  const bootstrap = process.argv.includes('--bootstrap');
  if (bootstrap) assertUnusedZod(root);
  const paths = [
    'package.json',
    ...globSync(['apps/*/package.json', 'packages/*/package.json', 'migrations/package.json']),
  ];
  for (const file of paths) {
    const original = JSON.parse(readFileSync(file, 'utf8'));
    const { manifest, changes } = planRepairs(original, file === 'package.json', bootstrap);
    changes.forEach((change) => process.stdout.write(`${file}: ${change}\n`));
    if (apply && changes.length) writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  if (!apply) {
    process.stdout.write(
      'Preview only. Use --apply to update reviewed packages, regenerate the lockfile and audit.\n'
    );
    return;
  }
  const install = pnpm(['install', '--ignore-scripts']);
  process.stdout.write(install.stdout);
  process.stderr.write(install.stderr);
  if (install.status !== 0)
    throw new Error('Dependency install failed; inspect working-tree changes.');
  const audit = pnpm(['audit', '--json']);
  const payload = JSON.parse(audit.stdout);
  if (!payload.advisories || !payload.metadata?.vulnerabilities)
    throw new Error('Audit failed without an advisory report.');
  const blocked = blockedAdvisories(payload);
  process.stdout.write(
    `${JSON.stringify({ vulnerabilities: payload.metadata?.vulnerabilities, blocked }, null, 2)}\n`
  );
  if (blocked.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
