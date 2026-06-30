import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createWebhookServer,
  parsePushTarget,
  shouldDeployPush,
  verifySignature,
} from './webhook-handler.mjs';

const TEST_SECRET = 'test-secret';
const TEST_SHA = '0123456789012345678901234567890123456789';
const ONE_MIB = 1024 * 1024;

/** @typedef {import('node:http').Server} HttpServer */
/** @typedef {{ exitCode?: number, stdout?: string, stderr?: string, markerFile?: string }} FakeDeployScriptOptions */
/** @typedef {{ dir: string, scriptPath: string, cleanup: () => Promise<void> }} FakeDeployScript */
/** @typedef {{ deployScript?: string, repoPath?: string }} WebhookServerTestOptions */
/** @typedef {{ event?: string, signature?: string }} WebhookPostOptions */
/** @typedef {{ status?: string, reason?: string, branch?: string, sha?: string, summary?: string, correlationId?: string, error?: string }} WebhookResponseJson */

/**
 * @param {Buffer} payload
 * @param {string} [secret]
 * @returns {string}
 */
function signPayload(payload, secret = TEST_SECRET) {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function expectString(value) {
  assert.equal(typeof value, 'string');
  return /** @type {string} */ (value);
}

/**
 * @param {FakeDeployScriptOptions} [options]
 * @returns {Promise<FakeDeployScript>}
 */
async function createFakeDeployScript({ exitCode = 0, stdout = '', stderr = '', markerFile } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fa-webhook-test-'));
  const scriptPath = join(dir, 'deploy.sh');
  const lines = ['#!/usr/bin/env bash', 'set -euo pipefail'];

  if (markerFile !== undefined) {
    lines.push(`printf '%s' 'called' > ${shellQuote(markerFile)}`);
  }
  if (stdout.length > 0) {
    lines.push(`printf '%s' ${shellQuote(stdout)}`);
  }
  if (stderr.length > 0) {
    lines.push(`printf '%s' ${shellQuote(stderr)} >&2`);
  }
  lines.push(`exit ${exitCode}`);

  await writeFile(scriptPath, `${lines.join('\n')}\n`, 'utf8');
  return {
    dir,
    scriptPath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/**
 * @param {HttpServer} server
 * @returns {Promise<void>}
 */
async function waitForServer(server) {
  if (!server.listening) {
    await once(server, 'listening');
  }
}

/**
 * @param {HttpServer} server
 * @returns {Promise<void>}
 */
async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(undefined);
    });
  });
}

/**
 * @template T
 * @param {WebhookServerTestOptions} options
 * @param {(baseUrl: string) => Promise<T> | T} callback
 * @returns {Promise<T>}
 */
async function withWebhookServer(options, callback) {
  const server = createWebhookServer({
    port: 0,
    secret: TEST_SECRET,
    repoPath: join(tmpdir(), 'fa-webhook-test-repo'),
    ...options,
  });

  await waitForServer(server);
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');

  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await closeServer(server);
  }
}

/**
 * @param {string} baseUrl
 * @param {Buffer} payload
 * @param {WebhookPostOptions} [options]
 * @returns {Promise<{ response: Response, text: string, json: WebhookResponseJson | undefined }>}
 */
