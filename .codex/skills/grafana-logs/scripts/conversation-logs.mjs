#!/usr/bin/env node
/* eslint-disable no-console */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  escapeLogqlString,
  formatLokiResponse,
  parseDurationMs,
  queryLoki,
  redactSensitiveText,
} from './lib/loki-query.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const services = ['chat-service', 'knowledge-service', 'llm-usage-service'];
const maxWindowMs = 2 * 60 * 60 * 1000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const modelPattern = /^[A-Za-z0-9._:/+-]{1,128}$/u;

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  throw new Error(message);
}

/**
 * @param {string[] } args
 * @param {number} index
 * @param {string} flag
 * @returns {string}
 */
function readRequiredValue(args, index, flag) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    fail(`${flag} requires a value`);
  }
  return value;
}

/**
 * @param {number} windowMs
 * @returns {void}
 */
function assertWindowAllowed(windowMs) {
  if (!Number.isFinite(windowMs) || windowMs <= 0 || windowMs > maxWindowMs) {
    fail('time window must not exceed 2h');
  }
}

/**
 * @param {string[]} argv
 * @returns {{
 *   conversationId: string,
 *   env: 'dev' | 'prod',
 *   messageId?: string,
 *   model?: string,
 *   around?: string,
 *   windowMs: number,
 *   limit: number,
 *   help?: boolean,
 * }}
 */
export function parseConversationArgs(argv) {
  const args = argv.slice(2);
  const conversationId = args[0];
  if (conversationId === '-h' || conversationId === '--help') {
    return /** @type {ReturnType<typeof parseConversationArgs>} */ ({ help: true });
  }
  if (
    typeof conversationId !== 'string' ||
    conversationId.length === 0 ||
    conversationId.startsWith('--')
  ) {
    fail('conversationId is required');
  }

  /** @type {Record<string, unknown>} */
  const parsed = {
    conversationId,
    windowMs: 15 * 60 * 1000,
    limit: 50,
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--env') {
      parsed.env = readRequiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--message-id') {
      parsed.messageId = readRequiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--model') {
      parsed.model = readRequiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--around') {
      parsed.around = readRequiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--window') {
      parsed.windowMs = parseDurationMs(readRequiredValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--limit') {
      parsed.limit = Number(readRequiredValue(args, index, arg));
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg ?? ''}`);
  }

  if (parsed.env !== 'dev' && parsed.env !== 'prod') {
    fail('--env must be dev or prod');
  }
  assertUuid('conversationId', String(parsed.conversationId));
  if (typeof parsed.messageId === 'string') {
    assertUuid('message-id', parsed.messageId);
  }
  if (typeof parsed.model === 'string' && !modelPattern.test(parsed.model)) {
    fail(`model must match ${modelPattern.source}`);
  }
  assertWindowAllowed(Number(parsed.windowMs));
  if (!Number.isInteger(parsed.limit) || Number(parsed.limit) < 1 || Number(parsed.limit) > 200) {
    fail('--limit must be between 1 and 200');
  }

  return /** @type {ReturnType<typeof parseConversationArgs>} */ (parsed);
}

/**
 * @param {string} name
 * @param {string} value
 * @returns {void}
 */
function assertUuid(name, value) {
  if (!uuidPattern.test(value)) {
    fail(`${name} must be a UUID`);
  }
}

/**
 * @param {string[]} values
 * @returns {string}
 */
function buildLineFilters(values) {
  return values
    .filter((value) => value.length > 0)
    .map((value) => `|= "${escapeLogqlString(value)}"`)
    .join(' ');
}

/**
 * @param {'dev' | 'prod'} env
 * @param {string} service
 * @returns {string}
 */
function buildServiceSelector(env, service) {
  return `{app="fishing-assistant", env="${env}", service=~"${service}|services"}`;
}

/**
 * @param {string} service
 * @returns {string}
 */
function buildJsonServiceFilter(service) {
  return `|= "${escapeLogqlString(`"service":"${service}"`)}"`;
}

/**
 * @param {ReturnType<typeof parseConversationArgs>} options
 * @param {string} service
 * @param {string[]} terms
 * @returns {string}
 */
function buildServiceConversationQuery(options, service, terms) {
  return `${buildServiceSelector(options.env, service)} ${buildJsonServiceFilter(service)} ${buildLineFilters(terms)}`;
}

/**
 * @param {ReturnType<typeof parseConversationArgs>} options
 * @returns {Array<{ service: string, query: string }>}
 */
export function buildConversationQueries(options) {
  const focusedTerms = [options.messageId ?? '', options.model ?? ''].filter(
    (term) => term.length > 0
  );

  return services.flatMap((service) => {
    const primary = {
      service,
      query: buildServiceConversationQuery(options, service, [options.conversationId]),
    };

    if (focusedTerms.length === 0) {
      return [primary];
    }

    return [
      primary,
      {
        service: `${service} focused`,
        query: buildServiceConversationQuery(options, service, [
          options.conversationId,
          ...focusedTerms,
        ]),
      },
    ];
  });
}

/**
 * @param {ReturnType<typeof parseConversationArgs>} options
 * @returns {{ start?: Date, end?: Date, sinceMs?: number }}
 */
function timeOptions(options) {
  if (typeof options.around !== 'string' || options.around.length === 0) {
    return { sinceMs: options.windowMs };
  }

  const center = new Date(options.around);
  if (Number.isNaN(center.getTime())) {
    fail(`invalid --around timestamp: ${options.around}`);
  }

  const halfWindow = options.windowMs / 2;
  return {
    start: new Date(center.getTime() - halfWindow),
    end: new Date(center.getTime() + halfWindow),
  };
}

function usage() {
  return [
    'Usage:',
    '  node .codex/skills/grafana-logs/scripts/conversation-logs.mjs <conversationId> --env prod --around 2026-06-21T07:23:08Z --window 15m --message-id <id> --model <model>',
  ].join('\n');
}

export async function main(argv = process.argv) {
  const options = parseConversationArgs(argv);
  if (options.help === true) {
    console.log(usage());
    return;
  }

  const pieces = [];
  const queries = buildConversationQueries(options);
  const bounds = timeOptions(options);

  for (const { service, query } of queries) {
    const result = await queryLoki({
      env: options.env,
      query,
      limit: options.limit,
      ...bounds,
    });
    pieces.push(`Service: ${service}\n${formatLokiResponse(result)}`);
  }

  console.log(pieces.join('\n'));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Conversation log query failed: ${redactSensitiveText(message)}`);
    process.exit(1);
  });
}
