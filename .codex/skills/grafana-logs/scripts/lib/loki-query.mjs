import { execFileSync } from 'node:child_process';

const supportedEnvironments = new Set(['dev', 'prod']);
const faAppSelector = 'app="fishing-assistant"';
const defaultSinceMs = 15 * 60 * 1000;
const maxWindowMs = 2 * 60 * 60 * 1000;
const defaultLimit = 50;
const maxLimit = 200;
const labelValuePattern = /^[A-Za-z0-9_.-]+$/u;
const sensitiveFieldNames = new Set([
  'authorization',
  'apiKey',
  'api_key',
  'basicAuthPassword',
  'clientEmail',
  'clientId',
  'client_email',
  'client_id',
  'chunk',
  'content',
  'credentials',
  'evidence',
  'input',
  'internalAuthToken',
  'key',
  'messages',
  'password',
  'privateKey',
  'privateKeyId',
  'private_key',
  'private_key_id',
  'prompt',
  'question',
  'quote',
  'retrieval',
  'secret',
  'sourceText',
  'system',
  'token',
  'user',
]);

const sensitiveKeyFragments = [
  'apikey',
  'authorization',
  'basicauth',
  'clientemail',
  'clientid',
  'credential',
  'internalauth',
  'password',
  'privatekey',
  'secret',
  'serviceaccount',
  'token',
  'x509cert',
];

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
 * @param {string} value
 * @returns {number}
 */
export function parseDurationMs(value) {
  const match = /^(?<amount>[1-9][0-9]*)(?<unit>ms|s|m|h)$/u.exec(value);
  if (match?.groups === undefined) {
    fail('duration must use ms, s, m, or h, for example 15m');
  }

  const amount = Number(match.groups.amount);
  const unit = match.groups.unit;
  const multiplier = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60000 : 3600000;
  return amount * multiplier;
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
 * @param {string} value
 * @returns {Date}
 */
function parseDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    fail(`invalid timestamp: ${value}`);
  }
  return parsed;
}

/**
 * @param {string[]} argv
 * @returns {{
 *   env: 'dev' | 'prod',
 *   service?: string,
 *   source?: string,
 *   sinceMs?: number,
 *   start?: Date,
 *   end?: Date,
 *   filter?: string,
 *   limit: number,
 *   query?: string,
 *   help?: boolean,
 * }}
 */
export function parseQueryArgs(argv) {
  const args = argv.slice(2);
  /** @type {Record<string, unknown>} */
  const parsed = {
    sinceMs: defaultSinceMs,
    limit: defaultLimit,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--env') {
      parsed.env = readRequiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--service') {
      parsed.service = readRequiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--source') {
      parsed.source = readRequiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--since') {
      parsed.sinceMs = parseDurationMs(readRequiredValue(args, index, arg));
      delete parsed.start;
      delete parsed.end;
      index += 1;
      continue;
    }
    if (arg === '--start') {
      parsed.start = parseDate(readRequiredValue(args, index, arg));
      delete parsed.sinceMs;
      index += 1;
      continue;
    }
    if (arg === '--end') {
      parsed.end = parseDate(readRequiredValue(args, index, arg));
      delete parsed.sinceMs;
      index += 1;
      continue;
    }
    if (arg === '--filter') {
      parsed.filter = readRequiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--limit') {
      parsed.limit = Number(readRequiredValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--query') {
      parsed.query = readRequiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
      continue;
    }

    fail(`Unknown argument: ${arg ?? ''}`);
  }

  if (parsed.help === true) {
    return /** @type {ReturnType<typeof parseQueryArgs>} */ (parsed);
  }

  if (typeof parsed.env !== 'string' || !supportedEnvironments.has(parsed.env)) {
    fail('--env must be dev or prod');
  }

  if (
    typeof parsed.limit !== 'number' ||
    !Number.isInteger(parsed.limit) ||
    parsed.limit < 1 ||
    parsed.limit > maxLimit
  ) {
    fail('--limit must be between 1 and 200');
  }

  if (parsed.sinceMs !== undefined) {
    assertWindowAllowed(Number(parsed.sinceMs));
  } else {
    const start = parsed.start instanceof Date ? parsed.start : undefined;
    const end = parsed.end instanceof Date ? parsed.end : new Date();
    if (start === undefined) {
      fail('--start is required when --end is provided');
    }
    assertWindowAllowed(end.getTime() - start.getTime());
    parsed.start = start;
    parsed.end = end;
  }

  if (typeof parsed.query === 'string') {
    parsed.query = validateRawQuery(parsed.query, parsed.env);
  }

  return /** @type {ReturnType<typeof parseQueryArgs>} */ (parsed);
}

