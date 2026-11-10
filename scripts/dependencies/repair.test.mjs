import assert from 'node:assert/strict';
import test from 'node:test';
import { planRepairs, blockedAdvisories } from './repair.mjs';

test('plans only explicit same-major repairs and is idempotent', () => {
  const manifest = {
    dependencies: { fastify: '^5.6.2', unrelated: '1.0.0' },
    devDependencies: { 'firebase-tools': '15.1.0', pm2: '^6.0.14' },
    pnpm: { overrides: { undici: '6.27.0', vite: '8.0.16' } },
  };
  const result = planRepairs(manifest);
  assert.equal(result.manifest.dependencies.fastify, '^5.12.8');
  assert.equal(result.manifest.dependencies.unrelated, '1.0.0');
  assert.equal(result.manifest.devDependencies['firebase-tools'], '15.35.0');
  assert.equal(result.manifest.devDependencies.pm2, '^6.0.14');
  assert.equal(result.manifest.pnpm.overrides.undici, '6.29.1');
  assert.ok(result.changes.length > 0);
  assert.deepEqual(planRepairs(result.manifest).changes, []);
  assert.equal(manifest.dependencies.fastify, '^5.6.2');
});

test('rejects cross-major/unsupported ranges instead of forcing a migration', () => {
  assert.throws(() => planRepairs({ dependencies: { fastify: '^4.0.0' } }), /major|range/);
  assert.throws(
    () => planRepairs({ dependencies: { fastify: 'https://untrusted/package' } }),
    /major|range/
  );
  assert.throws(() => planRepairs({ pnpm: { overrides: { undici: '7.0.0' } } }), /major|range/);
});

test('does not downgrade versions above the reviewed minimum', () => {
  const result = planRepairs({ dependencies: { fastify: '^5.99.0' } });
  assert.equal(result.manifest.dependencies.fastify, '^5.99.0');
});

test('reports every remaining high/critical advisory, including unknown packages', () => {
  const audit = {
    advisories: {
      1: {
        module_name: 'unknown',
        severity: 'critical',
        github_advisory_id: 'GHSA-test',
        patched_versions: '<0.0.0',
        findings: [{ paths: ['.>unknown'] }],
      },
      2: { module_name: 'pm2', severity: 'low' },
    },
  };
  assert.deepEqual(blockedAdvisories(audit), [
    {
      package: 'unknown',
      severity: 'critical',
      advisory: 'GHSA-test',
      patched: '<0.0.0',
      paths: ['.>unknown'],
    },
  ]);
});

test('reviewed bootstrap alone removes unused root Zod and migrates known PM2 6', () => {
  const original = { dependencies: { zod: '^3.24.1' }, devDependencies: { pm2: '^6.0.14' } };
  assert.equal(planRepairs(original).manifest.dependencies.zod, '^3.24.1');
  assert.equal(planRepairs(original).manifest.devDependencies.pm2, '^6.0.14');
  const bootstrap = planRepairs(original, true, true);
  assert.equal(bootstrap.manifest.dependencies.zod, undefined);
  assert.equal(bootstrap.manifest.devDependencies.pm2, '7.1.2');
  assert.deepEqual(planRepairs(bootstrap.manifest, true, true).changes, []);
  assert.throws(() => planRepairs({ dependencies: { zod: '^4.0.0' } }, true, true), /Zod/);
  assert.throws(() => planRepairs({ devDependencies: { pm2: '^5.0.0' } }, true, true), /PM2/);
});

test('bootstrap refuses to remove Zod when a source import exists', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { assertUnusedZod } = await import('./repair.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'fa-zod-'));
  try {
    mkdirSync(join(dir, 'apps/example/src'), { recursive: true });
    writeFileSync(
      join(dir, 'apps/example/src/schema.ts'),
      ['import { z } from', "'zod';\n"].join(' ')
    );
    assert.throws(() => assertUnusedZod(dir), /Zod is used/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
