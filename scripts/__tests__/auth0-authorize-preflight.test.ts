import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const preflightScript = path.join(repoRoot, 'scripts/smoke/auth0-authorize-preflight.mjs');
const publicOrigin = 'https://dev.fishing-assistant.online';

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

async function startFakeAuth0(options: { invalidRequest?: boolean } = {}) {
  const authorizeRequests: URL[] = [];

  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (url.pathname !== '/authorize') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    authorizeRequests.push(url);
    response.statusCode = 302;
    response.setHeader(
      'Location',
      options.invalidRequest === true
        ? `${publicOrigin}/app?error=invalid_request&error_description=client%20is%20not%20authorized#/auth/callback`
        : `/u/login?state=${encodeURIComponent(url.searchParams.get('state') ?? '')}`
    );
    response.end();
  });

  await new Promise<void>((resolve) => {
    server?.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fake Auth0 did not bind a TCP port');
  }

  return {
    authorizeRequests,
    auth0Domain: `http://127.0.0.1:${String(address.port)}`,
  };
}

function runPreflight(auth0Domain: string) {
  return new Promise<{ status: number | null; stderr: string; stdout: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [preflightScript], {
        cwd: repoRoot,
        env: {
          ...process.env,
          FA_AUTH0_AUDIENCE: 'https://dev.fishing-assistant.online/api',
          FA_AUTH0_CLIENT_ID: 'client-id',
          FA_AUTH0_DOMAIN: auth0Domain,
          FA_PUBLIC_ORIGIN: publicOrigin,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Auth0 preflight script timed out'));
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

describe('Auth0 authorize preflight', () => {
  it('passes when Auth0 sends the browser to Universal Login', async () => {
    const { auth0Domain, authorizeRequests } = await startFakeAuth0();

    const result = await runPreflight(auth0Domain);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Auth0 authorize preflight passed');
    expect(authorizeRequests).toHaveLength(1);
    const request = authorizeRequests[0];
    if (request === undefined) {
      throw new Error('expected one authorize request');
    }
    expect(request.searchParams.get('client_id')).toBe('client-id');
    expect(request.searchParams.get('audience')).toBe('https://dev.fishing-assistant.online/api');
    expect(request.searchParams.get('redirect_uri')).toBe(`${publicOrigin}/app#/auth/callback`);
    expect(request.searchParams.get('response_type')).toBe('code');
    expect(request.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('fails when Auth0 redirects back with invalid_request', async () => {
    const { auth0Domain } = await startFakeAuth0({ invalidRequest: true });

    const result = await runPreflight(auth0Domain);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('invalid_request');
  });
});
