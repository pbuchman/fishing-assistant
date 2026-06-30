#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';

const services = ['llm-usage-service', 'knowledge-service', 'chat-service', 'user-service'];

for (const service of services) {
  process.stdout.write(`\n=== Build ${service} ===\n`);
  const result = spawnSync('node', ['scripts/build-service.mjs', service], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.stdout.write('\nAll services built successfully.\n');
