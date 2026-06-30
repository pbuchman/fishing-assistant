import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const smokeScript = path.join(repoRoot, 'scripts/smoke/llm-usage-auth-attribution.mjs');

function runWithFakePnpm(options: { failOnCall?: number } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'fa-llm-usage-smoke-'));
  const binDir = path.join(root, 'bin');
  const logPath = path.join(root, 'pnpm-calls.jsonl');
  const countPath = path.join(root, 'count');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    path.join(binDir, 'pnpm'),
    `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const logPath = process.env.FA_FAKE_PNPM_LOG;
const countPath = process.env.FA_FAKE_PNPM_COUNT;
const current = Number(readFileSync(countPath, 'utf8') || '0') + 1;
writeFileSync(countPath, String(current));
appendFileSync(logPath, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n');
const failOnCall = Number(process.env.FA_FAKE_PNPM_FAIL_ON_CALL || '0');
process.exit(failOnCall === current ? 23 : 0);
`,
    { mode: 0o755 }
  );
  writeFileSync(logPath, '');
  writeFileSync(countPath, '0');

  try {
    const result = spawnSync(process.execPath, [smokeScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env['PATH'] ?? ''}`,
        FA_FAKE_PNPM_LOG: logPath,
        FA_FAKE_PNPM_COUNT: countPath,
        FA_FAKE_PNPM_FAIL_ON_CALL: String(options.failOnCall ?? 0),
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

describe('llm usage auth attribution smoke script', () => {
  it('runs focused chat and knowledge service attribution test slices from the repo root', () => {
    const { result, calls } = runWithFakePnpm();

    expect(result.status).toBe(0);
    expect(calls).toEqual([
      {
        cwd: repoRoot,
        args: [
          'vitest',
          'run',
          '--root',
          '.',
          'apps/chat-service/src/services.test.ts',
          '--testNamePattern',
          'wires runtime chat providers to nested usage events with separate components',
        ],
      },
      {
        cwd: repoRoot,
        args: [
          'vitest',
          'run',
          '--root',
          '.',
          'apps/knowledge-service/src/services.test.ts',
          '--testNamePattern',
          'wires runtime embedding providers to nested usage events with required attribution',
        ],
      },
    ]);
  });

  it('exits nonzero on first failed focused test slice', () => {
    const { result, calls } = runWithFakePnpm({ failOnCall: 1 });

    expect(result.status).toBe(23);
    expect(calls).toHaveLength(1);
  });
});
