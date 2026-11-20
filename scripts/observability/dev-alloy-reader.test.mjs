import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./install-dev-alloy-reader.sh', import.meta.url));
const installer = fileURLToPath(new URL('./install-alloy.sh', import.meta.url));

test('DEV reader renders its own identity, retained log path and protected state', () => {
  const unit = execFileSync('bash', [script, '--render', '/home/example/.pm2-fa/logs'], {
    encoding: 'utf8',
  });
  assert.match(unit, /^User=fa-alloy$/m);
  assert.doesNotMatch(unit, /^SupplementaryGroups=.*systemd-journal/m);
  assert.match(unit, /^InaccessiblePaths=-\/run\/docker.sock$/m);
  assert.match(unit, /^BindReadOnlyPaths=\/home\/example\/\.pm2-fa\/logs$/m);
  assert.match(unit, /--storage.path=\/var\/lib\/fa-alloy/);
});

test('the unit cannot interpolate a directive or a systemd specifier from a log path', () => {
  for (const path of ['/home/%n/logs', '/home/../tmp/logs', '/home/invalid\nExecStart=/x/logs']) {
    assert.notEqual(spawnSync('bash', [script, '--render', path]).status, 0);
  }
});

test('the DEV install does not grant the shared telemetry account Docker access', () => {
  const source = readFileSync(installer, 'utf8');
  assert.match(source, /if \[\[ "\$\{environment\}" == "prod" \]\]; then\s+grant_alloy_log_access/);
});

test('the DEV installer rejects a checkout before doing privileged setup', () => {
  const result = spawnSync(
    '/bin/bash',
    [
      installer,
      '--environment',
      'dev',
      '--host',
      'dev-host',
      '--pm2-log-dir',
      '/home/example/logs',
    ],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run the DEV installer from a verified root-owned release/);
});

test('the DEV bootstrap verifies the private archive copy before executing it', (t) => {
  const runbook = readFileSync(
    new URL('../../docs/operations/fa-observability-runbook.md', import.meta.url),
    'utf8'
  );
  const dev = runbook.match(/^## Install On DEV\n([\s\S]*?)^## DEV Smoke$/m)?.[1];
  assert.ok(dev, 'missing DEV install instructions');
  assert.doesNotMatch(dev, /sudo scripts\/observability\//);
  const command = dev.match(/^sudo (\/usr\/bin\/env -i[\s\S]+?) < "\$fa_archive"$/m)?.[1];
  assert.ok(command, 'missing DEV bootstrap command');

  const fixture = mkdtempSync(join(tmpdir(), 'fa-dev-install-test-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const components = join(fixture, 'artifact', 'scripts', 'observability');
  mkdirSync(components, { recursive: true });
  writeFileSync(join(components, 'install-alloy.sh'), 'printf "approved installer ran\\n"\n');
  const archive = execFileSync('tar', ['-C', join(fixture, 'artifact'), '-cf', '-', 'scripts']);
  const digest = createHash('sha256').update(archive).digest('hex');
  const bootstrap = command.replace(
    '/var/lib/fa-observability-install.',
    join(fixture, 'fa-observability-install.')
  );
  /** @param {Buffer} input */
  const execBootstrap = (input) =>
    spawnSync('/bin/bash', ['-c', bootstrap], {
      input,
      encoding: 'utf8',
      env: {
        fa_digest: digest,
        fa_revision: 'a'.repeat(40),
        fa_pm2_logs: '/home/example/logs',
      },
    });
  const rejected = execBootstrap(Buffer.concat([archive, Buffer.from('changed')]));
  assert.equal(rejected.status, 1);
  assert.doesNotMatch(rejected.stdout, /approved installer ran/);
  const approved = execBootstrap(archive);
  assert.equal(approved.status, 0, approved.stderr);
  assert.match(approved.stdout, /approved installer ran/);
});

test('the DEV journal view exposes only the Fishing Assistant namespace', () => {
  const journal = fileURLToPath(new URL('./install-dev-journal-scope.sh', import.meta.url));
  const reader = execFileSync('bash', [journal, '--render-reader'], { encoding: 'utf8' });
  const producer = execFileSync('bash', [journal, '--render-source'], { encoding: 'utf8' });
  assert.match(reader, /^SupplementaryGroups=$/m);
  assert.match(reader, /^TemporaryFileSystem=\/var\/log\/journal:ro$/m);
  assert.match(
    reader,
    /^BindReadOnlyPaths=\/var\/log\/journal\/%m\.fa-dev:\/var\/log\/journal\/%m$/m
  );
  assert.match(reader, /^InaccessiblePaths=-\/run\/log\/journal$/m);
  assert.match(producer, /^LogNamespace=fa-dev$/m);
});
