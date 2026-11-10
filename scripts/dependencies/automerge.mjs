#!/usr/bin/env node
// This file runs only from the trusted base commit, never the pull request checkout.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { eligiblePatch, manifestPatchOnly } from './policy.mjs';

const repository = process.env['FA_GITHUB_REPOSITORY'] ?? '';
const ghEnv = { ...process.env, GH_TOKEN: process.env['FA_GITHUB_TOKEN'] ?? '' };
const event = JSON.parse(readFileSync(process.env['FA_GITHUB_EVENT_PATH'] ?? '', 'utf8'));
const number = event.pull_request.number;
const expectedSha = event.pull_request.head.sha;
/** @param {string} endpoint */
const api = (endpoint) =>
  JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', env: ghEnv }));
const pr = api(`repos/${repository}/pulls/${number}`);
// Pagination is mandatory: a workflow change after the first hundred files must still reject.
const files = JSON.parse(
  execFileSync(
    'gh',
    ['api', '--paginate', '--slurp', `repos/${repository}/pulls/${number}/files?per_page=100`],
    { encoding: 'utf8', env: ghEnv }
  )
).flat();
const input = {
  pr,
  repository,
  expectedSha,
  files,
  updateType: process.env['FA_UPDATE_TYPE'] ?? '',
  dependencyNames: process.env['FA_DEPENDENCY_NAMES'] ?? '',
};
if (!eligiblePatch(input)) {
  process.stdout.write('Not eligible for automatic patch merge; manual review required.\n');
  process.exit(0);
}
for (const { filename } of files) {
  if (!filename.endsWith('package.json')) continue;
  /** @param {string} ref */
  const manifest = (ref) => {
    const content = api(`repos/${repository}/contents/${filename}?ref=${ref}`);
    return JSON.parse(Buffer.from(content.content, 'base64').toString('utf8'));
  };
  if (!manifestPatchOnly(manifest(pr.base.sha), manifest(expectedSha))) {
    process.stdout.write(`Manifest needs manual review: ${filename}\n`);
    process.exit(0);
  }
}
// Refuse repositories without the aggregate required check. Never use --admin or approve PRs.
const protection = api(`repos/${repository}/branches/main`);
if (
  !protection.protected ||
  protection.protection?.required_status_checks?.enforcement_level !== 'everyone' ||
  !protection.protection.required_status_checks.checks?.some(
    (/** @type {{context: string, app_id: number}} */ check) =>
      check.context === 'ci' && check.app_id === 15368
  )
) {
  throw new Error('Protected main with enforced GitHub Actions required ci is mandatory.');
}
const current = api(`repos/${repository}/pulls/${number}`);
if (!eligiblePatch({ ...input, pr: current }))
  throw new Error('Pull request changed during policy checks.');
execFileSync(
  'gh',
  [
    'pr',
    'merge',
    String(number),
    '--repo',
    repository,
    '--auto',
    '--squash',
    '--match-head-commit',
    expectedSha,
  ],
  { stdio: 'inherit', env: ghEnv }
);
