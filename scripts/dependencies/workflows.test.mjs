import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const ci = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');

test('actual required aggregate shell fails on every missing or non-success job', () => {
  assert.match(ci, / {2}ci:\n\s+if: \$\{\{ always\(\) \}\}\n\s+needs: \[quality, audit\]/);
  const aggregate = ci.split('      - name: Require every gate to succeed')[1] ?? '';
  const shell = (aggregate.split('run: |')[1] ?? '').trim();
  assert.ok(shell.length > 0);
  for (const quality of ['success', 'failure', 'skipped', 'cancelled', '']) {
    for (const audit of ['success', 'failure', 'skipped', 'cancelled', '']) {
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', shell], {
        env: { ...process.env, FA_QUALITY_RESULT: quality, FA_AUDIT_RESULT: audit },
      });
      assert.equal(
        result.status === 0,
        quality === 'success' && audit === 'success',
        `quality=${quality},audit=${audit}`
      );
    }
  }
});

test('independent audit preserves full quality/prod and local audit contracts', () => {
  assert.match(ci, / {2}quality:/);
  assert.match(ci, /pnpm run ci:quality/);
  assert.match(ci, /pnpm run ci:prod:extras/);
  assert.match(ci, / {2}audit:/);
  assert.match(ci, /pnpm run security:audit/);
  const script = readFileSync(path.join(root, 'scripts/ci.mjs'), 'utf8');
  assert.match(script, /\['Security audit', 'pnpm', \['run', 'security:audit'\]\]/);
  assert.match(script, /process.argv.includes\('--without-audit'\)/);
  const deploy = readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(deploy, /ci\.yml\/runs\?head_sha=\$\{FA_DEPLOY_SHA\}&status=success/);
  assert.match(deploy, /run: pnpm run ci:prod/);
});

test('privileged workflow only checks out trusted base, without PR install or code execution', () => {
  const workflow = readFileSync(
    path.join(root, '.github/workflows/dependabot-automerge.yml'),
    'utf8'
  );
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.base.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /ref:.*head|pnpm install|npm install|--admin|--approve/);
  assert.match(workflow, /dependabot\/fetch-metadata@[a-f0-9]{40}/);
});

test('release-age exceptions are exact reviewed versions, never package-wide or wildcard', () => {
  const workspace = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  // Historical security-bootstrap approvals from 2489183. Keep these independent
  // of current manifests/lockfiles so later patch updates do not invalidate them.
  const reviewed = new Set([
    '@rolldown/binding-android-arm64@1.1.7',
    '@rolldown/binding-darwin-arm64@1.1.7',
    '@rolldown/binding-darwin-x64@1.1.7',
    '@rolldown/binding-freebsd-x64@1.1.7',
    '@rolldown/binding-linux-arm-gnueabihf@1.1.7',
    '@rolldown/binding-linux-arm64-gnu@1.1.7',
    '@rolldown/binding-linux-arm64-musl@1.1.7',
    '@rolldown/binding-linux-ppc64-gnu@1.1.7',
    '@rolldown/binding-linux-s390x-gnu@1.1.7',
    '@rolldown/binding-linux-x64-gnu@1.1.7',
    '@rolldown/binding-linux-x64-musl@1.1.7',
    '@rolldown/binding-openharmony-arm64@1.1.7',
    '@rolldown/binding-wasm32-wasi@1.1.7',
    '@rolldown/binding-win32-arm64-msvc@1.1.7',
    '@rolldown/binding-win32-x64-msvc@1.1.7',
    'fast-json-stringify@7.3.5',
    'rolldown@1.1.7',
    'stream-chain@4.4.2',
    'stream-json@3.9.0',
    'ws@8.22.2',
    'vite@8.1.7',
  ]);
  /** @param {string} config */
  const check = (config) => {
    const section = config.split('minimumReleaseAgeExclude:')[1] ?? '';
    const exceptions = [...section.matchAll(/^\s+-\s+(.+)$/gm)].map((match) =>
      (match[1] ?? '').replace(/^['"]|['"]$/g, '')
    );
    assert.ok(
      exceptions.length > 0,
      'reviewed bootstrap versions must remain resolvable during Dependabot cooldown'
    );
    assert.doesNotMatch(config, /minimumReleaseAge:\s*(?:0|false)\b/);
    for (const exception of exceptions) {
      assert.match(exception, /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+@\d+\.\d+\.\d+$/);
      assert.ok(
        reviewed.has(exception),
        `exception must match the reviewed bootstrap approval: ${exception}`
      );
    }
  };
  check(workspace);
  assert.throws(() => check(workspace.replace("'vite@8.1.7'", 'vite')));
  assert.throws(() => check(workspace.replace("'vite@8.1.7'", "'vite@*'")));
  assert.throws(() => check(workspace.replace("'vite@8.1.7'", "'vite@8.1.8'")));
  assert.throws(() => check(`${workspace}minimumReleaseAge: 0\n`));
});

test('historical bootstrap exclusions survive newer manifest and lock versions', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'fa-cooldown-future-patch-'));
  try {
    mkdirSync(path.join(fixture, 'scripts/dependencies'), { recursive: true });
    mkdirSync(path.join(fixture, '.github/workflows'), { recursive: true });
    writeFileSync(path.join(fixture, '.github/workflows/ci.yml'), ci);
    writeFileSync(
      path.join(fixture, 'pnpm-workspace.yaml'),
      readFileSync(path.join(root, 'pnpm-workspace.yaml'))
    );
    writeFileSync(
      path.join(fixture, 'package.json'),
      JSON.stringify({ dependencies: { vite: '8.1.8' } })
    );
    const futureLock = readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8')
      .replaceAll('8.1.7', '8.1.8')
      .replaceAll('1.1.7', '1.1.8')
      .replaceAll('7.3.5', '7.3.6')
      .replaceAll('4.4.2', '4.4.3')
      .replaceAll('3.9.0', '3.9.1')
      .replaceAll('8.22.2', '8.22.3');
    assert.doesNotMatch(futureLock, /vite@8\.1\.7|@rolldown\/binding-[^\n]+@1\.1\.7/);
    assert.doesNotMatch(
      futureLock,
      /stream-chain@4\.4\.2|stream-json@3\.9\.0|fast-json-stringify@7\.3\.5|ws@8\.22\.2/
    );
    writeFileSync(path.join(fixture, 'pnpm-lock.yaml'), futureLock);
    const testFile = path.join(fixture, 'scripts/dependencies/workflows.test.mjs');
    writeFileSync(testFile, readFileSync(import.meta.filename));
    const result = spawnSync(
      process.execPath,
      ['--test', '--test-name-pattern=^release-age exceptions', testFile],
      {
        encoding: 'utf8',
        env: Object.fromEntries(
          Object.entries(process.env).filter(([name]) => !name.startsWith('NODE_TEST_'))
        ),
      }
    );
    assert.match(result.stdout, /release-age exceptions are exact reviewed versions/);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
