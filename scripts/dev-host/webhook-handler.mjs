#!/usr/bin/env node
// @ts-check

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(modulePath), '../..');

const DEFAULT_PORT = 9001;
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
const DEPLOY_SUCCESS_SUMMARY = 'DEV deploy completed';
const DEPLOY_FAILURE_SUMMARY = 'DEV deploy failed';
const DEFAULT_REPO_PATH =
  process.env['HOME'] === undefined
    ? repoRoot
    : resolve(process.env['HOME'], 'deploy/fishing-assistant');
const DEFAULT_DEPLOY_SCRIPT = resolve(repoRoot, 'scripts/deploy/deploy-dev.sh');

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
  return target.branch === 'main' && !/^0{40}$/.test(target.sha);
}

/**
 * @param {{ branch: string, sha: string }} target
 * @param {{ repoPath: string, deployScript: string }} options
 * @returns {{ status: string, branch: string, sha: string, summary: string }}
 */
function deployTarget(target, options) {
  execFileSync('bash', [options.deployScript, '--branch', target.branch, '--sha', target.sha], {
    cwd: repoRoot,
    env: {
      ...process.env,
      FA_DEV_REPO_PATH: options.repoPath,
    },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    status: 'deployed',
    branch: target.branch,
    sha: target.sha,
    summary: DEPLOY_SUCCESS_SUMMARY,
  };
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
 * @param {{ port?: number, secret: string, repoPath?: string, deployScript?: string }} options
 * @returns {import('node:http').Server}
 */
function createWebhookServer(options) {
  const port = options.port ?? DEFAULT_PORT;
  const repoPath = options.repoPath ?? DEFAULT_REPO_PATH;
  const deployScript = options.deployScript ?? DEFAULT_DEPLOY_SCRIPT;

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
      throw error;
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
      const target = parsePushTarget(payload);
      if (target === undefined || !shouldDeployPush(target)) {
        writeJson(response, 200, { status: 'ignored', target });
        return;
      }

      const result = deployTarget(target, { repoPath, deployScript });
      writeJson(response, 200, { ...result, correlationId });
    } catch {
      writeJson(response, 500, {
        status: 'error',
        error: DEPLOY_FAILURE_SUMMARY,
        correlationId,
      });
    }
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
    repoPath: process.env['FA_DEV_REPO_PATH'] ?? DEFAULT_REPO_PATH,
    deployScript: process.env['FA_DEV_DEPLOY_SCRIPT'] ?? DEFAULT_DEPLOY_SCRIPT,
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main();
}

export { createWebhookServer, deployTarget, parsePushTarget, shouldDeployPush, verifySignature };
