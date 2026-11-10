import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

test(
  'bundled PM2 starts, reloads and stops a process in an isolated home',
  { timeout: 45000 },
  () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fa-pm2-smoke-'));
    const home = path.join(dir, 'pm2');
    const cli = require.resolve('pm2/bin/pm2');
    const env = { ...process.env, PM2_HOME: home, FA_PM2_HOME: home };
    /** @param {string[]} args */
    const pm2 = (args) => {
      const result = spawnSync(process.execPath, [cli, ...args], {
        env,
        encoding: 'utf8',
        timeout: 15000,
      });
      assert.equal(result.status, 0, `PM2 ${args[0]} failed: ${result.stderr}`);
      return result.stdout;
    };
    try {
      const script = path.join(dir, 'worker.cjs');
      writeFileSync(script, 'setInterval(() => {}, 1000);\n');
      pm2(['start', script, '--name', 'fa-web']);
      const before = JSON.parse(pm2(['jlist']));
      assert.equal(before.length, 1);
      assert.equal(before[0].pm2_env.status, 'online');
      assert.ok(before[0].pid > 0);
      const version = spawnSync(
        process.execPath,
        [path.join(import.meta.dirname, '../dev-host/ensure-pm2-version.mjs')],
        { env, encoding: 'utf8', timeout: 15000 }
      );
      assert.equal(version.status, 0, version.stderr);
      assert.match(
        version.stdout,
        new RegExp(
          `matches installed version ${require('pm2/package.json').version.replaceAll('.', '\\.')}`
        )
      );
      pm2(['reload', 'fa-web', '--update-env']);
      const after = JSON.parse(pm2(['jlist']));
      assert.equal(after[0].pm2_env.status, 'online');
      assert.notEqual(after[0].pid, before[0].pid);
      pm2(['stop', 'fa-web']);
      assert.equal(JSON.parse(pm2(['jlist']))[0].pm2_env.status, 'stopped');
    } finally {
      spawnSync(process.execPath, [cli, 'kill'], { env, stdio: 'ignore', timeout: 15000 });
      rmSync(dir, { recursive: true, force: true });
    }
  }
);
