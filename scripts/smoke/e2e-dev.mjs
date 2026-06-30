#!/usr/bin/env node
// @ts-check

const origin =
  process.env['FA_DEV_ORIGIN'] ?? process.env['FA_PUBLIC_ORIGIN'] ?? 'http://127.0.0.1:3100';

/**
 * @param {string} path
 * @param {{ headers?: Record<string, string> }} [options]
 * @returns {Promise<Response>}
 */
async function request(path, options = {}) {
  const headers = options.headers ?? {};
  return fetch(new URL(path, origin), Object.keys(headers).length === 0 ? undefined : { headers });
}

/**
 * @param {string} label
 * @param {string} path
 * @param {{ headers?: Record<string, string> }} [options]
 */
async function expectOk(label, path, options = {}) {
  const response = await request(path, options);
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${response.statusText}`);
  }
}

async function expectNoViteDevelopmentSource() {
  const webResponse = await request('/app');
  if (!webResponse.ok) {
    throw new Error(`app web health failed: ${webResponse.status} ${webResponse.statusText}`);
  }

  const webHtml = await webResponse.text();
  if (webHtml.includes('/@vite/client') || webHtml.includes('/src/main.tsx')) {
    throw new Error('public DEV must not serve Vite development source from /');
  }

  for (const path of ['/src/config.ts', '/@vite/client']) {
    const response = await request(path, {
      headers: { Accept: 'text/javascript' },
    });

    if (response.ok) {
      throw new Error(`public DEV must not serve Vite development source from ${path}`);
    }
  }
}

async function main() {
  await expectOk('edge health', '/healthz');
  await expectOk('homepage', '/');
  await expectOk('index', '/index.html');
  await expectOk('app entrypoint', '/app');
  await expectNoViteDevelopmentSource();
  await expectOk('chat health', '/api/chat/health');
  await expectOk('knowledge health', '/api/knowledge/health');
  await expectOk('usage health', '/api/llm-usage/health');
  await expectOk('users health', '/api/users/health');

  const internalResponse = await request('/api/chat/internal/not-public');
  if (internalResponse.status !== 403 && internalResponse.status !== 404) {
    throw new Error(`public internal route must return 403 or 404, got ${internalResponse.status}`);
  }

  process.stdout.write(`FA DEV smoke checks passed for ${origin}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`FA DEV smoke checks failed: ${message}\n`);
  process.exit(1);
});
