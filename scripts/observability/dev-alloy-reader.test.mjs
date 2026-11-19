import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./install-dev-alloy-reader.sh', import.meta.url));

test('DEV reader renders its own identity, retained log path and protected state', () => {
  const unit = execFileSync('bash', [script, '--render', '/home/example/.pm2-fa/logs'], {
    encoding: 'utf8',
  });
  assert.match(unit, /^User=fa-alloy$/m);
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
  const source = readFileSync(new URL('./install-alloy.sh', import.meta.url), 'utf8');
  assert.match(source, /if \[\[ "\$\{environment\}" == "prod" \]\]; then\s+grant_alloy_log_access/);
});
