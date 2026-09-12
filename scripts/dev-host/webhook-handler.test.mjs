import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
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
  const stateDirectory = await mkdtemp(join(tmpdir(), 'fa-webhook-state-'));
  const server = createWebhookServer({
    stateDirectory,
    port: 0,
    secret: TEST_SECRET,
    repoPath: tmpdir(),
    ...options,
  });

  await waitForServer(server);
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');

  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await closeServer(server);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await rm(stateDirectory, { recursive: true, force: true });
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
      'x-github-delivery': randomUUID(),
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

test('accepted deploy does not expose command output or wait for a slow build', async () => {
  const deploy = await createFakeDeployScript();
  await writeFile(deploy.scriptPath, "sleep 1\nprintf '%s' 'private output'\n");
  const payload = Buffer.from(
    JSON.stringify({
      repository: { full_name: 'pbuchman/fishing-assistant' },
      ref: 'refs/heads/main',
      after: TEST_SHA,
    })
  );
  try {
    await withWebhookServer({ deployScript: deploy.scriptPath }, async (baseUrl) => {
      const start = Date.now();
      const { response, text, json } = await postWebhook(baseUrl, payload);
      assert.equal(response.status, 202);
      assert.equal(json?.status, 'accepted');
      assert.ok(Date.now() - start < 800);
      assert.doesNotMatch(text, /private output/);
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
  } finally {
    await deploy.cleanup();
  }
});

test('other repositories, branches and deletions do not deploy', async () => {
  const deploy = await createFakeDeployScript();
  const marker = join(deploy.dir, 'called');
  await writeFile(deploy.scriptPath, `touch ${shellQuote(marker)}\n`);
  try {
    await withWebhookServer({ deployScript: deploy.scriptPath }, async (url) => {
      for (const overrides of [
        { repository: { full_name: 'other/repo' } },
        { ref: 'refs/heads/feature' },
        { deleted: true },
        { after: '0'.repeat(40) },
      ]) {
        const payload = Buffer.from(
          JSON.stringify({
            repository: { full_name: 'pbuchman/fishing-assistant' },
            ref: 'refs/heads/main',
            after: TEST_SHA,
            ...overrides,
          })
        );
        assert.equal((await postWebhook(url, payload)).json?.status, 'ignored');
      }
      assert.equal(await pathExists(marker), false);
    });
  } finally {
    await deploy.cleanup();
  }
});

test('webhook signature verification uses the exact raw payload bytes', async () => {
  const markerFile = join(tmpdir(), `fa-webhook-raw-${Date.now()}`);
  const deploy = await createFakeDeployScript({ markerFile });
  const rawPayload = Buffer.from(
    `{\r\n  "repository": {"full_name": "pbuchman/fishing-assistant"},\r\n  "ref": "refs/heads/main",\r\n  "after": "${TEST_SHA}"\r\n}`
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
      assert.equal(accepted.response.status, 202);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(await pathExists(markerFile), true);
    });
  } finally {
    await rm(markerFile, { force: true });
    await deploy.cleanup();
  }
});