async function postWebhook(
  baseUrl,
  payload,
  { event = 'push', signature = signPayload(payload) } = {}
) {
  const response = await fetch(`${baseUrl}/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-hub-signature-256': signature,
    },
    body: new Uint8Array(payload),
  });
  const text = await response.text();
  return { response, text, json: text.length > 0 ? JSON.parse(text) : undefined };
}

test('verifies GitHub HMAC signatures', () => {
  const payload = Buffer.from(JSON.stringify({ ref: 'refs/heads/main' }));
  const signature = signPayload(payload);

  assert.equal(verifySignature(payload, signature, TEST_SECRET), true);
  assert.equal(verifySignature(payload, 'sha256=bad', TEST_SECRET), false);
});

test('deploys only push targets on main', () => {
  const target = parsePushTarget({
    ref: 'refs/heads/main',
    after: '0123456789012345678901234567890123456789',
  });

  assert.deepEqual(target, {
    branch: 'main',
    sha: '0123456789012345678901234567890123456789',
  });
  assert.equal(target !== undefined && shouldDeployPush(target), true);
  assert.equal(shouldDeployPush({ branch: 'feature', sha: target?.sha ?? '' }), false);
  assert.equal(
    shouldDeployPush({ branch: 'main', sha: '0000000000000000000000000000000000000000' }),
    false
  );
});

test('DEV runtime scripts refresh user-service env and health checks', async () => {
  const deployScript = await readFile(new URL('../deploy/deploy-dev.sh', import.meta.url), 'utf8');
  const deployScriptCommandText = deployScript.replace(/\\\n\s*/g, ' ');
  const pm2Service = await readFile(new URL('./fa-pm2.service', import.meta.url), 'utf8');

  assert.match(
    deployScriptCommandText,
    /run_fa_pm2\(\)\s+\{[\s\S]*?env\s+-u\s+PORT\s+direnv\s+exec\s+\.\s+pnpm\s+exec\s+pm2\s+"\$@"/,
    'DEV deploy must scrub webhook/systemd PORT before calling PM2'
  );
  assert.match(
    deployScriptCommandText,
    /run_fa_pm2\s+startOrReload\s+ecosystem\.config\.cjs\s+--update-env/,
    'DEV deploy must refresh FA PM2 process env from the ecosystem file'
  );
  assert.match(
    deployScript,
    /assert_public_dev_host\(\)\s+\{/,
    'DEV deploy must guard public-origin deploys against running on the wrong host'
  );
  assert.match(
    deployScript,
    /hostname\s+-s/,
    'DEV deploy host guard must inspect the current short hostname'
  );
  assert.match(
    deployScript,
    /FA_DEV_ALLOW_NON_DEV_HOST/,
    'DEV deploy host guard must require an explicit FA override for non-dev-host public-origin deploys'
  );
  assert.ok(
    deployScript.indexOf('assert_public_dev_host') < deployScript.indexOf('resolve_source_repo'),
    'DEV deploy host guard must run before fetching or mutating the deploy clone'
  );
  assert.doesNotMatch(
    deployScriptCommandText,
    /run_fa_pm2\s+reload\s+fa-llm-usage-service\s+fa-knowledge-service\s+fa-chat-service\s+fa-user-service\s+fa-web/,
    'DEV deploy must not issue a second broad PM2 reload immediately after startOrReload'
  );
  assert.match(deployScript, /\/api\/users\/health/);
  assert.match(
    pm2Service,
    /ExecStart=\/usr\/bin\/env\s+-u\s+PORT\s+\/usr\/bin\/direnv\s+exec\s+%h\/deploy\/fishing-assistant\s+pnpm\s+exec\s+pm2\s+startOrReload\s+ecosystem\.config\.cjs\s+--update-env/
  );
  assert.match(
    pm2Service,
    /ExecReload=\/usr\/bin\/env\s+-u\s+PORT\s+\/usr\/bin\/direnv\s+exec\s+%h\/deploy\/fishing-assistant\s+pnpm\s+exec\s+pm2\s+reload\s+fa-llm-usage-service\s+fa-knowledge-service\s+fa-chat-service\s+fa-user-service\s+fa-web(?!\s+--update-env)/
  );
  assert.match(pm2Service, /fa-user-service/);
});

test('DEV deploy runs live runtime data baseline verification after env verification', async () => {
  const deployScript = await readFile(new URL('../deploy/deploy-dev.sh', import.meta.url), 'utf8');
  const envIndex = deployScript.indexOf('pnpm run verify:env');
  const resetIndex = deployScript.indexOf('pnpm run verify:data-baseline');

  assert.ok(envIndex >= 0, 'deploy script must verify env before deploy');
  assert.ok(resetIndex > envIndex, 'deploy script must run live runtime data baseline after env');
});

test('rejects oversized webhook payloads without deploying', async () => {
  const deploy = await createFakeDeployScript();
  const markerFile = join(deploy.dir, 'deploy-called');
  const oversizedPayload = Buffer.from(
    JSON.stringify({
      ref: 'refs/heads/main',
      after: TEST_SHA,
      padding: 'x'.repeat(ONE_MIB),
    })
  );

  assert.ok(oversizedPayload.length > ONE_MIB);

  try {
    await writeFile(
      deploy.scriptPath,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `printf '%s' 'called' > ${shellQuote(markerFile)}`,
        "printf '%s' 'deploy should not run'",
        'exit 0',
      ].join('\n'),
      'utf8'
    );

    await withWebhookServer({ deployScript: deploy.scriptPath }, async (baseUrl) => {
      const { response, json } = await postWebhook(baseUrl, oversizedPayload);

      assert.equal(response.status, 413);
      assert.equal(json?.status, 'rejected');
      assert.match(json?.reason ?? '', /payload too large/i);
      assert.equal(await pathExists(markerFile), false);
    });
  } finally {
    await deploy.cleanup();
  }
});

test('successful deploy responses summarize without raw command output', async () => {
  const rawStdout = 'RAW_SUCCESS_STDOUT_SHOULD_NOT_LEAK';
  const rawStderr = 'RAW_SUCCESS_STDERR_SHOULD_NOT_LEAK';
  const deploy = await createFakeDeployScript({ stdout: rawStdout, stderr: rawStderr });
  const payload = Buffer.from(JSON.stringify({ ref: 'refs/heads/main', after: TEST_SHA }));

  try {
    await withWebhookServer({ deployScript: deploy.scriptPath }, async (baseUrl) => {
      const { response, text, json } = await postWebhook(baseUrl, payload);

      assert.equal(response.status, 200);
      assert.doesNotMatch(text, /RAW_SUCCESS_STDOUT_SHOULD_NOT_LEAK/);
      assert.doesNotMatch(text, /RAW_SUCCESS_STDERR_SHOULD_NOT_LEAK/);
      assert.equal(json?.status, 'deployed');
      assert.equal(json?.branch, 'main');
      assert.equal(json?.sha, TEST_SHA);
      assert.equal(json?.summary, 'DEV deploy completed');
      assert.equal(typeof json?.correlationId, 'string');
      assert.ok(expectString(json?.correlationId).length > 0);
      assert.equal('output' in json, false);
    });
  } finally {
    await deploy.cleanup();
  }
});

test('failed deploy responses include a summary and correlation ID without raw logs', async () => {
  const rawStdout = 'RAW_FAILURE_STDOUT_SHOULD_NOT_LEAK'.repeat(20);
  const rawStderr = 'RAW_FAILURE_STDERR_SHOULD_NOT_LEAK'.repeat(20);
  const deploy = await createFakeDeployScript({
    exitCode: 7,
    stdout: rawStdout,
    stderr: rawStderr,
  });
  const payload = Buffer.from(JSON.stringify({ ref: 'refs/heads/main', after: TEST_SHA }));

  try {
    await withWebhookServer({ deployScript: deploy.scriptPath }, async (baseUrl) => {
      const { response, text, json } = await postWebhook(baseUrl, payload);

      assert.equal(response.status, 500);
      assert.doesNotMatch(text, /RAW_FAILURE_STDOUT_SHOULD_NOT_LEAK/);
      assert.doesNotMatch(text, /RAW_FAILURE_STDERR_SHOULD_NOT_LEAK/);
      assert.equal(json?.status, 'error');
      assert.match(json?.error ?? '', /deploy failed/i);
      assert.equal(typeof json?.correlationId, 'string');
      assert.ok(expectString(json?.correlationId).length > 0);
      assert.ok(text.length < 1000);
    });
  } finally {
    await deploy.cleanup();
  }
});

test('webhook signature verification uses the exact raw payload bytes', async () => {
  const markerFile = join(tmpdir(), `fa-webhook-raw-${Date.now()}`);
  const deploy = await createFakeDeployScript({ markerFile });
  const rawPayload = Buffer.from(
    `{\r\n  "ref": "refs/heads/main",\r\n  "after": "${TEST_SHA}"\r\n}`
  );
  const normalizedPayload = Buffer.from(JSON.stringify(JSON.parse(rawPayload.toString('utf8'))));

  assert.notEqual(signPayload(rawPayload), signPayload(normalizedPayload));

  try {
    await rm(markerFile, { force: true });
    await withWebhookServer({ deployScript: deploy.scriptPath }, async (baseUrl) => {
      const rejected = await postWebhook(baseUrl, rawPayload, {
        signature: signPayload(normalizedPayload),
      });
      assert.equal(rejected.response.status, 401);
      assert.equal(await pathExists(markerFile), false);

      const accepted = await postWebhook(baseUrl, rawPayload);
      assert.equal(accepted.response.status, 200);
      assert.equal(await pathExists(markerFile), true);
    });
  } finally {
    await rm(markerFile, { force: true });
    await deploy.cleanup();
  }
});
