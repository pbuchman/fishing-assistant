#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';

const smokeRuns = [
  [
    'vitest',
    'run',
    '--root',
    '.',
    'apps/chat-service/src/services.test.ts',
    '--testNamePattern',
    'wires runtime chat providers to nested usage events with separate components',
  ],
  [
    'vitest',
    'run',
    '--root',
    '.',
    'apps/knowledge-service/src/services.test.ts',
    '--testNamePattern',
    'wires runtime embedding providers to nested usage events with required attribution',
  ],
];

for (const args of smokeRuns) {
  const result = spawnSync('pnpm', args, {
    cwd: new URL('../../', import.meta.url),
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
