#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const allowedNames = new Set([
  'fa-chat-service',
  'fa-knowledge-service',
  'fa-llm-usage-service',
  'fa-user-service',
  'fa-web',
]);
/** @param {string} expected @param {{version: () => Promise<string>, names: () => Promise<string[]>, update: () => Promise<void>}} daemon */
export async function ensureDaemonVersion(expected, daemon) {
  if ((await daemon.version()) === expected) return;
  if ((await daemon.names()).some((name) => !allowedNames.has(name)))
    throw new Error('Refusing PM2 migration: unrelated process in FA daemon.');
  await daemon.update();
  if ((await daemon.version()) !== expected)
    throw new Error('PM2 daemon version does not match installed package after update.');
}

export async function main() {
  const home = process.env['FA_PM2_HOME'];
  // Check before importing PM2, whose module constructor can initialize a default home.
  if (!home || !path.isAbsolute(home))
    throw new Error('Explicit absolute FA_PM2_HOME is required.');
  process.env['PM2_HOME'] = home;
  const require = createRequire(import.meta.url);
  const pm2 =
    /** @type {typeof import('pm2') & {getVersion: (callback: (error: Error | null, value: string) => void) => void}} */ (
      require('pm2')
    );
  const expected = require('pm2/package.json').version;
  /** @returns {Promise<void>} */
  const connect = () =>
    new Promise((resolve, reject) =>
      pm2.connect((/** @type {Error | null} */ error) => (error ? reject(error) : resolve()))
    );
  /** @template T @param {(callback: (error: Error | null, value: T) => void) => void} operation @returns {Promise<T>} */
  const call = (operation) =>
    new Promise((resolve, reject) =>
      operation((error, value) => (error ? reject(error) : resolve(value)))
    );
  await connect();
  try {
    await ensureDaemonVersion(expected, {
      version: () => call((callback) => pm2.getVersion(callback)),
      names: async () => {
        const entries = await call((callback) => pm2.list(callback));
        return /** @type {{name: string}[]} */ (entries).map((entry) => entry.name);
      },
      update: async () => {
        pm2.disconnect();
        const result = spawnSync(process.execPath, [require.resolve('pm2/bin/pm2'), 'update'], {
          stdio: 'inherit',
          env: { ...process.env, PM2_HOME: home },
        });
        if (result.status !== 0) throw new Error('PM2 daemon update failed.');
        await connect();
      },
    });
    process.stdout.write(`FA PM2 daemon matches installed version ${expected}.\n`);
  } finally {
    pm2.disconnect();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