/**
 * @param {string} name
 * @param {string | undefined} value
 * @returns {void}
 */
function assertLabelValue(name, value) {
  if (value !== undefined && !labelValuePattern.test(value)) {
    fail(`${name} must match ${labelValuePattern.source}`);
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
export function escapeLogqlString(value) {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

/**
 * @param {{ env: string, service?: string, source?: string, filter?: string }} options
 * @returns {string}
 */
export function buildLogQuery(options) {
  if (!supportedEnvironments.has(options.env)) {
    fail('--env must be dev or prod');
  }
  assertLabelValue('service', options.service);
  assertLabelValue('source', options.source);

  const selectors = [faAppSelector, `env="${options.env}"`];
  if (options.service !== undefined) {
    selectors.push(`service="${options.service}"`);
  }
  if (options.source !== undefined) {
    selectors.push(`source="${options.source}"`);
  }

  const selector = `{${selectors.join(', ')}}`;
  return typeof options.filter === 'string' && options.filter.length > 0
    ? `${selector} |~ "${escapeLogqlString(options.filter)}"`
    : selector;
}

/**
 * @param {string} query
 * @param {'dev' | 'prod'} env
 * @returns {string}
 */
export function validateRawQuery(query, env) {
  const selectors = extractRawSelectors(query);
  if (selectors.length === 0) {
    fail('raw query must include a Loki stream selector');
  }

  for (const selector of selectors) {
    validateRawSelector(selector, env);
  }

  return query;
}

/**
 * @param {string} query
 * @returns {string[]}
 */
function extractRawSelectors(query) {
  return [...query.matchAll(/\{([^{}]*)\}/gu)]
    .map((match) => match[1] ?? '')
    .filter((selector) => /\b[A-Za-z_][A-Za-z0-9_]*\s*(?:=|!=|=~|!~)\s*"/u.test(selector));
}

/**
 * @param {string} selector
 * @returns {string[]}
 */
function splitLabelMatchers(selector) {
  /** @type {string[]} */
  const matchers = [];
  let current = '';
  let inString = false;
  let escaped = false;

  for (const char of selector) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && inString) {
      current += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      current += char;
      inString = !inString;
      continue;
    }

    if (char === ',' && !inString) {
      if (current.trim().length > 0) {
        matchers.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (inString) {
    fail('raw query contains an unterminated label matcher string');
  }

  if (current.trim().length > 0) {
    matchers.push(current.trim());
  }

  return matchers;
}

/**
 * @param {string} selector
 * @param {'dev' | 'prod'} env
 * @returns {void}
 */
function validateRawSelector(selector, env) {
  const matchers = splitLabelMatchers(selector);
  let sawApp = false;
  let sawEnv = false;

  for (const matcher of matchers) {
    const match =
      /^\s*(?<label>[A-Za-z_][A-Za-z0-9_]*)\s*(?<operator>=|!=|=~|!~)\s*"(?<value>(?:\\.|[^"\\])*)"\s*$/u.exec(
        matcher
      );
    if (match?.groups === undefined) {
      fail('raw query contains an unsupported label matcher');
    }

    const { label, operator, value } = match.groups;
    if (label === 'app') {
      sawApp = true;
      if (operator !== '=' || value !== 'fishing-assistant') {
        fail('raw query must use exact app selector app="fishing-assistant"');
      }
    }
    if (label === 'env') {
      sawEnv = true;
      if (operator !== '=' || value !== env) {
        fail(`raw query must include exact env selector env="${env}"`);
      }
    }
  }

  if (!sawApp) {
    fail('raw query must include app selector in every stream selector');
  }
  if (!sawEnv) {
    fail(`raw query must include exact env selector env="${env}" in every stream selector`);
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
export function deriveQueryRangeUrl(value) {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/u, '');
  if (path === '' || path === '/') {
    url.pathname = '/loki/api/v1/query_range';
  } else if (path.endsWith('/loki/api/v1/push')) {
    url.pathname = `${path.slice(0, -'/push'.length)}/query_range`;
  } else if (!path.endsWith('/loki/api/v1/query_range')) {
    url.pathname = `${path}/loki/api/v1/query_range`;
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

/**
 * @param {unknown} value
 * @param {string} [key]
 * @returns {unknown}
 */
function redactJsonValue(value, key = '') {
  if (isSensitiveKey(key)) {
    return `[redacted:${key || 'sensitive'}]`;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactJsonValue(entryValue, entryKey),
      ])
    );
  }
  if (typeof value === 'string') {
    return redactSecretPatterns(value);
  }
  return value;
}

/**
 * @param {string} value
 * @returns {string}
 */
function redactSecretPatterns(value) {
  return value
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu,
      '[redacted:private-key]'
    )
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{12,}/giu, '[redacted:authorization]')
    .replace(/\bsk-[A-Za-z0-9_.-]{10,}/gu, '[redacted:provider-key]')
    .replace(/\b[A-Za-z0-9_+=/]{28,}\b/gu, (match) =>
      /^(?:FA|CLOUDSDK|GOOGLE)_[A-Z0-9_]+$/u.test(match) ? match : '[redacted:token]'
    );
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function isSensitiveKey(key) {
  const normalized = key.replace(/[-_\s]/gu, '').toLowerCase();
  return (
    [...sensitiveFieldNames].some(
      (field) => normalized === field.replace(/[-_\s]/gu, '').toLowerCase()
    ) || sensitiveKeyFragments.some((fragment) => normalized.includes(fragment))
  );
}

