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

/** @param {string} bin */
function isolatedPrerequisites(bin) {
  for (const command of ['git', 'curl', 'flock', 'readlink', 'mkdir', 'chmod']) {
    symlinkSync(
      execFileSync('/bin/sh', ['-c', `command -v ${command}`], { encoding: 'utf8' }).trim(),
      join(bin, command)
    );
  }
  symlinkSync(process.execPath, join(bin, 'node'));
  // These negative cases only check availability; reaching either tool is unexpected.
  for (const command of ['direnv', 'lsof']) {
    writeFileSync(join(bin, command), '#!/bin/bash\nexit 99\n', { mode: 0o755 });
  }
}

for (const failure of ['install', 'verify:env', 'build', 'none']) {
  test(`prepare ${failure === 'none' ? 'succeeds without activating' : `stops on ${failure} failure`}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'fa-deploy-'));
    try {
      const source = join(dir, 'source');
      const deploy = join(dir, 'deploy');
      const bin = join(dir, 'bin');
      const state = join(dir, 'state');
      mkdirSync(join(source, 'scripts/dev-host'), { recursive: true });
      mkdirSync(join(source, 'scripts/deploy'), { recursive: true });
      writeFileSync(join(source, 'scripts/deploy/deploy-dev.sh'), readFileSync(script));
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

test('executes checked-out deployment code after reset while retaining the lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fa-deploy-reexec-'));
  try {
    const source = join(dir, 'source');
    const deploy = join(dir, 'deploy');
    const bin = join(dir, 'bin');
    const state = join(dir, 'state');
    mkdirSync(join(source, 'scripts/dev-host'), { recursive: true });
    mkdirSync(join(source, 'scripts/deploy'), { recursive: true });
    mkdirSync(bin);
    writeFileSync(join(source, '.gitignore'), '.envrc\n.env.dev.local\napps/web/dist/\n');
    writeFileSync(join(source, 'scripts/dev-setup.mjs'), 'process.exit(0);\n');
    writeFileSync(
      join(source, 'scripts/dev-host/release-state.mjs'),
      readFileSync('scripts/dev-host/release-state.mjs')
    );
    const original = readFileSync(script, 'utf8');
    const deployScript = join(source, 'scripts/deploy/deploy-dev.sh');
    const version = (/** @type {string} */ marker) =>
      original.replace(
        '  stage install',
        `  stage install\n  printf '%s\\n' '${marker}' >> '${dir}/executed'\n  if flock -n '${state}/deploy.lock' true; then exit 99; fi`
      );
    writeFileSync(deployScript, version('old'));
    git('git', ['init', '-b', 'main'], source);
    git('git', ['add', '.'], source);
    const commit = () =>
      git(
        'git',
        [
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.invalid',
          'commit',
          '-am',
          'fixture',
        ],
        source
      );
    commit();
    git('git', ['clone', source, deploy], dir);
    writeFileSync(deployScript, version('target'));
    commit();
    const sha = git('git', ['rev-parse', 'HEAD'], source).trim();
    writeFileSync(join(deploy, '.envrc'), '');
    writeFileSync(join(deploy, '.env.dev.local'), '');
    writeFileSync(join(bin, 'direnv'), '#!/bin/bash\nshift 2\nexec "$@"\n', { mode: 0o755 });
    writeFileSync(
      join(bin, 'pnpm'),
      `#!/bin/bash
if [[ "$1" == --version ]]; then echo 10.29.3; exit; fi
printf '%s\\n' "$*" >> '${dir}/calls'
if [[ "$*" == 'run build' ]]; then mkdir -p apps/web/dist; echo fixture > apps/web/dist/index.html; fi
`,
      { mode: 0o755 }
    );
    execFileSync(
      '/bin/bash',
      [
        join(deploy, 'scripts/deploy/deploy-dev.sh'),
        '--branch',
        'main',
        '--sha',
        sha,
        '--prepare-only',
      ],
      {
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
      }
    );
    assert.equal(readFileSync(join(dir, 'executed'), 'utf8'), 'target\n');
    assert.equal(
      readFileSync(join(dir, 'calls'), 'utf8')
        .split('\n')
        .filter((line) => line === 'install --frozen-lockfile').length,
      1
    );
    assert.equal(existsSync(join(state, 'prepared.json')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects checked-out resume without an inherited deployment lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fa-deploy-no-lock-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    isolatedPrerequisites(bin);
    writeFileSync(join(bin, 'pnpm'), '#!/bin/bash\necho 10.29.3\n', { mode: 0o755 });
    const result = (() => {
      try {
        execFileSync(
          '/bin/bash',
          [
            script,
            '--branch',
            'main',
            '--sha',
            'a'.repeat(40),
            '--resume-after-checkout',
            '--previous-sha',
            'b'.repeat(40),
            '--prepare-only',
          ],
          {
            env: {
              ...process.env,
              PATH: bin,
              FA_DEV_STATE_DIR: join(dir, 'state'),
              FA_DEV_ORIGIN: 'http://test.invalid',
            },
            stdio: 'pipe',
          }
        );
        return '';
      } catch (error) {
        return String(error);
      }
    })();
    assert.match(result, /requires the inherited deployment lock/);
    assert.equal(existsSync(join(dir, 'state')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unsupported historical driver fails before resetting the existing checkout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fa-deploy-old-driver-'));
  try {
    const source = join(dir, 'source');
    const deploy = join(dir, 'deploy');
    const bin = join(dir, 'bin');
    mkdirSync(join(source, 'scripts/deploy'), { recursive: true });
    mkdirSync(bin);
    isolatedPrerequisites(bin);
    writeFileSync(join(source, '.gitignore'), '.envrc\n.env.dev.local\n');
    const driver = join(source, 'scripts/deploy/deploy-dev.sh');
    writeFileSync(driver, '#!/bin/bash\nexit 0\n');
    git('git', ['init', '-b', 'main'], source);
    git('git', ['add', '.'], source);
    const commit = () =>
      git(
        'git',
        [
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.invalid',
          'commit',
          '-am',
          'fixture',
        ],
        source
      );
    commit();
    const oldSha = git('git', ['rev-parse', 'HEAD'], source).trim();
    writeFileSync(driver, readFileSync(script));
    commit();
    const currentSha = git('git', ['rev-parse', 'HEAD'], source).trim();
    git('git', ['clone', source, deploy], dir);
    writeFileSync(join(deploy, '.envrc'), '');
    writeFileSync(join(deploy, '.env.dev.local'), '');
    writeFileSync(
      join(bin, 'pnpm'),
      '#!/bin/bash\nif [[ "$1" == --version ]]; then echo 10.29.3; exit; fi\nexit 99\n',
      { mode: 0o755 }
    );
    assert.throws(
      () =>
        execFileSync(
          '/bin/bash',
          [
            join(deploy, 'scripts/deploy/deploy-dev.sh'),
            '--branch',
            'main',
            '--sha',
            oldSha,
            '--prepare-only',
          ],
          {
            env: {
              ...process.env,
              PATH: bin,
              FA_DEV_SOURCE_REPO: source,
              FA_DEV_REMOTE_URL: source,
              FA_DEV_REPO_PATH: deploy,
              FA_DEV_STATE_DIR: join(dir, 'state'),
              FA_DEV_ORIGIN: 'http://test.invalid',
            },
            stdio: 'pipe',
          }
        ),
      /does not support the resume protocol; checkout unchanged/
    );
    assert.equal(git('git', ['rev-parse', 'HEAD'], deploy).trim(), currentSha);
    assert.equal(
      readFileSync(join(deploy, 'scripts/deploy/deploy-dev.sh'), 'utf8'),
      readFileSync(script, 'utf8')
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
