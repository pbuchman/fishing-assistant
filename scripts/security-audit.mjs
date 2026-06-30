#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';

const command = 'pnpm';
const args = ['audit', '--audit-level', 'high'];

process.stdout.write('Running dependency security audit with high severity threshold.\n');

const result = spawnSync(command, args, { stdio: 'inherit' });

if (result.error) {
  process.stderr.write(`Unable to start pnpm audit: ${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
