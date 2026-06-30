import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLogQuery,
  classifyLokiError,
  deriveQueryRangeUrl,
  formatLokiResponse,
  loadReadCredentials,
  parseQueryArgs,
  redactSensitiveText,
  validateRawQuery,
} from './lib/loki-query.mjs';

test('parseQueryArgs requires dev or prod and caps broad queries', () => {
  assert.throws(() => parseQueryArgs(['node', 'query-loki.mjs']), /--env must be dev or prod/);
  assert.throws(
    () => parseQueryArgs(['node', 'query-loki.mjs', '--env', 'stage']),
    /--env must be dev or prod/
  );
  assert.throws(
    () => parseQueryArgs(['node', 'query-loki.mjs', '--env', 'prod', '--since', '3h']),
    /time window must not exceed 2h/
  );
  assert.throws(
    () => parseQueryArgs(['node', 'query-loki.mjs', '--env', 'prod', '--limit', '201']),
    /--limit must be between 1 and 200/
  );

  const defaults = parseQueryArgs(['node', 'query-loki.mjs', '--env', 'dev']);
  assert.equal(defaults.sinceMs, 900000);
  assert.equal(defaults.limit, 50);
});

test('buildLogQuery constrains generated queries to FA app and exact environment', () => {
  assert.equal(
    buildLogQuery({
      env: 'prod',
      service: 'chat-service',
      source: 'docker',
      filter: 'error|fail',
    }),
    '{app="fishing-assistant", env="prod", service="chat-service", source="docker"} |~ "error|fail"'
  );
  assert.throws(
    () => buildLogQuery({ env: 'prod', service: 'chat service' }),
    /service must match/
  );
});

test('validateRawQuery rejects broad and non-FA selectors', () => {
  assert.equal(
    validateRawQuery('{app="fishing-assistant", env="dev"} |= "error"', 'dev'),
    '{app="fishing-assistant", env="dev"} |= "error"'
  );
  assert.equal(
    validateRawQuery(
      '{app="fishing-assistant", env="dev", source="nginx"} |= "/api/users/health" |~ "\\\\s5[0-9]{2}\\\\s"',
      'dev'
    ),
    '{app="fishing-assistant", env="dev", source="nginx"} |= "/api/users/health" |~ "\\\\s5[0-9]{2}\\\\s"'
  );
  assert.throws(() => validateRawQuery('{env="dev"}', 'dev'), /app selector/);
  assert.throws(() => validateRawQuery('{app="other", env="dev"}', 'dev'), /app selector/);
  assert.throws(
    () => validateRawQuery('{app="fishing-assistant", env=~"dev|prod"}', 'dev'),
    /exact env selector/
  );
  assert.throws(
    () =>
      validateRawQuery('{app="fishing-assistant", env="dev"} or {app="other", env="dev"}', 'dev'),
    /app selector/
  );
  assert.throws(
    () =>
      validateRawQuery(
        'sum(count_over_time({app="fishing-assistant", env="dev"}[5m])) or sum(count_over_time({env="dev"}[5m]))',
        'dev'
      ),
    /app selector/
  );
  assert.throws(
    () => validateRawQuery('{app!="fishing-assistant", env="dev"}', 'dev'),
    /exact app selector/
  );
  assert.throws(
    () => validateRawQuery('{app=~"fishing-assistant", env="dev"}', 'dev'),
    /exact app selector/
  );
});

test('deriveQueryRangeUrl accepts push and query base URL shapes', () => {
  assert.equal(
    deriveQueryRangeUrl('https://logs-prod-012.grafana.net/loki/api/v1/push'),
    'https://logs-prod-012.grafana.net/loki/api/v1/query_range'
  );
  assert.equal(
    deriveQueryRangeUrl('https://logs-prod-012.grafana.net'),
    'https://logs-prod-012.grafana.net/loki/api/v1/query_range'
  );
});

