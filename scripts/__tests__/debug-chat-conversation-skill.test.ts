import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const skillPath = path.join(repoRoot, '.codex/skills/debug-chat-conversation/SKILL.md');
const helperPath = path.join(
  repoRoot,
  '.codex/skills/debug-chat-conversation/scripts/fetch-conversation.mjs'
);
const slowCoverageTestTimeoutMs = 15_000;

describe('debug chat conversation skill', () => {
  it('documents the canonical Firestore evidence helper path', () => {
    const skill = readFileSync(skillPath, 'utf8');

    expect(skill).toContain('.codex/skills/debug-chat-conversation/scripts/fetch-conversation.mjs');
    expect(skill).toContain('--include-content');
    expect(skill).toContain('FA_GCP_ADMIN_KEY_FILE');
    expect(skill).toMatch(/Do not fetch.*hash-routed SPA URL/i);
    expect(skill).toMatch(/Do not speculate/i);
    expect(skill).toMatch(/redacts raw message content/i);
  });

  it(
    'rejects missing or invalid conversation IDs before querying Firestore',
    () => {
      const missing = spawnSync(process.execPath, [helperPath], {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 10_000,
      });
      const invalid = spawnSync(process.execPath, [helperPath, 'not-a-conversation-id'], {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 10_000,
      });

      expect(missing.status).toBe(1);
      expect(missing.error).toBeUndefined();
      expect(missing.stderr).toMatch(/Usage:/);
      expect(invalid.status).toBe(1);
      expect(invalid.error).toBeUndefined();
      expect(invalid.stderr).toMatch(/Invalid conversation ID/i);
    },
    slowCoverageTestTimeoutMs
  );

  it('sorts message docs locally without requiring a conversationId-createdAt Firestore index', () => {
    const helper = readFileSync(helperPath, 'utf8');

    expect(helper).toContain(".where('conversationId', '==', conversationId)");
    expect(helper).not.toMatch(/\.orderBy\(['"]createdAt['"]/);
    expect(helper).toMatch(/sortMessagesByCreatedAt/);
  });

  it('uses the FA admin key surface and redacts sensitive content by default', () => {
    const helper = readFileSync(helperPath, 'utf8');

    expect(helper).toContain('FA_GCP_ADMIN_KEY_FILE');
    expect(helper).toContain('--include-content');
    expect(helper).toContain('contentRedacted: true');
    expect(helper).toContain('queryRedacted: true');
    expect(helper).toContain('userIdRedacted: true');
    expect(helper).toContain('missingInformationRedacted: true');
    expect(helper).toContain('missingInformationCount: items.length');
    expect(helper).not.toContain('applicationDefault');
  });
});
