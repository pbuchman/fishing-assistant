#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';

const smokeRuns = [
  ['vitest', 'run', '--root', '.', 'apps/chat-service/src/routes/chatRouteAuth.test.ts'],
  [
    'vitest',
    'run',
    '--root',
    '.',
    'apps/chat-service/src/routes/chatRoutes.test.ts',
    '--testNamePattern',
    'streams chat responses as SSE events and persists the final assistant message',
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
