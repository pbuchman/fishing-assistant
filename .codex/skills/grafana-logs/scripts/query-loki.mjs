#!/usr/bin/env node
/* eslint-disable no-console */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatLokiResponse,
  parseQueryArgs,
  queryLoki,
  redactSensitiveText,
} from './lib/loki-query.mjs';

const scriptPath = fileURLToPath(import.meta.url);

function usage() {
  return [
    'Usage:',
    '  node .codex/skills/grafana-logs/scripts/query-loki.mjs --env prod --service chat-service --since 30m --filter "error" --limit 50',
    '  node .codex/skills/grafana-logs/scripts/query-loki.mjs --env dev --query \'{app="fishing-assistant", env="dev"} |= "error"\'',
  ].join('\n');
}

export async function main(argv = process.argv) {
  const options = parseQueryArgs(argv);
  if (options.help === true) {
    console.log(usage());
    return;
  }

  const result = await queryLoki(options);
  console.log(formatLokiResponse(result));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Loki query failed: ${redactSensitiveText(message)}`);
    process.exit(1);
  });
}
