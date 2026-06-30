#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const renderedConfigPath = '/tmp/fa-prod-ecosystem.json';
const ecosystemPath = resolve(process.cwd(), 'ecosystem.config.prod.cjs');

process.env['FA_PROD_ENV_FILE'] ??= '/etc/fa/.env.prod';

const ecosystem = require(ecosystemPath);
if (
  ecosystem === null ||
  typeof ecosystem !== 'object' ||
  !Array.isArray(/** @type {{ apps?: unknown }} */ (ecosystem).apps)
) {
  throw new Error('ecosystem.config.prod.cjs must export an apps array');
}

writeFileSync(renderedConfigPath, `${JSON.stringify(ecosystem, null, 2)}\n`, { mode: 0o600 });
chmodSync(renderedConfigPath, 0o600);

const result = spawnSync('pnpm', ['exec', 'pm2-runtime', renderedConfigPath], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