/**
 * @param {string} value
 * @returns {string}
 */
export function redactSensitiveText(value) {
  try {
    return JSON.stringify(redactJsonValue(JSON.parse(value)));
  } catch {
    return redactSecretPatterns(value)
      .replace(
        /("(?:prompt|messages|content|question|input|system|user|retrieval|evidence|quote|chunk|sourceText)"\s*:\s*)"[^"]*"/giu,
        '$1"[redacted:sensitive]"'
      )
      .replace(
        /\b(prompt|messages|content|question|input|system|user|retrieval|evidence|quote|chunk|sourceText)=\S+/giu,
        '$1=[redacted:sensitive]'
      );
  }
}

/**
 * @param {string} nanoseconds
 * @returns {string}
 */
function formatNanoseconds(nanoseconds) {
  const millis = Number(BigInt(nanoseconds) / 1000000n);
  return new Date(millis).toISOString();
}

/**
 * @param {{ query: string, response: unknown, limit: number }} input
 * @returns {string}
 */
export function formatLokiResponse(input) {
  const response =
    /** @type {{ data?: { result?: Array<{ stream?: Record<string, string>, values?: Array<[string, string]> }> } }} */ (
      input.response
    );
  const streams = Array.isArray(response.data?.result) ? response.data.result : [];
  const entries = streams.flatMap((stream) =>
    Array.isArray(stream.values)
      ? stream.values.map(([timestamp, line]) => ({ labels: stream.stream ?? {}, timestamp, line }))
      : []
  );
  const selected = entries.slice(0, input.limit);
  const lines = [
    `Query: ${redactSensitiveText(input.query)}`,
    `Results: streams=${streams.length} entries=${entries.length}${entries.length > input.limit ? ` truncated=${entries.length - input.limit}` : ''}`,
  ];

  for (const entry of selected) {
    const labels = ['env', 'service', 'source', 'host', 'sha']
      .filter((label) => typeof entry.labels[label] === 'string')
      .map((label) => `${label}=${entry.labels[label]}`)
      .join(' ');
    lines.push(
      `${formatNanoseconds(entry.timestamp)} ${labels} ${redactSensitiveText(entry.line)}`.trim()
    );
  }

  if (entries.length === 0) {
    lines.push('Access status: success; no results.');
  } else {
    lines.push('Access status: success.');
  }

  return `${lines.join('\n')}\n`;
}

/**
 * @param {number} status
 * @param {string} body
 * @returns {string}
 */
