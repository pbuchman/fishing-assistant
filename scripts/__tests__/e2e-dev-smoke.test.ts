import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const smokeScript = path.join(repoRoot, 'scripts/smoke/e2e-dev.mjs');
const siteBasicAuthValue = 'Basic smoke-secret';
const siteBasicAuthCheckHeader = `Authorization: ${siteBasicAuthValue}`;

let server: ReturnType<typeof createServer> | undefined;

function closeServer() {
  return new Promise<void>((resolve, reject) => {
    if (server === undefined) {
      resolve();
      return;
    }
    server.close((error) => {
      server = undefined;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function send(response: ServerResponse, statusCode: number, body?: string) {
  response.statusCode = statusCode;
  response.end(body ?? (statusCode === 200 ? 'ok' : 'blocked'));
}

function requestPath(request: IncomingMessage) {
  return new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
}

async function startFakeEdge(options: { exposeViteDevSource?: boolean } = {}) {
  const seenAuthByPath = new Map<string, string | undefined>();

  server = createServer((request, response) => {
    const pathname = requestPath(request);
    const authHeader: unknown = request.headers.authorization;
    const auth =
      typeof authHeader === 'string'
        ? authHeader
        : Array.isArray(authHeader) && typeof authHeader[0] === 'string'
          ? authHeader[0]
          : undefined;
    seenAuthByPath.set(pathname, auth);

    if (pathname === '/healthz') {
      send(response, 200);
      return;
    }

    if (pathname === '/api/chat/internal/not-public') {
      send(response, 404);
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      if (auth !== siteBasicAuthValue) {
        response.setHeader('WWW-Authenticate', 'Basic realm="Fishing Assistant"');
        send(response, 401);
        return;
      }

      send(
        response,
        200,
        options.exposeViteDevSource === true
          ? '<script type="module" src="/@vite/client"></script><script type="module" src="/src/main.tsx"></script>'
          : '<script type="module" src="/assets/index.js"></script>'
      );
      return;
    }

    if (pathname === '/app') {
      send(
        response,
        200,
        options.exposeViteDevSource === true
          ? '<script type="module" src="/@vite/client"></script><script type="module" src="/src/main.tsx"></script>'
          : '<script type="module" src="/assets/index.js"></script>'
      );
      return;
    }

    if (pathname === '/src/config.ts') {
      send(
        response,
        options.exposeViteDevSource === true ? 200 : 404,
        options.exposeViteDevSource === true
          ? 'const config = { FA_INTERNAL_AUTH_TOKEN: "leaked" };'
          : 'not found'
      );
      return;
    }

    if (pathname === '/@vite/client') {
      send(
        response,
        options.exposeViteDevSource === true ? 200 : 404,
        options.exposeViteDevSource === true ? 'export const vite = true;' : 'not found'
      );
      return;
    }

    send(response, 200);
  });

  await new Promise<void>((resolve) => {
    server?.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fake edge did not bind a TCP port');
  }

  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    seenAuthByPath,
  };
}

function runSmoke(origin: string, envOverrides: Record<string, string | undefined> = {}) {
  return new Promise<{ status: number | null; stderr: string; stdout: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [smokeScript], {
        cwd: repoRoot,
        env: {
          ...process.env,
          FA_DEV_ORIGIN: origin,
          FA_SITE_BASIC_AUTH_CHECK_HEADER: siteBasicAuthCheckHeader,
          ...envOverrides,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('DEV smoke script timed out'));
      }, 10_000);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('exit', (status) => {
        clearTimeout(timeout);
        resolve({ status, stdout, stderr });
      });
    }
  );
}

afterEach(async () => {
  await closeServer();
});

describe('DEV e2e smoke script', () => {
  it('checks homepage Basic Auth gate and public app/API routes', async () => {
    const { origin, seenAuthByPath } = await startFakeEdge();

    const result = await runSmoke(origin);

    expect(result.status).toBe(0);
    expect(seenAuthByPath.get('/healthz')).toBeUndefined();
    expect(seenAuthByPath.get('/')).toBe(siteBasicAuthValue);
    expect(seenAuthByPath.get('/index.html')).toBe(siteBasicAuthValue);
    for (const pathname of [
      '/app',
      '/src/config.ts',
      '/@vite/client',
      '/api/chat/health',
      '/api/knowledge/health',
      '/api/llm-usage/health',
      '/api/users/health',
      '/api/chat/internal/not-public',
    ]) {
      expect(seenAuthByPath.get(pathname)).toBeUndefined();
    }
  });

  it('fails when the Basic Auth check header is missing', async () => {
    const { origin } = await startFakeEdge();

    const result = await runSmoke(origin, { FA_SITE_BASIC_AUTH_CHECK_HEADER: '' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FA_SITE_BASIC_AUTH_CHECK_HEADER');
  });

  it('fails when the public DEV edge serves Vite development source', async () => {
    const { origin } = await startFakeEdge({ exposeViteDevSource: true });

    const result = await runSmoke(origin);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not serve Vite development source');
  });
});
