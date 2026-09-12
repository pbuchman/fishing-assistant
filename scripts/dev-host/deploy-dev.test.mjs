import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/deploy/deploy-dev.sh');
/** @param {string} command @param {string[]} args @param {string} cwd */
const git = (command, args, cwd) =>
  execFileSync(command, args, { cwd, stdio: 'pipe', encoding: 'utf8' });

for (const failure of ['install', 'verify:env', 'build', 'none']) {
  test(`prepare ${failure === 'none' ? 'succeeds without activating' : `stops on ${failure} failure`}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'fa-deploy-'));
    try {
      const source = join(dir, 'source');
      const deploy = join(dir, 'deploy');
      const bin = join(dir, 'bin');
      const state = join(dir, 'state');
      mkdirSync(join(source, 'scripts/dev-host'), { recursive: true });
      mkdirSync(bin);
      writeFileSync(join(source, '.gitignore'), '.envrc\n.env.dev.local\napps/web/dist/\n');
      writeFileSync(join(source, 'scripts/dev-setup.mjs'), 'process.exit(0);\n');
      writeFileSync(
        join(source, 'scripts/dev-host/release-state.mjs'),
        readFileSync('scripts/dev-host/release-state.mjs')
      );
      git('git', ['init', '-b', 'main'], source);
      git('git', ['add', '.'], source);
      git(
        'git',
        [
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.invalid',
          'commit',
          '-m',
          'fixture',
        ],
        source
      );
      const sha = git('git', ['rev-parse', 'HEAD'], source).trim();
      git('git', ['clone', source, deploy], dir);
      writeFileSync(join(deploy, '.envrc'), '');
      writeFileSync(join(deploy, '.env.dev.local'), '');
      writeFileSync(join(bin, 'direnv'), '#!/bin/bash\nshift 2\nexec "$@"\n', { mode: 0o755 });
      writeFileSync(
        join(bin, 'pnpm'),
        `#!/bin/bash
if [[ "$1" == --version ]]; then echo 10.29.3; exit; fi
printf '%s\\n' "$*" >> '${dir}/calls'
if [[ "$*" == *'${failure}'* ]]; then exit 7; fi
if [[ "$*" == 'run build' ]]; then mkdir -p apps/web/dist; echo fixture > apps/web/dist/index.html; fi
`,
        { mode: 0o755 }
      );
      let failed = false;
      try {
        execFileSync('/bin/bash', [script, '--branch', 'main', '--sha', sha, '--prepare-only'], {
          env: {
            ...process.env,
            PATH: `${bin}:${process.env['PATH']}`,
            FA_DEV_SOURCE_REPO: source,
            FA_DEV_REMOTE_URL: source,
            FA_DEV_REPO_PATH: deploy,
            FA_DEV_STATE_DIR: state,
            FA_DEV_ORIGIN: 'http://test.invalid',
          },
          stdio: 'pipe',
        });
      } catch {
        failed = true;
      }
      assert.equal(failed, failure !== 'none');
      const calls = readFileSync(join(dir, 'calls'), 'utf8');
      assert.doesNotMatch(calls, /pm2/);
      assert.equal(existsSync(join(state, 'prepared.json')), failure === 'none');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('missing pnpm fails before checkout or state mutation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fa-no-pnpm-'));
  try {
    for (const command of ['git', 'curl', 'node', 'flock']) {
      symlinkSync(
        execFileSync('/bin/sh', ['-c', `command -v ${command}`], { encoding: 'utf8' }).trim(),
        join(dir, command)
      );
    }
    writeFileSync(join(dir, 'direnv'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    assert.throws(
      () =>
        execFileSync('/bin/bash', [script, '--branch', 'main', '--sha', 'a'.repeat(40)], {
          env: { PATH: dir, HOME: dir },
          stdio: 'pipe',
        }),
      /pnpm is required/
    );
    assert.equal(existsSync(join(dir, 'deploy')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
