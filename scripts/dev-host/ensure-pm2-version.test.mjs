import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureDaemonVersion } from './ensure-pm2-version.mjs';

test('does nothing when daemon already matches the installed version', async () => {
  let updated = false;
  await ensureDaemonVersion('7.1.2', {
    version: async () => '7.1.2',
    names: async () => [],
    update: async () => {
      updated = true;
    },
  });
  assert.equal(updated, false);
});

test('updates dedicated FA daemon and verifies its version', async () => {
  let current = '6.0.14';
  await ensureDaemonVersion('7.1.2', {
    version: async () => current,
    names: async () => ['fa-chat-service', 'fa-web'],
    update: async () => {
      current = '7.1.2';
    },
  });
  assert.equal(current, '7.1.2');
});

test('refuses migration when unrelated processes share the daemon', async () => {
  let updated = false;
  await assert.rejects(
    ensureDaemonVersion('7.1.2', {
      version: async () => '6.0.14',
      names: async () => ['fa-web', 'unrelated'],
      update: async () => {
        updated = true;
      },
    }),
    /unrelated/
  );
  assert.equal(updated, false);
});

test('fails when update does not produce the exact installed daemon', async () => {
  await assert.rejects(
    ensureDaemonVersion('7.1.2', {
      version: async () => '6.0.14',
      names: async () => ['fa-web'],
      update: async () => {},
    }),
    /version/
  );
});

test('requires explicit FA home before loading PM2', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['scripts/dev-host/ensure-pm2-version.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, FA_PM2_HOME: '' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Explicit absolute FA_PM2_HOME/);
  assert.doesNotMatch(result.stdout, /daemon|PM2 Successfully/);
});
