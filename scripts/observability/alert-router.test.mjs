import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import { createDedupeStore } from './alert-router/dedupe-store.mjs';
import { redactPayload } from './alert-router/redaction.mjs';
import { createAlertRouterServer } from './alert-router/server.mjs';

/**
 * @typedef {{ status?: string; fingerprint?: string; labels?: Record<string, unknown>; annotations?: Record<string, unknown> }} GrafanaPayloadOverrides
 * @typedef {{ receiver: string; status: string; alerts: Array<{ status: string; fingerprint: string; labels: Record<string, unknown>; annotations: Record<string, unknown>; generatorURL: string }>; extra?: string }} GrafanaPayload
 * @typedef {{ type: 'issue' | 'comment'; input: Record<string, unknown> }} FakeGithubRequest
 * @typedef {{ requests: FakeGithubRequest[]; createIssue(input: { title: string; body: string; labels?: string[] }): Promise<{ number: number; html_url: string }>; commentOnIssue(input: { issueNumber: number; body: string }): Promise<{ html_url: string }> }} FakeGithubClient
 * @typedef {{ githubClient?: FakeGithubClient; dedupeStore?: ReturnType<typeof createDedupeStore> }} StartRouterOptions
 */

/**
 * @param {GrafanaPayloadOverrides} [overrides]
 * @returns {GrafanaPayload}
 */
function createGrafanaPayload(overrides = {}) {
  const status = overrides.status ?? 'firing';

  return {
    receiver: 'fa-alert-router',
    status,
    alerts: [
      {
        status,
        fingerprint: overrides.fingerprint ?? 'alert-fingerprint-1',
        labels: {
          alertname: 'FA Backend Error Logs',
          service: 'chat-service',
          env: 'dev',
          severity: 'warning',
          sha: 'abc123',
          ...(overrides.labels ?? {}),
        },
        annotations: {
          summary: 'backend error logs detected',
          loki_query: '{app="fishing-assistant", service="chat-service"} | json',
          runbook_url:
            'https://github.com/pbuchman/fishing-assistant/blob/main/docs/operations/fa-observability-runbook.md',
          ...(overrides.annotations ?? {}),
        },
        generatorURL: 'https://grafana.example.invalid/alerting/rule/fa-backend-error-logs',
      },
    ],
  };
}

/**
 * @param {FakeGithubRequest[]} requests
 * @param {number} index
 * @returns {FakeGithubRequest}
 */
function requestAt(requests, index) {
  const request = requests[index];
  if (request === undefined) {
    throw new Error(`expected GitHub request at index ${String(index)}`);
  }
  return request;
}

/**
 * @param {FakeGithubRequest} request
 * @param {string} key
 * @returns {string}
 */
function inputString(request, key) {
  const value = request.input[key];
  return typeof value === 'string' ? value : '';
}

/**
 * @returns {FakeGithubClient}
 */
function createFakeGithubClient() {
  /** @type {FakeGithubRequest[]} */
  const requests = [];

  return {
    requests,
    async createIssue(input) {
      requests.push({ type: 'issue', input });
      return {
        number: 100 + requests.filter((request) => request.type === 'issue').length,
        html_url: 'https://github.example.invalid/issues/101',
      };
    },
    async commentOnIssue(input) {
      requests.push({ type: 'comment', input });
      return {
        html_url: `https://github.example.invalid/issues/${input.issueNumber}#comment`,
      };
    },
  };
}

/**
 * @param {StartRouterOptions} [options]
 * @returns {Promise<{ githubClient: FakeGithubClient; url: string; close(): Promise<void> }>}
 */
async function startRouter(options = {}) {
  const githubClient = options.githubClient ?? createFakeGithubClient();
  const server = createAlertRouterServer({
    secret: 'expected-secret',
    repository: 'pbuchman/fishing-assistant',
    grafanaInstanceUrl: 'https://grafana.example.invalid',
    releaseSha: 'release-sha',
    dedupeStore: options.dedupeStore ?? createDedupeStore({ dedupeWindowMs: 60_000 }),
    githubClient,
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  assert.notEqual(address, null);
  const port = /** @type {import('node:net').AddressInfo} */ (address).port;

  return {
    githubClient,
    url: `http://127.0.0.1:${port}`,
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}

/**
 * @param {string} url
 * @param {unknown} payload
 * @param {string | null} [secret]
 * @returns {Promise<Response>}
 */
async function postGrafana(url, payload, secret = 'expected-secret') {
  return fetch(`${url}/alerts/grafana`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret === null ? {} : { 'x-fa-alert-secret': secret }),
    },
    body: JSON.stringify(payload),
  });
}

