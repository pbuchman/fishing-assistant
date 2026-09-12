#!/usr/bin/env node
// @ts-check

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DeploymentQueue } from './deployment-queue.mjs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(modulePath), '../..');

const DEFAULT_PORT = 9001;
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
const execFileAsync = promisify(execFile);
const REPOSITORY = 'pbuchman/fishing-assistant';
const DEPLOY_FAILURE_SUMMARY = 'DEV deploy failed';
const DEFAULT_REPO_PATH =
  process.env['HOME'] === undefined
    ? repoRoot
    : resolve(process.env['HOME'], 'deploy/fishing-assistant');
const DEFAULT_DEPLOY_SCRIPT = resolve(DEFAULT_REPO_PATH, 'scripts/deploy/deploy-dev.sh');

class WebhookBodyTooLargeError extends Error {
  constructor() {
    super(`webhook payload exceeds ${MAX_WEBHOOK_BODY_BYTES} bytes`);
    this.name = 'WebhookBodyTooLargeError';
  }
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} statusCode
 * @param {Record<string, unknown>} payload
 */
function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

/**
 * @param {Buffer} payload
 * @param {string | string[] | undefined} signature
 * @param {string} secret
 * @returns {boolean}
 */
function verifySignature(payload, signature, secret) {
  if (typeof signature !== 'string' || secret.length === 0) {
    return false;
  }

  const expected = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return (
    expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

/**
 * @param {{ ref?: unknown, after?: unknown }} payload
 * @returns {{ branch: string, sha: string } | undefined}
 */
function parsePushTarget(payload) {
  if (typeof payload.ref !== 'string' || typeof payload.after !== 'string') {
    return undefined;
  }

  const prefix = 'refs/heads/';
  if (!payload.ref.startsWith(prefix)) {
    return undefined;
  }

  return { branch: payload.ref.slice(prefix.length), sha: payload.after };
}

/**
 * @param {{ branch: string, sha: string }} target
 * @returns {boolean}
 */
function shouldDeployPush(target) {
  return (
    target.branch === 'main' && /^[a-f0-9]{40}$/.test(target.sha) && !/^0{40}$/.test(target.sha)
  );
}

/**
 * @param {{ id: string }} job
 * @param {{ repoPath: string, deployScript: string }} options
 * @returns {Promise<string>}
 */
async function deployTarget(job, options) {
  const execution = execFileAsync('bash', [options.deployScript, '--latest-main'], {
    cwd: options.repoPath,
    env: {
      ...process.env,
      FA_DEV_REPO_PATH: options.repoPath,
      FA_DEV_SOURCE_REPO: 'https://github.com/pbuchman/fishing-assistant.git',
      FA_DEV_REMOTE_URL: 'https://github.com/pbuchman/fishing-assistant.git',
      FA_DEV_JOB_ID: job.id,
    },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  let stageBuffer = '';
  execution.child.stderr?.on('data', (chunk) => {
    stageBuffer += String(chunk);
    const complete = stageBuffer.split('\n');
    stageBuffer = (complete.pop() ?? '').slice(-1024);
    for (const line of complete) {
      if (/^FA deploy job=[a-f0-9]{64} stage=[a-z-]+ sha=[a-f0-9]{40}$/.test(line)) {
        process.stdout.write(`${line}\n`);
      }
    }
  });
  const { stdout } = await execution;
  const lines = stdout.trim().split('\n');
  const result = JSON.parse(lines[lines.length - 1] ?? '{}');
  if (result.status !== 'deployed' || !/^[a-f0-9]{40}$/.test(result.sha ?? '')) {
    throw new Error('Deployment did not confirm a release');
  }
  return result.sha;
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<Buffer>}
 */
async function readBody(request) {
  /** @type {Buffer[]} */
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_WEBHOOK_BODY_BYTES) {
      throw new WebhookBodyTooLargeError();
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, totalBytes);
}

/**
 * @param {{ port?: number, secret: string, repoPath?: string, deployScript?: string, stateDirectory?: string | undefined }} options
 * @returns {import('node:http').Server}
 */
function createWebhookServer(options) {
  const port = options.port ?? DEFAULT_PORT;
  const repoPath = options.repoPath ?? DEFAULT_REPO_PATH;
  const deployScript = options.deployScript ?? DEFAULT_DEPLOY_SCRIPT;

  const queue = new DeploymentQueue(
    options.stateDirectory ??
      resolve(process.env['HOME'] ?? repoRoot, '.local/state/fishing-assistant/deploy'),
    (job) => deployTarget(job, { repoPath, deployScript })
  );

  const server = createServer(async (request, response) => {
    const correlationId = randomUUID();

    if (request.method === 'GET' && request.url === '/health') {
      writeJson(response, 200, { ok: true, service: 'fa-webhook-handler' });
      return;
    }

    if (request.method !== 'POST' || request.url !== '/webhook') {
      response.writeHead(404);
      response.end();
      return;
    }

    const contentLengthHeader = request.headers['content-length'];
    const contentLength =
      typeof contentLengthHeader === 'string' ? Number(contentLengthHeader) : Number.NaN;
    if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
      request.resume();
      writeJson(response, 413, {
        status: 'rejected',
        reason: 'payload too large',
        correlationId,
      });
      return;
    }

    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      if (error instanceof WebhookBodyTooLargeError) {
        writeJson(response, 413, {
          status: 'rejected',
          reason: 'payload too large',
          correlationId,
        });
        return;
      }
      writeJson(response, 400, { status: 'rejected', reason: 'unreadable body' });
      return;
    }

    if (!verifySignature(body, request.headers['x-hub-signature-256'], options.secret)) {
      writeJson(response, 401, { status: 'rejected', reason: 'invalid signature' });
      return;
    }

    const event = request.headers['x-github-event'];
    if (event !== 'push') {
      writeJson(response, 200, { status: 'ignored', event });
      return;
    }

    try {
      const payload = JSON.parse(body.toString('utf8'));
      if (payload?.repository?.full_name !== REPOSITORY || payload.deleted === true) {
        writeJson(response, 200, { status: 'ignored' });
        return;
      }
      const target = parsePushTarget(payload);
      if (target === undefined || !shouldDeployPush(target)) {
        writeJson(response, 200, { status: 'ignored', target });
        return;
      }

      const delivery = request.headers['x-github-delivery'];
      if (typeof delivery !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(delivery)) {
        writeJson(response, 400, { status: 'rejected', reason: 'invalid delivery ID' });
        return;
      }
      const job = queue.accept(delivery, target.sha);
      writeJson(response, 202, { status: 'accepted', jobId: job.id, jobStatus: job.status });
    } catch {
      writeJson(response, 500, {
        status: 'error',
        error: DEPLOY_FAILURE_SUMMARY,
        correlationId,
      });
    }
  });

  server.on('close', () => {
    void queue.close();
  });
  server.listen(port, () => {
    process.stdout.write(`FA webhook handler listening on :${String(port)}\n`);
    process.stdout.write(`Repo: ${repoPath}\n`);
  });

  return server;
}

function main() {
  const secret = process.env['FA_GITHUB_WEBHOOK_SECRET'] ?? process.env['WEBHOOK_SECRET'] ?? '';
  if (secret.length === 0) {
    process.stderr.write('FA_GITHUB_WEBHOOK_SECRET or WEBHOOK_SECRET is required\n');
    process.exit(1);
  }

  createWebhookServer({
    port: Number.parseInt(process.env['PORT'] ?? String(DEFAULT_PORT), 10),
    secret,
    stateDirectory: process.env['FA_DEV_STATE_DIR'],
    repoPath: process.env['FA_DEV_REPO_PATH'] ?? DEFAULT_REPO_PATH,
    deployScript: process.env['FA_DEV_DEPLOY_SCRIPT'] ?? DEFAULT_DEPLOY_SCRIPT,
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main();
}

export { createWebhookServer, deployTarget, parsePushTarget, shouldDeployPush, verifySignature };