test('redactSensitiveText masks secrets, prompts, provider bodies, and knowledge fields', () => {
  const redacted = redactSensitiveText(
    JSON.stringify({
      authorization: 'Bearer abcdefghijklmnopqrstuvwxyz123456',
      prompt: 'raw private prompt',
      messages: [{ role: 'user', content: 'raw user text' }],
      retrieval: { quote: 'redacted knowledge excerpt' },
      apiKey: 'sk-secret-value-1234567890',
    })
  );
  assert.doesNotMatch(redacted, /raw private prompt|raw user text|redacted knowledge excerpt/);
  assert.doesNotMatch(redacted, /abcdefghijklmnopqrstuvwxyz123456|sk-secret/);
  assert.match(redacted, /\[redacted/);

  assert.equal(
    redactSensitiveText('prompt=raw-private-text level=error'),
    'prompt=[redacted:sensitive] level=error'
  );

  const fakePrivateKeyBegin = ['-----BEGIN PRIVATE', 'KEY-----'].join(' ');
  const fakePrivateKeyEnd = ['-----END PRIVATE', 'KEY-----'].join(' ');
  const fakePrivateKey = [fakePrivateKeyBegin, 'abc', fakePrivateKeyEnd].join('\n');
  const serviceAccount = redactSensitiveText(
    JSON.stringify({
      private_key_id: 'short-secret',
      private_key: fakePrivateKey,
      client_email: 'fa-runtime@example.iam.gserviceaccount.com',
      access_token: 'short-access-token',
      internalAuthToken: 'short-internal-token',
    })
  );
  assert.doesNotMatch(
    serviceAccount,
    /short-secret|BEGIN PRIVATE KEY|iam\.gserviceaccount\.com|short-access-token|short-internal-token/
  );
  assert.doesNotMatch(redactSensitiveText(fakePrivateKey), /BEGIN PRIVATE KEY|abc/);
});

test('redactSensitiveText keeps FA config names visible in operator errors', () => {
  assert.equal(
    redactSensitiveText(
      'Secret FA_GRAFANA_LOKI_READ_TOKEN missing; set FA_GRAFANA_LOKI_READ_URL too'
    ),
    'Secret FA_GRAFANA_LOKI_READ_TOKEN missing; set FA_GRAFANA_LOKI_READ_URL too'
  );
});

test('loadReadCredentials reports exact missing read credential configuration', () => {
  assert.throws(
    () =>
      loadReadCredentials({
        FA_GRAFANA_LOKI_READ_URL: 'https://logs.example.invalid',
      }),
    /incomplete.*FA_GRAFANA_LOKI_READ_USERNAME.*FA_GRAFANA_LOKI_READ_TOKEN/s
  );

  assert.throws(
    () =>
      loadReadCredentials(
        {
          FA_GCP_PROJECT_ID: 'fishing-assistant',
          FA_GCP_ADMIN_KEY_FILE: '/tmp/fa-admin-key.json',
        },
        () => {
          throw Object.assign(new Error('gcloud failed'), {
            stderr:
              'ERROR: (gcloud.secrets.versions.access) NOT_FOUND: Secret [FA_GRAFANA_LOKI_READ_URL] not found or has no versions.',
          });
        }
      ),
    /FA_GRAFANA_LOKI_READ_URL is missing or has no versions/
  );
});

test('formatLokiResponse prints bounded redacted evidence summaries', () => {
  const output = formatLokiResponse({
    query: '{app="fishing-assistant", env="prod"}',
    response: {
      status: 'success',
      data: {
        result: [
          {
            stream: {
              env: 'prod',
              service: 'chat-service',
              source: 'docker',
              host: 'prod',
              sha: 'abc',
            },
            values: [
              [
                '1718954588000000000',
                '{"level":"error","prompt":"private prompt","error":"Provider failed"}',
              ],
            ],
          },
        ],
      },
    },
    limit: 50,
  });
  assert.match(output, /streams=1 entries=1/);
  assert.match(output, /service=chat-service/);
  assert.match(output, /Provider failed/);
  assert.doesNotMatch(output, /private prompt/);
});

test('classifyLokiError explains insufficient read scope', () => {
  assert.match(
    classifyLokiError(
      401,
      '{"status":"error","error":"authentication error: invalid scope requested"}'
    ),
    /logs:read/
  );
});