test('GET /health returns JSON', async () => {
  const router = await startRouter();
  try {
    const response = await fetch(`${router.url}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      service: 'fa-alert-router',
    });
  } finally {
    await router.close();
  }
});

test('missing or wrong X-FA-Alert-Secret returns 401', async () => {
  const router = await startRouter();
  try {
    assert.equal((await postGrafana(router.url, createGrafanaPayload(), null)).status, 401);
    assert.equal(
      (await postGrafana(router.url, createGrafanaPayload(), 'wrong-secret')).status,
      401
    );
    assert.deepEqual(router.githubClient.requests, []);
  } finally {
    await router.close();
  }
});

test('valid Grafana webhook payload creates one GitHub investigation issue', async () => {
  const router = await startRouter();
  try {
    const response = await postGrafana(router.url, createGrafanaPayload());
    assert.equal(response.status, 202);
    assert.equal(router.githubClient.requests.length, 1);

    const request = requestAt(router.githubClient.requests, 0);
    assert.equal(request.type, 'issue');
    assert.match(inputString(request, 'title'), /FA Backend Error Logs/);
    assert.match(inputString(request, 'body'), /Status: firing/);
    assert.match(inputString(request, 'body'), /Service: chat-service/);
    assert.match(inputString(request, 'body'), /Environment: dev/);
    assert.match(inputString(request, 'body'), /Severity: warning/);
    assert.match(inputString(request, 'body'), /Grafana: https:\/\/grafana\.example\.invalid/);
    assert.match(inputString(request, 'body'), /Loki query: `\{app="fishing-assistant"/);
    assert.match(inputString(request, 'body'), /Runbook:/);
    assert.match(inputString(request, 'body'), /Deployment SHA: abc123/);
    assert.match(
      inputString(request, 'body'),
      /This issue was created for investigation\. It did not modify code or deploy\./
    );
  } finally {
    await router.close();
  }
});

test('issue body redacts selected annotation fields and truncates large payloads', async () => {
  const router = await startRouter();
  try {
    const payload = createGrafanaPayload({
      annotations: {
        loki_query: '{app="fishing-assistant"} |= "token=super-secret-provider-token"',
        grafana_rule_url: 'https://grafana.example.invalid/rule?token=secret-url-token',
      },
    });
    payload.extra = 'x'.repeat(40_000);

    const response = await postGrafana(router.url, payload);
    assert.equal(response.status, 202);

    const request = requestAt(router.githubClient.requests, 0);
    assert.equal(request.type, 'issue');
    assert.doesNotMatch(inputString(request, 'body'), /super-secret-provider-token/);
    assert.doesNotMatch(inputString(request, 'body'), /secret-url-token/);
    assert.match(inputString(request, 'body'), /\[TRUNCATED\]/);
  } finally {
    await router.close();
  }
});

test('alert fingerprint dedupes repeated active alerts within the configured window', async () => {
  const router = await startRouter({
    dedupeStore: createDedupeStore({ dedupeWindowMs: 60_000 }),
  });
  try {
    const first = await postGrafana(router.url, createGrafanaPayload());
    const second = await postGrafana(router.url, createGrafanaPayload());
    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    assert.equal(
      router.githubClient.requests.filter((request) => request.type === 'issue').length,
      1
    );
    assert.equal((await second.json()).deduped, 1);
  } finally {
    await router.close();
  }
});

test('repeated active alerts extend the dedupe window for a long incident', async () => {
  const store = createDedupeStore({ dedupeWindowMs: 1_000 });
  const firstIssue = { number: 1, html_url: 'https://github.example.invalid/issues/1' };

  assert.equal(store.shouldCreateActive('fingerprint', 0), true);
  store.rememberActive('fingerprint', firstIssue, 0);
  assert.equal(store.shouldCreateActive('fingerprint', 900), false);
  store.rememberDuplicate('fingerprint', 900);
  assert.equal(store.shouldCreateActive('fingerprint', 1_500), false);
  assert.equal(store.shouldCreateActive('fingerprint', 2_100), true);
});

test('resolved alerts comment on an existing issue instead of creating a new one', async () => {
  const router = await startRouter();
  try {
    assert.equal((await postGrafana(router.url, createGrafanaPayload())).status, 202);
    assert.equal(
      (await postGrafana(router.url, createGrafanaPayload({ status: 'resolved' }))).status,
      202
    );

    assert.equal(
      router.githubClient.requests.filter((request) => request.type === 'issue').length,
      1
    );
    assert.equal(
      router.githubClient.requests.filter((request) => request.type === 'comment').length,
      1
    );
  } finally {
    await router.close();
  }
});

test('payload redaction removes tokens and auth headers', () => {
  const redacted = redactPayload({
    token: 'grafana-token',
    nested: {
      authorization: 'Bearer secret',
      safe: 'kept',
    },
    alerts: [
      {
        labels: {
          apiKey: 'provider-key',
        },
      },
    ],
  });

  assert.deepEqual(redacted, {
    token: '[REDACTED]',
    nested: {
      authorization: '[REDACTED]',
      safe: 'kept',
    },
    alerts: [
      {
        labels: {
          apiKey: '[REDACTED]',
        },
      },
    ],
  });
});
