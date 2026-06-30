import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const smokeScript = path.join(repoRoot, 'scripts/smoke/e2e-auth.mjs');

function runWithFakePnpm(options: { failOnCall?: number } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'fa-e2e-auth-smoke-'));
  const binDir = path.join(root, 'bin');
  const logPath = path.join(root, 'pnpm-calls.jsonl');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    path.join(binDir, 'pnpm'),
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';

const logPath = process.env.FA_FAKE_PNPM_LOG;
appendFileSync(logPath, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n');
process.exit(Number(process.env.FA_FAKE_PNPM_EXIT_CODE || '0'));
`,
    { mode: 0o755 }
  );
  writeFileSync(logPath, '');

  try {
    const result = spawnSync(process.execPath, [smokeScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env['PATH'] ?? ''}`,
        FA_FAKE_PNPM_LOG: logPath,
        FA_FAKE_PNPM_EXIT_CODE: String(options.failOnCall ? 23 : 0),
      },
      encoding: 'utf8',
    });
    const calls = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { cwd: string; args: string[] });

    return { result, calls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('e2e auth smoke script', () => {
  it('runs the final auth, admin, knowledge, usage, and chat workflow web suites', () => {
    const { result, calls } = runWithFakePnpm();

    expect(result.status).toBe(0);
    expect(calls).toEqual([
      {
        cwd: repoRoot,
        args: [
          '--filter',
          '@fa/web',
          'exec',
          'vitest',
          'run',
          'src/App.test.tsx',
          'src/auth/UserBootstrapGate.test.tsx',
          'src/services/userApi.test.ts',
          'src/workspace/WorkspaceApp.test.tsx',
          'src/admin/AdminShell.test.tsx',
          'src/admin/PendingRequestsPage.test.tsx',
          'src/admin/UsersPage.test.tsx',
          'src/admin/knowledge/KnowledgeAdminPage.test.tsx',
          'src/admin/usage/UsageDashboard.test.tsx',
          'src/workspace/useChatWorkflow.test.ts',
        ],
      },
    ]);
  });

  it('exits nonzero when the focused web suite fails', () => {
    const { result } = runWithFakePnpm({ failOnCall: 1 });

    expect(result.status).toBe(23);
  });
});