export function classifyLokiError(status, body) {
  const redactedBody = redactSensitiveText(body);
  if (status === 401 && /invalid scope requested/i.test(body)) {
    return 'Grafana Loki read access failed: the read token is missing or not scoped with logs:read. Verify FA_GRAFANA_LOKI_READ_* Secret Manager values.';
  }
  if (status === 401 || status === 403) {
    return `Grafana Loki read access failed with HTTP ${status}: ${redactedBody}`;
  }
  if (status === 400) {
    return `Grafana Loki rejected the LogQL query with HTTP 400: ${redactedBody}`;
  }
  return `Grafana Loki request failed with HTTP ${status}: ${redactedBody}`;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {typeof execFileSync} [execFileSyncImpl]
 * @returns {{ url: string, username: string, token: string }}
 */
export function loadReadCredentials(env = process.env, execFileSyncImpl = execFileSync) {
  const directEntries = [
    { key: 'url', name: 'FA_GRAFANA_LOKI_READ_URL', value: env.FA_GRAFANA_LOKI_READ_URL ?? '' },
    {
      key: 'username',
      name: 'FA_GRAFANA_LOKI_READ_USERNAME',
      value: env.FA_GRAFANA_LOKI_READ_USERNAME ?? '',
    },
    {
      key: 'token',
      name: 'FA_GRAFANA_LOKI_READ_TOKEN',
      value: env.FA_GRAFANA_LOKI_READ_TOKEN ?? '',
    },
  ];
  const direct = Object.fromEntries(directEntries.map(({ key, value }) => [key, value]));
  const presentDirect = directEntries.filter(({ value }) => value.length > 0);
  const missingDirect = directEntries.filter(({ value }) => value.length === 0);

  if (presentDirect.length > 0 && missingDirect.length > 0) {
    fail(
      `FA Grafana Loki read env triplet is incomplete; missing ${missingDirect
        .map(({ name }) => name)
        .join(', ')}`
    );
  }

  if (direct.url.length > 0 && direct.username.length > 0 && direct.token.length > 0) {
    return /** @type {{ url: string, username: string, token: string }} */ (direct);
  }

  const project = env.FA_GCP_PROJECT_ID;
  if (typeof project !== 'string' || project.length === 0) {
    fail('FA_GCP_PROJECT_ID is required for Loki read secret fallback');
  }

  const keyFile = env.FA_GCP_ADMIN_KEY_FILE;
  if (typeof keyFile !== 'string' || keyFile.length === 0) {
    fail('FA_GCP_ADMIN_KEY_FILE is required for Loki read secret fallback');
  }

  const secretEnv = { ...env, CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: keyFile };
  const readSecret = (name) => {
    try {
      return String(
        execFileSyncImpl(
          'gcloud',
          ['--project', project, 'secrets', 'versions', 'access', 'latest', `--secret=${name}`],
          { encoding: 'utf8', env: secretEnv, stdio: ['ignore', 'pipe', 'pipe'] }
        )
      ).trim();
    } catch (error) {
      const output = getCommandErrorOutput(error);
      if (/NOT_FOUND|not found|has no versions/iu.test(output)) {
        fail(
          `GCP Secret Manager secret ${name} is missing or has no versions in project ${project}`
        );
      }
      fail(`Failed to read GCP Secret Manager secret ${name}: ${redactSensitiveText(output)}`);
    }
  };

  return {
    url: readSecret('FA_GRAFANA_LOKI_READ_URL'),
    username: readSecret('FA_GRAFANA_LOKI_READ_USERNAME'),
    token: readSecret('FA_GRAFANA_LOKI_READ_TOKEN'),
  };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function getCommandErrorOutput(error) {
  if (error instanceof Error) {
    const withOutput = /** @type {Error & { stderr?: unknown, stdout?: unknown }} */ (error);
    const stderr = withOutput.stderr;
    const stdout = withOutput.stdout;
    if (Buffer.isBuffer(stderr)) {
      return stderr.toString('utf8');
    }
    if (typeof stderr === 'string' && stderr.length > 0) {
      return stderr;
    }
    if (Buffer.isBuffer(stdout)) {
      return stdout.toString('utf8');
    }
    if (typeof stdout === 'string' && stdout.length > 0) {
      return stdout;
    }
    return error.message;
  }
  return String(error);
}

/**
 * @param {Date} date
 * @returns {string}
 */
function toNanoseconds(date) {
  return String(BigInt(date.getTime()) * 1000000n);
}

/**
 * @param {ReturnType<typeof parseQueryArgs>} options
 * @param {{ env?: NodeJS.ProcessEnv, execFileSyncImpl?: typeof execFileSync, fetchImpl?: typeof fetch, now?: Date }} [dependencies]
 * @returns {Promise<{ query: string, response: unknown, limit: number }>}
 */
export async function queryLoki(options, dependencies = {}) {
  const credentials = loadReadCredentials(dependencies.env, dependencies.execFileSyncImpl);
  const query =
    typeof options.query === 'string'
      ? validateRawQuery(options.query, options.env)
      : buildLogQuery(options);
  const end = options.end instanceof Date ? options.end : (dependencies.now ?? new Date());
  const start =
    options.start instanceof Date
      ? options.start
      : new Date(end.getTime() - (options.sinceMs ?? defaultSinceMs));
  assertWindowAllowed(end.getTime() - start.getTime());

  const url = new URL(deriveQueryRangeUrl(credentials.url));
  url.searchParams.set('query', query);
  url.searchParams.set('start', toNanoseconds(start));
  url.searchParams.set('end', toNanoseconds(end));
  url.searchParams.set('limit', String(options.limit));

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.token}`).toString('base64')}`,
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(classifyLokiError(response.status, body));
  }

  return { query, response: JSON.parse(body), limit: options.limit };
}
