#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';

/** @type {[string, string, string[]][]} */
const phases = [
  ['Verify service wiring', 'pnpm', ['run', 'verify:service-wiring']],
  ['Verify environment', 'pnpm', ['run', 'verify:env']],
  ['Security audit', 'pnpm', ['run', 'security:audit']],
  ['Secret scan', 'pnpm', ['run', 'security:secrets']],
  ['Typecheck', 'pnpm', ['run', 'typecheck']],
  ['Typecheck tests', 'pnpm', ['run', 'typecheck:tests']],
  ['Lint', 'pnpm', ['run', 'lint']],
  ['Static verification', 'pnpm', ['run', 'verify:static']],
  [
    'Runtime data baseline verifier tests',
    'pnpm',
    ['exec', 'vitest', 'run', 'scripts/__tests__/verify-data-baseline.test.ts'],
  ],
  ['Knowledge access verification', 'pnpm', ['run', 'verify:knowledge-access']],
  ['Observability verification', 'pnpm', ['run', 'verify:observability']],
  ['Ops tests', 'pnpm', ['run', 'test:ops']],
  ['Test coverage', 'pnpm', ['run', 'test:coverage']],
  ['Build', 'pnpm', ['run', 'build']],
  ['Format check', 'pnpm', ['run', 'format:check']],
];

for (const [index, phase] of phases.entries()) {
  const [name, command, args] = phase;
  process.stdout.write(`\n[${String(index + 1)}/${String(phases.length)}] ${name}\n`);
  const result = spawnSync(command, args, { stdio: 'inherit' });

  if (result.status !== 0) {
    process.stderr.write(`\nCI failed during phase: ${name}\n`);
    process.exit(result.status ?? 1);
  }
}

process.stdout.write('\nCI completed successfully.\n');
