import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
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
